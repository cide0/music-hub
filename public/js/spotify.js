/*
 * Small shared Spotify Web API helpers used by more than one page.
 * Token handling itself lives in auth.js.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  /*
   * A call to Spotify that fails is tried again - up to RETRY_DELAYS_MS
   * more times, after those waits (or as long as Spotify asks, when it
   * says it's too busy). Only failures that might go away are: no answer
   * at all, a busy or broken Spotify (429, 5xx), or no device yet. One
   * Spotify turned down for good - no Premium, no permission, any other
   * 4xx - fails straight away.
   */
  var RETRY_DELAYS_MS = [500, 1500];
  var MAX_RETRY_AFTER_MS = 5000;

  function worthRetrying(err) {
    if (err.code === 'premium' || err.code === 'permission') {
      return false;
    }
    return !err.status || err.status === 429 || err.status >= 500 || err.code === 'no-device';
  }

  function retrying(operation) {
    function attempt(retry) {
      return operation().catch(function (err) {
        if (retry >= RETRY_DELAYS_MS.length || !worthRetrying(err)) {
          throw err;
        }
        return wait(Math.min(err.retryAfterMs || RETRY_DELAYS_MS[retry], MAX_RETRY_AFTER_MS)).then(function () {
          return attempt(retry + 1);
        });
      });
    }
    return attempt(0);
  }

  function spotifyJson(path, what) {
    return retrying(function () {
      return MusicHub.auth.spotifyFetch(path).then(function (response) {
        if (!response.ok) {
          var err = new Error('Could not load your ' + what + ' (' + response.status + ')');
          err.status = response.status;
          throw err;
        }
        return response.json();
      });
    });
  }

  function getUserId() {
    var profile = MusicHub.storage.read('spotifyProfile', null);
    if (profile && profile.id) {
      return Promise.resolve(profile.id);
    }
    return spotifyJson('/me', 'Spotify profile').then(function (me) {
      return me.id;
    });
  }

  /**
   * Only the playlists the user can add to: their own and collaborative
   * ones, as { id, name, imageUrl, trackCount }.
   */
  function getEditablePlaylists() {
    return getUserId().then(function (userId) {
      var editable = [];

      function fetchPage(path) {
        return spotifyJson(path, 'playlists').then(function (data) {
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

  /* ------------------------------------------------------------ playback */

  /*
   * Starting an album on the user's Spotify. The Web API only allows it
   * for Premium accounts, with the playback permissions (a login from
   * before the app asked for them doesn't have them), and with a device -
   * a running Spotify app - to play on. Failures are Errors with a `code`
   * saying which: 'premium', 'permission', 'no-device' or 'failed'.
   */

  // An app just launched takes a while to start and register as a device
  // - longer from cold.
  var DEVICE_WAIT_MS = 30000;
  var DEVICE_POLL_MS = 1000;

  function playbackError(code, message, status, retryAfterMs) {
    var err = new Error(message);
    err.code = code;
    err.status = status;
    err.retryAfterMs = retryAfterMs;
    return err;
  }

  function readPlaybackError(response) {
    return response.json().catch(function () {
      return {};
    }).then(function (body) {
      var error = (body && body.error) || {};
      var message = String(error.message || '');
      if (error.reason === 'PREMIUM_REQUIRED') {
        return playbackError('premium', 'Spotify only lets Premium accounts start playback from other apps.');
      }
      if (response.status === 401 || /scope|permission/i.test(message)) {
        return playbackError('permission', 'Music Hub isn\u2019t allowed to play music on your Spotify yet.');
      }
      if (response.status === 404 || error.reason === 'NO_ACTIVE_DEVICE') {
        return playbackError('no-device', 'There\u2019s no Spotify app to play on.');
      }
      // Too busy: Spotify says how many seconds to wait.
      var retryAfterS = parseFloat(response.headers.get('Retry-After'));
      return playbackError('failed', 'Spotify answered ' + response.status + (message ? ': ' + message : '') + '.',
        response.status, isNaN(retryAfterS) ? undefined : retryAfterS * 1000);
    });
  }

  function throwUnlessOk(response) {
    if (response.ok) {
      return response;
    }
    return readPlaybackError(response).then(function (err) {
      throw err;
    });
  }

  /** A call to the user's player, tried again if it fails (retrying). */
  function playerRequest(path, options) {
    return retrying(function () {
      return MusicHub.auth.spotifyFetch(path, options).then(throwUnlessOk);
    });
  }

  /**
   * Shuffle (Smart Shuffle too) and repeat switched off on the device, so
   * an album plays in its own order and on to its end. They stay off -
   * the user turns them back on in Spotify when they want them. Resolves
   * to whether it worked; it never fails the album over it.
   */
  function playInOrder(deviceId) {
    var device = deviceId ? '&device_id=' + encodeURIComponent(deviceId) : '';
    return playerRequest('/me/player/shuffle?state=false' + device, { method: 'PUT' }).then(function () {
      return playerRequest('/me/player/repeat?state=off' + device, { method: 'PUT' });
    }).then(function () {
      return true;
    }).catch(function (err) {
      console.warn('Could not switch off shuffle and repeat on Spotify', err);
      return false;
    });
  }

  /**
   * The album from its first track, at its very start - Spotify would
   * otherwise carry on where it last left the album - in order and without
   * repeating (playInOrder): switched off first, or, on a device that
   * won't take it before it's playing (a Spotify app just opened), once
   * the album has started - its first track comes first either way.
   */
  function startAlbum(albumId, deviceId) {
    var path = '/me/player/play' + (deviceId ? '?device_id=' + encodeURIComponent(deviceId) : '');
    return playInOrder(deviceId).then(function (inOrder) {
      return playerRequest(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_uri: 'spotify:album:' + albumId, offset: { position: 0 }, position_ms: 0 }),
      }).then(function (response) {
        return inOrder ? response : playInOrder(deviceId).then(function () {
          return response;
        });
      });
    });
  }

  function getDevices() {
    return playerRequest('/me/player/devices').then(function (response) {
      return response.json();
    }).then(function (data) {
      return (data.devices || []).filter(function (device) {
        return device.id && !device.is_restricted;
      });
    });
  }

  /** The device in use, else a computer (most likely this one), else any. */
  function pickDevice(devices) {
    return devices.filter(function (device) { return device.is_active; })[0]
      || devices.filter(function (device) { return device.type === 'Computer'; })[0]
      || devices[0]
      || null;
  }

  /** Opens a spotify: URI in the Spotify app. */
  function openInApp(uri) {
    window.location.href = uri;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  /**
   * Keeps trying to start the album - on the device that turns up, this
   * computer's Spotify first - until one takes it or `deadline` passes. An
   * app still starting up may not be listed yet, or be listed but not
   * ready (a "no device" or a server error): those are tried again.
   */
  function playWhenReady(albumId, deadline) {
    return wait(DEVICE_POLL_MS).then(getDevices).then(function (devices) {
      var device = pickDevice(devices);
      if (!device) {
        throw playbackError('no-device', 'Spotify didn\u2019t open in time to play the album.');
      }
      return startAlbum(albumId, device.id);
    }).catch(function (err) {
      var notReady = err.code === 'no-device' || (err.status && err.status >= 500);
      if (!notReady || Date.now() >= deadline) {
        throw err;
      }
      return playWhenReady(albumId, deadline);
    });
  }

  /**
   * Plays the album on the user's Spotify, from its first track. When
   * Spotify is already playing somewhere, it takes over there. Otherwise
   * the Spotify app is opened on the album first - started, if it isn't
   * running; a device Spotify still lists can be an app closed a while ago
   * - and the album starts once the app is up. `options.onLaunch` is told
   * when the app is being opened.
   */
  function playAlbum(albumId, options) {
    return getDevices().then(function (devices) {
      var playing = devices.filter(function (device) { return device.is_active; })[0];
      if (playing) {
        return startAlbum(albumId, playing.id);
      }
      if (options && options.onLaunch) {
        options.onLaunch();
      }
      openInApp('spotify:album:' + albumId);
      return playWhenReady(albumId, Date.now() + DEVICE_WAIT_MS);
    });
  }

  /** Pauses whatever the user's Spotify is playing. */
  function pausePlayback() {
    return playerRequest('/me/player/pause', { method: 'PUT' });
  }

  /** Carries on where the user's Spotify was paused. */
  function resumePlayback() {
    return playerRequest('/me/player/play', { method: 'PUT' });
  }

  /** Skips to the next track in what the user's Spotify is playing. */
  function skipToNext() {
    return playerRequest('/me/player/next', { method: 'POST' });
  }

  /** Skips back to the track before. */
  function skipToPrevious() {
    return playerRequest('/me/player/previous', { method: 'POST' });
  }

  /** Jumps to `positionMs` into the track playing. */
  function seekTo(positionMs) {
    return playerRequest('/me/player/seek?position_ms=' + Math.max(0, Math.round(positionMs)), { method: 'PUT' });
  }

  /**
   * What the user's Spotify is up to: the track (`item`), how far into it
   * (`progress_ms`), whether it's playing (`is_playing`) and what from
   * (`context`) - or null when it isn't playing a track anywhere.
   */
  function getPlaybackState() {
    return playerRequest('/me/player').then(function (response) {
      // 204: no device has anything loaded.
      return response.status === 204 ? null : response.json();
    }).then(function (state) {
      return state && state.item ? state : null;
    });
  }

  /** An album's tracks in order, as { disc, number, name, durationMs }. */
  function getAlbumTracks(albumId) {
    var tracks = [];

    function fetchPage(path) {
      return spotifyJson(path, 'album’s tracks').then(function (data) {
        (data.items || []).forEach(function (track) {
          tracks.push({
            disc: track.disc_number,
            number: track.track_number,
            name: track.name,
            durationMs: track.duration_ms,
          });
        });
        return data.next ? fetchPage(data.next) : tracks;
      });
    }

    return fetchPage('/albums/' + encodeURIComponent(albumId) + '/tracks?limit=50');
  }

  MusicHub.spotify = {
    getEditablePlaylists: getEditablePlaylists,
    playAlbum: playAlbum,
    pausePlayback: pausePlayback,
    resumePlayback: resumePlayback,
    skipToNext: skipToNext,
    skipToPrevious: skipToPrevious,
    seekTo: seekTo,
    getPlaybackState: getPlaybackState,
    getAlbumTracks: getAlbumTracks,
    openInApp: openInApp,
  };
})(window.MusicHub);
