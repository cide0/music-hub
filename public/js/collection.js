/*
 * The vinyl collection: every record unboxed in the Store, newest first,
 * on cards like the Discogs page's - the album's cover as the sleeve, the
 * record sliding out and spinning on hover. Play swaps the collection for
 * a turntable: the record drops onto it and spins while its album plays
 * on the user's Spotify.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var NO_HOVER = window.matchMedia && window.matchMedia('(hover: none)').matches;
  var REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var els = {};
  // Draws each card's record as it scrolls into view on touch screens.
  var recordObserver = null;
  // Holds the animations of the cards scrolled out of view (vinyl.pauseOffscreen).
  var offscreen = null;
  // Each vinyl's card in the grid, for tearing it up when it's removed.
  var cardOf = new WeakMap();
  // While a removed vinyl's card tears apart, the grid waits to redraw.
  var tearing = false;
  // Bumped each time the player opens or closes, so a slow answer from
  // Spotify for a record no longer playing is ignored.
  var playRun = 0;
  var playerParts = null;
  // What's on the turntable: { vinyl, record, started, tracks, fraction,
  // elsewhere, offAlbum, at, expect, playing, listenedMs, powerPending,
  // powerAt } - see openPlayer.
  var player = null;
  // Spotify doesn't say when the track changes, so the player asks: a
  // moment after the track should end, and every POLL_MS in any case -
  // for a skip or a pause in the Spotify app.
  var POLL_MS = 3000;
  var TRACK_END_SLACK_MS = 600;
  // After the power button, once Spotify has had a moment to catch up.
  var POLL_AFTER_POWER_MS = 700;
  // Paused or resumed in Spotify itself, the turntable switches to match -
  // but only on an answer asked for at least this long after the page's
  // own last play, pause or resume was answered, so one that doesn't know
  // of it yet can't switch it straight back.
  var POWER_SETTLE_MS = 2500;
  var OFF_ALBUM_RECHECK_MS = 2000;
  // After a track button: Spotify takes a moment to get there, and until
  // it tells of the track skipped to (for up to SKIP_EXPECT_MS) the player
  // keeps showing that one and asks again every SKIP_RECHECK_MS.
  var POLL_AFTER_SKIP_MS = 1000;
  var SKIP_RECHECK_MS = 800;
  var SKIP_EXPECT_MS = 4000;
  // Back past a track's first few seconds starts it again, as on a CD
  // player - before that, it's the track before.
  var RESTART_AFTER_MS = 3000;
  // The needle put down at the very end of the album plays the last
  // track's last few seconds rather than nothing.
  var DROP_END_MARGIN_MS = 3000;
  // Listening pays: LISTEN_COINS for every LISTEN_MS of the album played
  // with the page open in front - counted each LISTEN_TICK_MS, flying out
  // of the record into the balance. A wheel exclusive on the turntable
  // pays EXCLUSIVE_LISTEN_FACTOR times as much.
  var LISTEN_COINS = 5;
  var EXCLUSIVE_LISTEN_FACTOR = 2;
  var LISTEN_MS = 20000;
  var LISTEN_TICK_MS = 1000;
  var listenTimer = 0;
  // Settings' switch for those coins' clink: on unless turned off, so it
  // can be kept from sounding over the album.
  var LISTEN_COIN_SOUND_SETTING = 'listenCoinSound';
  var pollTimer = 0;
  // Bumped each time a new ask is scheduled, so an answer overtaken by one
  // (from before a pause, say) is ignored.
  var pollRun = 0;
  // What the search box holds, as typed, and the sort: by date or by
  // rating, one at a time.
  var query = '';
  var sort = { key: 'date', dir: 'desc' };
  // The Album Suggester's history, where each album's rating is kept.
  var HISTORY_KEY = 'albumSuggesterHistory';
  // Each album's rating by its Spotify id, read afresh on every render.
  var ratings = {};
  // 'all' | 'exclusive': every vinyl, or only the Daily Spin's wheel exclusives.
  var activeFilter = 'all';
  // The vinyl the remove dialog is asking about.
  var pendingRemoval = null;
  // The vinyls the grid shows, in its order (render), and the ones the
  // player's arrows go round - those of them with an album to play, as
  // they were when Play was pressed.
  var shownVinyls = [];
  var queue = [];
  // The jukebox turning to another vinyl (switchVinyl), or turned by hand
  // (grabRecord): { timers, nodes, cleanup } - null while it isn't.
  var switching = null;

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

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * The record as vinyl.js draws it: the album's cover as its label, or -
   * for a vinyl unboxed before albums were picked - the app's logo.
   */
  function renderRecord(vinyl) {
    var spec = MusicHub.vinyl.describe(vinyl.format);
    var imageUrl = vinyl.album && vinyl.album.imageUrl;
    var record = MusicHub.vinyl.render(spec, { seed: vinyl.seed, imageUrl: imageUrl });
    if (!imageUrl) {
      record.classList.add('vinyl--house');
    }
    return record;
  }

  /* ---------------------------------------------------------------- cards */

  /**
   * Puts the record behind the sleeve, the pattern behind the card's text,
   * and gives the card the record's colours to glow in - on first hover,
   * as on the Discogs page, so a big collection stays light.
   */
  function addRecord(card, cover, vinyl) {
    if (card.record) {
      return card.record;
    }
    var spec = MusicHub.vinyl.describe(vinyl.format);
    card.record = renderRecord(vinyl);
    cover.insertBefore(card.record, cover.firstChild);
    MusicHub.vinyl.setPlaying(card.record, false);

    var body = card.querySelector('.release-card__body');
    var imageUrl = vinyl.album && vinyl.album.imageUrl;
    body.insertBefore(MusicHub.vinyl.backdrop(spec, { seed: vinyl.seed, imageUrl: imageUrl }), body.firstChild);

    var colors = MusicHub.vinyl.glowColors(spec);
    card.style.setProperty('--record-glow', colors.glow);
    card.style.setProperty('--record-accent', colors.accent);
    return card.record;
  }

  /** Hover or keyboard focus pulls the record out and spins it. */
  function bindRecord(card, cover, vinyl) {
    var pending = 0;

    function start() {
      card.classList.add('release-card--playing');
      MusicHub.vinyl.setPlaying(card.record, true);
    }

    function play() {
      var fresh = !card.record;
      addRecord(card, cover, vinyl);
      window.cancelAnimationFrame(pending);
      if (!fresh) {
        start();
        return;
      }
      // A frame after a freshly built record is in place, so it slides
      // out rather than appearing already out.
      pending = window.requestAnimationFrame(function () {
        pending = window.requestAnimationFrame(start);
      });
    }

    function stop() {
      window.cancelAnimationFrame(pending);
      card.classList.remove('release-card--playing');
      if (card.record) {
        MusicHub.vinyl.setPlaying(card.record, false);
      }
    }

    // For the touch screens' spotlight (spotlightWhenCentred).
    card.playRecord = play;
    card.stopRecord = stop;

    // On touch screens the spotlight alone starts and stops a card: a touch
    // ending, or turning into a scroll, counts as the pointer leaving, and a
    // tap can move the focus - either would stop a card still in the middle
    // of the screen.
    if (NO_HOVER) {
      return;
    }

    card.addEventListener('pointerenter', function (event) {
      if (event.pointerType !== 'touch') {
        play();
      }
    });
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focusin', play);
    card.addEventListener('focusout', function (event) {
      if (!card.contains(event.relatedTarget)) {
        stop();
      }
    });

    // The highlight on the record follows the cursor.
    card.addEventListener('pointermove', function (event) {
      if (!card.record) {
        return;
      }
      var rect = card.record.getBoundingClientRect();
      card.record.style.setProperty('--light-x', ((event.clientX - rect.left) / rect.width * 100) + '%');
      card.record.style.setProperty('--light-y', ((event.clientY - rect.top) / rect.height * 100) + '%');
    });
  }

  /**
   * Touch screens can't hover: the record is drawn once the card comes near
   * the screen, ready for the spotlight (spotlightWhenCentred) to bring out.
   */
  function drawRecordWhenVisible(card, cover, vinyl) {
    if (!('IntersectionObserver' in window)) {
      addRecord(card, cover, vinyl);
      return;
    }
    if (!recordObserver) {
      recordObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            recordObserver.unobserve(entry.target);
            entry.target.drawRecord();
          }
        });
      }, { rootMargin: '300px 0px' });
    }
    card.drawRecord = function () {
      addRecord(card, cover, vinyl);
    };
    recordObserver.observe(card);
  }

  /*
   * Touch screens' stand-in for hovering: as the page scrolls, the cards
   * crossing the middle of the screen (a thin band there, SPOTLIGHT_MARGIN
   * in from top and bottom - one row at a time, the next taking over as it
   * comes through) play as a hovered one does - sleeve aside, record out
   * and spinning - and stop again as they move on. Not with reduced motion:
   * cards jumping out and back while scrolling would be the very motion
   * that's unwanted, so the cards just stay as they are.
   */
  var SPOTLIGHT_MARGIN = '-48% 0px -48% 0px';
  var spotlightObserver = null;

  function spotlightWhenCentred(card) {
    if (!('IntersectionObserver' in window) || REDUCED_MOTION) {
      return;
    }
    if (!spotlightObserver) {
      spotlightObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.playRecord();
          } else {
            entry.target.stopRecord();
          }
        });
      }, { rootMargin: SPOTLIGHT_MARGIN });
    }
    spotlightObserver.observe(card);
  }

  /** A record only the Daily Spin hands out (vinyl-catalog.js). */
  /**
   * The album history entry whose rating a vinyl's album shows: the last
   * rated one, else the last one at all (unrated), else null when the
   * album isn't in the history (any more).
   */
  function historyEntry(listened, albumId) {
    var rated = null;
    var any = null;
    listened.forEach(function (entry) {
      if (entry && entry.spotifyAlbumId === albumId) {
        any = entry;
        if (typeof entry.rating === 'number') {
          rated = entry;
        }
      }
    });
    return rated || any;
  }

  /**
   * The album history's ratings by Spotify album id: 1-100, or null for an
   * album that's in the history unrated. Albums not in it have no key.
   */
  function loadRatings() {
    var stored = MusicHub.storage.read(HISTORY_KEY, null);
    var listened = stored && Array.isArray(stored.listened) ? stored.listened : [];
    var byId = {};
    listened.forEach(function (entry) {
      if (entry && entry.spotifyAlbumId) {
        var rating = typeof entry.rating === 'number' ? entry.rating : null;
        // A rated entry wins over an unrated one, as historyEntry picks them.
        if (rating !== null || !(entry.spotifyAlbumId in byId)) {
          byId[entry.spotifyAlbumId] = rating;
        }
      }
    });
    return byId;
  }

  /**
   * Opens the Albums page's Edit rating modal on the vinyl's album. The
   * change lands in the album history entry whose rating the pill shows.
   */
  function editRating(vinyl) {
    var stored = MusicHub.storage.read(HISTORY_KEY, null);
    var listened = stored && Array.isArray(stored.listened) ? stored.listened : [];
    var entry = historyEntry(listened, vinyl.album.id);
    if (!entry) {
      return;
    }
    MusicHub.ratingDialog.open(entry, function (rating) {
      entry.rating = rating;
      MusicHub.storage.write(HISTORY_KEY, stored);
      render();
    });
  }

  /** The user's rating of the vinyl's album, or null if it has none. */
  function ratingOf(vinyl) {
    var id = vinyl.album && vinyl.album.id;
    return id && typeof ratings[id] === 'number' ? ratings[id] : null;
  }

  function isExclusive(vinyl) {
    return MusicHub.vinylCatalog.exclusives.some(function (exclusive) {
      return exclusive.format === vinyl.format;
    });
  }

  function card(vinyl) {
    var album = vinyl.album || null;
    var node = el('article', 'release-card vinyl-card');
    // A wheel exclusive: its turning gold frame and gold style label.
    if (isExclusive(vinyl)) {
      node.classList.add('vinyl-card--exclusive');
    }

    var cover = el('div', 'release-card__cover');
    // The sleeve: the album's cover, or the app's logo without one.
    var sleeve = el('div', 'release-card__sleeve' + (album && album.imageUrl ? '' : ' release-card__sleeve--house'));
    if (album && album.imageUrl) {
      var image = el('img', 'release-card__image');
      image.src = album.imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      sleeve.appendChild(image);
    }
    cover.appendChild(sleeve);
    // The record's style, as a tag in the cover's top-left corner.
    if (album) {
      var style = el('span', 'vinyl-card__style');
      // An exclusive's in the gold username's pill: its polished-gold
      // lettering needs a box of its own, inside the gold frame.
      style.appendChild(el('span', 'vinyl-card__style-name', vinyl.format));
      style.title = vinyl.format;
      cover.appendChild(style);
    }
    node.appendChild(cover);
    // A wheel exclusive sparkles like an attended concert's card, while
    // its record is in the sleeve (.vinyl-card--exclusive in the stylesheet).
    if (isExclusive(vinyl)) {
      var glitter = el('span', 'concert-card__glitter');
      glitter.setAttribute('aria-hidden', 'true');
      node.appendChild(glitter);
    }

    bindRecord(node, cover, vinyl);
    if (NO_HOVER) {
      drawRecordWhenVisible(node, cover, vinyl);
      spotlightWhenCentred(node);
    }

    var body = el('div', 'release-card__body');
    if (album) {
      // The album's name, with the user's rating from the album history
      // on the right of the same line.
      var heading = el('div', 'vinyl-card__heading');
      var title = el('h3', 'release-card__title');
      // A link for the keyboard; a click anywhere on the card opens it too.
      if (album.id) {
        var titleLink = el('a', 'vinyl-card__title-link', album.name);
        titleLink.href = 'spotify:album:' + album.id;
        titleLink.title = 'Open in Spotify';
        title.appendChild(titleLink);
      } else {
        title.textContent = album.name;
      }
      heading.appendChild(title);
      // Only an album in the history has a rating to show - an unrated
      // one gets an empty dashed pill to give it one.
      if (album.id in ratings) {
        var rated = ratingOf(vinyl);
        // Opens the Albums page's modal to change (or take away) the rating.
        var rating = el('button', 'rating-pill' + (rated === null ? ' rating-pill--empty' : ''),
          rated === null ? '' : String(rated));
        rating.type = 'button';
        rating.setAttribute('aria-label', rated === null
          ? 'Rate ' + album.name
          : 'Rated ' + rated + ' out of 100 - edit the rating of ' + album.name);
        rating.title = rated === null ? 'Add a rating' : 'Edit rating';
        rating.addEventListener('click', function () {
          editRating(vinyl);
        });
        heading.appendChild(rating);
      }
      body.appendChild(heading);
      body.appendChild(el('p', 'release-card__artist', album.artist));
    } else {
      body.appendChild(el('h3', 'release-card__title', vinyl.format));
    }
    var added = formatDate(vinyl.unboxedAt);
    if (added) {
      body.appendChild(el('p', 'release-card__meta', 'Added ' + added));
    }

    // Remove on the left, a round icon button, and - only a vinyl pressed
    // for an album has something to play - play on the right, a primary
    // button with just its triangle.
    var what = album ? album.name + ' by ' + album.artist : vinyl.format;
    var foot = el('div', 'vinyl-card__foot');
    var remove = el('button', 'icon-button vinyl-card__action vinyl-card__remove');
    remove.type = 'button';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" />'
      + '<line x1="6" y1="6" x2="18" y2="18" /></svg>';
    remove.title = 'Remove from collection';
    remove.setAttribute('aria-label', 'Remove ' + what + ' from your collection');
    remove.addEventListener('click', function () {
      confirmRemove(vinyl);
    });
    foot.appendChild(remove);
    if (album && album.id) {
      var play = el('button', 'button button--primary vinyl-card__play');
      play.type = 'button';
      play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4" /></svg>';
      play.title = 'Play';
      play.setAttribute('aria-label', 'Play ' + what);
      play.addEventListener('click', function () {
        openPlayer(vinyl);
      });
      foot.appendChild(play);
    }
    body.appendChild(foot);
    node.appendChild(body);

    // The whole card opens the album in Spotify - all but its buttons and
    // the title's own link, and not a click that ends selecting text.
    if (album && album.id) {
      node.classList.add('vinyl-card--linked');
      node.addEventListener('click', function (event) {
        if (event.target.closest('button, a')) {
          return;
        }
        var selection = window.getSelection();
        if (selection && !selection.isCollapsed && node.contains(selection.anchorNode)) {
          return;
        }
        MusicHub.spotify.openInApp('spotify:album:' + album.id);
      });
    }
    return node;
  }

  /** Lower case, without accents, so "Björk" is found by "bjork". */
  function searchable(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /**
   * The style, the album, the artist and the rating; every word typed has to
   * match one of them - "7" finds the vinyls rated 7, 78 or 97 too.
   */
  function matchesQuery(vinyl) {
    var album = vinyl.album || {};
    // An unrated vinyl's null rating joins as nothing.
    var haystack = searchable([vinyl.format, album.name, album.artist, ratingOf(vinyl)].join(' '));
    return searchable(query).split(/\s+/).filter(Boolean).every(function (word) {
      return haystack.indexOf(word) !== -1;
    });
  }

  function byDate(a, b) {
    return String(a.unboxedAt || '').localeCompare(String(b.unboxedAt || ''));
  }

  /** One sort at a time; unrated vinyls always go after rated ones. */
  function sortVinyls(vinyls) {
    var sign = sort.dir === 'asc' ? 1 : -1;
    return vinyls.slice().sort(function (a, b) {
      if (sort.key === 'rating') {
        var aRating = ratingOf(a);
        var bRating = ratingOf(b);
        if ((aRating === null) !== (bRating === null)) {
          return aRating === null ? 1 : -1;
        }
        if (aRating !== null && aRating !== bRating) {
          return sign * (aRating - bRating);
        }
        // Ties (and the unrated) newest first.
        return -byDate(a, b);
      }
      return sign * byDate(a, b);
    });
  }

  var SORT_LABELS = {
    date: { label: 'Date', desc: 'newest first', asc: 'oldest first' },
    rating: { label: 'Rating', desc: 'highest first', asc: 'lowest first' },
  };

  function renderSort() {
    Array.prototype.forEach.call(els.sort.querySelectorAll('[data-sort]'), function (button) {
      var key = button.getAttribute('data-sort');
      var active = key === sort.key;
      var labels = SORT_LABELS[key];
      button.classList.toggle('filter-button--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = labels.label + (active ? (sort.dir === 'desc' ? ' \u2193' : ' \u2191') : '');
      button.title = 'Sort by ' + labels.label.toLowerCase() + ', '
        + (active ? labels[sort.dir === 'desc' ? 'asc' : 'desc'] : labels.desc);
      button.setAttribute('aria-label', active
        ? 'Sorted by ' + labels.label.toLowerCase() + ', ' + labels[sort.dir]
        : 'Sort by ' + labels.label.toLowerCase());
    });
  }

  /** "Exclusives" only with one to show - otherwise back to All. */
  function renderFilters(all) {
    var exclusiveButton = els.filters.querySelector('[data-filter="exclusive"]');
    exclusiveButton.disabled = !all.some(isExclusive);
    if (exclusiveButton.disabled && activeFilter === 'exclusive') {
      activeFilter = 'all';
    }
    Array.prototype.forEach.call(els.filters.querySelectorAll('.filter-button'), function (button) {
      var active = button.getAttribute('data-filter') === activeFilter;
      button.classList.toggle('filter-button--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function render() {
    var all = MusicHub.wallet.vinyls();
    ratings = loadRatings();
    renderFilters(all);
    var shown = sortVinyls(all.filter(function (vinyl) {
      return (activeFilter !== 'exclusive' || isExclusive(vinyl)) && matchesQuery(vinyl);
    }));
    els.grid.textContent = '';
    els.empty.hidden = all.length > 0;
    els.toolbar.hidden = !all.length;
    els.searchClear.hidden = !query;
    els.noMatch.hidden = !all.length || shown.length > 0;
    els.noMatch.textContent = (activeFilter === 'exclusive' ? 'No wheel exclusives' : 'No vinyls')
      + ' match \u201c' + query.trim() + '\u201d.';
    els.count.textContent = MusicHub.wallet.format(all.length) + ' of '
      + MusicHub.wallet.format(MusicHub.vinylCatalog.size) + ' collected';
    renderSort();
    shownVinyls = shown;
    shown.forEach(function (vinyl) {
      var node = card(vinyl);
      cardOf.set(vinyl, node);
      els.grid.appendChild(node);
    });
    // The exclusives' gold frames and labels only turn on screen.
    if (offscreen) {
      offscreen.disconnect();
    }
    offscreen = MusicHub.vinyl.pauseOffscreen(els.grid.children);
  }

  function setQuery(value) {
    query = value;
    els.search.value = value;
    render();
  }

  /* --------------------------------------------------------------- remove */

  /** Asks, in the page's own dialog, before a vinyl leaves the collection. */
  function confirmRemove(vinyl) {
    pendingRemoval = vinyl;
    var album = vinyl.album;
    var what = album ? album.name + ' by ' + album.artist + ' (' + vinyl.format + ')' : vinyl.format;
    if (isExclusive(vinyl)) {
      // Won on the Daily Spin, not bought: nothing to refund, and it goes
      // back on the wheel (pickExclusive skips only the ones held).
      els.removeTitle.textContent = 'Remove this Wheel Exclusive?';
      els.removeText.textContent = what + ' will be removed from your collection. '
        + vinyl.format + ' goes back on the Wheel of Fortune, where it can be won again - '
        + "but only there, and this can't be undone.";
    } else {
      els.removeTitle.textContent = 'Remove this vinyl?';
      els.removeText.textContent = what
        + ' will be removed from your collection, and its style can be unboxed again in the Store. '
        + "The coins it cost aren't refunded, and this can't be undone.";
    }
    els.removeDialog.showModal();
    // Cancel is the safe default for Enter.
    els.removeCancel.focus();
  }

  /**
   * Takes a vinyl out of the collection - stored straight away, so leaving
   * mid-tear loses nothing - and tears its card in two, as the Album
   * Suggester tears a dismissed cover (tear.js). The grid closes the gap
   * once the halves are gone.
   */
  function removeVinyl(vinyl) {
    var node = cardOf.get(vinyl);
    tearing = true;
    MusicHub.wallet.removeVinyl(vinyl);
    var torn = node && node.isConnected ? MusicHub.tear.apart(node) : Promise.resolve();
    torn.then(function () {
      tearing = false;
      render();
    });
  }

  /* --------------------------------------------------------------- player */

  function setStatus(text) {
    els.status.textContent = text;
  }

  /** What went wrong starting the album, and what can be done about it. */
  function showPlaybackError(err, album) {
    var code = err && err.code;
    els.actions.textContent = '';
    if (code === 'permission') {
      setStatus('Music Hub needs your permission to play music on your Spotify. Log in to Spotify again to allow it.');
      var login = el('a', 'button button--primary', 'Log in again');
      login.href = '/login?from=' + encodeURIComponent('/collection');
      els.actions.appendChild(login);
    } else {
      setStatus(code === 'premium'
        ? 'Spotify only lets Premium accounts start music from other apps - open the album in Spotify instead.'
        : code === 'no-device'
          ? 'Couldn’t find a Spotify app to play on. Open Spotify, then press Play again.'
          : 'Couldn’t start the album on Spotify. ' + ((err && err.message) || ''));
    }
    var open = el('button', 'button button--primary', 'Open in Spotify');
    open.type = 'button';
    open.addEventListener('click', function () {
      MusicHub.spotify.openInApp('spotify:album:' + album.id);
    });
    els.actions.appendChild(open);
    els.actions.hidden = false;
  }

  /**
   * Starts the player's album on the user's Spotify, from the top. `run`
   * is the player's run, so answers for a record no longer on the
   * turntable are ignored.
   */
  function startAlbum(run) {
    var album = player.vinyl.album;
    els.actions.hidden = true;
    els.actions.textContent = '';
    setStatus('Starting the album on Spotify\u2026');
    powerRequest(MusicHub.spotify.playAlbum(album.id, {
      onLaunch: function () {
        if (run === playRun) {
          setStatus('Opening Spotify\u2026');
        }
      },
    })).then(function () {
      if (run === playRun) {
        player.started = true;
        setStatus('Playing on Spotify');
        updateTrackButtons();
        watchPlayback(run, POLL_AFTER_POWER_MS);
      }
    }).catch(function (err) {
      if (run === playRun) {
        console.warn('Could not start the album on Spotify', err);
        showPlaybackError(err, album);
      }
    });
  }

  /* ---------------------------------------------------------- now playing */

  /** Whether Spotify is on the player's album - started from it, or one of its tracks. */
  function onAlbum(state) {
    var albumId = player.vinyl.album.id;
    return (state.context && state.context.uri === 'spotify:album:' + albumId)
      || (state.item.album && state.item.album.id === albumId);
  }

  /**
   * Where Spotify is in the album: the track's place in it, and how far
   * through the whole album - the tracks before it and the part of it
   * played, over the album's length - with that length. Without the
   * album's tracks, as if every track were as long as this one.
   */
  function albumProgress(state) {
    var item = state.item;
    var tracks = player.tracks || [];
    var index = -1;
    tracks.forEach(function (track, i) {
      if (index === -1 && track.disc === item.disc_number && track.number === item.track_number) {
        index = i;
      }
    });
    if (index === -1) {
      var count = (item.album && item.album.total_tracks) || item.track_number || 1;
      return {
        index: -1,
        number: item.track_number,
        count: count,
        fraction: (item.track_number - 1 + state.progress_ms / item.duration_ms) / count,
        totalMs: item.duration_ms * count,
      };
    }
    var totalMs = albumMs(tracks.length);
    return {
      index: index, number: index + 1, count: tracks.length,
      fraction: (albumMs(index) + state.progress_ms) / totalMs, totalMs: totalMs,
    };
  }

  /** How long the album's first `count` tracks play for, together. */
  function albumMs(count) {
    return player.tracks.slice(0, count).reduce(function (sum, track) {
      return sum + track.durationMs;
    }, 0);
  }

  /**
   * The track playing: its name under the artist, its letters in a wave
   * running through them while it plays (still while paused), and where
   * it is in the album - "5/20" - in the deck's top-right corner. `song`
   * is { name, uri }: the + beside it puts that one on playlists.
   */
  function showTrack(number, count, song, playing) {
    var name = song.name;
    if (els.trackName.dataset.name !== name) {
      els.trackName.dataset.name = name;
      els.trackName.textContent = '';
      // A word at a time, so the name still wraps between words; each
      // letter numbered (--i) for its turn in the wave.
      var i = 0;
      name.split(' ').forEach(function (word, w) {
        if (w) {
          els.trackName.appendChild(document.createTextNode(' '));
        }
        var wordEl = el('span', 'player__track-word');
        Array.from(word).forEach(function (letter) {
          var letterEl = el('span', 'player__track-letter', letter);
          letterEl.style.setProperty('--i', i);
          i += 1;
          wordEl.appendChild(letterEl);
        });
        els.trackName.appendChild(wordEl);
      });
    }
    els.trackLabel.textContent = 'Now playing: ' + name;
    els.track.title = name;
    els.track.classList.toggle('player__track--paused', !playing);
    els.song.hidden = false;
    els.trackCount.textContent = number + '/' + count;
    els.trackCount.hidden = false;
    showSaveButton(song);
  }

  function hideTrack() {
    els.song.hidden = true;
    els.trackCount.hidden = true;
  }

  /**
   * Whether `state` is where the last track button or seek went - the
   * track gone to, from the point gone to no further in than it can have
   * got since. Until it is, Spotify is still catching up.
   */
  function reachedSkip(state, progress) {
    var expect = player.expect;
    return progress.index === expect.index && state.progress_ms >= expect.positionMs - 2000
      && state.progress_ms <= expect.positionMs + Date.now() - expect.at + 2000;
  }

  /**
   * Shows what Spotify is playing: the track under the album and artist,
   * and the tonearm as far in as the album has got - held still while
   * Spotify is paused, or has moved on to something else. Paused or
   * resumed in Spotify itself, the turntable switches off or on with it.
   * `askedAt`: when Spotify was asked. Returns how long until it's worth
   * asking again.
   */
  function showPlayback(state, askedAt) {
    // The tonearm in hand shows where it's held; Spotify's had its say
    // once it's put down.
    if (player.armHeld) {
      return POLL_MS;
    }
    var still = reducedMotion();
    if (player.expect) {
      var arrived = state && onAlbum(state) && reachedSkip(state, albumProgress(state));
      if (!arrived && Date.now() - player.expect.at < SKIP_EXPECT_MS) {
        return SKIP_RECHECK_MS;
      }
      player.expect = null;
    }
    if (!state || !onAlbum(state)) {
      player.playing = false;
      hideTrack();
      MusicHub.turntable.setNeedle(playerParts, player.fraction, 0, { still: still });
      MusicHub.turntable.setProgress(playerParts, null);
      if (!state || !player.started || player.elsewhere) {
        return POLL_MS;
      }
      // Just after the album starts, Spotify can still be telling of the
      // track before it: only a second look says it has moved on.
      player.offAlbum += 1;
      if (player.offAlbum < 2) {
        return OFF_ALBUM_RECHECK_MS;
      }
      player.elsewhere = true;
      player.at = null;
      setStatus('Spotify is playing something else now');
      updateTrackButtons();
      return POLL_MS;
    }
    player.offAlbum = 0;
    player.playing = state.is_playing;
    if (player.elsewhere) {
      player.elsewhere = false;
      setStatus(state.is_playing ? 'Playing on Spotify' : 'Paused on Spotify');
      updateTrackButtons();
    }

    var progress = albumProgress(state);
    player.fraction = progress.fraction;
    // Where it is in the album, for the track buttons to go on from.
    player.at = progress.index === -1 ? null : {
      index: progress.index, progressMs: state.progress_ms, playing: state.is_playing, time: Date.now(),
      durationMs: state.item.duration_ms,
    };
    showTrack(progress.number, progress.count, state.item, state.is_playing);
    MusicHub.turntable.setNeedle(playerParts, progress.fraction,
      state.is_playing ? 1 / progress.totalMs : 0, { still: still });
    if (state.is_playing !== playerParts.on && player.started && !player.powerPending && !switching
      && askedAt - player.powerAt >= POWER_SETTLE_MS) {
      switchTurntable(state.is_playing);
      setStatus(state.is_playing ? 'Playing on Spotify' : 'Paused on Spotify');
    }
    // The song's own progress in the groove under the record - held where
    // it is once switched off, even if Spotify hasn't paused yet.
    MusicHub.turntable.setProgress(playerParts, state.progress_ms / state.item.duration_ms,
      state.is_playing && playerParts.on ? 1 / state.item.duration_ms : 0, state.item.duration_ms);

    if (!state.is_playing) {
      return POLL_MS;
    }
    return Math.min(POLL_MS, Math.max(0, state.item.duration_ms - state.progress_ms) + TRACK_END_SLACK_MS);
  }

  /** Asks Spotify what it's playing, `delay` ms from now, and keeps on asking. */
  function watchPlayback(run, delay) {
    pollRun += 1;
    var poll = pollRun;
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(function () {
      // A hidden tab stops asking; it asks again as soon as it's back.
      if (run !== playRun || document.hidden) {
        return;
      }
      var askedAt = Date.now();
      MusicHub.spotify.getPlaybackState().then(function (state) {
        if (run === playRun && poll === pollRun) {
          watchPlayback(run, showPlayback(state, askedAt));
        }
      }).catch(function (err) {
        if (run === playRun && poll === pollRun) {
          console.warn('Could not read what Spotify is playing', err);
          watchPlayback(run, POLL_MS);
        }
      });
    }, delay);
  }

  /**
   * The track buttons work while the album is on and the turntable switched
   * on. The tonearm can be moved by hand once the album has started and
   * its tracks are known (to tell where on the record which one is) - on
   * or off, and even with Spotify on something else, to put the album back on.
   */
  function updateTrackButtons() {
    if (!playerParts) {
      return;
    }
    var usable = !!(player && player.started && !player.elsewhere && playerParts.on);
    playerParts.prev.disabled = !usable;
    playerParts.next.disabled = !usable;
    MusicHub.turntable.setSeekable(playerParts, usable);
    MusicHub.turntable.setArmDraggable(playerParts, !!(player && player.started && player.tracks && player.tracks.length));
  }

  /**
   * A track button: the next track (`forward`) or back - to the start of
   * this one, or the one before (RESTART_AFTER_MS). The track line and
   * the tonearm go there straight away, worked out from the album's track
   * lengths; Spotify is told, and asked a moment later - on the same timer
   * as ever - whether it got there.
   */
  function skip(forward) {
    var run = playRun;
    var album = player.vinyl.album;
    var at = player.at;
    var index = -1;
    var request;
    if (forward) {
      index = at ? at.index + 1 : -1;
      request = MusicHub.spotify.skipToNext();
    } else {
      var playedMs = at ? at.progressMs + (at.playing ? Date.now() - at.time : 0) : 0;
      if (at && (playedMs > RESTART_AFTER_MS || at.index === 0)) {
        index = at.index;
        request = MusicHub.spotify.seekTo(0);
      } else {
        index = at ? at.index - 1 : -1;
        request = MusicHub.spotify.skipToPrevious();
      }
    }

    // Past the last track Spotify decides what comes next: that's left to asking.
    if (at && index >= 0 && index < player.tracks.length) {
      var totalMs = albumMs(player.tracks.length);
      var durationMs = player.tracks[index].durationMs;
      player.at = { index: index, progressMs: 0, playing: at.playing, time: Date.now(), durationMs: durationMs };
      player.expect = { index: index, positionMs: 0, at: Date.now() };
      player.fraction = albumMs(index) / totalMs;
      showTrack(index + 1, player.tracks.length, player.tracks[index], at.playing);
      MusicHub.turntable.setNeedle(playerParts, player.fraction, at.playing ? 1 / totalMs : 0, {
        still: reducedMotion(), lift: true,
      });
      MusicHub.turntable.setProgress(playerParts, 0, at.playing ? 1 / durationMs : 0, durationMs);
    }

    request.then(function () {
      if (run === playRun) {
        watchPlayback(run, POLL_AFTER_SKIP_MS);
      }
    }).catch(function (err) {
      if (run !== playRun) {
        return;
      }
      console.warn('Could not skip on Spotify', err);
      player.expect = null;
      showPlaybackError(err, album);
      watchPlayback(run, 0);
    });
  }

  /**
   * The progress groove clicked, dragged or moved with the keys: Spotify
   * goes to that point of the song (`fraction`, 0 to 1). As with a track
   * button, the groove, the time and the tonearm go there straight away,
   * and Spotify is asked a moment later whether it got there.
   */
  function seek(fraction) {
    var run = playRun;
    var album = player.vinyl.album;
    var at = player.at;
    if (!at) {
      return;
    }
    var positionMs = fraction * at.durationMs;
    var totalMs = albumMs(player.tracks.length);
    player.at = { index: at.index, progressMs: positionMs, playing: at.playing, time: Date.now(), durationMs: at.durationMs };
    player.expect = { index: at.index, positionMs: positionMs, at: Date.now() };
    player.fraction = (albumMs(at.index) + positionMs) / totalMs;
    MusicHub.turntable.setNeedle(playerParts, player.fraction, at.playing ? 1 / totalMs : 0, {
      still: reducedMotion(), lift: true,
    });
    MusicHub.turntable.setProgress(playerParts, fraction, at.playing ? 1 / at.durationMs : 0, at.durationMs);

    MusicHub.spotify.seekTo(positionMs).then(function () {
      if (run === playRun) {
        watchPlayback(run, POLL_AFTER_SKIP_MS);
      }
    }).catch(function (err) {
      if (run !== playRun) {
        return;
      }
      console.warn('Could not seek on Spotify', err);
      player.expect = null;
      showPlaybackError(err, album);
      watchPlayback(run, 0);
    });
  }

  /**
   * Where `fraction` of the way through the album is: the track (its
   * index) and how far into it - kept off the album's very end
   * (DROP_END_MARGIN_MS).
   */
  function albumPoint(fraction) {
    var tracks = player.tracks;
    var totalMs = albumMs(tracks.length);
    var albumAtMs = Math.max(0, Math.min(fraction * totalMs, totalMs - DROP_END_MARGIN_MS));
    // A needle settled onto a track's start lands on it, not a rounding
    // error short of it, at the end of the one before.
    var index = 0;
    while (index < tracks.length - 1 && albumMs(index + 1) <= albumAtMs + 1) {
      index += 1;
    }
    var track = tracks[index];
    var positionMs = Math.max(0, Math.min(albumAtMs - albumMs(index), track.durationMs));
    return { index: index, track: track, positionMs: positionMs < 1 ? 0 : positionMs, totalMs: totalMs };
  }

  /**
   * The tonearm picked up: the music stops, as the needle leaves the
   * record - Spotify pauses, if it's playing the album, and the groove
   * and the track line hold still. The turntable stays on, the platter
   * turning, until the arm's put down.
   */
  function liftNeedle() {
    if (!player) {
      return;
    }
    var run = playRun;
    player.armHeld = true;
    player.liftPaused = false;
    window.clearTimeout(pollTimer);
    if (!player.playing || player.elsewhere || !playerParts.on) {
      return;
    }
    player.liftPaused = true;
    player.playing = false;
    var at = player.at;
    if (at) {
      var playedMs = Math.min(at.durationMs, at.progressMs + (at.playing ? Date.now() - at.time : 0));
      player.at = { index: at.index, progressMs: playedMs, playing: false, time: Date.now(), durationMs: at.durationMs };
      MusicHub.turntable.setProgress(playerParts, playedMs / at.durationMs, 0, at.durationMs);
    }
    els.track.classList.add('player__track--paused');
    powerRequest(MusicHub.spotify.pausePlayback()).catch(function (err) {
      // Turned down when nothing's playing: it's paused all the same.
      if (run === playRun && err.code !== 'failed') {
        console.warn('Could not pause on Spotify', err);
      }
    });
  }

  /**
   * The tonearm moved over the record: the track under the needle shows
   * in the track line, and the point in it in the groove and the time
   * under it - off the record, the last one stays.
   */
  function hoverNeedle(fraction) {
    if (!player || fraction === null) {
      return;
    }
    var point = albumPoint(fraction);
    showTrack(point.index + 1, player.tracks.length, point.track, false);
    MusicHub.turntable.setProgress(playerParts, point.positionMs / point.track.durationMs, 0, point.track.durationMs);
  }

  /**
   * The tonearm moved by hand and let go. Back on its rest (`fraction`
   * null), the turntable switches off and Spotify pauses, as with the power
   * button. Put down on the record, the album plays from there -
   * `fraction` of the way through it, worked out from its track lengths:
   * the track line, the groove and the arm go there straight away, the
   * turntable switches on if it was off, and Spotify is asked a moment
   * later whether it got there.
   */
  function dropNeedle(fraction) {
    if (!player) {
      return;
    }
    var run = playRun;
    var liftPaused = player.liftPaused;
    player.armHeld = false;
    player.liftPaused = false;
    if (fraction === null) {
      if (liftPaused) {
        // Spotify's already paused: only the turntable to switch off.
        switchTurntable(false, { armMoved: true });
        setStatus('Paused on Spotify');
      } else if (playerParts.on) {
        setTurntable(false, { armMoved: true });
      }
      // Back to the track Spotify's really on, from the one last held over.
      watchPlayback(run, POLL_AFTER_POWER_MS);
      return;
    }
    var album = player.vinyl.album;
    var tracks = player.tracks;
    var point = albumPoint(fraction);
    var totalMs = point.totalMs;
    var index = point.index;
    var track = point.track;
    var positionMs = point.positionMs;
    player.at = { index: index, progressMs: positionMs, playing: true, time: Date.now(), durationMs: track.durationMs };
    player.expect = { index: index, positionMs: positionMs, at: Date.now() };
    player.fraction = (albumMs(index) + positionMs) / totalMs;
    player.playing = true;
    player.elsewhere = false;
    player.offAlbum = 0;
    showTrack(index + 1, tracks.length, track, true);
    MusicHub.turntable.setNeedle(playerParts, player.fraction, 1 / totalMs, { still: reducedMotion() });
    if (playerParts.on) {
      updateTrackButtons();
    } else {
      switchTurntable(true, { armMoved: true });
    }
    MusicHub.turntable.setProgress(playerParts, positionMs / track.durationMs, 1 / track.durationMs, track.durationMs);
    els.actions.hidden = true;
    els.actions.textContent = '';
    setStatus('Playing on Spotify');

    powerRequest(MusicHub.spotify.playAlbumAt(album.id, index, positionMs)).then(function () {
      if (run === playRun) {
        watchPlayback(run, POLL_AFTER_SKIP_MS);
      }
    }).catch(function (err) {
      if (run !== playRun) {
        return;
      }
      console.warn('Could not play from the needle on Spotify', err);
      player.expect = null;
      showPlaybackError(err, album);
      watchPlayback(run, 0);
    });
  }

  /**
   * Play: the collection makes way for the turntable, the record drops
   * onto it and spins - and the album starts on the user's Spotify
   * straight away, so the music comes in about as the platter gets going.
   */
  /** The album's vinyl releases on Discogs - a plain search, no API call. */
  function discogsSearchUrl(album) {
    return 'https://www.discogs.com/search/?q='
      + encodeURIComponent(album.artist + ' ' + album.name)
      + '&type=release&format=Vinyl';
  }

  /** A vinyl pressed for an album, which the player can play. */
  function playable(vinyl) {
    return !!(vinyl.album && vinyl.album.id);
  }

  /**
   * `options.switched`: turned to by the jukebox (switchVinyl) - the
   * arrows keep going round the same vinyls, and the focus stays on the
   * arrow pressed. `options.lifted`: the record's already showing at the
   * top of the jukebox's wheel, where its drop starts.
   */
  function openPlayer(vinyl, options) {
    var switched = !!(options && options.switched);
    var album = vinyl.album;
    var run = ++playRun;
    if (!switched) {
      queue = shownVinyls.filter(playable);
    }

    // The album's name opens it in the Spotify app.
    els.title.textContent = '';
    var titleLink = el('a', 'player__title-link', album.name);
    titleLink.href = 'spotify:album:' + album.id;
    titleLink.title = 'Open in Spotify';
    els.title.appendChild(titleLink);
    els.artist.textContent = album.artist;
    els.discogs.href = discogsSearchUrl(album);

    var spec = MusicHub.vinyl.describe(vinyl.format);
    var record = renderRecord(vinyl);
    if (playerParts) {
      MusicHub.turntable.silence(playerParts);
      playerParts.root.remove();
    }
    playerParts = MusicHub.turntable.build(record, {
      glow: MusicHub.vinyl.glowColors(spec).glow,
      powerButton: true,
      trackButtons: true,
      fromEdge: true,
      onSeek: seek,
      onArmDrop: dropNeedle,
      onArmLift: liftNeedle,
      onArmMove: hoverNeedle,
    });
    playerParts.power.addEventListener('click', togglePower);
    playerParts.prev.addEventListener('click', function () {
      skip(false);
    });
    playerParts.next.addEventListener('click', function () {
      skip(true);
    });
    playerParts.record.addEventListener('pointerdown', grabRecord);
    els.deck.appendChild(playerParts.root);
    // Whether the album has actually started on Spotify: switching back on
    // then resumes it, where otherwise it tries to start it again. Its
    // tracks, to tell how far through it Spotify is, how far that was when
    // last asked, and whether Spotify has moved on to something else (and
    // how many times in a row it has said so). Where in the album Spotify
    // was when last asked (`at`), and the track a track button went to,
    // while Spotify catches up (`expect`). Whether Spotify is playing the
    // album, as last asked, and how long it's been listened to towards
    // the next coins. How many of the page's own plays, pauses and resumes
    // Spotify hasn't answered yet, and when it last answered one. Whether
    // the tonearm's held by hand, and whether picking it up paused Spotify.
    player = {
      vinyl: vinyl, record: record, started: false, tracks: null, fraction: 0, elsewhere: false, offAlbum: 0,
      at: null, expect: null, playing: false, listenedMs: 0, powerPending: 0, powerAt: 0,
      armHeld: false, liftPaused: false,
    };
    startListenClock();
    updateTrackButtons();
    hideTrack();
    MusicHub.spotify.getAlbumTracks(album.id).then(function (tracks) {
      if (run === playRun) {
        player.tracks = tracks;
        // Each track's start on the record, for the tonearm to settle onto.
        var totalMs = albumMs(tracks.length);
        MusicHub.turntable.setTrackMarks(playerParts, totalMs ? tracks.map(function (track, i) {
          return albumMs(i) / totalMs;
        }) : []);
        updateTrackButtons();
      }
    }).catch(function (err) {
      console.warn('Could not load the album\u2019s tracks', err);
    });
    startAlbum(run);

    els.view.hidden = true;
    els.player.hidden = false;
    updateSwitchButtons();
    if (!switched) {
      window.scrollTo({ top: 0 });
      els.back.focus({ preventScroll: true });
    }

    if (reducedMotion()) {
      MusicHub.turntable.showPlaying(playerParts);
    } else {
      MusicHub.turntable.play(playerParts, { lifted: !!(options && options.lifted) });
      MusicHub.turntable.playSounds(playerParts);
      // Lava, smash and peppermint patterns move while it plays.
      MusicHub.vinyl.setPlaying(record, true);
    }
    updateGrab();
  }

  /**
   * Switches the turntable off or on - the platter, the arm and the track
   * buttons - without telling Spotify. `options.armMoved`: it's the tonearm
   * moved by hand that switched it (turntable.js setPower).
   */
  function switchTurntable(on, options) {
    MusicHub.turntable.setPower(playerParts, on, {
      still: reducedMotion(), armMoved: !!(options && options.armMoved),
    });
    // Ordinary patterns only move while it plays; a wheel exclusive's art
    // keeps going with the platter stopped.
    MusicHub.vinyl.setPlaying(player.record, (on || isExclusive(player.vinyl)) && !reducedMotion());
    updateTrackButtons();
    updateGrab();
  }

  /** Counts `request` (a play, pause or resume on Spotify) as pending until it's answered. */
  function powerRequest(request) {
    var p = player;
    p.powerPending += 1;
    function settle() {
      p.powerPending -= 1;
      p.powerAt = Date.now();
    }
    request.then(settle, settle);
    return request;
  }

  /**
   * The turntable's power button: off, the platter stops, the arm goes
   * back and Spotify pauses; on, it all starts again and Spotify resumes.
   */
  function togglePower() {
    setTurntable(!playerParts.on);
  }

  /**
   * Switches the turntable on or off and Spotify with it - resumed or
   * paused. `options` as for switchTurntable.
   */
  function setTurntable(on, options) {
    var run = playRun;
    switchTurntable(on, options);

    if (!player.started) {
      // Nothing on Spotify to pause; switched on, it has another go.
      if (on) {
        startAlbum(run);
      }
      return;
    }
    els.actions.hidden = true;
    els.actions.textContent = '';
    var album = player.vinyl.album;
    if (on) {
      setStatus('Resuming on Spotify\u2026');
      powerRequest(MusicHub.spotify.resumePlayback()).then(function () {
        if (run === playRun) {
          setStatus('Playing on Spotify');
          watchPlayback(run, POLL_AFTER_POWER_MS);
        }
      }).catch(function (err) {
        if (run !== playRun) {
          return;
        }
        // Spotify gave up the device while paused: start the album afresh.
        if (err.code === 'no-device') {
          startAlbum(run);
          return;
        }
        console.warn('Could not resume on Spotify', err);
        showPlaybackError(err, album);
      });
    } else {
      setStatus('Pausing on Spotify\u2026');
      powerRequest(MusicHub.spotify.pausePlayback()).then(function () {
        if (run === playRun) {
          setStatus('Paused on Spotify');
          watchPlayback(run, POLL_AFTER_POWER_MS);
        }
      }).catch(function (err) {
        if (run !== playRun) {
          return;
        }
        // Spotify turns a pause down when nothing is playing - it's paused.
        if (err.code === 'failed') {
          setStatus('Paused on Spotify');
          return;
        }
        console.warn('Could not pause on Spotify', err);
        showPlaybackError(err, album);
      });
    }
  }

  /* ------------------------------------------------------------ listening */

  /**
   * Whether the album is being listened to: Spotify playing it, as last
   * asked, the turntable on, and the page in front. In a tab behind others
   * the player stops asking Spotify, so it can't tell - that time isn't
   * counted.
   */
  function listening() {
    return !!(player && player.started && player.playing && !player.elsewhere
      && playerParts && playerParts.on && !document.hidden);
  }

  /**
   * Counts the time listened, and pays LISTEN_COINS for each LISTEN_MS
   * of it - twice that for a wheel exclusive. A tick the browser held back
   * counts for no more than two, so none is ever made up in a burst.
   */
  function startListenClock() {
    window.clearInterval(listenTimer);
    var last = Date.now();
    var coins = LISTEN_COINS * (isExclusive(player.vinyl) ? EXCLUSIVE_LISTEN_FACTOR : 1);
    listenTimer = window.setInterval(function () {
      var now = Date.now();
      var elapsed = Math.min(now - last, LISTEN_TICK_MS * 2);
      last = now;
      if (!listening()) {
        return;
      }
      player.listenedMs += elapsed;
      if (player.listenedMs >= LISTEN_MS) {
        player.listenedMs -= LISTEN_MS;
        // One flying coin for each coin earned.
        MusicHub.wallet.earn(coins, {
          from: playerParts.record,
          coins: coins,
          silent: MusicHub.storage.getSetting(LISTEN_COIN_SOUND_SETTING, true) === false,
        });
      }
    }, LISTEN_TICK_MS);
  }

  /** Back to the collection. The album keeps playing on Spotify. */
  /* ------------------------------------------------- the song's playlists */

  /*
   * The + beside the track: puts the song on the playlists chosen in
   * Settings (song-playlists.js) - it turns into a heart as it does. The
   * heart then opens the song's playlists, every playlist ticked where the
   * song is on it, to add it to more or take it off. (The + opens them
   * itself only with no Settings playlists, or to name one that failed.)
   * All of that is only remembered until "Back to collection".
   * Every press of the + that puts the song somewhere pays SONG_COINS
   * (the modal's own adds pay nothing).
   */

  // The song the + stands for, { name, uri }; and the one the modal is open for.
  var saveSong = null;
  var dialogSong = null;
  var dialogInitial = [];
  var saveBusy = false;
  var songChecklist = null;
  // Bumped each time the modal opens, so a delayed open overtaken by
  // another (the + pressed again while the coins fly) is dropped.
  var dialogRun = 0;
  // The heart's pop, then the modal (see .player__save--pop).
  var SAVE_POP_MS = 600;
  var SONG_COINS = 5;

  function showSaveButton(song) {
    if (!saveSong || saveSong.uri !== song.uri) {
      saveSong = { name: song.name, uri: song.uri };
      paintSave(false);
    }
  }

  /** Plus or heart, as the song is on no playlist or on some; `pop` plays the heart's animation. */
  function paintSave(pop) {
    if (!saveSong) {
      return;
    }
    var saved = MusicHub.songPlaylists.isSaved(saveSong.uri);
    els.save.classList.toggle('player__save--saved', saved);
    var label = saved ? 'On your playlists \u2014 change which' : 'Add to playlists';
    els.save.setAttribute('aria-label', label);
    els.save.title = label;
    els.save.classList.remove('player__save--pop');
    if (pop && saved && !reducedMotion()) {
      // Reflow first, so a second pop in a row starts over.
      void els.save.offsetWidth;
      els.save.classList.add('player__save--pop');
    }
  }

  /**
   * SONG_COINS out of the + - with the clink kept quiet like the listening
   * coins'. Resolves once they've landed.
   */
  function earnSongCoins() {
    return MusicHub.wallet.earn(SONG_COINS, {
      from: els.save,
      coins: SONG_COINS,
      silent: MusicHub.storage.getSetting(LISTEN_COIN_SOUND_SETTING, true) === false,
    });
  }

  function setSaveBusy(busy) {
    saveBusy = busy;
    els.save.disabled = busy;
    els.save.setAttribute('aria-busy', String(busy));
  }

  function failedNames(ids) {
    var choices = MusicHub.songPlaylists.choices();
    return ids.map(function (id) {
      var match = choices.filter(function (playlist) { return playlist.id === id; })[0];
      return '\u201c' + (match ? match.name : id) + '\u201d';
    }).join(', ');
  }

  function failureText(result) {
    return 'Couldn\u2019t update ' + failedNames(result.failed) + ': ' + result.error.message
      + (result.error.status === 429 ? ' - Spotify is limiting requests right now, try again in a while.' : '.');
  }

  function onSaveClick() {
    if (!saveSong || saveBusy) {
      return;
    }
    var song = saveSong;
    if (MusicHub.songPlaylists.isSaved(song.uri) || !MusicHub.songPlaylists.defaultIds().length) {
      openSongDialog(song);
      return;
    }
    setSaveBusy(true);
    MusicHub.songPlaylists.addToDefaults(song.uri).then(function (result) {
      setSaveBusy(false);
      var popped = result.added > 0 && saveSong === song;
      if (popped) {
        paintSave(true);
      }
      var coinsLanded = result.added > 0 ? earnSongCoins() : Promise.resolve();
      // The modal only opens to name a playlist that failed - after the
      // heart's pop and the coins, so neither plays out behind it.
      if (!result.failed.length) {
        return;
      }
      var popDone = new Promise(function (resolve) {
        window.setTimeout(resolve, popped && !reducedMotion() ? SAVE_POP_MS : 0);
      });
      var run = dialogRun;
      var album = playRun;
      Promise.all([popDone, coinsLanded]).then(function () {
        // Not after "Back to collection", nor over a modal opened meanwhile.
        if (run === dialogRun && album === playRun) {
          openSongDialog(song, failureText(result));
        }
      });
    });
  }

  /** What Save would do: the ticked playlists the song isn't on, and the unticked ones it is on. */
  function songDiff() {
    var checked = songChecklist.checked();
    return {
      add: checked.filter(function (id) { return dialogInitial.indexOf(id) === -1; }),
      remove: dialogInitial.filter(function (id) { return checked.indexOf(id) === -1; }),
    };
  }

  function playlistCount(count) {
    return count + (count === 1 ? ' playlist' : ' playlists');
  }

  function updateSongSubmit() {
    var diff = songDiff();
    var label = 'No changes';
    if (diff.add.length && diff.remove.length) {
      label = 'Save changes';
    } else if (diff.add.length) {
      label = 'Add to ' + playlistCount(diff.add.length);
    } else if (diff.remove.length) {
      label = 'Remove from ' + playlistCount(diff.remove.length);
    }
    els.songSubmit.textContent = label;
    els.songSubmit.disabled = saveBusy || !(diff.add.length || diff.remove.length);
  }

  function applySongSearch() {
    els.songSearchClear.hidden = !els.songSearch.value;
    var shown = songChecklist.filter(els.songSearch.value);
    if (els.songSearch.value && !shown) {
      MusicHub.notice.hold(els.songMessage, 'No playlist matches \u201c' + els.songSearch.value.trim() + '\u201d.');
    } else if (!MusicHub.playlists.list()) {
      MusicHub.notice.hold(els.songMessage, 'Fetch your playlists in Settings to see them here '
        + '\u2014 until then there\u2019s only Liked Songs.');
    } else {
      MusicHub.notice.hide(els.songMessage);
    }
  }

  /**
   * The song's playlists: every one there is, ticked where the song is on
   * it. The ticked ones on top, then the ones the modal last added a song
   * to, most recent first, then the rest in the usual order.
   */
  function fillSongChecklist() {
    dialogInitial = MusicHub.songPlaylists.playlistsOf(dialogSong.uri);
    songChecklist.setPlaylists(MusicHub.songPlaylists.recentFirst(MusicHub.songPlaylists.choices()), dialogInitial);
    applySongSearch();
    updateSongSubmit();
  }

  function openSongDialog(song, error) {
    dialogRun += 1;
    dialogSong = song;
    els.songName.textContent = song.name + ' \u2014 ' + (player ? player.vinyl.album.artist : '');
    els.songSearch.value = '';
    fillSongChecklist();
    if (error) {
      MusicHub.notice.flash(els.songError, error);
    } else {
      MusicHub.notice.hide(els.songError);
    }
    if (!els.songDialog.open) {
      els.songDialog.showModal();
    }
  }

  function submitSongDialog() {
    var diff = songDiff();
    var song = dialogSong;
    if (!song || saveBusy || !(diff.add.length || diff.remove.length)) {
      return;
    }
    var wasSaved = MusicHub.songPlaylists.isSaved(song.uri);
    setSaveBusy(true);
    els.songSubmit.disabled = true;
    els.songSubmit.textContent = 'Saving\u2026';
    MusicHub.notice.hide(els.songError);
    MusicHub.songPlaylists.change(song.uri, diff.add, diff.remove).then(function (result) {
      setSaveBusy(false);
      MusicHub.songPlaylists.noteAdded(diff.add.filter(function (id) {
        return result.failed.indexOf(id) === -1;
      }));
      if (saveSong && saveSong.uri === song.uri) {
        paintSave(!wasSaved);
      }
      if (result.failed.length) {
        // Stays open, ticked as things now are, to try the rest again.
        if (dialogSong === song) {
          fillSongChecklist();
          MusicHub.notice.flash(els.songError, failureText(result));
        }
        return;
      }
      if (dialogSong === song) {
        els.songDialog.close();
      }
    });
  }

  function initSongPlaylists() {
    els.song = document.getElementById('player-song');
    els.save = document.getElementById('player-save');
    els.songDialog = document.getElementById('song-playlists-dialog');
    els.songName = document.getElementById('song-playlists-song');
    els.songSearch = document.getElementById('song-playlists-search');
    els.songSearchClear = document.getElementById('song-playlists-search-clear');
    els.songMessage = document.getElementById('song-playlists-message');
    els.songError = document.getElementById('song-playlists-error');
    els.songSubmit = document.getElementById('song-playlists-submit');

    songChecklist = MusicHub.playlistPicker.createChecklist(document.getElementById('song-playlists-list'), {
      onToggle: updateSongSubmit,
    });
    els.save.addEventListener('click', onSaveClick);
    els.save.addEventListener('animationend', function (event) {
      if (event.target === els.save) {
        els.save.classList.remove('player__save--pop');
      }
    });
    els.songSearch.addEventListener('input', applySongSearch);
    // Enter in the search only searches - it doesn't save.
    els.songSearch.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
      }
    });
    els.songSearchClear.addEventListener('click', function () {
      els.songSearch.value = '';
      applySongSearch();
      els.songSearch.focus();
    });
    document.getElementById('song-playlists-form').addEventListener('submit', function (event) {
      event.preventDefault();
      submitSongDialog();
    });
    document.getElementById('song-playlists-cancel').addEventListener('click', function () {
      els.songDialog.close();
    });
    els.songDialog.addEventListener('close', function () {
      dialogSong = null;
    });

    // New playlists fetched in Settings (another tab).
    document.addEventListener(MusicHub.playlists.CHANGE_EVENT, function () {
      if (dialogSong && !saveBusy) {
        fillSongChecklist();
      }
    });
  }

  /**
   * Stops following the album on the turntable - Spotify's answers about
   * it ignored from here on, no more coins for it - and forgets which
   * playlists its songs went on (only kept while the album plays).
   */
  function stopPlaying() {
    playRun += 1;
    window.clearTimeout(pollTimer);
    window.clearInterval(listenTimer);
    saveSong = null;
    MusicHub.songPlaylists.forget();
    if (els.songDialog.open) {
      els.songDialog.close();
    }
  }

  function closePlayer() {
    cancelSwitch();
    stopPlaying();
    if (playerParts) {
      MusicHub.turntable.silence(playerParts);
      playerParts.root.remove();
      playerParts = null;
    }
    player = null;
    els.player.hidden = true;
    els.view.hidden = false;
  }

  /* -------------------------------------------------------- the jukebox */

  /*
   * The arrows either side of the turntable go to the vinyl before or
   * after this one, round from the last to the first. The record lifts
   * off the platter to the top of a big jukebox wheel across the whole
   * page, the vinyls after it running down its rim to the left and the
   * ones before it down to the right. The wheel turns one record's worth
   * the way the arrow points, bringing the one picked up to the top -
   * right over the platter, just where a record dropped from Play starts
   * - and it drops from there, its album starting on Spotify.
   */
  var JUKEBOX_SLOTS_EACH_SIDE = 4;
  // Times in ms from the arrow pressed.
  // The record lifts `afterArmMs` once the tonearm's back on its rest,
  // the page dimming round the deck over `showMs`; the wheel turns
  // `spinGapMs` after it's up, and the drop follows the turn's end by
  // `settleMs`, however late that comes.
  var JUKEBOX = {
    showMs: 350,
    afterArmMs: 120,
    liftMs: 500,
    spinGapMs: 50,
    spinMs: 950,
    settleMs: 150,
    hideMs: 500,
  };
  // ease-in-out (sine): the wheel eases off and eases into place.
  var JUKEBOX_EASING = 'cubic-bezier(0.37, 0, 0.63, 1)';
  // The records on the wheel: as big as the record on the platter at the
  // start of its drop (turntable.js play: translateY(-14%) scale(1.3)),
  // with a little room between them round the rim. The wheel's at least
  // this many records' widths round, and reaches this far down the page.
  var DROP_SCALE = 1.3;
  var DROP_RISE = 0.14;
  var JUKEBOX_GAP = 1.08;
  var JUKEBOX_MIN_RADIUS = 1.6;
  var JUKEBOX_PAGE_RADIUS = 0.75;

  // The wheel's bearing (JUKEBOX_SOUNDS.spin, and turned by hand
  // wheelRumble): lowpassed noise, opening from `lowHz` to `highHz` and
  // swelling to `level` at full speed - the top speed of the arrows' turn,
  // `peakSteps` records a second (the sine ease peaks at pi / 2 times its
  // average).
  var JUKEBOX_RUMBLE = {
    lowHz: 140,
    highHz: 420,
    level: 0.16,
    peakSteps: (Math.PI / 2) * (1000 / JUKEBOX.spinMs),
  };

  /**
   * The bearing's rumble as the wheel's turned by hand: a loop of noise
   * kept going, following the wheel's speed (`set`, 0 to 1 of full speed)
   * - and quiet again if it's not heard from for a moment, the wheel held
   * still. Nothing without Web Audio, or with the sounds off.
   */
  function wheelRumble() {
    var ctx = MusicHub.wallet.audioContext();
    if (!ctx) {
      return { set: function () {}, stop: function () {} };
    }
    var buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = JUKEBOX_RUMBLE.lowHz;
    var level = ctx.createGain();
    level.gain.value = 0.0001;
    source.connect(filter).connect(level).connect(MusicHub.wallet.audioOutput());
    source.start();
    var quiet = 0;
    var stopped = false;
    function set(speed) {
      if (stopped) {
        return;
      }
      var amount = Math.min(1, Math.max(0, speed));
      var now = ctx.currentTime;
      level.gain.setTargetAtTime(Math.max(0.0001, JUKEBOX_RUMBLE.level * amount), now, 0.05);
      filter.frequency.setTargetAtTime(
        JUKEBOX_RUMBLE.lowHz + (JUKEBOX_RUMBLE.highHz - JUKEBOX_RUMBLE.lowHz) * amount, now, 0.05);
      window.clearTimeout(quiet);
      if (amount > 0) {
        quiet = window.setTimeout(function () { set(0); }, 90);
      }
    }
    function stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      window.clearTimeout(quiet);
      level.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
      source.stop(ctx.currentTime + 0.4);
    }
    return { set: set, stop: stop };
  }

  var JUKEBOX_SOUNDS = {
    // A record coming up to the top as the wheel's turned by hand: one
    // muted detent of the spin's.
    detent: function (ctx, at) {
      MusicHub.sfx.noise(ctx, at, 0.035, 'lowpass', 900, 0.7, 0.05, 0.002);
      MusicHub.sfx.tone(ctx, at, 330, 240, 0.035, 0.05);
    },
    // The record put back down on the platter: a soft, low thud.
    land: function (ctx, at) {
      MusicHub.sfx.noise(ctx, at, 0.12, 'lowpass', 380, 0.8, 0.09, 0.004);
      MusicHub.sfx.tone(ctx, at, 110, 70, 0.06, 0.12);
    },
    // The record lifted off the platter: a soft breath of air.
    lift: function (ctx, at) {
      MusicHub.sfx.noise(ctx, at, 0.45, 'bandpass', 500, 0.8, 0.035, 0.2, 1400);
    },
    // The wheel turning: a well-oiled carousel - the soft rumble of its
    // bearing, swelling and settling with the wheel's speed (the sine
    // ease's own speed curve), and muted detents rolling past, spaced
    // evenly round the turn so they quicken and slow with it.
    spin: function (ctx, at) {
      var length = JUKEBOX.spinMs / 1000;
      var rumble = JUKEBOX_RUMBLE;
      var points = 48;
      function curve(from, to, floor) {
        var values = new Float32Array(points);
        for (var i = 0; i < points; i += 1) {
          var speed = Math.sin(Math.PI * i / (points - 1));
          values[i] = Math.max(floor || 0, from + (to - from) * speed);
        }
        return values;
      }
      var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
      var data = buffer.getChannelData(0);
      for (var i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.7;
      filter.frequency.setValueCurveAtTime(curve(rumble.lowHz, rumble.highHz), at, length);
      var level = ctx.createGain();
      level.gain.setValueCurveAtTime(curve(0, rumble.level, 0.0001), at, length);
      source.connect(filter).connect(level).connect(MusicHub.wallet.audioOutput());
      source.start(at);
      source.stop(at + length);
      // Turned a fraction f of the way at t = acos(1 - 2f) / pi of the turn.
      var detents = 7;
      for (var k = 1; k < detents; k += 1) {
        var t = at + length * Math.acos(1 - 2 * k / detents) / Math.PI;
        MusicHub.sfx.noise(ctx, t, 0.035, 'lowpass', 900, 0.7, 0.05, 0.002);
        MusicHub.sfx.tone(ctx, t, 330, 240, 0.035, 0.05);
      }
    },
  };

  /** The vinyl `step` on from the one playing, round the queue. */
  function queueNeighbour(step) {
    var count = queue.length;
    var at = Math.max(0, queue.indexOf(player.vinyl));
    return queue[(((at + step) % count) + count) % count];
  }

  /**
   * The arrows: only with another vinyl to go to, each naming the album
   * it goes to; unusable (aria-disabled, so the focus stays on the one
   * pressed) while the jukebox turns.
   */
  function updateSwitchButtons() {
    var usable = !!player && queue.length > 1;
    [[els.prevVinyl, -1, 'Previous'], [els.nextVinyl, 1, 'Next']].forEach(function (arrow) {
      var button = arrow[0];
      button.hidden = !usable;
      if (!usable) {
        return;
      }
      var album = queueNeighbour(arrow[1]).album;
      button.querySelector('.player__switch-album').textContent = album.name;
      button.querySelector('.player__switch-artist').textContent = album.artist;
      button.setAttribute('aria-label', arrow[2] + ' vinyl: ' + album.name + ' by ' + album.artist);
      button.setAttribute('aria-disabled', switching ? 'true' : 'false');
    });
    updateGrab();
  }

  function cancelSwitch() {
    if (!switching) {
      return;
    }
    switching.timers.forEach(window.clearTimeout);
    if (switching.cleanup) {
      switching.cleanup();
    }
    switching.nodes.forEach(function (node) {
      node.getAnimations({ subtree: true }).forEach(function (animation) {
        animation.cancel();
      });
      node.remove();
    });
    els.deck.classList.remove('player__deck--jukebox');
    switching = null;
  }

  /** How dim a record is `deg` round the rim from the top: dimmer further down. */
  function jukeboxShade(deg) {
    return 0.45 * Math.min(1, Math.abs(deg) / 90);
  }

  /**
   * The jukebox over the page: a backdrop dimming everything but the
   * deck, and the wheel - its top record where the record on the platter
   * starts its drop, the rest of its rim running down the page either
   * side, records round it every `stepDeg`. The record `k` on from the one
   * playing sits `k` steps round to the left, so turning the wheel
   * clockwise (`forward`) brings the next one up to the top, and the
   * other way the one before. Its records are only made as they're
   * needed (jukeboxSlot, fillJukebox), so it can turn round any number.
   */
  function buildJukebox(parts) {
    // The cap shares the record's box on the platter, and never moves.
    var box = parts.cap.getBoundingClientRect();
    var size = box.width * DROP_SCALE;
    var top = {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2 - box.height * DROP_RISE,
    };
    var radius = Math.max(size * JUKEBOX_MIN_RADIUS, window.innerHeight * JUKEBOX_PAGE_RADIUS);
    var stepDeg = (size * JUKEBOX_GAP / radius) * 180 / Math.PI;

    var backdrop = el('div', 'jukebox-backdrop');
    var overlay = el('div', 'jukebox');
    var wheel = el('div', 'jukebox__wheel');
    wheel.setAttribute('aria-hidden', 'true');
    wheel.style.left = top.x + 'px';
    wheel.style.top = (top.y + radius) + 'px';
    overlay.appendChild(wheel);
    return {
      backdrop: backdrop, overlay: overlay, wheel: wheel, slots: [], stepDeg: stepDeg, box: box,
      size: size, radius: radius, top: top,
      // How far it's turned by hand (setJukeboxAngle), the record at the
      // top then, and how the record playing's label was turned on the
      // platter - its copies on the wheel turned just the same.
      angle: 0, center: 0, discRotate: '',
    };
  }

  /** The wheel's record `step` on from the one playing - made if it isn't there yet. */
  function jukeboxSlot(jukebox, step) {
    var found = jukebox.slots.filter(function (slot) { return slot.step === step; })[0];
    if (found) {
      return found;
    }
    var deg = -step * jukebox.stepDeg;
    var slot = el('div', 'jukebox__slot');
    slot.dataset.step = String(step);
    slot.style.width = jukebox.size + 'px';
    slot.style.height = jukebox.size + 'px';
    slot.style.transform = 'rotate(' + deg + 'deg) translateY(' + (-jukebox.radius) + 'px)';
    // The record's own box inside the slot, for the lift onto it.
    var holder = el('div', 'jukebox__record');
    var vinyl = queueNeighbour(step);
    var record = renderRecord(vinyl);
    MusicHub.vinyl.setPlaying(record, false);
    var disc = record.querySelector('.vinyl__disc');
    if (vinyl === player.vinyl && jukebox.discRotate && disc) {
      disc.style.rotate = jukebox.discRotate;
    }
    holder.appendChild(record);
    // Dimmed by a shade over it rather than a filter, which would
    // redraw the whole record on every frame of the turn.
    var shade = el('span', 'jukebox__shade');
    shade.style.opacity = jukeboxShade(deg + jukebox.angle);
    holder.appendChild(shade);
    slot.appendChild(holder);
    var entry = { node: slot, holder: holder, shade: shade, deg: deg, step: step };
    jukebox.slots.push(entry);
    jukebox.wheel.appendChild(slot);
    return entry;
  }

  /** The records `reach` steps either side of `center` on the wheel, and no others. */
  function fillJukebox(jukebox, center, reach) {
    jukebox.slots = jukebox.slots.filter(function (slot) {
      if (Math.abs(slot.step - center) <= reach) {
        return true;
      }
      slot.node.remove();
      return false;
    });
    for (var k = center - reach; k <= center + reach; k += 1) {
      jukeboxSlot(jukebox, k);
    }
  }

  /**
   * Turns the wheel `deg` round, starting `delay` ms from now - each
   * record's shade following it. Resolves once it's there.
   */
  function turnJukebox(jukebox, deg, delay) {
    var timing = {
      delay: delay, duration: JUKEBOX.spinMs, easing: JUKEBOX_EASING, fill: 'forwards',
    };
    jukebox.slots.forEach(function (slot) {
      slot.shade.animate([
        { opacity: jukeboxShade(slot.deg) }, { opacity: jukeboxShade(slot.deg + deg) },
      ], timing);
    });
    return jukebox.wheel.animate([{ rotate: '0deg' }, { rotate: deg + 'deg' }], timing).finished;
  }

  /** An arrow: to the vinyl after this one (`forward`) or the one before. */
  function switchVinyl(forward) {
    if (!player || !playerParts || switching || queue.length < 2) {
      return;
    }
    var target = queueNeighbour(forward ? 1 : -1);
    var leaving = playerParts;
    var wasStarted = player.started;
    stopPlaying();
    hideTrack();
    els.actions.hidden = true;
    els.actions.textContent = '';

    if (reducedMotion()) {
      openPlayer(target, { switched: true });
      return;
    }

    setStatus('Changing records\u2026');
    // The music stops while the records change - Spotify turns a pause
    // down when it's paused already, which is just as good.
    if (wasStarted) {
      MusicHub.spotify.pausePlayback().catch(function (err) {
        if (err.code !== 'failed') {
          console.warn('Could not pause on Spotify', err);
        }
      });
    }
    // The old turntable can't be used meanwhile: it switches off, and the
    // record only lifts once the tonearm's back on its rest.
    leaving.root.inert = true;
    var armMs = MusicHub.turntable.setPower(leaving, false);
    MusicHub.vinyl.setPlaying(leaving.vinyl, false);
    var liftAt = armMs + JUKEBOX.afterArmMs;
    var spinAt = liftAt + JUKEBOX.liftMs + JUKEBOX.spinGapMs;

    var jukebox = buildJukebox(leaving);
    jukebox.overlay.setAttribute('aria-hidden', 'true');
    fillJukebox(jukebox, 0, JUKEBOX_SLOTS_EACH_SIDE);
    var sign = forward ? 1 : -1;
    switching = { timers: [], nodes: [jukebox.backdrop, jukebox.overlay] };
    var job = switching;
    // The deck stays bright between the backdrop and the wheel.
    els.deck.classList.add('player__deck--jukebox');
    document.body.appendChild(jukebox.backdrop);
    document.body.appendChild(jukebox.overlay);
    updateSwitchButtons();

    function later(fn, delay) {
      job.timers.push(window.setTimeout(fn, delay));
    }

    // Nothing of the jukebox shows until the arm's on its rest: then the
    // page dims round the deck as the record lifts.
    jukebox.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: liftAt, duration: JUKEBOX.showMs, easing: 'ease-out', fill: 'backwards',
    });
    // The wheel's other records roll in from below; the top one is the
    // record on the platter, lifted onto it - from the platter's own box
    // (1 / DROP_SCALE of the slot) up to the top of the wheel.
    var front = null;
    jukebox.slots.forEach(function (slot) {
      if (slot.step === 0) {
        front = slot;
        return;
      }
      slot.holder.animate([
        { opacity: 0, transform: 'translateY(30%)' },
        { opacity: 1, transform: 'none' },
      ], {
        delay: liftAt + Math.abs(slot.step) * 60,
        duration: JUKEBOX.liftMs,
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
        fill: 'backwards',
      });
    });
    var riseBy = jukebox.box.height * DROP_RISE;
    // Until then the record stays on the platter, under the arm - the
    // wheel's copy of it only takes over as it lifts.
    front.node.animate([{ opacity: 0 }, { opacity: 0 }], { duration: liftAt });
    front.holder.animate([
      { transform: 'translateY(' + riseBy + 'px) scale(' + (1 / DROP_SCALE) + ')', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      { transform: 'none' },
    ], { delay: liftAt, duration: JUKEBOX.liftMs, fill: 'backwards' });
    leaving.cap.animate([{ opacity: 1 }, { opacity: 0 }], {
      delay: liftAt, duration: 1, fill: 'forwards',
    });
    leaving.record.animate([{ opacity: 1 }, { opacity: 0 }], {
      delay: liftAt, duration: 1, fill: 'forwards',
    });
    MusicHub.sfx.play(JUKEBOX_SOUNDS, 'lift', liftAt / 1000);
    MusicHub.sfx.play(JUKEBOX_SOUNDS, 'spin', spinAt / 1000);

    // One record's worth round, the way the arrow points; come to rest,
    // the record now at the top drops onto the platter from right there -
    // the turntable's own drop, starting where it is - while the wheel
    // and the backdrop fade away round it.
    turnJukebox(jukebox, sign * jukebox.stepDeg, spinAt).then(function () {
      if (switching !== job) {
        return;
      }
      later(drop, JUKEBOX.settleMs);
    }, function () {
      // Cancelled (cancelSwitch).
    });

    function drop() {
      jukebox.slots.forEach(function (slot) {
        if (slot.step === sign) {
          slot.node.style.visibility = 'hidden';
        }
      });
      jukebox.overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: JUKEBOX.hideMs, easing: 'ease-out', fill: 'forwards',
      });
      jukebox.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: JUKEBOX.hideMs, easing: 'ease-in-out', fill: 'forwards',
      });
      openPlayer(target, { switched: true, lifted: true });
      later(function () {
        jukebox.backdrop.remove();
        jukebox.overlay.remove();
        els.deck.classList.remove('player__deck--jukebox');
        switching = null;
        updateSwitchButtons();
      }, JUKEBOX.hideMs);
    }
  }

  /* ------------------------------------------- the jukebox, turned by hand */

  /*
   * Switched off, the record can be picked up off the platter and dragged
   * anywhere. Let go, it lifts onto the top of the jukebox wheel, as for
   * the arrows - but the wheel waits to be turned by hand: dragged
   * sideways (or with the arrow keys or the mouse wheel) it turns through
   * the records, coming to rest with one at the top. The record at the
   * top tapped drops onto the platter, its album starting on Spotify; one
   * further round tapped turns the wheel to it; a tap anywhere else (or
   * Escape) puts the record back. Where the arrows don't fit (style.css)
   * it's the only way to change records.
   */
  var BROWSE = {
    // How far the record's dragged before letting it go lifts it.
    dragPx: 12,
    // The record a touch bigger while it's held.
    grabScale: 1.05,
    // How far the wheel's dragged before it turns rather than taking a tap.
    turnPx: 8,
    // A flung wheel goes on as far as it would in this long at the speed
    // it was let go at; its speed is measured over the last `sampleMs`.
    throwMs: 280,
    sampleMs: 90,
    // However hard it's flung, it goes on at most this many records.
    maxThrow: 6,
    // A turn to rest takes `stepMs` a record, within these bounds.
    stepMs: 170,
    minTurnMs: 260,
    maxTurnMs: 1100,
    // Back down onto the platter: from the wheel, and when it was only
    // picked up, not dragged.
    putBackMs: 450,
    snapBackMs: 180,
    // The mouse wheel's travel per record.
    wheelPx: 60,
  };

  // Between the bottom of the record at the top and its caption.
  var CAPTION_GAP_PX = 18;

  /** Whether the record can be picked up off the platter: the turntable off, another vinyl to go to. */
  function canBrowse() {
    return !!(player && playerParts && !playerParts.on && !playerParts.drag && !switching
      && queue.length > 1);
  }

  /** The record grabbable (style.css) while it can be picked up. */
  function updateGrab() {
    if (playerParts) {
      playerParts.root.classList.toggle('turntable--grabbable', canBrowse());
    }
  }

  /** The record pressed on the platter: picked up (see above). */
  function grabRecord(event) {
    if (!event.isPrimary || event.button !== 0 || !canBrowse()) {
      return;
    }
    event.preventDefault();
    var parts = playerParts;
    var motion = reducedMotion() ? 0 : 1;
    var jukebox = buildJukebox(parts);
    var discRotate = window.getComputedStyle(parts.disc).rotate;
    jukebox.discRotate = discRotate && discRotate !== 'none' ? discRotate : '';
    // The wheel's records either side of the top: enough to reach down
    // past the bottom of the page.
    var reach = Math.min(10, Math.ceil(160 / jukebox.stepDeg) + 1);
    var overlay = jukebox.overlay;
    var job = { timers: [], nodes: [jukebox.backdrop, overlay], cleanup: null };
    switching = job;
    els.deck.classList.add('player__deck--jukebox');
    jukebox.backdrop.style.opacity = '0';
    document.body.appendChild(jukebox.backdrop);
    document.body.appendChild(overlay);

    // The record goes onto the wheel's top slot, held over the platter -
    // 1 / DROP_SCALE of the slot - and follows the pointer from there.
    var riseBy = jukebox.box.height * DROP_RISE;
    function onPlatter(dx, dy, scale) {
      return 'translate(' + dx + 'px, ' + (riseBy + dy) + 'px) scale(' + (scale / DROP_SCALE) + ')';
    }
    var front = jukeboxSlot(jukebox, 0);
    front.holder.style.transform = onPlatter(0, 0, BROWSE.grabScale);
    parts.record.style.opacity = '0';
    parts.cap.style.opacity = '0';
    parts.root.classList.add('turntable--grabbing');
    var start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    var dragged = false;
    var holding = true;
    parts.record.setPointerCapture(event.pointerId);
    parts.record.addEventListener('pointermove', holdMove);
    parts.record.addEventListener('pointerup', holdEnd);
    parts.record.addEventListener('pointercancel', holdEnd);

    // Turning by hand: the drag going on (null while there's none), the
    // record it's turning to, the mouse wheel's travel towards the next
    // one, the frame of a turn to rest, and whether it's on its way out.
    var turnDrag = null;
    var aim = 0;
    var wheelTravel = 0;
    var turnFrame = 0;
    var closing = false;
    // The bearing's rumble (wheelRumble), from the first turn; when and
    // where the wheel was last turned to, for its speed.
    var rumble = null;
    var lastTurn = null;
    // The caption: centred just under the record at the top - the record
    // fills the slot but for 4% all round (style.css).
    var caption = el('div', 'jukebox__caption');
    caption.setAttribute('role', 'status');
    caption.style.left = jukebox.top.x + 'px';
    caption.style.top = (jukebox.top.y + jukebox.size * 0.46 + CAPTION_GAP_PX) + 'px';
    var captionAlbum = el('span', 'jukebox__caption-album');
    var captionArtist = el('span', 'jukebox__caption-artist');
    caption.appendChild(captionAlbum);
    caption.appendChild(captionArtist);

    function later(fn, delay) {
      job.timers.push(window.setTimeout(fn, delay));
    }

    function unlisten() {
      parts.record.removeEventListener('pointermove', holdMove);
      parts.record.removeEventListener('pointerup', holdEnd);
      parts.record.removeEventListener('pointercancel', holdEnd);
      parts.root.classList.remove('turntable--grabbing');
      overlay.removeEventListener('pointerdown', turnStart);
      overlay.removeEventListener('pointermove', turnMove);
      overlay.removeEventListener('pointerup', turnEnd);
      overlay.removeEventListener('pointercancel', turnEnd);
      overlay.removeEventListener('wheel', onWheel);
      document.removeEventListener('keydown', onKey);
      window.cancelAnimationFrame(turnFrame);
      turnFrame = 0;
      if (rumble) {
        rumble.stop();
        rumble = null;
      }
    }

    function restorePlatter() {
      parts.record.style.opacity = '';
      parts.cap.style.opacity = '';
      parts.root.inert = false;
    }

    // Closing the player meanwhile (cancelSwitch).
    job.cleanup = function () {
      unlisten();
      restorePlatter();
    };

    function finish() {
      if (switching !== job) {
        return;
      }
      jukebox.backdrop.remove();
      overlay.remove();
      els.deck.classList.remove('player__deck--jukebox');
      switching = null;
      updateSwitchButtons();
    }

    /* -- held over the platter */

    function holdMove(e) {
      if (e.pointerId !== start.id) {
        return;
      }
      var dx = e.clientX - start.x;
      var dy = e.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) >= BROWSE.dragPx) {
        dragged = true;
      }
      front.holder.style.transform = onPlatter(dx, dy, BROWSE.grabScale);
    }

    function holdEnd(e) {
      if (e.pointerId !== start.id || !holding) {
        return;
      }
      holding = false;
      parts.record.removeEventListener('pointermove', holdMove);
      parts.record.removeEventListener('pointerup', holdEnd);
      parts.record.removeEventListener('pointercancel', holdEnd);
      parts.root.classList.remove('turntable--grabbing');
      if (dragged && e.type === 'pointerup') {
        lift();
      } else {
        snapBack();
      }
    }

    /** Only picked up, not dragged: straight back down. */
    function snapBack() {
      closing = true;
      unlisten();
      var ms = BROWSE.snapBackMs * motion;
      front.holder.animate([
        { transform: front.holder.style.transform }, { transform: onPlatter(0, 0, 1) },
      ], { duration: ms, easing: 'ease-out', fill: 'forwards' });
      later(function () {
        restorePlatter();
        finish();
      }, ms);
    }

    /**
     * Let go: from where it was let go it zooms up onto the top of the
     * wheel, the page dimming round the deck and the wheel's other records
     * rolling in from below - as for the arrows - and waits to be turned.
     */
    function lift() {
      parts.root.inert = true;
      updateSwitchButtons();
      var from = front.holder.style.transform;
      front.holder.style.transform = '';
      front.holder.animate([
        { transform: from, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }, { transform: 'none' },
      ], { duration: JUKEBOX.liftMs * motion });
      jukebox.backdrop.style.opacity = '';
      jukebox.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: JUKEBOX.showMs * motion, easing: 'ease-out',
      });
      fillJukebox(jukebox, 0, reach);
      jukebox.slots.forEach(function (slot) {
        if (slot.step === 0) {
          return;
        }
        slot.holder.animate([
          { opacity: 0, transform: 'translateY(30%)' },
          { opacity: 1, transform: 'none' },
        ], {
          delay: Math.min(Math.abs(slot.step), JUKEBOX_SLOTS_EACH_SIDE) * 60 * motion,
          duration: JUKEBOX.liftMs * motion,
          easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
          fill: 'backwards',
        });
      });
      MusicHub.sfx.play(JUKEBOX_SOUNDS, 'lift', 0);

      overlay.appendChild(caption);
      showCaption(0);
      caption.animate([{ opacity: 0 }, { opacity: 1 }], {
        delay: JUKEBOX.liftMs * 0.5 * motion, duration: JUKEBOX.showMs * motion, fill: 'backwards',
      });
      overlay.classList.add('jukebox--browse');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Jukebox: pick a vinyl');
      overlay.tabIndex = -1;
      overlay.focus({ preventScroll: true });
      overlay.addEventListener('pointerdown', turnStart);
      overlay.addEventListener('pointermove', turnMove);
      overlay.addEventListener('pointerup', turnEnd);
      overlay.addEventListener('pointercancel', turnEnd);
      overlay.addEventListener('wheel', onWheel, { passive: false });
      document.addEventListener('keydown', onKey);
    }

    /* -- turned by hand */

    function showCaption(step) {
      var album = queueNeighbour(step).album;
      captionAlbum.textContent = album.name;
      captionArtist.textContent = album.artist;
      // Centred under the record, but never off the side of the page.
      var half = caption.offsetWidth / 2;
      var margin = 16;
      var x = Math.min(Math.max(jukebox.top.x, margin + half), window.innerWidth - margin - half);
      caption.style.left = x + 'px';
    }

    /**
     * The wheel turned `deg` round: its records made and dropped round the
     * top as they come and go, each shaded for where it is, and a detent's
     * tick each time another comes up to the top.
     */
    function setAngle(deg) {
      // The rumble follows how fast it's turning, as the arrows' turn does.
      var now = performance.now();
      if (lastTurn && now > lastTurn.at) {
        var stepsPerS = (Math.abs(deg - lastTurn.deg) / jukebox.stepDeg) * 1000 / (now - lastTurn.at);
        if (!rumble && stepsPerS > 0) {
          rumble = wheelRumble();
        }
        if (rumble) {
          rumble.set(stepsPerS / JUKEBOX_RUMBLE.peakSteps);
        }
      }
      lastTurn = { at: now, deg: deg };
      jukebox.angle = deg;
      jukebox.wheel.style.rotate = deg + 'deg';
      var center = Math.round(deg / jukebox.stepDeg);
      if (center !== jukebox.center) {
        jukebox.center = center;
        fillJukebox(jukebox, center, reach);
        showCaption(center);
        MusicHub.sfx.play(JUKEBOX_SOUNDS, 'detent', 0);
      }
      jukebox.slots.forEach(function (slot) {
        slot.shade.style.opacity = jukeboxShade(slot.deg + deg);
      });
    }

    function stepAt(deg) {
      return Math.round(deg / jukebox.stepDeg);
    }

    /** Turns the wheel to rest with record `step` at the top, easing out; then `then`. */
    function turnTo(step, then) {
      window.cancelAnimationFrame(turnFrame);
      turnFrame = 0;
      aim = step;
      lastTurn = { at: performance.now(), deg: jukebox.angle };
      var from = jukebox.angle;
      var to = step * jukebox.stepDeg;
      var ms = motion * Math.min(BROWSE.maxTurnMs,
        Math.max(BROWSE.minTurnMs, Math.abs(to - from) / jukebox.stepDeg * BROWSE.stepMs));
      if (!ms || Math.abs(to - from) < 0.01) {
        setAngle(to);
        if (then) {
          then();
        }
        return;
      }
      var startedAt = performance.now();
      function frame(now) {
        var progress = Math.min(1, Math.max(0, (now - startedAt) / ms));
        setAngle(from + (to - from) * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) {
          turnFrame = window.requestAnimationFrame(frame);
        } else {
          turnFrame = 0;
          if (then) {
            then();
          }
        }
      }
      turnFrame = window.requestAnimationFrame(frame);
    }

    function turnStart(e) {
      if (closing || !e.isPrimary || e.button !== 0) {
        return;
      }
      e.preventDefault();
      // Caught mid-turn, the wheel stops under the pointer.
      window.cancelAnimationFrame(turnFrame);
      turnFrame = 0;
      var slot = e.target.closest && e.target.closest('.jukebox__slot');
      turnDrag = {
        id: e.pointerId, x: e.clientX, from: jukebox.angle, moved: false,
        step: slot ? Number(slot.dataset.step) : null,
        samples: [{ t: e.timeStamp, deg: jukebox.angle }],
      };
      overlay.setPointerCapture(e.pointerId);
      lastTurn = null;
    }

    function turnMove(e) {
      if (!turnDrag || e.pointerId !== turnDrag.id) {
        return;
      }
      var dx = e.clientX - turnDrag.x;
      if (!turnDrag.moved) {
        if (Math.abs(dx) < BROWSE.turnPx) {
          return;
        }
        // From here on it's a turn - taking up from the pointer as it is.
        turnDrag.moved = true;
        turnDrag.x = e.clientX;
        dx = 0;
        overlay.classList.add('jukebox--grabbing');
      }
      // The top of the rim follows the pointer sideways.
      var deg = turnDrag.from + (dx / jukebox.radius) * 180 / Math.PI;
      setAngle(deg);
      turnDrag.samples.push({ t: e.timeStamp, deg: deg });
      turnDrag.samples = turnDrag.samples.filter(function (sample) {
        return e.timeStamp - sample.t <= BROWSE.sampleMs;
      });
    }

    function turnEnd(e) {
      if (!turnDrag || e.pointerId !== turnDrag.id) {
        return;
      }
      var drag = turnDrag;
      turnDrag = null;
      overlay.classList.remove('jukebox--grabbing');
      var atTop = stepAt(jukebox.angle);
      if (!drag.moved) {
        if (e.type === 'pointercancel') {
          turnTo(atTop);
        } else if (drag.step === null) {
          putBack();
        } else if (drag.step === atTop) {
          pick(drag.step);
        } else {
          turnTo(drag.step);
        }
        return;
      }
      // Flung: on at the speed it was let go at, slowing to a stop.
      var first = drag.samples[0];
      var last = drag.samples[drag.samples.length - 1];
      var fresh = e.timeStamp - last.t <= BROWSE.sampleMs;
      var speed = fresh && last.t > first.t ? (last.deg - first.deg) / (last.t - first.t) : 0;
      var maxDeg = BROWSE.maxThrow * jukebox.stepDeg;
      turnTo(stepAt(jukebox.angle + Math.max(-maxDeg, Math.min(maxDeg, speed * BROWSE.throwMs))));
    }

    function onWheel(e) {
      e.preventDefault();
      if (closing || turnDrag) {
        return;
      }
      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) {
        delta *= 20;
      } else if (e.deltaMode === 2) {
        delta *= 400;
      }
      wheelTravel += delta;
      var by = Math.trunc(wheelTravel / BROWSE.wheelPx);
      if (by) {
        wheelTravel -= by * BROWSE.wheelPx;
        turnTo(aim + by);
      }
    }

    function onKey(e) {
      if (closing || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        turnTo(aim + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        turnTo(aim - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (!turnDrag) {
          pick(aim);
        }
      } else if (e.key === 'Escape') {
        putBack();
      } else {
        return;
      }
      e.preventDefault();
    }

    /* -- on its way out */

    /** Record `step` picked: it drops onto the platter from the top, its album starting on Spotify. */
    function pick(step) {
      if (closing) {
        return;
      }
      var target = queueNeighbour(step);
      if (target === player.vinyl) {
        putBack();
        return;
      }
      closing = true;
      turnTo(step, function () {
        unlisten();
        stopPlaying();
        hideTrack();
        els.actions.hidden = true;
        els.actions.textContent = '';
        jukeboxSlot(jukebox, step).node.style.visibility = 'hidden';
        overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: JUKEBOX.hideMs, easing: 'ease-out', fill: 'forwards',
        });
        jukebox.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: JUKEBOX.hideMs, easing: 'ease-in-out', fill: 'forwards',
        });
        openPlayer(target, { switched: true, lifted: true });
        later(finish, JUKEBOX.hideMs * motion);
      });
    }

    /**
     * Put back: the wheel turns back to the record playing - the nearest
     * time round it comes - and it lowers onto the platter again, the
     * wheel and the dimming going.
     */
    function putBack() {
      if (closing) {
        return;
      }
      closing = true;
      var home = Math.round(stepAt(jukebox.angle) / queue.length) * queue.length;
      turnTo(home, function () {
        unlisten();
        var ms = BROWSE.putBackMs * motion;
        var record = jukeboxSlot(jukebox, home);
        jukebox.slots.forEach(function (slot) {
          if (slot === record) {
            return;
          }
          slot.holder.animate([
            { opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(30%)' },
          ], { duration: ms * 0.8, easing: 'ease-in', fill: 'forwards' });
        });
        caption.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.6, fill: 'forwards' });
        record.holder.animate([
          { transform: 'none' }, { transform: onPlatter(0, 0, 1) },
        ], { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
        jukebox.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: ms, easing: 'ease-in-out', fill: 'forwards',
        });
        MusicHub.sfx.play(JUKEBOX_SOUNDS, 'land', ms / 1000);
        later(function () {
          restorePlatter();
          finish();
        }, ms);
      });
    }
  }

  MusicHub.sync.ready(function () {
    els.view = document.getElementById('collection-view');
    els.grid = document.getElementById('collection-grid');
    els.empty = document.getElementById('collection-empty');
    els.count = document.getElementById('collection-count');
    els.player = document.getElementById('player');
    els.deck = document.getElementById('player-deck');
    els.back = document.getElementById('player-back');
    els.discogs = document.getElementById('player-discogs');
    els.title = document.getElementById('player-title');
    els.artist = document.getElementById('player-artist');
    els.status = document.getElementById('player-status');
    els.track = document.getElementById('player-track');
    els.trackName = document.getElementById('player-track-name');
    els.trackLabel = document.getElementById('player-track-label');
    els.trackCount = document.getElementById('player-count');
    els.actions = document.getElementById('player-actions');

    els.toolbar = document.getElementById('collection-toolbar');
    els.search = document.getElementById('collection-search');
    els.searchClear = document.getElementById('collection-search-clear');
    els.sort = document.getElementById('collection-sort');
    els.filters = document.getElementById('collection-filters');
    els.noMatch = document.getElementById('collection-no-match');

    els.removeDialog = document.getElementById('remove-vinyl-dialog');
    els.removeText = document.getElementById('remove-vinyl-dialog-text');
    els.removeTitle = document.getElementById('remove-vinyl-dialog-title');
    els.removeCancel = document.getElementById('remove-vinyl-cancel');
    document.getElementById('remove-vinyl-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var vinyl = pendingRemoval;
      els.removeDialog.close();
      if (vinyl) {
        removeVinyl(vinyl);
      }
    });
    els.removeCancel.addEventListener('click', function () {
      els.removeDialog.close();
    });
    // However it closes - Cancel, Escape, the X, a click outside it
    // (navbar.js) - nothing is removed.
    els.removeDialog.addEventListener('close', function () {
      pendingRemoval = null;
    });

    els.back.addEventListener('click', closePlayer);
    els.prevVinyl = document.getElementById('player-prev-vinyl');
    els.nextVinyl = document.getElementById('player-next-vinyl');
    els.prevVinyl.addEventListener('click', function () {
      switchVinyl(false);
    });
    els.nextVinyl.addEventListener('click', function () {
      switchVinyl(true);
    });
    initSongPlaylists();
    els.search.addEventListener('input', function () {
      setQuery(els.search.value);
    });
    els.searchClear.addEventListener('click', function () {
      setQuery('');
      els.search.focus();
    });
    els.filters.addEventListener('click', function (event) {
      var button = event.target.closest('.filter-button');
      if (!button || button.disabled) {
        return;
      }
      activeFilter = button.getAttribute('data-filter');
      render();
    });
    els.sort.addEventListener('click', function (event) {
      var button = event.target.closest('[data-sort]');
      if (!button) {
        return;
      }
      var key = button.getAttribute('data-sort');
      sort = key === sort.key
        ? { key: key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
        : { key: key, dir: 'desc' };
      render();
    });
    render();
  });

  // Back in the tab: catch up on what Spotify played meanwhile.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && player && player.started && !switching) {
      watchPlayback(playRun, 0);
    }
  });

  // Unboxed in another tab.
  document.addEventListener('musichub:walletchange', function () {
    if (els.grid && !tearing) {
      render();
    }
  });
})(window.MusicHub);
