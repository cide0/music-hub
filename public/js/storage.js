/*
 * localStorage access for Music Hub, plus the Settings page's Export / Import data
 * feature and the "couldn't save" notice. There is no database: localStorage is
 * the working copy, which sync.js mirrors to Google Drive - it hears of every real
 * change to an app-data key through onChange.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // Every key holding app data. Auth tokens are deliberately NOT in here:
  // they are device-specific and re-obtained by logging in again.
  var APP_DATA_KEYS = [
    'concertDateFetcher',
    'followedArtistsGraph',
    'concertHistory',
    'discogsVinylReleases',
    'albumSuggesterHistory',
    // The Album Suggester's Saved Albums, as last fetched from Spotify.
    'albumSuggesterLibrary',
    // The followed Spotify artists, as the navbar's refresh button last fetched them.
    'followedArtists',
    // The Spotify playlists the user can add to, as Settings' refresh button last fetched them.
    'spotifyPlaylists',
    // Coins, bought Store items, the equipped styles and unboxed vinyls.
    'store',
    // The user's choices on the Settings page - see getSetting / setSetting.
    'settings',
  ];

  var SETTINGS_KEY = 'settings';

  var BACKUP_FILENAME = 'music-hub-backup.json';

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.warn('Could not read "' + key + '" from localStorage', err);
      return fallback;
    }
  }

  // Called with the key whenever an app-data key really changes (sync.js).
  var changeListeners = [];

  function onChange(listener) {
    changeListeners.push(listener);
  }

  function notifyChange(key) {
    if (APP_DATA_KEYS.indexOf(key) === -1) {
      return;
    }
    changeListeners.forEach(function (listener) {
      listener(key);
    });
  }

  function write(key, value) {
    try {
      var raw = JSON.stringify(value);
      // Pages re-save unchanged state now and then; that isn't a change.
      var before = localStorage.getItem(key);
      localStorage.setItem(key, raw);
      if (before !== raw) {
        notifyChange(key);
      }
      return true;
    } catch (err) {
      console.warn('Could not write "' + key + '" to localStorage', err);
      showWriteFailure(err);
      return false;
    }
  }

  /* ------------------------------------------------- failed-save notice */

  function isQuotaError(err) {
    return !!err && (err.name === 'QuotaExceededError'
      || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || err.code === 22
      || err.code === 1014);
  }

  function writeFailureMessage(err) {
    if (isQuotaError(err)) {
      return 'Couldn’t save: this browser’s storage for Music Hub is full, so the latest '
        + 'changes will be gone after a reload. Clear the saved data of a page you no longer need '
        + '(export a backup in Settings first if you want to keep it), then try again.';
    }
    return 'Couldn’t save: this browser isn’t letting Music Hub store data (a private '
      + 'window or blocked site data?), so the latest changes will be gone after a reload.';
  }

  /**
   * A write that failed would otherwise only show up in the console, and the
   * change would silently be gone after a reload. One notice at the bottom of
   * the page says so, fading out on its own like every message (notice.js);
   * later failures update it rather than stacking up.
   */
  function showWriteFailure(err) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () {
        showWriteFailure(err);
      });
      return;
    }

    var notice = document.getElementById('storage-failure');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'notice notice--floating notice--error';
      notice.id = 'storage-failure';
      notice.setAttribute('role', 'alert');

      var text = document.createElement('span');
      text.className = 'notice__text';
      notice.appendChild(text);

      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'notice__dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" />'
        + '<line x1="6" y1="6" x2="18" y2="18" /></svg>';
      dismiss.addEventListener('click', function () {
        MusicHub.notice.hide(notice);
      });
      notice.appendChild(dismiss);

      document.body.appendChild(notice);
    }

    MusicHub.notice.flash(notice, writeFailureMessage(err));
  }

  function remove(key) {
    try {
      var existed = localStorage.getItem(key) !== null;
      localStorage.removeItem(key);
      if (existed) {
        notifyChange(key);
      }
    } catch (err) {
      console.warn('Could not remove "' + key + '" from localStorage', err);
    }
  }

  /**
   * One value from the user's settings, all of which live together under the
   * `settings` key so Export / Import carries them across devices.
   */
  function getSetting(name, fallback) {
    var settings = read(SETTINGS_KEY, null);
    if (!settings || typeof settings !== 'object' || !(name in settings)) {
      return fallback;
    }
    return settings[name];
  }

  /** Saves one setting; null or undefined removes it. */
  function setSetting(name, value) {
    var settings = read(SETTINGS_KEY, null);
    if (!settings || typeof settings !== 'object') {
      settings = {};
    }
    if (value === null || value === undefined) {
      delete settings[name];
    } else {
      settings[name] = value;
    }
    return write(SETTINGS_KEY, settings);
  }

  function collectAppData() {
    var data = {};
    APP_DATA_KEYS.forEach(function (key) {
      var value = read(key, undefined);
      if (value !== undefined) {
        data[key] = value;
      }
    });
    return data;
  }

  /**
   * Removes every app-data key - coins, Store items and the vinyl
   * collection included. Only the Spotify / Google logins stay.
   */
  function clearAppData() {
    APP_DATA_KEYS.forEach(remove);
  }

  function exportData() {
    var payload = {
      app: 'music-hub',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: collectAppData(),
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = BACKUP_FILENAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Accepts both the wrapped export format and a bare { key: value } object.
  function extractData(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    var data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    var known = Object.keys(data).filter(function (key) {
      return APP_DATA_KEYS.indexOf(key) !== -1;
    });
    return known.length ? { data: data, keys: known } : null;
  }

  function importDataFromFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('Could not read that file.'));
      };
      reader.onload = function () {
        var parsed;
        try {
          parsed = JSON.parse(String(reader.result));
        } catch (err) {
          reject(new Error("That file isn't valid JSON."));
          return;
        }

        var extracted = extractData(parsed);
        if (!extracted) {
          reject(new Error("That file doesn't contain any Music Hub data."));
          return;
        }

        var confirmed = window.confirm(
          'Importing replaces the Music Hub data stored in this browser ('
            + extracted.keys.join(', ')
            + ').\n\nThis cannot be undone. Continue?',
        );
        if (!confirmed) {
          resolve(false);
          return;
        }

        var failed = extracted.keys.filter(function (key) {
          return !write(key, extracted.data[key]);
        });
        if (failed.length) {
          // No reload then, or the notice about it would be gone at once.
          reject(new Error('This browser couldn’t save ' + failed.join(', ') + '.'));
          return;
        }
        resolve(true);
      };
      reader.readAsText(file);
    });
  }

  MusicHub.storage = {
    APP_DATA_KEYS: APP_DATA_KEYS,
    read: read,
    write: write,
    remove: remove,
    onChange: onChange,
    getSetting: getSetting,
    setSetting: setSetting,
    collectAppData: collectAppData,
    clearAppData: clearAppData,
    exportData: exportData,
    importDataFromFile: importDataFromFile,
  };
})(window.MusicHub);
