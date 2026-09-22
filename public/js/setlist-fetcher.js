/*
 * Setlist Fetcher: finds an artist's newest setlist in a city via the
 * backend's setlist.fm proxy, lets the user trim it, matches every song to a
 * Spotify track and appends the result to one of their playlists.
 *
 * Nothing of this page's own is persisted - a reload starts at the search
 * form. The one storage write is into Concert Date Fetcher's data: once a
 * past concert's setlist is on a playlist, that artist is taken off it.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var CONCERTS_KEY = 'concertDateFetcher';
  var TIMEZONE = 'Europe/Berlin';
  // Spotify only says it limits over a rolling 30 seconds, per app. A steady
  // pace keeps a long setlist from tripping its 429s.
  var MATCH_DELAY_MS = 250;
  // On a 429 every search waits until Spotify's Retry-After has passed. The
  // header isn't always readable from the browser, so without it the wait
  // doubles per attempt instead (2s, 4s, 8s, ...), up to this many tries.
  var RATE_LIMIT_RETRIES = 5;
  var RATE_LIMIT_FALLBACK_S = 2;
  // Anything longer means Spotify has locked the app out for a while - not
  // worth keeping the page waiting for.
  var RATE_LIMIT_MAX_WAIT_S = 120;
  var MATCH_CANDIDATES = 5;
  var MANUAL_RESULTS = 10;
  // Spotify accepts at most 100 URIs per add request.
  var ADD_CHUNK_SIZE = 100;

  var els = {};
  var searching = false;
  // The setlist on screen: { setlist, songs, source } - or null.
  var current = null;
  // Bumped whenever the song list is replaced, so a matching run that is
  // still going for an old setlist stops touching the page.
  var matchRunId = 0;
  var nextSongKey = 0;
  // Edits to the current song list, for undo / redo. Each entry is either
  // { type: 'remove', song, index } or { type: 'status', song, from, to }.
  var undoStack = [];
  var redoStack = [];
  // The playlist dropdown (playlist-picker.js) and what it was filled with.
  var picker = null;
  var playlists = null;
  var playlistsLoading = null;
  var adding = false;
  // No Spotify request goes out before this time (ms) - set by a 429.
  var rateLimitedUntil = 0;
  // Ticks the "resuming in Xs" countdown while a pause lasts.
  var rateLimitTimer = null;
  // How long a fading message stays before it fades, and the fade itself
  // (matches the CSS transition).
  var FADE_AFTER_MS = 6000;
  var FADE_DURATION_MS = 600;

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function show(node, text) {
    if (text !== undefined) {
      node.textContent = text;
    }
    node.hidden = false;
  }

  function hide(node) {
    window.clearTimeout(node.fadeTimer);
    node.classList.remove('fade-message--fading');
    node.hidden = true;
  }

  /**
   * Shows a message that fades out on its own - the success note and the
   * error messages alike, like the Artist Graph's notes.
   */
  function flash(node, text) {
    hide(node);
    show(node, text);
    node.fadeTimer = window.setTimeout(function () {
      node.classList.add('fade-message--fading');
      node.fadeTimer = window.setTimeout(function () {
        hide(node);
      }, FADE_DURATION_MS);
    }, FADE_AFTER_MS);
  }

  /** Lowercase, diacritics and punctuation gone: "Beyoncé" == "beyonce". */
  function fold(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  function todayInBerlin() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE }).format(new Date());
  }

  /** "2024-06-12" -> "12 Jun 2024". */
  function formatDate(isoDate) {
    var date = new Date(isoDate + 'T00:00:00Z');
    if (isNaN(date.getTime())) {
      return isoDate || '';
    }
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
    }).format(date);
  }

  function place(venueName, city) {
    return [venueName, city].filter(Boolean).join(', ');
  }

  /* ------------------------------------------ Concert Date Fetcher shows */

  function readConcertData() {
    var stored = MusicHub.storage.read(CONCERTS_KEY, null);
    return stored && Array.isArray(stored.concerts) ? stored : null;
  }

  /** Past concerts the user went to (calendar or attending), newest first. */
  function pastShows() {
    var data = readConcertData();
    if (!data) {
      return [];
    }
    var today = todayInBerlin();
    return data.concerts
      .filter(function (concert) {
        return (concert.addedToCalendar || concert.attending)
          && concert.localDate && concert.localDate < today
          && Array.isArray(concert.artists) && concert.artists.length;
      })
      .sort(function (a, b) {
        return a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : 0;
      });
  }

  function renderPastShows() {
    var shows = pastShows();
    els.pastList.textContent = '';
    els.pastSection.hidden = shows.length === 0;

    shows.forEach(function (concert) {
      var item = el('li', 'past-show');
      var info = el('div', 'past-show__info');
      info.appendChild(el('p', 'past-show__artists', concert.artists.join(', ')));
      info.appendChild(el('p', 'past-show__meta',
        formatDate(concert.localDate) + ' · ' + place(concert.venueName, concert.city)));
      item.appendChild(info);

      // setlist.fm searches by one artist, so a shared bill gets one
      // button per artist.
      var actions = el('div', 'past-show__actions');
      var merged = concert.artists.length > 1;
      concert.artists.forEach(function (artist) {
        var button = el('button', 'button button--ghost past-show__fetch',
          merged ? 'Fetch setlist · ' + artist : 'Fetch setlist');
        button.type = 'button';
        button.setAttribute('data-fetch-setlist', '');
        button.setAttribute('data-label', button.textContent);
        button.disabled = searching;
        button.addEventListener('click', function () {
          els.artistInput.value = artist;
          els.cityInput.value = concert.city || '';
          updateClearButtons();
          runSearch(artist, concert.city || '', button, { concertId: concert.id, artist: artist });
        });
        actions.appendChild(button);
      });
      item.appendChild(actions);

      els.pastList.appendChild(item);
    });
  }

  /**
   * Takes the artist off every stored concert this setlist belongs to -
   * same artist, same day, same city - and drops a concert once no artist is
   * left on it. Venues aren't compared: Ticketmaster and setlist.fm often
   * name the same hall differently.
   */
  function markShowHandled(setlist, source) {
    var data = readConcertData();
    if (!data) {
      return;
    }

    var names = [fold(setlist.artistName)];
    if (source) {
      names.push(fold(source.artist));
    }

    var changed = false;
    data.concerts = data.concerts.filter(function (concert) {
      var sameShow = concert.localDate === setlist.eventDate
        && ((source && concert.id === source.concertId)
          || (setlist.knownCity && concert.city === setlist.knownCity));
      if (!sameShow || !Array.isArray(concert.artists)) {
        return true;
      }

      var remaining = concert.artists.filter(function (name) {
        return names.indexOf(fold(name)) === -1;
      });
      if (remaining.length === concert.artists.length) {
        return true;
      }

      changed = true;
      concert.artists = remaining;
      if (Array.isArray(concert.supportArtists)) {
        concert.supportArtists = concert.supportArtists.filter(function (name) {
          return names.indexOf(fold(name)) === -1;
        });
      }
      return remaining.length > 0;
    });

    if (changed) {
      MusicHub.storage.write(CONCERTS_KEY, data);
      renderPastShows();
    }
  }

  /* ---------------------------------------------------------------- search */

  function setSearching(on, activeButton) {
    searching = on;
    var buttons = [els.searchButton].concat(
      Array.prototype.slice.call(els.pastList.querySelectorAll('[data-fetch-setlist]')),
    );
    buttons.forEach(function (button) {
      button.disabled = on;
      button.textContent = on && button === activeButton
        ? 'Searching…'
        : button.getAttribute('data-label');
    });
  }

  function fetchSetlists(artist, city) {
    var url = '/api/setlists?artist=' + encodeURIComponent(artist);
    if (city) {
      url += '&city=' + encodeURIComponent(city);
    }
    return fetch(url).then(function (response) {
      if (response.status === 429) {
        throw new Error('setlist.fm is rate-limiting requests right now — try again in a moment.');
      }
      if (!response.ok) {
        throw new Error('Could not search setlist.fm (' + response.status + ').');
      }
      return response.json();
    }).then(function (data) {
      return data.setlists || [];
    });
  }

  /** Each search field's ✕ shows only while there's something to clear. */
  function updateClearButtons() {
    Array.prototype.forEach.call(els.form.querySelectorAll('[data-clear]'), function (button) {
      button.hidden = !document.getElementById(button.getAttribute('data-clear')).value;
    });
  }

  function clearResults() {
    matchRunId++;
    current = null;
    undoStack = [];
    redoStack = [];
    picker.close(false);
    hide(els.error);
    hide(els.empty);
    hide(els.setlist);
    hide(els.closeButton);
    els.songList.textContent = '';
  }

  /**
   * The newest setlist for the artist in that city. If that one is an empty
   * placeholder, the artist's newest show anywhere that has songs instead.
   */
  function runSearch(artist, city, activeButton, source) {
    if (searching) {
      return;
    }
    artist = artist.trim();
    city = city.trim();
    if (!artist || !city) {
      return;
    }

    hide(els.toast);
    clearResults();
    setSearching(true, activeButton);

    fetchSetlists(artist, city)
      .then(function (setlists) {
        if (!setlists.length) {
          show(els.empty, 'No setlists found for that artist and city.');
          return null;
        }

        var newest = setlists[0];
        if (newest.songs.length) {
          return { setlist: newest, fallbackFrom: null };
        }

        return fetchSetlists(newest.artistName || artist, null).then(function (anywhere) {
          var withSongs = anywhere.filter(function (setlist) {
            return setlist.songs.length && setlist.id !== newest.id;
          })[0];
          if (!withSongs) {
            show(els.empty, 'The newest setlist for ' + (newest.artistName || artist) + ' in ' + city
              + ' has no songs listed yet, and none of their other shows has one either.');
            return null;
          }
          return { setlist: withSongs, fallbackFrom: city };
        });
      })
      .then(function (result) {
        if (result) {
          showSetlist(result.setlist, result.fallbackFrom, source);
        }
      })
      .catch(function (err) {
        flash(els.error, err.message || 'Could not search setlist.fm.');
      })
      .then(function () {
        setSearching(false);
      });
  }

  /* --------------------------------------------------------------- setlist */

  function showSetlist(setlist, fallbackFrom, source) {
    var artistName = setlist.artistName;
    current = {
      setlist: setlist,
      source: source || null,
      songs: setlist.songs.map(function (song) {
        return {
          key: 'song-' + (nextSongKey++),
          name: song.name,
          coverOf: song.coverOf,
          tape: !!song.tape,
          // A cover is found on Spotify under the original artist.
          artist: song.coverOf || artistName,
          // setlist.fm writes a medley as one entry - "Song A / Song B" -
          // so each part is matched to a track of its own.
          parts: song.name.split(/\s+\/\s+/).filter(Boolean),
          status: 'pending',
          // The Spotify tracks this entry adds, in playlist order.
          tracks: [],
          panelOpen: false,
          // The open search's query and results, kept on the song so the
          // search survives a redraw of the line.
          query: null,
          results: null,
          node: null,
        };
      }),
    };

    if (fallbackFrom) {
      show(els.fallback, 'No setlist found for ' + fallbackFrom + ' — showing ' + artistName
        + '’s most recent show instead, in ' + (setlist.city || 'another city') + '.');
    } else {
      hide(els.fallback);
    }

    // The title itself links to this setlist's page on setlist.fm.
    var titleText = 'Setlist from ' + formatDate(setlist.eventDate) + ' at '
      + place(setlist.venueName, setlist.city);
    els.title.textContent = '';
    if (setlist.url) {
      var titleLink = el('a', 'setlist__title-link', titleText);
      titleLink.href = setlist.url;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener';
      titleLink.title = 'Open this setlist on setlist.fm';
      els.title.appendChild(titleLink);
    } else {
      els.title.textContent = titleText;
    }
    toggleLink(els.artistLink, setlist.artistUrl);
    els.artistLink.textContent = 'All recent ' + artistName + ' shows';

    hide(els.playlistError);
    els.songList.textContent = '';
    current.songs.forEach(function (song) {
      song.node = el('li', 'song');
      renderSong(song);
      els.songList.appendChild(song.node);
    });

    show(els.setlist);
    show(els.closeButton);
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.setlist.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

    loadPlaylists();
    updateHistoryButtons();
    updateAddState();
    matchSongs(matchRunId);
  }

  function toggleLink(link, url) {
    if (url) {
      link.href = url;
      link.hidden = false;
    } else {
      link.removeAttribute('href');
      link.hidden = true;
    }
  }

  /* ---------------------------------------------------------- undo / redo */

  function record(edit) {
    undoStack.push(edit);
    redoStack = [];
    applyEdit(edit, 'forward');
  }

  function applyEdit(edit, direction) {
    var song = edit.song;
    if (edit.type === 'remove') {
      if (direction === 'forward') {
        current.songs.splice(current.songs.indexOf(song), 1);
        song.removed = true;
        song.panelOpen = false;
        song.node.remove();
      } else {
        // Undone in reverse order, so the index is right again by then.
        current.songs.splice(edit.index, 0, song);
        song.removed = false;
        els.songList.insertBefore(song.node, els.songList.children[edit.index] || null);
        renderSong(song);
      }
    } else {
      var state = direction === 'forward' ? edit.to : edit.from;
      song.status = state.status;
      song.tracks = state.tracks.slice();
      renderSong(song);
    }

    updateHistoryButtons();
    updateAddState();
  }

  function undo() {
    if (!undoStack.length || adding) {
      return;
    }
    var edit = undoStack.pop();
    redoStack.push(edit);
    applyEdit(edit, 'back');
  }

  function redo() {
    if (!redoStack.length || adding) {
      return;
    }
    var edit = redoStack.pop();
    undoStack.push(edit);
    applyEdit(edit, 'forward');
  }

  function updateHistoryButtons() {
    els.undoButton.disabled = adding || !undoStack.length;
    els.redoButton.disabled = adding || !redoStack.length;
  }

  function removeSong(song) {
    record({ type: 'remove', song: song, index: current.songs.indexOf(song) });
  }

  function setSongTracks(song, status, tracks) {
    record({
      type: 'status',
      song: song,
      from: { status: song.status, tracks: song.tracks.slice() },
      to: { status: status, tracks: tracks.slice() },
    });
  }

  function hasTrack(song, track) {
    return song.tracks.some(function (picked) {
      return picked.uri === track.uri;
    });
  }

  /** The "+" on a result: add it next to the picked tracks, or take it back off. */
  function toggleExtraTrack(song, track) {
    var tracks = hasTrack(song, track)
      ? song.tracks.filter(function (picked) { return picked.uri !== track.uri; })
      : song.tracks.concat([track]);
    setSongTracks(song, tracks.length ? 'matched' : 'unmatched', tracks);
  }

  function trackLabel(track) {
    return track.name + ' · ' + track.artists.join(', ');
  }

  function renderSong(song) {
    var node = song.node;
    node.textContent = '';
    node.className = 'song' + (song.panelOpen ? ' song--open' : '');

    // The whole line opens the song's Spotify search - except while it's
    // still being matched, since the match would redraw the open search.
    var row = el('div', 'song__row');
    var pending = song.status === 'pending';
    row.classList.toggle('song__row--clickable', !pending);
    var body = el('button', 'song__body');
    body.type = 'button';
    body.disabled = pending;
    body.setAttribute('aria-expanded', song.panelOpen ? 'true' : 'false');
    var title = el('span', 'song__title', song.name);
    if (song.tape) {
      var tape = el('span', 'song__label', 'Tape');
      tape.title = 'Played from tape, not performed live';
      title.appendChild(tape);
    }
    if (song.coverOf) {
      var cover = el('span', 'song__label', 'Cover');
      cover.title = 'Originally by ' + song.coverOf;
      title.appendChild(cover);
    }
    body.appendChild(title);
    body.appendChild(renderSongStatus(song));
    row.appendChild(body);

    var remove = el('button', 'song__remove', '✕');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + song.name);
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      removeSong(song);
    });
    row.appendChild(remove);
    // On the row rather than the button, so the song number and the gaps
    // around it count as part of the line too.
    row.addEventListener('click', function () {
      if (song.status !== 'pending') {
        togglePanel(song);
      }
    });
    node.appendChild(row);

    if (song.panelOpen) {
      node.appendChild(renderTrackPicker(song));
    }
  }

  /** Circled exclamation mark, drawn in the warning color by CSS. */
  function warningIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'song__warning-icon');
    [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['line', { x1: '12', y1: '7.5', x2: '12', y2: '12.5' }],
      ['line', { x1: '12', y1: '16.5', x2: '12.01', y2: '16.5' }],
    ].forEach(function (shape) {
      var node = document.createElementNS(ns, shape[0]);
      Object.keys(shape[1]).forEach(function (name) {
        node.setAttribute(name, shape[1][name]);
      });
      svg.appendChild(node);
    });
    return svg;
  }

  function renderSongStatus(song) {
    var status = el('span', 'song__status');

    if (song.status === 'pending') {
      status.textContent = 'Matching…';
      return status;
    }

    if (song.status === 'unmatched') {
      var warning = el('span', 'song__warning');
      warning.appendChild(warningIcon());
      warning.appendChild(document.createTextNode(song.tracks.length
        ? 'Only ' + song.tracks.length + ' of ' + song.parts.length + ' parts matched — pick the rest'
        : 'No match on Spotify — pick a track'));
      status.appendChild(warning);
    }

    song.tracks.forEach(function (track) {
      status.appendChild(el('span', 'song__track', trackLabel(track)));
    });
    return status;
  }

  function togglePanel(song) {
    song.panelOpen = !song.panelOpen;
    // Only one song's search is open at a time.
    if (song.panelOpen) {
      current.songs.forEach(function (other) {
        if (other !== song && other.panelOpen) {
          other.panelOpen = false;
          renderSong(other);
        }
      });
    }
    if (song.panelOpen) {
      song.query = song.parts[0] + ' ' + song.artist;
      song.results = null;
    }
    renderSong(song);
    if (song.panelOpen) {
      var input = song.node.querySelector('.track-picker .text-input');
      input.focus();
      input.select();
      searchTracksFor(song, song.query);
    }
  }

  /** The inline Spotify search for fixing (or confirming) one song's track. */
  function renderTrackPicker(song) {
    var panel = el('div', 'track-picker');

    if (song.tracks.length) {
      panel.appendChild(renderPickedTracks(song));
    }

    var form = el('form', 'inline-form');
    var label = el('label', 'visually-hidden', 'Search Spotify for ' + song.name);
    var input = el('input', 'text-input');
    input.type = 'search';
    input.id = song.key + '-query';
    label.htmlFor = input.id;
    input.value = song.query || '';
    input.autocomplete = 'off';
    input.addEventListener('input', function () {
      song.query = input.value;
    });
    var submit = el('button', 'button button--ghost', 'Search');
    submit.type = 'submit';
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      searchTracksFor(song, input.value);
    });
    panel.appendChild(form);

    // A medley: one click searches each of its parts.
    if (song.parts.length > 1) {
      var partSearches = el('div', 'track-picker__parts');
      song.parts.forEach(function (part) {
        var partButton = el('button', 'track-picker__part', 'Search “' + part + '”');
        partButton.type = 'button';
        partButton.addEventListener('click', function () {
          input.value = part + ' ' + song.artist;
          searchTracksFor(song, input.value);
        });
        partSearches.appendChild(partButton);
      });
      panel.appendChild(partSearches);
    }

    var results = el('ul', 'picker track-picker__results');
    results.setAttribute('data-results', '');
    panel.appendChild(results);
    renderResults(song, results);

    var actions = el('div', 'track-picker__actions');
    // Same as the row's ✕ - and undoable the same way.
    var remove = el('button', 'button button--ghost', 'Remove this song');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      removeSong(song);
    });
    var close = el('button', 'button button--ghost', 'Done');
    close.type = 'button';
    close.addEventListener('click', function () {
      // Closing on a partly matched medley accepts the tracks picked so far.
      if (song.status === 'unmatched' && song.tracks.length) {
        song.panelOpen = false;
        setSongTracks(song, 'matched', song.tracks);
        return;
      }
      togglePanel(song);
    });
    actions.appendChild(remove);
    actions.appendChild(close);
    panel.appendChild(actions);

    return panel;
  }

  function searchTracksFor(song, query) {
    var results = song.node.querySelector('[data-results]');
    if (!results || !query.trim()) {
      return;
    }
    song.query = query;
    song.results = { message: 'Searching Spotify…', tracks: [] };
    renderResults(song, results);

    var searchId = (song.searchId || 0) + 1;
    song.searchId = searchId;

    searchSpotify(query.trim(), MANUAL_RESULTS)
      .then(function (tracks) {
        song.results = tracks.length
          ? { message: null, tracks: tracks }
          : { message: 'No tracks found — try a different search.', tracks: [] };
      })
      .catch(function (err) {
        song.results = { message: err.message, tracks: [] };
      })
      .then(function () {
        // The line may have been redrawn meanwhile - find the list again.
        var list = song.panelOpen && song.searchId === searchId
          ? song.node.querySelector('[data-results]')
          : null;
        if (list) {
          renderResults(song, list);
        }
      });
  }

  function renderResults(song, list) {
    list.textContent = '';
    if (!song.results) {
      return;
    }
    if (song.results.message) {
      list.appendChild(el('li', 'picker__empty', song.results.message));
    }
    song.results.tracks.forEach(function (track) {
      list.appendChild(renderTrackOption(song, track));
    });
  }

  /** The tracks this entry currently adds, each removable on its own. */
  function renderPickedTracks(song) {
    var box = el('div', 'track-picker__picked');
    box.appendChild(el('p', 'track-picker__picked-title',
      song.tracks.length === 1 ? 'Picked track' : 'Picked tracks, in playlist order'));
    var list = el('ul', 'track-picker__picked-list');
    song.tracks.forEach(function (track) {
      var item = el('li', 'track-picker__picked-item');
      item.appendChild(el('span', 'track-picker__picked-name', trackLabel(track)));
      var remove = el('button', 'song__remove track-picker__picked-remove', '✕');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Take ' + track.name + ' off this entry');
      remove.addEventListener('click', function () {
        toggleExtraTrack(song, track);
      });
      item.appendChild(remove);
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
  }

  function renderTrackOption(song, track) {
    var picked = hasTrack(song, track);
    var item = el('li', 'track-option' + (picked ? ' track-option--picked' : ''));
    var button = el('button', 'picker__button');
    button.type = 'button';

    if (track.imageUrl) {
      var image = el('img', 'picker__avatar track-picker__cover');
      image.src = track.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      button.appendChild(image);
    } else {
      button.appendChild(el('span', 'picker__avatar picker__avatar--fallback track-picker__cover', '♪'));
    }

    var text = el('span', 'track-picker__text');
    text.appendChild(el('span', 'track-picker__name', track.name));
    text.appendChild(el('span', 'track-picker__meta', track.artists.join(', ') + ' · ' + track.album));
    button.appendChild(text);

    // The row itself: this is the one track - done.
    button.addEventListener('click', function () {
      song.panelOpen = false;
      setSongTracks(song, 'matched', [track]);
    });
    item.appendChild(button);

    // "+": one more track for this entry (a medley), search stays open.
    var extra = el('button', 'track-option__add', picked ? '✓' : '+');
    extra.type = 'button';
    extra.setAttribute('aria-pressed', picked ? 'true' : 'false');
    extra.setAttribute('aria-label', picked
      ? 'Take ' + track.name + ' off this entry'
      : 'Add ' + track.name + ' as another track for this entry');
    extra.title = picked ? 'Picked — click to take it off' : 'Add as another track';
    extra.addEventListener('click', function () {
      toggleExtraTrack(song, track);
    });
    item.appendChild(extra);
    return item;
  }

  /* ------------------------------------------------------ Spotify matching */

  function lockedOutMessage() {
    var minutes = Math.ceil((rateLimitedUntil - Date.now()) / 60000);
    return 'Spotify is rate-limiting this app for about ' + minutes
      + (minutes === 1 ? ' minute' : ' minutes') + ' — try again later.';
  }

  function isLockedOut() {
    return rateLimitedUntil - Date.now() > RATE_LIMIT_MAX_WAIT_S * 1000;
  }

  /** Holds every Spotify request back until `seconds` from now. */
  function pauseRequests(seconds) {
    rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + seconds * 1000);
    if (rateLimitTimer || isLockedOut()) {
      updateAddState();
      return;
    }
    rateLimitTimer = window.setInterval(function () {
      if (Date.now() >= rateLimitedUntil) {
        window.clearInterval(rateLimitTimer);
        rateLimitTimer = null;
      }
      updateAddState();
    }, 1000);
    updateAddState();
  }

  /** Resolves once no pause is in effect; fails while Spotify locks us out. */
  function waitForRateLimit() {
    if (isLockedOut()) {
      return Promise.reject(new Error(lockedOutMessage()));
    }
    var wait = rateLimitedUntil - Date.now();
    return wait > 0 ? delay(wait) : Promise.resolve();
  }

  /**
   * GET against Spotify. A 429 pauses every request - the whole matching run,
   * not just this song - so the rolling window actually gets to clear.
   */
  function spotifyGet(path, attempt) {
    attempt = attempt || 0;
    return waitForRateLimit().then(function () {
      return MusicHub.auth.spotifyFetch(path);
    }).then(function (response) {
      if (response.status === 429) {
        var header = Number(response.headers.get('Retry-After'));
        var seconds = header > 0 ? header : RATE_LIMIT_FALLBACK_S * Math.pow(2, attempt);
        pauseRequests(seconds);
        if (isLockedOut()) {
          throw new Error(lockedOutMessage());
        }
        if (attempt + 1 >= RATE_LIMIT_RETRIES) {
          throw new Error('Spotify kept rate-limiting the search — try again in a minute.');
        }
        return spotifyGet(path, attempt + 1);
      }
      if (!response.ok) {
        throw new Error('Spotify search failed (' + response.status + ').');
      }
      return response.json();
    });
  }

  function searchSpotify(query, limit) {
    return spotifyGet('/search?type=track&market=from_token&limit=' + limit
      + '&q=' + encodeURIComponent(query)).then(function (data) {
      return ((data.tracks && data.tracks.items) || []).filter(Boolean).map(function (track) {
        var images = (track.album && track.album.images) || [];
        return {
          uri: track.uri,
          name: track.name,
          artists: (track.artists || []).map(function (artist) {
            return artist.name;
          }),
          album: track.album ? track.album.name : '',
          // Spotify lists album art largest first; the list only needs a thumbnail.
          imageUrl: images.length ? images[images.length - 1].url : null,
        };
      });
    });
  }

  /**
   * A title with the usual Spotify decorations stripped - "(Live)",
   * "- 2011 Remaster", "[feat. X]" - so it compares to the setlist title.
   */
  function baseTitle(title) {
    return fold(String(title || '')
      .replace(/\s+-\s+.*$/, '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
      .replace(/\bfeat\..*$/i, ''));
  }

  function isConfidentMatch(title, artist, track) {
    var wanted = fold(artist);
    var byArtist = track.artists.some(function (name) {
      return fold(name) === wanted;
    });
    if (!byArtist) {
      return false;
    }
    var a = baseTitle(title);
    var b = baseTitle(track.name);
    return !!a && !!b && (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
  }

  /** Field filters break on quotes and colons inside the values. */
  function fieldValue(value) {
    return String(value || '').replace(/["':]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** The confident match for each part of an entry, parts without one left out. */
  function matchParts(song) {
    var found = [];
    return song.parts.reduce(function (chain, part, index) {
      return chain.then(function () {
        var query = 'track:' + fieldValue(part) + ' artist:' + fieldValue(song.artist);
        return (index ? delay(MATCH_DELAY_MS) : Promise.resolve())
          .then(function () {
            return searchSpotify(query, MATCH_CANDIDATES);
          })
          .then(function (tracks) {
            var match = tracks.filter(function (track) {
              return isConfidentMatch(part, song.artist, track);
            })[0];
            if (match && !hasTrack({ tracks: found }, match)) {
              found.push(match);
            }
          });
      });
    }, Promise.resolve()).then(function () {
      return found;
    });
  }

  /**
   * Every song, one after the other, against Spotify's track search. Removed
   * songs are matched too, so undoing a removal brings back a finished match.
   */
  function matchSongs(runId) {
    var queue = current.songs.slice();

    function next() {
      if (runId !== matchRunId) {
        return Promise.resolve();
      }
      var song = queue.shift();
      if (!song) {
        updateAddState();
        return Promise.resolve();
      }
      if (song.status !== 'pending') {
        return next();
      }

      return matchParts(song)
        .then(function (tracks) {
          song.tracks = tracks;
          song.status = tracks.length === song.parts.length ? 'matched' : 'unmatched';
        })
        .catch(function (err) {
          console.warn('Could not match "' + song.name + '"', err);
          song.status = 'unmatched';
        })
        .then(function () {
          if (runId !== matchRunId) {
            return null;
          }
          if (!song.removed) {
            renderSong(song);
            updateAddState();
          }
          return delay(MATCH_DELAY_MS).then(next);
        });
    }

    return next();
  }

  /* -------------------------------------------------------------- playlist */

  /** Only playlists the user can add to: their own and collaborative ones. */
  function loadPlaylists() {
    if (playlistsLoading) {
      return playlistsLoading;
    }

    show(els.playlistMessage, 'Loading your playlists…');
    playlistsLoading = MusicHub.spotify.getEditablePlaylists().then(function (list) {
      playlists = list;
      renderPlaylists();
    }).catch(function (err) {
      console.warn('Could not load playlists', err);
      // Let the next setlist try again.
      playlistsLoading = null;
      hide(els.playlistMessage);
      flash(els.playlistError, 'Could not load your Spotify playlists.');
    });

    return playlistsLoading;
  }

  function renderPlaylists() {
    if (!playlists.length) {
      show(els.playlistMessage, 'You don’t have any editable playlists yet — create one in Spotify first');
      hide(els.picker);
      updateAddState();
      return;
    }

    hide(els.playlistMessage);
    picker.setPlaylists(playlists);
    // The default playlist from Settings starts out selected; picking
    // another one here still works as usual.
    if (!picker.selected()) {
      var fallback = MusicHub.storage.getSetting('setlistDefaultPlaylist', null);
      if (fallback && fallback.id) {
        picker.select(fallback.id);
      }
    }
    show(els.picker);
    updateAddState();
  }

  function updateAddState() {
    if (!current) {
      return;
    }

    var songs = current.songs;
    var pending = songs.filter(function (song) { return song.status === 'pending'; }).length;
    var unmatched = songs.filter(function (song) { return song.status === 'unmatched'; }).length;
    var ready = songs.filter(function (song) { return song.status === 'matched'; }).length;

    var pause = rateLimitedUntil - Date.now();
    if (isLockedOut()) {
      els.matchStatus.textContent = lockedOutMessage();
    } else if (!songs.length) {
      els.matchStatus.textContent = 'Every song has been removed.';
    } else if (pending && pause > 0) {
      els.matchStatus.textContent = 'Spotify is rate-limiting — resuming in ' + Math.ceil(pause / 1000)
        + 's… ' + (songs.length - pending) + ' of ' + songs.length;
    } else if (pending) {
      els.matchStatus.textContent = 'Matching songs on Spotify… ' + (songs.length - pending) + ' of ' + songs.length;
    } else if (unmatched) {
      els.matchStatus.textContent = unmatched + (unmatched === 1 ? ' song needs' : ' songs need')
        + ' a track picked.';
    } else {
      els.matchStatus.textContent = ready + ' of ' + songs.length + ' songs matched on Spotify.';
    }

    var hint = '';
    if (pending) {
      hint = 'Still matching songs…';
    } else if (unmatched) {
      hint = 'Resolve the flagged songs first.';
    }
    if (hint) {
      show(els.playlistHint, hint);
    } else {
      hide(els.playlistHint);
    }

    els.addButton.disabled = adding || !picker.selected() || pending > 0 || unmatched > 0 || ready === 0;
  }

  function addToPlaylist() {
    var playlist = picker.selected();
    if (!current || !playlist || adding) {
      return;
    }

    var snapshot = current;
    var entries = snapshot.songs.length;
    // A medley entry contributes all of its tracks, in the order picked.
    var uris = [];
    snapshot.songs.forEach(function (song) {
      if (song.status === 'matched') {
        song.tracks.forEach(function (track) {
          uris.push(track.uri);
        });
      }
    });

    adding = true;
    els.addButton.textContent = 'Adding…';
    updateHistoryButtons();
    hide(els.playlistError);
    updateAddState();

    // Chunks go in one after the other so the setlist order holds.
    var chain = Promise.resolve();
    for (var start = 0; start < uris.length; start += ADD_CHUNK_SIZE) {
      (function (chunk) {
        chain = chain.then(function () {
          // /items, not the old /tracks: Spotify retired that one in its
          // February 2026 API changes and answers it with a 403.
          return MusicHub.auth.spotifyFetch('/playlists/' + encodeURIComponent(playlist.id) + '/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: chunk }),
          }).then(function (response) {
            if (response.ok) {
              return null;
            }
            return response.json().catch(function () {
              return null;
            }).then(function (body) {
              var reason = body && body.error && body.error.message;
              throw new Error('Spotify refused the add (' + response.status + (reason ? ': ' + reason : '') + ').');
            });
          });
        });
      })(uris.slice(start, start + ADD_CHUNK_SIZE));
    }

    chain
      .then(function () {
        markShowHandled(snapshot.setlist, snapshot.source);
        // Done with this setlist: clear it away and leave just the note.
        clearResults();
        flash(els.toast, uris.length === entries
          ? uris.length + ' of ' + entries + ' songs added to ' + playlist.name
          : uris.length + ' songs added to ' + playlist.name + ' (from ' + entries + ' setlist entries)');
        els.toast.scrollIntoView({ block: 'nearest' });
      })
      .catch(function (err) {
        flash(els.playlistError, err.message || 'Could not add the songs to that playlist.');
      })
      .then(function () {
        adding = false;
        els.addButton.textContent = 'Add to playlist';
        updateHistoryButtons();
        updateAddState();
      });
  }

  /* ------------------------------------------------------------------ init */

  document.addEventListener('DOMContentLoaded', function () {
    els.form = document.getElementById('setlist-search');
    if (!els.form) {
      return;
    }
    els.artistInput = document.getElementById('setlist-artist');
    els.cityInput = document.getElementById('setlist-city');
    els.searchButton = document.getElementById('setlist-search-button');
    els.searchButton.setAttribute('data-label', els.searchButton.textContent);
    els.pastSection = document.getElementById('past-shows');
    els.pastList = document.getElementById('past-shows-list');
    els.error = document.getElementById('setlist-error');
    els.empty = document.getElementById('setlist-empty');
    els.setlist = document.getElementById('setlist');
    els.fallback = document.getElementById('setlist-fallback');
    els.title = document.getElementById('setlist-title');
    els.artistLink = document.getElementById('setlist-artist-link');
    els.matchStatus = document.getElementById('match-status');
    els.songList = document.getElementById('song-list');
    els.playlistMessage = document.getElementById('playlist-message');
    els.picker = document.getElementById('playlist-picker');
    els.addButton = document.getElementById('playlist-add-button');
    els.playlistHint = document.getElementById('playlist-hint');
    els.playlistError = document.getElementById('playlist-error');
    els.toast = document.getElementById('setlist-toast');

    els.form.addEventListener('input', updateClearButtons);
    els.form.addEventListener('click', function (event) {
      var button = event.target.closest('[data-clear]');
      if (!button) {
        return;
      }
      var input = document.getElementById(button.getAttribute('data-clear'));
      input.value = '';
      updateClearButtons();
      input.focus();
    });
    // The browser may restore typed values on back/forward navigation.
    updateClearButtons();
    els.form.addEventListener('submit', function (event) {
      event.preventDefault();
      runSearch(els.artistInput.value, els.cityInput.value, els.searchButton, null);
    });
    picker = MusicHub.playlistPicker.create(els.picker, { onChange: updateAddState });
    els.addButton.addEventListener('click', addToPlaylist);
    // Throws the whole setlist away - matching stops, edits and history go.
    els.closeButton = document.getElementById('setlist-close');
    els.closeButton.addEventListener('click', function () {
      if (adding) {
        return;
      }
      hide(els.playlistError);
      clearResults();
    });
    els.undoButton = document.getElementById('setlist-undo');
    els.redoButton = document.getElementById('setlist-redo');
    els.undoButton.addEventListener('click', undo);
    els.redoButton.addEventListener('click', redo);

    // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) - except while typing,
    // where they belong to the text field.
    document.addEventListener('keydown', function (event) {
      if (!current || els.setlist.hidden || !(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      var target = event.target;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
      }
      var key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    });

    renderPastShows();
  });

  // Exposed for tests.
  MusicHub.setlistFetcher = {
    pastShows: pastShows,
    markShowHandled: markShowHandled,
    isConfidentMatch: isConfidentMatch,
    baseTitle: baseTitle,
  };
})(window.MusicHub);
