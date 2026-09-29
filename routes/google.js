import crypto from 'node:crypto';

import express, { Router } from 'express';

import {
  base64url,
  renderTokenCallbackPage,
  requireEnv,
  safeReturnTo,
  signState,
  verifyState,
} from '../lib/oauth.js';

const router = Router();

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STORAGE_KEY = 'googleAuth';

// Creating calendar events ("Add to calendar"), the app's own hidden Drive
// folder for syncing the saved data, and reading (never changing) the names
// and types of the user's Drive files, for the Gallery's Concerts folder.
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
].join(' ');

router.get('/auth/google', (req, res) => {
  try {
    const params = new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      redirect_uri: requireEnv('GOOGLE_REDIRECT_URI'),
      response_type: 'code',
      scope: SCOPE,
      // A refresh token is only issued with offline access, and Google only
      // re-issues it when consent is asked for explicitly.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: signState({ r: safeReturnTo(req.query.from), n: base64url(crypto.randomBytes(8)) }),
    });

    res.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/auth/google/callback', async (req, res) => {
  if (req.query.error) {
    res.status(400).type('html').send(
      renderTokenCallbackPage({ storageKey: STORAGE_KEY, error: String(req.query.error), returnTo: '/' }),
    );
    return;
  }

  const state = verifyState(req.query.state);
  if (!state) {
    res.status(400).type('html').send(
      renderTokenCallbackPage({ storageKey: STORAGE_KEY, error: 'invalid or tampered state', returnTo: '/' }),
    );
    return;
  }

  const returnTo = safeReturnTo(state.r);

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        client_id: requireEnv('GOOGLE_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
        redirect_uri: requireEnv('GOOGLE_REDIRECT_URI'),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(502).type('html').send(
        renderTokenCallbackPage({
          storageKey: STORAGE_KEY,
          error: data.error_description || data.error || 'token exchange failed',
          returnTo,
        }),
      );
      return;
    }

    res.type('html').send(
      renderTokenCallbackPage({
        storageKey: STORAGE_KEY,
        tokens: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
          expiresAt: Date.now() + data.expires_in * 1000,
          // What the user actually allowed - they can untick Drive on the
          // consent screen and keep Calendar.
          scope: data.scope || null,
        },
        returnTo,
      }),
    );
  } catch (err) {
    res.status(500).type('html').send(
      renderTokenCallbackPage({ storageKey: STORAGE_KEY, error: err.message, returnTo }),
    );
  }
});

/** Silent Google access-token refresh (needs the client secret). */
router.post('/api/google/refresh', express.json(), async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: requireEnv('GOOGLE_CLIENT_ID'),
        client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data.error_description || data.error || 'refresh failed' });
      return;
    }

    res.json({
      accessToken: data.access_token,
      // Google doesn't return the refresh token again on a refresh.
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope: data.scope || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
