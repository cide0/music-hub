/*
 * Which playlists a song was put on from the Collection's record player -
 * remembered here only while its album is on the turntable: going back to
 * the collection forgets it all (forget()), and nothing is stored. The app
 * never reads a playlist's songs back from Spotify. "Liked Songs" counts as
 * one more playlist (id LIKED_ID), saved through Spotify's library instead.
 *
 * The player's + adds the playing song to the playlists chosen in
 * Settings (the `collectionPlaylists` setting) and the song turns into a
 * heart; its playlist modal adds it to more, or takes it off again.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var SETTING = 'collectionPlaylists';
  var LIKED_ID = 'liked';
  var LIKED = { id: LIKED_ID, name: 'Liked Songs', imageUrl: null, trackCount: null, liked: true };

  /* ------------------------------------------------------------- memory */

  // Song URI -> the playlist ids it went on, for the album playing now.
  var memory = {};

  /** The playlist ids a song (its Spotify URI) is on, as far as the app knows. */
  function playlistsOf(uri) {
    var ids = memory[uri];
    return Array.isArray(ids) ? ids.slice() : [];
  }

  function isSaved(uri) {
    return playlistsOf(uri).length > 0;
  }

  function remember(uri, ids) {
    if (ids.length) {
      memory[uri] = ids;
    } else {
      delete memory[uri];
    }
  }

  /** The album is off the turntable: every song is a + again. */
  function forget() {
    memory = {};
  }

  /** Every playlist a song can go on: Liked Songs first, then the stored list (playlists.js). */
  function choices() {
    return [LIKED].concat(MusicHub.playlists.list() || []);
  }

  /** The ids chosen in Settings for the + ; stored as { id, name } so a missing one can be named. */
  function defaultIds() {
    var chosen = MusicHub.storage.getSetting(SETTING, null);
    return Array.isArray(chosen) ? chosen.map(function (entry) { return entry.id; }) : [];
  }

  /* ------------------------------------------------------------ spotify */

  function failure(response, what) {
    return response.json().catch(function () {
      return null;
    }).then(function (body) {
      var reason = body && body.error && body.error.message;
      var err = new Error('Spotify refused to ' + what + ' (' + response.status + (reason ? ': ' + reason : '') + ')');
      err.status = response.status;
      throw err;
    });
  }

  function request(path, options, what) {
    return MusicHub.auth.spotifyFetch(path, options).then(function (response) {
      return response.ok ? null : failure(response, what);
    });
  }

  function addOne(uri, id) {
    if (id === LIKED_ID) {
      // PUT /me/tracks is gone since Feb 2026; /me/library replaces it.
      return request('/me/library?uris=' + encodeURIComponent(uri), { method: 'PUT' }, 'like the song');
    }
    return request('/playlists/' + encodeURIComponent(id) + '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    }, 'add the song');
  }

  function removeOne(uri, id) {
    if (id === LIKED_ID) {
      return request('/me/library?uris=' + encodeURIComponent(uri), { method: 'DELETE' }, 'unlike the song');
    }
    return request('/playlists/' + encodeURIComponent(id) + '/items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ uri: uri }] }),
    }, 'remove the song');
  }

  /**
   * Puts the song on the `add` playlists and takes it off the `remove`
   * ones, one request after the other. Each one that goes through is
   * remembered straight away, so a failure halfway loses nothing; resolves
   * with { failed: [ids], error } - the error of the first that failed.
   */
  function change(uri, add, remove) {
    var failed = [];
    var firstError = null;
    var chain = Promise.resolve();

    function step(id, adding) {
      chain = chain.then(function () {
        return (adding ? addOne : removeOne)(uri, id).then(function () {
          var ids = playlistsOf(uri).filter(function (known) {
            return known !== id;
          });
          remember(uri, adding ? ids.concat(id) : ids);
          if (id !== LIKED_ID) {
            MusicHub.playlists.adjustTrackCount(id, adding ? 1 : -1);
          }
        }, function (err) {
          console.warn('Could not ' + (adding ? 'add the song to' : 'remove the song from') + ' ' + id, err);
          failed.push(id);
          firstError = firstError || err;
        });
      });
    }

    add.forEach(function (id) {
      step(id, true);
    });
    remove.forEach(function (id) {
      step(id, false);
    });
    return chain.then(function () {
      return { failed: failed, error: firstError };
    });
  }

  /** The + : the song onto every playlist chosen in Settings it isn't on yet. */
  function addToDefaults(uri) {
    var known = playlistsOf(uri);
    var add = defaultIds().filter(function (id) {
      return known.indexOf(id) === -1;
    });
    return change(uri, add, []).then(function (result) {
      result.added = add.length - result.failed.length;
      return result;
    });
  }

  MusicHub.songPlaylists = {
    SETTING: SETTING,
    LIKED_ID: LIKED_ID,
    choices: choices,
    defaultIds: defaultIds,
    playlistsOf: playlistsOf,
    isSaved: isSaved,
    change: change,
    addToDefaults: addToDefaults,
    forget: forget,
  };
})(window.MusicHub);
