/*
 * The Daily Spin, on every page: a wheel of fortune behind the navbar's
 * wheel icon, free once a (local) day, plus any respins won on it - kept
 * for later, as many as the user likes. It pays out coins (flying up to
 * the balance once the wheel closes, like everywhere else), a Mystery
 * Vinyl (the Store's own unboxing, free) or one of ten wheel exclusives,
 * records nothing else in the app hands out (vinyl-catalog.js).
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

  // The spin: a little wind-back, then round and round, slowing down.
  var WIND_UP_MS = 380;
  var WIND_UP_DEGREES = 14;
  var SPIN_MS = 6200;
  var MIN_TURNS = 5;
  // The flapper, knocked by each peg: how hard (degrees per second), the
  // spring pulling it back and how much that's damped, and its furthest swing.
  var FLAP_KICK = 1250;
  var FLAP_STIFFNESS = 700;
  var FLAP_DAMPING = 34;
  var FLAP_MAX = 28;
  // How long a win shows before the wheel closes itself, by tier.
  var CLOSE_AFTER_MS = { none: 2600, common: 2300, good: 2400, rare: 3000, epic: 3800, jackpot: 4400 };

  var els = {};
  var rotation = 0;
  var spinning = false;
  // Run once the wheel is closed, e.g. the coins flying up to the balance.
  var afterClose = null;
  var closeTimer = null;
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

  function heldCount() {
    return MusicHub.vinylCatalog.exclusives.filter(function (exclusive) {
      return isHeld(exclusive.format);
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
        sfx.tone(ctx, at + index * 0.32, note[0], note[1], 0.12, 0.3, 'triangle');
      });
      var last = at + 0.96;
      for (var i = 0; i < 6; i += 1) {
        sfx.tone(ctx, last + i * 0.13, 330 - i * 4, 318 - i * 5, 0.11 - i * 0.012, 0.16, 'triangle');
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
      sfx.noise(ctx, at, 1.6, 'bandpass', 200, 2, 0.3, 1.4, 7000);
      sfx.tone(ctx, at, 180, 1400, 0.08, 1.6, 'sawtooth');
      sfx.tone(ctx, at, 270, 2100, 0.05, 1.6, 'triangle');
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

    var clip = svg('clipPath', { id: 'wheel-gold-clip' });
    clip.appendChild(svg('path', { d: slicePath(92, slice.start, slice.end) }));
    defs.appendChild(clip);

    // Turning about the middle of the slice, big enough to cover all of it.
    var centre = polar(56, (slice.start + slice.end) / 2);
    var reach = 60;
    var frame = svg('g', { 'clip-path': 'url(#wheel-gold-clip)' });
    var picture = svg('image', {
      href: canvas.toDataURL(),
      x: (centre.x - reach).toFixed(2), y: (centre.y - reach).toFixed(2),
      width: reach * 2, height: reach * 2, preserveAspectRatio: 'none',
    });
    picture.appendChild(svg('animateTransform', {
      attributeName: 'transform', type: 'rotate',
      from: '0 ' + centre.x.toFixed(2) + ' ' + centre.y.toFixed(2),
      to: '360 ' + centre.x.toFixed(2) + ' ' + centre.y.toFixed(2),
      dur: FRAME_TURN_S + 's', repeatCount: 'indefinite',
    }));
    frame.appendChild(picture);
    group.appendChild(frame);
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
    function sweep(id, stops, seconds, pass, reach) {
      var node = gradient(defs, id, 'linearGradient', alongSlice, stops);
      var from = (-reach * rim.x).toFixed(2) + ' ' + (-reach * rim.y).toFixed(2);
      var to = (reach * rim.x).toFixed(2) + ' ' + (reach * rim.y).toFixed(2);
      node.appendChild(svg('animateTransform', {
        attributeName: 'gradientTransform', type: 'translate',
        values: from + ';' + to + ';' + to, keyTimes: '0;' + pass + ';1', calcMode: 'spline', keySplines: '0.45 0 0.55 1;0 0 1 1',
        dur: seconds + 's', repeatCount: 'indefinite',
      }));
    }
    sweep('wheel-gold-glare', [
      [0.3, 'var(--rarity-gold-shine)', 0], [0.44, 'var(--rarity-gold-shine)', 0.85], [0.5, 'var(--rarity-gold-shine)', 1],
      [0.56, 'var(--rarity-gold-shine)', 0.85], [0.7, 'var(--rarity-gold-shine)', 0],
    ], 1.5, 0.65, 0.7);
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
        group.appendChild(svg('path', { d: slicePath(92, slice.start, slice.end), fill: 'url(#wheel-gold-glare)' }, { mixBlendMode: 'screen', stroke: 'none' }));
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
          flapSpeed = Math.min(flapSpeed + FLAP_KICK, FLAP_KICK * 1.5);
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
          flap = Math.min(FLAP_MAX, flap + flapSpeed * step);
          remaining -= step;
        }
        els.pointer.style.transform = 'rotate(' + (-flap).toFixed(2) + 'deg)';

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
    });
  }

  function clearHighlight() {
    els.slices.forEach(function (group) {
      group.classList.remove('wheel__slice--won', 'wheel__slice--dim');
    });
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
    if (overlay.hasAttribute('popover')) {
      // Re-shown every time, so it's the newest thing in the top layer.
      if (overlay.matches(':popover-open')) {
        overlay.hidePopover();
      }
      overlay.showPopover();
    }
    return overlay;
  }

  function hideFx() {
    if (overlay) {
      overlay.textContent = '';
      if (overlay.hasAttribute('popover') && overlay.matches(':popover-open')) {
        overlay.hidePopover();
      }
    }
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

  /**
   * `count` pieces of confetti bursting out of `from` ({x, y}) and falling
   * away under gravity, tumbling as they go. `options.stars`: sparkles
   * rather than paper.
   */
  function confetti(count, from, colors, options) {
    if (reducedMotion() || !document.body.animate) {
      return;
    }
    var layer = fxLayer();
    var power = (options && options.power) || 1;
    for (var i = 0; i < count; i += 1) {
      var piece = el('span', 'confetti' + (options && options.stars ? ' confetti--star' : i % 3 === 0 ? ' confetti--round' : ''));
      piece.style.setProperty('--confetti-color', colors[i % colors.length]);
      layer.appendChild(piece);
      var angle = (options && options.angle !== undefined ? options.angle : -Math.PI / 2) + (Math.random() - 0.5) * ((options && options.spread) || Math.PI * 1.6);
      var speed = between(320, 820) * power;
      var vx = Math.cos(angle) * speed;
      var vy = Math.sin(angle) * speed;
      var spin = between(-900, 900);
      var duration = between(1600, 2800);
      var frames = [];
      for (var f = 0; f <= 12; f += 1) {
        var t = f / 12 * duration / 1000;
        // Air drag slows it down, gravity pulls it down.
        var drag = (1 - Math.exp(-2.2 * t)) / 2.2;
        var x = from.x + vx * drag + Math.sin(t * 6 + i) * 12;
        var y = from.y + vy * drag + 520 * t * t * 0.5;
        frames.push({
          transform: 'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px) rotate(' + (spin * t).toFixed(0) + 'deg) rotateX(' + (spin * t * 1.7).toFixed(0) + 'deg)',
          opacity: f > 9 ? (12 - f) / 3 : 1,
        });
      }
      var animation = piece.animate(frames, { duration: duration, delay: Math.random() * 120, easing: 'linear', fill: 'both' });
      animation.onfinish = piece.remove.bind(piece);
    }
  }

  /** Coins raining down the whole screen, flipping as they fall. */
  function coinRain(count) {
    if (reducedMotion() || !document.body.animate) {
      return;
    }
    var layer = fxLayer();
    for (var i = 0; i < count; i += 1) {
      var coin = el('span', 'flying-coin wheel-fx__coin');
      coin.appendChild(wallet.coinSvg('flying-coin__face'));
      coin.style.setProperty('--flip-ms', Math.round(between(260, 520)) + 'ms');
      layer.appendChild(coin);
      var x = Math.random() * window.innerWidth;
      var drift = between(-60, 60);
      var scale = between(0.7, 1.5);
      var animation = coin.animate([
        { transform: 'translate(' + x.toFixed(0) + 'px, -40px) scale(' + scale.toFixed(2) + ')' },
        { transform: 'translate(' + (x + drift).toFixed(0) + 'px, ' + (window.innerHeight + 40) + 'px) scale(' + scale.toFixed(2) + ')' },
      ], { duration: between(1300, 2300), delay: Math.random() * 1500, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'both' });
      animation.onfinish = coin.remove.bind(coin);
    }
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
  function banner(text) {
    els.banner.textContent = text;
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
      note = 'Unbox it for free in the Store…';
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
        banner(tier === 'jackpot' ? 'Jackpot!' : 'Big win!');
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
      wallet.earn(coins, { from: els.open });
    }
  }

  /* ---------------------------------------------------------------- spin */

  function spin() {
    if (spinning) {
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
    window.clearTimeout(closeTimer);
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
   */
  function goToStore() {
    if (window.location.pathname !== '/store') {
      window.location.href = '/store';
    }
  }

  /** After the celebration: close by itself, or send the user to the Store. */
  function finishWin(prize, record, coins) {
    if (prize.kind === 'respins') {
      // Straight back to spinning, if they like.
      els.machine.focus();
      return;
    }
    var tier = record.coins && prize.kind !== 'coins' ? 'epic' : prize.tier;
    var from = centreOf(els.machine);
    afterClose = function () {
      if (coins) {
        wallet.earn(coins, { from: from });
      } else if (prize.kind === 'mystery') {
        goToStore();
      }
    };
    closeTimer = window.setTimeout(close, CLOSE_AFTER_MS[tier] || 2500);
  }

  /* ----------------------------------------------------------- exclusive */

  /**
   * A wheel exclusive: the wheel shakes as the light builds, the screen
   * bursts white, and the record rises out of a whirl of rainbow light,
   * its name spelling itself out.
   */
  function revealExclusive(prize, record) {
    var motion = !reducedMotion();
    highlight(prize);
    showResult(prize, record);
    els.dialog.classList.add('wheel--charging');
    sound('riser');
    return wait(motion ? 1600 : 200).then(function () {
      claim(record);
      spinning = false;
      sound('legendary');
      flash(1);
      resetCelebration();
      showReveal(record, true);
      var from = centreOf(els.revealRecord);
      var glow = MusicHub.vinyl.glowColors(MusicHub.vinyl.describe(record.format));
      confetti(90, from, [glow.glow, glow.accent, 'var(--color-text)', 'var(--rarity-gold-shine)'], { stars: true, spread: Math.PI * 2, power: 0.9 });
      confetti(120, { x: window.innerWidth / 2, y: window.innerHeight * 0.1 }, TIER_COLORS.legendary, { angle: Math.PI / 2, spread: Math.PI * 1.2, power: 0.5 });
      window.setTimeout(function () {
        confetti(60, { x: 0, y: window.innerHeight }, TIER_COLORS.legendary, { angle: -Math.PI / 3, spread: 0.7, power: 1.5 });
        confetti(60, { x: window.innerWidth, y: window.innerHeight }, TIER_COLORS.legendary, { angle: -Math.PI * 2 / 3, spread: 0.7, power: 1.5 });
      }, 500);
      render();
    });
  }

  // The exclusive the reveal shows: { format, family, seed }.
  var revealing = null;

  /**
   * The reveal overlay for `exclusive` (won or waiting): `fresh` plays the
   * whole entrance; otherwise it's just shown, ready to be pressed.
   */
  function showReveal(exclusive, fresh) {
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
    var held = heldCount();
    els.revealEyebrow.textContent = fresh ? 'Wheel Exclusive unlocked' : 'Wheel Exclusive';
    els.revealNote.textContent = held + ' of ' + MusicHub.vinylCatalog.exclusives.length + ' wheel exclusives won';
    els.revealActions.hidden = false;
    els.revealDone.hidden = true;

    els.reveal.hidden = false;
    els.reveal.classList.toggle('wheel-reveal--fresh', !!fresh);
    els.view.setAttribute('inert', '');
    els.reveal.classList.remove('wheel-reveal--in');
    void els.reveal.offsetWidth;
    els.reveal.classList.add('wheel-reveal--in');
    if (fresh && record.animate && !reducedMotion()) {
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
    els.revealPress.focus({ preventScroll: true });
  }

  function hideReveal() {
    if (els.reveal.hidden) {
      return;
    }
    MusicHub.vinyl.setPlaying(els.revealRecord, false);
    els.revealRecord.textContent = '';
    els.reveal.hidden = true;
    els.view.removeAttribute('inert');
    els.dialog.style.removeProperty('--record-glow');
    els.dialog.style.removeProperty('--record-accent');
    revealing = null;
    render();
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
    if (!exclusive) {
      return;
    }
    pressExclusive(exclusive).then(function (album) {
      if (!album) {
        els.revealPress.focus();
        return;
      }
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
      // No entrance delays any more: the buttons are wanted straight away.
      els.reveal.classList.remove('wheel-reveal--fresh');
      els.revealActions.hidden = true;
      els.revealDone.hidden = false;
      els.revealClose.focus();
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
    if (!els.dialog.open) {
      return;
    }

    // The spins left - today's free one and the saved respins - in the
    // middle of the wheel, which is itself the button that spins it.
    var count = (left.free ? 1 : 0) + left.respins;
    var canSpin = !spinning && count > 0;
    els.count.textContent = String(count);
    els.countLabel.textContent = count === 1 ? 'spin' : 'spins';
    els.machine.setAttribute('aria-disabled', String(!canSpin));
    els.machine.setAttribute('aria-label', 'Spin the wheel - ' + plural(count, 'spin', 'spins') + ' left');
    // No spins left - and no win still showing on it: greyed out, out of reach.
    var empty = count < 1 && !spinning && !els.dialog.dataset.win;
    els.machine.classList.toggle('wheel__machine--empty', empty);
    els.machine.tabIndex = empty ? -1 : 0;
    els.close.disabled = spinning;

    // Until the free spin comes back, a countdown in the header.
    els.status.hidden = left.free;
    els.timer.textContent = left.free ? '' : countdown();
    els.status.setAttribute('title', left.free ? '' : 'Next free spin at midnight');

    renderClaims(wheel);
  }

  /** Prizes won but not taken yet: a mystery vinyl to unbox, an exclusive to press. */
  function renderClaims(wheel) {
    els.claims.textContent = '';
    if (spinning) {
      return;
    }
    if (wheel.freeVinyls > 0) {
      els.claims.appendChild(claimRow(
        plural(wheel.freeVinyls, 'Mystery Vinyl', 'Mystery Vinyls') + ' waiting to be unboxed',
        'Unbox',
        function () {
          afterClose = goToStore;
          close();
        },
      ));
    }
    wheel.exclusives.forEach(function (exclusive) {
      els.claims.appendChild(claimRow(exclusive.format + ' waiting to be pressed', 'Press', function () {
        showReveal(exclusive, false);
      }, true));
    });
  }

  function claimRow(text, action, onClick, special) {
    var item = el('li', 'wheel__claim' + (special ? ' wheel__claim--exclusive' : ''));
    item.appendChild(el('span', 'wheel__claim-text', text));
    var button = el('button', 'button button--primary wheel__claim-button', action);
    button.type = 'button';
    button.addEventListener('click', onClick);
    item.appendChild(button);
    return item;
  }

  /* ------------------------------------------------------------ showcase */

  var showcaseRecords = [];

  function renderShowcase(selected) {
    var exclusives = MusicHub.vinylCatalog.exclusives;
    els.showcaseCount.textContent = heldCount() + ' of ' + exclusives.length + ' won · only ever on the Daily Spin';
    els.showcaseList.textContent = '';
    showcaseRecords = [];
    exclusives.forEach(function (exclusive, index) {
      var held = isHeld(exclusive.format);
      var item = el('li');
      var button = el('button', 'wheel-showcase__item' + (held ? ' wheel-showcase__item--held' : ''));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(index === selected));
      button.setAttribute('aria-label', exclusive.format + (held ? ' (won)' : ' (not won yet)'));
      var thumb = el('span', 'wheel-showcase__thumb vinyl-stage');
      var record = MusicHub.vinyl.render(MusicHub.vinyl.describe(exclusive.format), { seed: exclusive.format });
      record.classList.add('vinyl--house');
      MusicHub.vinyl.setPlaying(record, false);
      thumb.appendChild(record);
      button.appendChild(thumb);
      button.appendChild(el('span', 'wheel-showcase__item-name', exclusive.format));
      if (held) {
        var check = el('span', 'wheel-showcase__check', '✓');
        check.setAttribute('aria-hidden', 'true');
        button.appendChild(check);
      }
      button.addEventListener('click', function () {
        selectShowcase(index);
      });
      item.appendChild(button);
      els.showcaseList.appendChild(item);
      showcaseRecords.push(record);
    });
    selectShowcase(selected);
  }

  /** The big record at the top: the chosen exclusive, spinning and moving. */
  function selectShowcase(index) {
    var exclusive = MusicHub.vinylCatalog.exclusives[index];
    var spec = MusicHub.vinyl.describe(exclusive.format);
    var glow = MusicHub.vinyl.glowColors(spec);
    els.showcase.style.setProperty('--record-glow', glow.glow);
    els.showcase.style.setProperty('--record-accent', glow.accent);
    MusicHub.vinyl.setPlaying(els.showcaseRecord, false);
    els.showcaseRecord.textContent = '';
    var record = MusicHub.vinyl.render(spec, { seed: exclusive.format });
    record.classList.add('vinyl--house');
    els.showcaseRecord.appendChild(record);
    MusicHub.vinyl.setPlaying(record, true);
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
    Array.prototype.forEach.call(els.showcaseList.querySelectorAll('.wheel-showcase__item'), function (button, i) {
      button.setAttribute('aria-pressed', String(i === index));
    });
  }

  function openShowcase() {
    renderShowcase(0);
    els.showcase.showModal();
    var first = els.showcaseList.querySelector('button');
    if (first) {
      first.focus();
    }
  }

  function closeShowcase() {
    MusicHub.vinyl.setPlaying(els.showcaseRecord, false);
    els.showcaseRecord.textContent = '';
    els.showcaseList.textContent = '';
    showcaseRecords = [];
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
  }

  function close() {
    if (spinning) {
      return;
    }
    window.clearTimeout(closeTimer);
    if (els.dialog.open) {
      els.dialog.close();
    }
  }

  /** The wheel's gone: stop the moving parts, then whatever the win left to do. */
  function onClosed() {
    window.clearInterval(statusTimer);
    window.clearTimeout(closeTimer);
    hideReveal();
    resetCelebration();
    els.result.textContent = '';
    // Confetti still falling may finish; the overlay goes once it's empty.
    window.setTimeout(function () {
      if (!els.dialog.open && overlay && !overlay.querySelector('.confetti, .wheel-fx__coin')) {
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
    els.pointer = document.getElementById('wheel-pointer');
    els.banner = document.getElementById('wheel-banner');
    els.result = document.getElementById('wheel-result');
    els.status = document.getElementById('wheel-status');
    els.timer = document.getElementById('wheel-timer');
    els.claims = document.getElementById('wheel-claims');
    els.count = document.getElementById('wheel-count');
    els.countLabel = document.getElementById('wheel-count-label');
    els.showcaseOpen = document.getElementById('wheel-showcase-open');
    els.reveal = document.getElementById('wheel-reveal');
    els.revealRecord = document.getElementById('wheel-reveal-record');
    els.revealEyebrow = document.getElementById('wheel-reveal-eyebrow');
    els.revealName = document.getElementById('wheel-reveal-name');
    els.revealNote = document.getElementById('wheel-reveal-note');
    els.revealActions = document.getElementById('wheel-reveal-actions');
    els.revealDone = document.getElementById('wheel-reveal-done');
    els.revealPress = document.getElementById('wheel-reveal-press');
    els.revealLater = document.getElementById('wheel-reveal-later');
    els.revealClose = document.getElementById('wheel-reveal-close');
    els.showcase = document.getElementById('wheel-showcase');
    els.showcaseClose = document.getElementById('wheel-showcase-close');
    els.showcaseCount = document.getElementById('wheel-showcase-count');
    els.showcaseRecord = document.getElementById('wheel-showcase-record');
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
    els.showcaseOpen.addEventListener('click', openShowcase);
    els.showcaseClose.addEventListener('click', function () {
      els.showcase.close();
    });
    els.showcase.addEventListener('close', function () {
      closeShowcase();
      els.showcaseOpen.focus();
    });
    // A click on the backdrop (the dialog itself, outside its box) closes it.
    els.showcase.addEventListener('click', function (event) {
      if (event.target !== els.showcase) {
        return;
      }
      var rect = els.showcase.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        els.showcase.close();
      }
    });
    els.revealPress.addEventListener('click', onRevealPress);
    els.revealLater.addEventListener('click', hideReveal);
    els.revealClose.addEventListener('click', hideReveal);

    // No closing mid-spin; otherwise Escape closes like the X.
    els.dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      close();
    });
    els.dialog.addEventListener('close', onClosed);
    // A click on the backdrop (the dialog itself, outside its box) closes it too.
    els.dialog.addEventListener('click', function (event) {
      if (event.target !== els.dialog || spinning) {
        return;
      }
      var rect = els.dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        close();
      }
    });

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
  };
})(window.MusicHub);
