/*
 * Settings: the Google login state, the Setlists page's default playlist,
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
          window.alert('Import failed: ' + err.message);
        })
        .then(function () {
          // Allow picking the same file again.
          fileInput.value = '';
        });
    });

    clearButton.addEventListener('click', function () {
      MusicHub.confirmDialog.open({
        title: 'Clear all saved data?',
        text: 'Every page\u2019s saved data is removed from this browser: the concert list, '
          + 'the artist graph, your concert history, the Discogs releases and these settings. '
          + 'Your Spotify and Google logins stay. Export your data first if you want to keep '
          + 'a copy. This cannot be undone.',
        action: 'Clear all data',
      }).then(function (confirmed) {
        if (confirmed) {
          MusicHub.storage.clearAppData();
          // Same as after an import: every control re-reads the now empty store.
          window.location.reload();
        }
      });
    });
  }

  function renderGoogleState() {
    var connected = MusicHub.google.isConnected();
    document.getElementById('google-status').classList.toggle('settings-account__status--on', connected);
    document.getElementById('google-status-text').textContent = connected ? 'Logged in' : 'Not logged in';
    document.getElementById('google-login').hidden = connected;
    document.getElementById('google-logout').hidden = !connected;
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

  var DEFAULT_PLAYLIST_SETTING = 'setlistDefaultPlaylist';
  var SAVED_MESSAGE_MS = 3000;

  function initDefaultPlaylist() {
    var root = document.getElementById('default-playlist-picker');
    var message = document.getElementById('default-playlist-message');
    var clearButton = document.getElementById('default-playlist-clear');
    var saved = document.getElementById('default-playlist-saved');
    var savedTimer = null;

    function confirmSaved(text) {
      saved.textContent = text;
      saved.hidden = false;
      window.clearTimeout(savedTimer);
      savedTimer = window.setTimeout(function () {
        saved.hidden = true;
      }, SAVED_MESSAGE_MS);
    }

    function showMessage(text) {
      message.textContent = text;
      message.hidden = !text;
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

    showMessage('Loading your playlists…');
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
    var savedTimer = null;

    function confirmSaved(text) {
      error.hidden = true;
      saved.textContent = text;
      saved.hidden = false;
      window.clearTimeout(savedTimer);
      savedTimer = window.setTimeout(function () {
        saved.hidden = true;
      }, SAVED_MESSAGE_MS);
    }

    var current = MusicHub.storage.getSetting(DISCOGS_USERNAME_SETTING, null);
    input.value = current || '';
    clearButton.hidden = !current;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var username = parseDiscogsUsername(input.value);
      if (!username) {
        saved.hidden = true;
        error.textContent = input.value.trim()
          ? 'That doesn’t look like a Discogs username.'
          : 'Enter your Discogs username first.';
        error.hidden = false;
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

  document.addEventListener('DOMContentLoaded', function () {
    initGoogleControls();
    initDefaultPlaylist();
    initDiscogsUsername();
    initDataControls();
  });
})(window.MusicHub);
