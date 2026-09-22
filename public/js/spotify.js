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

  MusicHub.spotify = {
    getFollowedArtists: getFollowedArtists,
    getEditablePlaylists: getEditablePlaylists,
  };
})(window.MusicHub);
