/*
 * The turntable: a record dropped onto the platter, the platter spinning
 * up with the power button lit, and the tonearm swinging in to lower the
 * needle. The Album Suggester plays it before every spin (and fades it out
 * over the reel); the Collection plays a vinyl on it, big, and leaves it
 * turning. Only transform and opacity animate - the browser runs those off
 * the main thread. Times in ms from the start.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var TIMING = {
    drop: 850,
    spinFrom: 700,
    armFrom: 1400,
    armSwing: 550,
    lower: 200,
    needleAt: 2150,
  };
  // The tonearm's angle resting beside the platter, and on the record.
  // ARM_REST_DEG is also the arm's resting rotate in style.css.
  var ARM_REST_DEG = 9;
  var ARM_PLAY_DEG = 35;
  // As the album plays, the needle works its way in from the record's
  // edge (ARM_PLAY_DEG) to ARM_END_DEG, just short of the label.
  var ARM_END_DEG = 50;
  // Following the album there, a small correction still slides over
  // rather than jumping; a skip with the track buttons lifts the needle
  // and carries it over at least this slowly.
  var ARM_GLIDE_MS = 250;
  var ARM_SKIP_MS = 450;
  var POWER_PRESS_MS = 240;
  // A record at 33 1/3 rpm turns once every 1.8s; the platter reaches that
  // over SPIN_UP_MS.
  var TURN_MS = 1800;
  var RECORD_DEG_PER_MS = 360 / TURN_MS;
  var SPIN_UP_MS = 500;
  // Switched off, the platter coasts to a stop over this long.
  var SPIN_DOWN_MS = 1400;
  // Switched on, the platter gets going before the arm swings over.
  var ARM_ON_DELAY_MS = 350;
  // An ease-out that starts at twice its average speed (easeOutQuad), so a
  // spin-down covering half the ground of a full-speed turn starts at
  // exactly full speed.
  var EASE_OUT_QUAD = 'cubic-bezier(0.5, 1, 0.89, 1)';

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  }

  function powerIcon(className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('class', className);
    var arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arc.setAttribute('d', 'M18.36 6.64a9 9 0 1 1-12.73 0');
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '2');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '12');
    svg.appendChild(arc);
    svg.appendChild(line);
    return svg;
  }

  /** A track button's icon: a triangle to the bar at the end of the way it skips. */
  function skipIcon(forward) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'turntable__skip-icon');
    svg.setAttribute('aria-hidden', 'true');
    var triangle = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    triangle.setAttribute('points', forward ? '5 4 16 12 5 20' : '19 4 8 12 19 20');
    triangle.setAttribute('fill', 'currentColor');
    var bar = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    bar.setAttribute('x1', forward ? '19' : '5');
    bar.setAttribute('y1', '5');
    bar.setAttribute('x2', forward ? '19' : '5');
    bar.setAttribute('y2', '19');
    bar.setAttribute('stroke', 'currentColor');
    bar.setAttribute('stroke-width', '2.5');
    bar.setAttribute('stroke-linecap', 'round');
    svg.appendChild(triangle);
    svg.appendChild(bar);
    return svg;
  }

  function skipButton(forward) {
    var button = el('button', 'turntable__skip turntable__skip--' + (forward ? 'next' : 'prev'));
    button.type = 'button';
    button.setAttribute('aria-label', forward ? 'Next track' : 'Previous track');
    button.appendChild(skipIcon(forward));
    return button;
  }

  /**
   * The turntable with `vinyl` (a record from vinyl.js render()) on it.
   * `options.rarity`: recolour it as polished metal in that Album
   * Suggester tier's colour (style.css); left out, the record keeps its
   * own look and glows in `options.glow`. `options.powerButton`: the power
   * button is a real button the page can switch it on and off with
   * (setPower); otherwise the whole turntable is only a picture.
   * `options.trackButtons`: previous and next track buttons too, lit
   * while they can be used (the page disables them otherwise).
   */
  function build(vinyl, options) {
    var o = options || {};
    var root = el('div', 'turntable');
    if (!o.powerButton) {
      root.setAttribute('aria-hidden', 'true');
    }
    var plinth = el('div', 'turntable__plinth');

    plinth.appendChild(el('div', 'turntable__platter'));

    // A round power button: the symbol dim while off, lit and glowing on.
    var power = el(o.powerButton ? 'button' : 'span', 'turntable__power');
    if (o.powerButton) {
      power.type = 'button';
      power.setAttribute('aria-label', 'Turntable power');
      power.setAttribute('aria-pressed', 'true');
    }
    var powerOn = el('span', 'turntable__power-on');
    power.appendChild(powerIcon('turntable__power-icon'));
    powerOn.appendChild(powerIcon('turntable__power-icon turntable__power-icon--on'));
    power.appendChild(powerOn);
    plinth.appendChild(power);

    var prev = null;
    var next = null;
    if (o.trackButtons) {
      prev = skipButton(false);
      next = skipButton(true);
      plinth.appendChild(prev);
      plinth.appendChild(next);
    }

    var record = el('div', 'turntable__record');
    if (o.rarity) {
      record.dataset.rarity = o.rarity;
    } else if (o.glow) {
      record.style.setProperty('--rarity', o.glow);
    }
    // A band of light sweeping across it, over the spinning disc.
    vinyl.appendChild(el('span', 'turntable__glint'));
    record.appendChild(vinyl);
    plinth.appendChild(record);

    var arm = el('div', 'turntable__arm');
    arm.appendChild(el('span', 'turntable__pivot'));
    arm.appendChild(el('span', 'turntable__rod'));
    var head = el('span', 'turntable__head');
    arm.appendChild(head);
    plinth.appendChild(arm);

    root.appendChild(plinth);
    return {
      root: root, record: record, disc: record.querySelector('.vinyl__disc'),
      arm: arm, head: head, power: power, powerOn: powerOn, prev: prev, next: next,
      // Whether it's switched on, and the animations running each part -
      // replaced, not piled up, each time it's switched.
      on: false,
      anims: {},
      // How far through the album it is (setNeedle), and when the arm's
      // current swing is over (performance.now() time).
      needle: null,
      armFreeAt: 0,
      needleTimer: 0,
    };
  }

  /** Cancels the animations last started on `key` and keeps `animations` instead. */
  function swap(parts, key, animations) {
    (parts.anims[key] || []).forEach(function (animation) {
      animation.cancel();
    });
    parts.anims[key] = animations;
  }

  /** Where a part is right now, mid-animation or not ('rotate' in degrees, or 'scale'). */
  function current(node, property, fallback) {
    var value = parseFloat(window.getComputedStyle(node)[property]);
    return isNaN(value) ? fallback : value;
  }

  /** How long the arm takes to swing from `fromDeg` to `toDeg`: its share of a full swing. */
  function swingMs(fromDeg, toDeg) {
    return TIMING.armSwing * Math.abs(toDeg - fromDeg) / (ARM_PLAY_DEG - ARM_REST_DEG);
  }

  /**
   * Where the arm puts the needle at `time` (a performance.now() time):
   * as far in from the record's edge as the album is through - the edge
   * itself until setNeedle says otherwise.
   */
  function needleDeg(parts, time) {
    var needle = parts.needle;
    if (!needle) {
      return ARM_PLAY_DEG;
    }
    var fraction = needle.fraction + needle.perMs * (time - needle.at);
    return ARM_PLAY_DEG + (ARM_END_DEG - ARM_PLAY_DEG) * Math.min(1, Math.max(0, fraction));
  }

  /**
   * The arm swinging from `fromDeg` onto the record at `toDeg`, after
   * `delay` ms and over `duration` ms - then, while the album plays,
   * creeping on inwards with it until it reaches the label. Held where it
   * is while it waits ('both'): the animation it replaces is already gone,
   * and the arm would otherwise snap to its rest.
   */
  function armOnto(parts, fromDeg, toDeg, delay, duration) {
    parts.armFreeAt = performance.now() + delay + duration;
    var animations = [
      parts.arm.animate([{ rotate: fromDeg + 'deg' }, { rotate: toDeg + 'deg' }], {
        delay: delay, duration: duration, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both',
      }),
    ];
    var needle = parts.needle;
    if (needle && needle.perMs > 0 && toDeg < ARM_END_DEG) {
      // Composited over the swing once it starts, where the swing ends.
      var degPerMs = (ARM_END_DEG - ARM_PLAY_DEG) * needle.perMs;
      animations.push(parts.arm.animate([{ rotate: toDeg + 'deg' }, { rotate: ARM_END_DEG + 'deg' }], {
        delay: delay + duration, duration: (ARM_END_DEG - toDeg) / degPerMs, easing: 'linear', fill: 'forwards',
      }));
    }
    return animations;
  }

  /**
   * The arm, switched on and over the record, moved on to where the album
   * has got to - once any swing it's in the middle of is over.
   */
  function followNeedle(parts, still, lift) {
    window.clearTimeout(parts.needleTimer);
    if (!parts.on) {
      return;
    }
    var now = performance.now();
    if (parts.armFreeAt > now) {
      parts.needleTimer = window.setTimeout(function () {
        followNeedle(parts, still, lift);
      }, parts.armFreeAt - now);
      return;
    }
    lift = lift && !still;
    var fromDeg = current(parts.arm, 'rotate', ARM_PLAY_DEG);
    var duration = still ? 0 : Math.max(lift ? ARM_SKIP_MS : ARM_GLIDE_MS, swingMs(fromDeg, needleDeg(parts, now)));
    // Lifted, it moves once the needle is up.
    var delay = lift ? TIMING.lower : 0;
    swap(parts, 'arm', armOnto(parts, fromDeg, needleDeg(parts, now + delay + duration), delay, duration));
    if (lift) {
      var headScale = current(parts.head, 'scale', 1);
      swap(parts, 'head', [
        parts.head.animate([{ scale: headScale }, { scale: 1.25 }], { duration: TIMING.lower, easing: 'ease-out', fill: 'forwards' }),
        parts.head.animate([{ scale: 1.25 }, { scale: 1 }], {
          delay: delay + duration, duration: TIMING.lower, easing: 'ease-in', fill: 'forwards',
        }),
      ]);
      needleSound((delay + duration + TIMING.lower) / 1000);
    }
  }

  /**
   * How far through its album the record is - `fraction` of the way,
   * moving on by `perMs` of it each ms (0 while paused) - for the arm to
   * follow inwards. Switched off, it's kept for when the arm next swings
   * over. `options.lift`: the needle is lifted, carried over and lowered
   * again, as for a skip to another track. `options.still` (reduced
   * motion): no glide or lift to get there.
   */
  function setNeedle(parts, fraction, perMs, options) {
    var o = options || {};
    parts.needle = { fraction: fraction, perMs: perMs, at: performance.now() };
    followNeedle(parts, !!o.still, !!o.lift);
  }

  /**
   * The platter starting up from `fromDeg`, after `delay` ms, and turning
   * on for good. A zoetrope turns on in steps of one frame slot, as it
   * does everywhere else, so its figures animate rather than whirl past.
   */
  function spinUp(parts, fromDeg, delay) {
    // The start-up's easing ends at twice its average speed, so it covers
    // half the ground a full-speed start would and meets the steady turn
    // exactly.
    var upDeg = fromDeg + (RECORD_DEG_PER_MS * SPIN_UP_MS) / 2;
    var zoetrope = !!parts.record.querySelector('.vinyl--zoetrope');
    return [
      parts.disc.animate([{ rotate: fromDeg + 'deg' }, { rotate: upDeg + 'deg' }], {
        delay: delay, duration: SPIN_UP_MS, easing: 'cubic-bezier(0.5, 0, 1, 1)', fill: 'forwards',
      }),
      parts.disc.animate([{ rotate: upDeg + 'deg' }, { rotate: (upDeg + 360) + 'deg' }], {
        delay: delay + SPIN_UP_MS,
        duration: zoetrope ? MusicHub.vinyl.ZOETROPE_TURN_MS : TURN_MS,
        iterations: Infinity,
        easing: zoetrope ? 'steps(' + MusicHub.vinyl.ZOETROPE_FRAMES + ', end)' : 'linear',
      }),
    ];
  }

  /** Straight to playing - arm on the record, power lit - with no motion. */
  function showPlaying(parts) {
    parts.arm.style.rotate = needleDeg(parts, performance.now()) + 'deg';
    parts.powerOn.style.opacity = '1';
    parts.on = true;
  }

  /**
   * Plays the set-up on `parts` (from build()). The record turns until
   * `options.spinUntil` ms from the start - or, left out, for good.
   */
  function play(parts, options) {
    var o = options || {};

    // Dropped in from above, with a small bounce as it lands.
    parts.record.animate([
      { transform: 'translateY(-75%) scale(1.12)', opacity: 0, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
      { offset: 0.6, transform: 'translateY(0) scale(0.98)', opacity: 1, easing: 'ease-out' },
      { offset: 0.8, transform: 'translateY(-2%) scale(1.01)', easing: 'ease-in' },
      { transform: 'none', opacity: 1 },
    ], { duration: TIMING.drop, fill: 'backwards' });

    // A short start-up to 33 1/3 rpm, then a steady speed. The start-up's
    // easing ends at twice its average speed, so it covers half the ground
    // a full-speed start would and meets the steady turn exactly.
    var startUpDeg = (RECORD_DEG_PER_MS * SPIN_UP_MS) / 2;
    if (o.spinUntil) {
      var spinMs = o.spinUntil - TIMING.spinFrom;
      parts.disc.animate([
        { rotate: '0deg', easing: 'cubic-bezier(0.5, 0, 1, 1)' },
        { offset: SPIN_UP_MS / spinMs, rotate: startUpDeg + 'deg', easing: 'linear' },
        { rotate: (startUpDeg + RECORD_DEG_PER_MS * (spinMs - SPIN_UP_MS)) + 'deg' },
      ], { delay: TIMING.spinFrom, duration: spinMs, fill: 'forwards' });
    } else {
      swap(parts, 'spin', spinUp(parts, 0, TIMING.spinFrom));
    }

    // The power button pressed in just as the platter starts, and lit.
    parts.power.animate([{ scale: '1' }, { scale: '0.86' }, { scale: '1' }], {
      delay: TIMING.spinFrom - POWER_PRESS_MS / 2, duration: POWER_PRESS_MS, easing: 'ease-out',
    });
    swap(parts, 'light', [
      parts.powerOn.animate([{ opacity: 0 }, { opacity: 1 }], { delay: TIMING.spinFrom, duration: 150, fill: 'forwards' }),
    ]);

    // The tonearm swings over raised, then lowers onto the record.
    var armDeg = needleDeg(parts, performance.now() + TIMING.armFrom + TIMING.armSwing);
    swap(parts, 'arm', armOnto(parts, ARM_REST_DEG, armDeg, TIMING.armFrom, TIMING.armSwing));
    swap(parts, 'head', [
      parts.head.animate([{ scale: '1.25' }, { scale: '1' }], {
        delay: TIMING.needleAt - TIMING.lower, duration: TIMING.lower, easing: 'ease-in', fill: 'both',
      }),
    ]);
    parts.on = true;
  }

  /**
   * Switches the turntable off or on, from wherever each part is right
   * now - so it can be switched mid-way through anything. Off: the light
   * goes out, the platter coasts to a stop and the arm lifts and swings
   * back to its rest. On: the light comes on, the platter spins up and the
   * arm swings over and lowers the needle. With `options.still` (reduced
   * motion) the arm and light just move there and the platter doesn't turn.
   */
  function setPower(parts, on, options) {
    if (parts.on === on) {
      return;
    }
    parts.on = on;
    var still = !!(options && options.still);
    var time = still ? 0 : 1;
    if (parts.power.tagName === 'BUTTON') {
      parts.power.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    var discDeg = current(parts.disc, 'rotate', 0);
    var armDeg = current(parts.arm, 'rotate', ARM_REST_DEG);
    var headScale = current(parts.head, 'scale', 1);
    var light = current(parts.powerOn, 'opacity', on ? 0 : 1);

    if (!still) {
      parts.power.animate([{ scale: '1' }, { scale: '0.86' }, { scale: '1' }], {
        duration: POWER_PRESS_MS, easing: 'ease-out',
      });
    }
    swap(parts, 'light', [
      parts.powerOn.animate([{ opacity: light }, { opacity: on ? 1 : 0 }], { duration: 150 * time, fill: 'forwards' }),
    ]);

    // The arm's swing takes as long as the share of the way it has to go:
    // on, to where the album has got to on the record.
    var armDelay = on ? ARM_ON_DELAY_MS : TIMING.lower;
    var now = performance.now();
    var targetDeg = on ? needleDeg(parts, now + armDelay) : ARM_REST_DEG;
    var armMs = swingMs(armDeg, targetDeg);
    window.clearTimeout(parts.needleTimer);
    if (on) {
      targetDeg = needleDeg(parts, now + (armDelay + armMs) * time);
      swap(parts, 'arm', armOnto(parts, armDeg, targetDeg, armDelay * time, armMs * time));
    } else {
      swap(parts, 'arm', [
        parts.arm.animate([{ rotate: armDeg + 'deg' }, { rotate: targetDeg + 'deg' }], {
          delay: armDelay * time, duration: armMs * time, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both',
        }),
      ]);
    }
    // Raised straight away; on, lowered again once the arm is over the record.
    var head = [parts.head.animate([{ scale: headScale }, { scale: 1.25 }], { duration: TIMING.lower * time, easing: 'ease-out', fill: 'forwards' })];
    if (on) {
      head.push(parts.head.animate([{ scale: 1.25 }, { scale: 1 }], {
        delay: (armDelay + armMs) * time, duration: TIMING.lower * time, easing: 'ease-in', fill: 'forwards',
      }));
    }
    swap(parts, 'head', head);

    if (still) {
      swap(parts, 'spin', []);
      return;
    }
    if (on) {
      swap(parts, 'spin', spinUp(parts, discDeg, 0));
      needleSound((armDelay + armMs + TIMING.lower) / 1000);
    } else {
      // Only a platter that has got going coasts; one still waiting to
      // start just stays where it is.
      var turning = (parts.anims.spin || []).some(function (animation) {
        return animation.effect.getComputedTiming().progress !== null;
      });
      var coastDeg = turning ? (RECORD_DEG_PER_MS * SPIN_DOWN_MS) / 2 : 0;
      swap(parts, 'spin', [
        parts.disc.animate([{ rotate: discDeg + 'deg' }, { rotate: (discDeg + coastDeg) + 'deg' }], {
          duration: turning ? SPIN_DOWN_MS : 1, easing: EASE_OUT_QUAD, fill: 'forwards',
        }),
      ]);
    }
    clickSound(0);
  }

  /*
   * The set-up's sounds without the Album Suggester's echo and crackle:
   * the record landing, the power button's click and the needle going
   * down - the same as the Suggester's, timed on the audio clock from now.
   * Played through the wallet's audio context and limiter.
   */
  function tone(ctx, at, from, to, peak, decay) {
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(MusicHub.wallet.audioOutput());
    osc.start(at);
    osc.stop(at + decay + 0.01);
  }

  function noise(ctx, at, type, frequency, q, peak, attack, decay) {
    var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    source.connect(filter).connect(gain).connect(MusicHub.wallet.audioOutput());
    source.start(at);
    source.stop(at + attack + decay + 0.01);
  }

  function audio() {
    return MusicHub.wallet && MusicHub.wallet.audioContext();
  }

  /** The power button's click, `inS` seconds from now. */
  function clickSound(inS) {
    var ctx = audio();
    if (ctx) {
      noise(ctx, ctx.currentTime + inS, 'bandpass', 1800, 2, 0.25, 0.0005, 0.006);
    }
  }

  /** The needle touching down, `inS` seconds from now. */
  function needleSound(inS) {
    var ctx = audio();
    if (ctx) {
      var at = ctx.currentTime + inS;
      noise(ctx, at, 'highpass', 2500, 0.7, 0.35, 0.0005, 0.004);
      tone(ctx, at, 180, 120, 0.12, 0.05);
    }
  }

  /** The set-up's sounds: the record landing, the power button, the needle. */
  function playSounds() {
    var ctx = audio();
    if (!ctx) {
      return;
    }
    var landAt = ctx.currentTime + (TIMING.drop * 0.6) / 1000;
    tone(ctx, landAt, 120, 60, 0.4, 0.18);
    noise(ctx, landAt, 'lowpass', 900, 0.7, 0.25, 0.001, 0.05);
    clickSound((TIMING.spinFrom - POWER_PRESS_MS / 2) / 1000);
    needleSound(TIMING.needleAt / 1000);
  }

  MusicHub.turntable = {
    TIMING: TIMING,
    POWER_PRESS_MS: POWER_PRESS_MS,
    build: build,
    play: play,
    showPlaying: showPlaying,
    setPower: setPower,
    setNeedle: setNeedle,
    playSounds: playSounds,
  };
})(window.MusicHub);
