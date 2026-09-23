/*
 * Album Suggester: "opens a case" CS:GO-style to pick a random album out of
 * the user's Spotify Saved Albums. The reveal links to the album in the
 * Spotify app and to its vinyl releases on Discogs; marking it listened
 * unsaves it on Spotify and adds it to a listened history kept here.
 *
 * The pool itself is never cached - it's whatever Spotify's Saved Albums
 * hold on page load. Only the history (Spotify has no "listened" concept)
 * is stored.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var HISTORY_KEY = 'albumSuggesterHistory';
  var TIMEZONE = 'Europe/Berlin';

  // Covers on the reel, whatever the size of the library, and where on it
  // the winner sits - far enough in for a long spin, with a few covers
  // still to come after it so the strip doesn't visibly end.
  var REEL_LENGTH = 50;
  var WIN_INDEX = 44;
  var SPIN_MS = 5500;
  var FLOURISH_MS = 850;
  // prefers-reduced-motion: a short, linear slide and no light show.
  var REDUCED_SPIN_MS = 1200;
  var REDUCED_FLOURISH_MS = 450;
  // The blur caps out here, so it stays a hint of speed.
  var MAX_BLUR_PX = 4;
  var PARTICLE_COUNT = 28;
  // Ticks closer together than this merge into one.
  var MIN_TICK_GAP_MS = 35;

  var els = {};
  // Saved albums still available to be cased.
  var pool = [];
  var history = [];
  var sort = { key: 'date', dir: 'desc' };
  // The album on the reveal right now.
  var current = null;
  var spinning = false;
  var libraryRequested = false;
  var removing = false;

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

  /* ------------------------------------------------------------ storage */

  function loadHistory() {
    var stored = MusicHub.storage.read(HISTORY_KEY, null);
    return stored && Array.isArray(stored.listened) ? stored.listened : [];
  }

  function saveHistory() {
    MusicHub.storage.write(HISTORY_KEY, { listened: history });
  }

  /* ------------------------------------------------------------ spotify */

  // Spotify lists covers largest first: 640, 300, 64.
  function pickImage(images, index) {
    if (!images || !images.length) {
      return null;
    }
    return images[Math.min(index, images.length - 1)].url;
  }

  function toAlbum(album) {
    return {
      id: album.id,
      name: album.name,
      artistName: (album.artists || []).map(function (artist) { return artist.name; }).join(', '),
      imageUrl: pickImage(album.images, 1),
      largeImageUrl: pickImage(album.images, 0),
      spotifyUrl: album.external_urls ? album.external_urls.spotify : null,
    };
  }

  /** Every saved album, following `next` until Spotify runs out of pages. */
  function fetchSavedAlbums() {
    var albums = [];

    function fetchPage(path) {
      return MusicHub.auth.spotifyFetch(path).then(function (response) {
        if (!response.ok) {
          var err = new Error('Could not load your saved albums (' + response.status + ').');
          err.status = response.status;
          throw err;
        }
        return response.json();
      }).then(function (data) {
        (data.items || []).forEach(function (item) {
          if (item && item.album && item.album.id) {
            albums.push(toAlbum(item.album));
          }
        });
        return data.next ? fetchPage(data.next) : albums;
      });
    }

    return fetchPage('/me/albums?limit=50');
  }

  /** Unsaves the album. DELETE /me/albums is gone since Feb 2026; /me/library replaces it. */
  function unsaveAlbum(album) {
    var uri = 'spotify:album:' + album.id;
    return MusicHub.auth.spotifyFetch('/me/library?uris=' + encodeURIComponent(uri), { method: 'DELETE' })
      .then(function (response) {
        if (!response.ok) {
          var err = new Error('Spotify refused (' + response.status + ').');
          err.status = response.status;
          throw err;
        }
      });
  }

  // A login from before this page existed lacks the library scopes.
  function permissionHint(status) {
    return status === 401 || status === 403
      ? ' Log in again to give Music Hub access to your saved albums.'
      : '';
  }

  /* --------------------------------------------------------------- links */

  function spotifyAppUrl(album) {
    return 'spotify:album:' + album.id;
  }

  function discogsSearchUrl(album) {
    return 'https://www.discogs.com/search/?q='
      + encodeURIComponent(album.artistName + ' ' + album.name)
      + '&type=release&format=Vinyl';
  }

  /* --------------------------------------------------------------- views */

  var VIEWS = ['loading', 'error', 'empty', 'idle', 'reel', 'reveal'];

  function setView(name) {
    VIEWS.forEach(function (view) {
      els.views[view].hidden = view !== name;
    });
  }

  /** A cover image, or a plain accent square when Spotify has none (or it fails to load). */
  function cover(url, className) {
    var fallback = el('span', className + ' album-cover album-cover--empty');
    fallback.setAttribute('aria-hidden', 'true');
    if (!url) {
      return fallback;
    }
    var image = el('img', className + ' album-cover');
    image.src = url;
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', function () {
      if (image.parentNode) {
        image.parentNode.replaceChild(fallback, image);
      }
    });
    return image;
  }

  function albumCount(count) {
    return count + (count === 1 ? ' album' : ' albums') + ' in your library';
  }

  function showRestingState(exhausted) {
    if (pool.length) {
      els.count.textContent = albumCount(pool.length);
      els.openButton.disabled = false;
      setView('idle');
    } else {
      els.empty.textContent = exhausted
        ? 'Your Spotify library has no saved albums left.'
        : 'Your Spotify library has no saved albums yet.';
      setView('empty');
    }
  }

  function loadLibrary() {
    libraryRequested = true;
    setView('loading');
    fetchSavedAlbums()
      .then(function (albums) {
        pool = albums;
        showRestingState(false);
      })
      .catch(function (err) {
        console.warn('Could not load the saved albums', err);
        els.errorText.textContent = err.message + permissionHint(err.status);
        els.relogin.hidden = !permissionHint(err.status);
        setView('error');
      });
  }

  /* --------------------------------------------------------------- sound */

  /*
   * Synthesised on the spot with the Web Audio API rather than a bundled
   * file, so each tick can land exactly when a cover crosses the marker -
   * a recording couldn't follow the reel's actual speed. The shape follows
   * CS:GO's case-opening audio: a rising whoosh, ticks, a bright chime.
   */
  var audio = null;

  function audioContext() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    if (!audio) {
      audio = new AudioCtx();
    }
    // Created or resumed inside the click handler, so autoplay rules allow it.
    if (audio.state === 'suspended') {
      audio.resume();
    }
    return audio;
  }

  function playWhoosh() {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var length = 1.4;
    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;

    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(250, now);
    filter.frequency.exponentialRampToValueAtTime(2800, now + 0.7);
    filter.frequency.exponentialRampToValueAtTime(900, now + length);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + length);
  }

  function playTick() {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.03);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  function playChime() {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    // E6, G#6, B6 and E7, rolled like a quick arpeggio.
    [1318.5, 1661.2, 1975.5, 2637].forEach(function (frequency, index) {
      var start = now + index * 0.045;
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1.2);
    });
  }

  /* ---------------------------------------------------------------- reel */

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /** Shuffled rounds of `albumPool`, laid end to end, with the winner at WIN_INDEX. */
  function buildReelAlbums(albumPool, winner) {
    if (!albumPool.length) {
      return [];
    }
    var albums = [];
    while (albums.length < REEL_LENGTH) {
      var round = shuffle(albumPool.slice());
      // No album twice in a row where two rounds meet.
      if (round.length > 1 && albums.length && round[0] === albums[albums.length - 1]) {
        round.push(round.shift());
      }
      albums = albums.concat(round);
    }
    albums = albums.slice(0, REEL_LENGTH);
    albums[WIN_INDEX] = winner;
    return albums;
  }

  function renderReel(albums) {
    els.strip.textContent = '';
    els.strip.style.transform = 'translate3d(0, 0, 0)';
    return albums.map(function (album) {
      var item = el('div', 'reel__item');
      item.appendChild(cover(album.imageUrl, 'reel__cover'));
      els.strip.appendChild(item);
      return item;
    });
  }

  // Quick at the start, a long slow crawl over the last few covers.
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function setBlur(px) {
    if (px < 0.15) {
      els.window.style.filter = '';
      return;
    }
    els.blur.setAttribute('stdDeviation', px.toFixed(2) + ' 0');
    els.window.style.filter = 'url(#reel-blur)';
  }

  /** Slides the strip so `winIndex` ends up centred under the marker. */
  function animateReel(items, winIndex, done) {
    var still = reducedMotion();
    var duration = still ? REDUCED_SPIN_MS : SPIN_MS;
    var ease = still ? function (t) { return t; } : easeOutCubic;

    var first = items[0].getBoundingClientRect();
    var step = items[1].getBoundingClientRect().left - first.left;
    var itemWidth = first.width;
    var windowWidth = els.window.clientWidth;
    var distance = winIndex * step + itemWidth / 2 - windowWidth / 2;

    var start = null;
    var lastX = 0;
    var lastTime = null;
    var lastIndex = Math.floor((windowWidth / 2) / step);
    var lastTickAt = 0;

    function frame(now) {
      if (start === null) {
        start = now;
        lastTime = now;
      }
      var t = Math.min(1, (now - start) / duration);
      var x = distance * ease(t);
      els.strip.style.transform = 'translate3d(' + (-x).toFixed(2) + 'px, 0, 0)';

      if (!still) {
        var speed = (x - lastX) / Math.max(1, now - lastTime);
        setBlur(Math.min(MAX_BLUR_PX, speed * 1.4));
      }

      // A tick whenever a new cover crosses the marker.
      var index = Math.floor((x + windowWidth / 2) / step);
      if (index !== lastIndex) {
        lastIndex = index;
        if (now - lastTickAt >= MIN_TICK_GAP_MS) {
          lastTickAt = now;
          playTick();
        }
      }

      lastX = x;
      lastTime = now;
      if (t < 1) {
        window.requestAnimationFrame(frame);
      } else {
        setBlur(0);
        done();
      }
    }

    window.requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------ flourish */

  function lightPulse() {
    var pulse = el('div', 'case-pulse');
    document.body.appendChild(pulse);
    pulse.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }],
      { duration: 650, easing: 'ease-out' },
    ).onfinish = function () {
      pulse.remove();
    };
  }

  function particleBurst(target) {
    var rect = target.getBoundingClientRect();
    var burst = el('div', 'case-burst');
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top = (rect.top + rect.height / 2) + 'px';
    document.body.appendChild(burst);

    var reach = Math.max(rect.width, 80) * 1.4;
    for (var i = 0; i < PARTICLE_COUNT; i += 1) {
      var particle = el('span', 'case-burst__particle case-burst__particle--' + (i % 3));
      burst.appendChild(particle);
      var angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.4;
      var distance = reach * (0.55 + Math.random() * 0.6);
      var dx = Math.cos(angle) * distance;
      var dy = Math.sin(angle) * distance;
      particle.animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
          { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(0.3) rotate(' + Math.round(Math.random() * 360) + 'deg)', opacity: 0 },
        ],
        { duration: 600 + Math.random() * 250, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'forwards' },
      );
    }
    window.setTimeout(function () {
      burst.remove();
    }, FLOURISH_MS + 100);
  }

  /** The payoff once the reel rests; the same every time, re-rolls included. */
  function flourish(winnerItem, done) {
    playChime();
    winnerItem.classList.add('reel__item--winner');
    if (reducedMotion()) {
      window.setTimeout(done, REDUCED_FLOURISH_MS);
      return;
    }
    lightPulse();
    particleBurst(winnerItem);
    window.setTimeout(done, FLOURISH_MS);
  }

  /* -------------------------------------------------------- case opening */

  /** Equal odds for every album, bar `excludeId` (the one just revealed). */
  function pickWinner(excludeId) {
    var candidates = pool.filter(function (album) {
      return album.id !== excludeId;
    });
    if (!candidates.length) {
      candidates = pool;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function openCase(excludeId) {
    if (spinning || !pool.length) {
      return;
    }
    spinning = true;
    els.openButton.disabled = true;
    els.rerollButton.disabled = true;

    var winner = pickWinner(excludeId);
    // Warm the big reveal's cover up while the reel runs.
    if (winner.largeImageUrl) {
      new Image().src = winner.largeImageUrl;
    }

    setView('reel');
    var items = renderReel(buildReelAlbums(pool, winner));
    playWhoosh();
    animateReel(items, WIN_INDEX, function () {
      flourish(items[WIN_INDEX], function () {
        spinning = false;
        showReveal(winner);
      });
    });
  }

  function showReveal(album) {
    current = album;
    els.revealCover.textContent = '';
    els.revealCover.appendChild(cover(album.largeImageUrl || album.imageUrl, 'reveal__image'));
    els.revealTitle.textContent = album.name;
    els.revealArtist.textContent = album.artistName;
    els.revealSpotify.href = spotifyAppUrl(album);
    els.revealDiscogs.href = discogsSearchUrl(album);
    // Nothing else to re-roll to when it's the only album left.
    els.rerollButton.hidden = pool.length < 2;
    els.rerollButton.disabled = false;
    setView('reveal');
    els.revealTitle.focus({ preventScroll: true });
  }

  function markNotListened() {
    current = null;
    showRestingState(false);
    els.openButton.focus();
  }

  /* ------------------------------------------------------ mark listened */

  function openListenedDialog() {
    if (!current) {
      return;
    }
    els.dialogText.textContent = 'This removes "' + current.name + '" by ' + current.artistName
      + ' from your Saved Albums on Spotify - not just from this page.';
    els.rating.value = '';
    els.dialogError.hidden = true;
    els.dialog.showModal();
    els.rating.focus();
  }

  /** '' -> null (unrated), a whole number 1-100, or undefined when invalid. */
  function parseRating(raw) {
    var value = String(raw || '').trim();
    if (!value) {
      return null;
    }
    if (!/^\d+$/.test(value)) {
      return undefined;
    }
    var rating = Number(value);
    return rating >= 1 && rating <= 100 ? rating : undefined;
  }

  function setRemoving(on) {
    removing = on;
    els.dialogSubmit.disabled = on;
    els.dialogCancel.disabled = on;
    els.rating.disabled = on;
    els.dialogSubmit.textContent = on ? 'Removing…' : 'Mark as listened';
  }

  function showDialogError(message) {
    els.dialogError.textContent = message;
    els.dialogError.hidden = false;
  }

  function confirmListened() {
    // The rating input reads '' for anything the browser can't parse as a number.
    var rating = parseRating(els.rating.validity.badInput ? 'x' : els.rating.value);
    if (rating === undefined) {
      showDialogError('A rating is a whole number from 1 to 100 - or leave it empty.');
      els.rating.focus();
      return;
    }

    var album = current;
    els.dialogError.hidden = true;
    setRemoving(true);
    unsaveAlbum(album)
      .then(function () {
        setRemoving(false);
        pool = pool.filter(function (entry) {
          return entry.id !== album.id;
        });
        history.push({
          spotifyAlbumId: album.id,
          albumName: album.name,
          artistName: album.artistName,
          imageUrl: album.imageUrl,
          spotifyUrl: album.spotifyUrl,
          listenedAt: new Date().toISOString(),
          rating: rating,
        });
        saveHistory();
        renderHistory();
        current = null;
        els.dialog.close();
        showRestingState(true);
      })
      .catch(function (err) {
        // The album stays saved and in the pool; the rating stays typed in.
        setRemoving(false);
        console.warn('Could not unsave the album', err);
        showDialogError("Couldn't remove it from your Spotify library - nothing was changed. "
          + (err.status ? err.message : 'Check your connection and try again.')
          + permissionHint(err.status));
      });
  }

  /* ------------------------------------------------------------- history */

  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric',
    }).format(date);
  }

  function byDate(a, b) {
    var at = a.listenedAt || '';
    var bt = b.listenedAt || '';
    return at < bt ? -1 : at > bt ? 1 : 0;
  }

  /** One sort at a time; unrated entries always go after rated ones. */
  function sortHistory(entries, order) {
    var sign = order.dir === 'asc' ? 1 : -1;
    return entries.slice().sort(function (a, b) {
      if (order.key === 'rating') {
        var aRated = typeof a.rating === 'number';
        var bRated = typeof b.rating === 'number';
        if (aRated !== bRated) {
          return aRated ? -1 : 1;
        }
        if (aRated && a.rating !== b.rating) {
          return sign * (a.rating - b.rating);
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

  function renderSortControls() {
    Array.prototype.forEach.call(els.sortButtons, function (button) {
      var key = button.getAttribute('data-sort');
      var active = key === sort.key;
      var labels = SORT_LABELS[key];
      button.classList.toggle('filter-button--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.textContent = labels.label + (active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');
      button.title = 'Sort by ' + labels.label.toLowerCase() + ', '
        + (active ? labels[sort.dir === 'desc' ? 'asc' : 'desc'] : labels.desc);
      button.setAttribute('aria-label', active
        ? 'Sorted by ' + labels.label.toLowerCase() + ', ' + labels[sort.dir]
        : 'Sort by ' + labels.label.toLowerCase());
    });
  }

  function renderHistory() {
    els.historyList.textContent = '';
    els.historyEmpty.hidden = history.length > 0;
    els.historyList.hidden = !history.length;
    els.sortGroup.hidden = history.length < 2;
    renderSortControls();

    sortHistory(history, sort).forEach(function (entry) {
      var item = el('li', 'history-item');
      item.appendChild(cover(entry.imageUrl, 'history-item__cover'));

      var text = el('div', 'history-item__text');
      text.appendChild(el('p', 'history-item__title', entry.albumName));
      text.appendChild(el('p', 'history-item__artist', entry.artistName));
      text.appendChild(el('p', 'history-item__date', 'Listened ' + formatDate(entry.listenedAt)));
      item.appendChild(text);

      var rated = typeof entry.rating === 'number';
      var rating = el('span', 'history-item__rating' + (rated ? '' : ' history-item__rating--none'),
        rated ? String(entry.rating) : 'unrated');
      if (rated) {
        rating.setAttribute('aria-label', 'Rated ' + entry.rating + ' out of 100');
      }
      item.appendChild(rating);
      els.historyList.appendChild(item);
    });
  }

  function onSortClick(event) {
    var button = event.target.closest('[data-sort]');
    if (!button) {
      return;
    }
    var key = button.getAttribute('data-sort');
    sort = key === sort.key
      ? { key: key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
      : { key: key, dir: 'desc' };
    renderHistory();
  }

  /* ---------------------------------------------------------------- init */

  document.addEventListener('DOMContentLoaded', function () {
    els.views = {
      loading: document.getElementById('case-loading'),
      error: document.getElementById('case-error'),
      empty: document.getElementById('case-empty'),
      idle: document.getElementById('case-idle'),
      reel: document.getElementById('case-reel'),
      reveal: document.getElementById('case-reveal'),
    };
    if (!els.views.idle) {
      return;
    }
    els.errorText = document.getElementById('case-error-text');
    els.relogin = document.getElementById('case-relogin');
    els.empty = els.views.empty;
    els.count = document.getElementById('case-count');
    els.openButton = document.getElementById('case-open');
    els.window = document.getElementById('reel-window');
    els.strip = document.getElementById('reel-strip');
    els.blur = document.getElementById('reel-blur-amount');
    els.revealCover = document.getElementById('reveal-cover');
    els.revealTitle = document.getElementById('reveal-title');
    els.revealArtist = document.getElementById('reveal-artist');
    els.revealSpotify = document.getElementById('reveal-spotify');
    els.revealDiscogs = document.getElementById('reveal-discogs');
    els.rerollButton = document.getElementById('reveal-reroll');
    els.dialog = document.getElementById('listened-dialog');
    els.dialogText = document.getElementById('listened-dialog-text');
    els.rating = document.getElementById('listened-rating');
    els.dialogError = document.getElementById('listened-error');
    els.dialogSubmit = document.getElementById('listened-submit');
    els.dialogCancel = document.getElementById('listened-cancel');
    els.historyList = document.getElementById('history-list');
    els.historyEmpty = document.getElementById('history-empty');
    els.sortGroup = document.getElementById('history-sort');
    els.sortButtons = els.sortGroup.querySelectorAll('[data-sort]');
    els.revealTitle.tabIndex = -1;

    document.getElementById('case-retry').addEventListener('click', loadLibrary);
    els.openButton.addEventListener('click', function () {
      openCase(null);
    });
    els.rerollButton.addEventListener('click', function () {
      openCase(current ? current.id : null);
    });
    document.getElementById('reveal-not-listened').addEventListener('click', markNotListened);
    document.getElementById('reveal-listened').addEventListener('click', openListenedDialog);
    els.sortGroup.addEventListener('click', onSortClick);

    document.getElementById('listened-form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (!removing) {
        confirmListened();
      }
    });
    els.dialogCancel.addEventListener('click', function () {
      els.dialog.close();
    });
    // No closing it with Escape halfway through the request.
    els.dialog.addEventListener('cancel', function (event) {
      if (removing) {
        event.preventDefault();
      }
    });

    history = loadHistory();
    renderHistory();

    if (MusicHub.auth.isLoggedIn()) {
      loadLibrary();
    }
  });

  document.addEventListener('musichub:authchange', function (event) {
    if (event.detail && event.detail.loggedIn && els.views && !libraryRequested) {
      loadLibrary();
    }
  });

  // Exposed for tests.
  MusicHub.albumSuggester = {
    sortHistory: sortHistory,
    parseRating: parseRating,
    discogsSearchUrl: discogsSearchUrl,
    buildReelAlbums: buildReelAlbums,
  };
})(window.MusicHub);
