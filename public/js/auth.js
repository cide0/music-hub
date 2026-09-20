/*
 * Shared client-side Spotify auth: token storage, expiry check, silent
 * refresh, navbar login state and the page-level login gating. Included on
 * every page so none of this is duplicated per page.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var AUTH_KEY = 'spotifyAuth';
  var PROFILE_KEY = 'spotifyProfile';
  // Refresh a little before the token actually expires.
  var EXPIRY_MARGIN_MS = 60 * 1000;

  var storage = MusicHub.storage;
  var refreshInFlight = null;

  function getTokens() {
    var tokens = storage.read(AUTH_KEY, null);
    return tokens && tokens.accessToken ? tokens : null;
  }

  function setTokens(tokens) {
    storage.write(AUTH_KEY, tokens);
  }

  function logout() {
    storage.remove(AUTH_KEY);
    storage.remove(PROFILE_KEY);
    render();
  }

  function isLoggedIn() {
    return getTokens() !== null;
  }

  function refreshTokens(tokens) {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = fetch('/api/spotify/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('refresh failed');
        }
        return response.json();
      })
      .then(function (fresh) {
        setTokens(fresh);
        return fresh.accessToken;
      })
      .catch(function (err) {
        // The refresh token is gone, invalid or revoked - a full login is the
        // only way back.
        console.warn('Spotify token refresh failed', err);
        logout();
        return null;
      })
      .then(function (result) {
        refreshInFlight = null;
        return result;
      });

    return refreshInFlight;
  }

  /**
   * Returns a usable access token, silently refreshing it first if it has
   * expired (or is about to). Resolves to null if the user has to log in again.
   */
  function getAccessToken() {
    var tokens = getTokens();
    if (!tokens) {
      return Promise.resolve(null);
    }

    var stillValid = typeof tokens.expiresAt === 'number'
      && tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now();
    if (stillValid) {
      return Promise.resolve(tokens.accessToken);
    }

    if (!tokens.refreshToken) {
      logout();
      return Promise.resolve(null);
    }

    return refreshTokens(tokens);
  }

  /** fetch() against the Spotify Web API with a guaranteed-fresh token. */
  function spotifyFetch(path, options) {
    return getAccessToken().then(function (accessToken) {
      if (!accessToken) {
        throw new Error('Not logged in to Spotify');
      }
      var settings = options || {};
      var headers = Object.assign({}, settings.headers, {
        Authorization: 'Bearer ' + accessToken,
      });
      var url = path.indexOf('http') === 0 ? path : 'https://api.spotify.com/v1' + path;
      return fetch(url, Object.assign({}, settings, { headers: headers }));
    });
  }

  function loadProfile() {
    return spotifyFetch('/me')
      .then(function (response) {
        if (response.status === 401) {
          // Token rejected despite the refresh - back to a full login.
          logout();
          throw new Error('Spotify rejected the stored token');
        }
        if (!response.ok) {
          throw new Error('profile request failed with ' + response.status);
        }
        return response.json();
      })
      .then(function (me) {
        var profile = {
          id: me.id,
          displayName: me.display_name || me.id,
          imageUrl: me.images && me.images.length ? me.images[0].url : null,
        };
        storage.write(PROFILE_KEY, profile);
        return profile;
      });
  }

  function renderUser(profile) {
    var nameEl = document.getElementById('spotify-user-name');
    var avatarEl = document.getElementById('spotify-avatar');
    var userBox = document.getElementById('spotify-user');

    if (userBox) {
      // Open the profile in the Spotify app rather than the browser.
      if (profile.id) {
        userBox.href = 'spotify:user:' + profile.id;
      } else {
        userBox.removeAttribute('href');
      }
    }
    if (nameEl) {
      nameEl.textContent = profile.displayName;
    }
    if (avatarEl) {
      if (profile.imageUrl) {
        avatarEl.src = profile.imageUrl;
        avatarEl.hidden = false;
      } else {
        avatarEl.removeAttribute('src');
        avatarEl.hidden = true;
      }
      avatarEl.alt = profile.displayName;
    }
  }

  function render() {
    var loggedIn = isLoggedIn();

    // Everything marked data-auth-required / data-auth-missing is shown or
    // hidden by CSS off this class - the head partial already set it before
    // the first paint, this keeps it correct as the state changes.
    var root = document.documentElement;
    root.classList.toggle('is-logged-in', loggedIn);
    root.classList.toggle('is-logged-out', !loggedIn);

    var loginButton = document.getElementById('spotify-login');
    if (loginButton) {
      // Come back to the page the login was started from.
      loginButton.href = '/login?from=' + encodeURIComponent(window.location.pathname);
    }

    if (loggedIn) {
      var cached = storage.read(PROFILE_KEY, null);
      if (cached) {
        renderUser(cached);
      }
    }

    document.dispatchEvent(
      new CustomEvent('musichub:authchange', { detail: { loggedIn: loggedIn } }),
    );
  }

  document.addEventListener('DOMContentLoaded', function () {
    render();

    if (!isLoggedIn()) {
      return;
    }

    // Verify the stored token actually still works, and refresh the cached
    // profile shown in the navbar.
    loadProfile()
      .then(function (profile) {
        renderUser(profile);
      })
      .catch(function (err) {
        console.warn('Could not load the Spotify profile', err);
        if (!isLoggedIn()) {
          render();
        }
      });
  });

  MusicHub.auth = {
    isLoggedIn: isLoggedIn,
    getAccessToken: getAccessToken,
    spotifyFetch: spotifyFetch,
    logout: logout,
    render: render,
  };
})(window.MusicHub);
