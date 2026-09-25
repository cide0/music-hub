/*
 * The user's followed Spotify artists, fetched in exactly one place: the
 * round refresh button in the navbar. The list is kept in localStorage and
 * every page that needs it (Concerts, Concert History, Artist Graph,
 * Discogs) reads it from here - none of them asks Spotify itself.
 *
 * Pages that show the list can listen for 'musichub:followedartistschange'
 * on document; it fires after a refresh here and when another tab stores a
 * new list.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var STORAGE_KEY = 'followedArtists';
  var CHANGE_EVENT = 'musichub:followedartistschange';
  var TIMEZONE = 'Europe/Berlin';
  var TOAST_MS = 4500;
  // What a page says when it needs the list and it was never fetched.
  var MISSING_MESSAGE = 'Fetch your followed artists first, with the refresh button in the navbar.';

  var els = {};
  // The refresh underway, so a second press joins it rather than starting another.
  var refreshing = null;
  var toastTimer = null;

  /* ------------------------------------------------------------ storage */

  function load() {
    var stored = MusicHub.storage.read(STORAGE_KEY, null);
    return stored && Array.isArray(stored.artists) ? stored : null;
  }

  /** The stored artists ({ id, name, imageUrl, spotifyUrl, genres }), or null before the first fetch. */
  function list() {
    var stored = load();
    return stored ? stored.artists : null;
  }

  function fetchedAt() {
    var stored = load();
    return stored ? stored.fetchedAt : null;
  }

  /* ------------------------------------------------------------ spotify */

  /** Every followed artist, following Spotify's cursor until it runs out. */
  function fetchAll() {
    var artists = [];

    function fetchPage(url) {
      return MusicHub.auth.spotifyFetch(url).then(function (response) {
        if (!response.ok) {
          var err = new Error('Could not load your followed artists (' + response.status + ')');
          err.status = response.status;
          throw err;
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

  function announce() {
    document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { artists: list() } }));
  }

  /** Fetches the list from Spotify and stores it. Resolves with the artists. */
  function refresh() {
    if (refreshing) {
      return refreshing;
    }
    refreshing = fetchAll().then(function (artists) {
      MusicHub.storage.write(STORAGE_KEY, { fetchedAt: new Date().toISOString(), artists: artists });
      refreshing = null;
      renderButton();
      announce();
      return artists;
    }, function (err) {
      refreshing = null;
      renderButton();
      throw err;
    });
    renderButton();
    return refreshing;
  }

  /* ------------------------------------------------------------- navbar */

  function formatTimestamp(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  function plural(count) {
    return count + (count === 1 ? ' artist' : ' artists');
  }

  /** Spinning while it fetches; its tooltip says when the list was fetched. */
  function renderButton() {
    if (!els.button) {
      return;
    }
    var stored = load();
    var label;
    if (refreshing) {
      label = 'Fetching your followed artists…';
    } else if (stored) {
      label = 'Refresh followed artists (' + plural(stored.artists.length)
        + ', fetched ' + formatTimestamp(stored.fetchedAt) + ')';
    } else {
      label = 'Fetch your followed artists from Spotify';
    }
    els.button.disabled = !!refreshing;
    els.button.setAttribute('aria-busy', String(!!refreshing));
    els.button.setAttribute('aria-label', label);
    els.button.title = label;
    // Never fetched: ringed, since pages point here for it.
    els.button.classList.toggle('navbar__refresh--empty', !stored);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      els.toast.hidden = true;
    }, TOAST_MS);
  }

  function onButtonClick() {
    refresh().then(function (artists) {
      showToast('Followed artists updated: ' + plural(artists.length) + '.');
    }, function (err) {
      console.warn('Could not refresh the followed artists', err);
      showToast("Couldn't update your followed artists: " + err.message
        + (err.status === 429 ? ' - Spotify is limiting requests right now, try again in a while.' : '.'));
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    els.button = document.getElementById('followed-refresh');
    els.toast = document.getElementById('followed-toast');
    if (!els.button || !els.toast) {
      return;
    }
    els.button.addEventListener('click', onButtonClick);
    renderButton();
  });

  // Another tab fetched (or Settings imported) a new list.
  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY || event.key === null) {
      renderButton();
      announce();
    }
  });

  MusicHub.followedArtists = {
    STORAGE_KEY: STORAGE_KEY,
    CHANGE_EVENT: CHANGE_EVENT,
    MISSING_MESSAGE: MISSING_MESSAGE,
    list: list,
    fetchedAt: fetchedAt,
    refresh: refresh,
  };
})(window.MusicHub);
