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
  // What's on the turntable: { vinyl, record, started, tracks, fraction,
  // elsewhere, offAlbum, at, expect, playing, listenedMs } - see openPlayer.
  var player = null;
  // Spotify doesn't say when the track changes, so the player asks: a
  // moment after the track should end, and every POLL_MS in any case -
  // for a skip or a pause in the Spotify app.
  var POLL_MS = 10000;
  var TRACK_END_SLACK_MS = 600;
  // After the power button, once Spotify has had a moment to catch up.
  var POLL_AFTER_POWER_MS = 700;
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
  // Listening pays: LISTEN_COINS for every LISTEN_MS of the album played
  // with the page open in front - counted each LISTEN_TICK_MS, flying out
  // of the record into the balance.
  var LISTEN_COINS = 5;
  var LISTEN_MS = 20000;
  var LISTEN_TICK_MS = 1000;
  var listenTimer = 0;
  var pollTimer = 0;
  // Bumped each time a new ask is scheduled, so an answer overtaken by one
  // (from before a pause, say) is ignored.
  var pollRun = 0;
  // What the search box holds, as typed, and the date sort's direction.
  var query = '';
  var sortDir = 'desc';
  // The vinyl the remove dialog is asking about.
  var pendingRemoval = null;

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

  /* --------------------------------------------------------------- remove */

  /** Asks, in the page's own dialog, before a vinyl leaves the collection. */
  function confirmRemove(vinyl) {
    pendingRemoval = vinyl;
    var album = vinyl.album;
    els.removeText.textContent = (album ? album.name + ' by ' + album.artist + ' (' + vinyl.format + ')' : vinyl.format)
      + ' will be removed from your collection, and its style can be unboxed again in the Store. '
      + "The coins it cost aren't refunded, and this can't be undone.";
    els.removeDialog.showModal();
    // Cancel is the safe default for Enter.
    els.removeCancel.focus();
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
   * it is in the album - "5/20" - in the deck's top-right corner.
   */
  function showTrack(number, count, name, playing) {
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
    els.track.hidden = false;
    els.trackCount.textContent = number + '/' + count;
    els.trackCount.hidden = false;
  }

  function hideTrack() {
    els.track.hidden = true;
    els.trackCount.hidden = true;
  }

  /**
   * Whether `state` is where the last track button went - the track
   * skipped to, no further in than it can have got since. Until it is,
   * Spotify is still catching up.
   */
  function reachedSkip(state, progress) {
    var expect = player.expect;
    return progress.index === expect.index && state.progress_ms <= Date.now() - expect.at + 2000;
  }

  /**
   * Shows what Spotify is playing: the track under the album and artist,
   * and the tonearm as far in as the album has got - held still while
   * Spotify is paused, or has moved on to something else. Returns how
   * long until it's worth asking again.
   */
  function showPlayback(state) {
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
    };
    showTrack(progress.number, progress.count, state.item.name, state.is_playing);
    MusicHub.turntable.setNeedle(playerParts, progress.fraction,
      state.is_playing ? 1 / progress.totalMs : 0, { still: still });

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
      MusicHub.spotify.getPlaybackState().then(function (state) {
        if (run === playRun && poll === pollRun) {
          watchPlayback(run, showPlayback(state));
        }
      }).catch(function (err) {
        if (run === playRun && poll === pollRun) {
          console.warn('Could not read what Spotify is playing', err);
          watchPlayback(run, POLL_MS);
        }
      });
    }, delay);
  }

  /** The track buttons work while the album is on and the turntable switched on. */
  function updateTrackButtons() {
    if (!playerParts) {
      return;
    }
    var usable = !!(player && player.started && !player.elsewhere && playerParts.on);
    playerParts.prev.disabled = !usable;
    playerParts.next.disabled = !usable;
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
      player.at = { index: index, progressMs: 0, playing: at.playing, time: Date.now() };
      player.expect = { index: index, at: Date.now() };
      player.fraction = albumMs(index) / totalMs;
      showTrack(index + 1, player.tracks.length, player.tracks[index].name, at.playing);
      MusicHub.turntable.setNeedle(playerParts, player.fraction, at.playing ? 1 / totalMs : 0, {
        still: reducedMotion(), lift: true,
      });
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
   * Play: the collection makes way for the turntable, the record drops
   * onto it and spins - and the album starts on the user's Spotify
   * straight away, so the music comes in about as the platter gets going.
   */
  function openPlayer(vinyl) {
    var album = vinyl.album;
    var run = ++playRun;

    // The album's name opens it in the Spotify app.
    els.title.textContent = '';
    var titleLink = el('a', 'player__title-link', album.name);
    titleLink.href = 'spotify:album:' + album.id;
    titleLink.title = 'Open in Spotify';
    els.title.appendChild(titleLink);
    els.artist.textContent = album.artist;

    var spec = MusicHub.vinyl.describe(vinyl.format);
    var record = renderRecord(vinyl);
    if (playerParts) {
      playerParts.root.remove();
    }
    playerParts = MusicHub.turntable.build(record, {
      glow: MusicHub.vinyl.glowColors(spec).glow,
      powerButton: true,
      trackButtons: true,
    });
    playerParts.power.addEventListener('click', togglePower);
    playerParts.prev.addEventListener('click', function () {
      skip(false);
    });
    playerParts.next.addEventListener('click', function () {
      skip(true);
    });
    els.deck.appendChild(playerParts.root);
    // Whether the album has actually started on Spotify: switching back on
    // then resumes it, where otherwise it tries to start it again. Its
    // tracks, to tell how far through it Spotify is, how far that was when
    // last asked, and whether Spotify has moved on to something else (and
    // how many times in a row it has said so). Where in the album Spotify
    // was when last asked (`at`), and the track a track button went to,
    // while Spotify catches up (`expect`). Whether Spotify is playing the
    // album, as last asked, and how long it's been listened to towards
    // the next coins.
    player = {
      vinyl: vinyl, record: record, started: false, tracks: null, fraction: 0, elsewhere: false, offAlbum: 0,
      at: null, expect: null, playing: false, listenedMs: 0,
    };
    startListenClock();
    updateTrackButtons();
    hideTrack();
    MusicHub.spotify.getAlbumTracks(album.id).then(function (tracks) {
      if (run === playRun) {
        player.tracks = tracks;
      }
    }).catch(function (err) {
      console.warn('Could not load the album\u2019s tracks', err);
    });
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
    updateTrackButtons();

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
      MusicHub.spotify.pausePlayback().then(function () {
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
   * of it. A tick the browser held back counts for no more than two, so
   * none is ever made up in a burst.
   */
  function startListenClock() {
    window.clearInterval(listenTimer);
    var last = Date.now();
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
        MusicHub.wallet.earn(LISTEN_COINS, { from: playerParts.record, coins: LISTEN_COINS });
      }
    }, LISTEN_TICK_MS);
  }

  /** Back to the collection. The album keeps playing on Spotify. */
  function closePlayer() {
    playRun += 1;
    window.clearTimeout(pollTimer);
    window.clearInterval(listenTimer);
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
    els.track = document.getElementById('player-track');
    els.trackName = document.getElementById('player-track-name');
    els.trackLabel = document.getElementById('player-track-label');
    els.trackCount = document.getElementById('player-count');
    els.actions = document.getElementById('player-actions');

    els.toolbar = document.getElementById('collection-toolbar');
    els.search = document.getElementById('collection-search');
    els.searchClear = document.getElementById('collection-search-clear');
    els.sortDate = document.getElementById('collection-sort-date');
    els.noMatch = document.getElementById('collection-no-match');

    els.removeDialog = document.getElementById('remove-vinyl-dialog');
    els.removeText = document.getElementById('remove-vinyl-dialog-text');
    els.removeCancel = document.getElementById('remove-vinyl-cancel');
    document.getElementById('remove-vinyl-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var vinyl = pendingRemoval;
      els.removeDialog.close();
      // The collection redraws itself on the wallet's change.
      if (vinyl) {
        MusicHub.wallet.removeVinyl(vinyl);
      }
    });
    els.removeCancel.addEventListener('click', function () {
      els.removeDialog.close();
    });
    // A click on the backdrop, outside the dialog box, closes it too.
    els.removeDialog.addEventListener('click', function (event) {
      if (event.target !== els.removeDialog) {
        return;
      }
      var rect = els.removeDialog.getBoundingClientRect();
      var inside = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) {
        els.removeDialog.close();
      }
    });
    // However it closes - Cancel, Escape, the backdrop - nothing is removed.
    els.removeDialog.addEventListener('close', function () {
      pendingRemoval = null;
    });

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

  // Back in the tab: catch up on what Spotify played meanwhile.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && player && player.started) {
      watchPlayback(playRun, 0);
    }
  });

  // Unboxed in another tab.
  document.addEventListener('musichub:walletchange', function () {
    if (els.grid) {
      render();
    }
  });
})(window.MusicHub);
