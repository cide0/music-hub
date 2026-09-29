/*
 * The Daily Spin, on every page: a wheel of fortune behind the navbar's
 * wheel icon, free once a (local) day, plus any respins won on it - kept
 * for later, as many as the user likes. It pays out coins (flying out of
 * the wheel's middle up to the balance, the wheel staying open for the
 * next spin), a Mystery Vinyl (the Store's own unboxing, free) or one of
 * forty wheel exclusives, records nothing else in the app hands out
 * (vinyl-catalog.js).
 *
 * The prize is decided and stored (wallet.js, `store.wheel.unclaimed`) the
 * moment the wheel is spun; the wheel is then only turned to land on it,
 * and it's handed out once the wheel stops - or on the next page load,
 * should the page be left mid-spin.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var wallet = MusicHub.wallet;
  var sfx = MusicHub.sfx;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /*
   * The wheel's slices, clockwise from the top, each as wide as its chance
   * (`weight`, in percent). Spread out so the big prizes sit between small
   * ones. `tier` sets how big the celebration is. Shades of purple, no
   * two neighbours alike - Nothing black, and the exclusive in polished
   * gold with the app's gold shine sweeping across it and over its name.
   */
  var PRIZES = [
    { id: 'coins-500', kind: 'coins', coins: 500, weight: 25, tier: 'common', fill: 'var(--color-purple-800)' },
    { id: 'coins-7500', kind: 'coins', coins: 7500, weight: 5, tier: 'jackpot', fill: 'var(--color-purple-500)' },
    { id: 'coins-1000', kind: 'coins', coins: 1000, weight: 20, tier: 'common', fill: 'var(--color-purple-700)' },
    { id: 'respins', kind: 'respins', respins: 3, weight: 5, tier: 'rare', fill: 'var(--color-purple-300)', label: ['3 Respins'] },
    { id: 'mystery', kind: 'mystery', weight: 15, tier: 'good', fill: 'var(--color-purple-600)', label: ['Mystery', 'Vinyl'] },
    { id: 'coins-5000', kind: 'coins', coins: 5000, weight: 6, tier: 'epic', fill: 'var(--color-purple-400)' },
    { id: 'nothing', kind: 'nothing', weight: 10, tier: 'none', fill: 'var(--color-black)', label: ['Nothing'] },
    { id: 'exclusive', kind: 'exclusive', weight: 4, tier: 'legendary', fill: 'gold', label: ['Exclusive'] },
    { id: 'coins-2500', kind: 'coins', coins: 2500, weight: 10, tier: 'rare', fill: 'var(--rarity-purple)' },
  ];

  // What a won prize pays instead, when there's nothing left to win: every
  // wheel exclusive already collected, or every Mystery Vinyl record.
  var EXCLUSIVE_FALLBACK_COINS = 10000;
  var MYSTERY_FALLBACK_COINS = 1000;

  // The coins flying up to the balance, by the amount won: [from amount,
  // coins, how long they keep setting off (ms)] - more of them and for
  // longer each step up, the jackpot pouring on and on.
  var COIN_SHOWERS = [
    [0, 30, 900],
    [1000, 55, 1400],
    [2500, 90, 2200],
    [5000, 140, 3400],
    [7500, 220, 6500],
  ];

  // The spin: a little wind-back, then round and round, slowing down.
  var WIND_UP_MS = 380;
  // Winding up to a wheel exclusive, before it bursts. Must match
  // wheel-charge's length in style.css (.wheel--charging .wheel__machine).
  var CHARGE_MS = 3800;
  var WIND_UP_DEGREES = 14;
  var SPIN_MS = 6200;
  var MIN_TURNS = 5;
  // The flapper, knocked by each peg: how hard (degrees per second), the
  // spring pulling it back and how much that's damped, and its furthest swing.
  // Gentle knocks on a soft spring, damped just short of settling at once,
  // and a swing that eases into its furthest rather than stopping dead.
  var FLAP_KICK = 700;
  var FLAP_STIFFNESS = 520;
  var FLAP_DAMPING = 38;
  var FLAP_MAX = 24;
  // How long a win's celebration plays, at least, by tier - the wheel can't
  // be spun again until it's over and every coin has landed (fxSettled).
  var WIN_SHOW_MS = { none: 2600, common: 2300, good: 2400, rare: 3000, epic: 5300, jackpot: 7800 };
  // How long "Big win!" and "Jackpot!" stay up between slamming down and
  // blowing away: through the coins' shower (COIN_SHOWERS), about.
  var BANNER_HOLD_MS = { epic: 4000, jackpot: 6500 };

  var els = {};
  var rotation = 0;
  var spinning = false;
  // The win still playing out (a token per win); no spinning again till it's done.
  var celebration = null;
  // Run once the wheel is closed: off to the Store, from the prizes' Mystery Vinyl card.
  var afterClose = null;
  var statusTimer = null;

  /* ------------------------------------------------------------ helpers */

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

  function svg(tag, attributes, style) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    Object.keys(style || {}).forEach(function (name) {
      node.style[name] = style[name];
    });
    return node;
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function between(min, max) {
    return min + Math.random() * (max - min);
  }

  function mod(value, by) {
    return ((value % by) + by) % by;
  }

  /**
   * Today as "2026-09-27", in the user's own time zone: the free spin
   * comes back at their midnight. Must match the inline script in
   * views/partials/navbar.ejs.
   */
  function localDay(date) {
    var now = date || new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function prizeById(id) {
    return PRIZES.filter(function (prize) {
      return prize.id === id;
    })[0] || null;
  }

  /** The prize, drawn by weight. */
  function roll() {
    var total = PRIZES.reduce(function (sum, prize) {
      return sum + prize.weight;
    }, 0);
    var value = Math.random() * total;
    for (var i = 0; i < PRIZES.length; i += 1) {
      value -= PRIZES[i].weight;
      if (value < 0) {
        return PRIZES[i];
      }
    }
    return PRIZES[PRIZES.length - 1];
  }

  /** Whether a spin can be had now: today's free one, or a saved respin. */
  function spinsLeft(wheel) {
    return {
      free: wheel.lastSpin !== localDay(),
      respins: wheel.respins,
    };
  }

  /** Whether the navbar's wheel should carry its dot. */
  function somethingWaiting(wheel) {
    var left = spinsLeft(wheel);
    return left.free || left.respins > 0 || wheel.freeVinyls > 0 || wheel.exclusives.length > 0 || !!wheel.unclaimed;
  }

  /** The collection and the exclusives won but not pressed yet: what the wheel shouldn't hand out again. */
  function heldExclusives() {
    return wallet.vinyls().concat(wallet.wheel().exclusives);
  }

  function isHeld(format) {
    return heldExclusives().some(function (vinyl) {
      return vinyl.format === format;
    });
  }

  /** heldExclusives()' formats, to look many up at once: each read of the wallet parses it all. */
  function heldFormats() {
    var formats = {};
    heldExclusives().forEach(function (vinyl) {
      formats[vinyl.format] = true;
    });
    return formats;
  }

  function heldCount() {
    var held = heldFormats();
    return MusicHub.vinylCatalog.exclusives.filter(function (exclusive) {
      return held[exclusive.format];
    }).length;
  }

  /* --------------------------------------------------------------- sound */

  var SOUNDS = {
    // A peg knocking the flapper.
    tick: function (ctx, at, level) {
      sfx.noise(ctx, at, 0.018, 'highpass', 2800, 0.8, 0.28 * level, 0.001);
      sfx.tone(ctx, at, 1900, 1100, 0.07 * level, 0.03, 'triangle');
    },
    // The wheel set going.
    whoosh: function (ctx, at) {
      sfx.noise(ctx, at, 0.7, 'bandpass', 300, 1.2, 0.25, 0.2, 2600);
    },
    // Nothing: the sad trombone - four notes sliding down, the last one wobbling.
    nothing: function (ctx, at) {
      [[392, 370], [370, 349], [349, 330]].forEach(function (note, index) {
        sfx.tone(ctx, at + index * 0.32, note[0], note[1], 0.2, 0.3, 'triangle');
      });
      var last = at + 0.96;
      for (var i = 0; i < 6; i += 1) {
        sfx.tone(ctx, last + i * 0.13, 330 - i * 4, 318 - i * 5, 0.19 - i * 0.02, 0.16, 'triangle');
      }
    },
    common: function (ctx, at) {
      sfx.chime(ctx, at, [784, 988, 1175, 1568], 0.06);
    },
    good: function (ctx, at) {
      sfx.tone(ctx, at, 110, 55, 0.3, 0.4);
      sfx.chime(ctx, at, [659, 784, 988, 1319, 1568], 0.06);
    },
    // A little fanfare: a rising run, then the chord rings out.
    rare: function (ctx, at) {
      sfx.tone(ctx, at, 100, 45, 0.4, 0.5);
      [523, 659, 784, 1047].forEach(function (note, index) {
        sfx.tone(ctx, at + index * 0.09, note, note, 0.08, 0.35, 'triangle');
      });
      sfx.chime(ctx, at + 0.4, [1047, 1319, 1568, 2093], 0.06);
      sparkles(ctx, at + 0.7, 8);
    },
    // Big win: a brassy ta-da, a boom, and a shower of sparkles.
    epic: function (ctx, at) {
      sfx.tone(ctx, at, 90, 35, 0.55, 0.9);
      sfx.noise(ctx, at, 0.5, 'lowpass', 600, 0.7, 0.35, 0.004);
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.42]].forEach(function (note) {
        sfx.tone(ctx, at + note[1], note[0], note[0], 0.1, note[1] > 0.4 ? 1.2 : 0.3, 'sawtooth');
        sfx.tone(ctx, at + note[1], note[0] * 2, note[0] * 2, 0.04, 0.4, 'triangle');
      });
      sfx.chime(ctx, at + 0.45, [1047, 1319, 1568, 2093, 2637], 0.06);
      sparkles(ctx, at + 0.8, 16);
    },
    jackpot: function (ctx, at) {
      SOUNDS.epic(ctx, at);
      // ... and again, a fourth up, with bells ringing on.
      [[698, 1.1], [880, 1.22], [1047, 1.34], [1397, 1.5]].forEach(function (note) {
        sfx.tone(ctx, at + note[1], note[0], note[0], 0.09, note[1] > 1.45 ? 1.4 : 0.3, 'sawtooth');
      });
      for (var i = 0; i < 12; i += 1) {
        var bell = [1568, 2093, 2637, 3136][i % 4];
        sfx.tone(ctx, at + 1.6 + i * 0.1, bell, bell, 0.04, 0.5);
      }
      sparkles(ctx, at + 1.6, 24);
    },
    // Winding up to a wheel exclusive: noise and a tone rising and rising.
    riser: function (ctx, at) {
      var length = CHARGE_MS / 1000;
      sfx.noise(ctx, at, length, 'bandpass', 200, 2, 0.3, length - 0.2, 7000);
      sfx.tone(ctx, at, 180, 1400, 0.08, length, 'sawtooth');
      sfx.tone(ctx, at, 270, 2100, 0.05, length, 'triangle');
    },
    // Under the wind-up: a heartbeat, a low double thump.
    heartbeat: function (ctx, at) {
      sfx.tone(ctx, at, 78, 42, 0.42, 0.22);
      sfx.tone(ctx, at + 0.15, 70, 38, 0.3, 0.2);
    },
    // A firework going off: a crack, then a crackle of sparks.
    pop: function (ctx, at) {
      sfx.noise(ctx, at, 0.35, 'lowpass', 1400, 0.8, 0.32, 0.002);
      sfx.tone(ctx, at, 160, 50, 0.22, 0.3);
      for (var i = 0; i < 9; i += 1) {
        sfx.noise(ctx, at + 0.12 + i * 0.045 + Math.random() * 0.03, 0.03, 'highpass', 4500, 1, 0.1, 0.001);
      }
      sparkles(ctx, at + 0.1, 5);
    },
    // An exclusive's artwork being uncovered (artworkTakeover): the flash's
    // crack, a sweep rising with the wipe, then an airy, choir-like chord
    // swelling while the pattern fills the screen.
    unveil: function (ctx, at) {
      sfx.noise(ctx, at, 0.25, 'highpass', 3000, 0.7, 0.3, 0.002);
      sfx.tone(ctx, at, 120, 60, 0.35, 0.4);
      sfx.noise(ctx, at, 0.8, 'bandpass', 400, 1.5, 0.28, 0.5, 6000);
      [523, 659, 784, 1047, 1319].forEach(function (note, index) {
        sfx.noise(ctx, at + 0.3 + index * 0.05, 2.1, 'bandpass', note, 40, 0.4, 0.9);
        sfx.tone(ctx, at + 0.35, note, note, 0.012, 2);
      });
      sparkles(ctx, at + 0.6, 12);
    },
    // ... and swooping down into the record in the reveal.
    land: function (ctx, at) {
      sfx.noise(ctx, at, 0.75, 'bandpass', 5000, 1.2, 0.22, 0.4, 300);
      sfx.tone(ctx, at, 900, 200, 0.05, 0.75, 'triangle');
    },
    // ... and it bursts: a deep boom and a cascade of bells, up two octaves.
    legendary: function (ctx, at) {
      sfx.tone(ctx, at, 70, 28, 0.7, 1.4);
      sfx.noise(ctx, at, 0.9, 'lowpass', 900, 0.7, 0.5, 0.003);
      sfx.noise(ctx, at, 1.4, 'highpass', 5000, 0.7, 0.12, 0.01);
      [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093].forEach(function (note, index) {
        sfx.tone(ctx, at + 0.15 + index * 0.07, note, note, 0.06, 1.3);
        sfx.tone(ctx, at + 0.15 + index * 0.07, note * 2.76, note * 2.76, 0.015, 0.5);
      });
      sfx.chime(ctx, at + 1, [1047, 1319, 1568, 2093, 2637, 3136], 0.05);
      sparkles(ctx, at + 1.1, 30);
    },
  };

  function sparkles(ctx, at, count) {
    for (var i = 0; i < count; i += 1) {
      var note = [3136, 3951, 4699, 5274][Math.floor(Math.random() * 4)];
      sfx.tone(ctx, at + i * 0.07 + Math.random() * 0.04, note, note, 0.02, 0.25);
    }
  }

  function sound(name, delay, level) {
    sfx.play(SOUNDS, name, delay, level);
  }

  /* --------------------------------------------------------------- wheel */

  // Each slice's place, in degrees clockwise from the top.
  var slices = [];
  (function layout() {
    var total = PRIZES.reduce(function (sum, prize) {
      return sum + prize.weight;
    }, 0);
    var start = 0;
    PRIZES.forEach(function (prize) {
      var size = prize.weight / total * 360;
      slices.push({ prize: prize, start: start, end: start + size, size: size });
      start += size;
    });
  })();

  function polar(radius, degrees) {
    var theta = (degrees - 90) * Math.PI / 180;
    return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
  }

  function point(p) {
    return p.x.toFixed(2) + ' ' + p.y.toFixed(2);
  }

  function slicePath(radius, start, end) {
    return 'M0 0 L' + point(polar(radius, start))
      + ' A' + radius + ' ' + radius + ' 0 ' + (end - start > 180 ? 1 : 0) + ' 1 ' + point(polar(radius, end)) + ' Z';
  }

  function gradient(defs, id, kind, attributes, stops) {
    var node = svg(kind, Object.assign({ id: id }, attributes));
    stops.forEach(function (stop) {
      node.appendChild(svg('stop', { offset: String(stop[0]) }, { stopColor: stop[1], stopOpacity: stop[2] === undefined ? '1' : String(stop[2]) }));
    });
    defs.appendChild(node);
    return node;
  }

  /** The coin as a little <use> of the navbar's #coin-icon. */
  function coinIcon(x, y, size) {
    var use = svg('use', { href: '#coin-icon', x: x, y: y, width: size, height: size });
    use.setAttribute('class', 'wheel__coin');
    return use;
  }

  // Every label the same size: as big as the narrowest slice (Exclusive) allows.
  var LABEL_SIZE = Math.min(12, Math.min.apply(null, slices.map(function (slice) {
    return slice.size;
  })) * 0.62);

  /*
   * The selected tab's turning gold frame in the Gold Navbar (style.css,
   * :root[data-navbar-style="gold"] ... .navbar__tab--active): a conic
   * gradient - deep gold, two bright glints on opposite sides - that turns
   * once every 2.4s (name-border-turn). SVG has no conic gradients, so it's
   * painted once onto a canvas, in the palette's own colours, and that
   * picture turns about the middle of the slice, clipped to it.
   */
  var FRAME_STOPS = [
    [0, 'deep'], [0.18, 'gold'], [0.25, 'shine'], [0.32, 'gold'], [0.5, 'deep'],
    [0.68, 'gold'], [0.75, 'shine'], [0.82, 'gold'], [1, 'deep'],
  ];
  var FRAME_COLORS = { deep: '--rarity-gold-deep', gold: '--rarity-gold', shine: '--rarity-gold-shine' };
  var FRAME_TURN_S = 2.4;

  function goldFrame(defs, group, slice) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || typeof ctx.createConicGradient !== 'function') {
      return;
    }
    var size = 256;
    canvas.width = size;
    canvas.height = size;
    var root = getComputedStyle(document.documentElement);
    // CSS conic gradients start at the top; canvas ones at 3 o'clock.
    var conic = ctx.createConicGradient(-Math.PI / 2, size / 2, size / 2);
    FRAME_STOPS.forEach(function (stop) {
      conic.addColorStop(stop[0], root.getPropertyValue(FRAME_COLORS[stop[1]]).trim());
    });
    ctx.fillStyle = conic;
    ctx.fillRect(0, 0, size, size);

    // Turning about the middle of the slice, big enough to cover all of it.
    var centre = polar(56, (slice.start + slice.end) / 2);
    var reach = 60;
    var frame = svg('g', { 'clip-path': 'url(#wheel-gold-clip)' });
    var picture = svg('image', {
      href: canvas.toDataURL(),
      x: (centre.x - reach).toFixed(2), y: (centre.y - reach).toFixed(2),
      width: reach * 2, height: reach * 2, preserveAspectRatio: 'none',
    });
    picture.style.transformBox = 'fill-box';
    picture.style.transformOrigin = '50% 50%';
    forever(picture, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], FRAME_TURN_S * 1000);
    frame.appendChild(picture);
    group.appendChild(frame);
  }

  /*
   * An endless animation of the wheel's own, on the page's clock (Web
   * Animations) rather than as SMIL in the SVG: the wheel is drawn into
   * the closed dialog, and Chrome left its SMIL animations standing still
   * for a second or so after it was first opened.
   */
  function forever(node, keyframes, ms) {
    if (typeof node.animate === 'function') {
      node.animate(keyframes, { duration: ms, iterations: Infinity });
    }
  }

  /** The prizes, and the light over them. */
  function drawWheel() {
    var disc = els.disc;
    var defs = svg('defs');
    disc.appendChild(defs);
    // The exclusive's slice: the Gold Navbar's turning frame (see
    // goldFrame) under the white glare of the gold covers (gold-shine,
    // 1.5s), which runs from the middle of the wheel out to the rim,
    // starting and ending fully off the slice. The polished-gold run below
    // is what shows without a canvas to paint the frame's gradient on.
    var golden = slices.filter(function (slice) {
      return slice.prize.fill === 'gold';
    })[0];
    var rim = polar(92, (golden.start + golden.end) / 2);
    var alongSlice = { gradientUnits: 'userSpaceOnUse', x1: '0', y1: '0', x2: rim.x.toFixed(2), y2: rim.y.toFixed(2) };
    gradient(defs, 'wheel-gold', 'linearGradient', alongSlice, [
      [0.2, 'var(--rarity-gold-deep)'], [0.4, 'var(--rarity-gold)'], [0.6, 'var(--rarity-gold-bright)'],
      [0.8, 'var(--rarity-gold)'], [1, 'var(--rarity-gold-deep)'],
    ]);
    // The frame and the glare stay inside the slice.
    var clip = svg('clipPath', { id: 'wheel-gold-clip' });
    clip.appendChild(svg('path', { d: slicePath(92, golden.start, golden.end) }));
    defs.appendChild(clip);
    gradient(defs, 'wheel-gold-glare', 'linearGradient', alongSlice, [
      [0.3, 'var(--rarity-gold-shine)', 0], [0.44, 'var(--rarity-gold-shine)', 0.85], [0.5, 'var(--rarity-gold-shine)', 1],
      [0.56, 'var(--rarity-gold-shine)', 0.85], [0.7, 'var(--rarity-gold-shine)', 0],
    ]);
    /*
     * The glare, carried from the middle out past the rim in `pass` of
     * every `seconds`, then off the slice for the rest: a sheet painted
     * with it, far bigger than the slice, sliding under the slice's clip
     * (the gradient moves with it).
     */
    function glare(seconds, pass, reach) {
      var layer = svg('g', { 'clip-path': 'url(#wheel-gold-clip)' }, { mixBlendMode: 'screen' });
      var sheet = svg('rect', { x: -170, y: -170, width: 340, height: 340, fill: 'url(#wheel-gold-glare)' }, { stroke: 'none' });
      var from = 'translate(' + (-reach * rim.x).toFixed(2) + 'px, ' + (-reach * rim.y).toFixed(2) + 'px)';
      var to = 'translate(' + (reach * rim.x).toFixed(2) + 'px, ' + (reach * rim.y).toFixed(2) + 'px)';
      forever(sheet, [
        { transform: from, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
        { offset: pass, transform: to },
        { transform: to },
      ], seconds * 1000);
      layer.appendChild(sheet);
      return layer;
    }
    gradient(defs, 'wheel-shade', 'radialGradient', { cx: '0.5', cy: '0.5', r: '0.5' }, [
      [0, 'var(--color-text)', 0.16], [0.45, 'var(--color-text)', 0], [0.85, 'var(--color-black)', 0.12], [1, 'var(--color-black)', 0.4],
    ]);

    els.slices = slices.map(function (slice) {
      var prize = slice.prize;
      var group = svg('g');
      group.setAttribute('class', 'wheel__slice wheel__slice--' + prize.tier);
      var gold = prize.fill === 'gold';
      group.appendChild(svg('path', { d: slicePath(92, slice.start, slice.end) }, { fill: gold ? 'url(#wheel-gold)' : prize.fill }));
      if (gold) {
        goldFrame(defs, group, slice);
        group.appendChild(glare(1.5, 0.65, 0.7));
      }

      // The label runs along the slice's middle, reading outwards.
      var middle = (slice.start + slice.end) / 2;
      var label = svg('g', { transform: 'rotate(' + (middle - 90).toFixed(2) + ')' });
      label.setAttribute('class', 'wheel__label' + (gold ? ' wheel__label--dark' : ''));
      var size = LABEL_SIZE;
      var lines = prize.label || [wallet.format(prize.coins)];
      var end = prize.kind === 'coins' ? 74 : 86;
      lines.forEach(function (line, index) {
        var text = svg('text', {
          x: end, y: ((index - (lines.length - 1) / 2) * size * 1.05).toFixed(2),
          'text-anchor': 'end', 'dominant-baseline': 'central', 'font-size': size.toFixed(1),
        });
        text.textContent = line;
        label.appendChild(text);
      });
      if (prize.kind === 'coins') {
        label.appendChild(coinIcon(76, -5.5, 11));
      }
      group.appendChild(label);
      disc.appendChild(group);
      return group;
    });

    disc.appendChild(svg('circle', { cx: 0, cy: 0, r: 92, fill: 'url(#wheel-shade)' }, { pointerEvents: 'none' }));

    // A peg at every boundary between two prizes.
    var pegs = svg('g');
    pegs.setAttribute('class', 'wheel__pegs');
    slices.forEach(function (slice) {
      var at = polar(90, slice.start);
      pegs.appendChild(svg('circle', { cx: at.x.toFixed(2), cy: at.y.toFixed(2), r: 2.1 }));
    });
    disc.appendChild(pegs);
  }

  /** The dark purple rim around it. */
  function drawFrame() {
    els.frame.appendChild(svg('circle', { cx: 0, cy: 0, r: 95.5, fill: 'none', 'stroke-width': 8 }, { stroke: 'color-mix(in srgb, var(--color-purple-950) 50%, var(--color-purple-900))' }));
    els.frame.appendChild(svg('circle', { cx: 0, cy: 0, r: 91.8, fill: 'none', 'stroke-width': 1 }, { stroke: 'var(--color-purple-900)' }));
  }

  function setRotation(degrees) {
    rotation = degrees;
    els.disc.style.transform = 'rotate(' + degrees.toFixed(3) + 'deg)';
    els.glow.style.transform = els.disc.style.transform;
  }

  function sliceAt(degrees) {
    var at = mod(degrees, 360);
    for (var i = 0; i < slices.length; i += 1) {
      if (at >= slices[i].start && at < slices[i].end) {
        return i;
      }
    }
    return slices.length - 1;
  }

  /**
   * Turns the wheel until `prize`'s slice stops under the pointer, at a
   * random spot inside it, clear of the edges. Each edge knocks the
   * flapper aside - and ticks - as it passes. Resolves once it stands still.
   */
  function spinTo(prize) {
    var slice = slices.filter(function (entry) {
      return entry.prize === prize;
    })[0];
    var margin = Math.min(2.5, slice.size * 0.2);
    var landing = slice.start + margin + Math.random() * (slice.size - 2 * margin);
    // The wheel at rotation R has the point at angle a under the pointer
    // when R + a is a whole number of turns.
    var from = rotation;
    var turns = MIN_TURNS + Math.floor(Math.random() * 2);
    var to = from + turns * 360 + mod(-(from + landing), 360);

    if (reducedMotion()) {
      setRotation(to);
      return wait(350);
    }

    sound('whoosh');
    var windFrom = from - WIND_UP_DEGREES;
    var lastSlice = sliceAt(-from);
    var lastTick = 0;
    // The flapper's swing, in degrees, and how fast it's swinging.
    var flap = 0;
    var flapSpeed = 0;
    var previous = null;

    return new Promise(function (resolve) {
      var start = null;
      function frame(now) {
        start = start === null ? now : start;
        var elapsed = now - start;
        var dt = previous === null ? 16 : now - previous;
        previous = now;
        var angle;
        if (elapsed < WIND_UP_MS) {
          var w = elapsed / WIND_UP_MS;
          angle = from - WIND_UP_DEGREES * (0.5 - 0.5 * Math.cos(Math.PI * w));
        } else {
          var t = Math.min(1, (elapsed - WIND_UP_MS) / SPIN_MS);
          angle = windFrom + (to - windFrom) * (1 - Math.pow(1 - t, 4));
        }
        setRotation(angle);

        // A peg went past: tick, and knock the flapper (at most once a frame).
        var current = sliceAt(-angle);
        if (current !== lastSlice) {
          lastSlice = current;
          flapSpeed = Math.min(flapSpeed + FLAP_KICK, FLAP_KICK * 1.2);
          if (now - lastTick > 28) {
            lastTick = now;
            sound('tick');
          }
        }
        // A spring pulls it back, a little underdamped: it swings aside
        // smoothly, then settles with the slightest bounce - in small
        // steps, so a slow frame can't make it jump.
        var remaining = Math.min(dt, 64) / 1000;
        while (remaining > 0) {
          var step = Math.min(remaining, 0.004);
          flapSpeed += (-FLAP_STIFFNESS * flap - FLAP_DAMPING * flapSpeed) * step;
          flap += flapSpeed * step;
          remaining -= step;
        }
        // Drawn through a soft limit: the swing eases into FLAP_MAX instead
        // of hitting it, so pegs coming thick and fast don't pin it there
        // juddering.
        var shown = FLAP_MAX * Math.tanh(flap / FLAP_MAX);
        els.pointer.style.transform = 'rotate(' + (-shown).toFixed(2) + 'deg)';

        if (elapsed < WIND_UP_MS + SPIN_MS || Math.abs(flap) > 0.2 || Math.abs(flapSpeed) > 4) {
          window.requestAnimationFrame(frame);
        } else {
          els.pointer.style.transform = '';
          resolve();
        }
      }
      window.requestAnimationFrame(frame);
    });
  }

  /** The won slice lit up, the others dimmed. */
  function highlight(prize) {
    els.slices.forEach(function (group, index) {
      var won = slices[index].prize === prize;
      group.classList.toggle('wheel__slice--won', won);
      group.classList.toggle('wheel__slice--dim', !won);
      if (won) {
        els.glowSlice.setAttribute('d', slicePath(92, slices[index].start, slices[index].end));
      }
    });
    els.glow.classList.add('wheel__glow--on');
  }

  function clearHighlight() {
    els.slices.forEach(function (group) {
      group.classList.remove('wheel__slice--won', 'wheel__slice--dim');
    });
    els.glow.classList.remove('wheel__glow--on');
  }

  /* ------------------------------------------------------ celebrations */

  /*
   * Confetti, sparkles and raining coins go in an overlay in the top layer
   * - a popover, shown over the open dialog - so they fly across the whole
   * screen, not just the dialog. Without popovers, inside the dialog.
   */
  var overlay = null;

  function fxLayer() {
    if (!overlay) {
      overlay = el('div', 'wheel-fx');
      overlay.setAttribute('aria-hidden', 'true');
      if (typeof overlay.showPopover === 'function') {
        overlay.setAttribute('popover', 'manual');
        document.body.appendChild(overlay);
      } else {
        overlay.classList.add('wheel-fx--inline');
        els.dialog.appendChild(overlay);
      }
    }
    if (overlay.hasAttribute('popover') && !overlay.matches(':popover-open')) {
      overlay.showPopover();
    }
    return overlay;
  }

  /**
   * The overlay, shown again so it's the newest thing in the top layer -
   * over the wheel, even if it was up before the wheel opened. Once when a
   * celebration starts, not for every burst: each re-show works out the
   * styles of everything in it again.
   */
  function raiseFx() {
    var layer = fxLayer();
    if (layer.hasAttribute('popover')) {
      layer.hidePopover();
      layer.showPopover();
    }
    return layer;
  }

  /**
   * Puts `pieces` ({ node, frames, timing }) on the overlay in one go, then
   * sets them all moving - each gone once it lands. Animating each as it's
   * added would work the styles out again for every piece: a big win's
   * hundreds of them froze the first frame.
   */
  function launch(pieces) {
    var layer = fxLayer();
    var batch = document.createDocumentFragment();
    pieces.forEach(function (piece) {
      batch.appendChild(piece.node);
    });
    layer.appendChild(batch);
    pieces.forEach(function (piece) {
      piece.node.animate(piece.frames, piece.timing).onfinish = piece.node.remove.bind(piece.node);
    });
  }

  /** Clears the celebration away - the wallet's coins still on their way up fly on. */
  function hideFx() {
    if (!overlay) {
      return;
    }
    clearSky();
    Array.prototype.forEach.call(overlay.querySelectorAll('.wheel-fx__flash, .wheel-fx__fx'), function (node) {
      node.remove();
    });
    // Empty but for the (cleared) canvas: out of the way.
    if (!overlay.querySelector(':scope > :not(.wheel-fx__sky)') && overlay.hasAttribute('popover') && overlay.matches(':popover-open')) {
      overlay.hidePopover();
    }
  }

  /**
   * Where won coins fly (wallet.earn's `layer`): the overlay, over the open
   * wheel and its backdrop. Without popovers, the page as ever.
   */
  function coinLayer() {
    if (!els.dialog.open || (overlay && !overlay.hasAttribute('popover')) || typeof HTMLElement.prototype.showPopover !== 'function') {
      return null;
    }
    return raiseFx();
  }

  /**
   * Resolves once everything still playing over the wheel has finished:
   * confetti, raining coins, the coins flying up to the balance, the "+500"
   * and the balance fading back down. (The coins' endless flip doesn't count.)
   */
  function fxSettled() {
    if (!overlay || typeof overlay.getAnimations !== 'function') {
      return Promise.resolve();
    }
    var playing = overlay.getAnimations({ subtree: true }).filter(function (animation) {
      return animation.playState === 'running' && animation.effect && animation.effect.getComputedTiming().endTime !== Infinity;
    });
    if (!playing.length && !sky.pieces.length) {
      return Promise.resolve();
    }
    return Promise.all(playing.map(function (animation) {
      return animation.finished.catch(function () {});
    }).concat(skyClear())).then(fxSettled);
  }

  function centreOf(node) {
    var rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Confetti colours for each tier, all from the palette.
  var TIER_COLORS = {
    common: ['var(--color-purple-300)', 'var(--color-purple-500)', 'var(--rarity-gold-bright)', 'var(--color-text)'],
    good: ['var(--color-purple-300)', 'var(--rarity-pink)', 'var(--rarity-gold-bright)', 'var(--color-text)'],
    rare: ['var(--rarity-blue)', 'var(--rarity-purple)', 'var(--rarity-pink)', 'var(--rarity-gold-bright)', 'var(--color-text)'],
    epic: ['var(--rarity-pink)', 'var(--rarity-gold)', 'var(--rarity-gold-bright)', 'var(--rarity-gold-shine)', 'var(--rarity-purple)'],
    jackpot: ['var(--rarity-gold)', 'var(--rarity-gold-bright)', 'var(--rarity-gold-shine)', 'var(--rarity-gold-deep)', 'var(--color-text)'],
    legendary: ['var(--vinyl-red)', 'var(--vinyl-orange)', 'var(--vinyl-yellow)', 'var(--vinyl-green)', 'var(--vinyl-teal)', 'var(--vinyl-blue)', 'var(--vinyl-purple)', 'var(--vinyl-pink)'],
  };

  /*
   * Confetti and sparkles, drawn on one canvas over the whole screen (the
   * overlay's .wheel-fx__sky) rather than an element each: a jackpot's
   * hundreds of pieces were hundreds of layers for the graphics card to put
   * together every frame. Every piece is still there, moving as before.
   */
  var sky = { canvas: null, ctx: null, ratio: 1, pieces: [], frame: 0, idle: [] };
  // The star sparkle's outline, and a strip of paper, both 1px across -
  // scaled to size as they're drawn.
  var STAR_PATH = [[0.5, 0], [0.61, 0.39], [1, 0.5], [0.61, 0.61], [0.5, 1], [0.39, 0.61], [0, 0.5], [0.39, 0.39]];
  var CONFETTI_GRAVITY = 520;

  /** The canvas, on the overlay, sized to the screen. */
  function skyCanvas() {
    var layer = fxLayer();
    if (!sky.canvas) {
      sky.canvas = el('canvas', 'wheel-fx__sky');
      sky.ctx = sky.canvas.getContext('2d');
    }
    if (sky.canvas.parentNode !== layer) {
      layer.insertBefore(sky.canvas, layer.firstChild);
    }
    sky.ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.round(window.innerWidth * sky.ratio);
    var height = Math.round(window.innerHeight * sky.ratio);
    if (sky.canvas.width !== width || sky.canvas.height !== height) {
      sky.canvas.width = width;
      sky.canvas.height = height;
    }
    return sky.canvas;
  }

  /**
   * `count` pieces of confetti bursting out of `from` ({x, y}) and falling
   * away under gravity, tumbling as they go. `options.stars`: sparkles
   * rather than paper.
   */
  function confetti(count, from, colors, options) {
    if (reducedMotion() || !skyCanvas().getContext) {
      return;
    }
    var power = (options && options.power) || 1;
    var now = performance.now();
    for (var i = 0; i < count; i += 1) {
      var angle = (options && options.angle !== undefined ? options.angle : -Math.PI / 2) + (Math.random() - 0.5) * ((options && options.spread) || Math.PI * 1.6);
      var speed = between(320, 820) * power;
      sky.pieces.push({
        shape: options && options.stars ? 'star' : i % 3 === 0 ? 'round' : 'strip',
        color: wallet.paint(colors[i % colors.length]),
        x: from.x,
        y: from.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: between(-900, 900),
        wobble: i,
        start: now + Math.random() * 120,
        duration: between(1600, 2800),
      });
    }
    if (!sky.frame) {
      sky.frame = window.requestAnimationFrame(drawSky);
    }
  }

  /** One frame of every piece in the air - and the next, while any are. */
  function drawSky(now) {
    var ctx = sky.ctx;
    var ratio = sky.ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sky.canvas.width, sky.canvas.height);
    sky.pieces = sky.pieces.filter(function (piece) {
      var elapsed = now - piece.start;
      if (elapsed > piece.duration) {
        return false;
      }
      if (elapsed < 0) {
        return true;
      }
      if (piece.shape === 'coin') {
        var p = elapsed / piece.duration;
        ctx.globalAlpha = 1;
        wallet.drawCoin(ctx, ratio, piece.x + piece.drift * p, -40 + (window.innerHeight + 80) * fallen(p), piece.scale, wallet.flipWidth(p * piece.flips));
        return true;
      }
      var t = elapsed / 1000;
      // Air drag slows it down, gravity pulls it down.
      var drag = (1 - Math.exp(-2.2 * t)) / 2.2;
      var x = piece.x + piece.vx * drag + Math.sin(t * 6 + piece.wobble) * 12;
      var y = piece.y + piece.vy * drag + CONFETTI_GRAVITY * t * t * 0.5;
      // Turning in the screen's plane, tumbling end over end (the flip
      // squashing it top to bottom), and fading over its last quarter.
      var turn = piece.spin * t * Math.PI / 180;
      var tumble = Math.cos(piece.spin * t * 1.7 * Math.PI / 180);
      var cos = Math.cos(turn);
      var sin = Math.sin(turn);
      var left = elapsed / piece.duration;
      ctx.globalAlpha = left > 0.75 ? (1 - left) * 4 : 1;
      ctx.fillStyle = piece.color;
      ctx.setTransform(ratio * cos, ratio * sin, -ratio * sin * tumble, ratio * cos * tumble, x * ratio, y * ratio);
      ctx.beginPath();
      if (piece.shape === 'star') {
        STAR_PATH.forEach(function (point, index) {
          ctx[index ? 'lineTo' : 'moveTo']((point[0] - 0.5) * 14, (point[1] - 0.5) * 14);
        });
      } else if (piece.shape === 'round') {
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      } else {
        ctx.rect(-4.5, -7, 9, 14);
      }
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
    if (sky.pieces.length) {
      sky.frame = window.requestAnimationFrame(drawSky);
      return;
    }
    sky.frame = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sky.canvas.width, sky.canvas.height);
    var waiting = sky.idle;
    sky.idle = [];
    waiting.forEach(function (resolve) {
      resolve();
    });
  }

  /** Resolves once the last piece of confetti has fallen. */
  function skyClear() {
    if (!sky.pieces.length) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      sky.idle.push(resolve);
    });
  }

  /** Every piece gone at once - a new spin. */
  function clearSky() {
    sky.pieces = [];
    if (sky.frame) {
      window.cancelAnimationFrame(sky.frame);
      sky.frame = 0;
    }
    if (sky.ctx) {
      sky.ctx.setTransform(1, 0, 0, 1, 0, 0);
      sky.ctx.clearRect(0, 0, sky.canvas.width, sky.canvas.height);
    }
    var waiting = sky.idle;
    sky.idle = [];
    waiting.forEach(function (resolve) {
      resolve();
    });
  }

  /** Coins raining down the whole screen, flipping as they fall - on the confetti's canvas. */
  function coinRain(count) {
    if (reducedMotion() || !skyCanvas().getContext) {
      return;
    }
    var now = performance.now();
    for (var i = 0; i < count; i += 1) {
      var duration = between(1300, 2300);
      sky.pieces.push({
        shape: 'coin',
        x: Math.random() * window.innerWidth,
        drift: between(-60, 60),
        scale: between(0.7, 1.5),
        flips: duration / between(260, 520),
        start: now + Math.random() * 1500,
        duration: duration,
      });
    }
    if (!sky.frame) {
      sky.frame = window.requestAnimationFrame(drawSky);
    }
  }

  /**
   * How far down a falling coin is, `p` of the way through its fall: the
   * old cubic-bezier(0.4, 0, 1, 1) - slow to start, then dropping fast.
   */
  function fallen(p) {
    var low = 0;
    var high = 1;
    for (var i = 0; i < 14; i += 1) {
      var mid = (low + high) / 2;
      var x = 3 * (1 - mid) * (1 - mid) * mid * 0.4 + 3 * (1 - mid) * mid * mid + mid * mid * mid;
      if (x < p) {
        low = mid;
      } else {
        high = mid;
      }
    }
    var s = (low + high) / 2;
    return 3 * (1 - s) * s * s + s * s * s;
  }

  /** The whole screen lighting up for a moment. */
  function flash(strength) {
    if (reducedMotion() || !document.body.animate) {
      return;
    }
    var layer = fxLayer();
    var light = el('span', 'wheel-fx__flash');
    layer.appendChild(light);
    light.animate([{ opacity: strength || 0.85 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' }).onfinish = light.remove.bind(light);
  }

  function shake(node, strength) {
    if (reducedMotion() || !node.animate) {
      return;
    }
    var s = strength || 6;
    node.animate([
      { transform: 'translate(0, 0)' },
      { transform: 'translate(' + -s + 'px, ' + s / 2 + 'px) rotate(-0.6deg)' },
      { transform: 'translate(' + s + 'px, ' + -s / 2 + 'px) rotate(0.6deg)' },
      { transform: 'translate(' + -s / 2 + 'px, ' + s / 3 + 'px)' },
      { transform: 'translate(' + s / 2 + 'px, 0)' },
      { transform: 'translate(0, 0)' },
    ], { duration: 450, easing: 'ease-out' });
  }

  /** "BIG WIN!" or "JACKPOT!" slamming onto the wheel. */
  function banner(text, holdMs) {
    els.banner.style.setProperty('--banner-hold', holdMs + 'ms');
    // The lettering, and its hard gold shadow on a still layer of its own
    // underneath: a filter on the moving, shining text would be worked out
    // again every frame.
    els.banner.textContent = '';
    els.banner.appendChild(el('span', 'wheel__banner-shadow', text));
    els.banner.appendChild(el('span', 'wheel__banner-text', text));
    els.banner.classList.remove('wheel__banner--show');
    // Restart its animation.
    void els.banner.offsetWidth;
    els.banner.classList.add('wheel__banner--show');
  }

  /** What was won, under the wheel. */
  function showResult(prize, record) {
    els.result.textContent = '';
    els.result.className = 'wheel__result wheel__result--' + prize.tier + ' wheel__result--shown';
    var line = el('span', 'wheel__result-line');
    if (record.coins) {
      line.appendChild(wallet.coinSvg('coin'));
      line.appendChild(el('span', null, '+' + wallet.format(record.coins) + ' coins'));
    } else if (prize.kind === 'respins') {
      line.textContent = '+3 respins!';
    } else if (prize.kind === 'mystery') {
      line.textContent = 'A Mystery Vinyl!';
    } else if (prize.kind === 'exclusive') {
      line.textContent = 'A wheel exclusive!';
    } else {
      line.textContent = 'Nothing this time';
    }
    els.result.appendChild(line);
    var note = null;
    if (prize.kind === 'exclusive' && record.coins) {
      note = 'You already own every wheel exclusive - have coins instead.';
    } else if (prize.kind === 'mystery' && record.coins) {
      note = 'Your collection holds every record - have coins instead.';
    } else if (prize.kind === 'respins') {
      note = 'Saved for whenever you like.';
    } else if (prize.kind === 'mystery') {
      note = 'Waiting in your prizes - unbox it free in the Store.';
    } else if (prize.kind === 'nothing') {
      note = 'Better luck next spin.';
    }
    if (note) {
      els.result.appendChild(el('span', 'wheel__result-note', note));
    }
  }

  /** Everything a win brings with it, by how rare it is. */
  function celebrate(prize, record) {
    var tier = record.coins && prize.kind !== 'coins' ? 'epic' : prize.tier;
    var from = centreOf(els.machine);
    els.dialog.dataset.win = tier;
    raiseFx();
    highlight(prize);
    showResult(prize, record);

    switch (tier) {
      case 'none':
        sound('nothing');
        els.dialog.classList.add('wheel--sad');
        break;
      case 'common':
        sound('common');
        confetti(34, from, TIER_COLORS.common, { power: 0.7 });
        break;
      case 'good':
        sound('good');
        confetti(56, from, TIER_COLORS.good, { power: 0.85 });
        break;
      case 'rare':
        sound('rare');
        els.dialog.classList.add('wheel--rays');
        shake(els.machine, 4);
        confetti(90, from, TIER_COLORS.rare);
        break;
      case 'epic':
      case 'jackpot':
        sound(tier);
        els.dialog.classList.add('wheel--rays');
        flash(tier === 'jackpot' ? 0.9 : 0.6);
        shake(els.dialog, tier === 'jackpot' ? 10 : 7);
        banner(tier === 'jackpot' ? 'Jackpot!' : 'Big win!', BANNER_HOLD_MS[tier]);
        confetti(tier === 'jackpot' ? 160 : 110, from, TIER_COLORS[tier], { power: 1.2 });
        // Cannons from both bottom corners.
        confetti(50, { x: 0, y: window.innerHeight }, TIER_COLORS[tier], { angle: -Math.PI / 3, spread: 0.7, power: 1.5 });
        confetti(50, { x: window.innerWidth, y: window.innerHeight }, TIER_COLORS[tier], { angle: -Math.PI * 2 / 3, spread: 0.7, power: 1.5 });
        coinRain(tier === 'jackpot' ? 70 : 36);
        if (tier === 'jackpot') {
          window.setTimeout(function () {
            confetti(80, from, TIER_COLORS.jackpot, { stars: true, power: 1.1 });
          }, 900);
        }
        break;
      default:
        break;
    }
  }

  function resetCelebration() {
    delete els.dialog.dataset.win;
    els.dialog.classList.remove('wheel--rays', 'wheel--sad', 'wheel--charging');
    els.banner.classList.remove('wheel__banner--show');
    clearHighlight();
  }

  /* ------------------------------------------------------------- claiming */

  /**
   * Hands out a stored prize - once, whichever tab or page load gets to it
   * first. Coins come back to be earned (so they can fly); the rest goes
   * straight into the wallet: respins, a mystery vinyl to unbox, or the
   * exclusive, waiting to be pressed onto an album.
   */
  function claim(record) {
    var prize = prizeById(record.id);
    var claimed = wallet.updateWheel(function (wheel) {
      if (!wheel.unclaimed || wheel.unclaimed.spinId !== record.spinId) {
        return false;
      }
      wheel.unclaimed = null;
      if (record.coins || !prize) {
        return true;
      }
      if (prize.kind === 'respins') {
        wheel.respins += prize.respins;
      } else if (prize.kind === 'mystery') {
        wheel.freeVinyls += 1;
      } else if (prize.kind === 'exclusive') {
        wheel.exclusives.push({ format: record.format, family: record.family, seed: record.seed, wonAt: new Date().toISOString() });
      }
      return true;
    });
    return claimed ? (record.coins || 0) : 0;
  }

  /** A prize left behind mid-spin (the page was left): handed out now, quietly. */
  function claimLeftover() {
    var record = wallet.wheel().unclaimed;
    if (!record || spinning) {
      return;
    }
    var coins = claim(record);
    if (coins) {
      wallet.earn(coins, { from: els.dialog.open ? els.disc : els.open, layer: coinLayer() });
    }
  }

  /* ---------------------------------------------------------------- spin */

  function spin() {
    if (spinning || celebration) {
      return;
    }
    claimLeftover();
    var prize = roll();
    var record = { spinId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), id: prize.id };
    if (prize.kind === 'exclusive') {
      var exclusive = MusicHub.vinylCatalog.pickExclusive(heldExclusives());
      if (exclusive) {
        Object.assign(record, exclusive);
      } else {
        record.coins = EXCLUSIVE_FALLBACK_COINS;
      }
    } else if (prize.kind === 'mystery' && !MusicHub.vinylCatalog.pick(wallet.vinyls(), { cover: true })) {
      record.coins = MYSTERY_FALLBACK_COINS;
    } else if (prize.kind === 'coins') {
      record.coins = prize.coins;
    }

    var today = localDay();
    var started = wallet.updateWheel(function (wheel) {
      if (wheel.unclaimed) {
        return false;
      }
      if (wheel.lastSpin !== today) {
        wheel.lastSpin = today;
      } else if (wheel.respins > 0) {
        wheel.respins -= 1;
      } else {
        return false;
      }
      wheel.unclaimed = record;
      return true;
    });
    if (!started) {
      render();
      return;
    }

    spinning = true;
    hideFx();
    resetCelebration();
    els.result.className = 'wheel__result';
    els.result.textContent = '';
    render();

    var legendary = prize.kind === 'exclusive' && !record.coins;
    spinTo(prize).then(function () {
      if (legendary) {
        return revealExclusive(prize, record);
      }
      spinning = false;
      var coins = claim(record);
      celebrate(prize, record);
      render();
      finishWin(prize, record, coins);
      return null;
    });
  }

  /**
   * A mystery vinyl is unboxed in the Store - its offer is free while one
   * won here is waiting. Already there, the wheel just closes onto it.
   * Only ever asked for, from the prizes' card: winning one doesn't leave.
   */
  function goToStore() {
    if (window.location.pathname !== '/store') {
      window.location.href = '/store';
    }
  }

  /** Pays `coins`, flying out of the wheel's middle in its COIN_SHOWERS shower. */
  function earnShower(coins) {
    var shower = COIN_SHOWERS.filter(function (step) {
      return coins >= step[0];
    }).pop();
    return wallet.earn(coins, { from: els.disc, layer: coinLayer(), coins: shower[1], launchMs: shower[2] });
  }

  /**
   * After the wheel stops: coins fly straight out of its middle up to the
   * balance, and the wheel stays open for the next spin - a Mystery Vinyl
   * too, which waits in the prizes (the gift button) to be unboxed.
   */
  function finishWin(prize, record, coins) {
    var landed = coins ? earnShower(coins) : null;
    // The wheel stays out of reach until the whole celebration has played.
    var tier = record.coins && prize.kind !== 'coins' ? 'epic' : prize.tier;
    var token = {};
    celebration = token;
    render();
    Promise.all([wait(reducedMotion() ? 600 : WIN_SHOW_MS[tier] || 2500), landed]).then(fxSettled).then(function () {
      if (celebration === token) {
        celebration = null;
        render();
      }
    });
    // Straight back to spinning, if they like.
    els.machine.focus();
  }

  /* ----------------------------------------------------------- exclusive */

  /**
   * A wheel exclusive: the wheel shakes as the light builds, the screen
   * bursts white, the record's own pattern takes over the whole screen
   * (artworkTakeover), then shrinks down into the reveal's record, which
   * bursts out of a whirl of rainbow light, its name spelling itself out.
   */
  function revealExclusive(prize, record) {
    var motion = !reducedMotion() && !!document.body.animate;
    highlight(prize);
    showResult(prize, record);
    els.dialog.classList.add('wheel--charging');
    sound('riser');
    if (motion) {
      chargeUp();
    }
    return wait(motion ? CHARGE_MS : 200).then(function () {
      claim(record);
      spinning = false;
      flash(1);
      resetCelebration();
      if (!motion) {
        sound('legendary');
        showReveal(record, true);
        celebrateExclusive(record, false);
        return null;
      }
      sound('unveil');
      var takeover = artworkTakeover(record);
      return wait(TAKEOVER_GROW_MS + TAKEOVER_HOLD_MS).then(function () {
        // The reveal comes up under the artwork, which lands on its record.
        showReveal(record, true, { landed: true });
        sound('land');
        return takeover.land(els.revealRecord.querySelector('.vinyl') || els.revealRecord);
      }).then(function () {
        celebrateExclusive(record, true);
      });
    });
  }

  /** The exclusive up in the reveal: the burst out of it, fireworks and confetti. */
  function celebrateExclusive(record, motion) {
    // Out of the record itself, now it's up in the reveal.
    var from = centreOf(els.revealRecord);
    if (motion) {
      // The rainbow rings' boom and bells (without motion, it played at the flash).
      sound('legendary');
      burst(from);
      fireworks(6);
    }
    var glow = MusicHub.vinyl.glowColors(MusicHub.vinyl.describe(record.format));
    confetti(90, from, [glow.glow, glow.accent, 'var(--color-text)', 'var(--rarity-gold-shine)'], { stars: true, spread: Math.PI * 2, power: 0.9 });
    confetti(120, { x: window.innerWidth / 2, y: window.innerHeight * 0.1 }, TIER_COLORS.legendary, { angle: Math.PI / 2, spread: Math.PI * 1.2, power: 0.5 });
    window.setTimeout(function () {
      confetti(60, { x: 0, y: window.innerHeight }, TIER_COLORS.legendary, { angle: -Math.PI / 3, spread: 0.7, power: 1.5 });
      confetti(60, { x: window.innerWidth, y: window.innerHeight }, TIER_COLORS.legendary, { angle: -Math.PI * 2 / 3, spread: 0.7, power: 1.5 });
    }, 500);
    render();
  }

  // The exclusive's pattern over the whole screen: uncovered from the
  // bottom-left corner to the top-right, held still, then landing.
  var TAKEOVER_GROW_MS = 750;
  var TAKEOVER_HOLD_MS = 1300;
  var TAKEOVER_LAND_MS = 750;

  /**
   * The exclusive record, just big enough to cover the whole screen,
   * uncovered by a diagonal wipe from the bottom-left corner to the top-right,
   * held still (not spinning) so the pattern can be taken in. Returns { land(target) }: shrinking down
   * onto `target` (the reveal's record), resolving once it's there and gone.
   */
  function artworkTakeover(exclusive) {
    var screen = el('span', 'wheel-fx__fx wheel-fx__takeover');
    var art = el('span', 'wheel-fx__artwork');
    var record = MusicHub.vinyl.render(MusicHub.vinyl.describe(exclusive.format), { seed: exclusive.seed });
    record.classList.add('vinyl--house');
    art.appendChild(record);
    // Exactly as wide as the screen's diagonal: the furthest out it can be
    // while its circle still covers every corner.
    art.style.width = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight)) + 'px';
    screen.appendChild(art);
    raiseFx().appendChild(screen);
    // Its pattern's own animations running (glitter, glow, ...) - the record
    // itself doesn't turn.
    MusicHub.vinyl.setPlaying(record, true);

    var middle = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    // The edge of the wipe runs corner to corner; at 200% it's past the top-right.
    screen.animate([
      { clipPath: 'polygon(0 100%, 0 100%, 0 100%)', filter: 'brightness(2.2)' },
      { clipPath: 'polygon(0 100%, 0 -100%, 200% 100%)', filter: 'brightness(1)' },
    ], { duration: TAKEOVER_GROW_MS, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' });
    // Not turning - just drifting the slightest bit closer while it's shown.
    art.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.03)' },
    ], { duration: TAKEOVER_GROW_MS + TAKEOVER_HOLD_MS, easing: 'ease-out', fill: 'forwards' });

    return {
      land: function (target) {
        // Unturned sizes: a turning record's bounding box is bigger than it is.
        var size = art.offsetWidth;
        var rect = target.getBoundingClientRect();
        var to = 'translate(' + (rect.left + rect.width / 2 - middle.x).toFixed(0) + 'px, '
          + (rect.top + rect.height / 2 - middle.y).toFixed(0) + 'px) scale(' + (target.offsetWidth / size).toFixed(4) + ')';
        var landing = art.animate([
          { transform: 'scale(1.03)', opacity: 1 },
          { transform: to, opacity: 1, offset: 0.85 },
          { transform: to, opacity: 0 },
        ], { duration: TAKEOVER_LAND_MS, easing: 'cubic-bezier(0.6, 0, 0.3, 1)', fill: 'forwards' });
        return new Promise(function (resolve) {
          landing.onfinish = landing.oncancel = function () {
            screen.remove();
            resolve();
          };
        });
      },
    };
  }

  // The screen darkening round the wheel as an exclusive winds up.
  var chargeDim = null;

  /**
   * The wind-up to a wheel exclusive, over CHARGE_MS: the screen going
   * dark round the wheel, sparks of every colour pulled in from the edges
   * - more and faster as it goes - and a heartbeat quickening under it.
   */
  function chargeUp() {
    var centre = centreOf(els.machine);
    raiseFx();
    chargeDim = el('span', 'wheel-fx__fx wheel-fx__dim');
    chargeDim.style.setProperty('--x', centre.x + 'px');
    chargeDim.style.setProperty('--y', centre.y + 'px');
    fxLayer().appendChild(chargeDim);
    chargeDim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CHARGE_MS, easing: 'ease-in', fill: 'forwards' });

    var reach = Math.hypot(window.innerWidth, window.innerHeight) * 0.6;
    var count = 300;
    var pieces = [];
    for (var i = 0; i < count; i += 1) {
      var progress = i / count;
      var angle = Math.random() * Math.PI * 2;
      var distance = reach * between(0.65, 1.1);
      var start = { x: centre.x + Math.cos(angle) * distance, y: centre.y + Math.sin(angle) * distance };
      var near = { x: centre.x + Math.cos(angle) * distance * 0.55, y: centre.y + Math.sin(angle) * distance * 0.55 };
      // Pointing the way it flies: in, towards the wheel.
      var heading = angle * 180 / Math.PI + 180;
      var spark = el('span', 'wheel-fx__fx wheel-fx__spark');
      spark.style.setProperty('--spark-color', TIER_COLORS.legendary[i % TIER_COLORS.legendary.length]);
      pieces.push({
        node: spark,
        frames: [
          { transform: sparkAt(start, heading, 0.7), opacity: 0 },
          { transform: sparkAt(near, heading, 1.5), opacity: 1, offset: 0.55 },
          { transform: sparkAt(centre, heading, 0.55), opacity: 0.35 },
        ],
        timing: {
          // Long, slow streaks at first, quicker ones as it builds.
          duration: 1500 - progress * 850,
          delay: Math.pow(progress, 0.75) * (CHARGE_MS - 650),
          easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)',
          fill: 'both',
        },
      });
    }
    launch(pieces);
    // Quicker and quicker, up to the burst.
    [0, 0.95, 1.75, 2.4, 2.9, 3.25, 3.5, 3.65, 3.74].forEach(function (seconds) {
      sound('heartbeat', seconds);
    });
  }

  /** A spark at `point`, pointing `heading` degrees, drawn out `stretch` times its length. */
  function sparkAt(point, heading, stretch) {
    return 'translate(' + point.x.toFixed(1) + 'px, ' + point.y.toFixed(1) + 'px) rotate(' + heading.toFixed(1) + 'deg) scaleX(' + stretch + ')';
  }

  /**
   * The exclusive bursting out at `from` (the record's middle): the dark lifting as rings of
   * rainbow light shoot out across the screen, beams of every colour
   * sweeping round, and the whole wheel shaking.
   */
  function burst(from) {
    if (chargeDim) {
      var dim = chargeDim;
      chargeDim = null;
      dim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' }).onfinish = dim.remove.bind(dim);
    }
    var pieces = [];
    for (var i = 0; i < 3; i += 1) {
      var ring = el('span', 'wheel-fx__fx wheel-fx__ring');
      var place = 'translate(' + from.x.toFixed(0) + 'px, ' + from.y.toFixed(0) + 'px) ';
      pieces.push({
        node: ring,
        frames: [{ transform: place + 'scale(0.1)', opacity: 1 }, { transform: place + 'scale(' + (7 + i * 1.5) + ')', opacity: 0 }],
        timing: { duration: 1300 + i * 200, delay: i * 180, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'both' },
      });
    }
    var beams = el('span', 'wheel-fx__fx wheel-fx__beams');
    beams.style.setProperty('--x', from.x + 'px');
    beams.style.setProperty('--y', from.y + 'px');
    pieces.push({
      node: beams,
      frames: [
        { opacity: 0, rotate: '0deg' },
        { opacity: 0.85, offset: 0.12 },
        { opacity: 0.6, offset: 0.5 },
        { opacity: 0, rotate: '70deg' },
      ],
      timing: { duration: 2600, easing: 'ease-out', fill: 'both' },
    });
    launch(pieces);
    shake(els.dialog, 12);
  }

  /** `count` fireworks going off across the screen, one after another, while the record's shown. */
  function fireworks(count) {
    for (var i = 0; i < count; i += 1) {
      window.setTimeout(function () {
        if (!els.dialog.open || els.reveal.hidden) {
          return;
        }
        var at = { x: between(0.12, 0.88) * window.innerWidth, y: between(0.12, 0.5) * window.innerHeight };
        confetti(36, at, TIER_COLORS.legendary, { stars: true, spread: Math.PI * 2, power: 0.5 });
        sound('pop');
      }, 900 + i * 430 + Math.random() * 160);
    }
  }

  // The exclusive the reveal shows: { format, family, seed }.
  var revealing = null;

  /**
   * The reveal overlay for `exclusive` (won or waiting): `fresh` plays the
   * whole entrance; otherwise it's just shown, ready to be pressed.
   */
  function showReveal(exclusive, fresh, options) {
    revealing = exclusive;
    var spec = MusicHub.vinyl.describe(exclusive.format);
    var glow = MusicHub.vinyl.glowColors(spec);
    els.dialog.style.setProperty('--record-glow', glow.glow);
    els.dialog.style.setProperty('--record-accent', glow.accent);

    els.revealRecord.textContent = '';
    var record = MusicHub.vinyl.render(spec, { seed: exclusive.seed });
    record.classList.add('vinyl--house');
    els.revealRecord.appendChild(record);
    MusicHub.vinyl.setPlaying(record, true);

    // The name, letter by letter.
    els.revealName.textContent = '';
    els.revealName.setAttribute('aria-label', exclusive.format);
    exclusive.format.split('').forEach(function (char, index) {
      var letter = el('span', 'wheel-reveal__letter', char === ' ' ? ' ' : char);
      letter.setAttribute('aria-hidden', 'true');
      letter.style.setProperty('--letter', index);
      els.revealName.appendChild(letter);
    });
    els.revealEyebrow.textContent = fresh ? 'Wheel Exclusive unlocked' : 'Wheel Exclusive';
    els.revealNote.hidden = true;
    els.revealDone.hidden = true;
    setPressable(exclusive);

    els.reveal.hidden = false;
    // Just the reveal, the wheel behind it out of the way: the modal only as tall as it needs.
    els.dialog.classList.add('wheel--revealing');
    els.reveal.classList.toggle('wheel-reveal--fresh', !!fresh);
    els.view.setAttribute('inert', '');
    els.reveal.classList.remove('wheel-reveal--in');
    void els.reveal.offsetWidth;
    els.reveal.classList.add('wheel-reveal--in');
    // Landed on by the full-screen artwork, it needs no entrance of its own.
    var landed = options && options.landed;
    if (fresh && !landed && record.animate && !reducedMotion()) {
      record.animate([
        { transform: 'scale(0.1) rotate(-540deg)', filter: 'brightness(4)', opacity: 0 },
        { transform: 'scale(1.18) rotate(20deg)', filter: 'brightness(1.6)', opacity: 1, offset: 0.65 },
        { transform: 'scale(0.96) rotate(-4deg)', filter: 'brightness(1.1)', offset: 0.85 },
        { transform: 'scale(1) rotate(0deg)', filter: 'brightness(1)' },
      ], { duration: 1300, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
    }
    if (!els.dialog.open) {
      els.dialog.showModal();
    }
    els.revealRecord.focus({ preventScroll: true });
  }

  /** The record as the button that presses `exclusive` on an album - or, with none, just a record. */
  function setPressable(exclusive) {
    var record = els.revealRecord;
    record.classList.toggle('wheel-reveal__record--pressable', !!exclusive);
    if (exclusive) {
      record.setAttribute('role', 'button');
      record.setAttribute('tabindex', '0');
      record.setAttribute('aria-label', 'Press ' + exclusive.format + ' on an album');
      record.setAttribute('title', 'Press it on an album');
    } else {
      ['role', 'tabindex', 'aria-label', 'title'].forEach(function (name) {
        record.removeAttribute(name);
      });
    }
  }

  function hideReveal() {
    if (els.reveal.hidden) {
      return;
    }
    MusicHub.vinyl.setPlaying(els.revealRecord, false);
    els.revealRecord.textContent = '';
    els.reveal.hidden = true;
    els.dialog.classList.remove('wheel--revealing');
    setPressable(null);
    els.view.removeAttribute('inert');
    els.dialog.style.removeProperty('--record-glow');
    els.dialog.style.removeProperty('--record-accent');
    revealing = null;
    render();
  }

  /** Out of the reveal, back on the wheel - the exclusive waits there if it wasn't pressed. */
  function backToWheel() {
    hideReveal();
    els.machine.focus();
  }

  /**
   * Presses a won exclusive onto an album from the album history, like the
   * Mystery Vinyl's - it goes into the collection with the album's cover
   * as its label. Resolves with the album, or null if none was picked (the
   * exclusive keeps waiting).
   */
  function pressExclusive(exclusive) {
    return MusicHub.unbox.pickAlbum({
      hint: 'Your ' + exclusive.format + ' is pressed for one of the albums in your album history - its cover goes on the sleeve and the record’s label.',
    }).then(function (album) {
      if (!album) {
        return null;
      }
      var pressed = wallet.updateWheel(function (wheel, state) {
        var index = wheel.exclusives.findIndex(function (waiting) {
          return waiting.format === exclusive.format && waiting.seed === exclusive.seed;
        });
        if (index === -1) {
          return false;
        }
        wheel.exclusives.splice(index, 1);
        state.vinyls.push({
          format: exclusive.format,
          family: exclusive.family || 'Wheel Exclusive',
          seed: exclusive.seed,
          unboxedAt: new Date().toISOString(),
          album: album,
        });
        return true;
      });
      render();
      return pressed ? album : null;
    });
  }

  function onRevealPress() {
    var exclusive = revealing;
    if (!exclusive || !els.revealRecord.classList.contains('wheel-reveal__record--pressable')) {
      return;
    }
    pressExclusive(exclusive).then(function (album) {
      if (!album) {
        els.revealRecord.focus();
        return;
      }
      setPressable(null);
      // Now with the album's cover on its label.
      var spec = MusicHub.vinyl.describe(exclusive.format);
      els.revealRecord.textContent = '';
      var record = MusicHub.vinyl.render(spec, { seed: exclusive.seed, imageUrl: album.imageUrl });
      els.revealRecord.appendChild(record);
      MusicHub.vinyl.setPlaying(record, true);
      if (record.animate && !reducedMotion()) {
        record.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
      }
      sound('good');
      els.revealEyebrow.textContent = 'Added to your collection';
      els.revealNote.textContent = 'Pressed for ' + album.name + ' — ' + album.artist;
      els.revealNote.hidden = false;
      // No entrance delays any more: the buttons are wanted straight away.
      els.reveal.classList.remove('wheel-reveal--fresh');
      els.revealDone.hidden = false;
      els.revealCollection.focus();
    });
  }

  /* -------------------------------------------------------------- render */

  /** How long until midnight, when the free spin comes back: "5h 04m 09s". */
  function countdown() {
    var now = new Date();
    var midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var seconds = Math.max(0, Math.ceil((midnight - now) / 1000));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor(seconds / 60) % 60;
    function pad(value) {
      return String(value).padStart(2, '0');
    }
    return (hours ? hours + 'h ' + pad(minutes) + 'm ' : minutes + 'm ') + pad(seconds % 60) + 's';
  }

  /**
   * The header's countdown, every second while the wheel is open - and the
   * whole wheel afresh once midnight has brought the free spin back.
   */
  function tick() {
    if (spinsLeft(wallet.wheel()).free !== els.status.hidden) {
      render();
      return;
    }
    if (!els.status.hidden) {
      els.timer.textContent = countdown();
    }
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  /** The spin button, the line under the wheel, the prizes still waiting and the navbar's dot. */
  function render() {
    var wheel = wallet.wheel();
    var left = spinsLeft(wheel);
    els.open.classList.toggle('navbar__wheel--ready', somethingWaiting(wheel));

    // The spins left - today's free one and the saved respins - in the
    // middle of the wheel, which is itself the button that spins it. Kept
    // up to date while the wheel is closed too: set only on opening, a
    // wheel with no spins would fade to grey (its filter's transition)
    // in front of the user, rather than open already greyed out.
    var count = (left.free ? 1 : 0) + left.respins;
    var canSpin = !spinning && !celebration && count > 0;
    els.count.textContent = String(count);
    els.countLabel.textContent = count === 1 ? 'spin' : 'spins';
    els.machine.setAttribute('aria-disabled', String(!canSpin));
    els.machine.setAttribute('aria-label', 'Spin the wheel - ' + plural(count, 'spin', 'spins') + ' left');
    // No spins left - and no win still showing on it: greyed out, out of reach.
    var empty = count < 1 && !spinning && !els.dialog.dataset.win;
    els.machine.classList.toggle('wheel__machine--empty', empty);
    els.machine.tabIndex = empty ? -1 : 0;
    els.close.disabled = spinning;
    if (!els.dialog.open) {
      return;
    }

    // Until the free spin comes back, a countdown in the header.
    els.status.hidden = left.free;
    els.timer.textContent = left.free ? '' : countdown();
    els.status.setAttribute('title', left.free ? '' : 'Next free spin at midnight');

    renderPrizesButton(wheel);
    renderClaims(wheel);
  }

  /* -------------------------------------------------------------- prizes */

  /** How many prizes wait: every Mystery Vinyl to unbox and exclusive to press. */
  function waitingCount(wheel) {
    return wheel.freeVinyls + wheel.exclusives.length;
  }

  // The count the gift button's badge showed last, so a new prize can pop it.
  var shownWaiting = null;

  /** The gift button in the header: how many prizes wait, on a badge. */
  function renderPrizesButton(wheel) {
    var count = waitingCount(wheel);
    els.prizesCount.hidden = count < 1;
    els.prizesNumber.textContent = count > 99 ? '99+' : String(count);
    els.prizesOpen.setAttribute('aria-label', count ? 'Your prizes - ' + count + ' waiting' : 'Your prizes');
    // Not mid-spin: the prize being spun for lands here once the wheel stops.
    els.prizesOpen.disabled = spinning;
    if (shownWaiting !== null && count > shownWaiting && els.prizesCount.animate && !reducedMotion()) {
      els.prizesCount.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(1.6)', offset: 0.35 },
        { transform: 'scale(1)' },
      ], { duration: 500, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.4)' });
    }
    shownWaiting = count;
  }

  /**
   * The prizes modal's list, as cards like the album history's: the
   * Mystery Vinyls to unbox, then every exclusive to press - those in the
   * history's gold, turning frame and all. The whole card is the button.
   */
  function renderClaims(wheel) {
    els.claims.textContent = '';
    if (wheel.freeVinyls > 0) {
      var box = el('div', 'mailer history-item__cover wheel-prize__mailer');
      box.setAttribute('aria-hidden', 'true');
      box.appendChild(el('span', 'mailer__lid'));
      var front = el('span', 'mailer__front');
      front.appendChild(el('span', 'mailer__tape'));
      front.appendChild(el('span', 'mailer__mark', '?'));
      box.appendChild(front);
      els.claims.appendChild(prizeCard({
        cover: box,
        title: plural(wheel.freeVinyls, 'Mystery Vinyl', 'Mystery Vinyls'),
        lines: ['Waiting to be unboxed', 'Free in the Store'],
        label: 'Unbox ' + plural(wheel.freeVinyls, 'Mystery Vinyl', 'Mystery Vinyls') + ' in the Store',
        onClick: function () {
          // Unboxed in the Store: both modals close onto it.
          afterClose = goToStore;
          els.prizes.close();
          close();
        },
      }));
    }
    wheel.exclusives.forEach(function (exclusive) {
      var thumb = el('div', 'history-item__cover wheel-prize__record vinyl-stage');
      thumb.setAttribute('aria-hidden', 'true');
      var record = MusicHub.vinyl.render(MusicHub.vinyl.describe(exclusive.format), { seed: exclusive.seed });
      record.classList.add('vinyl--house');
      MusicHub.vinyl.setPlaying(record, false);
      thumb.appendChild(record);
      var card = prizeCard({
        cover: thumb,
        title: exclusive.format,
        lines: ['Wheel Exclusive · waiting to be pressed', exclusive.wonAt ? 'Won ' + formatWonAt(exclusive.wonAt) : ''],
        label: 'Press ' + exclusive.format + ' on an album',
        onClick: function () {
          els.prizes.close();
          showReveal(exclusive, false);
        },
      });
      card.dataset.rarity = 'gold';
      els.claims.appendChild(card);
    });
    els.prizesEmpty.hidden = waitingCount(wheel) > 0;
  }

  /** "27 Sep 2026", when an exclusive was won. */
  function formatWonAt(iso) {
    var date = new Date(iso);
    return isNaN(date) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * One prize as an album history card (.history-item): its cover, a title
   * and a line or two, the whole card one button (the history's overlay
   * link), the foil sheen following the pointer.
   */
  function prizeCard(options) {
    var item = el('li', 'history-item wheel-prize');
    var button = el('button', 'history-item__link wheel-prize__button');
    button.type = 'button';
    button.setAttribute('aria-label', options.label);
    button.addEventListener('click', options.onClick);
    item.appendChild(button);
    item.appendChild(options.cover);
    var text = el('div', 'history-item__text');
    text.appendChild(el('p', 'history-item__title', options.title));
    if (options.lines[0]) {
      text.appendChild(el('p', 'history-item__artist', options.lines[0]));
    }
    if (options.lines[1]) {
      text.appendChild(el('p', 'history-item__date', options.lines[1]));
    }
    item.appendChild(text);
    item.addEventListener('pointermove', function (event) {
      var rect = item.getBoundingClientRect();
      item.style.setProperty('--foil-x', ((event.clientX - rect.left) / rect.width * 100) + '%');
      item.style.setProperty('--foil-y', ((event.clientY - rect.top) / rect.height * 100) + '%');
    });
    return item;
  }

  function openPrizes() {
    renderClaims(wallet.wheel());
    els.prizes.showModal();
    var first = els.claims.querySelector('button') || els.prizesClose;
    first.focus();
  }

  /* ------------------------------------------------------------ showcase */

  // The list is built once and kept: forty records are a lot to draw. Its
  // records are drawn while the wheel sits open, whenever the page is idle,
  // so the showcase is usually ready before it's asked for. If not, the
  // ones in view (about the first SHOWCASE_FIRST) are drawn on opening,
  // and the rest carry on after.
  var SHOWCASE_FIRST = 15;
  var showcaseItems = [];
  var showcaseFill = 0;
  var showcasePressed = null;
  // Whether the big record turns: the user can stop it (its pattern keeps
  // moving), and it stays that way from record to record until the page is left.
  var showcaseSpinning = true;

  function buildShowcase() {
    MusicHub.vinylCatalog.exclusives.forEach(function (exclusive, index) {
      var item = el('li');
      var button = el('button', 'wheel-showcase__item');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      var thumb = el('span', 'wheel-showcase__thumb vinyl-stage');
      button.appendChild(thumb);
      button.appendChild(el('span', 'wheel-showcase__item-name', exclusive.format));
      var check = el('span', 'wheel-showcase__check');
      check.setAttribute('aria-hidden', 'true');
      check.appendChild(wallet.checkSvg());
      button.appendChild(check);
      button.addEventListener('click', function () {
        selectShowcase(index);
      });
      item.appendChild(button);
      els.showcaseList.appendChild(item);
      showcaseItems.push({ exclusive: exclusive, button: button, thumb: thumb, check: check });
    });
    // The halos of the records scrolled out of the list's view wait.
    MusicHub.vinyl.pauseOffscreen(els.showcaseList.children, els.showcaseList);
  }

  /** An item's record, the first time it's needed. */
  function drawThumb(entry) {
    if (entry.thumb.firstChild) {
      return;
    }
    var record = MusicHub.vinyl.render(MusicHub.vinyl.describe(entry.exclusive.format), { seed: entry.exclusive.format });
    record.classList.add('vinyl--house');
    MusicHub.vinyl.setPlaying(record, false);
    entry.thumb.appendChild(record);
  }

  /**
   * The records not drawn yet, while the page has time between frames -
   * `soon`: on the showcase, so at least one every 100ms, idle or not.
   * Without idle callbacks, only then.
   */
  function fillShowcase(soon) {
    if (!window.requestIdleCallback && !soon) {
      return;
    }
    var idle = window.requestIdleCallback || function (callback) {
      return window.setTimeout(function () {
        callback({ timeRemaining: function () { return 0; } });
      }, 16);
    };
    var options = soon ? { timeout: 100 } : undefined;
    function next(deadline) {
      var waiting = showcaseItems.filter(function (entry) {
        return !entry.thumb.firstChild;
      });
      // At least one each time, even when the animations leave no idle time.
      for (var i = 0; i < waiting.length && (i === 0 || deadline.timeRemaining() > 4); i += 1) {
        drawThumb(waiting[i]);
      }
      showcaseFill = i < waiting.length ? idle(next, options) : 0;
    }
    stopFillingShowcase();
    showcaseFill = idle(next, options);
  }

  /** The showcase built, and its records drawn in the wheel's idle moments. */
  function prepareShowcase() {
    if (!showcaseItems.length) {
      buildShowcase();
    }
    fillShowcase(false);
  }

  function stopFillingShowcase() {
    if (showcaseFill) {
      (window.cancelIdleCallback || window.clearTimeout)(showcaseFill);
      showcaseFill = 0;
    }
  }

  /** Which ones are won, ticked - it may have changed since last time. */
  function refreshShowcase() {
    var formats = heldFormats();
    var count = 0;
    showcaseItems.forEach(function (entry) {
      var held = !!formats[entry.exclusive.format];
      count += held ? 1 : 0;
      entry.button.classList.toggle('wheel-showcase__item--held', held);
      entry.button.setAttribute('aria-label', entry.exclusive.format + (held ? ' (won)' : ' (not won yet)'));
      entry.check.hidden = !held;
    });
    els.showcaseCount.textContent = count + ' of ' + showcaseItems.length + ' won';
  }

  /**
   * The big record turning, or held still (.wheel-showcase--still in
   * style.css) - its pattern moving either way - and the button saying which.
   */
  function applyShowcaseSpin() {
    els.showcase.classList.toggle('wheel-showcase--still', !showcaseSpinning);
    var record = els.showcaseRecord.firstChild;
    if (record) {
      MusicHub.vinyl.setPlaying(record, true);
    }
    var label = showcaseSpinning ? 'Stop spinning' : 'Spin';
    els.showcaseSpin.setAttribute('aria-label', label);
    els.showcaseSpin.title = label;
  }

  function toggleShowcaseSpin() {
    showcaseSpinning = !showcaseSpinning;
    applyShowcaseSpin();
  }

  /** The big record at the top: the chosen exclusive, spinning and moving (unless stopped). */
  function selectShowcase(index) {
    var entry = showcaseItems[index];
    var exclusive = entry.exclusive;
    var spec = MusicHub.vinyl.describe(exclusive.format);
    var glow = MusicHub.vinyl.glowColors(spec);
    // Set on the dialog, the glow would restyle all forty records in the
    // list below it: the list keeps its own (style.css), and only the
    // chosen item there is given the record's.
    els.showcase.style.setProperty('--record-glow', glow.glow);
    els.showcase.style.setProperty('--record-accent', glow.accent);
    if (showcasePressed) {
      showcasePressed.setAttribute('aria-pressed', 'false');
      showcasePressed.style.removeProperty('--record-glow');
    }
    showcasePressed = entry.button;
    showcasePressed.setAttribute('aria-pressed', 'true');
    showcasePressed.style.setProperty('--record-glow', glow.glow);
    MusicHub.vinyl.setPlaying(els.showcaseRecord, false);
    els.showcaseRecord.textContent = '';
    var record = MusicHub.vinyl.render(spec, { seed: exclusive.format });
    record.classList.add('vinyl--house');
    els.showcaseRecord.appendChild(record);
    applyShowcaseSpin();
    if (record.animate && !reducedMotion()) {
      record.animate([
        { transform: 'scale(0.85) rotate(-40deg)', opacity: 0.3 },
        { transform: 'scale(1) rotate(0deg)', opacity: 1 },
      ], { duration: 450, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.1)' });
    }
    var held = isHeld(exclusive.format);
    els.showcaseState.textContent = held ? 'Won' : 'Not won yet';
    els.showcaseState.classList.toggle('wheel-showcase__state--held', held);
    els.showcaseName.textContent = exclusive.format;
    els.showcaseText.textContent = exclusive.text;
  }

  function openShowcase() {
    if (!showcaseItems.length) {
      buildShowcase();
    }
    refreshShowcase();
    showcaseItems.slice(0, SHOWCASE_FIRST).forEach(drawThumb);
    selectShowcase(0);
    els.showcase.showModal();
    els.showcaseList.scrollTop = 0;
    fillShowcase(true);
    showcaseItems[0].button.focus();
  }

  function closeShowcase() {
    // Back to the wheel: any records left carry on in its idle moments.
    if (els.dialog.open) {
      fillShowcase(false);
    } else {
      stopFillingShowcase();
    }
    MusicHub.vinyl.setPlaying(els.showcaseRecord, false);
    els.showcaseRecord.textContent = '';
  }

  /* ------------------------------------------------------- open & close */

  function open() {
    if (els.dialog.open) {
      return;
    }
    claimLeftover();
    resetCelebration();
    els.result.textContent = '';
    hideReveal();
    els.dialog.showModal();
    render();
    // Warms up the audio on this click, so the first tick isn't lost.
    wallet.audioContext();
    if (els.machine.getAttribute('aria-disabled') === 'false') {
      els.machine.focus();
    }
    statusTimer = window.setInterval(tick, 1000);
    prepareShowcase();
  }

  function close() {
    if (spinning) {
      return;
    }
    if (els.dialog.open) {
      els.dialog.close();
    }
  }

  /** The wheel's gone: stop the moving parts, then whatever the win left to do. */
  function onClosed() {
    window.clearInterval(statusTimer);
    stopFillingShowcase();
    // The celebration went with the wheel.
    celebration = null;
    // Whatever was won meanwhile, no pop for it when the wheel opens again.
    shownWaiting = null;
    hideReveal();
    resetCelebration();
    els.result.textContent = '';
    // Confetti still falling may finish; the overlay goes once it's empty.
    window.setTimeout(function () {
      if (!els.dialog.open && overlay && !sky.pieces.length) {
        hideFx();
      }
    }, 3200);
    var next = afterClose;
    afterClose = null;
    if (next) {
      next();
    } else {
      els.open.focus();
    }
    render();
  }

  /* ---------------------------------------------------------------- init */

  (function init() {
    els.open = document.getElementById('wheel-open');
    els.dialog = document.getElementById('wheel-dialog');
    if (!els.open || !els.dialog) {
      return;
    }
    els.view = document.getElementById('wheel-view');
    els.close = document.getElementById('wheel-close');
    els.machine = document.getElementById('wheel-machine');
    els.disc = document.getElementById('wheel-disc');
    els.frame = document.getElementById('wheel-frame');
    els.glow = document.getElementById('wheel-glow');
    els.glowSlice = els.glow.querySelector('path');
    els.pointer = document.getElementById('wheel-pointer');
    // The needle's band of light (SMIL, out of CSS's reach) stays parked with reduced motion.
    if (reducedMotion()) {
      Array.prototype.forEach.call(els.pointer.querySelectorAll('animateTransform'), function (node) {
        node.remove();
      });
    }
    els.banner = document.getElementById('wheel-banner');
    els.result = document.getElementById('wheel-result');
    els.status = document.getElementById('wheel-status');
    els.timer = document.getElementById('wheel-timer');
    els.claims = document.getElementById('wheel-claims');
    els.prizes = document.getElementById('wheel-prizes');
    els.prizesOpen = document.getElementById('wheel-prizes-open');
    els.prizesCount = document.getElementById('wheel-prizes-count');
    els.prizesNumber = document.getElementById('wheel-prizes-number');
    els.prizesClose = document.getElementById('wheel-prizes-close');
    els.prizesEmpty = document.getElementById('wheel-prizes-empty');
    els.count = document.getElementById('wheel-count');
    els.countLabel = document.getElementById('wheel-count-label');
    els.showcaseOpen = document.getElementById('wheel-showcase-open');
    els.reveal = document.getElementById('wheel-reveal');
    els.revealRecord = document.getElementById('wheel-reveal-record');
    els.revealEyebrow = document.getElementById('wheel-reveal-eyebrow');
    els.revealName = document.getElementById('wheel-reveal-name');
    els.revealNote = document.getElementById('wheel-reveal-note');
    els.revealDone = document.getElementById('wheel-reveal-done');
    els.revealBack = document.getElementById('wheel-reveal-back');
    els.revealCollection = document.getElementById('wheel-reveal-collection');
    els.showcase = document.getElementById('wheel-showcase');
    els.showcaseClose = document.getElementById('wheel-showcase-close');
    els.showcaseCount = document.getElementById('wheel-showcase-count');
    els.showcaseRecord = document.getElementById('wheel-showcase-record');
    els.showcaseSpin = document.getElementById('wheel-showcase-spin');
    els.showcaseState = document.getElementById('wheel-showcase-state');
    els.showcaseName = document.getElementById('wheel-showcase-name');
    els.showcaseText = document.getElementById('wheel-showcase-text');
    els.showcaseList = document.getElementById('wheel-showcase-list');

    drawWheel();
    drawFrame();
    setRotation(-(slices[0].size / 2));

    els.open.addEventListener('click', open);
    els.close.addEventListener('click', close);
    // The wheel is the spin button: a click, or Enter / Space on it.
    els.machine.addEventListener('click', spin);
    els.machine.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        spin();
      }
    });
    els.prizesOpen.addEventListener('click', openPrizes);
    els.prizesClose.addEventListener('click', function () {
      els.prizes.close();
    });
    els.prizes.addEventListener('close', function () {
      // Back on the wheel - unless a prize was taken: the reveal or the Store has the focus now.
      if (els.dialog.open && els.reveal.hidden) {
        els.prizesOpen.focus();
      }
    });
    els.showcaseOpen.addEventListener('click', openShowcase);
    els.showcaseSpin.addEventListener('click', toggleShowcaseSpin);
    els.showcaseRecord.addEventListener('click', toggleShowcaseSpin);
    els.showcaseClose.addEventListener('click', function () {
      els.showcase.close();
    });
    els.showcase.addEventListener('close', function () {
      closeShowcase();
      els.showcaseOpen.focus();
    });
    els.revealRecord.addEventListener('click', onRevealPress);
    els.revealRecord.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onRevealPress();
      }
    });
    els.revealBack.addEventListener('click', backToWheel);

    // No closing mid-spin; otherwise Escape - and a click outside the
    // wheel (navbar.js, by way of this) - closes it like the X. The
    // prizes and the showcase close on a click outside as they do on Escape.
    els.dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      close();
    });
    els.dialog.addEventListener('close', onClosed);

    claimLeftover();
    render();
  })();

  document.addEventListener('musichub:walletchange', function () {
    if (els.open) {
      render();
    }
  });
  // Midnight passing, or coming back to the tab after it: the dot comes back.
  document.addEventListener('visibilitychange', function () {
    if (els.open && !document.hidden) {
      render();
    }
  });
  window.setInterval(function () {
    if (els.open) {
      render();
    }
  }, 60000);

  MusicHub.dailyWheel = {
    open: open,
    PRIZES: PRIZES,
    // A peg knocking the flapper - for the Store's wheel turning too.
    tick: function () {
      sound('tick');
    },
  };
})(window.MusicHub);
