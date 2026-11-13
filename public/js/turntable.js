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
  var ARM_REST_DEG = 6;
  var ARM_PLAY_DEG = 28.5;
  // Built with `options.fromEdge`, the needle starts nearer the record's
  // rim instead (97% of the way out, to ARM_PLAY_DEG's 93%).
  var ARM_EDGE_DEG = 27;
  // As the album plays, the needle works its way in from the record's
  // edge (ARM_PLAY_DEG, or ARM_EDGE_DEG) to ARM_END_DEG, just short of the
  // label.
  var ARM_END_DEG = 46;
  // Following the album there, a small correction still slides over
  // rather than jumping; a skip with the track buttons lifts the needle
  // and carries it over at least this slowly.
  var ARM_GLIDE_MS = 250;
  var ARM_SKIP_MS = 450;
  // Moved by hand (setArmDraggable), the arm reaches from a little outside
  // its rest to just past the last groove.
  var ARM_DRAG_MIN_DEG = 0;
  var ARM_DRAG_MAX_DEG = ARM_END_DEG + 3;
  // The crackle of the needle dragged across the record: its loudness at
  // full speed, and the speed that's full (degrees of arm swing per ms).
  var CRACKLE_PEAK = 1;
  var CRACKLE_FULL_DEG_PER_MS = 0.06;
  // Moved by hand over the record, the needle is drawn onto the start of
  // each track (setTrackMarks): held right on it within SNAP_HOLD_PX of it
  // (of the needle's travel), and pulled towards it, less and less, out to
  // SNAP_PULL_PX - each kept to a share of the way to the next track's
  // start (SNAP_HOLD_SHARE, SNAP_PULL_SHARE), so short tracks stay
  // reachable.
  var SNAP_HOLD_PX = 5;
  var SNAP_PULL_PX = 14;
  var SNAP_HOLD_SHARE = 0.25;
  var SNAP_PULL_SHARE = 0.42;
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
  // The time played under the progress groove moves on this often; an
  // arrow key on the groove seeks this far.
  var TIME_TICK_MS = 250;
  var SEEK_KEY_MS = 5000;
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

  /**
   * The arm's tube, S-shaped like a real one: straight through the
   * bearing, bowed out away from the record, then bent back into the
   * headshell, nearly in line with it. Drawn over the arm's whole box - 10
   * units across, 74.14 down (the box is always 7.414 times as tall as
   * it's wide, style.css) - from inside the counterweight (y -4.45) to just
   * inside the headshell's top (5, 61.5). A dark edge, the
   * metal and a bright line down its middle, for a round tube.
   */
  function armRod() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 10 74.14');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'turntable__rod');
    svg.setAttribute('aria-hidden', 'true');
    ['edge', 'metal', 'shine'].forEach(function (layer) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M5 -4.45 L5 16 C5 24 8.2 27 8.2 36 C8.2 46 6.6 56.7 5 61.5');
      path.setAttribute('class', 'turntable__rod-' + layer);
      svg.appendChild(path);
    });
    return svg;
  }

  /**
   * The song's progress: a groove cut into the plinth under the record, a
   * glowing fill running along it (setProgress). The fill slides in from
   * the left inside a rounded window (translate - composited, and its
   * leading end stays round); the window's glow is a filter, so it lights
   * up round the fill alone. Under it, the time played and the song's
   * length, once setProgress knows the length. Made seekable
   * (setSeekable), it's a slider: clicked, dragged or moved with the arrow
   * keys, it hands the point picked to `options.onSeek`, and a mouse
   * over it shows a gray hint up to the point a click would go to.
   */
  function progressBar() {
    var bar = el('div', 'turntable__progress');
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', 'Song progress');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', '0');
    bar.setAttribute('aria-disabled', 'true');
    // Before the fill's window, so the fill is drawn over it.
    bar.appendChild(el('span', 'turntable__progress-hint'));
    var windowEl = el('span', 'turntable__progress-window');
    var fill = el('span', 'turntable__progress-fill');
    windowEl.appendChild(fill);
    bar.appendChild(windowEl);
    var times = el('div', 'turntable__times');
    times.setAttribute('aria-hidden', 'true');
    times.hidden = true;
    var played = el('span', 'turntable__time');
    var length = el('span', 'turntable__time');
    times.appendChild(played);
    times.appendChild(length);
    return { bar: bar, fill: fill, times: times, played: played, length: length };
  }

  /** `ms` as a clock: 3:07, or 1:02:45 past an hour. */
  function clock(ms) {
    var seconds = Math.max(0, Math.floor(ms / 1000));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor(seconds / 60) % 60;
    var rest = ('0' + (seconds % 60)).slice(-2);
    return hours ? hours + ':' + ('0' + minutes).slice(-2) + ':' + rest : minutes + ':' + rest;
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
   * while they can be used (the page disables them otherwise), either side
   * of the song's progress groove under the record (setProgress) - on a
   * plinth taller at the bottom to hold them (--plinth-grow, style.css).
   * `options.fromEdge`: the needle starts nearer the record's rim.
   * `options.onSeek`: called with the point of the song (0 to 1) picked
   * on the progress groove, while it's seekable (setSeekable).
   * `options.onArmDrop`: called when the arm, moved by hand by its
   * headshell (setArmDraggable), is let go - with how far through the
   * album the needle was put down (0 to 1), or null when it went back to
   * its rest. `options.onArmLift`: called as the arm's picked up.
   * `options.onArmMove`: called as it's moved, with how far through the
   * album the needle is over (0 to 1), or null while it's off the record.
   */
  function build(vinyl, options) {
    var o = options || {};
    var root = el('div', 'turntable');
    if (!o.powerButton) {
      root.setAttribute('aria-hidden', 'true');
    }
    var plinth = el('div', 'turntable__plinth');

    // The platter, with the spindle the record's hole drops over.
    var platter = el('div', 'turntable__platter');
    platter.appendChild(el('span', 'turntable__spindle'));
    plinth.appendChild(platter);

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
    var progress = null;
    if (o.trackButtons) {
      prev = skipButton(false);
      next = skipButton(true);
      progress = progressBar();
      plinth.appendChild(prev);
      plinth.appendChild(progress.bar);
      plinth.appendChild(progress.times);
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
    // Over the landed record, the spindle and the hole round it drawn as
    // one, so they're always centred on each other (style.css).
    var cap = el('span', 'turntable__cap');
    plinth.appendChild(cap);

    // The arm's mount, fixed to the plinth; the arm turns on its bearing,
    // the counterweight on the rod behind it.
    var mount = el('span', 'turntable__mount');
    plinth.appendChild(mount);
    var arm = el('div', 'turntable__arm');
    arm.appendChild(armRod());
    arm.appendChild(el('span', 'turntable__counterweight'));
    arm.appendChild(el('span', 'turntable__bearing'));
    // The headshell: its finger lift, the cartridge and the stylus at its
    // tip - the needle's point, at the headshell's bottom centre.
    var head = el('span', 'turntable__head');
    var stylus = el('span', 'turntable__stylus');
    head.appendChild(el('span', 'turntable__lift'));
    head.appendChild(el('span', 'turntable__cartridge'));
    head.appendChild(stylus);
    arm.appendChild(head);
    plinth.appendChild(arm);

    root.appendChild(plinth);
    var parts = {
      root: root, record: record, vinyl: vinyl, disc: record.querySelector('.vinyl__disc'), cap: cap,
      mount: mount, arm: arm, head: head, stylus: stylus, power: power, powerOn: powerOn, prev: prev, next: next,
      progressBar: progress && progress.bar, progressFill: progress && progress.fill,
      progressTimes: progress && progress.times, timePlayed: progress && progress.played,
      timeLength: progress && progress.length,
      // How far through its song the record is (setProgress), and the
      // timer moving the time played on. Whether the groove can be used
      // to seek (setSeekable), and where it's being dragged to (0 to 1,
      // null while it isn't).
      progress: null,
      timeTimer: 0,
      seekable: false,
      seekTo: null,
      // Whether it's switched on, and the animations running each part -
      // replaced, not piled up, each time it's switched.
      on: false,
      anims: {},
      // Where on the record the needle starts, how far through the album
      // it is (setNeedle), and when the arm's current swing is over
      // (performance.now() time).
      startDeg: o.fromEdge ? ARM_EDGE_DEG : ARM_PLAY_DEG,
      needle: null,
      armFreeAt: 0,
      needleTimer: 0,
      // The needle's touch-down still to come, on the audio clock (needleSound).
      pendingNeedle: null,
      // Whether the arm can be moved by hand (setArmDraggable), and the
      // drag going on (null while there's none).
      armDraggable: false,
      drag: null,
      // Where on the record each track starts (setTrackMarks), as
      // fractions of the album.
      trackMarks: [],
    };
    if (progress && o.onSeek) {
      wireSeeking(parts, o.onSeek);
    }
    if (o.onArmDrop) {
      wireArmDrag(parts, o);
    }
    return parts;
  }

  /* -------------------------------------------------- the arm by hand */

  /** The point `node` is centred on, on the screen. */
  function centre(node) {
    var rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 };
  }

  /** The angle (degrees, clockwise from the right) from `from` to `to`. */
  function angleTo(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
  }

  /** Whether the needle's point is over the record (its label included). */
  function needleOverRecord(parts) {
    var stylus = centre(parts.stylus);
    var record = centre(parts.vinyl);
    return Math.hypot(stylus.x - record.x, stylus.y - record.y) <= record.r;
  }

  /** How far through the album the needle is at `deg` - 0 out to where the album starts. */
  function fractionAt(parts, deg) {
    return Math.min(1, Math.max(0, (deg - parts.startDeg) / (ARM_END_DEG - parts.startDeg)));
  }

  /**
   * The head raised off the record (`up`) or lowered onto it, after `delay`
   * ms - held where it is while it waits ('both'): the animation it replaces
   * is already gone, and the head would otherwise snap to its resting size.
   */
  function moveHead(parts, up, delay) {
    var from = current(parts.head, 'scale', up ? 1 : 1.25);
    swap(parts, 'head', [
      parts.head.animate([{ scale: from }, { scale: up ? 1.25 : 1 }], {
        delay: delay || 0, duration: TIMING.lower, easing: up ? 'ease-out' : 'ease-in', fill: 'both',
      }),
    ]);
  }

  /** The arm swinging from `fromDeg` back to its rest, and the head lowered there. */
  function armToRest(parts, fromDeg) {
    var duration = Math.max(ARM_GLIDE_MS, swingMs(fromDeg, ARM_REST_DEG));
    parts.armFreeAt = performance.now() + duration;
    swap(parts, 'arm', [
      parts.arm.animate([{ rotate: fromDeg + 'deg' }, { rotate: ARM_REST_DEG + 'deg' }], {
        duration: duration, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both',
      }),
    ]);
    moveHead(parts, false, duration);
  }

  /**
   * The arm moved by hand, by its headshell: pressed, the head lifts and
   * the arm follows the pointer round its pivot - the needle crackling
   * while it's dragged across the record. Let go over the record, the
   * needle's lowered there and `o.onArmDrop` is told how far through the
   * album that is; let go anywhere else, the arm swings back to its rest
   * and it's told null. `o.onArmLift` and `o.onArmMove` (build) hear of
   * it being picked up and moved.
   */
  function wireArmDrag(parts, o) {
    var head = parts.head;
    var onDrop = o.onArmDrop;

    head.addEventListener('pointerdown', function (event) {
      if (!parts.armDraggable || parts.drag || event.button !== 0) {
        return;
      }
      event.preventDefault();
      head.setPointerCapture(event.pointerId);
      var deg = current(parts.arm, 'rotate', ARM_REST_DEG);
      window.clearTimeout(parts.needleTimer);
      // Held by the hand from here: the style, not an animation.
      swap(parts, 'arm', []);
      parts.arm.style.rotate = deg + 'deg';
      var pivot = centre(parts.mount);
      var stylus = centre(parts.stylus);
      parts.drag = {
        pivot: pivot, grabDeg: deg, grabAngle: angleTo(pivot, { x: event.clientX, y: event.clientY }),
        deg: deg, at: event.timeStamp, crackle: startCrackle(), over: undefined, mark: -1,
        // The degrees the arm turns for each px the needle travels.
        degPerPx: 180 / (Math.PI * Math.max(1, Math.hypot(stylus.x - pivot.x, stylus.y - pivot.y))),
      };
      parts.root.classList.add('turntable--arm-dragging');
      moveHead(parts, true, 0);
      if (o.onArmLift) {
        o.onArmLift();
      }
    });

    head.addEventListener('pointermove', function (event) {
      var drag = parts.drag;
      if (!drag || !head.hasPointerCapture(event.pointerId)) {
        return;
      }
      // Turned by as much as the pointer has gone round the pivot since
      // it took hold - the long way round never counts.
      var turned = angleTo(drag.pivot, { x: event.clientX, y: event.clientY }) - drag.grabAngle;
      turned = ((turned + 540) % 360) - 180;
      var deg = Math.min(ARM_DRAG_MAX_DEG, Math.max(ARM_DRAG_MIN_DEG, drag.grabDeg + turned));
      var snap = snapToTrack(parts, deg, drag.degPerPx);
      deg = snap.deg;
      // A soft tick as it settles onto a track's start.
      if (snap.mark !== drag.mark) {
        drag.mark = snap.mark;
        if (snap.mark !== -1) {
          snapSound();
        }
      }
      parts.arm.style.rotate = deg + 'deg';
      var speed = Math.abs(deg - drag.deg) / Math.max(1, event.timeStamp - drag.at);
      drag.deg = deg;
      drag.at = event.timeStamp;
      var onRecord = needleOverRecord(parts);
      crackle(drag.crackle, onRecord ? Math.min(1, speed / CRACKLE_FULL_DEG_PER_MS) : 0);
      var over = onRecord ? fractionAt(parts, deg) : null;
      if (over !== drag.over && o.onArmMove) {
        drag.over = over;
        o.onArmMove(over);
      }
    });

    // Let go, or taken away by the browser - put down where it is.
    head.addEventListener('pointerup', function () {
      endArmDrag(parts, onDrop, true);
    });
    head.addEventListener('pointercancel', function () {
      endArmDrag(parts, onDrop, true);
    });
    head.addEventListener('lostpointercapture', function () {
      endArmDrag(parts, onDrop, true);
    });
  }

  /**
   * The arm let go of (`commit`) - lowered onto the record or swung back
   * to its rest, and `onDrop` told which - or the drag called off, the arm
   * going back to where it was before: the album's place on the record
   * while it's switched on, else its rest.
   */
  function endArmDrag(parts, onDrop, commit) {
    var drag = parts.drag;
    if (!drag) {
      return;
    }
    parts.drag = null;
    stopCrackle(drag.crackle);
    parts.root.classList.remove('turntable--arm-dragging');
    var deg = drag.deg;
    var onRecord = commit && needleOverRecord(parts);
    // Held where it was let go by an animation, as everywhere else.
    swap(parts, 'arm', [
      parts.arm.animate([{ rotate: deg + 'deg' }, { rotate: deg + 'deg' }], { duration: 1, fill: 'forwards' }),
    ]);
    parts.arm.style.rotate = '';
    parts.armFreeAt = performance.now();

    if (onRecord) {
      moveHead(parts, false, 0);
      needleSound(parts, TIMING.lower / 1000);
      onDrop(fractionAt(parts, deg));
    } else if (commit || !parts.on) {
      armToRest(parts, deg);
      if (commit) {
        onDrop(null);
      }
    } else {
      followNeedle(parts, false, false);
      moveHead(parts, false, Math.max(0, parts.armFreeAt - performance.now()));
    }
  }

  /**
   * Where the arm, turned to `deg` by hand, goes: onto the start of the
   * nearest track if it's close enough (SNAP_HOLD_PX), drawn part of the
   * way towards it a little further out (SNAP_PULL_PX, eased so it never
   * jumps), else just where it was turned. Returns { deg, mark }: the
   * track it's held on (its index), or -1.
   */
  function snapToTrack(parts, deg, degPerPx) {
    var span = ARM_END_DEG - parts.startDeg;
    var marks = parts.trackMarks.map(function (fraction) {
      return parts.startDeg + span * fraction;
    });
    var nearest = -1;
    marks.forEach(function (markDeg, i) {
      if (nearest === -1 || Math.abs(deg - markDeg) < Math.abs(deg - marks[nearest])) {
        nearest = i;
      }
    });
    if (nearest === -1) {
      return { deg: deg, mark: -1 };
    }
    var markDeg = marks[nearest];
    var gap = Math.min(
      nearest > 0 ? markDeg - marks[nearest - 1] : Infinity,
      nearest < marks.length - 1 ? marks[nearest + 1] - markDeg : Infinity);
    var hold = Math.min(SNAP_HOLD_PX * degPerPx, gap * SNAP_HOLD_SHARE);
    var pull = Math.min(SNAP_PULL_PX * degPerPx, gap * SNAP_PULL_SHARE);
    var off = Math.abs(deg - markDeg);
    if (off <= hold) {
      return { deg: markDeg, mark: nearest };
    }
    if (off >= pull) {
      return { deg: deg, mark: -1 };
    }
    // From right on the mark at the hold's edge to right under the
    // pointer at the pull's, smoothly.
    var t = (off - hold) / (pull - hold);
    return { deg: markDeg + (deg - markDeg) * t * t * (3 - 2 * t), mark: -1 };
  }

  /**
   * Where on the record each track starts - fractions of the album (0 to
   * 1), the first track's 0 - for the needle moved by hand to settle onto.
   */
  function setTrackMarks(parts, fractions) {
    parts.trackMarks = fractions.slice();
  }

  /**
   * Lets the arm be moved by hand by its headshell, or stops it - a drag
   * going on is called off.
   */
  function setArmDraggable(parts, draggable) {
    parts.armDraggable = draggable;
    parts.root.classList.toggle('turntable--arm-draggable', draggable);
    if (!draggable && parts.drag) {
      endArmDrag(parts, null, false);
    }
  }

  /**
   * The progress groove as a slider, while it's seekable: a press on it
   * picks that point, a drag carries it along (the fill and the time
   * played following it), and letting go hands it to `onSeek` (0 to 1).
   * The arrow keys move it SEEK_KEY_MS at a time, Home and End to either
   * end of the song. A mouse over it (not dragging) shows the gray hint
   * up to the point a click would pick.
   */
  function wireSeeking(parts, onSeek) {
    var bar = parts.progressBar;

    function hint(event) {
      var show = event.pointerType === 'mouse' && parts.seekable && parts.seekTo === null && !!songLength(parts);
      bar.classList.toggle('turntable__progress--hinting', show);
      if (show) {
        var rect = bar.getBoundingClientRect();
        var fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        bar.style.setProperty('--progress-hint', (fraction * 100) + '%');
      }
    }

    function pick(event) {
      var rect = bar.getBoundingClientRect();
      parts.seekTo = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      drawProgress(parts, parts.seekTo, 0);
      showTime(parts, parts.seekTo);
    }

    function done(commit) {
      if (parts.seekTo === null) {
        return;
      }
      var fraction = parts.seekTo;
      parts.seekTo = null;
      bar.classList.remove('turntable__progress--seeking');
      var before = parts.progress;
      if (commit) {
        onSeek(fraction);
      }
      // Not taken up (or let go of elsewhere): back to where the song is.
      if (parts.progress === before) {
        redrawProgress(parts);
      }
    }

    bar.addEventListener('pointerdown', function (event) {
      if (!parts.seekable || event.button !== 0 || !songLength(parts)) {
        return;
      }
      event.preventDefault();
      bar.setPointerCapture(event.pointerId);
      bar.classList.add('turntable__progress--seeking');
      pick(event);
      hint(event);
    });
    bar.addEventListener('pointermove', function (event) {
      if (parts.seekTo !== null && bar.hasPointerCapture(event.pointerId)) {
        pick(event);
      }
      hint(event);
    });
    bar.addEventListener('pointerleave', function () {
      bar.classList.remove('turntable__progress--hinting');
    });
    bar.addEventListener('pointerup', function (event) {
      done(true);
      hint(event);
    });
    bar.addEventListener('pointercancel', function () {
      done(false);
    });
    bar.addEventListener('lostpointercapture', function () {
      done(true);
    });
    bar.addEventListener('keydown', function (event) {
      var lengthMs = songLength(parts);
      if (!parts.seekable || !lengthMs) {
        return;
      }
      var fraction = progressAt(parts, performance.now());
      var step = SEEK_KEY_MS / lengthMs;
      var keys = { ArrowRight: fraction + step, ArrowUp: fraction + step, ArrowLeft: fraction - step, ArrowDown: fraction - step, Home: 0, End: 1 };
      if (!(event.key in keys)) {
        return;
      }
      event.preventDefault();
      onSeek(Math.min(1, Math.max(0, keys[event.key])));
    });
  }

  /** The song's length in ms, as setProgress was told it - 0 when it wasn't. */
  function songLength(parts) {
    return (parts.progress && parts.progress.lengthMs) || 0;
  }

  /**
   * Switches the progress groove's seeking on or off - a slider the
   * pointer and the keyboard can use, or only a picture. Switched off
   * mid-drag, the drag is dropped.
   */
  function setSeekable(parts, seekable) {
    var bar = parts.progressBar;
    if (!bar) {
      return;
    }
    parts.seekable = seekable;
    bar.classList.toggle('turntable__progress--seekable', seekable);
    bar.setAttribute('aria-disabled', seekable ? 'false' : 'true');
    bar.tabIndex = seekable ? 0 : -1;
    if (!seekable && parts.seekTo !== null) {
      parts.seekTo = null;
      bar.classList.remove('turntable__progress--seeking');
      redrawProgress(parts);
    }
    if (!seekable) {
      bar.classList.remove('turntable__progress--hinting');
    }
  }

  /** Cancels the animations last started on `key` and keeps `animations` instead. */
  function swap(parts, key, animations) {
    (parts.anims[key] || []).forEach(function (animation) {
      animation.cancel();
    });
    parts.anims[key] = animations;
    // The head's lowering called off: so is the needle's touch-down with it.
    if (key === 'head') {
      cancelNeedleSound(parts);
    }
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
      return parts.startDeg;
    }
    var fraction = needle.fraction + needle.perMs * (time - needle.at);
    return parts.startDeg + (ARM_END_DEG - parts.startDeg) * Math.min(1, Math.max(0, fraction));
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
      var degPerMs = (ARM_END_DEG - parts.startDeg) * needle.perMs;
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
    // Held by hand, it goes where it's let go of.
    if (!parts.on || parts.drag) {
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
    var fromDeg = current(parts.arm, 'rotate', parts.startDeg);
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
      needleSound(parts, (delay + duration + TIMING.lower) / 1000);
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

  /** How far through the song the progress groove is at `time` (a performance.now() time), 0 to 1. */
  function progressAt(parts, time) {
    var progress = parts.progress;
    if (!progress) {
      return 0;
    }
    return Math.min(1, Math.max(0, progress.fraction + progress.perMs * (time - progress.at)));
  }

  /**
   * The song's progress in the groove: `fraction` of the way through it,
   * moving on by `perMs` of it each ms (0 while paused) - filling up to
   * the end on its own, linearly, until it's told otherwise. Null empties
   * it. With the song's length (`lengthMs`), the time played and the
   * length show under it, the time played moving on with it. While the
   * groove is being dragged, it's only taken note of. Only for a turntable
   * built with track buttons.
   */
  function setProgress(parts, fraction, perMs, lengthMs) {
    if (!parts.progressFill) {
      return;
    }
    var from = fraction === null ? 0 : Math.min(1, Math.max(0, fraction));
    var speed = fraction === null ? 0 : perMs || 0;
    parts.progress = { fraction: from, perMs: speed, at: performance.now(), lengthMs: fraction === null ? 0 : lengthMs || 0 };
    if (parts.seekTo === null) {
      redrawProgress(parts);
    }
  }

  /** The groove and the times under it, where setProgress last put them. */
  function redrawProgress(parts) {
    var progress = parts.progress;
    var lengthMs = songLength(parts);
    window.clearInterval(parts.timeTimer);
    parts.progressTimes.hidden = !lengthMs;
    if (!progress) {
      drawProgress(parts, 0, 0);
      return;
    }
    var from = progressAt(parts, performance.now());
    drawProgress(parts, from, progress.perMs);
    if (!lengthMs) {
      parts.progressBar.removeAttribute('aria-valuetext');
      return;
    }
    parts.timeLength.textContent = clock(lengthMs);
    showTime(parts, from);
    if (progress.perMs > 0) {
      parts.timeTimer = window.setInterval(function () {
        // Taken off the page: nothing left to tell.
        if (!parts.root.isConnected) {
          window.clearInterval(parts.timeTimer);
        } else if (parts.seekTo === null) {
          showTime(parts, progressAt(parts, performance.now()));
        }
      }, TIME_TICK_MS);
    }
  }

  /** The time played, at `fraction` of the way through the song. */
  function showTime(parts, fraction) {
    var lengthMs = songLength(parts);
    var played = clock(fraction * lengthMs);
    if (parts.timePlayed.textContent !== played) {
      parts.timePlayed.textContent = played;
      parts.progressBar.setAttribute('aria-valuetext', played + ' of ' + clock(lengthMs));
    }
  }

  /** The fill at `from` (0 to 1), moving on by `speed` of the song each ms. */
  function drawProgress(parts, from, speed) {
    parts.progressBar.setAttribute('aria-valuenow', String(Math.round(from * 100)));
    var start = { translate: ((from - 1) * 100) + '% 0' };
    if (speed > 0 && from < 1) {
      swap(parts, 'progress', [
        parts.progressFill.animate([start, { translate: '0% 0' }], {
          duration: (1 - from) / speed, easing: 'linear', fill: 'forwards',
        }),
      ]);
    } else {
      swap(parts, 'progress', [parts.progressFill.animate([start, start], { duration: 1, fill: 'forwards' })]);
    }
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

  /** Whether it's switched on - on the power button too (.turntable__power--on), for the styles. */
  function markOn(parts, on) {
    parts.on = on;
    parts.power.classList.toggle('turntable__power--on', on);
  }

  /** Straight to playing - arm on the record, power lit - with no motion. */
  function showPlaying(parts) {
    parts.arm.style.rotate = needleDeg(parts, performance.now()) + 'deg';
    parts.powerOn.style.opacity = '1';
    markOn(parts, true);
  }

  /**
   * Plays the set-up on `parts` (from build()). The record turns until
   * `options.spinUntil` ms from the start - or, left out, for good. With
   * `options.lifted` the record's already in sight where its drop starts
   * (the Collection's jukebox holds it there), so it doesn't fade in.
   */
  function play(parts, options) {
    var o = options || {};

    // Lowered from above straight down over the spindle - its hole
    // closing in on it as it falls, the spindle showing through it - and
    // settling flat on the platter with a small give. Landed at 60% of
    // the way through (playSounds).
    parts.record.animate([
      { transform: 'translateY(-14%) scale(1.3)', opacity: o.lifted ? 1 : 0, easing: 'linear' },
      { offset: 0.15, transform: 'translateY(-11.2%) scale(1.24)', opacity: 1, easing: 'cubic-bezier(0.45, 0, 0.9, 0.6)' },
      { offset: 0.6, transform: 'none', easing: 'ease-out' },
      { offset: 0.8, transform: 'scale(1.012)', easing: 'ease-in-out' },
      { transform: 'none', opacity: 1 },
    ], { duration: TIMING.drop, fill: 'backwards' });
    // Until it lands only the spindle under it shows, through its hole.
    parts.cap.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: TIMING.drop * 0.6, duration: 120, fill: 'backwards',
    });

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

    // The tonearm lifts off its rest, swings over raised, then lowers onto
    // the record.
    var armDeg = needleDeg(parts, performance.now() + TIMING.armFrom + TIMING.armSwing);
    swap(parts, 'arm', armOnto(parts, ARM_REST_DEG, armDeg, TIMING.armFrom, TIMING.armSwing));
    swap(parts, 'head', [
      parts.head.animate([{ scale: '1' }, { scale: '1.25' }], {
        delay: TIMING.armFrom - TIMING.lower, duration: TIMING.lower, easing: 'ease-out', fill: 'forwards',
      }),
      parts.head.animate([{ scale: '1.25' }, { scale: '1' }], {
        delay: TIMING.needleAt - TIMING.lower, duration: TIMING.lower, easing: 'ease-in', fill: 'forwards',
      }),
    ]);
    markOn(parts, true);
  }

  /**
   * Switches the turntable off or on, from wherever each part is right
   * now - so it can be switched mid-way through anything. Off: the light
   * goes out, the platter coasts to a stop and the arm lifts and swings
   * back to its rest. On: the light comes on, the platter spins up and the
   * arm swings over and lowers the needle. With `options.still` (reduced
   * motion) the arm and light just move there and the platter doesn't turn.
   * With `options.armMoved`, it's the arm moved by hand that switches it:
   * put down on the record (on) or back on its rest (off) - no press of
   * the power button, and the arm stays where it was put, only gliding on
   * to where the album has got to. While the arm is held by hand, it's
   * left where it is. Returns how many ms until the arm's swing is over
   * and its head lowered again - 0 when there was nothing to switch.
   */
  function setPower(parts, on, options) {
    if (parts.on === on) {
      return 0;
    }
    var armMoved = !!(options && options.armMoved);
    markOn(parts, on);
    // Off, the song stops where it is - the page's next look at Spotify
    // sets it going again once it's back on.
    if (!on && parts.progress) {
      setProgress(parts, progressAt(parts, performance.now()), 0, songLength(parts));
    }
    var still = !!(options && options.still);
    var time = still ? 0 : 1;
    if (parts.power.tagName === 'BUTTON') {
      parts.power.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    var discDeg = current(parts.disc, 'rotate', 0);
    var armDeg = current(parts.arm, 'rotate', ARM_REST_DEG);
    var headScale = current(parts.head, 'scale', 1);
    var light = current(parts.powerOn, 'opacity', on ? 0 : 1);

    if (!still && !armMoved) {
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
    if (parts.drag || (armMoved && !on)) {
      // Left to the hand, or already on its way to its rest.
    } else if (armMoved) {
      // Already down on the record: on from there to where the album is.
      var glideMs = still || Math.abs(needleDeg(parts, now) - armDeg) < 0.1 ? 0 : ARM_GLIDE_MS;
      swap(parts, 'arm', armOnto(parts, armDeg, needleDeg(parts, now + glideMs), 0, glideMs));
    } else if (on) {
      targetDeg = needleDeg(parts, now + (armDelay + armMs) * time);
      swap(parts, 'arm', armOnto(parts, armDeg, targetDeg, armDelay * time, armMs * time));
    } else {
      swap(parts, 'arm', [
        parts.arm.animate([{ rotate: armDeg + 'deg' }, { rotate: targetDeg + 'deg' }], {
          delay: armDelay * time, duration: armMs * time, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both',
        }),
      ]);
    }
    // Raised straight away, and lowered again once the arm is there: onto
    // the record, or onto its rest. Moved by hand, it's lifted and lowered
    // by the hand.
    var handled = armMoved || !!parts.drag;
    var settledMs = handled ? 0 : (armDelay + armMs + TIMING.lower) * time;
    if (!handled) {
      swap(parts, 'head', [
        parts.head.animate([{ scale: headScale }, { scale: 1.25 }], { duration: TIMING.lower * time, easing: 'ease-out', fill: 'forwards' }),
        parts.head.animate([{ scale: 1.25 }, { scale: 1 }], {
          delay: (armDelay + armMs) * time, duration: TIMING.lower * time, easing: 'ease-in', fill: 'forwards',
        }),
      ]);
    }

    if (still) {
      swap(parts, 'spin', []);
      return settledMs;
    }
    if (on) {
      swap(parts, 'spin', spinUp(parts, discDeg, 0));
      if (!handled) {
        needleSound(parts, (armDelay + armMs + TIMING.lower) / 1000);
      }
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
    if (!armMoved) {
      clickSound(0);
    }
    return settledMs;
  }

  /*
   * The set-up's sounds without the Album Suggester's echo and crackle:
   * the record landing, the power button's click and the needle going
   * down - the same as the Suggester's, timed on the audio clock from now.
   * Played through the wallet's audio context and limiter.
   */
  function tone(ctx, at, from, to, peak, decay, dest) {
    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(dest || MusicHub.wallet.audioOutput());
    osc.start(at);
    osc.stop(at + decay + 0.01);
  }

  function noise(ctx, at, type, frequency, q, peak, attack, decay, dest) {
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
    source.connect(filter).connect(gain).connect(dest || MusicHub.wallet.audioOutput());
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

  /** A soft, low tick: the needle settling onto a track's start. */
  function snapSound() {
    var ctx = audio();
    if (ctx) {
      var at = ctx.currentTime;
      tone(ctx, at, 220, 140, 0.07, 0.04);
      noise(ctx, at, 'lowpass', 1200, 0.7, 0.06, 0.0005, 0.008);
    }
  }

  /**
   * The needle touching down on `parts`' record, `inS` seconds from now -
   * called off (cancelNeedleSound) if the head's lowering is, so it's only
   * heard when the needle really gets there.
   */
  function needleSound(parts, inS) {
    cancelNeedleSound(parts);
    var ctx = audio();
    if (ctx) {
      var at = ctx.currentTime + inS;
      var out = ctx.createGain();
      out.connect(MusicHub.wallet.audioOutput());
      noise(ctx, at, 'highpass', 2500, 0.7, 0.35, 0.0005, 0.004, out);
      tone(ctx, at, 180, 120, 0.12, 0.05, out);
      parts.pendingNeedle = { ctx: ctx, out: out, at: at };
    }
  }

  /** Silences a needle touch-down on `parts` that's still to come; one already heard is left to ring out. */
  function cancelNeedleSound(parts) {
    var sound = parts.pendingNeedle;
    parts.pendingNeedle = null;
    if (sound && sound.ctx.currentTime < sound.at) {
      sound.out.disconnect();
    }
  }

  /*
   * The needle dragged across the record: the crackle of a well-played
   * record's surface - clicks scattered at random, most of them faint, now
   * and then a few in a quick cluster, and a louder pop here and there -
   * over a very faint hiss. It's never sped up or pitched: only as loud as
   * the arm's moving fast, and silent while it's still or off the record.
   */
  var crackleBuffers = new WeakMap();

  /** Seconds to the next of `perS` random events a second. */
  function nextEventS(perS) {
    return -Math.log(1 - Math.random()) / perS;
  }

  function crackleBuffer(ctx) {
    var buffer = crackleBuffers.get(ctx);
    if (buffer) {
      return buffer;
    }
    var rate = ctx.sampleRate;
    var length = Math.floor(rate * 4);
    buffer = ctx.createBuffer(1, length, rate);
    var data = buffer.getChannelData(0);

    // A click: a sharp edge `amp` high, either way up, dying away over
    // `tauS` - a few samples for a tick, a millisecond for a pop.
    function click(atS, amp, tauS) {
      var at = Math.floor(atS * rate);
      var decay = Math.exp(-1 / (tauS * rate));
      var value = Math.random() < 0.5 ? -amp : amp;
      for (var i = at; i < length && Math.abs(value) > 0.001; i += 1) {
        data[i] += value;
        value *= decay;
      }
    }

    var t;
    // The faint ticks: dozens a second, nearly all quiet (cubed).
    for (t = nextEventS(55); t < length / rate; t += nextEventS(55)) {
      click(t, 0.03 + 0.45 * Math.pow(Math.random(), 3), 0.00004 + Math.random() * 0.00012);
    }
    // The clusters: a few a second, 3 to 9 clicks within ~20ms.
    for (t = nextEventS(3); t < length / rate; t += nextEventS(3)) {
      var clicks = 3 + Math.floor(Math.random() * 7);
      var at = t;
      for (var c = 0; c < clicks; c += 1) {
        click(at, 0.08 + 0.35 * Math.pow(Math.random(), 2), 0.00006 + Math.random() * 0.00015);
        at += 0.0005 + Math.random() * 0.004;
      }
    }
    // The pops: one every second or so, louder and fuller.
    for (t = nextEventS(0.9); t < length / rate; t += nextEventS(0.9)) {
      click(t, 0.45 + 0.35 * Math.random(), 0.0004 + Math.random() * 0.0008);
    }
    // The hiss, barely there.
    for (var i = 0; i < length; i += 1) {
      data[i] += (Math.random() * 2 - 1) * 0.01;
    }
    // Faded in and out over a few ms where the loop joins, so it never clicks there.
    var fade = Math.floor(rate * 0.005);
    for (var f = 0; f < fade; f += 1) {
      data[f] *= f / fade;
      data[length - 1 - f] *= f / fade;
    }
    crackleBuffers.set(ctx, buffer);
    return buffer;
  }

  /** The crackle, started silent - null without sound. */
  function startCrackle() {
    var ctx = audio();
    if (!ctx) {
      return null;
    }
    var source = ctx.createBufferSource();
    source.buffer = crackleBuffer(ctx);
    source.loop = true;
    // Started somewhere new each time, so no two drags crackle the same.
    var offset = Math.random() * source.buffer.duration;
    // No thump under it, no fizz over it, and a little warmth in the
    // middle, like an old record's.
    var low = ctx.createBiquadFilter();
    low.type = 'highpass';
    low.frequency.value = 150;
    var warmth = ctx.createBiquadFilter();
    warmth.type = 'peaking';
    warmth.frequency.value = 1400;
    warmth.Q.value = 0.8;
    warmth.gain.value = 4;
    var high = ctx.createBiquadFilter();
    high.type = 'lowpass';
    high.frequency.value = 6000;
    high.Q.value = 0.6;
    var gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(low).connect(warmth).connect(high).connect(gain).connect(MusicHub.wallet.audioOutput());
    source.start(0, offset);
    return { ctx: ctx, source: source, gain: gain };
  }

  /** From where the crackle's loudness is now, on to `to`, settling with `tau` s. */
  function crackleTo(sound, to, at, tau) {
    var gain = sound.gain.gain;
    if (gain.cancelAndHoldAtTime) {
      gain.cancelAndHoldAtTime(at);
    } else {
      gain.cancelScheduledValues(at);
      gain.setValueAtTime(gain.value, at);
    }
    gain.setTargetAtTime(to, at, tau);
  }

  /**
   * The crackle at `level` (0 to 1) of its loudest for a moment, dying
   * away unless the next move keeps it up.
   */
  function crackle(sound, level) {
    if (!sound) {
      return;
    }
    var at = sound.ctx.currentTime;
    // Even a slow drag is heard (the square root); it carries on a moment
    // between moves, so a steady drag crackles steadily.
    crackleTo(sound, CRACKLE_PEAK * Math.sqrt(level), at, 0.02);
    sound.gain.gain.setTargetAtTime(0, at + 0.12, 0.08);
  }

  function stopCrackle(sound) {
    if (!sound) {
      return;
    }
    var at = sound.ctx.currentTime;
    crackleTo(sound, 0, at, 0.015);
    sound.source.stop(at + 0.15);
  }

  /**
   * The set-up's sounds: the record landing, the power button, the needle.
   * Called right after play(parts), so the needle's touch-down goes with
   * the head's lowering it started.
   */
  function playSounds(parts) {
    var ctx = audio();
    if (!ctx) {
      return;
    }
    var landAt = ctx.currentTime + (TIMING.drop * 0.6) / 1000;
    tone(ctx, landAt, 120, 60, 0.4, 0.18);
    noise(ctx, landAt, 'lowpass', 900, 0.7, 0.25, 0.001, 0.05);
    clickSound((TIMING.spinFrom - POWER_PRESS_MS / 2) / 1000);
    needleSound(parts, TIMING.needleAt / 1000);
  }

  /** The turntable taken away: no sound of it still to come. */
  function silence(parts) {
    cancelNeedleSound(parts);
  }

  MusicHub.turntable = {
    TIMING: TIMING,
    POWER_PRESS_MS: POWER_PRESS_MS,
    build: build,
    play: play,
    showPlaying: showPlaying,
    setPower: setPower,
    setNeedle: setNeedle,
    setProgress: setProgress,
    setSeekable: setSeekable,
    setArmDraggable: setArmDraggable,
    setTrackMarks: setTrackMarks,
    playSounds: playSounds,
    silence: silence,
  };
})(window.MusicHub);
