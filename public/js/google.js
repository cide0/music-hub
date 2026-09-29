/*
 * Google connection state for the Calendar integration and the Drive sync:
 * tokens in localStorage under `googleAuth`, silent refresh through the
 * server (the client secret never reaches the browser). The Drive helpers
 * only ever touch the app's own hidden folder (`appDataFolder`).
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var AUTH_KEY = 'googleAuth';
  var EXPIRY_MARGIN_MS = 60 * 1000;
  var CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
  var DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
  var DRIVE_FILE_FIELDS = 'id,name,modifiedTime,appProperties';

  var storage = MusicHub.storage;
  var refreshInFlight = null;

  function getTokens() {
    var tokens = storage.read(AUTH_KEY, null);
    return tokens && tokens.accessToken ? tokens : null;
  }

  function isConnected() {
    return getTokens() !== null;
  }

  /**
   * Whether the login allows the Drive sync. Logins from before it was added
   * (no `scope` stored) don't, and the consent screen lets the user untick it.
   */
  function hasDriveAccess() {
    var tokens = getTokens();
    return !!(tokens && typeof tokens.scope === 'string'
      && tokens.scope.split(' ').indexOf(DRIVE_SCOPE) !== -1);
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
        // Keep what was granted if the refresh doesn't say.
        fresh.scope = fresh.scope || tokens.scope || null;
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

  /* ------------------------------------------------------------- drive */

  /**
   * A Drive API request with the access token. A 401 means the token was
   * revoked or expired early: one refresh and retry, then it's an error.
   */
  function driveFetch(url, options, retried) {
    return getAccessToken().then(function (accessToken) {
      if (!accessToken) {
        throw new Error('Google isn’t connected');
      }
      var init = Object.assign({}, options);
      init.headers = Object.assign({}, init.headers, { Authorization: 'Bearer ' + accessToken });
      return fetch(url, init);
    }).then(function (response) {
      if (response.status === 401 && !retried) {
        var tokens = getTokens();
        if (tokens && tokens.refreshToken) {
          return refreshTokens(tokens).then(function () {
            return driveFetch(url, options, true);
          });
        }
      }
      if (!response.ok) {
        return response.json().catch(function () {
          return {};
        }).then(function (data) {
          var err = new Error('Google Drive: ' + (data.error && data.error.message
            ? data.error.message
            : 'status ' + response.status));
          err.status = response.status;
          throw err;
        });
      }
      return response;
    });
  }

  /** Every file in the app's Drive folder: { id, name, modifiedTime, appProperties }. */
  function listDriveFiles() {
    var files = [];

    function fetchPage(pageToken) {
      var params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'nextPageToken,files(' + DRIVE_FILE_FIELDS + ')',
        pageSize: '100',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      return driveFetch(DRIVE_FILES_URL + '?' + params.toString())
        .then(function (response) {
          return response.json();
        })
        .then(function (data) {
          files = files.concat(data.files || []);
          return data.nextPageToken ? fetchPage(data.nextPageToken) : files;
        });
    }

    return fetchPage(null);
  }

  /** A Drive file's content, as text. */
  function readDriveFile(fileId) {
    return driveFetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId) + '?alt=media')
      .then(function (response) {
        return response.text();
      });
  }

  /**
   * Saves `content` (text) as `name` in the app's Drive folder, replacing
   * the file `fileId` when given, else creating one. `appProperties` are
   * small string key/values kept with the file (listDriveFiles returns
   * them). Resolves with the file's { id, name, modifiedTime, appProperties }.
   */
  function writeDriveFile(name, content, fileId, appProperties) {
    var metadata = { name: name, mimeType: 'application/json' };
    if (appProperties) {
      metadata.appProperties = appProperties;
    }
    if (!fileId) {
      metadata.parents = ['appDataFolder'];
    }

    var boundary = 'musichub' + Math.random().toString(36).slice(2);
    var body = new Blob([
      '--' + boundary + '\r\n',
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata) + '\r\n',
      '--' + boundary + '\r\n',
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      content + '\r\n',
      '--' + boundary + '--',
    ]);

    var url = (fileId ? DRIVE_UPLOAD_URL + '/' + encodeURIComponent(fileId) : DRIVE_UPLOAD_URL)
      + '?uploadType=multipart&fields=' + encodeURIComponent(DRIVE_FILE_FIELDS);

    return driveFetch(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body,
    }).then(function (response) {
      return response.json();
    });
  }

  /** Removes a file from the app's Drive folder for good. */
  function deleteDriveFile(fileId) {
    return driveFetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId), { method: 'DELETE' })
      .then(function () {
        return true;
      });
  }

  MusicHub.google = {
    isConnected: isConnected,
    hasDriveAccess: hasDriveAccess,
    connect: connect,
    disconnect: disconnect,
    getAccessToken: getAccessToken,
    createCalendarEvent: createCalendarEvent,
    listDriveFiles: listDriveFiles,
    readDriveFile: readDriveFile,
    writeDriveFile: writeDriveFile,
    deleteDriveFile: deleteDriveFile,
  };
})(window.MusicHub);
