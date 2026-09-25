/*
 * Small shared Spotify Web API helpers used by more than one page.
 * Token handling itself lives in auth.js.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  /**
   * Every artist the user follows, paginated via the response's
   * cursors.after until Spotify stops handing out a next page.
   */
  function getFollowedArtists() {
    var artists = [];

    function fetchPage(url) {
      return MusicHub.auth.spotifyFetch(url).then(function (response) {
        if (!response.ok) {
          throw new Error('Could not load your followed artists (' + response.status + ')');
        }
        return response.json();
      }).then(function (data) {
        var page = (data.artists && data.artists.items) || [];
        page.forEach(function (artist) {
          artists.push({
            id: artist.id,
            name: artist.name,
            imageUrl: artist.images && artist.images.length ? artist.images[0].url : null,
            spotifyUrl: artist.external_urls ? artist.external_urls.spotify : null,
            // Spotify ships genres with the artist object - no extra call.
            genres: Array.isArray(artist.genres) ? artist.genres : [],
          });
        });

        var after = data.artists && data.artists.cursors ? data.artists.cursors.after : null;
        if (after && page.length) {
          return fetchPage('/me/following?type=artist&limit=50&after=' + encodeURIComponent(after));
        }
        return artists;
      });
    }

    return fetchPage('/me/following?type=artist&limit=50');
  }

  function spotifyJson(path, what) {
    return MusicHub.auth.spotifyFetch(path).then(function (response) {
      if (!response.ok) {
        throw new Error('Could not load your ' + what + ' (' + response.status + ')');
      }
      return response.json();
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

  function playbackError(code, message, status) {
    var err = new Error(message);
    err.code = code;
    err.status = status;
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
      return playbackError('failed', 'Spotify answered ' + response.status + (message ? ': ' + message : '') + '.', response.status);
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

  function startAlbum(albumId, deviceId) {
    var path = '/me/player/play' + (deviceId ? '?device_id=' + encodeURIComponent(deviceId) : '');
    return MusicHub.auth.spotifyFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_uri: 'spotify:album:' + albumId }),
    }).then(throwUnlessOk);
  }

  function getDevices() {
    return MusicHub.auth.spotifyFetch('/me/player/devices').then(throwUnlessOk).then(function (response) {
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
    return MusicHub.auth.spotifyFetch('/me/player/pause', { method: 'PUT' }).then(throwUnlessOk);
  }

  /** Carries on where the user's Spotify was paused. */
  function resumePlayback() {
    return MusicHub.auth.spotifyFetch('/me/player/play', { method: 'PUT' }).then(throwUnlessOk);
  }

  MusicHub.spotify = {
    getFollowedArtists: getFollowedArtists,
    getEditablePlaylists: getEditablePlaylists,
    playAlbum: playAlbum,
    pausePlayback: pausePlayback,
    resumePlayback: resumePlayback,
    openInApp: openInApp,
  };
})(window.MusicHub);
