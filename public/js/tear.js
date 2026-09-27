/*
 * Tearing something in two, with the sound of paper ripping: the Album
 * Suggester's dismissed cover, and a vinyl removed from the Collection.
 * Styled by .cover-tear in style.css.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // When each stage starts: two tugs, the rip from the top down, then the
  // halves falling for the rest of TEAR_MS, fading over its last stretch.
  var TEAR_TUG_MS = [140, 360];
  var TEAR_RIP_MS = 530;
  var TEAR_FALL_MS = 1000;
  var TEAR_MS = 1600;
  var TEAR_FADE_MS = 300;
  // Tear-line points, top to bottom; each strays this share of the width off centre.
  var TEAR_STEPS = 12;
  var TEAR_JITTER = 0.14;
  // How far the pieces' clip reaches past the edges, so a glow tears too.
  var TEAR_MARGIN_PX = 100;

  /** A jagged line from the top to the bottom, near the middle. */
  function tearLine(width, height) {
    var points = [];
    for (var i = 0; i <= TEAR_STEPS; i += 1) {
      points.push([
        width / 2 + (Math.random() - 0.5) * width * TEAR_JITTER,
        height * i / TEAR_STEPS,
      ]);
    }
    return points;
  }

  /** Paper tearing, in step with the animation: a few fibres at each tug, then the rip. */
  function playTear(ctx) {
    if (!ctx) {
      return;
    }
    var start = ctx.currentTime + 0.01;
    tearSound(ctx, start + TEAR_TUG_MS[0] / 1000, 0.06, 0.4);
    tearSound(ctx, start + TEAR_TUG_MS[1] / 1000, 0.09, 0.6);
    tearSound(ctx, start + TEAR_RIP_MS / 1000, (TEAR_FALL_MS - TEAR_RIP_MS) / 1000 + 0.05, 1);
  }

  // How fast the rip runs, 0-1: the slow, sparse crackle of a tear running
  // out, rather than a fast zip. Packs the clicks tighter as it goes up.
  var TEAR_SPEED = 0.55;
  // A fixed scale rather than normalising each sound, so the loudest click
  // lands at a steady level whatever the random run of clicks.
  var TEAR_CLICK_SCALE = 1.8;

  /**
   * Tearing paper isn't hiss: it's fibres snapping one after another - an
   * uneven run of tiny clicks, bunched into a rough "rrr" as the paper
   * catches and lets go. `level` scales how loud it is.
   */
  function tearSound(ctx, at, length, level) {
    var rate = ctx.sampleRate;
    var data = new Float32Array(Math.ceil(rate * (length + 0.01)));
    // The catch-and-release rate behind the "rrr".
    var catchHz = 28 + Math.random() * 16;
    var phase = Math.random() * Math.PI * 2;
    var t = 0;
    while (t < length) {
      var progress = t / length;
      // Eases in and out, so it neither starts nor stops on a hard edge.
      var envelope = Math.min(1, progress / 0.05, (1 - progress) / 0.15);
      var rough = 0.5 + 0.5 * Math.sin(Math.PI * 2 * catchHz * t + phase);
      // Most fibres go faintly, a few with a sharp snap.
      var amp = Math.pow(Math.random(), 2.2) * (0.3 + 0.7 * rough) * envelope;
      addClick(data, Math.floor(t * rate), amp * TEAR_CLICK_SCALE, rate);
      var gap = 0.0003 + (1 - TEAR_SPEED) * 0.003 + (1 - rough) * 0.0012;
      t += gap * (0.3 + Math.random() * 1.4);
    }

    var buffer = ctx.createBuffer(1, data.length, rate);
    buffer.getChannelData(0).set(data);

    var source = ctx.createBufferSource();
    source.buffer = buffer;
    // No rumble; then a crisp band for the snapping and a lower one for the
    // papery body of the rip.
    var highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 250;
    var crisp = ctx.createBiquadFilter();
    crisp.type = 'bandpass';
    crisp.frequency.value = 3200;
    crisp.Q.value = 0.7;
    var body = ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 1100;
    body.Q.value = 1.4;
    var bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.6;
    var gain = ctx.createGain();
    gain.gain.value = 1.4 * level;
    source.connect(highpass);
    highpass.connect(crisp).connect(gain);
    highpass.connect(body).connect(bodyGain).connect(gain);
    // Straight out, past any echo or limiter: paper mustn't ring like metal.
    gain.connect(ctx.destination);
    source.start(at);
  }

  /** One fibre snapping: a fraction of a millisecond of noise, dying away fast. */
  function addClick(data, at, amp, rate) {
    var length = Math.floor(rate * (0.00015 + Math.random() * 0.0006));
    for (var k = 0; k < length && at + k < data.length; k += 1) {
      data[at + k] += (Math.random() * 2 - 1) * amp * Math.exp(-4 * k / length);
    }
  }

  /** One side of the torn thing, from the tear line out past its edge. */
  function tearClip(line, height, edgeX) {
    var m = TEAR_MARGIN_PX;
    var first = line[0];
    var last = line[line.length - 1];
    var points = [[edgeX, -m], [first[0], -m]]
      .concat(line)
      .concat([[last[0], height + m], [edgeX, height + m]]);
    return 'polygon(' + points.map(function (point) {
      return point[0] + 'px ' + point[1] + 'px';
    }).join(', ') + ')';
  }

  /**
   * Tears `node` in two: the halves tug, rip apart from the top down and
   * fall away. Two copies of it sit over it, each clipped to one side of a
   * jagged line, while the real one hides - shown again once they're gone,
   * so take it out first if it's to go. `options.audioContext`, a function,
   * gives the context the sound plays in (the wallet's by default).
   * Resolves once the pieces are gone - straight away, and silently, with
   * reduced motion or nothing on screen to tear.
   */
  function apart(node, options) {
    var rect = node.getBoundingClientRect();
    if (reducedMotion() || !rect.width || !node.animate) {
      return Promise.resolve();
    }

    var width = rect.width;
    var height = rect.height;
    var line = tearLine(width, height);
    var pivot = line[line.length - 1][0] + 'px ' + height + 'px';

    var tear = document.createElement('div');
    tear.className = 'cover-tear';
    tear.setAttribute('aria-hidden', 'true');
    tear.style.left = rect.left + 'px';
    tear.style.top = rect.top + 'px';
    tear.style.width = width + 'px';
    tear.style.height = height + 'px';

    // Left piece first, then the right one mirrored - not quite exactly, so
    // the two don't fall like a pair of doors.
    var sides = [
      { edgeX: -TEAR_MARGIN_PX, dir: -1, spin: 60, drift: '-55%', drop: '280%' },
      { edgeX: width + TEAR_MARGIN_PX, dir: 1, spin: 48, drift: '46%', drop: '310%' },
    ];
    var pieces = sides.map(function (side) {
      var piece = node.cloneNode(true);
      piece.removeAttribute('id');
      piece.classList.add('cover-tear__piece');
      piece.style.width = width + 'px';
      piece.style.height = height + 'px';
      piece.style.clipPath = tearClip(line, height, side.edgeX);
      piece.style.transformOrigin = pivot;
      tear.appendChild(piece);
      return { node: piece, side: side };
    });
    document.body.appendChild(tear);
    // A copied record's shape animations start up again: held like the real one's.
    var drawings = node.querySelectorAll('svg');
    pieces.forEach(function (piece) {
      Array.prototype.forEach.call(piece.node.querySelectorAll('svg'), function (svg, i) {
        if (drawings[i].animationsPaused && drawings[i].animationsPaused()) {
          svg.pauseAnimations();
        }
      });
    });
    node.style.visibility = 'hidden';
    var audio = (options && options.audioContext) || MusicHub.wallet.audioContext;
    playTear(audio());

    var animations = pieces.map(function (piece) {
      var d = piece.side.dir;
      return piece.node.animate([
        { transform: 'none' },
        // A tug or two before it gives.
        { offset: TEAR_TUG_MS[0] / TEAR_MS, transform: 'translateX(' + (2 * d) + 'px) rotate(' + (1.5 * d) + 'deg)' },
        { offset: (TEAR_TUG_MS[0] + 100) / TEAR_MS, transform: 'translateX(' + (0.5 * d) + 'px) rotate(' + (0.4 * d) + 'deg)' },
        { offset: TEAR_TUG_MS[1] / TEAR_MS, transform: 'translateX(' + (3 * d) + 'px) rotate(' + (2 * d) + 'deg)' },
        // Rips from the top down, the halves hinging on the bottom of the tear.
        { offset: TEAR_RIP_MS / TEAR_MS, transform: 'translateX(' + (1 * d) + 'px) rotate(' + (0.8 * d) + 'deg)',
          easing: 'cubic-bezier(0.45, 0, 0.9, 0.6)' },
        // Torn free, it falls - slow at first, faster and faster.
        { offset: TEAR_FALL_MS / TEAR_MS, transform: 'translate(' + (12 * d) + 'px, 5px) rotate(' + (11 * d) + 'deg)',
          easing: 'cubic-bezier(0.4, 0, 0.85, 0.6)' },
        { transform: 'translate(' + piece.side.drift + ', ' + piece.side.drop + ') rotate(' + (piece.side.spin * d) + 'deg)' },
      ], { duration: TEAR_MS, fill: 'forwards' });
    });
    // Fading only near the end, so the halves are seen falling most of the way.
    pieces.forEach(function (piece) {
      animations.push(piece.node.animate([
        { opacity: 1 }, { offset: 1 - TEAR_FADE_MS / TEAR_MS, opacity: 1 }, { opacity: 0 },
      ], { duration: TEAR_MS, fill: 'forwards' }));
    });

    return Promise.all(animations.map(function (animation) {
      return animation.finished;
    })).then(function () {
      tear.remove();
      node.style.visibility = '';
    });
  }

  MusicHub.tear = {
    apart: apart,
  };
})(window.MusicHub);
