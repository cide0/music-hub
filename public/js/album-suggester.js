/*
 * Album Suggester: "opens a case" CS:GO-style to pick a random album out of
 * the user's Spotify Saved Albums. Each album gets a CS:GO rarity tier from
 * how long it has been saved - the newest are gold, the oldest blue, so the
 * albums that have waited longest come up most - and, as in a real case,
 * the rarity is rolled first and an album from that tier second, so gold is
 * always the rarest pull. The reveal links to the album in the Spotify app
 * and to its vinyl releases on Discogs; marking it listened unsaves it on
 * Spotify and adds it to a listened history kept here. The history's "+"
 * adds an album to it by hand, from its Spotify link - without a rarity.
 *
 * The pool is the Saved Albums as last fetched, remembered between
 * visits: Spotify is only asked again when the user presses "Update from
 * Spotify". The history (Spotify has no "listened" concept) is stored too.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var HISTORY_KEY = 'albumSuggesterHistory';
  var LIBRARY_KEY = 'albumSuggesterLibrary';
  var TIMEZONE = 'Europe/Berlin';

  // Covers on the reel, whatever the size of the library, and where on it
  // the winner sits - far enough in for a long spin, with a few covers
  // still to come after it so the strip doesn't visibly end.
  var REEL_LENGTH = 110;
  var WIN_INDEX = 104;
  var SPIN_MS = 11000;
  var FLOURISH_MS = 850;
  // A gold win gets the long celebration.
  var GOLD_FLOURISH_MS = 2600;
  // prefers-reduced-motion: a short, linear slide and no light show.
  var REDUCED_SPIN_MS = 1200;
  var REDUCED_FLOURISH_MS = 450;
  var REDUCED_GOLD_FLOURISH_MS = 900;
  // The blur caps out here, so it stays a hint of speed.
  var MAX_BLUR_PX = 4;
  var PARTICLE_COUNT = 28;
  var CONFETTI_COUNT = 70;
  var CONFETTI_BATCH = 18;
  // Pixels per second squared the gold confetti falls with.
  var CONFETTI_GRAVITY = 1500;
  var GOLD_SPARKLES = 4;
  // Ticks closer together than this merge into one.
  var MIN_TICK_GAP_MS = 35;

  // Rarity tiers, newest saves first: each takes the next `share` of the
  // library by save date, and is rolled with `odds`, whatever its size. A
  // tier with no albums yet is skipped and the others scaled up to match.
  var TIERS = [
    { name: 'gold', share: 0.01, odds: 0.02 },
    { name: 'red', share: 0.04, odds: 0.06 },
    { name: 'pink', share: 0.08, odds: 0.11 },
    { name: 'purple', share: 0.25, odds: 0.27 },
    { name: 'blue', share: 0.62, odds: 0.54 },
  ];
  // Coins each tier earns when it's revealed - and again when that album
  // is marked listened and joins the history.
  var TIER_COINS = { blue: 50, purple: 100, pink: 250, red: 500, gold: 1000 };
  // Coins fly once the reveal has settled in, not while it's still popping up.
  var COINS_DELAY_MS = 450;

  // From this many albums on, the tiers go by TIERS' shares, with the
  // newest three at least gold, red and pink, so a small library still has
  // one of each rarest tier.
  var FULL_TIERS_FROM = 10;
  // Below that, each size is laid out by hand: per tier, how many albums it
  // takes (newest saves first, rarest tier first) and its odds.
  var SMALL_LIBRARIES = {
    1: { blue: [1, 1] },
    2: { purple: [1, 0.25], blue: [1, 0.75] },
    3: { pink: [1, 0.05], purple: [1, 0.2], blue: [1, 0.75] },
    4: { red: [1, 0.03], pink: [1, 0.07], purple: [1, 0.2], blue: [1, 0.7] },
    5: { gold: [1, 0.02], red: [1, 0.05], pink: [1, 0.1], purple: [1, 0.23], blue: [1, 0.6] },
    6: { gold: [1, 0.02], red: [1, 0.05], pink: [1, 0.1], purple: [1, 0.23], blue: [2, 0.6] },
    7: { gold: [1, 0.02], red: [1, 0.05], pink: [1, 0.1], purple: [1, 0.23], blue: [3, 0.6] },
    8: { gold: [1, 0.02], red: [1, 0.05], pink: [1, 0.1], purple: [2, 0.23], blue: [3, 0.6] },
    9: { gold: [1, 0.02], red: [1, 0.05], pink: [1, 0.1], purple: [2, 0.23], blue: [4, 0.6] },
  };
  // Each tier's odds for the library as last ranked: TIERS' own, or its
  // size's from SMALL_LIBRARIES.
  var tierOdds = {};

  var els = {};
  // Saved albums still available to be cased.
  var pool = [];
  var history = [];
  var sort = { key: 'date', dir: 'desc' };
  // What the history search box holds, as typed.
  var historyQuery = '';
  // The history starts closed on every visit; the toggle beside its count opens it.
  var historyOpen = false;
  // The album on the reveal right now.
  var current = null;
  var spinning = false;
  // While a dismissed cover is tearing apart (see tearCover).
  var tearing = false;
  // While "Update from Spotify" is fetching, and when it last succeeded.
  var refreshing = false;
  var fetchedAt = null;
  var currentView = null;
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

  /** The Saved Albums as last fetched, or null before the first fetch. */
  function loadLibraryCache() {
    var stored = MusicHub.storage.read(LIBRARY_KEY, null);
    if (!stored || !Array.isArray(stored.albums)) {
      return null;
    }
    return {
      fetchedAt: stored.fetchedAt || null,
      albums: stored.albums.filter(function (album) {
        return album && album.id;
      }).map(function (album) {
        // JSON has no Infinity, so an unknown save date comes back as null.
        return Object.assign({}, album, {
          addedAt: typeof album.addedAt === 'number' ? album.addedAt : Infinity,
        });
      }),
    };
  }

  /** Remembers `albums` as the Saved Albums. */
  function saveLibraryCache(albums) {
    MusicHub.storage.write(LIBRARY_KEY, { fetchedAt: fetchedAt, albums: albums });
  }

  /* ------------------------------------------------------------ spotify */

  // Spotify lists covers largest first: 640, 300, 64.
  function pickImage(images, index) {
    if (!images || !images.length) {
      return null;
    }
    return images[Math.min(index, images.length - 1)].url;
  }

  function toAlbum(album, addedAt) {
    var added = Date.parse(addedAt);
    return {
      id: album.id,
      // When it was saved, in ms; unknown sorts as the newest.
      addedAt: isNaN(added) ? Infinity : added,
      tier: 'blue',
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
            albums.push(toAlbum(item.album, item.added_at));
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

  function fetchErrorMessage(err) {
    return err.message
      + (err.status === 429 ? ' Spotify is limiting requests right now - try again in a while.' : '')
      + permissionHint(err.status);
  }

  /* ------------------------------------------------------------- rarity */

  /**
   * Sets each album's `tier` from where its save date ranks in `albums`,
   * and `tierOdds` to match. A library under FULL_TIERS_FROM albums takes
   * its size's layout from SMALL_LIBRARIES; a bigger one TIERS' shares, an
   * album counting by the middle of its rank.
   */
  function assignTiers(albums) {
    // Compared rather than subtracted: two unknown dates (Infinity) tie.
    var newestFirst = albums.slice().sort(function (a, b) {
      return (b.addedAt > a.addedAt) - (b.addedAt < a.addedAt);
    });
    tierOdds = {};
    var layout = newestFirst.length < FULL_TIERS_FROM && SMALL_LIBRARIES[newestFirst.length];
    if (layout) {
      var next = 0;
      TIERS.forEach(function (tier) {
        var slot = layout[tier.name];
        if (!slot) {
          return;
        }
        tierOdds[tier.name] = slot[1];
        for (var n = 0; n < slot[0]; n += 1) {
          newestFirst[next].tier = tier.name;
          next += 1;
        }
      });
      return albums;
    }

    TIERS.forEach(function (tier) {
      tierOdds[tier.name] = tier.odds;
    });
    newestFirst.forEach(function (album, index) {
      var position = (index + 0.5) / newestFirst.length;
      var reached = 0;
      var tierIndex = TIERS.length - 1;
      for (var i = 0; i < TIERS.length; i += 1) {
        reached += TIERS[i].share;
        if (position < reached) {
          tierIndex = i;
          break;
        }
      }
      // The newest is gold, the next at least red, the next at least pink.
      if (index < 3) {
        tierIndex = Math.min(tierIndex, index);
      }
      album.tier = TIERS[tierIndex].name;
    });
    return albums;
  }

  /** Rolls a rarity among the tiers `albums` has, then one of its albums. */
  function rarityPick(albums) {
    var byTier = {};
    albums.forEach(function (album) {
      (byTier[album.tier] = byTier[album.tier] || []).push(album);
    });
    var present = TIERS.filter(function (tier) {
      return byTier[tier.name];
    });
    var total = present.reduce(function (sum, tier) {
      return sum + tierOdds[tier.name];
    }, 0);
    var roll = Math.random() * total;
    var tierAlbums = byTier[present[present.length - 1].name];
    for (var i = 0; i < present.length; i += 1) {
      roll -= tierOdds[present[i].name];
      if (roll < 0) {
        tierAlbums = byTier[present[i].name];
        break;
      }
    }
    return tierAlbums[Math.floor(Math.random() * tierAlbums.length)];
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
    currentView = name;
    VIEWS.forEach(function (view) {
      els.views[view].hidden = view !== name;
    });
    renderLibraryBar();
  }

  function formatTimestamp(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: TIMEZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  /**
   * The corner refresh button - away on the reel and the reveal, which have
   * corner buttons of their own, and on the error, which has Retry - and
   * when the albums were last fetched.
   */
  function renderLibraryBar() {
    var fetched = fetchedAt ? formatTimestamp(fetchedAt) : '';
    els.libraryFetched.textContent = fetched ? 'Fetched from Spotify ' + fetched : '';
    els.libraryFetched.hidden = !fetched;
    var label = refreshing
      ? 'Updating from Spotify\u2026'
      : 'Update from Spotify' + (fetched ? ' (last fetched ' + fetched + ')' : '');
    els.libraryRefresh.hidden = currentView === 'reel' || currentView === 'reveal' || currentView === 'error';
    els.libraryRefresh.disabled = refreshing;
    els.libraryRefresh.setAttribute('aria-busy', String(refreshing));
    els.libraryRefresh.setAttribute('aria-label', label);
    els.libraryRefresh.title = label;
    els.openButton.disabled = refreshing || !pool.length;
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
        : fetchedAt
          ? 'Your Spotify library has no saved albums yet.'
          : 'Fetch your saved albums from Spotify with the refresh button to get started.';
      setView('empty');
    }
  }

  /** Puts `albums` up as the pool to case. */
  function usePool(albums) {
    pool = assignTiers(albums);
    preloadLabelCovers();
    showRestingState(false);
  }

  /** Asks Spotify for the Saved Albums again and remembers them. */
  function refreshLibrary() {
    if (refreshing) {
      return;
    }
    refreshing = true;
    els.libraryError.hidden = true;
    // With albums on hand they stay up while Spotify answers.
    var hadAlbums = pool.length > 0;
    if (hadAlbums) {
      renderLibraryBar();
    } else {
      setView('loading');
    }
    fetchSavedAlbums()
      .then(function (albums) {
        refreshing = false;
        fetchedAt = new Date().toISOString();
        saveLibraryCache(albums);
        usePool(albums);
      })
      .catch(function (err) {
        refreshing = false;
        console.warn('Could not load the saved albums', err);
        if (hadAlbums) {
          // Fades out on its own (notice.js) - unless it offers to log in
          // again, which stays until it's used or dismissed.
          var relogin = permissionHint(err.status);
          els.libraryRelogin.hidden = !relogin;
          MusicHub.notice[relogin ? 'hold' : 'flash'](els.libraryError, fetchErrorMessage(err));
          renderLibraryBar();
          return;
        }
        els.errorText.textContent = fetchErrorMessage(err);
        els.relogin.hidden = !permissionHint(err.status);
        setView('error');
      });
  }

  /* --------------------------------------------------------------- sound */

  /*
   * Synthesised on the spot with the Web Audio API rather than a bundled
   * file, so each tick can land exactly when a cover crosses the marker -
   * a recording couldn't follow the reel's actual speed. The shape follows
   * CS:GO's case-opening audio: a magazine-like snap as each cover passes,
   * and a reveal that grows with the rarity.
   */
  var audio = null;

  function audioContext() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    // Settings' "Sound effects" covers this context too.
    if (!AudioCtx || !MusicHub.wallet.soundOn()) {
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

  /*
   * The first time a page plays the click (noise or a filtered wave alike;
   * plain oscillators are fine), Chrome's main thread stalls for ~150-220ms,
   * once, starting anywhere up to ~270ms later. Unpaid, it lands in the
   * first spin. So the first spin plays one near-silent click and holds the
   * reel for at least PRIME_MS: a timer can't fire while the page is frozen,
   * so a stall that starts inside that window is over before the reel
   * moves. The turntable set-up runs longer anyway, so this costs no extra
   * wait (see playSetup). It can't happen on page load - audio stays
   * suspended until a click, and a suspended context doesn't pay it.
   */
  var PRIME_MS = 450;
  var audioPrimed = null;

  function primeAudio() {
    if (!audioPrimed) {
      audioPrimed = audioContext()
        ? new Promise(function (resolve) {
          playTick(0.001);
          window.setTimeout(resolve, PRIME_MS);
        })
        : Promise.resolve();
    }
    return audioPrimed;
  }

  // A tenth of a second of white noise, made once and reused by every tick -
  // long enough for its slowest-fading layer.
  var clickNoise = null;

  function clickNoiseBuffer(ctx) {
    if (!clickNoise) {
      clickNoise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      var data = clickNoise.getChannelData(0);
      for (var i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return clickNoise;
  }

  // The mechanism's body (slide, thud, bass), scaled down from where its
  // frequencies are written. The metal stays put: lowered, it turns woody.
  var BODY_PITCH = 0.85;

  /*
   * Every tick and reveal goes through one shared echo: dry straight out,
   * plus a copy that repeats every ECHO_S, each repeat quieter and duller.
   */
  var ECHO_S = 0.09;
  var ECHO_FEEDBACK = 0.3;
  var ECHO_LEVEL = 0.25;
  var tickBus = null;

  function tickOutput(ctx) {
    if (!tickBus) {
      tickBus = ctx.createGain();
      // A limiter, so the layers landing together never clip.
      var limiter = ctx.createDynamicsCompressor();
      // Only real overs: set lower, it ducks every tick and dulls the metal.
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.0005;
      limiter.release.value = 0.02;
      limiter.connect(ctx.destination);
      tickBus.connect(limiter);

      var delay = ctx.createDelay(1);
      delay.delayTime.value = ECHO_S;
      var dull = ctx.createBiquadFilter();
      dull.type = 'lowpass';
      // Softens each repeat a little - any lower and metal turns to wood.
      dull.frequency.value = 5000;
      var feedback = ctx.createGain();
      feedback.gain.value = ECHO_FEEDBACK;
      var wet = ctx.createGain();
      wet.gain.value = ECHO_LEVEL;

      tickBus.connect(delay);
      delay.connect(dull);
      dull.connect(feedback).connect(delay);
      dull.connect(wet).connect(limiter);
    }
    return tickBus;
  }

  /*
   * The metal kit the ticks and the reveals are all built from, played into
   * the shared echo so they sound like one set of mechanics.
   */

  /** Filtered noise with a quick swell and fade: slides, cracks, clanks. */
  function metalNoise(ctx, at, type, frequency, q, peak, attack, decay) {
    var source = ctx.createBufferSource();
    source.buffer = clickNoiseBuffer(ctx);
    var filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    source.connect(filter).connect(gain).connect(tickOutput(ctx));
    source.start(at);
    source.stop(at + attack + decay + 0.01);
  }

  /** A sine that strikes and fades, optionally sliding: thuds, booms, rings. */
  function metalTone(ctx, at, from, to, peak, decay) {
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(tickOutput(ctx));
    osc.start(at);
    osc.stop(at + decay + 0.01);
  }

  /**
   * A magazine clicked into a gun: a quick metal-on-metal slide, the hard
   * snap as it seats - a sharp crack, a heavy thud for the weight and a
   * metallic ring - then the catch's small, dry click as it locks.
   * Options, all 1 by default: `level` (everything), `pitch` (the metal),
   * `body` (slide and thud), `weight` (thud and bass), `ring` (how long the
   * metal rings on).
   */
  function mechanism(ctx, at, options) {
    var o = options || {};
    var level = o.level || 1;
    var pitch = o.pitch || 1;
    var body = (o.body || 1) * BODY_PITCH;
    var weight = (o.weight || 1) * level;
    var ring = o.ring || 1;
    var seatAt = at + 0.014;
    var catchAt = seatAt + 0.03;

    // The slide: a short scrape that swells into the snap.
    metalNoise(ctx, at, 'bandpass', 2800 * body, 1.2, 0.25 * level, 0.012, 0.004);
    // The snap: a sharp, wide crack and the brighter bite of metal, hitting
    // at once and fading out over a few beats rather than cutting off.
    metalNoise(ctx, seatAt, 'highpass', 2200 * pitch, 0.7, 0.75 * level, 0.0005, 0.009);
    metalNoise(ctx, seatAt, 'bandpass', 4800 * pitch, 4, 0.55 * level, 0.0005, 0.02);
    // The weight: a heavy thud, and a deeper bass drop under it. No mid
    // knock - that's what reads as wood.
    metalTone(ctx, seatAt, 200 * body, 100 * body, 0.4 * weight, 0.085);
    metalTone(ctx, seatAt, 95 * body, 55 * body, 0.28 * weight, 0.12);
    // The clank: noise through a very narrow band rings like a struck plate.
    metalNoise(ctx, seatAt, 'bandpass', 2400 * pitch, 14, 0.9 * level, 0.0005, 0.09);
    // The ring: bright, uneven overtones that hang on, as struck metal's do.
    [[2380, 0.085, 0.18], [3960, 0.072, 0.14], [5870, 0.054, 0.1], [8150, 0.036, 0.07]].forEach(function (partial) {
      metalTone(ctx, seatAt, partial[0] * pitch, partial[0] * pitch, partial[1] * level, partial[2] * ring);
    });
    // The catch locking: a small, bright metal click with a short ping.
    metalNoise(ctx, catchAt, 'highpass', 3000 * pitch, 0.9, 0.6 * level, 0.0005, 0.003);
    metalNoise(ctx, catchAt, 'bandpass', 3600 * pitch, 15, 0.7 * level, 0.0005, 0.03);
    metalTone(ctx, catchAt, 3600 * pitch, 3600 * pitch, 0.05 * level, 0.05);
    return seatAt;
  }

  /**
   * A slide racked back and let go: a long scrape back, a light knock as it
   * stops, then a scrape forward into a full mechanism. Returns when the
   * final snap lands.
   */
  function rack(ctx, at, options) {
    metalNoise(ctx, at, 'bandpass', 2000, 1.5, 0.3, 0.06, 0.02);
    mechanism(ctx, at + 0.07, { level: 0.45, weight: 0.4, ring: 0.6 });
    return mechanism(ctx, at + 0.17, options);
  }

  /**
   * A struck piece of metal left to ring: the uneven overtones of a bell
   * (2x, 2.76x, 4.07x, 5.4x), plus a slightly detuned twin of the
   * fundamental so it shimmers as it fades over `length` seconds.
   */
  function metalBell(ctx, at, frequency, peak, length) {
    [[1, 1, 1], [1.006, 0.6, 1], [2, 0.55, 0.8], [2.76, 0.5, 0.6], [4.07, 0.3, 0.45], [5.4, 0.2, 0.3]].forEach(function (partial) {
      var f = frequency * partial[0];
      metalTone(ctx, at, f, f, peak * partial[1], length * partial[2]);
    });
  }

  /**
   * Runs `build` shortly before audio time `at` rather than now: a big
   * reveal is hundreds of nodes, and making them all in the frame the
   * celebration starts would stall it. The lead keeps them on time even
   * when that frame runs long.
   */
  var BUILD_LEAD_S = 0.12;

  function soon(ctx, at, build) {
    window.setTimeout(build, Math.max(0, (at - ctx.currentTime - BUILD_LEAD_S) * 1000));
  }

  /** A deep hit under the rarer reveals: a sine falling an octave. */
  function boom(ctx, at, frequency, peak, length) {
    metalTone(ctx, at, frequency, frequency / 2, peak, length);
  }

  // Every other tick is pitched a little lower, so a run of them isn't
  // machine-identical.
  var tickCount = 0;

  /** A cover passing the marker: one mechanism. */
  function playTick(level) {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var pitch = tickCount % 2 === 0 ? 1 : 0.94;
    tickCount += 1;
    mechanism(ctx, ctx.currentTime, { level: level === undefined ? 1 : level, pitch: pitch, body: pitch });
  }

  /** A swelling hiss of high noise, the "sparkle" behind the gold reveal. */
  function shimmer(ctx, start, length) {
    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.06, start + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    noise.connect(filter).connect(gain).connect(tickOutput(ctx));
    noise.start(start);
    noise.stop(start + length);
  }

  /**
   * The sound as the reel rests, from the same metal as the ticks: each
   * tier adds more mechanism, more weight and longer, brighter ringing.
   */
  var REVEAL_SOUNDS = {
    // One hard snap that rings on.
    blue: function (ctx, now) {
      mechanism(ctx, now, { level: 1.2, weight: 1.3, ring: 2 });
    },
    // A double snap, chk-CHK, and a short ting.
    purple: function (ctx, now) {
      mechanism(ctx, now, { level: 0.8, ring: 1.2 });
      var slam = mechanism(ctx, now + 0.12, { level: 1.3, weight: 1.6, ring: 2.5 });
      metalBell(ctx, slam + 0.02, 1760, 0.05, 0.5);
    },
    // Racked and slammed home, then two rising tings.
    pink: function (ctx, now) {
      var slam = rack(ctx, now, { level: 1.3, weight: 1.8, ring: 3 });
      metalBell(ctx, slam + 0.02, 1760, 0.06, 0.8);
      metalBell(ctx, slam + 0.14, 2350, 0.055, 0.8);
    },
    // Heavier and deeper, a boom under it and three rising bells.
    red: function (ctx, now) {
      var slam = rack(ctx, now, { level: 1.4, body: 0.85, weight: 2.2, ring: 4 });
      boom(ctx, slam, 90, 0.5, 0.5);
      [1320, 1760, 2640].forEach(function (frequency, index) {
        var at = slam + 0.03 + index * 0.1;
        soon(ctx, at, function () {
          metalBell(ctx, at, frequency, 0.065, 1.2);
        });
      });
    },
    // The heaviest slam and deepest boom, a ringing chord of bells, a run
    // up and a long sparkle of little pings.
    gold: function (ctx, now) {
      var slam = rack(ctx, now, { level: 1.5, body: 0.75, weight: 2.6, ring: 5 });
      boom(ctx, slam, 70, 0.6, 0.8);
      soon(ctx, slam + 0.05, function () {
        [1320, 1661, 1976, 2637].forEach(function (frequency) {
          metalBell(ctx, slam + 0.05, frequency, 0.045, 2.2);
        });
      });
      [2637, 3322, 3951, 5274].forEach(function (frequency, index) {
        var at = slam + 0.35 + index * 0.09;
        soon(ctx, at, function () {
          metalBell(ctx, at, frequency, 0.04, 1);
        });
      });
      soon(ctx, slam + 0.1, function () {
        shimmer(ctx, slam + 0.1, 1.8);
      });
      for (var i = 0; i < 12; i += 1) {
        var at = slam + 0.6 + i * 0.11 + Math.random() * 0.05;
        var sparkle = [5274, 6644, 7902, 10548][Math.floor(Math.random() * 4)];
        soon(ctx, at, metalBell.bind(null, ctx, at, sparkle, 0.022, 0.25));
      }
    },
  };

  function playReveal(tier) {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    (REVEAL_SOUNDS[tier] || REVEAL_SOUNDS.blue)(ctx, ctx.currentTime);
  }

  /* ---------------------------------------------------------------- reel */

  /**
   * The reel's covers, with the winner at WIN_INDEX. Every other cover is
   * drawn with the same tier odds as the pick itself, so rare colours roll
   * by as rarely as they're won - and never the same album twice in a row.
   */
  function buildReelAlbums(albumPool, winner) {
    var albums = [];
    albums[WIN_INDEX] = winner;

    function fill(index, neighbour) {
      var candidates = albumPool.filter(function (album) {
        return album !== neighbour;
      });
      albums[index] = rarityPick(candidates.length ? candidates : albumPool);
    }

    // Outwards from the winner, so each cover only has one neighbour to avoid.
    for (var before = WIN_INDEX - 1; before >= 0; before -= 1) {
      fill(before, albums[before + 1]);
    }
    for (var after = WIN_INDEX + 1; after < REEL_LENGTH; after += 1) {
      fill(after, albums[after - 1]);
    }
    return albums;
  }

  /**
   * Gold's extras around a cover already in `container`: a frame whose light
   * circles the edge (a spinning gradient behind the inset cover) and a few
   * twinkling sparkles on top.
   */
  function decorateGold(container) {
    var frame = el('span', 'gold-frame');
    frame.setAttribute('aria-hidden', 'true');
    container.insertBefore(frame, container.firstChild);
    for (var i = 0; i < GOLD_SPARKLES; i += 1) {
      var sparkle = el('span', 'gold-sparkle gold-sparkle--' + i);
      sparkle.setAttribute('aria-hidden', 'true');
      container.appendChild(sparkle);
    }
  }

  /** Slowly turning gold light rays, behind whatever `container` holds. */
  function goldRays(container, className) {
    var rays = el('span', 'gold-rays ' + className);
    rays.setAttribute('aria-hidden', 'true');
    rays.appendChild(el('span', 'gold-rays__spin'));
    container.insertBefore(rays, container.firstChild);
    return rays;
  }

  function renderReel(albums) {
    els.strip.textContent = '';
    els.strip.style.transform = 'translate3d(0, 0, 0)';
    return albums.map(function (album) {
      var item = el('div', 'reel__item');
      item.dataset.rarity = album.tier;
      item.appendChild(cover(album.imageUrl, 'reel__cover'));
      if (album.tier === 'gold') {
        decorateGold(item);
      }
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

  /** A flash of light in `tier`'s colour. */
  function lightPulse(tier) {
    var gold = tier === 'gold';
    var pulse = el('div', gold ? 'case-pulse case-pulse--gold' : 'case-pulse');
    pulse.dataset.rarity = tier;
    document.body.appendChild(pulse);
    pulse.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }],
      { duration: gold ? 1100 : 650, easing: 'ease-out' },
    ).onfinish = function () {
      pulse.remove();
    };
  }

  /**
   * Particles in `tier`'s colour, out of `rect` - the winner's, measured
   * before the flourish restyles anything.
   */
  function particleBurst(rect, tier) {
    var burst = el('div', tier === 'gold' ? 'case-burst case-burst--gold' : 'case-burst');
    burst.dataset.rarity = tier;
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

  /**
   * Gold confetti: pieces fired up and out of `rect`'s centre in a fan, then
   * pulled down by gravity while they tumble, so they rain over the reveal.
   * Made a batch per frame, so the flourish's first frame stays light.
   */
  function goldConfetti(rect) {
    var burst = el('div', 'case-burst');
    burst.style.left = (rect.left + rect.width / 2) + 'px';
    burst.style.top = (rect.top + rect.height / 2) + 'px';
    document.body.appendChild(burst);

    var made = 0;
    var longest = 0;
    function piece(index) {
      var node = el('span', 'confetti confetti--' + (index % 4));
      burst.appendChild(node);
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      var speed = 420 + Math.random() * 520;
      var vx = Math.cos(angle) * speed;
      var vy = Math.sin(angle) * speed;
      var spin = (Math.random() - 0.5) * 1440;
      var seconds = 1.7 + Math.random() * 0.9;
      longest = Math.max(longest, seconds);

      var frames = [];
      for (var k = 0; k <= 6; k += 1) {
        var t = (k / 6) * seconds;
        var x = vx * t;
        var y = vy * t + 0.5 * CONFETTI_GRAVITY * t * t;
        frames.push({
          transform: 'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0) rotate(' + Math.round(spin * k / 6) + 'deg) rotateX(' + (k * 90) + 'deg)',
          opacity: k < 5 ? 1 : (6 - k) / 2,
        });
      }
      node.animate(frames, { duration: seconds * 1000, easing: 'linear', fill: 'forwards' });
    }

    function batch() {
      var until = Math.min(CONFETTI_COUNT, made + CONFETTI_BATCH);
      for (; made < until; made += 1) {
        piece(made);
      }
      if (made < CONFETTI_COUNT) {
        window.requestAnimationFrame(batch);
      } else {
        window.setTimeout(function () {
          burst.remove();
        }, longest * 1000 + 100);
      }
    }
    window.requestAnimationFrame(batch);
  }

  /**
   * A gold win: the other covers dim, gold rays spin up behind the winner,
   * a gold flash, a burst plus falling confetti, and a bigger pop.
   */
  function goldFlourish(winnerItem, done) {
    var reel = els.views.reel;
    var rect = winnerItem.getBoundingClientRect();
    winnerItem.classList.add('reel__item--winner', 'reel__item--winner-gold');
    reel.classList.add('reel--gold');
    if (reducedMotion()) {
      lightPulse('gold');
      window.setTimeout(function () {
        reel.classList.remove('reel--gold');
        done();
      }, REDUCED_GOLD_FLOURISH_MS);
      return;
    }
    var rays = goldRays(reel, 'gold-rays--reel');
    lightPulse('gold');
    particleBurst(rect, 'gold');
    goldConfetti(rect);
    window.setTimeout(function () {
      rays.remove();
      reel.classList.remove('reel--gold');
      done();
    }, GOLD_FLOURISH_MS);
  }

  /** The payoff once the reel rests: louder the rarer it is, and gold gets its own. */
  function flourish(winnerItem, tier, done) {
    playReveal(tier);
    if (tier === 'gold') {
      goldFlourish(winnerItem, done);
      return;
    }
    var rect = winnerItem.getBoundingClientRect();
    winnerItem.classList.add('reel__item--winner');
    if (reducedMotion()) {
      window.setTimeout(done, REDUCED_FLOURISH_MS);
      return;
    }
    lightPulse(tier);
    particleBurst(rect, tier);
    window.setTimeout(done, FLOURISH_MS);
  }

  /* ---------------------------------------------------------------- setup */

  /*
   * Before every spin a record drops onto a turntable laid over the reel
   * (turntable.js), inside its neon frame: it lands, spins up, the tonearm
   * swings in and drops the needle, then the turntable fades out over the
   * reel already rolling. Times in ms from the click: the turntable's own,
   * plus when the reel takes over.
   */
  var SETUP = Object.assign({}, MusicHub.turntable.TIMING, {
    // The record playing, needle down, before the hand-off.
    handoff: 3400,
    fade: 450,
  });
  var REDUCED_SETUP_MS = 500;
  // Crackles per second of play, from the needle drop to the fade's end.
  var CRACKLES_PER_S = 30;

  /** The rarest tier the library has - gold, when there is one. */
  function rarestTier() {
    for (var i = 0; i < TIERS.length; i += 1) {
      var name = TIERS[i].name;
      if (pool.some(function (album) { return album.tier === name; })) {
        return name;
      }
    }
    return TIERS[0].name;
  }

  /** That tier's albums that have a cover to show. */
  function rarestTierAlbums() {
    var tier = rarestTier();
    return pool.filter(function (album) {
      return album.tier === tier && album.imageUrl;
    });
  }

  // The record's label shows one of them, so have them ready.
  function preloadLabelCovers() {
    rarestTierAlbums().forEach(function (album) {
      new Image().src = album.imageUrl;
    });
  }

  function labelCover() {
    var albums = rarestTierAlbums();
    return albums.length ? albums[Math.floor(Math.random() * albums.length)].imageUrl : null;
  }

  /**
   * The record landing, the needle's click and a little crackle - all
   * timed on the audio clock from the click, so the first spin's stall
   * can't knock them out of step with the picture.
   */
  function playSetupSounds() {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var landAt = now + (SETUP.drop * 0.6) / 1000;
    metalTone(ctx, landAt, 120, 60, 0.4, 0.18);
    metalNoise(ctx, landAt, 'lowpass', 900, 0.7, 0.25, 0.001, 0.05);

    // The power button's click.
    var powerAt = now + (SETUP.spinFrom - MusicHub.turntable.POWER_PRESS_MS / 2) / 1000;
    metalNoise(ctx, powerAt, 'bandpass', 1800, 2, 0.25, 0.0005, 0.006);

    var needleAt = now + SETUP.needleAt / 1000;
    metalNoise(ctx, needleAt, 'highpass', 2500, 0.7, 0.35, 0.0005, 0.004);
    metalTone(ctx, needleAt, 180, 120, 0.12, 0.05);
    var playS = (SETUP.handoff + SETUP.fade - SETUP.needleAt) / 1000;
    for (var i = 0; i < CRACKLES_PER_S * playS; i += 1) {
      metalNoise(ctx, needleAt + 0.02 + Math.random() * playS, 'highpass', 2000 + Math.random() * 3000, 0.8,
        0.04 + Math.random() * 0.12, 0.0005, 0.002 + Math.random() * 0.003);
    }
  }

  /**
   * Plays the set-up - a polished metal record in the rarest tier's colour,
   * one of that tier's covers as its label - and resolves when the reel
   * should start rolling.
   */
  function playSetup() {
    var vinyl = MusicHub.vinyl.render(MusicHub.vinyl.describe('Vinyl, LP, Gold'), { imageUrl: labelCover() });
    var parts = MusicHub.turntable.build(vinyl, { rarity: rarestTier() });
    els.views.reel.appendChild(parts.root);

    if (reducedMotion()) {
      MusicHub.turntable.showPlaying(parts);
      return new Promise(function (resolve) {
        window.setTimeout(function () {
          parts.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }).onfinish = function () {
            parts.root.remove();
          };
          resolve();
        }, REDUCED_SETUP_MS);
      });
    }

    playSetupSounds();
    MusicHub.turntable.play(parts, { spinUntil: SETUP.handoff + SETUP.fade });

    parts.root.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.04)' }], {
      delay: SETUP.handoff, duration: SETUP.fade, easing: 'ease-in', fill: 'forwards',
    }).onfinish = function () {
      parts.root.remove();
    };

    return new Promise(function (resolve) {
      window.setTimeout(resolve, SETUP.handoff);
    });
  }

  /* -------------------------------------------------------- case opening */

  /** A rarity-first pick, bar `excludeId` (the one just revealed). */
  function pickWinner(excludeId) {
    var candidates = pool.filter(function (album) {
      return album.id !== excludeId;
    });
    return rarityPick(candidates.length ? candidates : pool);
  }

  function openCase(excludeId) {
    if (spinning || refreshing || !pool.length) {
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
    Promise.all([primeAudio(), playSetup()]).then(function () {
      animateReel(items, WIN_INDEX, function () {
        flourish(items[WIN_INDEX], winner.tier, function () {
          spinning = false;
          showReveal(winner);
          window.setTimeout(function () {
            earnCoins(winner.tier, els.revealCover);
          }, COINS_DELAY_MS);
        });
      });
    });
  }

  /** The tier's coins, flying up to the navbar from `from`. */
  function earnCoins(tier, from) {
    if (MusicHub.wallet) {
      MusicHub.wallet.earn(TIER_COINS[tier] || TIER_COINS.blue, { from: from });
    }
  }

  function showReveal(album) {
    current = album;
    els.revealCover.textContent = '';
    els.revealCover.appendChild(cover(album.largeImageUrl || album.imageUrl, 'reveal__image'));
    var rays = els.revealAlbum.querySelector('.gold-rays');
    if (rays) {
      rays.remove();
    }
    els.views.reveal.classList.toggle('reveal--gold', album.tier === 'gold');
    if (album.tier === 'gold') {
      decorateGold(els.revealCover);
      goldRays(els.revealAlbum, 'gold-rays--reveal');
    }
    els.revealTitle.textContent = album.name;
    els.revealArtist.textContent = album.artistName;
    els.revealAlbum.href = spotifyAppUrl(album);
    els.revealAlbum.setAttribute('aria-label', album.name + ' by ' + album.artistName + ', open in Spotify');
    els.revealCover.dataset.rarity = album.tier;
    els.views.reveal.dataset.rarity = album.tier;
    els.revealDiscogs.href = discogsSearchUrl(album);
    // Nothing else to re-roll to when it's the only album left.
    els.rerollButton.hidden = pool.length < 2;
    els.rerollButton.disabled = false;
    setView('reveal');
    els.revealAlbum.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- cover tear */

  /**
   * Dismissing a suggestion without a verdict tears its cover in two
   * (tear.js); `then` runs once the halves are gone.
   */
  function tearCover(then) {
    if (tearing) {
      return;
    }
    tearing = true;
    setRevealControlsDisabled(true);
    MusicHub.tear.apart(els.revealCover, { audioContext: audioContext }).then(function () {
      tearing = false;
      setRevealControlsDisabled(false);
      then();
    });
  }

  function setRevealControlsDisabled(on) {
    els.rerollButton.disabled = on;
    els.revealClose.disabled = on;
    els.revealListened.disabled = on;
  }

  /** Back to the start without a verdict; the album stays in the pool. */
  function closeReveal() {
    current = null;
    showRestingState(false);
    els.openButton.focus();
  }

  /* ------------------------------------------------------ mark listened */

  function openListenedDialog() {
    if (!current) {
      return;
    }
    els.dialogText.textContent = 'This removes ' + current.name + ' by ' + current.artistName
      + ' from your Saved Albums on Spotify.';
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
    MusicHub.notice.flash(els.dialogError, message);
  }

  function confirmListened() {
    // The rating input reads '' for anything the browser can't parse as a number.
    var rating = parseRating(els.rating.validity.badInput ? 'x' : els.rating.value);
    if (rating === undefined) {
      showDialogError('A rating is a whole number from 1 to 100.');
      els.rating.focus();
      return;
    }

    var album = current;
    els.dialogError.hidden = true;
    setRemoving(true);
    unsaveAlbum(album)
      .then(function () {
        setRemoving(false);
        // Re-ranked, so the tiers keep their shares of what's left.
        pool = assignTiers(pool.filter(function (entry) {
          return entry.id !== album.id;
        }));
        saveLibraryCache(pool);
        preloadLabelCovers();
        // Off Spotify either way; the history just doesn't get it twice.
        var already = history.some(function (entry) {
          return entry.spotifyAlbumId === album.id;
        });
        if (already) {
          showHistoryNotice(album.name + ' is already in your album history, so it wasn\u2019t added again.');
        } else {
          history.push({
            spotifyAlbumId: album.id,
            albumName: album.name,
            artistName: album.artistName,
            imageUrl: album.imageUrl,
            spotifyUrl: album.spotifyUrl,
            listenedAt: new Date().toISOString(),
            rating: rating,
            // The tier it was picked with - its colour in the history.
            rarity: album.tier,
          });
          saveHistory();
          renderHistory();
        }
        current = null;
        els.dialog.close();
        showRestingState(true);
        // The listening bonus: the tier's coins once more - only for an
        // album that actually joined the history.
        if (!already) {
          earnCoins(album.tier, els.openButton);
        }
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

  /** Lower case, without accents, so "Björk" is found by "bjork". */
  function searchable(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function matchesQuery(entry, query) {
    return !query
      || searchable(entry.albumName).indexOf(query) !== -1
      || searchable(entry.artistName).indexOf(query) !== -1;
  }

  function albumsLabel(count) {
    return count + (count === 1 ? ' album' : ' albums');
  }

  function showHistoryNotice(message) {
    MusicHub.notice.flash(els.historyNotice, message);
  }

  function removeFromHistory(entry) {
    MusicHub.confirmDialog.open({
      title: 'Remove from album history?',
      text: entry.albumName + ' by ' + entry.artistName + ' is removed from your album history, '
        + 'with its rating. Your Spotify library isn’t changed.',
      action: 'Remove',
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      history = history.filter(function (other) {
        return other !== entry;
      });
      saveHistory();
      renderHistory();
    });
  }

  function clearHistory() {
    MusicHub.confirmDialog.open({
      title: 'Clear your album history?',
      text: 'Every album in your album history is removed from this browser, with its rating. '
        + 'Your Spotify library isn’t changed. This cannot be undone.',
      action: 'Clear saved data',
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      history = [];
      saveHistory();
      renderHistory();
    });
  }

  /* ------------------------------------------------ adding an album by hand */

  /**
   * A Spotify album id from what was pasted: an album link
   * (open.spotify.com/album/<id>, also with /intl-de/ or ?si=), a
   * spotify:album:<id> URI, or the bare id. Null when it's none of these.
   */
  function parseAlbumId(raw) {
    var text = String(raw || '').trim();
    var match = text.match(/album[/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])/);
    if (match) {
      return match[1];
    }
    return /^[A-Za-z0-9]{22}$/.test(text) ? text : null;
  }

  var addingAlbum = false;

  function openAddDialog() {
    els.addLink.value = '';
    els.addRating.value = '';
    els.addError.hidden = true;
    els.addDialog.showModal();
    els.addLink.focus();
  }

  function setAddingAlbum(on) {
    addingAlbum = on;
    els.addSubmit.disabled = on;
    els.addSubmit.textContent = on ? 'Adding\u2026' : 'Add album';
    els.addCancel.disabled = on;
  }

  function showAddError(message) {
    MusicHub.notice.flash(els.addError, message);
  }

  /**
   * Looks the album up on Spotify and adds it to the history as listened
   * today - without a rarity, as it wasn't picked here, so it's app purple
   * (and pays no coins).
   */
  function addAlbumByLink() {
    var id = parseAlbumId(els.addLink.value);
    if (!id) {
      showAddError(els.addLink.value.trim()
        ? 'That doesn\u2019t look like a Spotify album link.'
        : 'Paste the Spotify link of an album first.');
      return;
    }
    var rating = parseRating(els.addRating.value);
    if (rating === undefined) {
      showAddError('The rating has to be a whole number from 1 to 100.');
      return;
    }
    var known = history.filter(function (entry) {
      return entry.spotifyAlbumId === id;
    })[0];
    if (known) {
      showAddError(known.albumName + ' is already in your album history.');
      return;
    }

    setAddingAlbum(true);
    MusicHub.auth.spotifyFetch('/albums/' + encodeURIComponent(id))
      .then(function (response) {
        if (!response.ok) {
          var err = new Error(response.status === 400 || response.status === 404
            ? 'Spotify has no album for that link.'
            : 'Couldn\u2019t load the album from Spotify (' + response.status + ').'
              + permissionHint(response.status));
          throw err;
        }
        return response.json();
      })
      .then(function (data) {
        var album = toAlbum(data, null);
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
        historyOpen = true;
        renderHistory();
        setAddingAlbum(false);
        els.addDialog.close();
        showHistoryNotice(album.name + ' by ' + album.artistName + ' was added to your album history.');
      })
      .catch(function (err) {
        setAddingAlbum(false);
        showAddError(err.message || 'Couldn\u2019t load the album from Spotify.');
      });
  }

  /* ------------------------------------------------------ editing a rating */

  var ratingTarget = null;

  function openRatingDialog(entry) {
    ratingTarget = entry;
    els.ratingText.textContent = entry.albumName + ' by ' + entry.artistName
      + '. Leave it empty to take the rating away.';
    els.ratingInput.value = typeof entry.rating === 'number' ? String(entry.rating) : '';
    MusicHub.notice.hide(els.ratingError);
    els.ratingDialog.showModal();
    els.ratingInput.focus();
    els.ratingInput.select();
  }

  function saveRating() {
    var rating = parseRating(els.ratingInput.value);
    if (rating === undefined) {
      MusicHub.notice.flash(els.ratingError, 'The rating has to be a whole number from 1 to 100.');
      return;
    }
    // The stored entry itself, so the change lands in the history.
    ratingTarget.rating = rating;
    saveHistory();
    renderHistory();
    els.ratingDialog.close();
  }

  function historyItem(entry) {
    var item = el('li', 'history-item');
    // Entries from before rarities were kept have none, and stay app purple.
    if (TIERS.some(function (tier) { return tier.name === entry.rarity; })) {
      item.dataset.rarity = entry.rarity;
    }

    // The whole entry opens the album in the Spotify app; the remove button
    // sits above this overlay link.
    var link = el('a', 'history-item__link');
    link.href = spotifyAppUrl({ id: entry.spotifyAlbumId });
    link.setAttribute('aria-label', 'Open ' + entry.albumName + ' by ' + entry.artistName + ' in Spotify');
    item.appendChild(link);

    item.appendChild(cover(entry.imageUrl, 'history-item__cover'));
    var text = el('div', 'history-item__text');
    text.appendChild(el('p', 'history-item__title', entry.albumName));
    text.appendChild(el('p', 'history-item__artist', entry.artistName));
    text.appendChild(el('p', 'history-item__date', 'Listened ' + formatDate(entry.listenedAt)));
    item.appendChild(text);

    if (typeof entry.rating === 'number') {
      var rating = el('span', 'history-item__rating', String(entry.rating));
      rating.setAttribute('aria-label', 'Rated ' + entry.rating + ' out of 100');
      item.appendChild(rating);
    }

    // The Gallery's pen, to change (or take away) the rating.
    var editButton = el('button', 'icon-button history-item__edit', '\u270E');
    editButton.type = 'button';
    editButton.setAttribute('aria-label', 'Edit the rating of ' + entry.albumName);
    editButton.title = 'Edit rating';
    editButton.addEventListener('click', function () {
      openRatingDialog(entry);
    });
    item.appendChild(editButton);

    var remove = el('button', 'icon-button history-item__remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove ' + entry.albumName + ' from your album history');
    remove.title = 'Remove from history';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" />'
      + '<line x1="6" y1="6" x2="18" y2="18" /></svg>';
    remove.addEventListener('click', function () {
      removeFromHistory(entry);
    });
    item.appendChild(remove);

    // Feeds the foil sheen the pointer position, as on the concert cards.
    item.addEventListener('pointermove', function (event) {
      var rect = item.getBoundingClientRect();
      item.style.setProperty('--foil-x', ((event.clientX - rect.left) / rect.width * 100) + '%');
      item.style.setProperty('--foil-y', ((event.clientY - rect.top) / rect.height * 100) + '%');
    });
    return item;
  }

  function renderHistory() {
    var query = searchable(historyQuery.trim());
    var shown = sortHistory(history, sort).filter(function (entry) {
      return matchesQuery(entry, query);
    });

    els.historyClear.disabled = !history.length;
    els.historyCount.hidden = !history.length;
    els.historyCount.textContent = query
      ? shown.length + ' of ' + albumsLabel(history.length)
      : albumsLabel(history.length);
    els.historyToggle.hidden = !history.length;
    els.historyHeader.classList.toggle('history-header--toggle', history.length > 0);
    els.historyBody.hidden = !history.length || !historyOpen;
    els.historyToggle.setAttribute('aria-expanded', historyOpen ? 'true' : 'false');
    els.historyToggle.title = historyOpen ? 'Hide album history' : 'Show album history';
    els.historyToggle.setAttribute('aria-label', els.historyToggle.title);
    // Search and sort as soon as there's an album - one is enough to search.
    els.historyToolbar.hidden = !history.length;
    els.historyControls.hidden = !history.length;
    els.historyEmpty.hidden = history.length > 0;
    els.historyNoMatch.hidden = !history.length || shown.length > 0;
    els.historyList.hidden = !shown.length;
    renderSortControls();

    els.historyList.textContent = '';
    shown.forEach(function (entry) {
      els.historyList.appendChild(historyItem(entry));
    });
  }

  function setHistoryQuery(value) {
    historyQuery = value;
    els.historySearch.value = value;
    els.historySearchClear.hidden = !value;
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
    els.libraryFetched = document.getElementById('library-fetched');
    els.libraryRefresh = document.getElementById('library-refresh');
    els.libraryError = document.getElementById('library-error');
    els.libraryRelogin = document.getElementById('library-relogin');
    els.window = document.getElementById('reel-window');
    els.strip = document.getElementById('reel-strip');
    els.blur = document.getElementById('reel-blur-amount');
    els.revealCover = document.getElementById('reveal-cover');
    els.revealTitle = document.getElementById('reveal-title');
    els.revealArtist = document.getElementById('reveal-artist');
    els.revealAlbum = document.getElementById('reveal-album');
    els.revealDiscogs = document.getElementById('reveal-discogs');
    els.rerollButton = document.getElementById('reveal-reroll');
    els.revealClose = document.getElementById('reveal-close');
    els.revealListened = document.getElementById('reveal-listened');
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
    els.historyClear = document.getElementById('history-clear');
    els.historyCount = document.getElementById('history-count');
    els.historyToolbar = document.getElementById('history-toolbar');
    els.historyToggle = document.getElementById('history-toggle');
    els.historyHeader = els.historyToggle.closest('.history-header');
    els.historyBody = document.getElementById('history-body');
    els.historyControls = document.getElementById('history-controls');
    els.historySearch = document.getElementById('history-search');
    els.historySearchClear = document.getElementById('history-search-clear');
    els.historyNoMatch = document.getElementById('history-no-match');
    els.historyNotice = document.getElementById('history-notice');

    document.getElementById('case-retry').addEventListener('click', refreshLibrary);
    els.libraryRefresh.addEventListener('click', refreshLibrary);
    document.getElementById('library-error-dismiss').addEventListener('click', function () {
      els.libraryError.hidden = true;
    });
    els.openButton.addEventListener('click', function () {
      openCase(null);
    });
    // Either way out without a verdict tears the cover up first.
    els.rerollButton.addEventListener('click', function () {
      var excludeId = current ? current.id : null;
      tearCover(function () {
        openCase(excludeId);
      });
    });
    els.revealClose.addEventListener('click', function () {
      tearCover(closeReveal);
    });
    els.revealListened.addEventListener('click', openListenedDialog);
    els.sortGroup.addEventListener('click', onSortClick);
    els.historyClear.addEventListener('click', clearHistory);
    els.addDialog = document.getElementById('add-album-dialog');
    els.addLink = document.getElementById('add-album-link');
    els.addRating = document.getElementById('add-album-rating');
    els.addError = document.getElementById('add-album-error');
    els.addSubmit = document.getElementById('add-album-submit');
    els.addCancel = document.getElementById('add-album-cancel');
    document.getElementById('history-add').addEventListener('click', openAddDialog);
    els.ratingDialog = document.getElementById('rating-dialog');
    els.ratingText = document.getElementById('rating-dialog-text');
    els.ratingInput = document.getElementById('rating-dialog-input');
    els.ratingError = document.getElementById('rating-dialog-error');
    document.getElementById('rating-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveRating();
    });
    document.getElementById('rating-cancel').addEventListener('click', function () {
      els.ratingDialog.close();
    });
    document.getElementById('add-album-form').addEventListener('submit', function (event) {
      event.preventDefault();
      if (!addingAlbum) {
        addAlbumByLink();
      }
    });
    els.addCancel.addEventListener('click', function () {
      els.addDialog.close();
    });
    // No closing it with Escape halfway through the request.
    els.addDialog.addEventListener('cancel', function (event) {
      if (addingAlbum) {
        event.preventDefault();
      }
    });
    // The whole header row toggles; the chevron button inside it is the
    // keyboard and screen-reader control, and its clicks land here too.
    els.historyHeader.addEventListener('click', function (event) {
      // Adding and clearing are buttons of their own in the same row.
      if (els.historyToggle.hidden || event.target.closest('.history-actions')) {
        return;
      }
      historyOpen = !historyOpen;
      renderHistory();
    });
    els.historySearch.addEventListener('input', function () {
      setHistoryQuery(els.historySearch.value);
      renderHistory();
    });
    els.historySearchClear.addEventListener('click', function () {
      setHistoryQuery('');
      renderHistory();
      els.historySearch.focus();
    });
    document.getElementById('history-notice-dismiss').addEventListener('click', function () {
      els.historyNotice.hidden = true;
    });

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

    // Never fetched on its own - the albums from last time, if any.
    var cached = loadLibraryCache();
    fetchedAt = cached ? cached.fetchedAt : null;
    usePool(cached ? cached.albums : []);
  });

  // Exposed for tests.
  MusicHub.albumSuggester = {
    sortHistory: sortHistory,
    parseRating: parseRating,
    parseAlbumId: parseAlbumId,
    discogsSearchUrl: discogsSearchUrl,
    buildReelAlbums: buildReelAlbums,
  };
})(window.MusicHub);
