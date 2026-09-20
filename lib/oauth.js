import crypto from 'node:crypto';

/**
 * Shared pieces of both OAuth flows (Spotify and Google): stateless,
 * HMAC-signed `state` handling and the little HTML page that hands tokens to
 * the browser. Nothing is ever stored server-side - Render's free plan sleeps
 * and restarts, so there is nowhere to keep it.
 */

export function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name} - see .env.example`);
  }
  return value;
}

export function signState(payload) {
  const secret = requireEnv('SESSION_SECRET');
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = base64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${signature}`;
}

export function verifyState(state) {
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

/** Only ever redirect back to a path within this app. */
export function safeReturnTo(value) {
  return typeof value === 'string' && /^\/[A-Za-z0-9\-_/]*$/.test(value) ? value : '/';
}

/**
 * The page the OAuth callback returns: an inline script writes the tokens into
 * localStorage (the app's only storage) and sends the user back where they
 * started.
 */
export function renderTokenCallbackPage({ storageKey, tokens, error, returnTo }) {
  const payload = JSON.stringify({ storageKey, tokens, error, returnTo }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Signing in…</title>
    <link rel="icon" type="image/png" href="/favicon.png" />
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
          message.textContent = 'Login failed: ' + result.error;
          return;
        }
        try {
          localStorage.setItem(result.storageKey, JSON.stringify(result.tokens));
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
