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

  var els = {};
  // Draws each card's record as it scrolls into view on touch screens.
  var recordObserver = null;
  // Bumped each time the player opens or closes, so a slow answer from
  // Spotify for a record no longer playing is ignored.
  var playRun = 0;
  var playerParts = null;
  // What's on the turntable: { vinyl, record, started }.
  var player = null;
  // What the search box holds, as typed, and the date sort's direction.
  var query = '';
  var sortDir = 'desc';

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

  /** Touch screens can't hover: the record peeks out once the card is in view. */
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

  function card(vinyl) {
    var album = vinyl.album || null;
    var node = el('article', 'release-card vinyl-card');

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
      var style = el('span', 'vinyl-card__style', vinyl.format);
      style.title = vinyl.format;
      cover.appendChild(style);
    }
    node.appendChild(cover);

    if (NO_HOVER) {
      drawRecordWhenVisible(node, cover, vinyl);
    } else {
      bindRecord(node, cover, vinyl);
    }

    var body = el('div', 'release-card__body');
    if (album) {
      body.appendChild(el('h3', 'release-card__title', album.name));
      body.appendChild(el('p', 'release-card__artist', album.artist));
    } else {
      body.appendChild(el('h3', 'release-card__title', vinyl.format));
    }
    var added = formatDate(vinyl.unboxedAt);
    if (added) {
      body.appendChild(el('p', 'release-card__meta', 'Added ' + added));
    }

    // Only a vinyl pressed for an album has something to play.
    if (album && album.id) {
      var play = el('button', 'button button--primary vinyl-card__play');
      play.type = 'button';
      play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16"><polygon points="6 4 20 12 6 20 6 4" /></svg>';
      play.appendChild(document.createTextNode('Play'));
      play.setAttribute('aria-label', 'Play ' + album.name + ' by ' + album.artist);
      play.addEventListener('click', function () {
        openPlayer(vinyl);
      });
      var foot = el('div', 'vinyl-card__foot');
      foot.appendChild(play);
      body.appendChild(foot);
    }
    node.appendChild(body);
    return node;
  }

  /** Lower case, without accents, so "Björk" is found by "bjork". */
  function searchable(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /** The style, the album and the artist; every word typed has to match one of them. */
  function matchesQuery(vinyl) {
    var album = vinyl.album || {};
    var haystack = searchable([vinyl.format, album.name, album.artist].join(' '));
    return searchable(query).split(/\s+/).filter(Boolean).every(function (word) {
      return haystack.indexOf(word) !== -1;
    });
  }

  function renderSort() {
    var newest = sortDir === 'desc';
    els.sortDate.textContent = 'Date ' + (newest ? '\u2193' : '\u2191');
    els.sortDate.title = 'Sort by date, ' + (newest ? 'oldest first' : 'newest first');
    els.sortDate.setAttribute('aria-label', 'Sorted by date, ' + (newest ? 'newest first' : 'oldest first'));
  }

  function render() {
    var all = MusicHub.wallet.vinyls();
    var shown = all.filter(matchesQuery).sort(function (a, b) {
      var order = String(b.unboxedAt || '').localeCompare(String(a.unboxedAt || ''));
      return sortDir === 'desc' ? order : -order;
    });
    els.grid.textContent = '';
    els.empty.hidden = all.length > 0;
    els.toolbar.hidden = !all.length;
    els.searchClear.hidden = !query;
    els.noMatch.hidden = !all.length || shown.length > 0;
    els.noMatch.textContent = 'No vinyls match \u201c' + query.trim() + '\u201d.';
    els.count.textContent = MusicHub.wallet.format(all.length) + ' of '
      + MusicHub.wallet.format(MusicHub.vinylCatalog.size) + ' collected';
    renderSort();
    shown.forEach(function (vinyl) {
      els.grid.appendChild(card(vinyl));
    });
  }

  function setQuery(value) {
    query = value;
    els.search.value = value;
    render();
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
    MusicHub.spotify.playAlbum(album.id, {
      onLaunch: function () {
        if (run === playRun) {
          setStatus('Opening Spotify\u2026');
        }
      },
    }).then(function () {
      if (run === playRun) {
        player.started = true;
        setStatus('Playing on Spotify');
      }
    }).catch(function (err) {
      if (run === playRun) {
        console.warn('Could not start the album on Spotify', err);
        showPlaybackError(err, album);
      }
    });
  }

  /**
   * Play: the collection makes way for the turntable, the record drops
   * onto it and spins - and the album starts on the user's Spotify
   * straight away, so the music comes in about as the platter gets going.
   */
  function openPlayer(vinyl) {
    var album = vinyl.album;
    var run = ++playRun;

    els.title.textContent = album.name;
    els.artist.textContent = album.artist;

    var spec = MusicHub.vinyl.describe(vinyl.format);
    var record = renderRecord(vinyl);
    if (playerParts) {
      playerParts.root.remove();
    }
    playerParts = MusicHub.turntable.build(record, {
      glow: MusicHub.vinyl.glowColors(spec).glow,
      powerButton: true,
    });
    playerParts.power.addEventListener('click', togglePower);
    els.deck.appendChild(playerParts.root);
    // Whether the album has actually started on Spotify: switching back on
    // then resumes it, where otherwise it tries to start it again.
    player = { vinyl: vinyl, record: record, started: false };
    startAlbum(run);

    els.view.hidden = true;
    els.player.hidden = false;
    window.scrollTo({ top: 0 });
    els.back.focus({ preventScroll: true });

    if (reducedMotion()) {
      MusicHub.turntable.showPlaying(playerParts);
      return;
    }
    MusicHub.turntable.playSounds();
    MusicHub.turntable.play(playerParts);
    // Lava, smash and peppermint patterns move while it plays.
    MusicHub.vinyl.setPlaying(record, true);
  }

  /**
   * The turntable's power button: off, the platter stops, the arm goes
   * back and Spotify pauses; on, it all starts again and Spotify resumes.
   */
  function togglePower() {
    var run = playRun;
    var on = !playerParts.on;
    MusicHub.turntable.setPower(playerParts, on, { still: reducedMotion() });
    MusicHub.vinyl.setPlaying(player.record, on && !reducedMotion());

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
      MusicHub.spotify.resumePlayback().then(function () {
        if (run === playRun) {
          setStatus('Playing on Spotify');
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
      MusicHub.spotify.pausePlayback().then(function () {
        if (run === playRun) {
          setStatus('Paused on Spotify');
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

  /** Back to the collection. The album keeps playing on Spotify. */
  function closePlayer() {
    playRun += 1;
    if (playerParts) {
      playerParts.root.remove();
      playerParts = null;
    }
    player = null;
    els.player.hidden = true;
    els.view.hidden = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    els.view = document.getElementById('collection-view');
    els.grid = document.getElementById('collection-grid');
    els.empty = document.getElementById('collection-empty');
    els.count = document.getElementById('collection-count');
    els.player = document.getElementById('player');
    els.deck = document.getElementById('player-deck');
    els.back = document.getElementById('player-back');
    els.title = document.getElementById('player-title');
    els.artist = document.getElementById('player-artist');
    els.status = document.getElementById('player-status');
    els.actions = document.getElementById('player-actions');

    els.toolbar = document.getElementById('collection-toolbar');
    els.search = document.getElementById('collection-search');
    els.searchClear = document.getElementById('collection-search-clear');
    els.sortDate = document.getElementById('collection-sort-date');
    els.noMatch = document.getElementById('collection-no-match');

    els.back.addEventListener('click', closePlayer);
    els.search.addEventListener('input', function () {
      setQuery(els.search.value);
    });
    els.searchClear.addEventListener('click', function () {
      setQuery('');
      els.search.focus();
    });
    els.sortDate.addEventListener('click', function () {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      render();
    });
    render();
  });

  // Unboxed in another tab.
  document.addEventListener('musichub:walletchange', function () {
    if (els.grid) {
      render();
    }
  });
})(window.MusicHub);
