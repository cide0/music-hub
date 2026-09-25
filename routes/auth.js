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

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const STORAGE_KEY = 'spotifyAuth';

const SCOPES = [
  'user-read-private',
  'user-follow-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  // Album Suggester: read the Saved Albums, unsave one once it's listened to.
  'user-library-read',
  'user-library-modify',
  // Collection: play a vinyl's album - find a device to play on, start it.
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

function basicAuthHeader() {
  const clientId = requireEnv('SPOTIFY_CLIENT_ID');
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET');
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

router.get('/login', (req, res) => {
  try {
    const clientId = requireEnv('SPOTIFY_CLIENT_ID');
    const redirectUri = requireEnv('SPOTIFY_REDIRECT_URI');

    const codeVerifier = base64url(crypto.randomBytes(48));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

    // The verifier travels in the signed state - no server-side storage.
    const state = signState({
      v: codeVerifier,
      r: safeReturnTo(req.query.from),
      n: base64url(crypto.randomBytes(8)),
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state,
      scope: SCOPES,
    });

    res.redirect(`${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get('/callback', async (req, res) => {
  if (req.query.error) {
    res.status(400).type('html').send(
      renderTokenCallbackPage({ storageKey: STORAGE_KEY, error: String(req.query.error), returnTo: '/' }),
    );
    return;
  }

  const state = verifyState(req.query.state);
  if (!state || typeof state.v !== 'string') {
    res.status(400).type('html').send(
      renderTokenCallbackPage({ storageKey: STORAGE_KEY, error: 'invalid or tampered state', returnTo: '/' }),
    );
    return;
  }

  const returnTo = safeReturnTo(state.r);

  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: requireEnv('SPOTIFY_REDIRECT_URI'),
        code_verifier: state.v,
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
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000,
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

/**
 * Silent refresh: the browser has the refresh token, but the client secret
 * needed to redeem it must never leave the server - hence this proxy.
 */
router.post('/api/spotify/refresh', express.json(), async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(response.status).json({ error: data.error_description || data.error || 'refresh failed' });
      return;
    }

    res.json({
      accessToken: data.access_token,
      // Spotify only sometimes rotates the refresh token; keep the old one otherwise.
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
