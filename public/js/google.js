/*
 * Google connection state for the Calendar integration: tokens in
 * localStorage under `googleAuth`, silent refresh through the server (the
 * client secret never reaches the browser).
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var AUTH_KEY = 'googleAuth';
  var EXPIRY_MARGIN_MS = 60 * 1000;
  var CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  var storage = MusicHub.storage;
  var refreshInFlight = null;

  function getTokens() {
    var tokens = storage.read(AUTH_KEY, null);
    return tokens && tokens.accessToken ? tokens : null;
  }

  function isConnected() {
    return getTokens() !== null;
  }

  function disconnect() {
    storage.remove(AUTH_KEY);
  }

  /** Send the user through the Google consent flow, then back to this page. */
  function connect() {
    window.location.href = '/auth/google?from=' + encodeURIComponent(window.location.pathname);
  }

  function refreshTokens(tokens) {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = fetch('/api/google/refresh', {
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
        storage.write(AUTH_KEY, fresh);
        return fresh.accessToken;
      })
      .catch(function (err) {
        console.warn('Google token refresh failed', err);
        disconnect();
        return null;
      })
      .then(function (result) {
        refreshInFlight = null;
        return result;
      });

    return refreshInFlight;
  }

  /** A usable Google access token, refreshed first if it has expired. */
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
      disconnect();
      return Promise.resolve(null);
    }

    return refreshTokens(tokens);
  }

  /** Creates an event on the user's primary calendar. */
  function createCalendarEvent(event) {
    return getAccessToken().then(function (accessToken) {
      if (!accessToken) {
        throw new Error('Google isn’t connected');
      }
      return fetch(CALENDAR_EVENTS_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () {
          return {};
        }).then(function (data) {
          var message = data.error && data.error.message ? data.error.message : 'status ' + response.status;
          throw new Error(message);
        });
      }
      return response.json();
    });
  }

  MusicHub.google = {
    isConnected: isConnected,
    connect: connect,
    disconnect: disconnect,
    getAccessToken: getAccessToken,
    createCalendarEvent: createCalendarEvent,
  };
})(window.MusicHub);
