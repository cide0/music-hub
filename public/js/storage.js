/*
 * localStorage access for Music Hub, plus the navbar's Export / Import data
 * feature. There is no database - this file is the whole persistence layer.
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
  ];

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

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('Could not write "' + key + '" to localStorage', err);
      return false;
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn('Could not remove "' + key + '" from localStorage', err);
    }
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

        extracted.keys.forEach(function (key) {
          write(key, extracted.data[key]);
        });
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
    collectAppData: collectAppData,
    exportData: exportData,
    importDataFromFile: importDataFromFile,
  };
})(window.MusicHub);
