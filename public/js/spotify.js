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

  MusicHub.spotify = {
    getFollowedArtists: getFollowedArtists,
  };
})(window.MusicHub);
