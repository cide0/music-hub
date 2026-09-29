/*
 * Google connection state for the Calendar integration and the Drive sync:
 * tokens in localStorage under `googleAuth`, silent refresh through the
 * server (the client secret never reaches the browser). The Drive helpers
 * write only to the app's own hidden folder (`appDataFolder`); the rest of
 * the user's Drive is only ever read, for the Gallery's Concerts folder.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var AUTH_KEY = 'googleAuth';
  var EXPIRY_MARGIN_MS = 60 * 1000;
  var CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  // Reading the Gallery's Concerts folder: names and types only, read-only.
  var FOLDERS_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
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
  function hasScope(scope) {
    var tokens = getTokens();
    return !!(tokens && typeof tokens.scope === 'string'
      && tokens.scope.split(' ').indexOf(scope) !== -1);
  }

  function hasDriveAccess() {
    return hasScope(DRIVE_SCOPE);
  }

  /** Whether the login allows reading the Gallery's Concerts folder. */
  function hasFolderAccess() {
    return hasScope(FOLDERS_SCOPE);
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

  /** A files.list query, following its pages until they run out. */
  function listAll(params, fields) {
    var files = [];

    function fetchPage(pageToken) {
      var query = new URLSearchParams(params);
      query.set('fields', 'nextPageToken,files(' + fields + ')');
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      return driveFetch(DRIVE_FILES_URL + '?' + query.toString())
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

  /** Every file in the app's Drive folder: { id, name, modifiedTime, appProperties }. */
  function listDriveFiles() {
    return listAll({ spaces: 'appDataFolder', pageSize: '100' }, DRIVE_FILE_FIELDS);
  }

  /** A Drive search string literal: backslashes and quotes escaped. */
  function quote(text) {
    return "'" + String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }

  var FOLDER_FIELDS = 'id,name,parents,createdTime';
  var MEDIA_FIELDS = 'id,name,mimeType,parents,createdTime';

  /**
   * A folder of the user's My Drive, by id - or, with no id, the folder
   * called `name` at its top level. Resolves with { id, name, shared }, or
   * null when there's no such folder (or it's in the bin).
   */
  function findFolder(folderId, name) {
    if (folderId) {
      return driveFetch(DRIVE_FILES_URL + '/' + encodeURIComponent(folderId)
        + '?fields=id,name,mimeType,trashed,shared')
        .then(function (response) {
          return response.json();
        })
        .then(function (file) {
          return file.mimeType === FOLDER_MIME && !file.trashed ? file : null;
        }, function (err) {
          if (err.status === 404) {
            return null;
          }
          throw err;
        });
    }
    return listAll({
      q: 'name = ' + quote(name) + " and mimeType = '" + FOLDER_MIME + "' and 'root' in parents and trashed = false",
      spaces: 'drive',
      pageSize: '10',
    }, 'id,name,shared,createdTime').then(function (found) {
      // Two of the same name: the oldest, which is the one set up first.
      found.sort(function (a, b) {
        return String(a.createdTime).localeCompare(String(b.createdTime));
      });
      return found[0] || null;
    });
  }

  /**
   * What's directly inside the folders `parentIds`: `kind` 'folders' for
   * subfolders, 'media' for images and videos. Several parents go into one
   * query, so a whole level takes a request or two.
   */
  function listChildren(parentIds, kind) {
    var chunks = [];
    for (var i = 0; i < parentIds.length; i += 20) {
      chunks.push(parentIds.slice(i, i + 20));
    }
    var type = kind === 'folders'
      ? "mimeType = '" + FOLDER_MIME + "'"
      : "(mimeType contains 'image/' or mimeType contains 'video/')";

    return chunks.reduce(function (previous, chunk) {
      return previous.then(function (all) {
        var parents = chunk.map(function (id) {
          return quote(id) + ' in parents';
        }).join(' or ');
        return listAll({
          q: '(' + parents + ') and ' + type + ' and trashed = false',
          spaces: 'drive',
          pageSize: '1000',
        }, kind === 'folders' ? FOLDER_FIELDS : MEDIA_FIELDS).then(function (files) {
          return all.concat(files);
        });
      });
    }, Promise.resolve([]));
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
    hasFolderAccess: hasFolderAccess,
    connect: connect,
    disconnect: disconnect,
    getAccessToken: getAccessToken,
    createCalendarEvent: createCalendarEvent,
    listDriveFiles: listDriveFiles,
    readDriveFile: readDriveFile,
    writeDriveFile: writeDriveFile,
    deleteDriveFile: deleteDriveFile,
    findFolder: findFolder,
    listChildren: listChildren,
  };
})(window.MusicHub);
