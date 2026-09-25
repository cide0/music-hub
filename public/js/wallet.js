/*
 * The coin wallet, on every page: the balance in the navbar, the Store's
 * bought items and the unboxed vinyls, all under one `store` key in
 * localStorage (see public/js/storage.js).
 *
 * Coins earned anywhere go through earn(): they burst out of where they
 * were won, fly up to the navbar's balance and count it up as each one
 * lands, each with a clink - the more coins, the more fly.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // Must stay in sync with the inline scripts in views/partials/head.ejs
  // (the equipped name style) and navbar.ejs (the balance).
  var STORE_KEY = 'store';

  var FLY_MS = 1050;
  var FLY_STAGGER_MS = 55;
  // However many coins, they all set off within this long, so a big win's
  // shower comes thicker rather than taking longer.
  var MAX_LAUNCH_MS = 1800;
  var MAX_FLYING_COINS = 90;
  // At most this many clinks per shower; with more coins, not every one
  // clinks - the ear can't count them anyway, and each is dozens of nodes.
  var MAX_CLINKS = 30;
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

  /** Spends `price` coins on `id` ("username:rainbow"). False when short. */
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
    applyNameStyle();
  }

  function vinyls() {
    return load().vinyls;
  }

  /** Pays `price` for `vinyl` and puts it in the collection. False when short. */
  function unboxVinyl(vinyl, price) {
    var paid = update(function (state) {
      if (state.credits < price) {
        return false;
      }
      state.credits -= price;
      state.vinyls.push(vinyl);
      return true;
    });
    if (paid) {
      animateCountDown();
    }
    return paid;
  }

  /** The equipped name style on <html>, where the navbar's CSS picks it up. */
  function applyNameStyle() {
    var style = equipped('username');
    if (style) {
      document.documentElement.setAttribute('data-name-style', style);
    } else {
      document.documentElement.removeAttribute('data-name-style');
    }
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
        node.animate(
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

  function audioContext() {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
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

  /** A sine that strikes and rings out: one mode of a ringing coin. */
  function ring(ctx, at, frequency, peak, decay) {
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(coinOutput(ctx));
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  var noise = null;

  /** The strike itself: a few milliseconds of hard, bright contact. */
  function tick(ctx, at, peak) {
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
    source.connect(filter).connect(gain).connect(coinOutput(ctx));
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
  function strike(ctx, at, base, loud) {
    tick(ctx, at, 0.22 * loud);
    COIN_MODES.forEach(function (mode) {
      var frequency = base * mode[0];
      // The pair a few hertz apart, beating slightly differently every coin.
      var split = 1 + 0.003 + Math.random() * 0.005;
      ring(ctx, at, frequency, mode[1] * loud, mode[2]);
      ring(ctx, at, frequency * split, mode[1] * 0.8 * loud, mode[2] * 0.9);
    });
  }

  /**
   * One coin dropping onto the pile: it strikes, bounces once or twice
   * - quicker and quieter each time, ringing at its own pitch - and
   * knocks a neighbour, which rings at another.
   */
  function clink(level, delay) {
    var ctx = audioContext();
    if (!ctx) {
      return;
    }
    var at = ctx.currentTime + (delay || 0);
    var loud = level === undefined ? 1 : level;
    var base = 2450 + Math.random() * 950;
    strike(ctx, at, base, loud);
    var gap = 0.07 + Math.random() * 0.04;
    strike(ctx, at + gap, base, 0.45 * loud);
    if (Math.random() < 0.7) {
      strike(ctx, at + gap * 1.6, base, 0.2 * loud);
    }
    if (Math.random() < 0.5) {
      strike(ctx, at + 0.02 + Math.random() * 0.06, 2350 + Math.random() * 1250, 0.3 * loud);
    }
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
      strike(ctx, at, 2350 + Math.random() * 1250, 0.3 + Math.random() * 0.15);
    }
  }

  /* ------------------------------------------------------ coin shower */

  function coinSvg(className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#coin-icon');
    svg.appendChild(use);
    return svg;
  }

  /** The balance's coin coins fly to: whichever balance is on screen. */
  function target() {
    var candidates = document.querySelectorAll('[data-coin-target]');
    for (var i = 0; i < candidates.length; i += 1) {
      var rect = candidates[i].getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return rect;
      }
    }
    return null;
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
  function floatLabel(amount, at) {
    var label = document.createElement('div');
    label.className = 'coin-float';
    label.appendChild(coinSvg('coin'));
    label.appendChild(document.createTextNode('+' + format(amount)));
    label.style.left = at.x + 'px';
    label.style.top = at.y + 'px';
    document.body.appendChild(label);
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
   * One coin's flight: a burst out to a random spot around where it was
   * won, then a curve up to the balance, speeding up as it goes, flipping
   * all the way. `showerSize` is how many fly with it. Calls `landed`
   * when it gets there.
   */
  function flyCoin(from, to, delay, showerSize, landed) {
    var size = 26;
    var coin = document.createElement('div');
    coin.className = 'flying-coin';
    coin.appendChild(coinSvg('flying-coin__face'));
    coin.style.setProperty('--flip-ms', Math.round(280 + Math.random() * 220) + 'ms');
    document.body.appendChild(coin);

    // Out and mostly up, like coins spilling from an opened chest.
    var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    // A bigger shower spreads wider, so it doesn't bunch into one clump.
    var reach = (45 + Math.random() * 85) * (1 + Math.min(showerSize, MAX_FLYING_COINS) / 90);
    var burst = { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach };
    // The curve bows away from the straight line, to one side or the other.
    var side = Math.random() < 0.5 ? -1 : 1;
    var control = {
      x: lerp(burst.x, to.x, 0.5) + side * (60 + Math.random() * 120),
      y: Math.min(burst.y, to.y) + (lerp(burst.y, to.y, 0.5) - Math.min(burst.y, to.y)) * 0.3,
    };

    var frames = [];
    var steps = 16;
    for (var i = 0; i <= steps; i += 1) {
      var t = i / steps;
      var point;
      var scale;
      if (t <= BURST_SHARE) {
        var u = 1 - Math.pow(1 - t / BURST_SHARE, 2);
        point = { x: lerp(from.x, burst.x, u), y: lerp(from.y, burst.y, u) };
        scale = lerp(0.3, 1.15, u);
      } else {
        // Ease in: it lingers at the top of the burst, then gets pulled in.
        var v = Math.pow((t - BURST_SHARE) / (1 - BURST_SHARE), 1.7);
        var a = (1 - v) * (1 - v);
        var b = 2 * (1 - v) * v;
        var c = v * v;
        point = {
          x: a * burst.x + b * control.x + c * to.x,
          y: a * burst.y + b * control.y + c * to.y,
        };
        scale = lerp(1.15, 0.6, v);
      }
      frames.push({
        transform: 'translate(' + (point.x - size / 2).toFixed(1) + 'px, ' + (point.y - size / 2).toFixed(1) + 'px) scale(' + scale.toFixed(3) + ')',
        opacity: t === 0 ? 0 : t > 0.97 ? 0.4 : 1,
        offset: t,
      });
    }

    var animation = coin.animate(frames, {
      duration: FLY_MS + Math.random() * 250,
      delay: delay,
      easing: 'linear',
      fill: 'both',
    });
    animation.onfinish = function () {
      coin.remove();
      landed();
    };
  }

  /**
   * Adds `amount` coins to the balance - stored straight away, so leaving
   * the page mid-flight loses nothing - and shows them flying from
   * `options.from` (an element, or {x, y}; the middle of the screen when
   * left out) up to the navbar.
   */
  function earn(amount, options) {
    amount = Math.floor(Number(amount) || 0);
    if (amount <= 0) {
      return;
    }
    update(function (state) {
      state.credits += amount;
      return true;
    });

    var from = centreOf(options && options.from);
    var to = target();

    if (reducedMotion() || !to || !document.body.animate) {
      setShown(Math.max(0, balance() - inFlight));
      bump();
      clink(1);
      clink(0.6, 0.12);
      return;
    }

    inFlight += amount;

    floatLabel(amount, from);
    var count = flyingCount(amount);
    var landedCoins = 0;
    var stagger = Math.min(FLY_STAGGER_MS, MAX_LAUNCH_MS / count);
    var clinks = Math.min(count, MAX_CLINKS);
    // A little jingle as they burst out.
    spill(count);

    var goal = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
    // Each coin carries an equal share; the last one tops it up to the exact amount.
    var share = Math.floor(amount / count);
    for (var i = 0; i < count; i += 1) {
      flyCoin(from, goal, i * stagger, count, function () {
        landedCoins += 1;
        inFlight -= landedCoins === count ? amount - share * (count - 1) : share;
        setShown(Math.max(0, balance() - inFlight));
        bump();
        // `clinks` of them, spread evenly over the landings.
        if (Math.floor(landedCoins * clinks / count) > Math.floor((landedCoins - 1) * clinks / count)) {
          clink(Math.max(0.35, 1 - clinks * 0.025));
        }
      });
    }
  }

  /* -------------------------------------------------------------- init */

  document.addEventListener('DOMContentLoaded', function () {
    setShown(balance());
    applyNameStyle();
  });

  // Another tab earned or spent something.
  window.addEventListener('storage', function (event) {
    if (event.key === STORE_KEY || event.key === null) {
      setShown(Math.max(0, balance() - inFlight));
      applyNameStyle();
      document.dispatchEvent(new CustomEvent('musichub:walletchange', { detail: { state: load() } }));
    }
  });

  MusicHub.wallet = {
    balance: balance,
    earn: earn,
    owns: owns,
    buy: buy,
    equipped: equipped,
    equip: equip,
    vinyls: vinyls,
    unboxVinyl: unboxVinyl,
    format: format,
    coinSvg: coinSvg,
    // The Store's own sounds share this context and limiter.
    audioContext: audioContext,
    audioOutput: output,
    flyingCount: flyingCount,
  };
})(window.MusicHub);
