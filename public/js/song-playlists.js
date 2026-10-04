/*
 * Which playlists a song was put on from the Collection's record player -
 * remembered here only while its album is on the turntable: going back to
 * the collection forgets it all (forget()), and nothing is stored. "Liked
 * Songs" counts as one more playlist (id LIKED_ID), saved through Spotify's
 * library instead.
 *
 * The player's + adds the playing song to the playlists chosen in
 * Settings (the `collectionPlaylists` setting) and the song turns into a
 * heart; its playlist modal adds it to more, or takes it off again.
 *
 * A chosen playlist can be a rotation playlist (its entry's `rotation`: the
 * most songs it keeps). Adding to a full one - from the + or the modal -
 * takes the songs that have been on it longest off again, so it stays at
 * that size; the only time the app reads a playlist's songs from Spotify.
 * Liked Songs never rotates.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var SETTING = 'collectionPlaylists';
  var LIKED_ID = 'liked';
  var LIKED = { id: LIKED_ID, name: 'Liked Songs', imageUrl: null, trackCount: null, liked: true };
  // A rotation playlist's limit: Spotify's own cap on a playlist's size.
  var MAX_ROTATION = 10000;
  // How many songs one DELETE /playlists/{id}/items may take off.
  var REMOVE_BATCH = 100;

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

  /** The playlists chosen in Settings for the + : [{ id, name, rotation? }]. */
  function chosenEntries() {
    var chosen = MusicHub.storage.getSetting(SETTING, null);
    return Array.isArray(chosen) ? chosen : [];
  }

  /** The ids chosen in Settings for the + ; stored as { id, name } so a missing one can be named. */
  function defaultIds() {
    return chosenEntries().map(function (entry) { return entry.id; });
  }

  /** A limit as Settings may store it: a whole number from 1 to MAX_ROTATION, else null. */
  function validRotation(value) {
    var limit = Number(value);
    return Math.floor(limit) === limit && limit >= 1 && limit <= MAX_ROTATION ? limit : null;
  }

  /** The most songs a playlist keeps, when it's a rotation playlist; null otherwise. */
  function rotationOf(id) {
    if (id === LIKED_ID) {
      return null;
    }
    var entry = chosenEntries().filter(function (chosen) { return chosen.id === id; })[0];
    return entry ? validRotation(entry.rotation) : null;
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

  function postItem(uri, id) {
    return request('/playlists/' + encodeURIComponent(id) + '/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    }, 'add the song');
  }

  /** Takes songs off a playlist - every copy of each URI, as Spotify does. */
  function deleteItems(uris, id) {
    return request('/playlists/' + encodeURIComponent(id) + '/items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: uris.map(function (uri) { return { uri: uri }; }) }),
    }, uris.length === 1 ? 'remove the song' : 'remove the songs');
  }

  /** A playlist's songs as { uri, addedAt, position }, following Spotify's pages. */
  function fetchItems(id) {
    var items = [];

    function fetchPage(path) {
      return MusicHub.spotify.getJson(path, 'playlist\u2019s songs').then(function (data) {
        (data.items || []).forEach(function (entry) {
          // `item` since Spotify's Feb 2026 changes, `track` before them.
          var song = entry && (entry.item || entry.track);
          if (song && song.uri) {
            items.push({ uri: song.uri, addedAt: Date.parse(entry.added_at) || 0, position: items.length });
          }
        });
        return data.next ? fetchPage(data.next) : items;
      });
    }

    return fetchPage('/playlists/' + encodeURIComponent(id) + '/items?limit=50');
  }

  /**
   * The songs to take off a rotation playlist of `limit` songs holding
   * `items`, once `uri` is on it too: the longest on it first (a song with
   * no date counts as oldest; then the playlist's order), until it's back
   * at the limit. Spotify takes every copy of a URI off at once, so a song
   * on it twice counts twice. The song being added is never picked - taking
   * an older copy of it off would take the new one with it.
   */
  function rotationVictims(items, uri, limit) {
    var excess = items.length + 1 - limit;
    var copies = {};
    items.forEach(function (item) {
      copies[item.uri] = (copies[item.uri] || 0) + 1;
    });
    var victims = [];
    items.slice().sort(function (a, b) {
      return (a.addedAt - b.addedAt) || (a.position - b.position);
    }).forEach(function (item) {
      if (excess > 0 && item.uri !== uri && victims.indexOf(item.uri) === -1) {
        victims.push(item.uri);
        excess -= copies[item.uri];
      }
    });
    return victims;
  }

  /** The victims off the playlist, REMOVE_BATCH at a time; resolves with how many songs went. */
  function removeVictims(victims, items, id) {
    var chain = Promise.resolve();
    for (var start = 0; start < victims.length; start += REMOVE_BATCH) {
      (function (batch) {
        chain = chain.then(function () {
          return deleteItems(batch, id);
        });
      })(victims.slice(start, start + REMOVE_BATCH));
    }
    return chain.then(function () {
      return items.filter(function (item) {
        return victims.indexOf(item.uri) !== -1;
      }).length;
    });
  }

  /**
   * Adds the song; on a rotation playlist, then takes the oldest songs off
   * (rotationVictims). The songs are read before the add, so the count
   * doesn't hang on Spotify having caught up with it; reading them failing
   * fails the add, so a rotation playlist never grows past its limit. The
   * song is on once the add goes through - a removal that fails after it
   * is only logged, and the next add catches up. Resolves with the URIs
   * taken off and how many songs that was.
   */
  function addOne(uri, id) {
    if (id === LIKED_ID) {
      // PUT /me/tracks is gone since Feb 2026; /me/library replaces it.
      return request('/me/library?uris=' + encodeURIComponent(uri), { method: 'PUT' }, 'like the song').then(function () {
        return { removed: [], removedCount: 0 };
      });
    }
    var limit = rotationOf(id);
    if (!limit) {
      return postItem(uri, id).then(function () {
        return { removed: [], removedCount: 0 };
      });
    }
    return fetchItems(id).then(function (items) {
      return postItem(uri, id).then(function () {
        var victims = rotationVictims(items, uri, limit);
        return removeVictims(victims, items, id).then(function (count) {
          return { removed: victims, removedCount: count };
        }, function (err) {
          console.warn('Could not take the oldest songs off the rotation playlist ' + id, err);
          return { removed: [], removedCount: 0 };
        });
      });
    });
  }

  function removeOne(uri, id) {
    if (id === LIKED_ID) {
      return request('/me/library?uris=' + encodeURIComponent(uri), { method: 'DELETE' }, 'unlike the song');
    }
    return deleteItems([uri], id);
  }

  /**
   * Puts the song on the `add` playlists and takes it off the `remove`
   * ones, one request after the other. Each one that goes through is
   * remembered straight away, so a failure halfway loses nothing - as is
   * a song a rotation playlist pushed out. Resolves with { failed: [ids],
   * error } - the error of the first that failed.
   */
  function change(uri, add, remove) {
    var failed = [];
    var firstError = null;
    var chain = Promise.resolve();

    function step(id, adding) {
      chain = chain.then(function () {
        return (adding ? addOne : removeOne)(uri, id).then(function (rotated) {
          var removed = (rotated && rotated.removed) || [];
          removed.forEach(function (gone) {
            remember(gone, playlistsOf(gone).filter(function (known) {
              return known !== id;
            }));
          });
          var ids = playlistsOf(uri).filter(function (known) {
            return known !== id;
          });
          remember(uri, adding ? ids.concat(id) : ids);
          if (id !== LIKED_ID) {
            MusicHub.playlists.adjustTrackCount(id, adding ? 1 - ((rotated && rotated.removedCount) || 0) : -1);
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
    MAX_ROTATION: MAX_ROTATION,
    validRotation: validRotation,
    rotationOf: rotationOf,
    choices: choices,
    defaultIds: defaultIds,
    playlistsOf: playlistsOf,
    isSaved: isSaved,
    change: change,
    addToDefaults: addToDefaults,
    forget: forget,
  };
})(window.MusicHub);
