import crypto from 'node:crypto';

import express, { Router } from 'express';

const router = Router();

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const SCOPES = [
  'user-read-private',
  'user-follow-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
].join(' ');

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} - see .env.example`);
  }
  return value;
}

/**
 * The OAuth `state` carries everything the callback needs (PKCE verifier and
 * the page to return to), HMAC-signed with SESSION_SECRET. Nothing is stored
 * server-side, so the flow survives restarts and multiple instances.
 */
function signState(payload) {
  const secret = requireEnv('SESSION_SECRET');
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = base64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${signature}`;
}

function verifyState(state) {
  if (typeof state !== 'string' || !state.includes('.')) {
    return null;
  }
  const secret = requireEnv('SESSION_SECRET');
  const [body, signature] = state.split('.', 2);
  const expected = base64url(crypto.createHmac('sha256', secret).update(body).digest());

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function safeReturnTo(value) {
  // Only ever redirect back to a path within this app.
  return typeof value === 'string' && /^\/[A-Za-z0-9\-_/]*$/.test(value) ? value : '/';
}

function renderCallbackPage({ tokens, error, returnTo }) {
  const payload = JSON.stringify({ tokens, error, returnTo }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Signing in…</title>
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="stylesheet" href="/css/variables.css" />
    <link rel="stylesheet" href="/css/style.css" />
  </head>
  <body>
    <main class="callback">
      <p id="callback-message">Signing you in…</p>
    </main>
    <script>
      (function () {
        var result = ${payload};
        var message = document.getElementById('callback-message');
        if (result.error) {
          message.textContent = 'Spotify login failed: ' + result.error;
          return;
        }
        try {
          localStorage.setItem('spotifyAuth', JSON.stringify(result.tokens));
        } catch (err) {
          message.textContent = 'Could not store the login in this browser.';
          return;
        }
        window.location.replace(result.returnTo || '/');
      })();
    </script>
  </body>
</html>`;
}

router.get('/login', (req, res) => {
  try {
    const clientId = requireEnv('SPOTIFY_CLIENT_ID');
    const redirectUri = requireEnv('SPOTIFY_REDIRECT_URI');

    const codeVerifier = base64url(crypto.randomBytes(48));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

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
      renderCallbackPage({ error: String(req.query.error), returnTo: '/' }),
    );
    return;
  }

  const state = verifyState(req.query.state);
  if (!state || typeof state.v !== 'string') {
    res.status(400).type('html').send(
      renderCallbackPage({ error: 'invalid or tampered state', returnTo: '/' }),
    );
    return;
  }

  const returnTo = safeReturnTo(state.r);

  try {
    const clientId = requireEnv('SPOTIFY_CLIENT_ID');
    const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET');
    const redirectUri = requireEnv('SPOTIFY_REDIRECT_URI');

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(req.query.code || ''),
        redirect_uri: redirectUri,
        code_verifier: state.v,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(502).type('html').send(
        renderCallbackPage({
          error: data.error_description || data.error || 'token exchange failed',
          returnTo,
        }),
      );
      return;
    }

    res.type('html').send(
      renderCallbackPage({
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
      renderCallbackPage({ error: err.message, returnTo }),
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
    const clientId = requireEnv('SPOTIFY_CLIENT_ID');
    const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET');

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
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
