/*
 * The user's Spotify playlists they can add to (their own and collaborative
 * ones), fetched in exactly one place: the refresh button in Settings'
 * "Spotify playlists" section. The list is kept in localStorage and every
 * page that needs it (Settings' default playlist, Setlists) reads it from
 * here - none of them asks Spotify itself.
 *
 * Pages that show the list can listen for 'musichub:playlistschange' on
 * document; it fires after a refresh here and when another tab stores a
 * new list.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STORAGE_KEY = 'spotifyPlaylists';
  var CHANGE_EVENT = 'musichub:playlistschange';
  // What a page says when it needs the list and it was never fetched.
  var MISSING_MESSAGE = 'Fetch your playlists first, with the refresh button in Settings.';

  // The refresh underway, so a second press joins it rather than starting another.
  var refreshing = null;

  /* ------------------------------------------------------------ storage */

  function load() {
    var stored = MusicHub.storage.read(STORAGE_KEY, null);
    return stored && Array.isArray(stored.playlists) ? stored : null;
  }

  /** The stored playlists ({ id, name, imageUrl, trackCount }), or null before the first fetch. */
  function list() {
    var stored = load();
    return stored ? stored.playlists : null;
  }

  function fetchedAt() {
    var stored = load();
    return stored ? stored.fetchedAt : null;
  }

  function isRefreshing() {
    return !!refreshing;
  }

  /**
   * Songs were just added to (or, with a negative `count`, removed from) a
   * playlist: its stored song count follows, so the lists stay right
   * without asking Spotify again.
   */
  function adjustTrackCount(playlistId, count) {
    var stored = load();
    if (!stored) {
      return;
    }
    var changed = false;
    stored.playlists.forEach(function (playlist) {
      if (playlist.id === playlistId && typeof playlist.trackCount === 'number') {
        playlist.trackCount = Math.max(0, playlist.trackCount + count);
        changed = true;
      }
    });
    if (changed) {
      MusicHub.storage.write(STORAGE_KEY, stored);
      announce();
    }
  }

  /* ------------------------------------------------------------ spotify */

  function getUserId() {
    var profile = MusicHub.storage.read('spotifyProfile', null);
    if (profile && profile.id) {
      return Promise.resolve(profile.id);
    }
    return MusicHub.spotify.getJson('/me', 'Spotify profile').then(function (me) {
      return me.id;
    });
  }

  /** Every playlist the user can add to, following Spotify's pages until they run out. */
  function fetchAll() {
    return getUserId().then(function (userId) {
      var editable = [];

      function fetchPage(path) {
        return MusicHub.spotify.getJson(path, 'playlists').then(function (data) {
          (data.items || []).forEach(function (playlist) {
            if (playlist && (playlist.collaborative || (playlist.owner && playlist.owner.id === userId))) {
              var images = playlist.images || [];
              var tracks = playlist.tracks || playlist.items || {};
              editable.push({
                id: playlist.id,
                name: playlist.name,
                // Largest first; the dropdown only needs a thumbnail.
                imageUrl: images.length ? images[images.length - 1].url : null,
                trackCount: typeof tracks.total === 'number' ? tracks.total : null,
              });
            }
          });
          return data.next ? fetchPage(data.next) : editable;
        });
      }

      return fetchPage('/me/playlists?limit=50');
    });
  }

  function announce() {
    document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { playlists: list() } }));
  }

  /** Fetches the list from Spotify and stores it. Resolves with the playlists. */
  function refresh() {
    if (refreshing) {
      return refreshing;
    }
    refreshing = fetchAll().then(function (playlists) {
      MusicHub.storage.write(STORAGE_KEY, { fetchedAt: new Date().toISOString(), playlists: playlists });
      refreshing = null;
      announce();
      return playlists;
    }, function (err) {
      refreshing = null;
      throw err;
    });
    return refreshing;
  }

  // Another tab fetched (or Settings imported) a new list.
  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY || event.key === null) {
      announce();
    }
  });

  MusicHub.playlists = {
    STORAGE_KEY: STORAGE_KEY,
    CHANGE_EVENT: CHANGE_EVENT,
    MISSING_MESSAGE: MISSING_MESSAGE,
    list: list,
    fetchedAt: fetchedAt,
    isRefreshing: isRefreshing,
    refresh: refresh,
    adjustTrackCount: adjustTrackCount,
  };
})(window.MusicHub);
