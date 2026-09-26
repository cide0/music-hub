/*
 * Vinyl variants for the Discogs page: reads the colour and effect words out
 * of a Discogs format ("Vinyl, LP, Album, Orange Translucent With Gold
 * Glitter") and draws that record in CSS - the disc that slides out of a
 * release card's sleeve on hover.
 *
 * Colours are only ever referenced as var(--vinyl-*) tokens from
 * variables.css. Patterns are layered CSS gradients, randomised per release
 * from its id, so every card gets its own marbling or splatter but the same
 * one on every visit.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // Word or phrase -> colour token. Phrases come first, and every match is
  // blanked out before the next one is tried, so "baby blue" is taken whole
  // instead of also counting as "blue".
  var COLOR_WORDS = [
    ['glow in the dark', 'glow'], ['coke bottle', 'clear'],
    ['baby blue', 'sky'], ['light blue', 'sky'], ['sky blue', 'sky'], ['powder blue', 'sky'],
    ['ice blue', 'sky'], ['royal blue', 'blue'], ['electric blue', 'blue'], ['sea blue', 'teal'],
    ['sea foam', 'mint'], ['seafoam', 'mint'], ['neon green', 'lime'], ['forest green', 'green'],
    ['army green', 'olive'], ['baby pink', 'pink'], ['hot pink', 'magenta'], ['bubblegum', 'pink'],
    ['black', 'black'], ['jet', 'black'], ['ebony', 'black'], ['onyx', 'black'],
    ['white', 'white'], ['milky', 'white'], ['ivory', 'cream'], ['cream', 'cream'], ['bone', 'cream'],
    ['beige', 'cream'], ['sand', 'cream'], ['eggshell', 'cream'],
    ['grey', 'grey'], ['gray', 'grey'], ['charcoal', 'grey'], ['slate', 'grey'],
    ['smoke', 'grey'], ['smokey', 'grey'], ['smoky', 'grey'],
    ['silver', 'silver'], ['chrome', 'silver'], ['platinum', 'silver'],
    ['gold', 'gold'], ['golden', 'gold'], ['amber', 'gold'], ['honey', 'gold'], ['mustard', 'gold'],
    ['bronze', 'bronze'], ['copper', 'bronze'], ['rust', 'bronze'],
    ['oxblood', 'oxblood'], ['burgundy', 'oxblood'], ['maroon', 'oxblood'], ['wine', 'oxblood'],
    ['red', 'red'], ['cherry', 'red'], ['ruby', 'red'], ['scarlet', 'red'], ['crimson', 'red'], ['blood', 'red'],
    ['orange', 'orange'], ['tangerine', 'orange'], ['peach', 'orange'], ['coral', 'orange'], ['apricot', 'orange'],
    ['yellow', 'yellow'], ['lemon', 'yellow'], ['canary', 'yellow'], ['banana', 'yellow'],
    ['green', 'green'], ['emerald', 'green'], ['jade', 'green'], ['lime', 'lime'], ['mint', 'mint'],
    ['olive', 'olive'], ['khaki', 'olive'],
    ['teal', 'teal'], ['turquoise', 'teal'], ['aqua', 'teal'], ['cyan', 'teal'],
    ['blue', 'blue'], ['cobalt', 'blue'], ['sapphire', 'blue'],
    ['navy', 'navy'], ['midnight', 'navy'], ['indigo', 'navy'],
    ['purple', 'purple'], ['violet', 'purple'], ['grape', 'purple'], ['plum', 'purple'], ['eggplant', 'purple'],
    ['lilac', 'lilac'], ['lavender', 'lilac'], ['orchid', 'lilac'],
    ['pink', 'pink'], ['rose', 'pink'], ['blush', 'pink'], ['magenta', 'magenta'], ['fuchsia', 'magenta'],
    ['brown', 'brown'], ['chocolate', 'brown'], ['coffee', 'brown'], ['caramel', 'brown'],
    ['tortoiseshell', 'brown'], ['tan', 'brown'],
    ['clear', 'clear'], ['crystal', 'clear'],
  ];

  // Phrases whose colour word isn't about the record's colour.
  var NOT_COLORS = /black friday|white label|red hot|record store day/g;

  /*
   * The Daily Spin's wheel exclusives (see vinyl-catalog.js): each one its
   * own drawing, named by its format ("Aurora Borealis"). First in
   * PATTERNS, so "Black Hole" is never read as a plain black record.
   */
  var EXCLUSIVE_PATTERNS = [
    ['aurora', /aurora/],
    ['supernova', /supernova/],
    ['holographic', /holograph/],
    ['blackhole', /black hole/],
    ['liquidgold', /liquid gold/],
    ['bioluminescent', /biolumin/],
    ['thunderstorm', /thunder|lightning/],
    ['synthwave', /synthwave|outrun/],
    ['stainedglass', /stained glass|rose window/],
    ['inferno', /inferno/],
  ];
  var EXCLUSIVES = EXCLUSIVE_PATTERNS.map(function (entry) {
    return entry[0];
  });

  // The record's pattern; the first one that matches wins.
  var PATTERNS = EXCLUSIVE_PATTERNS.concat([
    // Before picture: zoetropes are picture discs too.
    ['zoetrope', /zoetrope/],
    ['picture', /\bpicture\b|\bpic disc\b/],
    ['peppermint', /peppermint|candy[- ]?cane|candy[- ]?stripe/],
    ['lava', /\blava\b|lava[- ]?lamp|molten|magma/],
    ['splatter', /splatter|splash|speckle|spotted|\bspots?\b|confetti|\bpaint/],
    ['smash', /smash|smush|\bblob|\bmerge/],
    ['marble', /marble|marbling/],
    ['swirl', /swirl|galaxy|nebula|vortex|tie[- ]?dye|psychedelic/],
    ['split', /half[- ]?(?:and|&|n|'n')[- ]?half|\bsplit\b|side[- ]by[- ]side|\bhalf\b/],
    ['stripe', /stripe|tri[- ]?colou?r|segment|pinwheel/],
    // "Yellow In Clear": one colour poured inside the other.
    ['core', /\b(?:in|inside|within)\b/],
    ['smoke', /smoke|smoky|smokey|\bhaz[ey]|cloud|\bmist\b|\bfog\b/],
  ]);

  var METALLIC = /metallic|chrome|\bfoil\b|mirror|\bmetal\b/;
  var GLITTER = /glitter|sparkl|shimmer|stardust/;
  var TRANSLUCENT = /translucent|transparent|see[- ]through|\bclear\b|crystal|coke bottle|tinted/;
  // Words that make the named colours themselves see-through ("Red
  // Translucent") - unlike "Clear", which is a colour of its own
  // ("Yellow In Clear" keeps its yellow solid).
  var TINTED = /translucent|transparent|see[- ]through|tinted/;
  // Space-themed swirls come with stars.
  var STARRY = /galaxy|nebula|stardust/;
  var GLOW = /glow in the dark|luminous|phosphor/;
  var SHINY = ['gold', 'silver', 'bronze'];
  // "Rainbow Swirl", "Multicolour Splatter": the whole spectrum, in order.
  var RAINBOW = /rainbow|multi[- ]?colou?r|spectrum|\bprism/;
  var SPECTRUM = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
  // Base colours too pale for pale figures on top.
  var LIGHT_COLORS = ['white', 'cream', 'clear', 'yellow', 'gold', 'silver', 'mint', 'sky', 'lilac', 'pink', 'lime', 'glow'];

  function token(name) {
    return 'var(--vinyl-' + name + ')';
  }

  function mix(color, other, percent) {
    return 'color-mix(in srgb, ' + color + ' ' + (100 - percent) + '%, ' + other + ')';
  }

  function lighter(color, percent) {
    return mix(color, 'var(--color-text)', percent);
  }

  function darker(color, percent) {
    return mix(color, 'var(--color-black)', percent);
  }

  function seeThrough(color, percent) {
    return 'color-mix(in srgb, ' + color + ' ' + percent + '%, transparent)';
  }

  /** A small seeded random generator (mulberry32 over an FNV-1a hash). */
  function randomFrom(text) {
    var hash = 2166136261;
    String(text).split('').forEach(function (char) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return function () {
      hash += 0x6D2B79F5;
      var t = hash;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function between(random, min, max) {
    return min + random() * (max - min);
  }

  function pct(value) {
    return value.toFixed(1) + '%';
  }

  /** Colour tokens in the order the text names them, at most three. */
  function findColors(text) {
    var found = [];
    var rest = text;
    COLOR_WORDS.forEach(function (entry) {
      var pattern = new RegExp('\\b' + entry[0] + '\\b', 'g');
      rest = rest.replace(pattern, function (match, offset) {
        found.push({ at: offset, color: entry[1] });
        return new Array(match.length + 1).join(' ');
      });
    });
    var colors = [];
    found.sort(function (a, b) {
      return a.at - b.at;
    }).forEach(function (entry) {
      if (colors.indexOf(entry.color) === -1) {
        colors.push(entry.color);
      }
    });
    return colors.slice(0, 3);
  }

  /**
   * What a format says about the record, e.g. for "Vinyl, LP, Black & White
   * Swirl": { pattern: 'swirl', colors: ['black', 'white'], ... }.
   */
  function describe(format) {
    var text = String(format || '').toLowerCase().replace(NOT_COLORS, ' ');
    // The part in brackets is usually the pressing's marketing name
    // ("[Portofino Orange Glitter]"); it's only read when the plain
    // description doesn't name a colour.
    var plain = text.replace(/\[[^\]]*\]/g, ' ');

    // "... With Gold Glitter": gold is the glitter, not the record - unless
    // it's the only colour named ("Gold Glitter").
    var glitterColor = null;
    var glitterMatch = /\b([a-z]+) glitter/.exec(plain) || /\b([a-z]+) glitter/.exec(text);
    if (glitterMatch) {
      var named = findColors(glitterMatch[1]);
      if (named.length) {
        glitterColor = named[0];
        var withoutGlitter = plain.replace(glitterMatch[0], ' glitter');
        if (findColors(withoutGlitter).length) {
          plain = withoutGlitter;
        }
      }
    }

    var colors = findColors(plain);
    if (!colors.length) {
      colors = findColors(text);
    }

    var pattern = 'solid';
    for (var i = 0; i < PATTERNS.length; i++) {
      var name = PATTERNS[i][0];
      if (name === 'core' && colors.length < 2) {
        continue;
      }
      if (PATTERNS[i][1].test(name === 'core' ? text.replace(GLOW, ' ') : text)) {
        pattern = name;
        break;
      }
    }

    var glow = GLOW.test(text);
    var translucent = TRANSLUCENT.test(text);
    // Whether the format names a colour, or it's one of the defaults below.
    var named = colors.length > 0;
    if (!colors.length) {
      colors = [glow ? 'glow' : translucent ? 'clear' : METALLIC.test(text) ? 'silver' : 'black'];
    }

    // Peppermint is red and white unless it says otherwise ("Green
    // Peppermint" is green and white).
    if (pattern === 'peppermint' && colors.length < 2) {
      var stripe = colors[0] && colors[0] !== 'white' && colors[0] !== 'black' ? colors[0] : 'red';
      colors = [stripe, 'white'];
    }

    var rpm = /\b78 ?rpm/.test(text) ? 78 : /\b45 ?rpm/.test(text) ? 45 : 33;

    return {
      pattern: pattern,
      colors: colors,
      metallic: METALLIC.test(text) || colors.every(function (color) {
        return SHINY.indexOf(color) !== -1;
      }),
      glitter: GLITTER.test(text) || STARRY.test(text),
      glitterColor: glitterColor,
      translucent: translucent,
      tinted: TINTED.test(text),
      glow: glow,
      rainbow: RAINBOW.test(text),
      named: named,
      rpm: rpm,
      // A wheel exclusive: drawn by its own pattern, nothing else added.
      exclusive: EXCLUSIVES.indexOf(pattern) !== -1,
    };
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Frames around a zoetrope's rings, and how long it takes to turn once
  // through them all. Both must match the steps() count and the duration on
  // .vinyl--zoetrope .vinyl__disc in style.css: the disc turns one frame
  // slot per step. 16 is as many as fit without the cover zoetrope's
  // windows overlapping; one every 56ms is about 18 frames a second - the
  // turn itself doesn't show, so it doesn't have to keep to the rpm.
  var ZOETROPE_FRAMES = 16;
  var ZOETROPE_TURN_MS = 900;
  // Filter ids have to be unique on the page.
  var filterCount = 0;

  function svgNode(tag, attributes, style) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attributes || {}).forEach(function (name) {
      node.setAttribute(name, attributes[name]);
    });
    // Colours go through style, where var(--vinyl-*) resolves.
    Object.keys(style || {}).forEach(function (name) {
      node.style[name] = style[name];
    });
    return node;
  }

  function svgCanvas() {
    return svgNode('svg', { viewBox: '0 0 200 200', preserveAspectRatio: 'none', class: 'vinyl__art', 'aria-hidden': 'true' });
  }

  function addFilter(svg, build) {
    var id = 'vinyl-filter-' + (++filterCount);
    var defs = svgNode('defs');
    var filter = svgNode('filter', { id: id, x: '-25%', y: '-25%', width: '150%', height: '150%' });
    build(filter);
    defs.appendChild(filter);
    svg.appendChild(defs);
    return 'url(#' + id + ')';
  }

  /**
   * Turbulence that bends whatever is drawn through it - marbling, swirls,
   * smashes. `swell` ([from, to]) animates how strongly it bends, back and
   * forth over `seconds` (3.6 by default), so the shapes flow.
   */
  function warp(svg, random, frequency, scale, softness, swell, seconds) {
    return addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feTurbulence', {
        type: 'turbulence', baseFrequency: frequency, numOctaves: '3',
        seed: String(Math.floor(random() * 1000)), result: 'noise',
      }));
      var displace = svgNode('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'noise', scale: String(scale),
        xChannelSelector: 'R', yChannelSelector: 'G', result: 'warped',
      });
      if (swell) {
        displace.appendChild(svgNode('animate', {
          attributeName: 'scale',
          values: swell[0] + ';' + swell[1] + ';' + swell[0],
          keyTimes: '0;0.5;1',
          calcMode: 'spline',
          keySplines: '0.45 0 0.55 1;0.45 0 0.55 1',
          dur: (seconds || 3.6) + 's',
          repeatCount: 'indefinite',
        }));
      }
      filter.appendChild(displace);
      if (softness) {
        filter.appendChild(svgNode('feGaussianBlur', { in: 'warped', stdDeviation: String(softness) }));
      }
    });
  }

  /**
   * Candy stripes: wedges of the first colour on the second, each the band
   * between two gently wound spirals. When `animate` is set, the stripes
   * twist tighter and relax again, like a sweet being twisted - an SVG shape
   * animation, paused and resumed by setPlaying().
   */
  function peppermintArt(colors, random, angle, animate) {
    var svg = svgCanvas();
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: colors[1] }));

    var stripes = 8;
    var width = Math.PI / stripes;
    var start = angle * Math.PI / 180;
    function wedge(index, twist) {
      var outward = [];
      var inward = [];
      for (var step = 0; step <= 40; step++) {
        var t = step / 40;
        var theta = start + (index * 2 * Math.PI / stripes) + t * twist * 2 * Math.PI;
        var radius = t * 150;
        outward.push((100 + radius * Math.cos(theta)).toFixed(1) + ' ' + (100 + radius * Math.sin(theta)).toFixed(1));
        inward.unshift((100 + radius * Math.cos(theta + width)).toFixed(1) + ' ' + (100 + radius * Math.sin(theta + width)).toFixed(1));
      }
      return 'M' + outward.concat(inward).join(' L') + ' Z';
    }

    for (var index = 0; index < stripes; index++) {
      var path = svgNode('path', { d: wedge(index, 0.08) }, { fill: colors[0] });
      if (animate) {
        path.appendChild(svgNode('animate', {
          attributeName: 'd',
          values: [wedge(index, 0.08), wedge(index, 0.42), wedge(index, 0.08)].join(';'),
          keyTimes: '0;0.5;1',
          calcMode: 'spline',
          keySplines: '0.45 0 0.55 1;0.45 0 0.55 1',
          dur: '3.2s',
          repeatCount: 'indefinite',
        }));
      }
      svg.appendChild(path);
    }
    return svg;
  }

  /**
   * A colour smash: big blobs of the other colours pressed into the base,
   * torn into irregular patches by strong turbulence, edges kept crisp.
   * When `animate` is set, the turbulence swells and eases, so the patches
   * squish and flow like molten vinyl in the press.
   */
  function smashArt(colors, random, animate) {
    var svg = svgCanvas();
    var filter = warp(svg, random, '0.009 0.013', 70, 0, animate ? [55, 95] : null);
    var group = svgNode('g', { filter: filter });
    group.appendChild(svgNode('rect', { x: -60, y: -60, width: 320, height: 320 }, { fill: colors[0] }));

    var paints = colors.slice(1);
    for (var index = 0; index < 10; index++) {
      // Every fourth blob is the base colour again, biting into the others.
      var fill = index % 4 === 3 ? colors[0] : paints[index % paints.length];
      group.appendChild(svgNode('ellipse', {
        cx: between(random, 10, 190).toFixed(1),
        cy: between(random, 10, 190).toFixed(1),
        rx: between(random, 28, 64).toFixed(1),
        ry: between(random, 22, 52).toFixed(1),
        transform: 'rotate(' + Math.round(between(random, 0, 180)) + ' 100 100)',
      }, { fill: fill }));
    }
    svg.appendChild(group);
    return svg;
  }

  /**
   * A lava lamp: soft blobs of wax rising and sinking through the base,
   * swelling and shrinking as they go. Blobs of one colour share a "goo"
   * filter - blurred, then cut back to a hard edge - so two that drift into
   * each other melt into one and pull apart again. When `animate` is set
   * they move (paused and resumed by setPlaying()); otherwise they hold one
   * moment of it, e.g. for the card backdrop.
   */
  function lavaArt(base, waxes, random, animate) {
    var svg = svgCanvas();
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: base }));

    // A warm glow where the lamp's bulb would be.
    var glow = svgNode('radialGradient', { id: 'vinyl-lava-' + (++filterCount), cx: '50%', cy: '50%', r: '55%' });
    glow.appendChild(svgNode('stop', { offset: '0%' }, { stopColor: waxes[0], stopOpacity: '0.35' }));
    glow.appendChild(svgNode('stop', { offset: '100%' }, { stopColor: waxes[0], stopOpacity: '0' }));
    var glowDefs = svgNode('defs');
    glowDefs.appendChild(glow);
    svg.appendChild(glowDefs);
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200, fill: 'url(#' + glow.id + ')' }));

    var goo = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '6', result: 'blur' }));
      // Alpha x22 - 9: the blurred halo between two close blobs becomes solid.
      filter.appendChild(svgNode('feColorMatrix', {
        in: 'blur', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9',
      }));
    });

    // Around a dozen blobs whatever the number of colours.
    var perWax = Math.max(3, Math.round(12 / waxes.length));
    waxes.forEach(function (wax) {
      var group = svgNode('g', { filter: goo }, { fill: wax });
      for (var index = 0; index < perWax; index++) {
        var radius = between(random, 11, 26);
        var low = between(random, 140, 185);
        var high = between(random, 15, 60);
        // Half start at the bottom and rise, half the other way round.
        var from = random() < 0.5 ? low : high;
        var to = from === low ? high : low;
        var x = between(random, 25, 175);
        var blob = svgNode('circle', {
          cx: x.toFixed(1),
          cy: between(random, high, low).toFixed(1),
          r: radius.toFixed(1),
        });
        if (animate) {
          // Each blob on its own slow clock, started part-way through, so
          // they never move in step.
          var duration = between(random, 7, 15);
          var begin = (-random() * duration).toFixed(2) + 's';
          var ease = { calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1', repeatCount: 'indefinite', begin: begin };
          blob.appendChild(svgNode('animate', Object.assign({
            attributeName: 'cy', values: [from, to, from].map(function (v) { return v.toFixed(1); }).join(';'),
            dur: duration.toFixed(2) + 's',
          }, ease)));
          blob.appendChild(svgNode('animate', Object.assign({
            attributeName: 'cx', values: [x, x + between(random, -18, 18), x].map(function (v) { return v.toFixed(1); }).join(';'),
            dur: (duration * between(random, 0.6, 0.9)).toFixed(2) + 's',
          }, ease)));
          // Stretched thin in the middle of the trip, round at either end.
          blob.appendChild(svgNode('animate', Object.assign({
            attributeName: 'r', values: [radius, radius * between(random, 0.65, 0.85), radius].map(function (v) { return v.toFixed(1); }).join(';'),
            dur: (duration / 2).toFixed(2) + 's',
          }, ease)));
        }
        group.appendChild(blob);
      }
      svg.appendChild(group);
    });
    return svg;
  }

  /**
   * A zoetrope: rings of frames, each drawn a little further along. The CSS
   * spins this disc in steps of exactly one frame slot - what a strobe light
   * does to a real one - so every position on screen shows the next frame
   * each step: the ball bounces and the propellers turn in place while the
   * record seems to stand still. Frames run backwards around the ring
   * because turning the disc forwards brings the previous slot into view.
   */
  function zoetropeArt(colors, random, angle) {
    var svg = svgCanvas();
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: colors[0] }));

    // Printed guide rings.
    [36, 55, 84].forEach(function (radius) {
      svg.appendChild(svgNode('circle', { cx: 100, cy: 100, r: radius, 'stroke-width': '0.8' }, {
        fill: 'none',
        stroke: seeThrough('var(--color-text)', 25),
      }));
    });

    for (var slot = 0; slot < ZOETROPE_FRAMES; slot++) {
      var t = ((ZOETROPE_FRAMES - slot) % ZOETROPE_FRAMES) / ZOETROPE_FRAMES;
      var frame = svgNode('g', { transform: 'rotate(' + (angle + slot * 360 / ZOETROPE_FRAMES).toFixed(1) + ' 100 100)' });

      // Outer ring: a ball bouncing outwards, squashed where it lands.
      var height = Math.abs(Math.sin(Math.PI * t));
      var squash = height < 0.25 ? 1 - (0.25 - height) * 1.6 : 1;
      frame.appendChild(svgNode('ellipse', {
        cx: 100,
        cy: (100 - 61 - 15 * height).toFixed(1),
        rx: (5.5 / squash).toFixed(2),
        ry: (5.5 * squash).toFixed(2),
      }, { fill: colors[1] }));

      // Inner ring: a propeller turning a quarter turn per cycle (it looks
      // the same every quarter turn, so the loop is seamless).
      var propeller = svgNode('g', { transform: 'translate(100 55) rotate(' + (t * 90).toFixed(1) + ')' });
      propeller.appendChild(svgNode('rect', { x: -7.5, y: -1.8, width: 15, height: 3.6, rx: 1.8 }, { fill: colors[2] }));
      propeller.appendChild(svgNode('rect', { x: -1.8, y: -7.5, width: 3.6, height: 15, rx: 1.8 }, { fill: colors[2] }));
      frame.appendChild(propeller);

      svg.appendChild(frame);
    }
    return svg;
  }

  /*
   * The zoetrope's moves for pieces of the cover art. Each takes the frame's
   * place in the loop (t, 0 to 1) and says which point of the cover sits in
   * the window (u, v), how far zoomed in, turned, pushed outwards and
   * squashed. All of them end where they start, so the loop is seamless.
   */
  var COVER_MOVES = {
    // The window glides around a loop over the cover.
    pan: function (t, p) {
      return { u: p.u + p.reach * Math.cos(2 * Math.PI * t * p.dir), v: p.v + p.reach * Math.sin(2 * Math.PI * t * p.dir), zoom: p.zoom };
    },
    // Pushes in on one spot of the cover and back out.
    zoom: function (t, p) {
      return { u: p.u, v: p.v, zoom: p.zoom * (1 + 0.9 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t))) };
    },
    // The piece turns a full circle in its window.
    spin: function (t, p) {
      return { u: p.u, v: p.v, zoom: p.zoom, turn: p.dir * 360 * t };
    },
    // The piece bounces outwards and lands squashed, like the classic ball.
    bounce: function (t, p) {
      var height = Math.abs(Math.sin(Math.PI * t));
      return {
        u: p.u, v: p.v, zoom: p.zoom,
        lift: 13 * height,
        squash: height < 0.25 ? 1 - (0.25 - height) * 1.6 : 1,
      };
    },
  };

  /**
   * A zoetrope made from the release's own cover art: two rings of windows,
   * each showing a piece of the cover, moved a little further along from
   * frame to frame. Which pieces, which moves, window shapes, zoom and
   * direction all come from the release's seed - no two releases animate
   * alike, and the same release always does. Frames run backwards like the
   * drawn figures below.
   */
  function coverZoetropeArt(colors, random, angle, imageUrl) {
    var svg = svgCanvas();
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: colors[0] }));

    // A printed rule between the two rings.
    svg.appendChild(svgNode('circle', { cx: 100, cy: 100, r: 62.5, 'stroke-width': '0.8' }, {
      fill: 'none',
      stroke: seeThrough('var(--color-text)', 25),
    }));

    // Shuffle the moves with the seed; each ring takes a different one.
    var moves = Object.keys(COVER_MOVES).map(function (name) {
      return { name: name, order: random() };
    }).sort(function (a, b) {
      return a.order - b.order;
    });

    var defs = svgNode('defs');
    svg.appendChild(defs);

    // Inner ring clears the run-out groove; outer stays inside the rim.
    var rings = [
      { distance: 51, size: 17, move: moves[0].name, outline: colors[2] },
      { distance: 73, size: 21, move: moves[1].name, outline: colors[1] },
    ].map(function (ring) {
      var round = random() < 0.5;
      var half = ring.size / 2;
      var clip = svgNode('clipPath', { id: 'vinyl-clip-' + (++filterCount) });
      clip.appendChild(round
        ? svgNode('circle', { cx: 0, cy: 0, r: half })
        : svgNode('rect', { x: -half, y: -half, width: ring.size, height: ring.size, rx: (ring.size * 0.18).toFixed(1) }));
      defs.appendChild(clip);
      ring.round = round;
      ring.clip = 'url(#' + clip.id + ')';
      ring.params = {
        u: between(random, 0.3, 0.7),
        v: between(random, 0.3, 0.7),
        zoom: between(random, 2.2, 4),
        reach: between(random, 0.1, 0.2),
        dir: random() < 0.5 ? 1 : -1,
      };
      return ring;
    });

    for (var slot = 0; slot < ZOETROPE_FRAMES; slot++) {
      var t = ((ZOETROPE_FRAMES - slot) % ZOETROPE_FRAMES) / ZOETROPE_FRAMES;
      var frame = svgNode('g', { transform: 'rotate(' + (angle + slot * 360 / ZOETROPE_FRAMES).toFixed(1) + ' 100 100)' });

      rings.forEach(function (ring) {
        var pose = COVER_MOVES[ring.move](t, ring.params);
        var squash = pose.squash || 1;
        var place = 'translate(100 ' + (100 - ring.distance - (pose.lift || 0)).toFixed(2) + ')'
          + ' rotate(' + (pose.turn || 0).toFixed(1) + ')'
          + ' scale(' + (1 / squash).toFixed(3) + ' ' + squash.toFixed(3) + ')';

        // The whole cover, scaled so the window shows 1/zoom of it, with the
        // chosen point in the middle - kept from sliding past the cover's edge.
        var cover = ring.size * pose.zoom;
        var margin = 0.5 / pose.zoom;
        var u = Math.min(1 - margin, Math.max(margin, pose.u));
        var v = Math.min(1 - margin, Math.max(margin, pose.v));
        var porthole = svgNode('g', { transform: place, 'clip-path': ring.clip });
        porthole.appendChild(svgNode('image', {
          href: imageUrl,
          x: (-u * cover).toFixed(2),
          y: (-v * cover).toFixed(2),
          width: cover.toFixed(2),
          height: cover.toFixed(2),
          preserveAspectRatio: 'xMidYMid slice',
        }));
        frame.appendChild(porthole);

        // A thin printed frame around the window.
        var half = ring.size / 2;
        frame.appendChild(svgNode(ring.round ? 'circle' : 'rect', ring.round
          ? { cx: 0, cy: 0, r: half, transform: place, 'stroke-width': '1' }
          : { x: -half, y: -half, width: ring.size, height: ring.size, rx: (ring.size * 0.18).toFixed(1), transform: place, 'stroke-width': '1' },
        { fill: 'none', stroke: ring.outline }));
      });

      svg.appendChild(frame);
    }
    return svg;
  }

  /** Bands of the other colours across the base, bent into veins. */
  function marbleArt(colors, random, angle) {
    var svg = svgCanvas();
    var group = svgNode('g', { filter: warp(svg, random, '0.010 0.017', 75, 0.7) });
    group.appendChild(svgNode('rect', { x: -60, y: -60, width: 320, height: 320 }, { fill: colors[0] }));

    var bands = svgNode('g', { transform: 'rotate(' + angle + ' 100 100)' });
    var veins = colors.slice(1);
    for (var y = -70, i = 0; y < 270; i++) {
      var height = between(random, 5, 24);
      bands.appendChild(svgNode('rect', { x: -80, y: y.toFixed(1), width: 360, height: height.toFixed(1) }, {
        fill: veins[i % veins.length],
        opacity: between(random, 0.6, 1).toFixed(2),
      }));
      y += height + between(random, 6, 30);
    }
    group.appendChild(bands);
    svg.appendChild(group);
    return svg;
  }

  /**
   * Twisted wedges wound out from the middle - each arm is the band between
   * two spirals, like a lollipop - loosened up a little by turbulence.
   */
  function swirlArt(colors, random, angle, full) {
    var svg = svgCanvas();
    var group = svgNode('g', { filter: warp(svg, random, '0.014', 10, 0.6) });
    group.appendChild(svgNode('rect', { x: -60, y: -60, width: 320, height: 320 }, { fill: colors[0] }));

    // `full`: one arm per colour, filling the whole disc between them (a
    // rainbow swirl) rather than arms of colour over a base.
    var arms = full ? colors.length : colors.length > 2 ? 4 : 3;
    var turns = between(random, 0.7, 1.1);
    // A hair over a full share, so no base shows between neighbouring arms.
    var width = full ? (2 * Math.PI / arms) + 0.04 : Math.PI / arms;
    var start = angle * Math.PI / 180;
    function point(theta, radius) {
      return (100 + radius * Math.cos(theta)).toFixed(1) + ' ' + (100 + radius * Math.sin(theta)).toFixed(1);
    }
    for (var arm = 0; arm < arms; arm++) {
      var outward = [];
      var inward = [];
      for (var step = 0; step <= 60; step++) {
        var t = step / 60;
        var theta = start + (arm * 2 * Math.PI / arms) + t * turns * 2 * Math.PI;
        outward.push(point(theta, t * 150));
        inward.unshift(point(theta + width, t * 150));
      }
      group.appendChild(svgNode('path', { d: 'M' + outward.concat(inward).join(' L') + ' Z' }, {
        fill: full ? colors[arm] : colors[1 + (arm % (colors.length - 1))],
      }));
    }
    svg.appendChild(group);
    return svg;
  }

  /** Pale wisps of fractal noise drifting through a dark, see-through base. */
  function smokeArt(colors, random) {
    var svg = svgCanvas();
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: seeThrough(darker(colors[0], 45), 88) }));
    var wisps = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feTurbulence', {
        type: 'fractalNoise', baseFrequency: '0.012 0.02', numOctaves: '4',
        seed: String(Math.floor(random() * 1000)),
      }));
      // White, with the noise as its alpha - only the densest parts show.
      filter.appendChild(svgNode('feColorMatrix', {
        type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.4 0 0 0 -1.3',
      }));
    });
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200, filter: wisps }, { opacity: '0.8' }));
    return svg;
  }

  /* ---------------------------------------------------- wheel exclusives */

  /*
   * The Daily Spin's ten wheel exclusives, each drawn by its own function
   * below. The record's visible ring runs from the label's edge (29 from
   * the middle of the 200 x 200 canvas) out to the rim (86); the middle is
   * under the label. With `animate` they move - skies flowing, stars
   * twinkling, fire flickering (paused and resumed by setPlaying());
   * without, they hold one moment of it, e.g. for the card backdrop.
   */

  function exclusiveToken(name) {
    return 'var(--exclusive-' + name + ')';
  }

  /** A gradient in the SVG's defs; `stops` are [offset, colour, opacity]. Returns its url(). */
  function gradient(svg, kind, attributes, stops) {
    var node = svgNode(kind === 'radial' ? 'radialGradient' : 'linearGradient',
      Object.assign({ id: 'vinyl-gradient-' + (++filterCount) }, attributes));
    stops.forEach(function (stop) {
      node.appendChild(svgNode('stop', { offset: String(stop[0]) }, {
        stopColor: stop[1],
        stopOpacity: stop[2] === undefined ? '1' : String(stop[2]),
      }));
    });
    var defs = svgNode('defs');
    defs.appendChild(node);
    svg.appendChild(defs);
    return 'url(#' + node.id + ')';
  }

  var EASE_BACK_AND_FORTH = { calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1' };

  /**
   * An endless SMIL animation (`tag`, <animate> by default) on `node` - only
   * when `animate` is set. Returns the node. Whatever it animates must be
   * set as an attribute rather than a style, or the style wins.
   */
  function loop(node, animate, attributes, tag) {
    if (animate) {
      node.appendChild(svgNode(tag || 'animate', Object.assign({ repeatCount: 'indefinite' }, attributes)));
    }
    return node;
  }

  /** `node` turning about the middle, once every |seconds| (negative: backwards). */
  function turning(node, animate, seconds) {
    return loop(node, animate, {
      attributeName: 'transform', type: 'rotate',
      from: '0 100 100', to: (seconds < 0 ? -360 : 360) + ' 100 100',
      dur: Math.abs(seconds) + 's',
    }, 'animateTransform');
  }

  /** A soft glow: a blurred copy of whatever's drawn, under the sharp one. */
  function glowFilter(svg, spread) {
    return addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: String(spread), result: 'blur' }));
      var merge = svgNode('feMerge');
      merge.appendChild(svgNode('feMergeNode', { in: 'blur' }));
      merge.appendChild(svgNode('feMergeNode', { in: 'SourceGraphic' }));
      filter.appendChild(merge);
    });
  }

  /**
   * Noise in one colour: `alpha` is the colour matrix's alpha row, which
   * picks which of the noise shows ("-4 0 0 0 1.25": only its thin creases).
   * `drift` animates its frequency between the two given, so it churns.
   */
  function noiseFill(svg, random, options, animate) {
    return addFilter(svg, function (filter) {
      var noise = svgNode('feTurbulence', {
        type: options.type, baseFrequency: options.frequency, numOctaves: String(options.octaves),
        seed: String(Math.floor(random() * 1000)), result: 'noise',
      });
      loop(noise, animate && options.drift, Object.assign({
        attributeName: 'baseFrequency',
        values: options.frequency + ';' + options.drift + ';' + options.frequency,
        dur: options.seconds + 's',
      }, EASE_BACK_AND_FORTH));
      filter.appendChild(noise);
      filter.appendChild(svgNode('feColorMatrix', {
        in: 'noise', type: 'matrix', values: '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ' + options.alpha, result: 'mask',
      }));
      // The colour through a style, where var(--exclusive-*) resolves.
      filter.appendChild(svgNode('feFlood', { result: 'color' }, { floodColor: options.color }));
      filter.appendChild(svgNode('feComposite', { in: 'color', in2: 'mask', operator: 'in' }));
    });
  }

  /** The point `radius` out from the middle, `degrees` clockwise from the top. */
  function polar(radius, degrees) {
    var theta = (degrees - 90) * Math.PI / 180;
    return { x: 100 + radius * Math.cos(theta), y: 100 + radius * Math.sin(theta) };
  }

  function xy(point) {
    return point.x.toFixed(1) + ' ' + point.y.toFixed(1);
  }

  function fullRect(fill) {
    return svgNode('rect', { x: 0, y: 0, width: 200, height: 200, fill: fill });
  }

  function seconds(value) {
    return value.toFixed(2) + 's';
  }

  /** Pinpricks of starlight, some of them twinkling. */
  function stars(svg, random, animate, count, color) {
    var group = svgNode('g', {}, { fill: color || exclusiveToken('star') });
    for (var i = 0; i < count; i++) {
      var bright = between(random, 0.4, 1);
      var star = svgNode('circle', {
        cx: between(random, 4, 196).toFixed(1),
        cy: between(random, 4, 196).toFixed(1),
        r: between(random, 0.35, 1.1).toFixed(2),
        opacity: bright.toFixed(2),
      });
      if (random() < 0.5) {
        loop(star, animate, { attributeName: 'opacity', values: bright.toFixed(2) + ';0.1;' + bright.toFixed(2), dur: seconds(between(random, 1.4, 3.8)), begin: seconds(-random() * 3) });
      }
      group.appendChild(star);
    }
    svg.appendChild(group);
    return group;
  }

  /**
   * Aurora Borealis: curtains of green, teal and violet light rippling
   * across a starry night sky, folding and drifting as they go.
   */
  function auroraArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '62%' }, [
      [0, mix(exclusiveToken('night'), token('navy'), 55)],
      [1, exclusiveToken('night')],
    ])));
    stars(svg, random, animate, 50);

    // Folds running up the curtains: noise that changes quickly across
    // and slowly along them.
    var folds = warp(svg, random, '0.04 0.006', 24, 1.2, animate ? [14, 38] : null, 5.2);
    var sky = svgNode('g', { filter: folds }, { mixBlendMode: 'screen' });
    [
      { color: exclusiveToken('aurora-green'), angle: -18, y: 66, height: 46 },
      { color: exclusiveToken('aurora-teal'), angle: 28, y: 110, height: 36 },
      { color: exclusiveToken('aurora-violet'), angle: -56, y: 138, height: 32 },
      { color: exclusiveToken('aurora-green'), angle: 72, y: 44, height: 28 },
      { color: exclusiveToken('aurora-violet'), angle: 140, y: 58, height: 24 },
    ].forEach(function (curtain) {
      // Bright along the lower edge, fading out upwards, like the real thing.
      var fill = gradient(svg, 'linear', { x1: '0', y1: '1', x2: '0', y2: '0' }, [
        [0, curtain.color, 0], [0.1, curtain.color, 0.95], [0.4, curtain.color, 0.5], [1, curtain.color, 0],
      ]);
      var wave = between(random, 5, 12);
      var length = between(random, 55, 90);
      var phase = random() * Math.PI * 2;
      var top = [];
      var bottom = [];
      for (var x = -50; x <= 250; x += 10) {
        var y = curtain.y + Math.sin(x / length * 2 * Math.PI + phase) * wave;
        top.push(x + ' ' + (y - curtain.height).toFixed(1));
        bottom.unshift(x + ' ' + y.toFixed(1));
      }
      var drift = svgNode('g', { transform: 'rotate(' + curtain.angle + ' 100 100)' });
      var band = svgNode('path', { d: 'M' + top.concat(bottom).join(' L') + ' Z', fill: fill });
      loop(band, animate, Object.assign({
        attributeName: 'transform', type: 'translate',
        values: '0 0;' + between(random, -22, 22).toFixed(1) + ' ' + between(random, -7, 7).toFixed(1) + ';0 0',
        dur: seconds(between(random, 6, 11)),
      }, EASE_BACK_AND_FORTH), 'animateTransform');
      drift.appendChild(band);
      sky.appendChild(drift);
    });
    svg.appendChild(sky);
    return svg;
  }

  /**
   * Supernova: a star blowing itself apart - a white-hot core, rays of
   * light turning both ways, and shockwaves racing out to the rim.
   */
  function supernovaArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '50%' }, [
      [0, exclusiveToken('hot-white')],
      [0.3, 'var(--rarity-gold-bright)'],
      [0.46, exclusiveToken('nova-flare')],
      [0.68, mix(token('purple'), exclusiveToken('night'), 45)],
      [0.92, exclusiveToken('night')],
    ])));
    stars(svg, random, animate, 30);

    [
      { count: 30, color: exclusiveToken('hot-white'), spread: 2.2, turn: 60, opacity: 0.6 },
      { count: 18, color: exclusiveToken('nova-flare'), spread: 3.6, turn: -40, opacity: 0.5 },
      { count: 12, color: 'var(--rarity-gold-bright)', spread: 2.8, turn: 90, opacity: 0.45 },
    ].forEach(function (set) {
      var group = turning(svgNode('g', {}, { fill: set.color, opacity: String(set.opacity), mixBlendMode: 'screen' }), animate, set.turn);
      for (var i = 0; i < set.count; i++) {
        var angle = i * 360 / set.count + between(random, -4, 4);
        group.appendChild(svgNode('path', {
          d: 'M' + xy(polar(24, angle - set.spread)) + ' L' + xy(polar(between(random, 58, 100), angle)) + ' L' + xy(polar(24, angle + set.spread)) + ' Z',
        }));
      }
      svg.appendChild(group);
    });

    // Shockwaves, one after another; still, three rings frozen on the way out.
    var waves = svgNode('g', { filter: glowFilter(svg, 1.2) });
    for (var w = 0; w < 3; w++) {
      var begin = seconds(w * 0.9);
      var ring = svgNode('circle', {
        cx: 100, cy: 100, r: 36 + w * 20, fill: 'none', 'stroke-width': 2, opacity: animate ? 0 : 0.4,
      }, { stroke: w === 1 ? token('sky') : exclusiveToken('hot-white') });
      loop(ring, animate, { attributeName: 'r', values: '28;98', keyTimes: '0;1', calcMode: 'spline', keySplines: '0.2 0.6 0.4 1', dur: '2.7s', begin: begin });
      loop(ring, animate, { attributeName: 'opacity', values: '0.95;0', dur: '2.7s', begin: begin });
      loop(ring, animate, { attributeName: 'stroke-width', values: '3.5;0.4', dur: '2.7s', begin: begin });
      waves.appendChild(ring);
    }
    svg.appendChild(waves);
    return svg;
  }

  /**
   * Black Hole: nothing escapes the middle. A starfield bent around a
   * blazing accretion disc that whirls far faster than the record, and a
   * thin, white-hot photon ring right at the edge of the dark.
   */
  function blackHoleArt(random, angle, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect('var(--color-black)'));
    stars(svg, random, animate, 34);

    var plasma = exclusiveToken('plasma');
    svg.appendChild(svgNode('circle', {
      cx: 100, cy: 100, r: 96,
      fill: gradient(svg, 'radial', {}, [[0.3, plasma, 0], [0.33, plasma, 0.6], [0.5, plasma, 0.22], [1, plasma, 0]]),
    }));

    // Spiral arms, wound tighter towards the middle, fading out towards
    // the rim.
    var colors = [plasma, 'var(--rarity-gold-bright)', exclusiveToken('fire'), exclusiveToken('hot-white'), plasma, exclusiveToken('flame')];
    var disc = turning(svgNode('g'), animate, 6);
    var start = angle * Math.PI / 180;
    colors.forEach(function (color, arm) {
      var fill = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '96' }, [
        [0.3, color, 1], [0.55, color, 0.65], [1, color, 0],
      ]);
      var outward = [];
      var inward = [];
      for (var step = 0; step <= 50; step++) {
        var t = step / 50;
        var radius = 29 + t * 66;
        var theta = start + arm * 2 * Math.PI / colors.length + (1 - t) * 1.4 * 2 * Math.PI;
        var width = 0.5 - 0.3 * t;
        outward.push((100 + radius * Math.cos(theta)).toFixed(1) + ' ' + (100 + radius * Math.sin(theta)).toFixed(1));
        inward.unshift((100 + radius * Math.cos(theta + width)).toFixed(1) + ' ' + (100 + radius * Math.sin(theta + width)).toFixed(1));
      }
      disc.appendChild(svgNode('path', { d: 'M' + outward.concat(inward).join(' L') + ' Z', fill: fill }, { opacity: String(arm === 3 ? 0.55 : 0.85) }));
    });
    var smear = svgNode('g', { filter: warp(svg, random, '0.03', 7, 0.9) }, { mixBlendMode: 'screen' });
    smear.appendChild(disc);
    svg.appendChild(smear);

    // The photon ring, pulsing.
    var ring = svgNode('g', { filter: glowFilter(svg, 1.6) });
    var photon = svgNode('circle', { cx: 100, cy: 100, r: 31.5, fill: 'none', 'stroke-width': 1.8, opacity: 1 }, { stroke: exclusiveToken('hot-white') });
    loop(photon, animate, Object.assign({ attributeName: 'opacity', values: '1;0.55;1', dur: '1.8s' }, EASE_BACK_AND_FORTH));
    ring.appendChild(photon);
    ring.appendChild(svgNode('circle', { cx: 100, cy: 100, r: 34.5, fill: 'none', 'stroke-width': 0.8, opacity: 0.8 }, { stroke: 'var(--rarity-gold-bright)' }));
    svg.appendChild(ring);
    return svg;
  }

  /**
   * Liquid Gold: molten metal, bright and dark streams of it folding into
   * each other and flowing on.
   */
  function liquidGoldArt(random, angle, animate) {
    var svg = svgCanvas();
    var flow = warp(svg, random, '0.011 0.016', 46, 1.3, animate ? [28, 72] : null, 4.4);
    var group = svgNode('g', { filter: flow });
    group.appendChild(svgNode('rect', { x: -60, y: -60, width: 320, height: 320, fill: 'var(--rarity-gold)' }));

    var shades = ['var(--rarity-gold-bright)', 'var(--rarity-gold-shine)', 'var(--rarity-gold-deep)', 'var(--rarity-gold-bright)', token('bronze')];
    var bands = svgNode('g');
    for (var y = -120, i = 0; y < 320; i++) {
      var height = between(random, 5, 20);
      bands.appendChild(svgNode('rect', { x: -80, y: y.toFixed(1), width: 360, height: height.toFixed(1), opacity: between(random, 0.55, 1).toFixed(2) }, {
        fill: shades[i % shades.length],
      }));
      y += height + between(random, 4, 22);
    }
    // The streams slide on, and back.
    loop(bands, animate, Object.assign({ attributeName: 'transform', type: 'translate', values: '0 -24;0 24;0 -24', dur: '10s' }, EASE_BACK_AND_FORTH), 'animateTransform');
    var turned = svgNode('g', { transform: 'rotate(' + angle + ' 100 100)' });
    turned.appendChild(bands);
    group.appendChild(turned);
    svg.appendChild(group);
    return svg;
  }

  /**
   * Bioluminescent: the deep sea at night - caustic light rippling through
   * the dark water, glowing trails swimming round and plankton pulsing
   * with light.
   */
  function bioluminescentArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(exclusiveToken('abyss'), token('teal'), 30)],
      [1, exclusiveToken('abyss')],
    ])));

    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.4,
      filter: noiseFill(svg, random, {
        type: 'turbulence', frequency: '0.022', drift: '0.03', seconds: 9, octaves: 2,
        alpha: '-4 0 0 0 1.25', color: exclusiveToken('biolume'),
      }, animate),
    }));

    var glow = glowFilter(svg, 1.8);
    var trails = svgNode('g', { filter: glow }, { fill: 'none', strokeLinecap: 'round' });
    [44, 60, 77].forEach(function (radius, index) {
      var trail = svgNode('circle', {
        cx: 100, cy: 100, r: radius, 'stroke-width': 1.3, 'stroke-dasharray': (14 + index * 6) + ' ' + (radius * 2.2).toFixed(0),
        'stroke-dashoffset': 0, opacity: 0.8,
      }, { stroke: index === 1 ? exclusiveToken('biolume-soft') : exclusiveToken('biolume') });
      loop(trail, animate, { attributeName: 'stroke-dashoffset', values: '0;' + (index % 2 ? '' : '-') + (radius * 2 * Math.PI).toFixed(0), dur: seconds(between(random, 5, 9)) });
      trails.appendChild(trail);
    });
    svg.appendChild(trails);

    var plankton = svgNode('g', { filter: glow });
    var hues = [exclusiveToken('biolume'), exclusiveToken('biolume-soft'), token('sky')];
    for (var i = 0; i < 48; i++) {
      var x = between(random, 6, 194);
      var y = between(random, 6, 194);
      var dot = svgNode('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: between(random, 0.5, 2).toFixed(2), opacity: 0.8 }, { fill: hues[i % hues.length] });
      var begin = seconds(-random() * 4);
      loop(dot, animate, Object.assign({ attributeName: 'opacity', values: '0.15;1;0.15', dur: seconds(between(random, 1.6, 4.5)), begin: begin }, EASE_BACK_AND_FORTH));
      loop(dot, animate, Object.assign({ attributeName: 'cy', values: [y, y - between(random, 3, 9), y].map(function (v) { return v.toFixed(1); }).join(';'), dur: seconds(between(random, 4, 8)), begin: begin }, EASE_BACK_AND_FORTH));
      plankton.appendChild(dot);
    }
    svg.appendChild(plankton);
    return svg;
  }

  /** A jagged bolt from `radius` out to the rim at `angle`, with a branch or two. */
  function boltPath(random, angle) {
    function strike(radius, heading, end) {
      var points = [polar(radius, heading)];
      while (radius < end) {
        radius += between(random, 5, 10);
        heading += between(random, -9, 9);
        points.push(polar(radius, heading));
      }
      return { d: 'M' + points.map(xy).join(' L'), points: points };
    }
    var main = strike(30, angle, 96);
    var d = main.d;
    for (var b = 0; b < 2; b++) {
      var from = main.points[2 + Math.floor(random() * (main.points.length - 4))];
      var dx = from.x - 100;
      var dy = from.y - 100;
      var branch = strike(Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx) * 180 / Math.PI + 90 + between(random, -30, 30), 96);
      d += ' ' + branch.d;
    }
    return d;
  }

  /**
   * Thunderstorm: churning storm clouds, slanting rain and lightning that
   * forks out to the rim, lighting up the whole sky as it strikes.
   */
  function thunderstormArt(random, animate) {
    var svg = svgCanvas();
    var storm = exclusiveToken('storm');
    var light = exclusiveToken('lightning');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '62%' }, [
      [0, mix(storm, token('lilac'), 18)],
      [1, mix(storm, 'var(--color-black)', 45)],
    ])));
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.85,
      filter: noiseFill(svg, random, {
        type: 'fractalNoise', frequency: '0.014 0.02', drift: '0.018 0.025', seconds: 12, octaves: 4,
        alpha: '2.6 0 0 0 -1.05', color: mix(light, storm, 55),
      }, animate),
    }));

    var rain = svgNode('g', {}, { stroke: light, strokeWidth: '0.5', opacity: '0.22' });
    for (var r = 0; r < 60; r++) {
      var x = between(random, -20, 210);
      var y = between(random, -20, 200);
      rain.appendChild(svgNode('line', { x1: x.toFixed(1), y1: y.toFixed(1), x2: (x - 3).toFixed(1), y2: (y + 9).toFixed(1) }));
    }
    loop(rain, animate, { attributeName: 'transform', type: 'translate', values: '0 -18;-6 18', dur: '0.45s' }, 'animateTransform');
    svg.appendChild(rain);

    var glow = glowFilter(svg, 2.2);
    [3.1, 4.3, 5.7].forEach(function (period, index) {
      var strikeAt = '0;0;1;0.1;1;0;0';
      var times = '0;0.55;0.57;0.6;0.63;0.7;1';
      var begin = seconds(-index * 1.3);
      var flash = svgNode('rect', { x: 0, y: 0, width: 200, height: 200, opacity: 0 }, { fill: light, mixBlendMode: 'screen' });
      loop(flash, animate, { attributeName: 'opacity', values: '0;0;0.3;0;0.22;0;0', keyTimes: times, dur: seconds(period), begin: begin });
      svg.appendChild(flash);
      var bolt = svgNode('path', {
        d: boltPath(random, between(random, 0, 360)),
        filter: glow, fill: 'none', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        // Still (or paused before it's played), one bolt caught mid-strike.
        opacity: index === 0 ? 1 : 0,
      }, { stroke: light });
      loop(bolt, animate, { attributeName: 'opacity', values: strikeAt, keyTimes: times, dur: seconds(period), begin: begin });
      svg.appendChild(bolt);
    });
    return svg;
  }

  /**
   * Synthwave Sunset: a striped neon sun sinking behind the mountains of a
   * retro horizon, and a glowing grid racing towards you below it.
   */
  function synthwaveArt(random, animate) {
    var svg = svgCanvas();
    var night = exclusiveToken('synth-night');
    var pink = exclusiveToken('neon-pink');
    var cyan = exclusiveToken('neon-cyan');
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 101,
      fill: gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0, night], [0.55, mix(pink, night, 50)], [1, exclusiveToken('sunset')],
      ]),
    }));
    stars(svg, random, animate, 24);

    // The sun, sliced by ever wider gaps towards the horizon.
    var mask = svgNode('mask', { id: 'vinyl-mask-' + (++filterCount) });
    mask.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: 'var(--color-text)' }));
    for (var g = 0, gy = 70; g < 6; g++) {
      mask.appendChild(svgNode('rect', { x: 0, y: gy.toFixed(1), width: 200, height: (1 + g * 0.8).toFixed(1) }, { fill: 'var(--color-black)' }));
      gy += 5 + g * 0.6;
    }
    var maskDefs = svgNode('defs');
    maskDefs.appendChild(mask);
    svg.appendChild(maskDefs);
    svg.appendChild(svgNode('circle', {
      cx: 100, cy: 70, r: 46,
      fill: gradient(svg, 'radial', {}, [[0.55, pink, 0.55], [1, pink, 0]]),
    }));
    var sun = svgNode('circle', {
      cx: 100, cy: 72, r: 32, mask: 'url(#' + mask.id + ')',
      fill: gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
        [0, exclusiveToken('sun')], [0.55, exclusiveToken('sunset')], [1, pink],
      ]),
    });
    svg.appendChild(sun);

    // Mountains along the horizon, outlined in neon.
    var ridge = ['-10 100'];
    for (var mx = -10; mx <= 210; mx += between(random, 8, 16)) {
      var edge = Math.abs(mx - 100) / 110;
      ridge.push(mx.toFixed(1) + ' ' + (100 - between(random, 2, 16) * (0.4 + edge)).toFixed(1));
    }
    ridge.push('210 100');
    svg.appendChild(svgNode('path', { d: 'M' + ridge.join(' L') + ' Z', 'stroke-width': 0.7 }, {
      fill: mix(night, pink, 18), stroke: cyan, strokeLinejoin: 'round',
    }));

    svg.appendChild(svgNode('rect', {
      x: 0, y: 100, width: 200, height: 100,
      fill: gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, mix(night, pink, 22)], [1, night]]),
    }));

    var grid = svgNode('g', { filter: glowFilter(svg, 1.1) }, { stroke: cyan, strokeWidth: '0.8' });
    for (var v = -12; v <= 12; v++) {
      grid.appendChild(svgNode('line', { x1: (100 + v * 3).toFixed(1), y1: 100, x2: (100 + v * 34).toFixed(1), y2: 200 }));
    }
    // Rows closer together towards the horizon; each glides down to the
    // next one's place, so the grid seems to rush on endlessly.
    var rows = 9;
    function rowY(position) {
      return 100 + 100 * Math.pow(position / rows, 2);
    }
    for (var k = 0; k < rows; k++) {
      var y = rowY(k + 0.5);
      var row = svgNode('line', { x1: -10, x2: 210, y1: y.toFixed(1), y2: y.toFixed(1) });
      var path = [];
      for (var step = 0; step <= 8; step++) {
        path.push(rowY(k + step / 8).toFixed(2));
      }
      loop(row, animate, { attributeName: 'y1', values: path.join(';'), dur: '1.1s' });
      loop(row, animate, { attributeName: 'y2', values: path.join(';'), dur: '1.1s' });
      grid.appendChild(row);
    }
    svg.appendChild(grid);
    svg.appendChild(svgNode('line', { x1: 0, x2: 200, y1: 100, y2: 100, 'stroke-width': 1.3, filter: glowFilter(svg, 1.4) }, { stroke: pink }));
    return svg;
  }

  /** An annulus sector from `r0` to `r1`, `a0` to `a1` degrees clockwise from the top. */
  function sectorPath(r0, r1, a0, a1) {
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + xy(polar(r0, a0)) + ' L' + xy(polar(r1, a0))
      + ' A' + r1 + ' ' + r1 + ' 0 ' + large + ' 1 ' + xy(polar(r1, a1))
      + ' L' + xy(polar(r0, a1))
      + ' A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + xy(polar(r0, a0)) + ' Z';
  }

  /**
   * Stained Glass: a cathedral rose window - rings of jewel-coloured glass
   * in black lead, petals round the middle and medallions round the rim,
   * with sunlight wandering across it.
   */
  function stainedGlassArt(random, animate) {
    var svg = svgCanvas();
    var lead = exclusiveToken('lead');
    svg.appendChild(fullRect(lead));
    var jewels = ['red', 'blue', 'green', 'gold', 'purple', 'teal', 'oxblood', 'sky', 'magenta', 'orange'].map(token);

    // Each ring repeats a few of the jewels, like a real rose window's symmetry.
    function scheme(size) {
      var picked = [];
      while (picked.length < size) {
        var jewel = jewels[Math.floor(random() * jewels.length)];
        if (picked.indexOf(jewel) === -1) {
          picked.push(jewel);
        }
      }
      return picked;
    }

    var glass = svgNode('g', {}, { stroke: lead, strokeWidth: '1.5', strokeLinejoin: 'round' });
    function pane(d, fill) {
      glass.appendChild(svgNode('path', { d: d }, { fill: fill }));
    }

    // Petals round the label, over a ring of glass.
    var inner = scheme(3);
    pane(sectorPath(28, 45, 0, 359.99), darker(inner[2], 25));
    for (var p = 0; p < 12; p++) {
      var mid = p * 30;
      pane('M' + xy(polar(28, mid)) + ' Q' + xy(polar(38, mid - 13)) + ' ' + xy(polar(46, mid))
        + ' Q' + xy(polar(38, mid + 13)) + ' ' + xy(polar(28, mid)) + ' Z', p % 2 ? inner[0] : lighter(inner[1], 10));
    }

    // A ring of panes, each split in two.
    var middle = scheme(3);
    for (var m = 0; m < 16; m++) {
      pane(sectorPath(45, 55, m * 22.5, (m + 1) * 22.5), m % 2 ? middle[0] : middle[1]);
      pane(sectorPath(55, 65, m * 22.5, (m + 1) * 22.5), m % 2 ? lighter(middle[2], 12) : darker(middle[0], 15));
    }

    // Round the rim, each pane holding a medallion.
    var outer = scheme(4);
    for (var o = 0; o < 24; o++) {
      pane(sectorPath(65, 88, o * 15, (o + 1) * 15), o % 2 ? outer[0] : outer[1]);
      var centre = polar(76.5, o * 15 + 7.5);
      glass.appendChild(svgNode('circle', { cx: centre.x.toFixed(1), cy: centre.y.toFixed(1), r: 4.4 }, { fill: o % 2 ? outer[2] : outer[3] }));
    }
    svg.appendChild(glass);

    var leading = svgNode('g', {}, { fill: 'none', stroke: lead, strokeWidth: '2.4' });
    [28, 45, 65, 88].forEach(function (radius) {
      leading.appendChild(svgNode('circle', { cx: 100, cy: 100, r: radius }));
    });
    svg.appendChild(leading);

    // Sunlight coming through, wandering across the window.
    var sunlight = svgNode('circle', {
      cx: 60, cy: 60, r: 80, opacity: 0.55,
      fill: gradient(svg, 'radial', {}, [[0, 'var(--color-text)', 0.8], [1, 'var(--color-text)', 0]]),
    }, { mixBlendMode: 'soft-light' });
    loop(sunlight, animate, Object.assign({ attributeName: 'cx', values: '50;150;50', dur: '11s' }, EASE_BACK_AND_FORTH));
    loop(sunlight, animate, Object.assign({ attributeName: 'cy', values: '60;140;60', dur: '7s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(sunlight);
    return svg;
  }

  /**
   * Inferno: a ring of fire roaring out from the label - tongues of deep
   * red, orange and white-hot yellow licking at the rim, embers flying off.
   */
  function infernoArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '50%' }, [
      [0.25, exclusiveToken('fire')],
      [0.45, exclusiveToken('fire-deep')],
      [1, mix(exclusiveToken('fire-deep'), 'var(--color-black)', 70)],
    ])));

    var flicker = warp(svg, random, '0.035 0.05', 16, 0.5, animate ? [9, 24] : null, 0.7);
    var fire = svgNode('g', { filter: flicker });
    [
      { color: exclusiveToken('fire-deep'), length: [44, 64], spread: 11, count: 18, turn: 40 },
      { color: exclusiveToken('fire'), length: [32, 50], spread: 9, count: 22, turn: -30 },
      { color: exclusiveToken('flame'), length: [20, 34], spread: 7, count: 24, turn: 26 },
      { color: exclusiveToken('flame-tip'), length: [9, 18], spread: 4.5, count: 26, turn: -20 },
    ].forEach(function (layer) {
      var tongues = turning(svgNode('g', {}, { fill: layer.color }), animate, layer.turn);
      for (var i = 0; i < layer.count; i++) {
        var angle = i * 360 / layer.count + between(random, -5, 5);
        var length = between(random, layer.length[0], layer.length[1]);
        var bend = between(random, -6, 6);
        tongues.appendChild(svgNode('path', {
          d: 'M' + xy(polar(26, angle - layer.spread))
            + ' Q' + xy(polar(26 + length * 0.55, angle - layer.spread * 1.1 + bend)) + ' ' + xy(polar(26 + length, angle + bend * 1.6))
            + ' Q' + xy(polar(26 + length * 0.55, angle + layer.spread * 1.1 + bend)) + ' ' + xy(polar(26, angle + layer.spread)) + ' Z',
        }));
      }
      fire.appendChild(tongues);
    });
    svg.appendChild(fire);

    // Embers flying off towards the rim.
    var embers = svgNode('g', { filter: glowFilter(svg, 1) });
    for (var e = 0; e < 28; e++) {
      var heading = between(random, 0, 360);
      var from = polar(between(random, 32, 44), heading);
      var to = polar(between(random, 84, 100), heading + between(random, -14, 14));
      var travel = seconds(between(random, 1.4, 3.2));
      var begin = seconds(-random() * 3);
      var still = polar(between(random, 40, 90), heading);
      var ember = svgNode('circle', { cx: still.x.toFixed(1), cy: still.y.toFixed(1), r: between(random, 0.6, 1.4).toFixed(2), opacity: 0.9 }, {
        fill: e % 3 ? exclusiveToken('flame') : exclusiveToken('flame-tip'),
      });
      loop(ember, animate, { attributeName: 'cx', values: from.x.toFixed(1) + ';' + to.x.toFixed(1), dur: travel, begin: begin });
      loop(ember, animate, { attributeName: 'cy', values: from.y.toFixed(1) + ';' + to.y.toFixed(1), dur: travel, begin: begin });
      loop(ember, animate, { attributeName: 'opacity', values: '1;0.9;0', dur: travel, begin: begin });
      embers.appendChild(ember);
    }
    svg.appendChild(embers);
    return svg;
  }

  /** The holographic foil's rainbow: pastel, twice round the record. */
  function holographicDrawing(drawing, angle) {
    var foil = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].map(function (name) {
      return lighter(token(name), 35);
    });
    drawing.background = 'conic-gradient(from ' + angle + 'deg, ' + foil.concat(foil, foil[0]).join(', ') + ')';
    drawing.finish = [
      // A bright band of light across it.
      'linear-gradient(' + (angle % 180) + 'deg, transparent 30%, ' + seeThrough('var(--color-text)', 50) + ' 46%, transparent 62%)',
      // Fine diffraction rings, which split the light into colours.
      'repeating-radial-gradient(circle, transparent 0 2px, ' + seeThrough('var(--color-text)', 24) + ' 3px, transparent 4px)',
      // A second rainbow across the first, for the shifting interference.
      'repeating-conic-gradient(from ' + (angle + 45) + 'deg, ' + seeThrough(token('sky'), 30) + ' 0 10deg, '
        + seeThrough(token('pink'), 30) + ' 10deg 20deg, ' + seeThrough(token('yellow'), 26) + ' 20deg 30deg)',
    ];
  }

  // The colours each exclusive's card and unboxing glow in.
  var EXCLUSIVE_GLOWS = {
    aurora: ['aurora-green', 'aurora-violet'],
    supernova: ['nova-flare', 'hot-white'],
    holographic: ['neon-cyan', 'neon-pink'],
    blackhole: ['plasma', 'flame'],
    liquidgold: ['flame', 'sun'],
    bioluminescent: ['biolume', 'biolume-soft'],
    thunderstorm: ['lightning', 'aurora-violet'],
    synthwave: ['neon-pink', 'neon-cyan'],
    stainedglass: ['sunset', 'aurora-teal'],
    inferno: ['fire', 'flame'],
  };

  /** A small round dot as a gradient layer (percent sizes need an ellipse). */
  function dot(color, size, x, y) {
    return 'radial-gradient(ellipse ' + pct(size) + ' ' + pct(size) + ' at ' + pct(x) + ' ' + pct(y) + ', '
      + color + ' 0 55%, transparent 80%)';
  }

  /**
   * How to draw a record: `art` (an SVG) or `background` layers for the
   * colour itself, how much to soften it, and `finish` layers on top -
   * glitter, brushed metal, light through a see-through record.
   */
  function drawingFor(spec, imageUrl, random, animate) {
    var colors = spec.colors.map(function (name) {
      var color = token(name);
      if (name === 'clear') {
        return seeThrough(color, 55);
      }
      return spec.tinted ? seeThrough(color, 72) : color;
    });
    var spectrum = SPECTRUM.map(function (name) {
      return spec.tinted ? seeThrough(token(name), 72) : token(name);
    });
    // A rainbow record uses the spectrum for its colours - after the base
    // colour, when one is named ("White With Rainbow Splatter").
    var rainbowOnly = spec.rainbow && !spec.named;
    if (spec.rainbow) {
      colors = spec.named ? [colors[0]].concat(spectrum) : spectrum.slice();
    }
    var c1 = colors[0];
    // Patterns need a second colour; a single one gets a contrasting partner.
    var contrast = spec.colors[0] === 'black' ? token('white') : token('black');
    var angle = Math.round(between(random, 0, 360));
    var drawing = { art: null, background: c1, blur: 0, finish: [] };

    switch (spec.pattern) {
      case 'aurora':
        drawing.art = auroraArt(random, animate);
        break;

      case 'supernova':
        drawing.art = supernovaArt(random, animate);
        break;

      case 'holographic':
        holographicDrawing(drawing, angle);
        break;

      case 'blackhole':
        drawing.art = blackHoleArt(random, angle, animate);
        break;

      case 'liquidgold':
        drawing.art = liquidGoldArt(random, angle, animate);
        break;

      case 'bioluminescent':
        drawing.art = bioluminescentArt(random, animate);
        break;

      case 'thunderstorm':
        drawing.art = thunderstormArt(random, animate);
        break;

      case 'synthwave':
        drawing.art = synthwaveArt(random, animate);
        break;

      case 'stainedglass':
        drawing.art = stainedGlassArt(random, animate);
        break;

      case 'inferno':
        drawing.art = infernoArt(random, animate);
        break;

      case 'picture':
        drawing.background = imageUrl ? 'url(' + JSON.stringify(imageUrl) + ') center / cover no-repeat' : c1;
        break;

      case 'peppermint':
        drawing.art = peppermintArt(colors, random, angle, animate);
        break;

      case 'zoetrope': {
        // Black unless named, with figures that stand out from it.
        var light = LIGHT_COLORS.indexOf(spec.colors[0]) !== -1;
        var figures = [
          c1,
          colors[1] || token(light ? 'red' : 'yellow'),
          colors[2] || token(light ? 'blue' : 'pink'),
        ];
        // With cover art, the frames are made from it; without, drawn figures.
        drawing.art = imageUrl
          ? coverZoetropeArt(figures, random, angle, imageUrl)
          : zoetropeArt(figures, random, angle);
        break;
      }

      case 'lava': {
        var waxes;
        var lamp;
        if (rainbowOnly) {
          // "Rainbow Lava": every colour on black.
          lamp = token('black');
          waxes = spectrum;
        } else if (colors.length > 1) {
          // "Black & Orange Lava": the first colour is the lamp, the rest wax.
          lamp = c1;
          waxes = colors.slice(1);
        } else if (spec.named) {
          // "Red Lava": red wax in a deep red lamp.
          lamp = darker(c1, 65);
          waxes = [c1, lighter(c1, 30)];
        } else {
          // Plain "Lava": the classic orange and red on black.
          lamp = token('black');
          waxes = [token('orange'), token('red')];
        }
        drawing.art = lavaArt(lamp, waxes, random, animate);
        break;
      }

      case 'smash':
        drawing.art = smashArt(colors.length > 1 ? colors : [c1, contrast], random, animate);
        break;

      case 'marble':
        drawing.art = marbleArt(colors.length > 1 ? colors : [c1, lighter(c1, 55), darker(c1, 30)], random, angle);
        break;

      case 'swirl':
        drawing.art = rainbowOnly
          ? swirlArt(spectrum, random, angle, true)
          : swirlArt(colors.length > 1 ? colors : [c1, contrast], random, angle);
        break;

      case 'smoke':
        drawing.art = smokeArt(colors, random);
        break;

      case 'splatter': {
        // "Red Splatter" alone splatters red onto black (or clear); so does
        // a plain "Rainbow Splatter", in every colour.
        var base = colors.length > 1 && !rainbowOnly ? c1 : (spec.translucent ? seeThrough(token('clear'), 55) : token('black'));
        var paints = spec.rainbow ? spectrum : colors.length > 1 ? colors.slice(1) : [c1];
        var layers = [];
        for (var s = 0; s < 40; s++) {
          layers.push(dot(paints[s % paints.length], between(random, 1.2, s < 8 ? 7 : 3.5), between(random, 6, 94), between(random, 6, 94)));
        }
        layers.push(base);
        drawing.background = layers.join(', ');
        break;
      }

      case 'split':
        drawing.background = 'linear-gradient(' + Math.round(between(random, 80, 100)) + 'deg, '
          + c1 + ' 50%, ' + (colors[1] || contrast) + ' 50%)';
        break;

      case 'stripe':
        drawing.background = spec.rainbow
          ? 'conic-gradient(from ' + angle + 'deg, ' + spectrum.map(function (color, index) {
            return color + ' 0 ' + ((index + 1) * 100 / spectrum.length).toFixed(1) + '%';
          }).join(', ') + ')'
          : colors.length > 2
          ? 'conic-gradient(from ' + angle + 'deg, ' + c1 + ' 0 33.3%, ' + colors[1] + ' 0 66.6%, ' + colors[2] + ' 0)'
          : 'conic-gradient(from ' + angle + 'deg, ' + c1 + ' 0 25%, ' + (colors[1] || contrast) + ' 0 50%, '
            + c1 + ' 0 75%, ' + (colors[1] || contrast) + ' 0)';
        break;

      case 'core':
        drawing.background = 'radial-gradient(circle at ' + pct(between(random, 45, 55)) + ' ' + pct(between(random, 45, 55))
          + ', ' + c1 + ' 0 24%, ' + colors[1] + ' 40%)';
        drawing.blur = 3;
        break;

      default:
        if (rainbowOnly) {
          // Plain "Rainbow": the spectrum all the way round.
          drawing.background = 'conic-gradient(from ' + angle + 'deg, ' + spectrum.concat(spectrum[0]).join(', ') + ')';
          break;
        }
        // Plain colour, with a little depth so it doesn't look flat.
        drawing.background = 'radial-gradient(circle at 50% 50%, ' + lighter(c1, 6) + ', ' + c1 + ' 55%, ' + darker(c1, 18) + ')';
    }

    // A wheel exclusive is exactly as drawn above.
    if (spec.exclusive) {
      return drawing;
    }

    if (spec.glitter) {
      var sparkle = spec.glitterColor ? lighter(token(spec.glitterColor), 25) : 'var(--color-text)';
      for (var g = 0; g < 60; g++) {
        drawing.finish.push(dot(sparkle, between(random, 0.7, 1.6), between(random, 5, 95), between(random, 5, 95)));
      }
    }

    // Brushed metal: bands of light and shadow that shimmer as it spins.
    if (spec.metallic) {
      drawing.finish.push('repeating-conic-gradient(from ' + angle + 'deg, '
        + seeThrough('var(--color-text)', 34) + ' 0deg 3deg, transparent 9deg 20deg, '
        + seeThrough('var(--color-black)', 30) + ' 26deg 29deg, transparent 35deg 45deg)');
    }

    // Light coming through a see-through record.
    if (spec.translucent) {
      drawing.finish.push('radial-gradient(circle at 32% 28%, ' + seeThrough('var(--color-text)', 35) + ', transparent 60%)');
    }

    return drawing;
  }

  function div(className) {
    var node = document.createElement('div');
    node.className = className;
    return node;
  }

  /**
   * The record as an element: the spinning disc (colour surface, finish,
   * grooves, centre label with the cover art) under a still reflection.
   */
  function render(spec, options) {
    var imageUrl = options && options.imageUrl;
    var random = randomFrom((options && options.seed) || spec.colors.join());

    var vinyl = div('vinyl'
      + (spec.metallic ? ' vinyl--metallic' : '')
      + (spec.pattern === 'peppermint' ? ' vinyl--glossy' : '')
      + (spec.pattern === 'zoetrope' ? ' vinyl--zoetrope' : '')
      + (spec.translucent ? ' vinyl--translucent' : '')
      + (spec.glow ? ' vinyl--glow' : '')
      + (spec.exclusive ? ' vinyl--exclusive vinyl--' + spec.pattern : ''));
    vinyl.style.setProperty('--vinyl-spin', (60 / (spec.rpm === 33 ? 100 / 3 : spec.rpm)).toFixed(2) + 's');

    var disc = div('vinyl__disc');
    var drawing = drawingFor(spec, imageUrl, random, true);

    var surface = div('vinyl__surface');
    surface.style.background = drawing.art ? 'none' : drawing.background;
    if (drawing.art) {
      surface.appendChild(drawing.art);
    }
    if (drawing.blur) {
      surface.style.setProperty('--vinyl-blur', drawing.blur + 'px');
    }
    disc.appendChild(surface);

    if (drawing.finish.length) {
      var finish = div('vinyl__finish');
      finish.style.background = drawing.finish.join(', ');
      disc.appendChild(finish);
    }
    disc.appendChild(div('vinyl__grooves'));

    var label = div('vinyl__label' + (spec.pattern === 'picture' ? ' vinyl__label--bare' : ''));
    if (imageUrl && spec.pattern !== 'picture') {
      label.style.backgroundImage = 'url(' + JSON.stringify(imageUrl) + ')';
    }
    disc.appendChild(label);

    vinyl.appendChild(disc);
    vinyl.appendChild(div('vinyl__sheen'));
    return vinyl;
  }

  /**
   * The record's pattern once more, as a backdrop for the card's text: the
   * same drawing (same seed, so the same marbling), covering the box rather
   * than stretched to it, and never animated.
   */
  function backdrop(spec, options) {
    var imageUrl = options && options.imageUrl;
    var random = randomFrom((options && options.seed) || spec.colors.join());
    var drawing = drawingFor(spec, imageUrl, random, false);

    var node = div('vinyl-backdrop');
    var pattern = div('vinyl-backdrop__pattern');
    pattern.style.background = drawing.art ? 'none' : drawing.background;
    if (drawing.art) {
      drawing.art.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      pattern.appendChild(drawing.art);
    }
    if (drawing.finish.length) {
      var finish = div('vinyl__finish');
      finish.style.background = drawing.finish.join(', ');
      pattern.appendChild(finish);
    }
    node.appendChild(pattern);
    return node;
  }

  /**
   * Starts or pauses a record's SVG animations (the peppermint twist, the
   * smash, the lava lamp, the wheel exclusives). CSS
   * handles the spin; this is for the shape animations CSS can't reach.
   * Reduced motion keeps them still.
   */
  function setPlaying(vinyl, playing) {
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.prototype.forEach.call(vinyl.querySelectorAll('svg'), function (svg) {
      if (typeof svg.pauseAnimations !== 'function') {
        return;
      }
      if (playing && !still) {
        svg.unpauseAnimations();
      } else {
        svg.pauseAnimations();
      }
    });
  }

  /**
   * The colours the card itself glows in: the record's first real colour,
   * and its second one for the outer halo. Plain black glows silver - a
   * black glow wouldn't show on the dark page.
   */
  function glowColors(spec) {
    if (spec.exclusive) {
      return {
        glow: exclusiveToken(EXCLUSIVE_GLOWS[spec.pattern][0]),
        accent: exclusiveToken(EXCLUSIVE_GLOWS[spec.pattern][1]),
      };
    }
    if (spec.rainbow && !spec.named) {
      return { glow: token('orange'), accent: token('blue') };
    }
    var visible = spec.colors.filter(function (name) {
      return name !== 'black';
    });
    var first = visible[0] || 'silver';
    return {
      glow: token(first === 'clear' ? 'white' : first),
      accent: token(visible[1] || spec.glitterColor || first),
    };
  }

  MusicHub.vinyl = {
    describe: describe,
    render: render,
    backdrop: backdrop,
    setPlaying: setPlaying,
    glowColors: glowColors,
    findColors: findColors,
    ZOETROPE_FRAMES: ZOETROPE_FRAMES,
    ZOETROPE_TURN_MS: ZOETROPE_TURN_MS,
  };
})(window.MusicHub);
