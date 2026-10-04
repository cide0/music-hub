/*
 * The coin wallet, on every page: the balance in the navbar, the Store's
 * bought items, the unboxed vinyls and the Daily Spin's winnings, all under
 * one `store` key in localStorage (see public/js/storage.js).
 *
 * Coins earned anywhere go through earn(): they burst out of where they
 * were won, fly up to the navbar's balance and count it up as each one
 * lands, each with a clink - the more coins, the more fly.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // Must stay in sync with the inline scripts in views/partials/head.ejs
  // (the equipped styles) and navbar.ejs (the balance).
  var STORE_KEY = 'store';

  var FLY_MS = 1050;
  var FLY_STAGGER_MS = 55;
  // However many coins, they all set off within this long, so a big win's
  // shower comes thicker rather than taking longer.
  var MAX_LAUNCH_MS = 1800;
  var MAX_FLYING_COINS = 90;
  // A shower asked for in so many coins (earn's `options.coins`, e.g. the
  // Daily Spin's big wins) may be bigger - but never more than this.
  var MAX_SHOWER_COINS = 240;
  // At most this many clinks per shower; with more coins, not every one
  // clinks - the ear can't count them anyway, and each is dozens of nodes.
  var MAX_CLINKS = 30;
  // Clinks closer together than this are spaced out to it: on top of each
  // other they'd only sound like one coin stuttering.
  var MIN_CLINK_GAP_MS = 25;
  // How much of a coin's flight is the burst out of where it was won.
  var BURST_SHARE = 0.28;
  var COUNT_DOWN_MS = 600;

  var storage = MusicHub.storage;
  // The number the navbar shows, and the coins still in the air: the
  // balance shows what's stored minus those until they land.
  var shown = null;
  var inFlight = 0;
  var countDown = null;

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function format(coins) {
    return Math.max(0, Math.round(coins)).toLocaleString('en-US');
  }

  /* ------------------------------------------------------------- state */

  /*
   * The Daily Spin (daily-wheel.js): the local day of the last free spin,
   * respins kept for later, mystery vinyls won but not unboxed yet, wheel
   * exclusives won but not pressed onto an album yet, and the prize of a
   * spin still turning - stored the moment it's spun, so a reload mid-spin
   * loses nothing.
   */
  function loadWheel(stored) {
    var wheel = stored && typeof stored === 'object' ? stored : {};
    return {
      lastSpin: typeof wheel.lastSpin === 'string' ? wheel.lastSpin : null,
      respins: Math.max(0, Math.floor(Number(wheel.respins) || 0)),
      freeVinyls: Math.max(0, Math.floor(Number(wheel.freeVinyls) || 0)),
      exclusives: Array.isArray(wheel.exclusives) ? wheel.exclusives.filter(function (vinyl) {
        return vinyl && typeof vinyl.format === 'string';
      }) : [],
      unclaimed: wheel.unclaimed && typeof wheel.unclaimed.id === 'string' ? wheel.unclaimed : null,
    };
  }

  function load() {
    var stored = storage.read(STORE_KEY, null) || {};
    return {
      credits: Math.max(0, Math.floor(Number(stored.credits) || 0)),
      owned: Array.isArray(stored.owned) ? stored.owned.filter(function (id) {
        return typeof id === 'string';
      }) : [],
      equipped: stored.equipped && typeof stored.equipped === 'object' ? stored.equipped : {},
      vinyls: Array.isArray(stored.vinyls) ? stored.vinyls.filter(function (vinyl) {
        return vinyl && typeof vinyl.format === 'string';
      }) : [],
      wheel: loadWheel(stored.wheel),
      // What has paid out its coins once and never will again (earnOnce),
      // e.g. "concert:<id>" - kept here, not with what it was for, so
      // clearing that data doesn't make it pay again.
      rewarded: Array.isArray(stored.rewarded) ? stored.rewarded.filter(function (key) {
        return typeof key === 'string';
      }) : [],
    };
  }

  // Every change re-reads the stored state first, so another tab's
  // purchase isn't overwritten.
  function update(change) {
    var state = load();
    var result = change(state);
    if (result !== false) {
      storage.write(STORE_KEY, state);
      document.dispatchEvent(new CustomEvent('musichub:walletchange', { detail: { state: state } }));
    }
    return result !== false;
  }

  function balance() {
    return load().credits;
  }

  function owns(id) {
    return load().owned.indexOf(id) !== -1;
  }

  function equipped(slot) {
    var id = load().equipped[slot];
    return id && owns(slot + ':' + id) ? id : null;
  }

  /** Spends `price` coins on `id` ("username:rainbow", "navbar:gold"). False when short. */
  function buy(id, price) {
    var bought = update(function (state) {
      if (state.owned.indexOf(id) !== -1 || state.credits < price) {
        return false;
      }
      state.credits -= price;
      state.owned.push(id);
      return true;
    });
    if (bought) {
      animateCountDown();
    }
    return bought;
  }

  /** Wears an owned item in `slot`, or takes it off with null. */
  function equip(slot, id) {
    update(function (state) {
      if (id && state.owned.indexOf(slot + ':' + id) === -1) {
        return false;
      }
      if (id) {
        state.equipped[slot] = id;
      } else {
        delete state.equipped[slot];
      }
      return true;
    });
    applyStyles();
  }

  function vinyls() {
    return load().vinyls;
  }

  /**
   * Pays `price` for `vinyl` and puts it in the collection - or, with
   * `options.free`, one of the mystery vinyls won on the Daily Spin
   * instead. False when short.
   */
  function unboxVinyl(vinyl, price, options) {
    var free = !!(options && options.free);
    var paid = update(function (state) {
      if (free ? state.wheel.freeVinyls < 1 : state.credits < price) {
        return false;
      }
      if (free) {
        state.wheel.freeVinyls -= 1;
      } else {
        state.credits -= price;
      }
      state.vinyls.push(vinyl);
      return true;
    });
    if (paid && !free) {
      animateCountDown();
    }
    return paid;
  }

  /**
   * Pays `price` for one more Daily Spin, kept with the wheel's respins
   * until it's spun. False when short.
   */
  function buySpin(price) {
    var paid = update(function (state) {
      if (state.credits < price) {
        return false;
      }
      state.credits -= price;
      state.wheel.respins += 1;
      return true;
    });
    if (paid) {
      animateCountDown();
    }
    return paid;
  }

  /** The Daily Spin's state (see loadWheel). */
  function wheel() {
    return load().wheel;
  }

  /**
   * Changes the Daily Spin's state: `change(wheel, state)` edits it (and the
   * rest of the wallet, e.g. its vinyls) in place; returning false leaves
   * everything as it was. True when it was saved.
   */
  function updateWheel(change) {
    return update(function (state) {
      return change(state.wheel, state);
    });
  }

  /**
   * Takes `vinyl` out of the collection - the one unboxed with that format
   * at that time - so the Store's Mystery Vinyl can unbox its style again.
   * No coins come back. False when it wasn't in the collection.
   */
  function removeVinyl(vinyl) {
    return update(function (state) {
      var index = state.vinyls.findIndex(function (owned) {
        return owned.format === vinyl.format && owned.unboxedAt === vinyl.unboxedAt;
      });
      if (index === -1) {
        return false;
      }
      state.vinyls.splice(index, 1);
      return true;
    });
  }

  // Each Store slot's equipped style goes on <html> as this attribute.
  // Must stay in sync with the inline script in views/partials/head.ejs.
  var STYLE_ATTRIBUTES = { username: 'data-name-style', navbar: 'data-navbar-style', player: 'data-player-style' };

  /** The equipped styles on <html>, where the navbar's CSS picks them up. */
  function applyStyles() {
    Object.keys(STYLE_ATTRIBUTES).forEach(function (slot) {
      var style = equipped(slot);
      if (style) {
        document.documentElement.setAttribute(STYLE_ATTRIBUTES[slot], style);
      } else {
        document.documentElement.removeAttribute(STYLE_ATTRIBUTES[slot]);
      }
    });
  }

  /* ----------------------------------------------------------- balance */

  function setShown(coins) {
    shown = coins;
    Array.prototype.forEach.call(document.querySelectorAll('[data-coin-balance]'), function (node) {
      node.textContent = format(coins);
    });
  }

  /** A little hop of the balance as a coin lands in it. */
  function bump() {
    if (reducedMotion()) {
      return;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.coin-balance'), function (node) {
      if (node.animate) {
        // A hop at a time: a shower lands faster than one hop takes, so it
        // hops on and on while they pour in rather than piling hops up.
        if (node.coinHop && node.coinHop.playState === 'running') {
          return;
        }
        node.coinHop = node.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
          { duration: 220, easing: 'ease-out' },
        );
      }
    });
  }

  /** Spending counts the balance down to what's left. */
  function animateCountDown() {
    window.cancelAnimationFrame(countDown);
    var from = shown === null ? balance() : shown;
    // Read afresh every frame: coins still landing move the target.
    function settled() {
      return Math.max(0, balance() - inFlight);
    }
    if (reducedMotion() || from <= settled()) {
      setShown(settled());
      return;
    }
    var start = null;
    function frame(now) {
      start = start === null ? now : start;
      var t = Math.min(1, (now - start) / COUNT_DOWN_MS);
      var to = settled();
      setShown(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) {
        countDown = window.requestAnimationFrame(frame);
      }
    }
    countDown = window.requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- sound */

  /*
   * Synthesised like the Album Suggester's reel, rather than a bundled
   * file: every coin gets its own clink as it lands, each at its own
   * pitch, like coins dropping onto a pile.
   */
  var audio = null;
  var audioOut = null;

  // Settings' "Sound effects" switch: on unless turned off.
  var SOUND_SETTING = 'soundEffects';

  /** Whether the app plays its sound effects at all. */
  function soundOn() {
    return MusicHub.storage.getSetting(SOUND_SETTING, true) !== false;
  }

  /** The app's audio context - null without Web Audio or with sound off. */
  function audioContext() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx || !soundOn()) {
      return null;
    }
    if (!audio) {
      audio = new AudioCtx();
      // A limiter, so a shower of clinks landing together never clips.
      audioOut = audio.createDynamicsCompressor();
      audioOut.threshold.value = -6;
      audioOut.ratio.value = 12;
      audioOut.attack.value = 0.001;
      audioOut.release.value = 0.05;
      audioOut.connect(audio.destination);
    }
    if (audio.state === 'suspended') {
      audio.resume();
    }
    return audio;
  }

  function output() {
    return audioOut;
  }

  /*
   * Coins get their own bus, only the harshest top trimmed: metal needs
   * its brightness and its ring to sound like metal at all.
   */
  var coinBus = null;

  function coinOutput(ctx) {
    if (!coinBus) {
      coinBus = ctx.createGain();
      var trim = ctx.createBiquadFilter();
      trim.type = 'lowpass';
      trim.frequency.value = 11000;
      coinBus.connect(trim).connect(output());
    }
    return coinBus;
  }

  /** A sine that strikes and rings out into `out`: one mode of a ringing coin. */
  function ring(ctx, out, at, frequency, peak, decay) {
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  var noise = null;

  /** The strike itself: a few milliseconds of hard, bright contact. */
  function tick(ctx, out, at, peak) {
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      var data = noise.getChannelData(0);
      for (var i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    var source = ctx.createBufferSource();
    source.buffer = noise;
    var filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3500;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.006);
    source.connect(filter).connect(gain).connect(out);
    source.start(at, Math.random() * 0.09);
    source.stop(at + 0.01);
  }

  /*
   * A coin rings the way a thin metal disc does: its modes sit at these
   * uneven multiples of the lowest, and each one is really two tones a
   * hair apart (a coin is never perfectly round), which beat against each
   * other - the shimmer that makes it sound like metal. Each row:
   * [ratio, level, seconds to die away].
   */
  var COIN_MODES = [
    [1, 0.05, 0.55],
    [1.73, 0.035, 0.4],
    [2.33, 0.03, 0.32],
    [3.91, 0.018, 0.2],
    [4.11, 0.016, 0.18],
  ];

  /** One coin struck once: `base` is its lowest mode, `loud` 0-1. */
  function strike(ctx, out, at, base, loud) {
    tick(ctx, out, at, 0.22 * loud);
    COIN_MODES.forEach(function (mode) {
      var frequency = base * mode[0];
      // The pair a few hertz apart, beating slightly differently every coin.
      var split = 1 + 0.003 + Math.random() * 0.005;
      ring(ctx, out, at, frequency, mode[1] * loud, mode[2]);
      ring(ctx, out, at, frequency * split, mode[1] * 0.8 * loud, mode[2] * 0.9);
    });
  }

  /**
   * One coin dropping onto the pile: it strikes, bounces once or twice
   * - quicker and quieter each time, ringing at its own pitch - and
   * knocks a neighbour, which rings at another.
   */
  function dropCoin(ctx, out, at, loud) {
    var base = 2450 + Math.random() * 950;
    strike(ctx, out, at, base, loud);
    var gap = 0.07 + Math.random() * 0.04;
    strike(ctx, out, at + gap, base, 0.45 * loud);
    if (Math.random() < 0.7) {
      strike(ctx, out, at + gap * 1.6, base, 0.2 * loud);
    }
    if (Math.random() < 0.5) {
      strike(ctx, out, at + 0.02 + Math.random() * 0.06, 2350 + Math.random() * 1250, 0.3 * loud);
    }
  }

  /*
   * A clink is some forty oscillators: a shower's worth of them, live, was
   * more than the audio thread could keep up with, and it stuttered. So a
   * handful are rendered once, off the page, and each landing plays one
   * back - a single node - a touch faster or slower for a pitch of its own.
   */
  var CLINK_VARIANTS = 10;
  // Long enough for the last bounce to ring out.
  var CLINK_SECONDS = 0.8;
  var clinkBank = null;
  var clinkBuffers = null;
  var lastVariant = -1;

  /** Renders the clinks, once; resolves to them (null without offline rendering). */
  function renderClinks(ctx) {
    if (!clinkBank) {
      var Offline = window.OfflineAudioContext;
      var renders = [];
      for (var i = 0; Offline && i < CLINK_VARIANTS; i += 1) {
        var offline = new Offline(1, Math.ceil(ctx.sampleRate * CLINK_SECONDS), ctx.sampleRate);
        dropCoin(offline, offline.destination, 0, 1);
        renders.push(offline.startRendering());
      }
      clinkBank = Promise.all(renders)
        .then(function (buffers) {
          clinkBuffers = buffers.length ? buffers : null;
          return clinkBuffers;
        })
        .catch(function () {
          return null;
        });
    }
    return clinkBank;
  }

  /** One coin landing at `at` on the audio clock, `loud` 0-1: a rendered clink, or live without them. */
  function playClink(ctx, at, loud) {
    if (!clinkBuffers) {
      dropCoin(ctx, coinOutput(ctx), at, loud);
      return;
    }
    // Never the same one twice running.
    var variant = Math.floor(Math.random() * (clinkBuffers.length - 1));
    variant = variant >= lastVariant ? variant + 1 : variant;
    lastVariant = variant;
    var source = ctx.createBufferSource();
    source.buffer = clinkBuffers[variant];
    source.playbackRate.value = 0.95 + Math.random() * 0.1;
    var gain = ctx.createGain();
    gain.gain.value = loud;
    source.connect(gain).connect(coinOutput(ctx));
    source.start(at);
  }

  function clink(level, delay) {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    playClink(ctx, ctx.currentTime + (delay || 0), level === undefined ? 1 : level);
    renderClinks(ctx);
  }

  /** The audio clock's time for `time` on the page's clock (performance.now()), heard then. */
  function audioTimeAt(ctx, time) {
    var stamp = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    var at = stamp && stamp.performanceTime
      ? stamp.contextTime + (time - stamp.performanceTime) / 1000
      : ctx.currentTime + (time - performance.now()) / 1000;
    return Math.max(ctx.currentTime, at);
  }

  /**
   * A shower's clinks, set on the audio clock for the moment each coin
   * lands - not struck when a frame gets round to landing it, which a
   * busy frame held back and bunched up. `clinks` of them, spread evenly
   * over `landings` (page-clock times), none right on top of another.
   */
  function clinkLandings(landings, clinks, loud) {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var times = landings.slice().sort(function (a, b) {
      return a - b;
    });
    var picked = [];
    times.forEach(function (time, index) {
      var due = Math.floor((index + 1) * clinks / times.length) > Math.floor(index * clinks / times.length);
      if (due) {
        picked.push(picked.length ? Math.max(time, picked[picked.length - 1] + MIN_CLINK_GAP_MS) : time);
      }
    });
    // The first coin lands a second out: plenty of time to render the clinks.
    renderClinks(ctx).then(function () {
      picked.forEach(function (time) {
        playClink(ctx, audioTimeAt(ctx, time), loud);
      });
    });
  }

  /** Coins spilling out where they were won: a quick, soft jingle. */
  function spill(count) {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var taps = Math.min(6, 2 + Math.floor(count / 4));
    for (var i = 0; i < taps; i += 1) {
      var at = ctx.currentTime + i * 0.035 + Math.random() * 0.02;
      strike(ctx, coinOutput(ctx), at, 2350 + Math.random() * 1250, 0.3 + Math.random() * 0.15);
    }
  }

  /* ------------------------------------------------------ coin shower */

  /** An icon from the navbar's sprite (views/partials/navbar.ejs), by its id. */
  function spriteSvg(id, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function coinSvg(className) {
    return spriteSvg('coin-icon', className);
  }

  /** The check mark, for anything done or picked - in the text's color. */
  function checkSvg(className) {
    return spriteSvg('check-icon', className ? 'check-icon ' + className : 'check-icon');
  }

  /** The balance's coin coins fly to: whichever balance is on screen. */
  function target() {
    var candidates = document.querySelectorAll('[data-coin-target]');
    for (var i = 0; i < candidates.length; i += 1) {
      var rect = candidates[i].getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return candidates[i];
      }
    }
    return null;
  }

  // The balance lifted over an open modal: { node, users }.
  var lifted = null;

  /**
   * Under an open modal (the Daily Spin) the navbar's balance sits beneath
   * the backdrop, so a copy of it goes in `layer` right over the real one:
   * the coins are seen landing and counting up. Shared by showers in the
   * air at once; returns the function that lets it go again.
   */
  function liftBalance(layer, coinTarget) {
    var chip = coinTarget.closest('.coin-balance');
    if (!chip) {
      return function () {};
    }
    if (!lifted) {
      var rect = chip.getBoundingClientRect();
      var node = chip.cloneNode(true);
      node.removeAttribute('href');
      node.removeAttribute('title');
      node.setAttribute('aria-hidden', 'true');
      node.querySelector('[data-coin-target]').removeAttribute('data-coin-target');
      node.classList.add('coin-balance--lifted');
      node.style.left = rect.left + 'px';
      node.style.top = rect.top + 'px';
      node.style.width = rect.width + 'px';
      node.style.height = rect.height + 'px';
      node.style.setProperty('--lifted-coin', coinTarget.getBoundingClientRect().width + 'px');
      layer.appendChild(node);
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
      lifted = { node: node, users: 0 };
    }
    var mine = lifted;
    mine.users += 1;
    return function () {
      mine.users -= 1;
      if (mine.users > 0) {
        return;
      }
      if (lifted === mine) {
        lifted = null;
      }
      mine.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: 500, easing: 'ease-in', fill: 'forwards' })
        .onfinish = mine.node.remove.bind(mine.node);
    };
  }

  function centreOf(from) {
    if (from && typeof from.getBoundingClientRect === 'function') {
      var rect = from.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    if (from && typeof from.x === 'number') {
      return from;
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  /**
   * How many coins fly for `amount`: each rarity clearly more than the one
   * below - 50 -> 10, 100 -> 16, 250 -> 31, 500 -> 50, 1,000 -> 81.
   */
  function flyingCount(amount) {
    return Math.max(3, Math.min(MAX_FLYING_COINS, Math.round(10 * Math.pow(Math.max(1, amount) / 50, 0.7))));
  }

  /** "+50" rising out of where the coins came from. */
  function floatLabel(amount, at, layer) {
    var label = document.createElement('div');
    label.className = 'coin-float';
    label.appendChild(coinSvg('coin'));
    label.appendChild(document.createTextNode('+' + format(amount)));
    label.style.left = at.x + 'px';
    label.style.top = at.y + 'px';
    (layer || document.body).appendChild(label);
    var animation = label.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -30%) scale(0.6)' },
        { opacity: 1, transform: 'translate(-50%, -90%) scale(1.1)', offset: 0.2 },
        { opacity: 1, transform: 'translate(-50%, -130%) scale(1)', offset: 0.7 },
        { opacity: 0, transform: 'translate(-50%, -170%) scale(1)' },
      ],
      { duration: 1600, easing: 'ease-out' },
    );
    animation.onfinish = function () {
      label.remove();
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * How wide a spinning coin shows, `turns` half-turns into its spin: full
   * face on, a sliver edge on.
   */
  function flipWidth(turns) {
    return 0.12 + 0.88 * Math.abs(Math.cos(Math.PI * turns));
  }

  // Palette colours as a canvas takes them: "var(--coin-bright)",
  // "color-mix(...)" and the like, worked out once to rgb().
  var paints = {};

  function paint(color) {
    if (!paints[color]) {
      var probe = document.createElement('span');
      probe.style.color = color;
      document.body.appendChild(probe);
      paints[color] = getComputedStyle(probe).color;
      probe.remove();
    }
    return paints[color];
  }

  /*
   * The coin for showers drawn on a canvas: #coin-icon - its gold rim and
   * face, the quaver pressed into it - with its soft glow round it, drawn
   * once, big enough to stay sharp scaled up. COIN_SIZE across (the coin),
   * COIN_SPRITE_SIZE with the glow.
   */
  var COIN_SIZE = 26;
  var COIN_SPRITE_SIZE = 42;
  var COIN_SPRITE_SCALE = 3;
  var QUAVER_FLAG = 'M12.6 6.3c.25 1.7 1.45 2.5 2.5 3.4 1.05.95 1.6 2.1 1.1 3.8-.15-1.35-.8-2.1-1.6-2.7-.65-.5-1.4-.8-2-1.1z';
  var sprite = null;

  function coinSprite() {
    if (sprite) {
      return sprite;
    }
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = COIN_SPRITE_SIZE * COIN_SPRITE_SCALE;
    var ctx = sprite.getContext('2d');
    var centre = sprite.width / 2;
    // The glow: as the flying coins' always was, out to 7px past the rim.
    var glow = ctx.createRadialGradient(centre, centre, 0, centre, centre, (COIN_SIZE / 2 + 7) * COIN_SPRITE_SCALE);
    glow.addColorStop(0.35, paint('color-mix(in srgb, var(--coin-bright) 60%, transparent)'));
    glow.addColorStop(0.55, paint('color-mix(in srgb, var(--coin-bright) 22%, transparent)'));
    glow.addColorStop(0.7, paint('transparent'));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, sprite.width, sprite.height);

    // The coin itself, in #coin-icon's 24-unit box.
    var unit = COIN_SIZE / 24 * COIN_SPRITE_SCALE;
    ctx.setTransform(unit, 0, 0, unit, centre - 12 * unit, centre - 12 * unit);
    function gradient(x1, y1, x2, y2, stops) {
      var fill = ctx.createLinearGradient(x1, y1, x2, y2);
      stops.forEach(function (stop) {
        fill.addColorStop(stop[0], paint(stop[1]));
      });
      return fill;
    }
    // The rim: #coin-rim-gradient across the circle's box, corner to corner.
    ctx.beginPath();
    ctx.arc(12, 12, 11.2, 0, Math.PI * 2);
    ctx.fillStyle = gradient(0.8, 0.8, 23.2, 23.2, [[0, 'var(--coin-bright)'], [0.5, 'var(--coin-face)'], [1, 'var(--coin-rim)']]);
    ctx.fill();
    // The face: #coin-face-gradient, ringed in the rim's colour.
    ctx.beginPath();
    ctx.arc(12, 12, 8.7, 0, Math.PI * 2);
    ctx.fillStyle = gradient(3.3 + 0.2 * 17.4, 3.3, 3.3 + 0.8 * 17.4, 20.7, [[0, 'var(--coin-shine)'], [0.45, 'var(--coin-bright)'], [1, 'var(--coin-face)']]);
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = paint('var(--coin-rim)');
    ctx.stroke();
    // The quaver.
    ctx.fillStyle = paint('var(--coin-rim)');
    ctx.beginPath();
    ctx.ellipse(10.1, 15.7, 2.55, 1.95, -22 * Math.PI / 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(11.95, 6.3, 1.35, 9.6, 0.5);
    } else {
      ctx.rect(11.95, 6.3, 1.35, 9.6);
    }
    ctx.fill();
    ctx.fill(new Path2D(QUAVER_FLAG));
    return sprite;
  }

  /**
   * Draws the coin sprite centred on `x`, `y` (page pixels) on `ctx`,
   * `scale` times its size, flipped to `width` of its face.
   */
  function drawCoin(ctx, ratio, x, y, scale, width) {
    ctx.setTransform(ratio * scale * width, 0, 0, ratio * scale, x * ratio, y * ratio);
    ctx.drawImage(coinSprite(), -COIN_SPRITE_SIZE / 2, -COIN_SPRITE_SIZE / 2, COIN_SPRITE_SIZE, COIN_SPRITE_SIZE);
  }

  /*
   * Coins in the air, drawn on a canvas over the page - or in earn's
   * `layer` - rather than an element each: a big shower was hundreds of
   * layers for the graphics card to put together every frame. One canvas
   * for each place they fly in, there only while coins are.
   */
  var skies = [];

  function skyIn(parent) {
    var sky = skies.filter(function (each) {
      return each.parent === parent;
    })[0];
    if (!sky) {
      var canvas = document.createElement('canvas');
      canvas.className = 'coin-shower';
      sky = { parent: parent, canvas: canvas, ctx: canvas.getContext('2d'), coins: [], frame: 0, ratio: 1 };
      skies.push(sky);
    }
    if (!sky.canvas.isConnected) {
      parent.appendChild(sky.canvas);
    }
    sky.ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.round(window.innerWidth * sky.ratio);
    var height = Math.round(window.innerHeight * sky.ratio);
    if (sky.canvas.width !== width || sky.canvas.height !== height) {
      sky.canvas.width = width;
      sky.canvas.height = height;
    }
    return sky;
  }

  /** Where a coin is `t` of the way through its flight (0-1), and how big. */
  function coinAt(coin, t) {
    if (t <= BURST_SHARE) {
      var u = 1 - Math.pow(1 - t / BURST_SHARE, 2);
      return { x: lerp(coin.from.x, coin.burst.x, u), y: lerp(coin.from.y, coin.burst.y, u), scale: lerp(0.3, 1.15, u) };
    }
    // Ease in: it lingers at the top of the burst, then gets pulled in.
    var v = Math.pow((t - BURST_SHARE) / (1 - BURST_SHARE), 1.7);
    var a = (1 - v) * (1 - v);
    var b = 2 * (1 - v) * v;
    var c = v * v;
    return {
      x: a * coin.burst.x + b * coin.control.x + c * coin.to.x,
      y: a * coin.burst.y + b * coin.control.y + c * coin.to.y,
      scale: lerp(1.15, 0.6, v),
    };
  }

  /** One frame of a sky's coins - landing any that have got there - and the next, while any fly. */
  function drawCoins(sky, now) {
    var ctx = sky.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sky.canvas.width, sky.canvas.height);
    var landing = [];
    sky.coins = sky.coins.filter(function (coin) {
      var elapsed = now - coin.start;
      if (elapsed >= coin.duration) {
        landing.push(coin);
        return false;
      }
      if (elapsed < 0) {
        return true;
      }
      var t = elapsed / coin.duration;
      var at = coinAt(coin, t);
      ctx.globalAlpha = t < 1 / 16 ? t * 16 : t > 0.97 ? 0.4 : 1;
      drawCoin(ctx, sky.ratio, at.x, at.y, at.scale, flipWidth(t * coin.flips));
      return true;
    });
    ctx.globalAlpha = 1;
    landing.forEach(function (coin) {
      coin.landed();
    });
    if (sky.coins.length) {
      sky.frame = window.requestAnimationFrame(function (time) {
        drawCoins(sky, time);
      });
      return;
    }
    sky.frame = 0;
    sky.canvas.remove();
  }

  /**
   * One coin's flight: a burst out to a random spot around where it was
   * won, then a curve up to the balance, speeding up as it goes, flipping
   * all the way. `showerSize` is how many fly with it. Calls `landed`
   * when it gets there; returns when that will be (performance.now()).
   */
  function flyCoin(sky, from, to, delay, showerSize, landed) {
    // Out and mostly up, like coins spilling from an opened chest.
    var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    // A bigger shower spreads wider, so it doesn't bunch into one clump.
    var reach = (45 + Math.random() * 85) * (1 + Math.min(showerSize, MAX_FLYING_COINS) / 90);
    var burst = { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach };
    // The curve bows away from the straight line, to one side or the other.
    var side = Math.random() < 0.5 ? -1 : 1;
    var duration = FLY_MS + Math.random() * 250;
    var start = performance.now() + delay;
    sky.coins.push({
      from: from,
      burst: burst,
      control: {
        x: lerp(burst.x, to.x, 0.5) + side * (60 + Math.random() * 120),
        y: Math.min(burst.y, to.y) + (lerp(burst.y, to.y, 0.5) - Math.min(burst.y, to.y)) * 0.3,
      },
      to: to,
      start: start,
      duration: duration,
      flips: duration / (280 + Math.random() * 220),
      landed: landed,
    });
    if (!sky.frame) {
      sky.frame = window.requestAnimationFrame(function (time) {
        drawCoins(sky, time);
      });
    }
    return start + duration;
  }

  /**
   * Adds `amount` coins to the balance - stored straight away, so leaving
   * the page mid-flight loses nothing - and shows them flying from
   * `options.from` (an element, or {x, y}; the middle of the screen when
   * left out) up to the navbar - `options.coins` of them, or as many as
   * flyingCount gives the amount. `options.launchMs`: how long they keep
   * setting off, for a shower that runs longer the bigger the win (at most
   * MAX_LAUNCH_MS otherwise). `options.layer`: where they fly instead of
   * the page, e.g. a popover over an open modal - the balance is then
   * lifted up there with them. `options.silent`: no clinks, just the
   * coins. Resolves once the last coin has landed.
   */
  function earn(amount, options) {
    amount = Math.floor(Number(amount) || 0);
    if (amount <= 0) {
      return Promise.resolve();
    }
    update(function (state) {
      state.credits += amount;
      return true;
    });

    var from = centreOf(options && options.from);
    var layer = (options && options.layer) || null;
    var silent = !!(options && options.silent);
    var to = target();

    if (reducedMotion() || !to || !document.body.animate) {
      setShown(Math.max(0, balance() - inFlight));
      bump();
      if (!silent) {
        clink(1);
        clink(0.6, 0.12);
      }
      return Promise.resolve();
    }

    inFlight += amount;
    var allLanded;
    var landing = new Promise(function (resolve) {
      allLanded = resolve;
    });

    floatLabel(amount, from, layer);
    var asked = Math.floor(options && options.coins);
    var count = asked ? Math.min(MAX_SHOWER_COINS, asked) : Math.min(MAX_FLYING_COINS, flyingCount(amount));
    var launchMs = Math.floor(options && options.launchMs);
    var landedCoins = 0;
    var stagger = launchMs ? launchMs / count : Math.min(FLY_STAGGER_MS, MAX_LAUNCH_MS / count);
    // A longer shower clinks on for longer, as thickly.
    var clinks = Math.min(count, Math.round(MAX_CLINKS * Math.max(1, (launchMs || 0) / MAX_LAUNCH_MS)));
    // A little jingle as they burst out.
    if (!silent) {
      spill(count);
    }

    var goal = centreOf(to);
    var letGo = layer ? liftBalance(layer, to) : function () {};
    // After the lifted balance, so the coins fly in over it.
    var sky = skyIn(layer || document.body);
    // Each coin carries an equal share; the last one tops it up to the exact amount.
    var share = Math.floor(amount / count);
    var landings = [];
    for (var i = 0; i < count; i += 1) {
      landings.push(flyCoin(sky, from, goal, i * stagger, count, function () {
        landedCoins += 1;
        inFlight -= landedCoins === count ? amount - share * (count - 1) : share;
        showLanding();
        if (landedCoins === count) {
          letGo();
          allLanded();
        }
      }));
    }
    if (!silent) {
      clinkLandings(landings, clinks, Math.max(0.35, 1 - clinks * 0.025));
    }
    return landing;
  }

  /**
   * earn(), for something that only ever pays out once - `key` names it
   * ("concert:<id>"). Done again, even after its own data is cleared, it
   * pays nothing. Returns earn()'s promise, or null when already paid.
   */
  function earnOnce(key, amount, options) {
    var first = update(function (state) {
      if (state.rewarded.indexOf(key) !== -1) {
        return false;
      }
      state.rewarded.push(key);
      return true;
    });
    return first ? earn(amount, options) : null;
  }

  // A frame's landings shown at once: the count and the hop, once a frame
  // however many coins came in, rather than a layout for every coin.
  var landingFrame = 0;

  function showLanding() {
    if (landingFrame) {
      return;
    }
    landingFrame = window.requestAnimationFrame(function () {
      landingFrame = 0;
      setShown(Math.max(0, balance() - inFlight));
      bump();
    });
  }

  /* -------------------------------------------------------------- init */

  MusicHub.sync.ready(function () {
    setShown(balance());
    applyStyles();
  });

  // Another tab earned or spent something.
  window.addEventListener('storage', function (event) {
    if (event.key === STORE_KEY || event.key === null) {
      setShown(Math.max(0, balance() - inFlight));
      applyStyles();
      document.dispatchEvent(new CustomEvent('musichub:walletchange', { detail: { state: load() } }));
    }
  });

  MusicHub.wallet = {
    balance: balance,
    earn: earn,
    earnOnce: earnOnce,
    owns: owns,
    buy: buy,
    equipped: equipped,
    equip: equip,
    vinyls: vinyls,
    unboxVinyl: unboxVinyl,
    removeVinyl: removeVinyl,
    wheel: wheel,
    updateWheel: updateWheel,
    buySpin: buySpin,
    format: format,
    coinSvg: coinSvg,
    checkSvg: checkSvg,
    flipWidth: flipWidth,
    paint: paint,
    drawCoin: drawCoin,
    // The Store's own sounds share this context and limiter.
    audioContext: audioContext,
    soundOn: soundOn,
    // One coin landing on the pile, as each one of a shower does.
    clink: clink,
    audioOutput: output,
    flyingCount: flyingCount,
  };
})(window.MusicHub);
