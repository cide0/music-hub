/*
 * Settings: the sound switches, the Google login state, the Google Drive sync, the Gallery's
 * Drive folder, the Setlists page's default playlist,
 * the Discogs username, and the Export / Import / Clear data controls. Every choice made here is saved
 * through MusicHub.storage.setSetting, so it travels with Export / Import.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  function initDataControls() {
    var exportButton = document.getElementById('export-data');
    var importButton = document.getElementById('import-data');
    var fileInput = document.getElementById('import-file');
    var clearButton = document.getElementById('clear-all-data');

    exportButton.addEventListener('click', function () {
      MusicHub.storage.exportData();
    });

    importButton.addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }
      MusicHub.storage
        .importDataFromFile(file)
        .then(function (imported) {
          if (imported) {
            window.location.reload();
          }
        })
        .catch(function (err) {
          MusicHub.notice.flash(document.getElementById('import-error'), 'Import failed: ' + err.message);
        })
        .then(function () {
          // Allow picking the same file again.
          fileInput.value = '';
        });
    });

    clearButton.addEventListener('click', function () {
      MusicHub.confirmDialog.open({
        title: 'Clear all saved data?',
        text: 'All of Music Hub\u2019s saved data is removed from this browser: the concert list, '
          + 'the artist graph, your concert history, the Discogs releases, your album history, '
          + 'these settings - and your coins, bought Store items, vinyl collection and Wheel of Fortune '
          + 'too. Only your Spotify and Google logins stay. '
          + (MusicHub.sync.status().enabled
            ? 'Google Drive sync is on, so it\u2019s also deleted from your Google Drive and '
              + 'removed from your other synced devices. '
            : '')
          + 'Export your data first if you want to keep a copy. This cannot be undone.',
        action: 'Clear all data',
      }).then(function (confirmed) {
        if (!confirmed) {
          return;
        }
        clearButton.disabled = true;
        // Deleting the Drive copy has to finish before the reload cuts it
        // off (if it fails, the next sync retries it).
        MusicHub.sync.clearAll().then(function () {
          // Same as after an import: every control re-reads the now empty store.
          window.location.reload();
        });
      });
    });
  }

  function renderGoogleState() {
    var connected = MusicHub.google.isConnected();
    document.getElementById('google-status').classList.toggle('settings-account__status--on', connected);
    var text = 'Not logged in';
    if (connected) {
      // A login from before a permission was added, or one with it unticked.
      var missing = [];
      if (!MusicHub.google.hasDriveAccess()) {
        missing.push('Google Drive sync');
      }
      if (!MusicHub.google.hasFolderAccess()) {
        missing.push('your Gallery folder');
      }
      text = missing.length
        ? 'Logged in without access to ' + missing.join(' and ') + ' - log out and in again to allow it'
        : 'Logged in';
    }
    document.getElementById('google-status-text').textContent = text;
    document.getElementById('google-login').hidden = connected;
    document.getElementById('google-logout').hidden = !connected;
    renderSyncState();
  }

  function initGoogleControls() {
    document.getElementById('google-login').addEventListener('click', function () {
      // Comes back to this page once Google is done.
      MusicHub.google.connect();
    });
    document.getElementById('google-logout').addEventListener('click', function () {
      MusicHub.google.disconnect();
      renderGoogleState();
    });

    // Logging in or out in another tab shows up here too.
    window.addEventListener('storage', function (event) {
      if (event.key === null || event.key === 'googleAuth') {
        renderGoogleState();
      }
    });

    renderGoogleState();
  }

  /* ------------------------------------------------------ drive sync */

  function formatSyncTime(ms) {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms));
  }

  function syncStatusText(sync) {
    if (!sync.available) {
      return 'Off - not available in local development';
    }
    if (sync.running) {
      return 'Syncing\u2026';
    }
    if (!sync.enabled) {
      if (!sync.hasDriveAccess) {
        return sync.turnedOff ? 'Off - log in to Google first' : 'Off - turns on when you log in to Google';
      }
      return 'Off';
    }
    if (!sync.hasDriveAccess) {
      return 'Paused - log in to Google to go on';
    }
    if (sync.pending) {
      return 'On - ' + sync.pending + (sync.pending === 1 ? ' change' : ' changes') + ' waiting to upload';
    }
    return sync.lastSyncAt ? 'On - last synced ' + formatSyncTime(sync.lastSyncAt) : 'On';
  }

  function renderSyncState() {
    var statusEl = document.getElementById('sync-status');
    if (!statusEl) {
      return;
    }
    var sync = MusicHub.sync.status();
    var active = sync.available && sync.enabled && sync.hasDriveAccess;

    statusEl.classList.toggle('settings-account__status--on', active);
    document.getElementById('sync-status-text').textContent = syncStatusText(sync);

    var enableButton = document.getElementById('sync-enable');
    enableButton.hidden = !sync.available || sync.enabled;
    enableButton.disabled = !sync.hasDriveAccess || sync.running;
    document.getElementById('sync-now').hidden = !active;
    document.getElementById('sync-now').disabled = sync.running;
    document.getElementById('sync-disable').hidden = !sync.available || !sync.enabled;

    // Fades out on its own (notice.js), once for each new error.
    var error = document.getElementById('sync-error');
    var text = sync.available && sync.enabled && sync.lastError
      ? 'The last sync failed: ' + sync.lastError
      : '';
    if (text !== (error.dataset.shown || '')) {
      if (text) {
        MusicHub.notice.flash(error, text);
      } else {
        MusicHub.notice.hide(error);
      }
    }
    error.dataset.shown = text;
  }

  function initSyncControls() {
    document.getElementById('sync-enable').addEventListener('click', function () {
      MusicHub.sync.turnOn().catch(function (err) {
        MusicHub.notice.flash(document.getElementById('sync-error'), 'Couldn\u2019t turn on sync: ' + err.message);
      });
    });

    document.getElementById('sync-now').addEventListener('click', function () {
      MusicHub.sync.syncNow().then(function (result) {
        if (result && result.downloaded.length) {
          // Every control re-reads what was just downloaded.
          window.location.reload();
        }
      });
    });

    document.getElementById('sync-disable').addEventListener('click', function () {
      MusicHub.sync.disable();
    });

    document.addEventListener(MusicHub.sync.CHANGE_EVENT, renderSyncState);
    // Turned on or off in another tab.
    window.addEventListener('storage', function (event) {
      if (event.key === null || event.key === 'syncState') {
        renderSyncState();
      }
    });

    renderSyncState();
  }

  var DEFAULT_PLAYLIST_SETTING = 'setlistDefaultPlaylist';

  /* --------------------------------------------------- gallery folder */

  // The Drive folder the Gallery fills itself from (concert-history.js).
  var GALLERY_FOLDER_SETTING = 'galleryDriveFolderId';

  /**
   * A Drive folder id from what was pasted: a folder link
   * (drive.google.com/drive/folders/<id>, also with /u/0/), an "?id=" link,
   * or the bare id. Null when it's none of these.
   */
  function parseDriveFolderId(value) {
    var text = String(value || '').trim();
    var match = text.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || text.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (match) {
      return match[1];
    }
    return /^[A-Za-z0-9_-]{10,}$/.test(text) ? text : null;
  }

  function initGalleryFolder() {
    var form = document.getElementById('gallery-folder-form');
    var input = document.getElementById('gallery-folder');
    var clearButton = document.getElementById('gallery-folder-clear');
    var error = document.getElementById('gallery-folder-error');
    var saved = document.getElementById('gallery-folder-saved');

    function confirmSaved(text) {
      MusicHub.notice.hide(error);
      MusicHub.notice.flash(saved, text);
    }

    var current = MusicHub.storage.getSetting(GALLERY_FOLDER_SETTING, null);
    input.value = current ? 'https://drive.google.com/drive/folders/' + current : '';
    clearButton.hidden = !current;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var folderId = parseDriveFolderId(input.value);
      if (!folderId) {
        MusicHub.notice.hide(saved);
        MusicHub.notice.flash(error, input.value.trim()
          ? 'That doesn\u2019t look like a Google Drive folder link.'
          : 'Paste the link of a Google Drive folder first.');
        return;
      }
      MusicHub.storage.setSetting(GALLERY_FOLDER_SETTING, folderId);
      input.value = 'https://drive.google.com/drive/folders/' + folderId;
      clearButton.hidden = false;
      confirmSaved('Saved \u2014 the Gallery uses this folder.');
    });

    clearButton.addEventListener('click', function () {
      MusicHub.storage.setSetting(GALLERY_FOLDER_SETTING, null);
      input.value = '';
      clearButton.hidden = true;
      confirmSaved('Saved \u2014 the Gallery uses the \u201cConcerts\u201d folder at the top of your My Drive.');
    });
  }

  function initDefaultPlaylist() {
    var root = document.getElementById('default-playlist-picker');
    var message = document.getElementById('default-playlist-message');
    var clearButton = document.getElementById('default-playlist-clear');
    var saved = document.getElementById('default-playlist-saved');
    function confirmSaved(text) {
      MusicHub.notice.flash(saved, text);
    }

    // Fades out on its own (notice.js); "Loading…" (`stay`) until replaced.
    function showMessage(text, stay) {
      if (!text) {
        MusicHub.notice.hide(message);
      } else {
        MusicHub.notice[stay ? 'hold' : 'flash'](message, text);
      }
    }

    // Stored as { id, name }: the name lets the page say which playlist it
    // was if it has since gone missing.
    var picker = MusicHub.playlistPicker.create(root, {
      onChange: function (playlist) {
        MusicHub.storage.setSetting(DEFAULT_PLAYLIST_SETTING, { id: playlist.id, name: playlist.name });
        showMessage('');
        clearButton.hidden = false;
        confirmSaved('Saved — “' + playlist.name + '” is now the default.');
      },
    });

    clearButton.addEventListener('click', function () {
      MusicHub.storage.setSetting(DEFAULT_PLAYLIST_SETTING, null);
      picker.clear();
      showMessage('');
      clearButton.hidden = true;
      confirmSaved('Saved — no default playlist.');
    });

    if (!MusicHub.auth.isLoggedIn()) {
      return;
    }

    showMessage('Loading your playlists…', true);
    MusicHub.spotify.getEditablePlaylists().then(function (playlists) {
      if (!playlists.length) {
        showMessage('You don’t have any editable playlists yet — create one in Spotify first');
        return;
      }
      showMessage('');
      picker.setPlaylists(playlists);
      root.hidden = false;

      var current = MusicHub.storage.getSetting(DEFAULT_PLAYLIST_SETTING, null);
      if (!current || !current.id) {
        return;
      }
      clearButton.hidden = false;
      if (!picker.select(current.id)) {
        showMessage('Your default playlist “' + current.name + '” isn’t available any more '
          + '(deleted, or no longer yours to edit). Choose another one.');
      }
    }).catch(function (err) {
      console.warn('Could not load playlists', err);
      showMessage('Could not load your Spotify playlists.');
    });
  }

  var DISCOGS_USERNAME_SETTING = 'discogsUsername';

  /**
   * The username typed in, or taken from a pasted profile / collection link
   * ("https://www.discogs.com/user/name/collection"). Null if it can't be one.
   */
  function parseDiscogsUsername(value) {
    var text = String(value || '').trim();
    var fromUrl = /discogs\.com\/(?:[a-z]{2}\/)?user\/([^/?#\s]+)/i.exec(text);
    if (fromUrl) {
      try {
        text = decodeURIComponent(fromUrl[1]);
      } catch (err) {
        return null;
      }
    }
    return text && !/[\s/?#]/.test(text) ? text : null;
  }

  function initDiscogsUsername() {
    var form = document.getElementById('discogs-username-form');
    var input = document.getElementById('discogs-username');
    var clearButton = document.getElementById('discogs-username-clear');
    var error = document.getElementById('discogs-username-error');
    var saved = document.getElementById('discogs-username-saved');

    function confirmSaved(text) {
      MusicHub.notice.hide(error);
      MusicHub.notice.flash(saved, text);
    }

    var current = MusicHub.storage.getSetting(DISCOGS_USERNAME_SETTING, null);
    input.value = current || '';
    clearButton.hidden = !current;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var username = parseDiscogsUsername(input.value);
      if (!username) {
        MusicHub.notice.hide(saved);
        MusicHub.notice.flash(error, input.value.trim()
          ? 'That doesn’t look like a Discogs username.'
          : 'Enter your Discogs username first.');
        return;
      }
      MusicHub.storage.setSetting(DISCOGS_USERNAME_SETTING, username);
      input.value = username;
      clearButton.hidden = false;
      confirmSaved('Saved — using the Discogs collection of “' + username + '”.');
    });

    clearButton.addEventListener('click', function () {
      MusicHub.storage.setSetting(DISCOGS_USERNAME_SETTING, null);
      input.value = '';
      clearButton.hidden = true;
      confirmSaved('Saved — no Discogs username.');
    });
  }

  // Read by wallet.js (every sound) and collection.js (the listening coins).
  var SOUND_SETTING = 'soundEffects';
  var LISTEN_COIN_SOUND_SETTING = 'listenCoinSound';

  /**
   * The Sounds switches, both on unless turned off. With every sound off,
   * the listening coins' switch is greyed out but keeps its own choice.
   */
  function initSoundSwitches() {
    var sound = document.getElementById('sound-effects');
    var listenCoins = document.getElementById('listen-coin-sound');

    function render() {
      listenCoins.disabled = !sound.checked;
    }

    sound.checked = MusicHub.storage.getSetting(SOUND_SETTING, true) !== false;
    listenCoins.checked = MusicHub.storage.getSetting(LISTEN_COIN_SOUND_SETTING, true) !== false;
    render();

    // Only "off" is stored; on is the default.
    sound.addEventListener('change', function () {
      MusicHub.storage.setSetting(SOUND_SETTING, sound.checked ? null : false);
      render();
    });
    listenCoins.addEventListener('change', function () {
      MusicHub.storage.setSetting(LISTEN_COIN_SOUND_SETTING, listenCoins.checked ? null : false);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initSoundSwitches();
    initGoogleControls();
    initSyncControls();
    initGalleryFolder();
    initDefaultPlaylist();
    initDiscogsUsername();
    initDataControls();
  });
})(window.MusicHub);
