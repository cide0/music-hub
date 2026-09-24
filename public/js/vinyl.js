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

  // The record's pattern; the first one that matches wins.
  var PATTERNS = [
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
  ];

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
    };
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Frames around a zoetrope's rings. Must match the steps() count on
  // .vinyl--zoetrope .vinyl__disc in style.css: the disc turns one frame
  // slot per step.
  var ZOETROPE_FRAMES = 12;
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
   * forth, so the shapes flow.
   */
  function warp(svg, random, frequency, scale, softness, swell) {
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
          dur: '3.6s',
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
      + (spec.glow ? ' vinyl--glow' : ''));
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
   * smash, the lava lamp). CSS
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
  };
})(window.MusicHub);
