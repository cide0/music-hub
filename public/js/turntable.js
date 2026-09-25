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
  var ARM_PLAY_DEG = 38;
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

  /**
   * The turntable with `vinyl` (a record from vinyl.js render()) on it.
   * `options.rarity`: recolour it as polished metal in that Album
   * Suggester tier's colour (style.css); left out, the record keeps its
   * own look and glows in `options.glow`. `options.powerButton`: the power
   * button is a real button the page can switch it on and off with
   * (setPower); otherwise the whole turntable is only a picture.
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
      arm: arm, head: head, power: power, powerOn: powerOn,
      // Whether it's switched on, and the animations running each part -
      // replaced, not piled up, each time it's switched.
      on: false,
      anims: {},
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
    parts.arm.style.rotate = ARM_PLAY_DEG + 'deg';
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
    swap(parts, 'arm', [
      parts.arm.animate([{ rotate: ARM_REST_DEG + 'deg' }, { rotate: ARM_PLAY_DEG + 'deg' }], {
        delay: TIMING.armFrom, duration: TIMING.armSwing, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'forwards',
      }),
    ]);
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

    // The arm's swing takes as long as the share of the way it has to go.
    var targetDeg = on ? ARM_PLAY_DEG : ARM_REST_DEG;
    var swingMs = TIMING.armSwing * Math.abs(targetDeg - armDeg) / (ARM_PLAY_DEG - ARM_REST_DEG);
    var armDelay = on ? ARM_ON_DELAY_MS : TIMING.lower;
    swap(parts, 'arm', [
      // Held where it is while it waits ('both'): the animation it replaces
      // is already gone, and the arm would otherwise snap to its rest.
      parts.arm.animate([{ rotate: armDeg + 'deg' }, { rotate: targetDeg + 'deg' }], {
        delay: armDelay * time, duration: swingMs * time, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both',
      }),
    ]);
    // Raised straight away; on, lowered again once the arm is over the record.
    var head = [parts.head.animate([{ scale: headScale }, { scale: 1.25 }], { duration: TIMING.lower * time, easing: 'ease-out', fill: 'forwards' })];
    if (on) {
      head.push(parts.head.animate([{ scale: 1.25 }, { scale: 1 }], {
        delay: (armDelay + swingMs) * time, duration: TIMING.lower * time, easing: 'ease-in', fill: 'forwards',
      }));
    }
    swap(parts, 'head', head);

    if (still) {
      swap(parts, 'spin', []);
      return;
    }
    if (on) {
      swap(parts, 'spin', spinUp(parts, discDeg, 0));
      needleSound((armDelay + swingMs + TIMING.lower) / 1000);
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
    playSounds: playSounds,
  };
})(window.MusicHub);
