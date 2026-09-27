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
    ['koipond', /koi/],
    ['kaleidoscope', /kaleidoscope/],
    ['digitalrain', /digital rain|matrix/],
    ['eclipse', /eclipse/],
    ['hyperspace', /hyperspace|warp speed/],
    ['cherryblossom', /cherry blossom|sakura/],
    ['circuit', /circuit/],
    ['radar', /radar/],
    ['plasmaglobe', /plasma globe|tesla/],
    ['equalizer', /equali[sz]er/],
    ['fireworks', /fireworks?/],
    ['glitch', /glitch/],
    ['geode', /geode|amethyst/],
    ['lasershow', /laser/],
    ['jellyfish', /jellyfish/],
    ['helix', /double helix|\bdna\b/],
    ['atomic', /\batom/],
    ['neoncity', /neon city/],
    ['portal', /\bportal\b/],
    ['disco', /disco ball/],
    ['peacock', /peacock/],
    ['tigereye', /tiger/],
    ['murmuration', /murmuration/],
    ['honeycomb', /honeycomb/],
    ['monarch', /monarch/],
    ['raven', /\braven|\bcrows?\b/],
    ['wolfmoon', /wolf/],
    ['fireflies', /firefl/],
    ['serpent', /serpent/],
    ['whalesong', /whale/],
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
   * The Daily Spin's forty wheel exclusives, each drawn by its own function
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
   * Aurora Borealis: curtains of green, teal and violet light across a
   * starry night sky - folds rippling along their bright lower edges as
   * they drift, stretching taller and sinking back, surging brighter and
   * dimmer, flares of light racing along them and rays flickering up
   * out of them like searchlights.
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
    var folds = warp(svg, random, '0.04 0.006', 24, 1.2, animate ? [10, 40] : null, 3);
    var sky = svgNode('g', { filter: folds }, { mixBlendMode: 'screen' });
    var FRAMES = 10;
    [
      { color: exclusiveToken('aurora-green'), angle: -18, y: 66, height: 46 },
      { color: exclusiveToken('aurora-teal'), angle: 28, y: 110, height: 36 },
      { color: exclusiveToken('aurora-violet'), angle: -56, y: 138, height: 32 },
      { color: exclusiveToken('aurora-green'), angle: 72, y: 44, height: 28 },
      { color: exclusiveToken('aurora-violet'), angle: 140, y: 58, height: 24 },
      // The great green curtains, low round the other side.
      { color: exclusiveToken('aurora-green'), angle: 196, y: 64, height: 48 },
      { color: exclusiveToken('aurora-green'), angle: 248, y: 40, height: 34 },
    ].forEach(function (curtain) {
      // Bright along the lower edge, fading out upwards, like the real thing.
      var fill = gradient(svg, 'linear', { x1: '0', y1: '1', x2: '0', y2: '0' }, [
        [0, curtain.color, 0], [0.1, curtain.color, 0.95], [0.4, curtain.color, 0.5], [1, curtain.color, 0],
      ]);
      var wave = between(random, 9, 18);
      var length = between(random, 55, 90);
      var phase = random() * Math.PI * 2;
      var swell = random() * Math.PI * 2;
      // The lower edge at `x`, `t` of the way through the ripple's loop.
      function edge(x, t) {
        var turn = t * Math.PI * 2;
        return curtain.y + Math.sin(x / length * 2 * Math.PI + phase - turn) * wave * (1 + 0.35 * Math.sin(turn + swell));
      }
      // The curtain `t` of the way through: its folds rolling along its
      // edge, and it stretching taller and sinking back.
      function shape(t) {
        var tall = curtain.height * (1 + 0.4 * Math.sin(t * Math.PI * 2 + swell));
        var top = [];
        var bottom = [];
        for (var x = -50; x <= 250; x += 10) {
          var y = edge(x, t);
          top.push(x + ' ' + (y - tall).toFixed(1));
          bottom.unshift(x + ' ' + y.toFixed(1));
        }
        return 'M' + top.concat(bottom).join(' L') + ' Z';
      }
      var shapes = [];
      for (var f = 0; f <= FRAMES; f++) {
        shapes.push(shape(f / FRAMES));
      }
      var ripple = { attributeName: 'd', values: shapes.join(';'), dur: seconds(between(random, 3, 5)) };

      var drift = svgNode('g', { transform: 'rotate(' + curtain.angle + ' 100 100)' });
      var sway = svgNode('g');
      loop(sway, animate, Object.assign({
        attributeName: 'transform', type: 'translate',
        values: '0 0;' + between(random, -35, 35).toFixed(1) + ' ' + between(random, -10, 10).toFixed(1) + ';0 0',
        dur: seconds(between(random, 4, 7)),
      }, EASE_BACK_AND_FORTH), 'animateTransform');
      var band = svgNode('path', { d: shapes[0], fill: fill });
      loop(band, animate, ripple);
      // Surging brighter and dimmer, on its own slow beat.
      loop(band, animate, Object.assign({ attributeName: 'opacity', values: '0.35;1;0.35', dur: seconds(between(random, 1.5, 3)), begin: seconds(-random() * 3) }, EASE_BACK_AND_FORTH));
      sway.appendChild(band);

      // A flare of light racing along the curtain now and then.
      var flare = gradient(svg, 'linear', { x1: '0', y1: '0', x2: '1', y2: '0' }, [
        [0, curtain.color, 0], [0.42, curtain.color, 0], [0.5, lighter(curtain.color, 55), 0.9], [0.58, curtain.color, 0], [1, curtain.color, 0],
      ]);
      var flash = svgNode('path', { d: shapes[0], opacity: 0.8 });
      flash.setAttribute('fill', flare);
      loop(flash, animate, ripple);
      sway.appendChild(flash);
      // The gradient itself slides across: flare is its url(#id).
      loop(svg.querySelector(flare.slice(4, -1)), animate, {
        attributeName: 'gradientTransform', type: 'translate', values: '-0.7 0;0.7 0;0.7 0',
        keyTimes: '0;0.45;1', dur: seconds(between(random, 2, 3.5)), begin: seconds(-random() * 3.5),
      }, 'animateTransform');

      // Rays: thin pillars of light rising out of the curtain, flickering.
      var rayFill = gradient(svg, 'linear', { x1: '0', y1: '1', x2: '0', y2: '0' }, [
        [0, lighter(curtain.color, 40), 0.9], [1, curtain.color, 0],
      ]);
      for (var r = 0; r < 24; r++) {
        var x = between(random, -20, 220);
        var rise = curtain.height * between(random, 0.8, 1.6);
        var foot = edge(x, 0);
        var ray = svgNode('rect', { x: x.toFixed(1), y: (foot - rise).toFixed(1), width: between(random, 1, 2.6).toFixed(2), height: rise.toFixed(1), fill: rayFill, opacity: 0.5 });
        loop(ray, animate, {
          attributeName: 'opacity', dur: seconds(between(random, 0.5, 1.2)), begin: seconds(-random() * 2),
          values: jumpy(5, function () { return random() < 0.35 ? between(random, 0.8, 1).toFixed(2) : between(random, 0, 0.3).toFixed(2); }),
        });
        sway.appendChild(ray);
      }
      drift.appendChild(sway);
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
   * Liquid Gold: molten metal, streams of it folding into each other and
   * flowing on - each stream a rounded ridge, shadowed amber at its edges,
   * polished gold across it and a thin pale glint along its crest, the way
   * light sits on real metal rather than flat yellow. The streams slide
   * and turn while the melt keeps churning them, and light glides across.
   */
  function liquidGoldArt(random, angle, animate) {
    var svg = svgCanvas();
    var shadow = exclusiveToken('gold-shadow');
    var dark = exclusiveToken('gold-dark');
    var gold = exclusiveToken('gold');
    var warm = exclusiveToken('gold-warm');
    var light = exclusiveToken('gold-light');
    var glint = exclusiveToken('gold-glint');
    var flow = warp(svg, random, '0.011 0.016', 46, 1.1, animate ? [26, 78] : null, 2.2);
    var group = svgNode('g', { filter: flow });
    group.appendChild(svgNode('rect', { x: -60, y: -60, width: 320, height: 320 }, { fill: dark }));

    // The ridges' shading, across each stream: dark edge, gold, a glint on
    // the crest, gold, dark edge. Brighter streams and duller ones.
    var ridges = [
      gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, shadow], [0.3, gold], [0.48, light], [0.52, glint], [0.6, warm], [1, shadow]]),
      gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, dark], [0.4, warm], [0.55, light], [0.7, gold], [1, shadow]]),
      gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, shadow], [0.45, dark], [0.6, gold], [1, shadow]]),
      gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, shadow], [0.35, warm], [0.5, glint], [0.58, light], [0.75, gold], [1, dark]]),
    ];
    var bands = svgNode('g');
    for (var y = -140, i = 0; y < 340; i++) {
      var height = between(random, 7, 24);
      bands.appendChild(svgNode('rect', { x: -100, y: y.toFixed(1), width: 400, height: height.toFixed(1), fill: ridges[i % ridges.length] }));
      y += height + between(random, 1, 10);
    }
    // The streams slide on and back, quickly...
    loop(bands, animate, Object.assign({ attributeName: 'transform', type: 'translate', values: '0 -34;0 34;0 -34', dur: '4.2s' }, EASE_BACK_AND_FORTH), 'animateTransform');
    // ... while the whole melt turns, so the folds never settle.
    var turned = turning(svgNode('g'), animate, 18);
    var tilted = svgNode('g', { transform: 'rotate(' + angle + ' 100 100)' });
    tilted.appendChild(bands);
    turned.appendChild(tilted);
    group.appendChild(turned);
    svg.appendChild(group);

    // Light gliding over the metal.
    var shine = svgNode('rect', {
      // Still, caught part way across.
      x: animate ? -200 : -90, y: 0, width: 200, height: 200, opacity: 0.55,
      fill: gradient(svg, 'linear', { x1: '0', y1: '0', x2: '1', y2: '0.35' }, [[0, glint, 0], [0.5, glint, 0.7], [1, glint, 0]]),
    }, { mixBlendMode: 'soft-light' });
    loop(shine, animate, { attributeName: 'x', values: '-200;200', dur: '3.2s' });
    svg.appendChild(shine);
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

  /**
   * A jagged bolt at `angle`, from radius `from` out to `to` (the label's
   * edge to the rim by default), with `branches` forks off it (two by default).
   */
  function boltPath(random, angle, from, to, branches) {
    from = from || 30;
    to = to || 96;
    branches = branches === undefined ? 2 : branches;
    function strike(radius, heading, end) {
      var points = [polar(radius, heading)];
      while (radius < end) {
        radius += between(random, 5, 10);
        heading += between(random, -9, 9);
        points.push(polar(radius, heading));
      }
      return { d: 'M' + points.map(xy).join(' L'), points: points };
    }
    var main = strike(from, angle, to);
    var d = main.d;
    // Forks start off the middle of the bolt, never its very ends.
    var forkable = main.points.length - 4;
    for (var b = 0; b < branches && forkable > 0; b++) {
      var fork = main.points[2 + Math.floor(random() * forkable)];
      var dx = fork.x - 100;
      var dy = fork.y - 100;
      var branch = strike(Math.sqrt(dx * dx + dy * dy), Math.atan2(dy, dx) * 180 / Math.PI + 90 + between(random, -30, 30), to);
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
    var strikeAt = '0;0;1;0.1;1;0;0';
    var times = '0;0.55;0.57;0.6;0.63;0.7;1';
    // The big strikes, a third of the way round from each other, each
    // lighting up the whole sky.
    var turn = between(random, 0, 360);
    [3.1, 4.3, 5.7].forEach(function (period, index) {
      var begin = seconds(-index * 1.3);
      var flash = svgNode('rect', { x: 0, y: 0, width: 200, height: 200, opacity: 0 }, { fill: light, mixBlendMode: 'screen' });
      loop(flash, animate, { attributeName: 'opacity', values: '0;0;0.3;0;0.22;0;0', keyTimes: times, dur: seconds(period), begin: begin });
      svg.appendChild(flash);
      var bolt = svgNode('path', {
        d: boltPath(random, turn + index * 120 + between(random, -25, 25)),
        filter: glow, fill: 'none', 'stroke-width': 1.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        // Still (or paused before it's played), one bolt caught mid-strike.
        opacity: index === 0 ? 1 : 0,
      }, { stroke: light });
      loop(bolt, animate, { attributeName: 'opacity', values: strikeAt, keyTimes: times, dur: seconds(period), begin: begin });
      svg.appendChild(bolt);
    });
    // Smaller flickers in the gaps between them, somewhere out in the clouds
    // rather than from the label, each on its own beat.
    for (var f = 0; f < 6; f++) {
      var start = between(random, 34, 62);
      var flicker = svgNode('path', {
        d: boltPath(random, turn + 60 + f * 60 + between(random, -20, 20), start, Math.min(96, start + between(random, 22, 40)), 1),
        filter: glow, fill: 'none', 'stroke-width': 0.9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0,
      }, { stroke: light });
      loop(flicker, animate, {
        attributeName: 'opacity', values: '0;0;0.85;0.05;0.7;0;0', keyTimes: '0;0.4;0.42;0.45;0.48;0.53;1',
        dur: seconds(between(random, 2.2, 4.8)), begin: seconds(-random() * 5),
      });
      svg.appendChild(flicker);
    }
    return svg;
  }

  /**
   * Synthwave Sunset: a striped neon sun sinking behind the mountains of a
   * retro horizon, and a glowing grid racing towards you below it. The
   * sun's stripes slide down it and its glow breathes, neon runs along the
   * ridge and now and then a shooting star streaks across the sky.
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
    // Filled at the end, so the shooting stars' dice don't reshape the rest.
    var shootingStars = svg.appendChild(svgNode('g', {}, { fill: 'none', strokeLinecap: 'round' }));

    // The sun, sliced by ever wider gaps towards the horizon - from its
    // top, since the label hides its lower half. Each gap slides down to
    // the next one's place, thickening as it goes, so the stripes seem to
    // pour down the sun endlessly.
    var mask = svgNode('mask', { id: 'vinyl-mask-' + (++filterCount) });
    mask.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200 }, { fill: 'var(--color-text)' }));
    function gapY(position) {
      return 44 + position * 6.4 + position * position * 0.25;
    }
    function gapHeight(position) {
      return 0.2 + position * 0.55;
    }
    for (var g = 0; g < 8; g++) {
      var gap = svgNode('rect', { x: 0, y: gapY(g + 0.5).toFixed(1), width: 200, height: gapHeight(g + 0.5).toFixed(1) }, { fill: 'var(--color-black)' });
      var ys = [];
      var heights = [];
      for (var gs = 0; gs <= 8; gs++) {
        ys.push(gapY(g + gs / 8).toFixed(2));
        heights.push(gapHeight(g + gs / 8).toFixed(2));
      }
      loop(gap, animate, { attributeName: 'y', values: ys.join(';'), dur: '2.6s' });
      loop(gap, animate, { attributeName: 'height', values: heights.join(';'), dur: '2.6s' });
      mask.appendChild(gap);
    }
    var maskDefs = svgNode('defs');
    maskDefs.appendChild(mask);
    svg.appendChild(maskDefs);
    var halo = svgNode('circle', {
      cx: 100, cy: 70, r: 46,
      fill: gradient(svg, 'radial', {}, [[0.55, pink, 0.55], [1, pink, 0]]),
    });
    loop(halo, animate, Object.assign({ attributeName: 'r', values: '44;52;44', dur: '3.2s' }, EASE_BACK_AND_FORTH));
    loop(halo, animate, Object.assign({ attributeName: 'opacity', values: '0.8;1;0.8', dur: '3.2s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(halo);
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
    // Streaks of neon racing along the ridge, pink one way and cyan the other.
    var skyline = 'M' + ridge.slice(1, -1).join(' L');
    var runners = svgNode('g', { filter: glowFilter(svg, 1.2) }, { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' });
    [[pink, '0;-100', 4.2], [cyan, '-50;50', 5.6]].forEach(function (runner) {
      var streak = svgNode('path', {
        d: skyline, pathLength: 100, 'stroke-width': 1.1, 'stroke-dasharray': '9 91',
        'stroke-dashoffset': runner[1].split(';')[0],
      }, { stroke: runner[0] });
      loop(streak, animate, { attributeName: 'stroke-dashoffset', values: runner[1], dur: seconds(runner[2]) });
      runners.appendChild(streak);
    });
    svg.appendChild(runners);

    svg.appendChild(svgNode('rect', {
      x: 0, y: 100, width: 200, height: 100,
      fill: gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, mix(night, pink, 22)], [1, night]]),
    }));

    // The grid, rolling like a swell: rows closer together towards the
    // horizon, each gliding down past the next one's place, so the grid
    // seems to rush on endlessly, while waves run across it - smaller
    // towards the horizon - bending rows and lines alike. One loop moves
    // the rows two places on and the waves one wavelength, so it joins up.
    var grid = svgNode('g', { filter: glowFilter(svg, 1.1) }, { fill: 'none', stroke: cyan, strokeWidth: '0.8', strokeLinejoin: 'round' });
    var rows = 9;
    var frames = 16;
    var GRID_LOOP = '2.2s';
    // Where on the grid `u` (in columns, 0 the middle) and `position` (in
    // rows, 0 the horizon) is drawn, `t` of the way through the loop.
    function gridPoint(u, position, t) {
      var depth = Math.pow(Math.max(0, position) / rows, 2);
      var phase = 2 * Math.PI * t;
      var swell = 0.75 * Math.sin(1.1 * u + 1.3 * position - phase) + 0.25 * Math.sin(0.45 * u - phase);
      // Tall enough to read on a spinning record, flattening towards the
      // horizon - but never so tall that neighbouring rows cross.
      var height = 12 * Math.pow(Math.max(0, position) / rows, 1.5);
      return (100 + u * (3 + 31 * depth)).toFixed(1) + ' ' + (100 + 100 * depth - height * swell).toFixed(1);
    }
    function gridLine(points, t) {
      return 'M' + points.map(function (point) {
        return gridPoint(point[0], point[1], t);
      }).join(' L');
    }
    // `pointsAt(t)` along one line; drawn still at the loop's middle.
    function gridStrand(pointsAt) {
      var strand = svgNode('path', { d: gridLine(pointsAt(0.5), 0.5) });
      var shapes = [];
      for (var frame = 0; frame <= frames; frame++) {
        shapes.push(gridLine(pointsAt(frame / frames), frame / frames));
      }
      loop(strand, animate, { attributeName: 'd', values: shapes.join(';'), dur: GRID_LOOP });
      grid.appendChild(strand);
    }
    for (var v = -12; v <= 12; v++) {
      gridStrand(function (t) {
        var points = [];
        for (var along = 0; along <= 13; along++) {
          points.push([v, rows * along / 13]);
        }
        return points;
      });
    }
    // Rows from just behind the horizon (waiting on it) to past the rim.
    for (var k = 0; k <= rows; k++) {
      gridStrand(function (t) {
        var position = k - 1 + 2 * t;
        var reach = 110 / (3 + 31 * Math.pow(Math.max(0, position) / rows, 2));
        var points = [];
        for (var across = 0; across <= 19; across++) {
          points.push([-reach + 2 * reach * across / 19, position]);
        }
        return points;
      });
    }
    svg.appendChild(grid);
    // The horizon's neon tube, flickering now and then.
    var horizon = svgNode('line', { x1: 0, x2: 200, y1: 100, y2: 100, 'stroke-width': 1.3, filter: glowFilter(svg, 1.4) }, { stroke: pink });
    loop(horizon, animate, { attributeName: 'opacity', values: '1;1;0.45;1;0.7;1;1', keyTimes: '0;0.62;0.64;0.67;0.7;0.73;1', dur: '3.7s' });
    svg.appendChild(horizon);

    // Shooting stars: a short streak dashed along a line across the sky,
    // shot through once each loop and gone the rest of the time.
    for (var s = 0; s < 2; s++) {
      var fromX = between(random, 30, 120);
      var fromY = between(random, 14, 40);
      var toX = fromX + between(random, 40, 60);
      var toY = fromY + between(random, 14, 24);
      var trail = svgNode('path', {
        d: 'M' + fromX.toFixed(1) + ' ' + fromY.toFixed(1) + ' L' + toX.toFixed(1) + ' ' + toY.toFixed(1),
        pathLength: 100, 'stroke-width': 0.9, 'stroke-dasharray': '22 200', 'stroke-dashoffset': 22,
      }, { stroke: exclusiveToken('star') });
      var shoot = { keyTimes: '0;0.8;0.88;1', dur: seconds(between(random, 5.5, 8.5)), begin: seconds(-random() * 6) };
      loop(trail, animate, Object.assign({ attributeName: 'stroke-dashoffset', values: '22;22;-100;-100' }, shoot));
      shootingStars.appendChild(trail);
    }
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
   * Stained Glass: a cathedral rose window - sharp shards of glass, each
   * its own jewel colour and lit from behind, set in thick black lead. A
   * twelvefold lattice of diamonds grows out from the label, the bigger
   * ones split into triangles towards the rim. The panes sit dim, and up
   * to fifteen at a time, in a random order, light up; sunlight wanders
   * across it all.
   */
  function stainedGlassArt(random, animate) {
    var svg = svgCanvas();
    var lead = exclusiveToken('lead');
    svg.appendChild(fullRect(lead));

    // Every jewel glows: brightest in the middle of its pane, deeper at the lead.
    var glows = ['red', 'blue', 'green', 'gold', 'purple', 'teal', 'magenta', 'orange', 'sky'].map(function (name) {
      var color = token(name);
      return gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '65%' }, [
        [0, lighter(color, 45)], [0.5, color], [1, darker(color, 40)],
      ]);
    });

    // Rings of lead joints, every other one turned half a step, so that
    // joints on rings k, k+1 and k+2 make a diamond. The rings spread
    // further apart outwards, keeping the diamonds about as tall as wide.
    var RADII = [24, 31, 40, 52, 68, 88, 114, 148];
    var SIDES = 12;
    var rings = RADII.map(function (radius, k) {
      var joints = [];
      for (var i = 0; i < SIDES; i++) {
        // Set by hand: out of true, just a little.
        var wobble = k < 2 ? 0 : radius * 0.02;
        joints.push(polar(radius + between(random, -wobble, wobble), i * 30 + (k % 2 ? 15 : 0) + between(random, -wobble / 4, wobble / 4)));
      }
      return joints;
    });
    function joint(k, i) {
      return rings[k][(i + SIDES) % SIDES];
    }

    var panes = [];
    function shard() {
      panes.push(Array.prototype.slice.call(arguments));
    }
    function middle(points) {
      return {
        x: points.reduce(function (sum, point) { return sum + point.x; }, 0) / points.length,
        y: points.reduce(function (sum, point) { return sum + point.y; }, 0) / points.length,
      };
    }

    // Triangles round the label, points outwards.
    for (var t = 0; t < SIDES; t++) {
      shard(joint(0, t), joint(1, t), joint(0, t + 1));
    }
    // Diamonds from each ring's joints up to the ring after next.
    for (var k = 0; k < 6; k++) {
      for (var j = 0; j < SIDES; j++) {
        var bottom = joint(k, j);
        var left = k % 2 ? joint(k + 1, j) : joint(k + 1, j - 1);
        var right = k % 2 ? joint(k + 1, j + 1) : joint(k + 1, j);
        var top = joint(k + 2, j);
        if (k < 1) {
          shard(bottom, left, top, right);
        } else if (k < 3) {
          // Split down the middle: two tall slivers.
          shard(bottom, left, top);
          shard(bottom, top, right);
        } else if (k < 4) {
          // Split across: a spike pointing in, one pointing out.
          shard(bottom, left, right);
          shard(left, top, right);
        } else {
          // The big outer ones: four shards meeting in the middle.
          var centre = middle([bottom, left, top, right]);
          shard(bottom, left, centre);
          shard(left, top, centre);
          shard(top, right, centre);
          shard(right, bottom, centre);
        }
      }
    }

    function outline(points) {
      return 'M' + points.map(xy).join(' L') + ' Z';
    }

    // The glass, glowing into the lead a little; each pane a different
    // jewel from the ones just before it, and dim. The glow lays each
    // pane over a blurred copy of itself, which about doubles how solid a
    // dim one looks - so 0.14 shows as roughly a quarter.
    var DIM = 0.14;
    var glass = svgNode('g', { filter: glowFilter(svg, 1.6) });
    var recent = [];
    var shown = [];
    panes.forEach(function (points) {
      var pick;
      do {
        pick = Math.floor(random() * glows.length);
      } while (recent.indexOf(pick) !== -1);
      recent = recent.concat(pick).slice(-3);
      var pane = svgNode('path', { d: outline(points), fill: glows[pick], opacity: DIM });
      glass.appendChild(pane);
      // Only the panes you can see - not under the label or past the rim.
      var centre = middle(points);
      var reach = Math.sqrt(Math.pow(centre.x - 100, 2) + Math.pow(centre.y - 100, 2));
      if (reach > 38 && reach < 94) {
        shown.push(pane);
      }
    });
    svg.appendChild(glass);

    // Up to fifteen panes lit at a time: the visible ones are shuffled and
    // dealt out to fifteen lanes, each lighting its panes one after another at
    // its own pace. All but the first lane rest now and then between panes,
    // so how many are lit comes and goes - but never none. Still, each
    // lane's first pane is caught lit.
    for (var n = shown.length - 1; n > 0; n--) {
      var swap = Math.floor(random() * (n + 1));
      var held = shown[n];
      shown[n] = shown[swap];
      shown[swap] = held;
    }
    var LANES = 15;
    for (var lane = 0; lane < LANES; lane++) {
      var slots = [];
      for (var d = lane; d < shown.length; d += LANES) {
        slots.push(shown[d]);
        if (lane > 0 && random() < 0.45) {
          slots.push(null);
        }
      }
      var turnS = between(random, 0.6, 1);
      var turn = 1 / slots.length;
      // Staggered, so the lanes don't all change at once.
      var offset = turnS * lane / LANES;
      slots.forEach(function (pane, index) {
        if (!pane) {
          return;
        }
        if (index === 0) {
          pane.setAttribute('opacity', 1);
        }
        loop(pane, animate, {
          attributeName: 'opacity', values: [DIM, 1, 1, DIM, DIM].join(';'),
          keyTimes: [0, turn * 0.2, turn * 0.75, turn, 1].map(function (at) { return at.toFixed(5); }).join(';'),
          dur: seconds(turnS * slots.length), begin: seconds(offset + turnS * index),
        });
      });
    }

    // The lead, sharp and black over every seam.
    var leading = svgNode('g', {}, { fill: 'none', stroke: lead, strokeWidth: '2', strokeLinejoin: 'miter' });
    panes.forEach(function (points) {
      leading.appendChild(svgNode('path', { d: outline(points) }));
    });
    leading.appendChild(svgNode('circle', { cx: 100, cy: 100, r: 24, 'stroke-width': 3 }));
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

  /** A soft ellipse petal or blob: `rx` by `ry`, centred on `cx`, `cy`, turned `degrees`. */
  function ellipseNode(cx, cy, rx, ry, degrees, style) {
    return svgNode('ellipse', {
      cx: cx.toFixed(2), cy: cy.toFixed(2), rx: rx.toFixed(2), ry: ry.toFixed(2),
      transform: 'rotate(' + degrees.toFixed(1) + ' ' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ')',
    }, style);
  }

  /**
   * One koi, heading right, its middle on 0 0: a body in its main colour
   * with patches of the other, fins, and a tail that swishes as it swims.
   */
  function koiFish(svg, random, animate, colors) {
    var fish = svgNode('g');
    var body = 'M9 0 Q6 -4.2 -2 -3.4 Q-7 -2.2 -8 0 Q-7 2.2 -2 3.4 Q6 4.2 9 0 Z';
    // Its shadow on the bottom of the pond.
    fish.appendChild(svgNode('path', { d: body, transform: 'translate(2 3)', opacity: 0.3 }, { fill: 'var(--color-black)' }));

    var swim = svgNode('g');
    loop(swim, animate, Object.assign({ attributeName: 'transform', type: 'rotate', values: '-6 0 0;6 0 0;-6 0 0', dur: seconds(between(random, 1.1, 1.6)) }, EASE_BACK_AND_FORTH), 'animateTransform');
    var tail = svgNode('path', { d: 'M-7 0 L-13.5 -4.8 Q-11.8 0 -13.5 4.8 Z' }, { fill: colors[0] });
    loop(tail, animate, Object.assign({ attributeName: 'transform', type: 'rotate', values: '-16 -7 0;16 -7 0;-16 -7 0', dur: seconds(between(random, 0.55, 0.8)) }, EASE_BACK_AND_FORTH), 'animateTransform');
    swim.appendChild(tail);
    swim.appendChild(ellipseNode(1, -3.6, 2.6, 1, -32, { fill: colors[0], opacity: '0.85' }));
    swim.appendChild(ellipseNode(1, 3.6, 2.6, 1, 32, { fill: colors[0], opacity: '0.85' }));
    swim.appendChild(svgNode('path', { d: body }, { fill: colors[0] }));

    // The patches, kept inside the body.
    var clip = svgNode('clipPath', { id: 'vinyl-clip-' + (++filterCount) });
    clip.appendChild(svgNode('path', { d: body }));
    var defs = svgNode('defs');
    defs.appendChild(clip);
    svg.appendChild(defs);
    var patches = svgNode('g', { 'clip-path': 'url(#' + clip.id + ')' }, { fill: colors[1] });
    var count = 2 + Math.floor(random() * 2);
    for (var p = 0; p < count; p++) {
      patches.appendChild(ellipseNode(between(random, -5, 7), between(random, -1.8, 1.8), between(random, 1.8, 3.2), between(random, 1.3, 2.6), between(random, -40, 40)));
    }
    swim.appendChild(patches);
    fish.appendChild(swim);
    return fish;
  }

  /**
   * Koi Pond: koi circling slowly through deep green water, lily pads
   * drifting round over them, rings rippling out where they surface and
   * light wavering across the bottom.
   */
  function koiPondArt(random, animate) {
    var svg = svgCanvas();
    var pond = exclusiveToken('pond');
    var koi = exclusiveToken('koi');
    var white = exclusiveToken('koi-white');
    var lily = exclusiveToken('lily');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(pond, token('teal'), 35)],
      [1, mix(pond, 'var(--color-black)', 40)],
    ])));
    // Sunlight wavering across the bottom.
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.22,
      filter: noiseFill(svg, random, {
        type: 'turbulence', frequency: '0.03', drift: '0.042', seconds: 8, octaves: 2,
        alpha: '-4 0 0 0 1.2', color: white,
      }, animate),
    }));

    // Each koi on its own circuit: clockwise faces right at the top.
    [
      { radius: 44, colors: [white, koi], seconds: 16 },
      { radius: 57, colors: [koi, white], seconds: -21 },
      { radius: 69, colors: [white, 'var(--color-black)'], seconds: 25 },
      { radius: 79, colors: [koi, exclusiveToken('flame')], seconds: -19 },
      { radius: 51, colors: [exclusiveToken('flame'), white], seconds: 29 },
    ].forEach(function (one) {
      var circuit = turning(svgNode('g'), animate, one.seconds);
      var start = svgNode('g', { transform: 'rotate(' + between(random, 0, 360).toFixed(1) + ' 100 100)' });
      var at = svgNode('g', { transform: 'translate(100 ' + (100 - one.radius) + ') scale(' + (one.seconds > 0 ? 1 : -1) + ' 1)' });
      at.appendChild(koiFish(svg, random, animate, one.colors));
      start.appendChild(at);
      circuit.appendChild(start);
      svg.appendChild(circuit);
    });

    // Rings spreading out where a fish came up for air.
    var ripples = svgNode('g', {}, { fill: 'none', stroke: white });
    for (var r = 0; r < 4; r++) {
      var spot = polar(between(random, 40, 80), between(random, 0, 360));
      var begin = random() * 3.4;
      for (var w = 0; w < 2; w++) {
        var ring = svgNode('circle', { cx: spot.x.toFixed(1), cy: spot.y.toFixed(1), r: 6 + w * 5, 'stroke-width': 0.6, opacity: animate ? 0 : 0.3 });
        loop(ring, animate, { attributeName: 'r', values: '1;17', dur: '3.4s', begin: seconds(-begin - w * 0.5) });
        loop(ring, animate, { attributeName: 'opacity', values: '0.6;0', dur: '3.4s', begin: seconds(-begin - w * 0.5) });
        ripples.appendChild(ring);
      }
    }
    svg.appendChild(ripples);

    // Lily pads floating on top, drifting round, one in flower.
    var pads = turning(svgNode('g'), animate, 90);
    for (var p = 0; p < 6; p++) {
      var centre = polar(between(random, 62, 84), p * 60 + between(random, -18, 18));
      var size = between(random, 7, 11);
      var notch = between(random, 0, 360);
      var a = polar(size, notch + 16);
      var b = polar(size, notch - 16);
      var offset = { x: centre.x - 100, y: centre.y - 100 };
      pads.appendChild(svgNode('path', {
        d: 'M' + xy(centre) + ' L' + (a.x + offset.x).toFixed(1) + ' ' + (a.y + offset.y).toFixed(1)
          + ' A' + size.toFixed(1) + ' ' + size.toFixed(1) + ' 0 1 1 ' + (b.x + offset.x).toFixed(1) + ' ' + (b.y + offset.y).toFixed(1) + ' Z',
        'stroke-width': 0.6,
      }, { fill: lily, stroke: mix(lily, 'var(--color-black)', 35) }));
      if (p === 2) {
        for (var k = 0; k < 6; k++) {
          var petal = polar(2.4, k * 60);
          pads.appendChild(ellipseNode(petal.x + offset.x, petal.y + offset.y, 1.6, 2.8, k * 60, { fill: k % 2 ? exclusiveToken('blossom') : white }));
        }
        pads.appendChild(svgNode('circle', { cx: centre.x.toFixed(1), cy: centre.y.toFixed(1), r: 1.1 }, { fill: exclusiveToken('sun') }));
      }
    }
    svg.appendChild(pads);
    return svg;
  }

  /**
   * A kaleidoscope's tumbler: loose glass - shards and beads - heaped
   * round `centre` out to `spread`, turning about it once every |seconds|
   * (negative: backwards).
   */
  function kaleidoscopeTumbler(random, animate, jewels, centre, spread, count, seconds) {
    var tumbler = svgNode('g');
    for (var i = 0; i < count; i++) {
      var reach = spread * Math.sqrt(random());
      var toward = between(random, 0, 2 * Math.PI);
      var at = { x: centre.x + reach * Math.cos(toward), y: centre.y + reach * Math.sin(toward) };
      var color = jewels[Math.floor(random() * jewels.length)];
      var opacity = between(random, 0.6, 0.9).toFixed(2);
      if (random() < 0.3) {
        tumbler.appendChild(svgNode('circle', { cx: at.x.toFixed(1), cy: at.y.toFixed(1), r: between(random, 2, 5.5).toFixed(1), opacity: opacity }, { fill: color }));
        continue;
      }
      // A shard: three or four corners round its middle, sharp and uneven.
      var corners = random() < 0.5 ? 3 : 4;
      var size = between(random, 6, 16);
      var turn = between(random, 0, 360);
      var points = [];
      for (var c = 0; c < corners; c++) {
        var angle = (turn + c * 360 / corners + between(random, -25, 25)) * Math.PI / 180;
        var length = size * between(random, 0.5, 1);
        points.push({ x: at.x + length * Math.cos(angle), y: at.y + length * Math.sin(angle) });
      }
      tumbler.appendChild(svgNode('path', { d: 'M' + points.map(xy).join(' L') + ' Z', opacity: opacity }, { fill: color }));
    }
    var pivot = centre.x.toFixed(1) + ' ' + centre.y.toFixed(1);
    tumbler.setAttribute('transform', 'rotate(0 ' + pivot + ')');
    loop(tumbler, animate, {
      attributeName: 'transform', type: 'rotate',
      from: '0 ' + pivot, to: (seconds < 0 ? -360 : 360) + ' ' + pivot, dur: Math.abs(seconds) + 's',
    }, 'animateTransform');
    return tumbler;
  }

  /**
   * Kaleidoscope: coloured glass tumbling behind twelve still mirrors. The
   * glass only ever moves inside one thin wedge, which the mirrors reflect
   * all the way round - so the pattern blooms out of the middle and folds
   * in on itself along every mirror, never repeating, while every colour
   * slowly shifts through the rest.
   */
  function kaleidoscopeArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(exclusiveToken('night')));
    var jewels = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'magenta'].map(token);
    var shift = addFilter(svg, function (filter) {
      filter.appendChild(loop(svgNode('feColorMatrix', { type: 'hueRotate', values: '0' }), animate, { attributeName: 'values', values: '0;360', dur: '40s' }));
    });

    // The wedge the glass shows through: 30 degrees from the top, a hair
    // wider so the mirrored copies meet without a seam.
    var clip = svgNode('clipPath', { id: 'vinyl-clip-' + (++filterCount) });
    clip.appendChild(svgNode('path', { d: 'M100 100 L' + xy(polar(150, -0.4)) + ' L' + xy(polar(150, 30.4)) + ' Z' }));
    var wedge = svgNode('g', { id: 'vinyl-wedge-' + (++filterCount), 'clip-path': 'url(#' + clip.id + ')' });
    // Two heaps of glass turning against each other, and a few big pieces
    // drifting slowly over them.
    wedge.appendChild(kaleidoscopeTumbler(random, animate, jewels, polar(62, 15), 58, 46, 34));
    wedge.appendChild(kaleidoscopeTumbler(random, animate, jewels, polar(80, 8), 44, 26, -23));
    wedge.appendChild(kaleidoscopeTumbler(random, animate, jewels, polar(45, 22), 36, 10, 55));
    var defs = svgNode('defs');
    defs.appendChild(clip);
    defs.appendChild(wedge);
    svg.appendChild(defs);

    // The mirrors: the wedge, and its reflection across its edge, six times round.
    var glass = svgNode('g', { filter: shift });
    for (var k = 0; k < 6; k++) {
      glass.appendChild(svgNode('use', { href: '#' + wedge.id, transform: 'rotate(' + k * 60 + ' 100 100)' }));
      glass.appendChild(svgNode('use', { href: '#' + wedge.id, transform: 'rotate(' + k * 60 + ' 100 100) translate(200 0) scale(-1 1)' }));
    }
    svg.appendChild(glass);
    return svg;
  }

  /**
   * Digital Rain: columns of glowing green code streaming in from beyond
   * the rim on every side down to the middle, each led by a white-hot
   * character, fainter ones falling slower behind.
   */
  function digitalRainArt(random, animate) {
    var svg = svgCanvas();
    var code = exclusiveToken('code');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(exclusiveToken('code-dark'), code, 12)],
      [1, exclusiveToken('code-dark')],
    ])));
    var glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789';
    // Transparent at the back of a column, brightest at its head.
    var fill = gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
      [0, code, 0], [0.7, code, 0.85], [0.93, 'var(--color-text)', 1], [1, 'var(--color-text)', 1],
    ]);
    // Every column is drawn falling down the top half, from above the rim
    // to the middle, then turned to its own spot round the record; this
    // cuts it off at the middle, so it never runs on into the far side.
    var half = svgNode('clipPath', { id: 'vinyl-clip-' + (++filterCount) });
    half.appendChild(svgNode('rect', { x: 0, y: -100, width: 200, height: 200 }));
    var defs = svgNode('defs');
    defs.appendChild(half);
    svg.appendChild(defs);

    function layer(size, columns, fall, opacity) {
      var group = svgNode('g', {}, { fontFamily: 'monospace', fontSize: size + 'px', fontWeight: '700', opacity: String(opacity) });
      for (var c = 0; c < columns; c++) {
        var length = 7 + Math.floor(random() * 11);
        var column = svgNode('text', { x: 100, y: 0, fill: fill, 'text-anchor': 'middle' });
        for (var i = 0; i < length; i++) {
          var glyph = svgNode('tspan', { x: 100, dy: String(size) });
          glyph.textContent = glyphs.charAt(Math.floor(random() * glyphs.length));
          column.appendChild(glyph);
        }
        var height = length * size;
        // From wholly outside the rim until wholly past the middle.
        column.setAttribute('transform', 'translate(0 ' + between(random, -height, 100 - height * 0.4).toFixed(1) + ')');
        loop(column, animate, {
          attributeName: 'transform', type: 'translate', values: '0 ' + (-height) + ';0 100',
          dur: seconds(between(random, fall[0], fall[1])), begin: seconds(-random() * fall[1]),
        }, 'animateTransform');
        var spoke = svgNode('g', {
          'clip-path': 'url(#' + half.id + ')',
          transform: 'rotate(' + ((c + between(random, -0.35, 0.35)) * 360 / columns).toFixed(1) + ' 100 100)',
        });
        spoke.appendChild(column);
        group.appendChild(spoke);
      }
      return group;
    }
    svg.appendChild(layer(5, 64, [2.8, 5], 0.4));
    var front = layer(7, 44, [1.5, 3], 1);
    front.setAttribute('filter', glowFilter(svg, 0.9));
    svg.appendChild(front);
    return svg;
  }

  /**
   * Solar Eclipse: totality. A big black moon over the sun, ringed by a thin
   * blaze of pink chromosphere with red flames licking off it, and the
   * corona's fine white streamers fanning out round it - longest along the
   * sun's equator, drifting both ways and crackling in and out. Bubbles of
   * plasma burst off the edge and fly out to the rim, a shockwave ripples
   * out now and then, and at one edge the last bead of sunlight flares
   * into a diamond ring, beads glinting beside it - the whole horizon
   * glowing with sunset under a starry sky. (What moves goes in and out
   * rather than round, so it still shows while the record spins.)
   */
  function solarEclipseArt(random, animate) {
    var svg = svgCanvas();
    var corona = exclusiveToken('corona');
    var white = exclusiveToken('hot-white');
    var flame = exclusiveToken('prominence');
    var moon = 50;
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(exclusiveToken('night'), token('navy'), 55)],
      [1, exclusiveToken('night')],
    ])));
    // Sunset all round the horizon, as it is in totality.
    svg.appendChild(fullRect(gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '100' }, [
      [0.78, exclusiveToken('sunset'), 0], [0.93, exclusiveToken('sunset'), 0.22], [1, flame, 0.4],
    ])));
    stars(svg, random, animate, 30);

    // The inner corona: a white-hot glow hugging the moon, breathing.
    var glow = svgNode('circle', {
      cx: 100, cy: 100, r: 80,
      fill: gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '80' }, [
        [moon / 80, white, 1], [0.7, corona, 0.55], [0.85, corona, 0.15], [1, corona, 0],
      ]),
    });
    loop(glow, animate, Object.assign({ attributeName: 'r', values: '76;86;76', dur: '6s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(glow);

    // A shockwave rippling out from the moon to the rim now and then.
    var shock = svgNode('circle', { cx: 100, cy: 100, r: moon, opacity: 0, 'stroke-width': 2 }, { fill: 'none', stroke: corona });
    loop(shock, animate, { attributeName: 'r', values: moon + ';102;102', keyTimes: '0;0.55;1', calcMode: 'spline', keySplines: '0.2 0.6 0.4 1;0 0 1 1', dur: '4.5s' });
    loop(shock, animate, { attributeName: 'opacity', values: '0.55;0;0', keyTimes: '0;0.55;1', dur: '4.5s' });
    loop(shock, animate, { attributeName: 'stroke-width', values: '2.5;0.4;0.4', keyTimes: '0;0.55;1', dur: '4.5s' });
    svg.appendChild(shock);

    // The streamers: fine spikes of light, one shared fade from white at
    // the moon's edge to nothing at the rim, reaching furthest along the
    // sun's equator (`axis`) and short at its poles.
    var fade = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '110' }, [
      [moon / 110, white, 0.95], [0.6, corona, 0.7], [0.8, corona, 0.25], [1, corona, 0],
    ]);
    var soften = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { stdDeviation: '0.45' }));
    });
    var axis = between(random, 0, 180);
    [
      { count: 56, width: [0.8, 2], reach: [60, 78], stretch: 34, turn: 240 },
      { count: 34, width: [0.5, 1.2], reach: [64, 84], stretch: 42, turn: -360 },
    ].forEach(function (set) {
      var group = turning(svgNode('g', { filter: soften }, { fill: fade, mixBlendMode: 'screen' }), animate, set.turn);
      for (var i = 0; i < set.count; i++) {
        var angle = i * 360 / set.count + between(random, -3, 3);
        var equator = Math.pow(Math.abs(Math.cos((angle - axis) * Math.PI / 180)), 2);
        var reach = between(random, set.reach[0], set.reach[1]) + set.stretch * equator;
        var width = between(random, set.width[0], set.width[1]);
        var bend = between(random, -2.5, 2.5);
        var spike = function (tip) {
          return 'M' + xy(polar(moon - 1, angle - width)) + ' Q' + xy(polar((moon + tip) / 2, angle + bend)) + ' ' + xy(polar(tip, angle + bend))
            + ' Q' + xy(polar((moon + tip) / 2, angle + bend)) + ' ' + xy(polar(moon - 1, angle + width)) + ' Z';
        };
        var streamer = svgNode('path', { d: spike(reach) });
        // Crackling: shooting out further and falling back, each on its own beat.
        loop(streamer, animate, Object.assign({
          attributeName: 'd', values: [spike(reach), spike(reach + between(random, 10, 26)), spike(reach)].join(';'),
          dur: seconds(between(random, 1.4, 3.4)), begin: seconds(-random() * 3.4),
        }, EASE_BACK_AND_FORTH));
        if (random() < 0.4) {
          loop(streamer, animate, Object.assign({ attributeName: 'opacity', values: '1;0.45;1', dur: seconds(between(random, 3, 7)), begin: seconds(-random() * 7) }, EASE_BACK_AND_FORTH));
        }
        group.appendChild(streamer);
      }
      svg.appendChild(group);
    });

    // Prominences: red tongues of flame licking off the edge, flickering.
    var flames = svgNode('g', { filter: glowFilter(svg, 1) }, { fill: flame });
    function tongue(at, width, height, lean) {
      return 'M' + xy(polar(moon - 0.5, at - width)) + ' Q' + xy(polar(moon + height * 0.6, at - width * 0.6 + lean))
        + ' ' + xy(polar(moon + height, at + lean)) + ' Q' + xy(polar(moon + height * 0.5, at + width * 0.5 + lean))
        + ' ' + xy(polar(moon - 0.5, at + width)) + ' Z';
    }
    for (var p = 0; p < 7; p++) {
      var at = between(random, 0, 360);
      var width = between(random, 2, 5);
      var height = between(random, 4, 10);
      var lean = between(random, -3, 3);
      var shapes = [tongue(at, width, height, lean), tongue(at, width * 1.15, height * 1.45, -lean), tongue(at, width, height, lean)];
      var prominence = svgNode('path', { d: shapes[0], opacity: 0.9 });
      loop(prominence, animate, Object.assign({ attributeName: 'd', values: shapes.join(';'), dur: seconds(between(random, 2.2, 4)), begin: seconds(-random() * 4) }, EASE_BACK_AND_FORTH));
      flames.appendChild(prominence);
    }
    svg.appendChild(flames);

    // Eruptions: bubbles of plasma bursting off the edge and flying out to
    // the rim, swelling and fading as they go - one after another.
    var erupting = svgNode('g', { filter: glowFilter(svg, 1.1) }, {
      fill: gradient(svg, 'radial', {}, [[0, white, 0.1], [0.7, flame, 0.25], [1, mix(white, flame, 40), 0.7]]),
      stroke: mix(white, flame, 40), strokeWidth: '0.8',
    });
    for (var e = 0; e < 3; e++) {
      var heading = between(random, 0, 360);
      var from = polar(moon + 1, heading);
      var to = polar(104, heading + between(random, -8, 8));
      var burstFor = seconds(between(random, 4.5, 6.5));
      var when = seconds(-e * 1.9);
      var bubble = svgNode('circle', { cx: from.x.toFixed(1), cy: from.y.toFixed(1), r: 1.5, opacity: 0 });
      var outwards = { keyTimes: '0;0.5;1', calcMode: 'spline', keySplines: '0.3 0.4 0.6 1;0 0 1 1', dur: burstFor, begin: when };
      loop(bubble, animate, Object.assign({ attributeName: 'cx', values: [from.x, to.x, to.x].map(function (v) { return v.toFixed(1); }).join(';') }, outwards));
      loop(bubble, animate, Object.assign({ attributeName: 'cy', values: [from.y, to.y, to.y].map(function (v) { return v.toFixed(1); }).join(';') }, outwards));
      loop(bubble, animate, Object.assign({ attributeName: 'r', values: '1.5;' + between(random, 9, 14).toFixed(1) + ';1.5' }, outwards));
      loop(bubble, animate, { attributeName: 'opacity', values: '0;1;0;0', keyTimes: '0;0.06;0.5;1', dur: burstFor, begin: when });
      erupting.appendChild(bubble);
    }
    svg.appendChild(erupting);

    // The moon, and the chromosphere: a thin pink-white blaze at its edge.
    svg.appendChild(svgNode('circle', { cx: 100, cy: 100, r: moon }, { fill: 'var(--color-black)' }));
    var rim = svgNode('circle', { cx: 100, cy: 100, r: moon, 'stroke-width': 1.3, filter: glowFilter(svg, 1.2) }, {
      fill: 'none', stroke: mix(white, flame, 35),
    });
    loop(rim, animate, Object.assign({ attributeName: 'stroke-width', values: '1;1.8;1', dur: '4s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(rim);

    // The diamond ring: the last bead of sunlight flaring into a starburst,
    // Baily's beads glinting along the edge beside it.
    var edge = between(random, 20, 70);
    var spot = polar(moon + 0.5, edge);
    var diamond = svgNode('g', { transform: 'translate(' + xy(spot) + ')', filter: glowFilter(svg, 1.8) }, { fill: white });
    var burst = svgNode('g');
    burst.appendChild(svgNode('circle', { cx: 0, cy: 0, r: 9, fill: gradient(svg, 'radial', {}, [[0, white, 1], [0.35, white, 0.7], [1, corona, 0]]) }));
    // Rays: long ones straight across, short ones on the diagonals.
    [[0, 30], [90, 30], [180, 30], [270, 30], [45, 13], [135, 13], [225, 13], [315, 13]].forEach(function (ray) {
      var turn = ray[0] * Math.PI / 180;
      var side = turn + Math.PI / 2;
      var tip = { x: ray[1] * Math.cos(turn), y: ray[1] * Math.sin(turn) };
      burst.appendChild(svgNode('path', {
        d: 'M' + (1.1 * Math.cos(side)).toFixed(2) + ' ' + (1.1 * Math.sin(side)).toFixed(2) + ' L' + xy(tip)
          + ' L' + (-1.1 * Math.cos(side)).toFixed(2) + ' ' + (-1.1 * Math.sin(side)).toFixed(2) + ' Z',
      }));
    });
    burst.appendChild(svgNode('circle', { cx: 0, cy: 0, r: 2.6 }));
    burst.setAttribute('transform', 'scale(0.8)');
    loop(burst, animate, {
      attributeName: 'transform', type: 'scale', values: '0.35;1;0.9;1.05;0.35', keyTimes: '0;0.3;0.5;0.7;1',
      calcMode: 'spline', keySplines: '0.3 0 0.2 1;0.4 0 0.6 1;0.4 0 0.6 1;0.5 0 0.8 1', dur: '6s',
    }, 'animateTransform');
    diamond.appendChild(burst);
    svg.appendChild(diamond);

    var beads = svgNode('g', { filter: glowFilter(svg, 0.9) }, { fill: white });
    for (var b = 0; b < 5; b++) {
      var bead = polar(moon + 0.3, edge + 7 + b * between(random, 4, 7));
      var glint = svgNode('circle', { cx: bead.x.toFixed(1), cy: bead.y.toFixed(1), r: between(random, 0.7, 1.4).toFixed(2), opacity: 0.8 });
      loop(glint, animate, { attributeName: 'opacity', values: '0.1;1;0.1', dur: seconds(between(random, 1.2, 2.6)), begin: seconds(-random() * 3) });
      beads.appendChild(glint);
    }
    svg.appendChild(beads);
    return svg;
  }

  /**
   * Hyperspace: the stars stretched into streaks, shooting out from the
   * label faster and faster, rings of blue light rushing past down the
   * tunnel.
   */
  function hyperspaceArt(random, animate) {
    var svg = svgCanvas();
    var blue = exclusiveToken('warp');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '55%' }, [
      [0, mix(blue, exclusiveToken('night'), 45)],
      [0.4, mix(exclusiveToken('night'), blue, 14)],
      [1, 'var(--color-black)'],
    ])));

    var rings = svgNode('g', {}, { fill: 'none', stroke: blue });
    for (var r = 0; r < 4; r++) {
      var begin = seconds(-r * 0.55);
      var ring = svgNode('circle', { cx: 100, cy: 100, r: 40 + r * 14, 'stroke-width': 0.8, opacity: animate ? 0 : 0.25 });
      loop(ring, animate, { attributeName: 'r', values: '30;98', keyTimes: '0;1', calcMode: 'spline', keySplines: '0.6 0 1 1', dur: '2.2s', begin: begin });
      loop(ring, animate, { attributeName: 'opacity', values: '0;0.5;0', dur: '2.2s', begin: begin });
      rings.appendChild(ring);
    }
    svg.appendChild(rings);

    // Each streak starts as a point near the label and races out, drawing
    // itself longer as it speeds up: its head flies on far past the rim
    // while its tail hangs back, so it stretches most of the way across.
    var tail = { keyTimes: '0;1', calcMode: 'spline', keySplines: '0.85 0 1 1' };
    var head = { keyTimes: '0;1', calcMode: 'spline', keySplines: '0.6 0 1 1' };
    var streaks = svgNode('g', { filter: glowFilter(svg, 0.7) }, { strokeLinecap: 'round' });
    for (var i = 0; i < 120; i++) {
      var travel = seconds(between(random, 0.9, 1.8));
      var start = seconds(-random() * 1.8);
      var near = between(random, 30, 42);
      var still = between(random, 36, 70);
      var streak = svgNode('line', {
        x1: 100, x2: 100, y1: (100 - still).toFixed(1), y2: (100 - still * 1.6).toFixed(1),
        'stroke-width': between(random, 0.5, 1.3).toFixed(2), opacity: 0.9,
        transform: 'rotate(' + between(random, 0, 360).toFixed(1) + ' 100 100)',
      }, { stroke: i % 3 ? exclusiveToken('star') : blue });
      loop(streak, animate, Object.assign({ attributeName: 'y1', values: (100 - near).toFixed(1) + ';-5', dur: travel, begin: start }, tail));
      loop(streak, animate, Object.assign({ attributeName: 'y2', values: (99 - near).toFixed(1) + ';-150', dur: travel, begin: start }, head));
      loop(streak, animate, { attributeName: 'opacity', values: '0;1;1', keyTimes: '0;0.3;1', dur: travel, begin: start });
      streaks.appendChild(streak);
    }
    svg.appendChild(streaks);
    return svg;
  }

  /** A five-petalled blossom at `x`, `y`, `size` across, turned `degrees`. */
  function blossomNode(x, y, size, degrees, petal, heart) {
    var flower = svgNode('g', { transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + degrees.toFixed(0) + ') scale(' + size.toFixed(2) + ')' });
    for (var k = 0; k < 5; k++) {
      var at = { x: Math.sin(k * 72 * Math.PI / 180) * 2.4, y: -Math.cos(k * 72 * Math.PI / 180) * 2.4 };
      flower.appendChild(ellipseNode(at.x, at.y, 1.8, 2.7, k * 72, { fill: petal }));
    }
    flower.appendChild(svgNode('circle', { cx: 0, cy: 0, r: 1 }, { fill: heart }));
    return flower;
  }

  /**
   * Cherry Blossom: four crooked branches reaching in from the rim, heavy
   * with pink flowers and swaying gently, petals drifting down and gusting
   * across a dusk sky under a pale moon.
   */
  function cherryBlossomArt(random, animate) {
    var svg = svgCanvas();
    var dusk = exclusiveToken('dusk');
    var blossom = exclusiveToken('blossom');
    var deep = exclusiveToken('blossom-deep');
    var bark = exclusiveToken('bark');
    svg.appendChild(fullRect(gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
      [0, dusk], [0.6, mix(dusk, deep, 35)], [1, mix(exclusiveToken('sunset'), deep, 40)],
    ])));
    stars(svg, random, animate, 14);
    svg.appendChild(svgNode('circle', {
      cx: 136, cy: 56, r: 16,
      fill: gradient(svg, 'radial', {}, [[0.6, exclusiveToken('koi-white'), 0.9], [1, exclusiveToken('koi-white'), 0]]),
    }));

    // The fourth, low on the right, clear of the moon.
    [205, 325, 85, 145].forEach(function (rim) {
      var angle = rim + between(random, -15, 15);
      var root = polar(102, angle);
      var branch = svgNode('g');
      loop(branch, animate, Object.assign({
        attributeName: 'transform', type: 'rotate',
        values: '-2 ' + xy(root) + ';2 ' + xy(root) + ';-2 ' + xy(root), dur: seconds(between(random, 4, 6.5)),
      }, EASE_BACK_AND_FORTH), 'animateTransform');
      var wood = svgNode('g', {}, { fill: 'none', stroke: bark, strokeLinecap: 'round' });
      var flowers = svgNode('g');
      var x = root.x;
      var y = root.y;
      var heading = Math.atan2(100 - y, 100 - x);
      for (var s = 0; s < 8; s++) {
        heading += between(random, -0.45, 0.45);
        var step = between(random, 7, 10);
        var nx = x + Math.cos(heading) * step;
        var ny = y + Math.sin(heading) * step;
        if (Math.hypot(nx - 100, ny - 100) < 38) {
          break;
        }
        wood.appendChild(svgNode('line', { x1: x.toFixed(1), y1: y.toFixed(1), x2: nx.toFixed(1), y2: ny.toFixed(1), 'stroke-width': Math.max(0.8, 4.6 - s * 0.55).toFixed(2) }));
        // A twig off to one side, flowering at its end.
        if (s > 0 && random() < 0.7) {
          var twig = heading + (random() < 0.5 ? -1 : 1) * between(random, 0.6, 1.1);
          var tx = nx + Math.cos(twig) * between(random, 5, 9);
          var ty = ny + Math.sin(twig) * between(random, 5, 9);
          wood.appendChild(svgNode('line', { x1: nx.toFixed(1), y1: ny.toFixed(1), x2: tx.toFixed(1), y2: ty.toFixed(1), 'stroke-width': 0.8 }));
          flowers.appendChild(blossomNode(tx, ty, between(random, 0.8, 1.2), between(random, 0, 72), random() < 0.5 ? blossom : lighter(blossom, 30), deep));
        }
        if (s > 1) {
          flowers.appendChild(blossomNode(nx + between(random, -3, 3), ny + between(random, -3, 3), between(random, 0.7, 1.3), between(random, 0, 72), random() < 0.4 ? deep : blossom, exclusiveToken('sun')));
        }
        x = nx;
        y = ny;
      }
      branch.appendChild(wood);
      branch.appendChild(flowers);
      svg.appendChild(branch);
    });

    // Petals drifting down on the breeze, turning as they fall - and every
    // third one caught by a gust, blown across the record instead.
    var petals = svgNode('g');
    for (var p = 0; p < 56; p++) {
      var path;
      if (p % 3 === 2) {
        var sy = between(random, 10, 150);
        path = 'M-12 ' + sy.toFixed(0) + ' Q60 ' + (sy + between(random, -40, 20)).toFixed(0) + ' 110 ' + (sy + between(random, 0, 35)).toFixed(0)
          + ' T212 ' + (sy + between(random, 20, 60)).toFixed(0);
      } else {
        var sx = between(random, -40, 170);
        var ex = sx + between(random, 60, 120);
        path = 'M' + sx.toFixed(0) + ' -10 Q' + (sx + between(random, 40, 80)).toFixed(0) + ' 60 ' + (sx + between(random, 10, 50)).toFixed(0) + ' 110 T' + ex.toFixed(0) + ' 215';
      }
      var fall = svgNode('g');
      var size = between(random, 0.7, 1.3);
      var leaf = ellipseNode(0, 0, 1.5 * size, 2.4 * size, 0, { fill: p % 4 ? blossom : deep });
      if (animate) {
        var drift = seconds(between(random, 7, 12));
        var begin = seconds(-random() * 12);
        loop(fall, animate, { path: path, dur: drift, begin: begin, rotate: 'auto' }, 'animateMotion');
        loop(leaf, animate, { attributeName: 'transform', type: 'rotate', values: '0;360', dur: seconds(between(random, 1.5, 3)) }, 'animateTransform');
      } else {
        fall.setAttribute('transform', 'translate(' + between(random, 0, 200).toFixed(0) + ' ' + between(random, 0, 200).toFixed(0) + ') rotate(' + between(random, 0, 360).toFixed(0) + ')');
      }
      fall.appendChild(leaf);
      petals.appendChild(fall);
    }
    svg.appendChild(petals);
    return svg;
  }

  /**
   * Circuit Board: gold traces running out from the label across green
   * board to the rim, chips with blinking LEDs, and pulses of signal
   * racing along every trace.
   */
  function circuitBoardArt(random, animate) {
    var svg = svgCanvas();
    var pcb = exclusiveToken('pcb');
    var copper = 'var(--rarity-gold)';
    var code = exclusiveToken('code');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(pcb, code, 10)],
      [1, mix(pcb, 'var(--color-black)', 35)],
    ])));

    // Out from the label, a jog at an angle, on out to the rim.
    var traces = [];
    var count = 26;
    for (var i = 0; i < count; i++) {
      var angle = i * 360 / count + between(random, -3, 3);
      var bend = between(random, 38, 58);
      var jog = between(random, -11, 11);
      var after = bend + Math.abs(jog) * 0.7 + 4;
      traces.push([polar(31, angle), polar(bend, angle), polar(after, angle + jog), polar(between(random, 70, 90), angle + jog)]);
    }
    function pathOf(points) {
      return 'M' + points.map(xy).join(' L');
    }
    var board = svgNode('g', {}, { fill: 'none', stroke: copper, strokeWidth: '1.1', strokeLinejoin: 'round', strokeLinecap: 'round', opacity: '0.85' });
    var pads = svgNode('g', {}, { fill: pcb, stroke: copper, strokeWidth: '1' });
    traces.forEach(function (points) {
      board.appendChild(svgNode('path', { d: pathOf(points) }));
      var end = points[points.length - 1];
      pads.appendChild(svgNode('circle', { cx: end.x.toFixed(1), cy: end.y.toFixed(1), r: 1.8 }));
    });
    svg.appendChild(board);
    svg.appendChild(pads);

    // Chips round the middle, pins and all, each with a blinking LED.
    for (var c = 0; c < 4; c++) {
      var at = polar(60, c * 90 + 45 + between(random, -10, 10));
      var chip = svgNode('g', { transform: 'rotate(' + (c * 90 + 45) + ' ' + xy(at) + ')' });
      var pins = svgNode('g', {}, { stroke: copper, strokeWidth: '0.8' });
      for (var n = 0; n < 5; n++) {
        var px = at.x - 6 + n * 3;
        pins.appendChild(svgNode('line', { x1: px.toFixed(1), y1: (at.y - 7).toFixed(1), x2: px.toFixed(1), y2: (at.y + 7).toFixed(1) }));
      }
      chip.appendChild(pins);
      chip.appendChild(svgNode('rect', { x: (at.x - 8).toFixed(1), y: (at.y - 5).toFixed(1), width: 16, height: 10, rx: 1 }, { fill: mix(pcb, 'var(--color-black)', 75) }));
      var led = svgNode('circle', { cx: (at.x + 5).toFixed(1), cy: (at.y - 2).toFixed(1), r: 1.1 }, { fill: c % 2 ? exclusiveToken('prominence') : code });
      loop(led, animate, { attributeName: 'opacity', values: '1;0.15;1', keyTimes: '0;0.5;1', calcMode: 'discrete', dur: seconds(between(random, 0.6, 1.5)) });
      chip.appendChild(led);
      svg.appendChild(chip);
    }

    // The signal: a short bright dash running the length of each trace.
    var signals = svgNode('g', { filter: glowFilter(svg, 1) }, { fill: 'none', strokeWidth: '1.6', strokeLinecap: 'round' });
    traces.forEach(function (points, index) {
      var length = 0;
      for (var k = 1; k < points.length; k++) {
        length += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
      }
      var signal = svgNode('path', {
        d: pathOf(points), 'stroke-dasharray': '5 ' + (length + 10).toFixed(0),
        'stroke-dashoffset': animate ? '5' : (-length * random()).toFixed(0),
      }, { stroke: index % 3 ? code : exclusiveToken('neon-cyan') });
      loop(signal, animate, { attributeName: 'stroke-dashoffset', values: '5;' + (-length).toFixed(0), dur: seconds(between(random, 1.2, 2.6)), begin: seconds(-random() * 2.6) });
      signals.appendChild(signal);
    });
    svg.appendChild(signals);
    return svg;
  }

  /**
   * Radar Sweep: a green radar screen, its beam sweeping round trailing a
   * fading glow, blips lighting up as it passes over them and a ping
   * spreading out with every turn.
   */
  function radarSweepArt(random, animate) {
    var svg = svgCanvas();
    var radar = exclusiveToken('radar');
    var dark = exclusiveToken('radar-dark');
    var period = 4;
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '55%' }, [
      [0, mix(dark, radar, 14)],
      [1, dark],
    ])));

    var grid = svgNode('g', {}, { fill: 'none', stroke: radar, strokeWidth: '0.5', opacity: '0.4' });
    [42, 56, 70, 84].forEach(function (radius) {
      grid.appendChild(svgNode('circle', { cx: 100, cy: 100, r: radius }));
    });
    for (var s = 0; s < 8; s++) {
      var from = polar(29, s * 45);
      var to = polar(88, s * 45);
      grid.appendChild(svgNode('line', { x1: from.x.toFixed(1), y1: from.y.toFixed(1), x2: to.x.toFixed(1), y2: to.y.toFixed(1) }));
    }
    for (var t = 0; t < 72; t++) {
      var inner = polar(t % 6 ? 86.5 : 84, t * 5);
      var outer = polar(89, t * 5);
      grid.appendChild(svgNode('line', { x1: inner.x.toFixed(1), y1: inner.y.toFixed(1), x2: outer.x.toFixed(1), y2: outer.y.toFixed(1) }));
    }
    svg.appendChild(grid);

    // A ping spreading out with every turn of the beam.
    var ping = svgNode('circle', { cx: 100, cy: 100, r: 60, 'stroke-width': 1, opacity: animate ? 0 : 0.2 }, { fill: 'none', stroke: radar });
    loop(ping, animate, { attributeName: 'r', values: '29;90', dur: seconds(period) });
    loop(ping, animate, { attributeName: 'opacity', values: '0.55;0', dur: seconds(period) });
    svg.appendChild(ping);

    // The beam, and the glow it leaves fading behind it.
    var sweep = turning(svgNode('g'), animate, period);
    var trail = 70;
    var slices = 28;
    for (var k = 0; k < slices; k++) {
      var a0 = -trail + k * trail / slices;
      sweep.appendChild(svgNode('path', { d: sectorPath(29, 88, a0, a0 + trail / slices + 0.4), opacity: (Math.pow(k / slices, 2.2) * 0.6).toFixed(3) }, { fill: radar }));
    }
    sweep.appendChild(svgNode('line', { x1: 100, y1: 71, x2: 100, y2: 12, 'stroke-width': 1.2, filter: glowFilter(svg, 1) }, { stroke: radar }));
    svg.appendChild(sweep);

    // Blips, lit as the beam crosses them and fading till it's round again.
    var blips = svgNode('g', { filter: glowFilter(svg, 1.2) }, { fill: radar });
    for (var b = 0; b < 10; b++) {
      var bearing = between(random, 0, 360);
      var spot = polar(between(random, 36, 84), bearing);
      var blip = svgNode('circle', { cx: spot.x.toFixed(1), cy: spot.y.toFixed(1), r: between(random, 1.2, 2.2).toFixed(2), opacity: 0.4 });
      loop(blip, animate, { attributeName: 'opacity', values: '1;0.04', keyTimes: '0;1', calcMode: 'spline', keySplines: '0.2 0.7 0.4 1', dur: seconds(period), begin: seconds(bearing / 360 * period) });
      blips.appendChild(blip);
    }
    svg.appendChild(blips);
    return svg;
  }

  /** A crackling tendril from the label out to the glass at `heading`, wandering on the way. */
  function tendrilPath(random, heading) {
    var points = [];
    var wander = 0;
    for (var s = 0; s <= 10; s++) {
      wander += between(random, -6, 6);
      points.push(polar(30 + s * 6, s === 10 ? heading : heading + wander * (1 - s / 12)));
    }
    return 'M' + points.map(xy).join(' L');
  }

  /**
   * Plasma Globe: violet and pink tendrils of electricity crackling out
   * from the glowing middle to the glass, drifting round, a hot spot
   * flickering wherever one touches.
   */
  function plasmaGlobeArt(random, animate) {
    var svg = svgCanvas();
    var violet = exclusiveToken('plasma-violet');
    var pink = exclusiveToken('plasma-pink');
    var glass = exclusiveToken('globe');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(glass, violet, 40)], [0.45, mix(glass, violet, 15)], [1, glass],
    ])));
    var core = svgNode('circle', {
      cx: 100, cy: 100, r: 46,
      fill: gradient(svg, 'radial', {}, [[0.6, pink, 0.9], [0.8, violet, 0.4], [1, violet, 0]]),
    });
    loop(core, animate, Object.assign({ attributeName: 'opacity', values: '1;0.65;1', dur: '1.3s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(core);

    var arcs = svgNode('g', { filter: glowFilter(svg, 1.4) }, { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', mixBlendMode: 'screen' });
    for (var t = 0; t < 9; t++) {
      var heading = t * 40 + between(random, -12, 12);
      var drift = turning(svgNode('g'), animate, (t % 2 ? -1 : 1) * between(random, 14, 30));
      var shapes = [tendrilPath(random, heading), tendrilPath(random, heading), tendrilPath(random, heading)];
      var color = t % 3 ? violet : pink;
      var arc = svgNode('path', { d: shapes[0], 'stroke-width': between(random, 0.8, 1.5).toFixed(2) }, { stroke: color });
      loop(arc, animate, { attributeName: 'd', values: shapes.concat(shapes[0]).join(';'), dur: seconds(between(random, 0.35, 0.7)) });
      drift.appendChild(arc);
      var tip = polar(90, heading);
      var spot = svgNode('circle', { cx: tip.x.toFixed(1), cy: tip.y.toFixed(1), r: 2.4 }, { fill: pink });
      loop(spot, animate, { attributeName: 'r', values: '1.6;3.4;1.6', dur: seconds(between(random, 0.4, 0.8)) });
      drift.appendChild(spot);
      arcs.appendChild(drift);
    }
    svg.appendChild(arcs);
    // The curve of the glass, catching the light.
    svg.appendChild(svgNode('path', { d: 'M38 74 A66 66 0 0 1 88 33', fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.16 }, { stroke: 'var(--color-text)' }));
    return svg;
  }

  /**
   * Equalizer: a ring of bars round the label, each bouncing on its own,
   * never still - cyan at the root, pink, then a yellow tip - soundwaves
   * circling the rim and the label pulsing on every kick.
   */
  function equalizerArt(random, animate) {
    var svg = svgCanvas();
    var night = exclusiveToken('synth-night');
    var cyan = exclusiveToken('neon-cyan');
    var pink = exclusiveToken('neon-pink');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(night, pink, 20)],
      [1, mix(night, 'var(--color-black)', 40)],
    ])));

    [
      { radius: 91, height: 2.5, waves: 24, turn: 20, color: cyan },
      { radius: 87, height: 2, waves: 18, turn: -26, color: pink },
    ].forEach(function (wave) {
      var points = [];
      for (var d = 0; d < 360; d += 3) {
        points.push(polar(wave.radius + Math.sin(d * wave.waves * Math.PI / 180) * wave.height, d));
      }
      svg.appendChild(turning(svgNode('path', { d: 'M' + points.map(xy).join(' L') + ' Z', fill: 'none', 'stroke-width': 0.8, opacity: 0.5 }, { stroke: wave.color }), animate, wave.turn));
    });

    var fill = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '86' }, [
      [0.4, cyan], [0.72, pink], [1, exclusiveToken('sun')],
    ]);
    var bars = svgNode('g', { filter: glowFilter(svg, 0.9) }, { stroke: fill, strokeWidth: '3.1', strokeLinecap: 'round' });
    // Every bar bounces by itself: its own run of heights, each a good jump
    // from the last, at its own pace and from its own point - eased so it
    // never quite comes to rest at any of them.
    var count = 48;
    for (var i = 0; i < count; i++) {
      var heights = [between(random, 6, 46)];
      while (heights.length < 7) {
        var next = between(random, 6, 46);
        if (Math.abs(next - heights[heights.length - 1]) > 12) {
          heights.push(next);
        }
      }
      heights.push(heights[0]);
      var bar = svgNode('line', { x1: 100, x2: 100, y1: 64, y2: (64 - heights[0]).toFixed(1), transform: 'rotate(' + (i * 360 / count).toFixed(1) + ' 100 100)' });
      loop(bar, animate, {
        attributeName: 'y2', values: heights.map(function (h) { return (64 - h).toFixed(1); }).join(';'),
        keyTimes: heights.map(function (h, at) { return (at / (heights.length - 1)).toFixed(3); }).join(';'),
        calcMode: 'spline', keySplines: heights.slice(1).map(function () { return '0.35 0.15 0.65 0.85'; }).join(';'),
        dur: seconds(between(random, 1.8, 3.2)), begin: seconds(-random() * 3.2),
      });
      bars.appendChild(bar);
    }
    svg.appendChild(bars);

    var kick = svgNode('circle', { cx: 100, cy: 100, r: 32, fill: 'none', 'stroke-width': 1.6, opacity: 0.8 }, { stroke: pink });
    loop(kick, animate, { attributeName: 'r', values: '31;35.5;31', keyTimes: '0;0.15;1', dur: '0.4s' });
    loop(kick, animate, { attributeName: 'opacity', values: '1;0.3;1', keyTimes: '0;0.15;1', dur: '0.4s' });
    svg.appendChild(kick);
    return svg;
  }

  /** A four-pointed glint, `size` from its middle to each point, drawn round 0 0. */
  function glintPath(size) {
    var waist = size * 0.2;
    return 'M0 ' + (-size) + ' L' + waist + ' ' + (-waist) + ' L' + size + ' 0 L' + waist + ' ' + waist
      + ' L0 ' + size + ' L' + (-waist) + ' ' + waist + ' L' + (-size) + ' 0 L' + (-waist) + ' ' + (-waist) + ' Z';
  }

  /**
   * A glint at `at` popping up and away again once every `period` seconds
   * - still, caught half-lit.
   */
  function poppingGlint(random, animate, at, size, period) {
    var spot = svgNode('g', { transform: 'translate(' + xy(at) + ')' });
    var glint = svgNode('path', { d: glintPath(size), transform: 'scale(0.5)' });
    loop(glint, animate, {
      attributeName: 'transform', type: 'scale', values: '0;0;1;0;0', keyTimes: '0;0.6;0.72;0.86;1',
      dur: seconds(period), begin: seconds(-random() * period),
    }, 'animateTransform');
    spot.appendChild(glint);
    return spot;
  }

  /** A run of `count` values from `pick()`, as an SMIL values list, back to the first. */
  function jumpy(count, pick) {
    var values = [];
    for (var i = 0; i < count; i++) {
      values.push(pick(i));
    }
    return values.concat(values[0]).join(';');
  }

  /**
   * Fireworks: rockets streaking in from the rim and bursting into
   * two-tone showers of sparks, which swell out, droop and fade into the
   * smoke they leave hanging - one after another all round the record.
   */
  function fireworksArt(random, animate) {
    var svg = svgCanvas();
    var night = exclusiveToken('night');
    var white = exclusiveToken('hot-white');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(night, token('navy'), 50)], [1, night],
    ])));
    stars(svg, random, animate, 30);
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.45,
      filter: noiseFill(svg, random, {
        type: 'fractalNoise', frequency: '0.02', drift: '0.03', seconds: 14, octaves: 3,
        alpha: '1.8 0 0 0 -0.75', color: exclusiveToken('smoke'),
      }, animate),
    }));

    var colors = [
      exclusiveToken('neon-pink'), exclusiveToken('neon-cyan'), 'var(--rarity-gold-bright)',
      exclusiveToken('firework-green'), exclusiveToken('plasma-violet'), exclusiveToken('firework-red'),
    ];
    var glow = glowFilter(svg, 1.3);
    var flash = gradient(svg, 'radial', {}, [[0, white, 1], [0.4, white, 0.5], [1, white, 0]]);
    // Each burst's life, from 0 to 1: the rocket rises till BANG, then the
    // sparks fly out, hang, droop and fade.
    var BANG = 0.28;
    var bursts = 11;
    for (var b = 0; b < bursts; b++) {
      var angle = b * 360 / bursts + between(random, -12, 12);
      var centre = polar(between(random, 50, 76), angle);
      var launch = polar(104, angle + between(random, -14, 14));
      var size = between(random, 20, 34);
      var outer = colors[Math.floor(random() * colors.length)];
      var inner = colors[Math.floor(random() * colors.length)];
      var life = { dur: seconds(between(random, 2.8, 4.2)), begin: seconds(-random() * 4.2) };

      var rocket = svgNode('circle', { cx: centre.x.toFixed(1), cy: centre.y.toFixed(1), r: 1.1, opacity: 0, filter: glow }, { fill: exclusiveToken('flame-tip') });
      loop(rocket, animate, Object.assign({ attributeName: 'cx', values: [launch.x, centre.x, centre.x].map(function (v) { return v.toFixed(1); }).join(';'), keyTimes: '0;' + BANG + ';1' }, life));
      loop(rocket, animate, Object.assign({ attributeName: 'cy', values: [launch.y, centre.y, centre.y].map(function (v) { return v.toFixed(1); }).join(';'), keyTimes: '0;' + BANG + ';1' }, life));
      loop(rocket, animate, Object.assign({ attributeName: 'opacity', values: '1;1;0;0', keyTimes: '0;' + (BANG - 0.01) + ';' + (BANG + 0.01) + ';1' }, life));
      svg.appendChild(rocket);

      var bang = svgNode('circle', { cx: centre.x.toFixed(1), cy: centre.y.toFixed(1), r: 0, opacity: 0, fill: flash });
      loop(bang, animate, Object.assign({ attributeName: 'r', values: '0;0;' + (size * 0.9).toFixed(1) + ';' + (size * 0.9).toFixed(1), keyTimes: '0;' + BANG + ';' + (BANG + 0.08) + ';1' }, life));
      loop(bang, animate, Object.assign({ attributeName: 'opacity', values: '0;0;0.85;0;0', keyTimes: '0;' + BANG + ';' + (BANG + 0.02) + ';' + (BANG + 0.14) + ';1' }, life));
      svg.appendChild(bang);

      // The sparks, drawn at full stretch round 0 0; the burst swells them
      // out from nothing - lengthening each streak as it goes - and drops.
      var place = svgNode('g', { transform: 'translate(' + xy(centre) + ')' });
      var droop = svgNode('g');
      loop(droop, animate, Object.assign({ attributeName: 'transform', type: 'translate', values: '0 0;0 0;0 10', keyTimes: '0;' + BANG + ';1' }, life), 'animateTransform');
      var sparks = svgNode('g', { filter: glow });
      loop(sparks, animate, Object.assign({
        attributeName: 'transform', type: 'scale', values: '0.01;0.01;1;1.08', keyTimes: '0;' + BANG + ';' + (BANG + 0.22) + ';1',
        calcMode: 'spline', keySplines: '0 0 1 1;0.1 0.8 0.3 1;0.4 0 0.6 1',
      }, life), 'animateTransform');
      loop(sparks, animate, Object.assign({ attributeName: 'opacity', values: '0;0;1;1;0', keyTimes: '0;' + (BANG - 0.001) + ';' + BANG + ';0.7;1' }, life));
      [[20, 1, 3.6, outer], [12, 0.55, 2.4, inner]].forEach(function (ring) {
        for (var k = 0; k < ring[0]; k++) {
          var heading = k * 360 / ring[0] + between(random, -6, 6);
          var reach = size * ring[1] * between(random, 0.85, 1.05);
          var theta = (heading - 90) * Math.PI / 180;
          sparks.appendChild(ellipseNode(reach * Math.cos(theta), reach * Math.sin(theta), 0.7, ring[2], heading, { fill: ring[3] }));
        }
      });
      // Crackle: glitter left twinkling in the burst.
      for (var g = 0; g < 7; g++) {
        var twinkle = svgNode('circle', { cx: (between(random, -size, size) * 0.7).toFixed(1), cy: (between(random, -size, size) * 0.7).toFixed(1), r: 0.6 }, { fill: white });
        loop(twinkle, animate, { attributeName: 'opacity', values: '0;1;0', dur: seconds(between(random, 0.2, 0.45)), begin: seconds(-random()) });
        sparks.appendChild(twinkle);
      }
      droop.appendChild(sparks);
      place.appendChild(droop);
      svg.appendChild(place);
    }
    return svg;
  }

  /**
   * Glitch: a TV test card bent round the ring - colour bars and NO SIGNAL
   * - breaking up. The whole picture jolts, its colour channels tear apart
   * and snap back, slices of it jump sideways, chunks flash inverted, tear
   * lines flicker across it, static flashes over it, blocks of colour
   * blink and a bright scan bar rolls through, all in fits and starts.
   */
  function glitchArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(exclusiveToken('glitch-dark')));
    var bars = ['white', 'yellow', 'cyan', 'green', 'magenta', 'red', 'blue'].map(function (name) {
      return exclusiveToken('bar-' + name);
    });
    var black = exclusiveToken('glitch-dark');

    // The picture: the bars twice round, the castellations under them, a
    // band of navy, white and purple, and NO SIGNAL round the rim.
    var picture = svgNode('g', { id: 'vinyl-card-' + (++filterCount) });
    var step = 360 / 14;
    for (var i = 0; i < 14; i++) {
      picture.appendChild(svgNode('path', { d: sectorPath(56, 100, i * step, (i + 1) * step + 0.3) }, { fill: bars[i % 7] }));
      picture.appendChild(svgNode('path', { d: sectorPath(46, 56, i * step, (i + 1) * step + 0.3) }, { fill: i % 2 ? black : bars[6 - (i % 7)] }));
    }
    var lower = [exclusiveToken('bar-navy'), bars[0], exclusiveToken('plasma-violet'), black, exclusiveToken('bar-grey')];
    for (var l = 0; l < 10; l++) {
      picture.appendChild(svgNode('path', { d: sectorPath(29, 46, l * 36, (l + 1) * 36 + 0.3) }, { fill: lower[l % lower.length] }));
    }
    var track = svgNode('path', { id: 'vinyl-track-' + (++filterCount), d: 'M100 12 A88 88 0 1 1 99.9 12' });
    var sign = svgNode('text', { 'text-anchor': 'middle' }, { fontFamily: 'monospace', fontSize: '9px', fontWeight: '900', letterSpacing: '1px', fill: black });
    var words = svgNode('textPath', { href: '#' + track.id, startOffset: '50%' });
    words.textContent = 'NO SIGNAL ■ NO SIGNAL ■ NO SIGNAL ■ NO SIGNAL ■';
    sign.appendChild(words);
    picture.appendChild(sign);
    var defs = svgNode('defs');
    defs.appendChild(track);
    defs.appendChild(picture);
    svg.appendChild(defs);
    function copy() {
      return svgNode('use', { href: '#' + picture.id });
    }
    // The picture itself, jolting now and then: knocked aside, or zoomed a
    // touch, for a frame or two.
    var whole = copy();
    loop(whole, animate, {
      attributeName: 'transform', type: 'translate', calcMode: 'discrete', dur: '2.7s',
      values: jumpy(16, function () {
        return random() < 0.2 ? between(random, -5, 5).toFixed(1) + ' ' + between(random, -3, 3).toFixed(1) : '0 0';
      }),
    }, 'animateTransform');
    svg.appendChild(whole);

    // The colour channels tearing apart: a red ghost and a cyan one, mostly
    // nearly on top, now and then thrown well off - and snapping back.
    function channel(matrix) {
      return addFilter(svg, function (filter) {
        filter.appendChild(svgNode('feColorMatrix', { type: 'matrix', values: matrix }));
      });
    }
    [
      [channel('1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.9 0'), 1],
      [channel('0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.9 0'), -1],
    ].forEach(function (ghost) {
      var torn = copy();
      torn.setAttribute('filter', ghost[0]);
      torn.style.mixBlendMode = 'screen';
      torn.setAttribute('transform', 'translate(' + 2 * ghost[1] + ' 0)');
      loop(torn, animate, {
        attributeName: 'transform', type: 'translate', calcMode: 'discrete', dur: seconds(between(random, 2.2, 3)),
        values: jumpy(18, function () {
          var far = random() < 0.4;
          return (ghost[1] * between(random, far ? 4 : 0.5, far ? 9 : 1.8)).toFixed(1) + ' ' + (far ? between(random, -2, 2) : 0).toFixed(1);
        }),
      }, 'animateTransform');
      svg.appendChild(torn);
    });

    // Slices of the picture jumping sideways, now and then.
    for (var s = 0; s < 10; s++) {
      var y = between(random, 8, 186);
      var cut = svgNode('clipPath', { id: 'vinyl-clip-' + (++filterCount) });
      cut.appendChild(svgNode('rect', { x: 0, y: y.toFixed(1), width: 200, height: between(random, 3, 12).toFixed(1) }));
      var slice = svgNode('g', { 'clip-path': 'url(#' + cut.id + ')' });
      var shifted = copy();
      loop(shifted, animate, {
        attributeName: 'transform', type: 'translate', calcMode: 'discrete', dur: seconds(between(random, 1.6, 3.4)),
        values: jumpy(10, function () {
          return (random() < 0.45 ? between(random, -30, 30) : 0).toFixed(1) + ' 0';
        }),
      }, 'animateTransform');
      slice.appendChild(shifted);
      svg.appendChild(cut);
      svg.appendChild(slice);
    }

    // Chunks of the ring flashing inverted.
    var negative = svgNode('g', {}, { fill: bars[0], mixBlendMode: 'difference' });
    for (var n = 0; n < 9; n++) {
      var from = between(random, 0, 360);
      var chunk = svgNode('path', { d: sectorPath(between(random, 29, 60), between(random, 66, 100), from, from + between(random, 12, 50)), opacity: 0 });
      loop(chunk, animate, {
        attributeName: 'opacity', calcMode: 'discrete', dur: seconds(between(random, 1.4, 3.2)),
        values: jumpy(9, function () {
          return random() < 0.2 ? '1' : '0';
        }),
      });
      negative.appendChild(chunk);
    }
    svg.appendChild(negative);

    // Tear lines: thin bright lines flickering across, jumping about.
    for (var t = 0; t < 8; t++) {
      var tear = svgNode('rect', { x: 0, y: between(random, 0, 200).toFixed(1), width: 200, height: between(random, 0.4, 1.2).toFixed(2), opacity: 0 }, { fill: bars[t % 3 ? 0 : 2] });
      var beat = seconds(between(random, 0.9, 2.2));
      loop(tear, animate, { attributeName: 'y', calcMode: 'discrete', dur: beat, values: jumpy(7, function () { return between(random, 0, 200).toFixed(1); }) });
      loop(tear, animate, { attributeName: 'opacity', calcMode: 'discrete', dur: beat, values: jumpy(7, function () { return random() < 0.4 ? '0.8' : '0'; }) });
      svg.appendChild(tear);
    }

    // Blocks of colour blinking in and out.
    for (var k = 0; k < 26; k++) {
      var block = svgNode('rect', {
        x: between(random, 10, 180).toFixed(1), y: between(random, 10, 185).toFixed(1),
        width: between(random, 4, 20).toFixed(1), height: between(random, 1.5, 6).toFixed(1), opacity: 0,
      }, { fill: bars[Math.floor(random() * bars.length)] });
      loop(block, animate, {
        attributeName: 'opacity', calcMode: 'discrete', dur: seconds(between(random, 1.2, 3)),
        values: jumpy(8, function () {
          return random() < 0.3 ? '0.9' : '0';
        }),
      });
      svg.appendChild(block);
    }

    // Static, flashing over it all in bursts.
    var noise = svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0,
      filter: noiseFill(svg, random, {
        type: 'fractalNoise', frequency: '0.9', drift: '0.6', seconds: 0.3, octaves: 1,
        alpha: '3 0 0 0 -1.6', color: bars[0],
      }, animate),
    });
    loop(noise, animate, { attributeName: 'opacity', calcMode: 'discrete', values: '0;0.4;0;0.55;0;0;0.35;0.6;0;0.25;0;0.5', dur: '3.1s' });
    svg.appendChild(noise);

    // Scanlines, and a bright bar rolling through them.
    var lines = [];
    for (var ly = 1; ly < 200; ly += 2.2) {
      lines.push('M0 ' + ly.toFixed(1) + ' H200');
    }
    svg.appendChild(svgNode('path', { d: lines.join(' '), 'stroke-width': 0.7, opacity: 0.35 }, { stroke: black }));
    var roll = svgNode('rect', {
      x: 0, y: 60, width: 200, height: 22,
      fill: gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, bars[0], 0], [0.5, bars[0], 0.22], [1, bars[0], 0]]),
    });
    loop(roll, animate, { attributeName: 'y', values: '-24;200', dur: '3.6s' });
    svg.appendChild(roll);
    return svg;
  }

  /**
   * Amethyst Geode: a geode cracked open - wavy rings of agate, rind to
   * white, slowly flowing like the stone were still molten, round a hollow
   * of faceted purple crystal points. Glints pop off the crystals and
   * pulses of violet energy well up from the middle and out through them.
   */
  function geodeArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(exclusiveToken('geode-rind')));
    var deep = exclusiveToken('amethyst-deep');
    var amethyst = exclusiveToken('amethyst');
    var light = exclusiveToken('amethyst-light');

    // The agate: rings, each wobbling its own way, painted outside in.
    var agate = svgNode('g', { filter: warp(svg, random, '0.025', 7, 0, animate ? [3, 10] : null, 7) });
    var bands = ['geode-rind', 'agate-grey', 'agate-cream', 'agate-lilac', 'agate-white', 'agate-grey', 'agate-lilac', 'agate-cream', 'amethyst-deep'];
    bands.forEach(function (name, index) {
      var radius = 104 - index * 4.6;
      var phases = [random() * 6.3, random() * 6.3];
      var points = [];
      for (var d = 0; d < 360; d += 4) {
        var t = d * Math.PI / 180;
        points.push(polar(radius + Math.sin(t * 5 + phases[0]) * 1.8 + Math.sin(t * 9 + phases[1]) * 1.1, d));
      }
      agate.appendChild(svgNode('path', { d: 'M' + points.map(xy).join(' L') + ' Z' }, { fill: exclusiveToken(name) }));
    });
    svg.appendChild(agate);

    // The glow down in the hollow, breathing.
    var hollow = svgNode('circle', {
      cx: 100, cy: 100, r: 66,
      fill: gradient(svg, 'radial', {}, [[0.4, light, 0.9], [0.65, amethyst, 0.8], [1, deep, 1]]),
    });
    svg.appendChild(hollow);

    // Crystal points, rings of them, big ones behind, each two facets -
    // one catching the light, one in shadow.
    var crystals = svgNode('g', { 'stroke-width': 0.3, 'stroke-linejoin': 'miter' }, { stroke: deep });
    var tips = [];
    [
      { base: 66, count: 30, length: [18, 26], width: [4, 6.5] },
      { base: 58, count: 28, length: [14, 20], width: [4, 7] },
      { base: 48, count: 24, length: [10, 15], width: [5, 8] },
    ].forEach(function (ring) {
      for (var c = 0; c < ring.count; c++) {
        var at = c * 360 / ring.count + between(random, -4, 4);
        var half = between(random, ring.width[0], ring.width[1]);
        var tip = polar(ring.base - between(random, ring.length[0], ring.length[1]), at + between(random, -4, 4));
        var left = polar(ring.base, at - half);
        var right = polar(ring.base, at + half);
        var ridge = polar(ring.base - 2, at);
        var shade = between(random, 0, 30);
        crystals.appendChild(svgNode('path', { d: 'M' + xy(left) + ' L' + xy(tip) + ' L' + xy(ridge) + ' Z' }, { fill: mix(light, amethyst, 25 + shade) }));
        crystals.appendChild(svgNode('path', { d: 'M' + xy(ridge) + ' L' + xy(tip) + ' L' + xy(right) + ' Z' }, { fill: mix(amethyst, deep, 20 + shade) }));
        tips.push(tip);
      }
    });
    svg.appendChild(crystals);

    // Energy welling up from the middle, out through the crystals.
    var surge = svgNode('g', {}, { fill: 'none', stroke: light, mixBlendMode: 'screen' });
    surge.setAttribute('filter', glowFilter(svg, 2.4));
    for (var p = 0; p < 2; p++) {
      var pulse = svgNode('circle', { cx: 100, cy: 100, r: 30, opacity: 0, 'stroke-width': 3 });
      var when = { dur: '3.4s', begin: seconds(-p * 1.7) };
      loop(pulse, animate, Object.assign({ attributeName: 'r', values: '30;72', calcMode: 'spline', keyTimes: '0;1', keySplines: '0.2 0.6 0.4 1' }, when));
      loop(pulse, animate, Object.assign({ attributeName: 'opacity', values: '0.9;0', calcMode: 'spline', keyTimes: '0;1', keySplines: '0.5 0 1 1' }, when));
      loop(pulse, animate, Object.assign({ attributeName: 'stroke-width', values: '4;0.5' }, when));
      surge.appendChild(pulse);
    }
    svg.appendChild(surge);

    var glints = svgNode('g', { filter: glowFilter(svg, 0.8) }, { fill: exclusiveToken('agate-white') });
    for (var g = 0; g < 16; g++) {
      glints.appendChild(poppingGlint(random, animate, tips[Math.floor(random() * tips.length)], between(random, 3, 5.5), between(random, 1.8, 3.6)));
    }
    svg.appendChild(glints);
    return svg;
  }

  /**
   * Laser Show: six emitters round the rim, each throwing a fan of green,
   * red or blue beams through drifting haze and sweeping it back and forth,
   * the fans crossing and strobing, and the whole club flashing white.
   */
  function laserShowArt(random, animate) {
    var svg = svgCanvas();
    var haze = exclusiveToken('haze');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(haze, exclusiveToken('haze-light'), 30)], [1, mix(haze, 'var(--color-black)', 40)],
    ])));
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.6,
      filter: noiseFill(svg, random, {
        type: 'fractalNoise', frequency: '0.018', drift: '0.03', seconds: 10, octaves: 3,
        alpha: '1.6 0 0 0 -0.55', color: exclusiveToken('haze-light'),
      }, animate),
    }));

    var colors = ['laser-green', 'laser-red', 'laser-blue', 'neon-pink', 'laser-green', 'laser-blue'].map(exclusiveToken);
    var glow = glowFilter(svg, 1.1);
    var lasers = svgNode('g', { filter: glow }, { mixBlendMode: 'screen' });
    colors.forEach(function (color, e) {
      var angle = e * 60 + between(random, -10, 10);
      var from = polar(99, angle);
      var pivot = xy(from);
      // Bright at the emitter, fading across the room.
      var fade = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: from.x.toFixed(1), cy: from.y.toFixed(1), r: '210' }, [
        [0, color, 1], [0.55, color, 0.65], [1, color, 0],
      ]);
      var inward = Math.atan2(100 - from.y, 100 - from.x);
      var sweep = between(random, 18, 32);
      var fan = svgNode('g', { transform: 'rotate(0 ' + pivot + ')' });
      loop(fan, animate, Object.assign({
        attributeName: 'transform', type: 'rotate',
        values: -sweep + ' ' + pivot + ';' + sweep + ' ' + pivot + ';' + -sweep + ' ' + pivot,
        dur: seconds(between(random, 2.4, 4.2)), begin: seconds(-random() * 4),
      }, EASE_BACK_AND_FORTH), 'animateTransform');
      var beams = between(random, 4, 7);
      var spread = between(random, 6, 11);
      // A sheet of light behind the beams, filling the fan.
      var edges = [inward - spread * (beams - 1) / 2 * Math.PI / 180, inward + spread * (beams - 1) / 2 * Math.PI / 180];
      fan.appendChild(svgNode('path', {
        d: 'M' + pivot + ' L' + (from.x + Math.cos(edges[0]) * 210).toFixed(1) + ' ' + (from.y + Math.sin(edges[0]) * 210).toFixed(1)
          + ' L' + (from.x + Math.cos(edges[1]) * 210).toFixed(1) + ' ' + (from.y + Math.sin(edges[1]) * 210).toFixed(1) + ' Z',
        opacity: 0.1, fill: fade,
      }));
      for (var k = 0; k < Math.floor(beams); k++) {
        var heading = inward + (k - (Math.floor(beams) - 1) / 2) * spread * Math.PI / 180;
        fan.appendChild(svgNode('line', {
          x1: from.x.toFixed(1), y1: from.y.toFixed(1),
          x2: (from.x + Math.cos(heading) * 210).toFixed(1), y2: (from.y + Math.sin(heading) * 210).toFixed(1),
          'stroke-width': between(random, 0.5, 0.9).toFixed(2), stroke: fade,
        }));
      }
      // Strobing: the fan cutting out in bursts.
      loop(fan, animate, {
        attributeName: 'opacity', calcMode: 'discrete', dur: seconds(between(random, 1.6, 2.8)),
        values: jumpy(10, function () {
          return random() < 0.25 ? '0' : '1';
        }),
      });
      lasers.appendChild(fan);
      lasers.appendChild(svgNode('circle', { cx: from.x.toFixed(1), cy: from.y.toFixed(1), r: 2.4 }, { fill: lighter(color, 50) }));
    });
    svg.appendChild(lasers);

    var strobe = svgNode('rect', { x: 0, y: 0, width: 200, height: 200, opacity: 0 }, { fill: exclusiveToken('hot-white') });
    loop(strobe, animate, { attributeName: 'opacity', values: '0;0;0.28;0;0.18;0;0', keyTimes: '0;0.86;0.87;0.9;0.91;0.94;1', dur: '3.3s' });
    svg.appendChild(strobe);
    return svg;
  }

  /**
   * Jellyfish Bloom: glowing jellyfish swimming out through the deep, each
   * clenching its whole bell hard to push off - flaring bright, tentacles
   * snapped out straight behind it - then sliding smoothly on while it
   * slowly opens out again, tentacles settling back into waves. Sunbeams
   * waver down and marine snow drifts by.
   */
  function jellyfishArt(random, animate) {
    var svg = svgCanvas();
    var sea = exclusiveToken('jelly-sea');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '62%' }, [
      [0, mix(sea, exclusiveToken('jelly-blue'), 22)], [1, exclusiveToken('abyss')],
    ])));

    // Sunbeams slanting down through the water, wavering.
    var rays = svgNode('g', {}, { fill: exclusiveToken('jelly-blue'), mixBlendMode: 'screen' });
    for (var r = 0; r < 6; r++) {
      var x = between(random, -20, 160);
      var width = between(random, 6, 16);
      var ray = svgNode('path', { d: 'M' + x.toFixed(1) + ' -5 L' + (x + width).toFixed(1) + ' -5 L' + (x + width + 70).toFixed(1) + ' 205 L' + (x + 60).toFixed(1) + ' 205 Z', opacity: 0.08 });
      loop(ray, animate, Object.assign({ attributeName: 'opacity', values: '0.03;0.14;0.03', dur: seconds(between(random, 3, 6)), begin: seconds(-random() * 6) }, EASE_BACK_AND_FORTH));
      rays.appendChild(ray);
    }
    svg.appendChild(rays);

    var snow = svgNode('g', {}, { fill: exclusiveToken('jelly-blue') });
    for (var m = 0; m < 36; m++) {
      var my = between(random, 0, 200);
      var mote = svgNode('circle', { cx: between(random, 0, 200).toFixed(1), cy: my.toFixed(1), r: between(random, 0.3, 0.8).toFixed(2), opacity: between(random, 0.2, 0.6).toFixed(2) });
      loop(mote, animate, { attributeName: 'cy', values: (my - 6).toFixed(1) + ';' + (my + 6).toFixed(1) + ';' + (my - 6).toFixed(1), dur: seconds(between(random, 6, 11)) });
      snow.appendChild(mote);
    }
    svg.appendChild(snow);

    // A jellyfish drawn swimming towards +x: the bell's dome in front, its
    // scalloped mouth at x 0, tentacles trailing behind. Relaxed and
    // squeezed bells have the same commands, so the one morphs into the other.
    function bell(round, reach) {
      var h = round;
      return 'M0 ' + (-h) + ' C' + (reach * 0.62).toFixed(1) + ' ' + (-h) + ' ' + reach + ' ' + (-h * 0.55).toFixed(1) + ' ' + reach + ' 0'
        + ' C' + reach + ' ' + (h * 0.55).toFixed(1) + ' ' + (reach * 0.62).toFixed(1) + ' ' + h + ' 0 ' + h
        + ' Q1.6 ' + (h * 0.66).toFixed(1) + ' 0 ' + (h * 0.5).toFixed(1) + ' Q1.6 ' + (h * 0.17).toFixed(1) + ' 0 0'
        + ' Q1.6 ' + (-h * 0.17).toFixed(1) + ' 0 ' + (-h * 0.5).toFixed(1) + ' Q1.6 ' + (-h * 0.66).toFixed(1) + ' 0 ' + (-h) + ' Z';
    }
    function tentacle(y, length, sway) {
      return 'M0 ' + y + ' Q' + (-length * 0.17).toFixed(1) + ' ' + (y + sway).toFixed(1) + ' ' + (-length / 3).toFixed(1) + ' ' + y
        + ' T' + (-length * 2 / 3).toFixed(1) + ' ' + y + ' T' + (-length).toFixed(1) + ' ' + y;
    }
    var hues = ['jelly-pink', 'jelly-blue', 'plasma-violet'].map(exclusiveToken);
    var glow = glowFilter(svg, 1.5);
    var JELLIES = 8;
    for (var j = 0; j < JELLIES; j++) {
      var hue = hues[j % hues.length];
      var angle = j * 360 / JELLIES + between(random, -18, 18);
      var start = polar(26, angle);
      var end = polar(122, angle + between(random, -25, 25));
      var heading = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
      var pulse = between(random, 1.9, 2.6);
      var strokes = 5;
      var trip = { dur: seconds(pulse * strokes), begin: seconds(-random() * pulse * strokes) };
      var swim = svgNode('g', {
        transform: 'translate(' + ((start.x + end.x) / 2).toFixed(1) + ' ' + ((start.y + end.y) / 2).toFixed(1) + ') rotate(' + heading.toFixed(0) + ')',
      });
      if (animate) {
        swim.removeAttribute('transform');
        var steps = [];
        var splines = [];
        for (var st = 0; st <= strokes; st++) {
          steps.push((st / strokes).toFixed(3));
          if (st) {
            // Pushed off as the bell clenches, then a long, smooth slide
            // that eases out through most of the beat.
            splines.push('0.3 0.4 0.3 1');
          }
        }
        loop(swim, animate, Object.assign({
          path: 'M' + xy(start) + ' L' + xy(end), rotate: 'auto',
          keyPoints: steps.join(';'), keyTimes: steps.join(';'), calcMode: 'spline', keySplines: splines.join(';'),
        }, trip), 'animateMotion');
        loop(swim, animate, Object.assign({ attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.12;0.82;1' }, trip));
      }
      var body = svgNode('g', { transform: 'scale(' + between(random, 1.3, 2).toFixed(2) + ')' });
      var beat = { dur: seconds(pulse), begin: trip.begin };
      // Each beat: clench fast (the first 18%), then open out slowly.
      var stroke = { keyTimes: '0;0.18;1', calcMode: 'spline', keySplines: '0.5 0 0.9 0.6;0.2 0.4 0.4 1' };
      // The whole jelly squashing and stretching with it.
      var squash = svgNode('g');
      loop(squash, animate, Object.assign({ attributeName: 'transform', type: 'scale', values: '1 1;1.14 0.7;1 1' }, stroke, beat), 'animateTransform');
      var trail = svgNode('g', {}, { fill: 'none', stroke: lighter(hue, 30), strokeLinecap: 'round' });
      [-5, -2.5, 0, 2.5, 5].forEach(function (y) {
        var length = between(random, 22, 38);
        var sway = between(random, 2, 3.5);
        var strand = svgNode('path', { d: tentacle(y, length, sway), 'stroke-width': 0.45, opacity: 0.75 });
        // Snapped out long and straight on the stroke, settling back into waves.
        loop(strand, animate, Object.assign({
          attributeName: 'd', values: [tentacle(y, length, sway), tentacle(y * 0.6, length * 1.2, sway * 0.15), tentacle(y, length, sway)].join(';'),
        }, stroke, beat));
        trail.appendChild(strand);
      });
      // Two frilly oral arms, thicker and shorter.
      [-1.5, 1.5].forEach(function (y) {
        var arm = svgNode('path', { d: tentacle(y, 14, 1.5), 'stroke-width': 1.3, opacity: 0.8 });
        loop(arm, animate, Object.assign({ attributeName: 'd', values: [tentacle(y, 14, 1.5), tentacle(y * 0.5, 17, 0.2), tentacle(y, 14, 1.5)].join(';') }, stroke, beat));
        trail.appendChild(arm);
      });
      squash.appendChild(trail);
      var dome = svgNode('path', {
        d: bell(10, 10), filter: glow, opacity: 0.85,
        fill: gradient(svg, 'radial', { cx: '0.6', cy: '0.5', r: '0.7' }, [[0, lighter(hue, 55), 1], [0.5, hue, 0.8], [1, hue, 0.4]]),
      });
      // Clenched to half its width and long, then opened out wide and round.
      loop(dome, animate, Object.assign({ attributeName: 'd', values: [bell(10, 10), bell(5, 15), bell(10, 10)].join(';') }, stroke, beat));
      // Flaring bright as it clenches.
      loop(dome, animate, Object.assign({ attributeName: 'opacity', values: '0.8;1;0.8' }, stroke, beat));
      squash.appendChild(dome);
      // The four rings inside the bell.
      for (var g = 0; g < 4; g++) {
        squash.appendChild(ellipseNode(4.5 + (g % 2) * 1.2, -4.5 + g * 3, 1.4, 1, 0, { fill: 'none', stroke: lighter(hue, 50), strokeWidth: '0.5', opacity: '0.7' }));
      }
      body.appendChild(squash);
      swim.appendChild(body);
      svg.appendChild(swim);
    }
    return svg;
  }

  /**
   * Double Helix: a glowing strand of DNA wound all the way round the
   * record, twisting - its two backbones swinging in and out past each
   * other, the base pairs between them stretching and shrinking - while
   * pulses of light race along it and a scanner ring sweeps in and out.
   */
  function doubleHelixArt(random, animate) {
    var svg = svgCanvas();
    var lab = exclusiveToken('helix-lab');
    var strandA = exclusiveToken('helix-a');
    var strandB = exclusiveToken('helix-b');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(lab, strandA, 14)], [1, lab],
    ])));
    // A lab screen's dot grid.
    var grid = svgNode('pattern', { id: 'vinyl-pattern-' + (++filterCount), width: 7, height: 7, patternUnits: 'userSpaceOnUse' });
    grid.appendChild(svgNode('circle', { cx: 3.5, cy: 3.5, r: 0.45 }, { fill: strandA }));
    var defs = svgNode('defs');
    defs.appendChild(grid);
    svg.appendChild(defs);
    svg.appendChild(svgNode('rect', { x: 0, y: 0, width: 200, height: 200, fill: 'url(#' + grid.id + ')', opacity: 0.22 }));

    var scanner = svgNode('circle', { cx: 100, cy: 100, r: 60, 'stroke-width': 1.2, opacity: 0.5, filter: glowFilter(svg, 1.5) }, { fill: 'none', stroke: strandA });
    loop(scanner, animate, Object.assign({ attributeName: 'r', values: '34;96;34', dur: '5s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(scanner);

    var MIDDLE = 64;
    var SWING = 20;
    var TWISTS = 7;
    var FRAMES = 12;
    var LOOP = '3.6s';
    function radius(degrees, phase, side) {
      return MIDDLE + side * SWING * Math.sin(TWISTS * degrees * Math.PI / 180 + phase);
    }
    function backbone(phase, side) {
      var points = [];
      for (var d = 0; d <= 360; d += 4) {
        points.push(polar(radius(d, phase, side), d));
      }
      return 'M' + points.map(xy).join(' L');
    }
    // The base pairs: four kinds, each rung dealt to one of them.
    var kinds = [strandA, strandB, exclusiveToken('base-c'), exclusiveToken('base-d')];
    var rungs = [[], [], [], []];
    for (var d = 0; d < 360; d += 6) {
      rungs[Math.floor(random() * 4)].push(d);
    }
    function pairs(list, phase) {
      return list.map(function (degrees) {
        return 'M' + xy(polar(radius(degrees, phase, 1), degrees)) + ' L' + xy(polar(radius(degrees, phase, -1), degrees));
      }).join(' ') || 'M0 0';
    }
    // One twist of the whole thing - in shapes to morph through.
    function shapes(draw) {
      var list = [];
      for (var f = 0; f <= FRAMES; f++) {
        list.push(draw(2 * Math.PI * f / FRAMES));
      }
      return list;
    }
    function twisting(node, draw) {
      var list = shapes(draw);
      node.setAttribute('d', list[0]);
      loop(node, animate, { attributeName: 'd', values: list.join(';'), dur: LOOP });
      return node;
    }
    var helix = svgNode('g', { filter: glowFilter(svg, 1.1) }, { fill: 'none', strokeLinecap: 'round' });
    rungs.forEach(function (list, k) {
      helix.appendChild(twisting(svgNode('path', { 'stroke-width': 1.2, opacity: 0.85 }, { stroke: kinds[k] }), function (phase) {
        return pairs(list, phase);
      }));
    });
    [[1, strandA], [-1, strandB]].forEach(function (side) {
      helix.appendChild(twisting(svgNode('path', { 'stroke-width': 2.4 }, { stroke: side[1] }), function (phase) {
        return backbone(phase, side[0]);
      }));
      // Pulses of light racing along it.
      var pulses = twisting(svgNode('path', { 'stroke-width': 1.2, 'stroke-dasharray': '4 46', pathLength: 400 }, { stroke: exclusiveToken('hot-white') }), function (phase) {
        return backbone(phase, side[0]);
      });
      loop(pulses, animate, { attributeName: 'stroke-dashoffset', values: side[0] > 0 ? '0;-400' : '0;400', dur: '4.2s' });
      helix.appendChild(pulses);
    });
    svg.appendChild(helix);

    // Specks drifting off it, fading as they go.
    var specks = svgNode('g', {}, { fill: strandA });
    for (var s = 0; s < 18; s++) {
      var angle = between(random, 0, 360);
      var from = polar(between(random, 44, 84), angle);
      var to = polar(between(random, 90, 104), angle);
      var drift = { dur: seconds(between(random, 3, 6)), begin: seconds(-random() * 6) };
      var speck = svgNode('circle', { cx: from.x.toFixed(1), cy: from.y.toFixed(1), r: 0.7, opacity: 0.6 });
      loop(speck, animate, Object.assign({ attributeName: 'cx', values: from.x.toFixed(1) + ';' + to.x.toFixed(1) }, drift));
      loop(speck, animate, Object.assign({ attributeName: 'cy', values: from.y.toFixed(1) + ';' + to.y.toFixed(1) }, drift));
      loop(speck, animate, Object.assign({ attributeName: 'opacity', values: '0.9;0' }, drift));
      specks.appendChild(speck);
    }
    svg.appendChild(specks);
    return svg;
  }

  /**
   * Atomic: electrons whirling round crossed orbits with comet tails, the
   * nucleus glowing and jostling round the label, photons flying off and
   * rings of energy rippling out.
   */
  function atomicArt(random, animate) {
    var svg = svgCanvas();
    var nucleus = exclusiveToken('nucleus');
    var electron = exclusiveToken('electron');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(exclusiveToken('night'), nucleus, 22)], [0.55, mix(exclusiveToken('night'), electron, 8)], [1, exclusiveToken('night')],
    ])));
    stars(svg, random, animate, 20, electron);

    for (var w = 0; w < 2; w++) {
      var wave = svgNode('circle', { cx: 100, cy: 100, r: 36, opacity: 0, 'stroke-width': 1 }, { fill: 'none', stroke: nucleus });
      var when = { dur: '3.2s', begin: seconds(-w * 1.6) };
      loop(wave, animate, Object.assign({ attributeName: 'r', values: '36;100' }, when));
      loop(wave, animate, Object.assign({ attributeName: 'opacity', values: '0.7;0' }, when));
      svg.appendChild(wave);
    }

    var core = svgNode('circle', {
      cx: 100, cy: 100, r: 40,
      fill: gradient(svg, 'radial', {}, [[0.6, nucleus, 0.9], [0.8, nucleus, 0.35], [1, nucleus, 0]]),
    });
    loop(core, animate, Object.assign({ attributeName: 'r', values: '38;44;38', dur: '1.8s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(core);

    // Protons and neutrons crowding round the label's edge, jostling.
    var shine = [
      gradient(svg, 'radial', { cx: '0.35', cy: '0.35', r: '0.7' }, [[0, lighter(nucleus, 55)], [0.5, nucleus], [1, darker(nucleus, 45)]]),
      gradient(svg, 'radial', { cx: '0.35', cy: '0.35', r: '0.7' }, [[0, lighter(exclusiveToken('neutron'), 50)], [0.5, exclusiveToken('neutron')], [1, darker(exclusiveToken('neutron'), 50)]]),
    ];
    for (var n = 0; n < 22; n++) {
      var spot = polar(between(random, 29, 35), n * 360 / 22 + between(random, -6, 6));
      var ball = svgNode('circle', { cx: spot.x.toFixed(1), cy: spot.y.toFixed(1), r: between(random, 3, 4.2).toFixed(1), fill: shine[n % 2] });
      var jiggle = { dur: seconds(between(random, 0.25, 0.5)), begin: seconds(-random()) };
      loop(ball, animate, Object.assign({ attributeName: 'cx', values: [0, 0.8, -0.6, 0].map(function (o) { return (spot.x + o).toFixed(1); }).join(';') }, jiggle));
      loop(ball, animate, Object.assign({ attributeName: 'cy', values: [0, -0.6, 0.7, 0].map(function (o) { return (spot.y + o).toFixed(1); }).join(';') }, jiggle));
      svg.appendChild(ball);
    }

    // The orbits: long thin ellipses crossing each other, each with an
    // electron racing round it trailing a comet tail.
    var glow = glowFilter(svg, 1.2);
    var tilt = between(random, 0, 45);
    [[84, 27], [80, 24], [88, 30], [76, 22]].forEach(function (size, o) {
      var orbit = svgNode('g', { transform: 'rotate(' + (tilt + o * 45).toFixed(1) + ' 100 100)', filter: glow });
      var ring = 'M' + (100 + size[0]) + ' 100 A' + size[0] + ' ' + size[1] + ' 0 1 1 ' + (100 - size[0]) + ' 100 A' + size[0] + ' ' + size[1] + ' 0 1 1 ' + (100 + size[0]) + ' 100';
      orbit.appendChild(svgNode('path', { d: ring, 'stroke-width': 0.6, opacity: 0.4 }, { fill: 'none', stroke: electron }));
      var period = between(random, 2.4, 3.4);
      var backwards = random() < 0.5;
      // Each dot of the tail starts its lap a little after the one before -
      // so it's that much further back along the orbit - and the electron
      // itself (t 0) is drawn last, on top of its tail.
      var start = -(o * 0.37) - period;
      var lag = period * 0.02;
      for (var t = 6; t >= 0; t--) {
        var dot = svgNode('circle', { cx: 0, cy: 0, r: (2.4 - t * 0.28).toFixed(2), opacity: (1 - t * 0.13).toFixed(2), transform: 'translate(' + (100 + size[0]) + ' 100)' }, { fill: t ? electron : exclusiveToken('hot-white') });
        if (animate) {
          dot.removeAttribute('transform');
          loop(dot, animate, {
            path: ring, dur: seconds(period), begin: seconds(start + t * lag),
            keyPoints: backwards ? '1;0' : '0;1', keyTimes: '0;1', calcMode: 'linear',
          }, 'animateMotion');
        }
        orbit.appendChild(dot);
      }
      svg.appendChild(orbit);
    });

    // Photons: wiggles of light flying off, fading as they go.
    for (var p = 0; p < 4; p++) {
      var angle = between(random, 0, 360);
      var from = polar(56, angle);
      var to = polar(112, angle);
      var photon = svgNode('path', {
        d: 'M-8 0 Q-6 -2.5 -4 0 T0 0 T4 0 T8 0', 'stroke-width': 0.9, filter: glow,
        transform: 'translate(' + xy(polar(80, angle)) + ') rotate(' + (angle - 90).toFixed(0) + ')',
      }, { fill: 'none', stroke: exclusiveToken('plasma-pink') });
      if (animate) {
        photon.removeAttribute('transform');
        var flight = { dur: seconds(between(random, 1.8, 2.8)), begin: seconds(-random() * 3) };
        loop(photon, animate, Object.assign({ path: 'M' + xy(from) + ' L' + xy(to), rotate: 'auto' }, flight), 'animateMotion');
        loop(photon, animate, Object.assign({ attributeName: 'opacity', values: '1;1;0', keyTimes: '0;0.6;1' }, flight));
      }
      svg.appendChild(photon);
    }
    return svg;
  }

  /**
   * Neon City: a tiny planet of skyscrapers standing round the label, their
   * windows flickering, neon signs blinking and aircraft lights winking on
   * the tallest, traffic streaming both ways round the ring road and
   * searchlights sweeping the starry sky beyond.
   */
  function neonCityArt(random, animate) {
    var svg = svgCanvas();
    var sky = exclusiveToken('city-sky');
    var block = exclusiveToken('city-block');
    var windows = exclusiveToken('window');
    var pink = exclusiveToken('neon-pink');
    var cyan = exclusiveToken('neon-cyan');
    // The glow of the city low down, fading up into the night.
    svg.appendChild(fullRect(gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '100' }, [
      [0.3, exclusiveToken('city-haze')], [0.6, mix(sky, exclusiveToken('city-haze'), 35)], [1, sky],
    ])));
    stars(svg, random, animate, 34);

    var ground = 35;
    var beams = svgNode('g', { filter: glowFilter(svg, 1.4) }, { mixBlendMode: 'screen' });
    svg.appendChild(beams);
    var towers = svgNode('g');
    var lit = svgNode('g', { 'stroke-dasharray': '1.3 1.5', 'stroke-width': 1.2 }, { stroke: windows, fill: 'none' });
    var neon = svgNode('g', { filter: glowFilter(svg, 0.9) }, { fill: 'none', strokeLinecap: 'round' });
    var beacons = svgNode('g', { filter: glowFilter(svg, 0.7) }, { fill: exclusiveToken('firework-red') });
    var tall = [];
    for (var at = 0; at < 358;) {
      var width = between(random, 5, 11);
      var end = Math.min(at + width, 360);
      var height = random() < 0.15 ? between(random, 50, 60) : between(random, 14, 44);
      var top = ground + height;
      var taper = Math.min(1.2, (end - at) * 0.15);
      var outline = [polar(ground, at), polar(top, at + taper), polar(top, end - taper), polar(ground, end)];
      var tower = svgNode('path', { d: 'M' + outline.map(xy).join(' L') + ' Z', 'stroke-width': 0.5 }, {
        fill: mix(block, sky, between(random, 0, 45)), stroke: mix(block, 'var(--color-black)', 40),
      });
      towers.appendChild(tower);
      // Neon trim on some, up one edge and along the roof.
      if (random() < 0.35) {
        neon.appendChild(svgNode('path', { d: 'M' + xy(outline[0]) + ' L' + xy(outline[1]) + ' L' + xy(outline[2]), 'stroke-width': 0.6 }, { stroke: random() < 0.5 ? pink : cyan }));
      }
      // Windows: dashed columns up the face, some flickering.
      var columns = Math.max(1, Math.floor((end - at) / 3));
      for (var c = 1; c <= columns; c++) {
        var angle = at + (end - at) * c / (columns + 1);
        var column = svgNode('path', { d: 'M' + xy(polar(ground + 2, angle)) + ' L' + xy(polar(top - 2, angle)), opacity: 0.85 });
        if (random() < 0.3) {
          loop(column, animate, {
            attributeName: 'opacity', calcMode: 'discrete', dur: seconds(between(random, 1.5, 4)),
            values: jumpy(6, function () { return random() < 0.4 ? '0.15' : '0.85'; }),
          });
        }
        lit.appendChild(column);
      }
      // A neon sign on the face, blinking.
      if (random() < 0.3) {
        var signAt = between(random, ground + 6, top - 6);
        var sign = svgNode('path', { d: 'M' + xy(polar(signAt, at + taper + 0.6)) + ' L' + xy(polar(signAt, end - taper - 0.6)), 'stroke-width': 2.2 }, {
          stroke: [pink, cyan, 'var(--rarity-gold-bright)'][Math.floor(random() * 3)],
        });
        loop(sign, animate, { attributeName: 'opacity', calcMode: 'discrete', values: '1;1;1;0.2;1;0;1;1', dur: seconds(between(random, 1.8, 3.5)) });
        neon.appendChild(sign);
      }
      if (height > 46) {
        tall.push({ tip: polar(top + 4, (at + end) / 2), angle: (at + end) / 2 });
        neon.appendChild(svgNode('path', { d: 'M' + xy(polar(top, (at + end) / 2)) + ' L' + xy(polar(top + 4, (at + end) / 2)), 'stroke-width': 0.5 }, { stroke: block }));
        var beacon = svgNode('circle', { cx: polar(top + 4, (at + end) / 2).x.toFixed(1), cy: polar(top + 4, (at + end) / 2).y.toFixed(1), r: 1 });
        loop(beacon, animate, { attributeName: 'opacity', values: '1;0.1;1', dur: seconds(between(random, 0.9, 1.6)) });
        beacons.appendChild(beacon);
      }
      at = end;
    }
    svg.appendChild(towers);
    svg.appendChild(lit);
    svg.appendChild(neon);
    svg.appendChild(beacons);

    // Searchlights from the tallest roofs, sweeping the sky.
    tall.slice(0, 4).forEach(function (tower) {
      var pivot = xy(tower.tip);
      var reach = 80;
      var theta = (tower.angle - 90) * Math.PI / 180;
      var left = { x: tower.tip.x + Math.cos(theta - 0.07) * reach, y: tower.tip.y + Math.sin(theta - 0.07) * reach };
      var right = { x: tower.tip.x + Math.cos(theta + 0.07) * reach, y: tower.tip.y + Math.sin(theta + 0.07) * reach };
      var light = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: tower.tip.x.toFixed(1), cy: tower.tip.y.toFixed(1), r: String(reach) }, [
        [0, exclusiveToken('searchlight'), 0.55], [1, exclusiveToken('searchlight'), 0],
      ]);
      var beam = svgNode('path', { d: 'M' + pivot + ' L' + xy(left) + ' L' + xy(right) + ' Z', fill: light });
      var swing = between(random, 25, 40);
      loop(beam, animate, Object.assign({
        attributeName: 'transform', type: 'rotate', values: -swing + ' ' + pivot + ';' + swing + ' ' + pivot + ';' + -swing + ' ' + pivot,
        dur: seconds(between(random, 3.5, 6)), begin: seconds(-random() * 6),
      }, EASE_BACK_AND_FORTH), 'animateTransform');
      beams.appendChild(beam);
    });

    // The ring road, and traffic streaming both ways round it.
    svg.appendChild(svgNode('circle', { cx: 100, cy: 100, r: 32, 'stroke-width': 6 }, { fill: 'none', stroke: block }));
    [[31, exclusiveToken('searchlight'), '-100'], [33.3, exclusiveToken('firework-red'), '100']].forEach(function (lane) {
      var cars = svgNode('circle', { cx: 100, cy: 100, r: lane[0], 'stroke-width': 0.9, 'stroke-dasharray': '1.6 3.2 0.8 5', pathLength: 100 }, { fill: 'none', stroke: lane[1] });
      loop(cars, animate, { attributeName: 'stroke-dashoffset', values: '0;' + lane[2], dur: '9s' });
      svg.appendChild(cars);
    });
    return svg;
  }

  /**
   * Dimension Portal: a vortex of fiery red and orange energy churning
   * round and round - two sets of spiral arms turning against each other,
   * bent and boiling, glowing up from dark red to blazing orange and back -
   * breathing in and out, lightning
   * crackling round its rim and the stars about it sucked in.
   */
  function portalArt(random, animate) {
    var svg = svgCanvas();
    var portal = exclusiveToken('portal');
    var deep = exclusiveToken('portal-deep');
    var core = exclusiveToken('portal-core');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0.5, mix(deep, exclusiveToken('night'), 40)], [1, exclusiveToken('night')],
    ])));

    // Stars sucked in, spiralling down into it.
    var pulled = svgNode('g', {}, { fill: core });
    for (var s = 0; s < 32; s++) {
      var angle = between(random, 0, 360);
      var from = polar(between(random, 96, 112), angle);
      var bend = polar(70, angle + 40);
      var to = polar(30, angle + 95);
      var star = svgNode('circle', { cx: 0, cy: 0, r: between(random, 0.5, 1.1).toFixed(2), transform: 'translate(' + xy(from) + ')' });
      if (animate) {
        star.removeAttribute('transform');
        var fall = { dur: seconds(between(random, 1.8, 3.6)), begin: seconds(-random() * 4) };
        loop(star, animate, Object.assign({ path: 'M' + xy(from) + ' Q' + xy(bend) + ' ' + xy(to), keyPoints: '0;1', keyTimes: '0;1', calcMode: 'spline', keySplines: '0.6 0 0.9 0.8' }, fall), 'animateMotion');
        loop(star, animate, Object.assign({ attributeName: 'opacity', values: '0;1;0', keyTimes: '0;0.3;1' }, fall));
      }
      pulled.appendChild(star);
    }
    svg.appendChild(pulled);

    // The vortex: boiling, turbulence bending it harder and softer.
    var churn = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feTurbulence', { type: 'turbulence', baseFrequency: '0.035', numOctaves: '2', seed: String(Math.floor(random() * 1000)), result: 'noise' }));
      filter.appendChild(loop(svgNode('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: '8', xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }), animate,
        Object.assign({ attributeName: 'scale', values: '5;15;5', dur: '3s' }, EASE_BACK_AND_FORTH)));
    });
    var fill = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '100' }, [
      [0.28, core, 1], [0.45, portal, 0.95], [0.8, deep, 0.9], [1, deep, 0],
    ]);
    var hot = exclusiveToken('portal-hot');
    var blaze = gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '100' }, [
      [0.28, core, 1], [0.45, hot, 1], [0.8, mix(hot, deep, 45), 0.9], [1, deep, 0],
    ]);
    function arm(start, twist, from, to) {
      var outer = [];
      var inner = [];
      for (var t = 0; t <= 1.0001; t += 0.05) {
        var r = from + (to - from) * t;
        var centre = start + twist * (1 - t);
        var half = 5 + 12 * t;
        outer.push(polar(r, centre - half));
        inner.unshift(polar(r, centre + half));
      }
      return 'M' + outer.concat(inner).map(xy).join(' L') + ' Z';
    }
    // Breathing: the whole vortex swelling and easing back.
    var breathe = svgNode('g', { transform: 'translate(100 100)' });
    var scale = svgNode('g');
    loop(scale, animate, Object.assign({ attributeName: 'transform', type: 'scale', values: '0.93;1.05;0.93', dur: '2.6s' }, EASE_BACK_AND_FORTH), 'animateTransform');
    var vortex = svgNode('g', { transform: 'translate(-100 -100)', filter: churn });
    // Each set of arms twice over, dark red and blazing orange, the orange
    // glowing up over the red and dying back down again.
    [[6, 280, 5, 1], [8, -220, -8, 0.6], [4, 330, 3.2, 0.5]].forEach(function (set) {
      var arms = turning(svgNode('g', { opacity: set[3] }, { mixBlendMode: 'screen' }), animate, set[2]);
      var red = svgNode('g', {}, { fill: fill });
      var orange = svgNode('g', { opacity: 0 }, { fill: blaze });
      loop(orange, animate, Object.assign({ attributeName: 'opacity', values: '0;1;0', dur: '6s' }, EASE_BACK_AND_FORTH));
      var offset = between(random, 0, 360);
      for (var a = 0; a < set[0]; a++) {
        var d = arm(offset + a * 360 / set[0], set[1], 26, 98);
        red.appendChild(svgNode('path', { d: d }));
        orange.appendChild(svgNode('path', { d: d }));
      }
      arms.appendChild(red);
      arms.appendChild(orange);
      vortex.appendChild(arms);
    });
    scale.appendChild(vortex);
    breathe.appendChild(scale);
    svg.appendChild(breathe);

    var heart = svgNode('circle', {
      cx: 100, cy: 100, r: 44,
      fill: gradient(svg, 'radial', {}, [[0.62, core, 0.95], [0.8, portal, 0.4], [1, portal, 0]]),
    });
    loop(heart, animate, Object.assign({ attributeName: 'r', values: '40;50;40', dur: '1.3s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(heart);

    // The rim, and lightning crackling round it.
    var rim = svgNode('g', { filter: glowFilter(svg, 1.3) }, { fill: 'none', stroke: core, strokeLinejoin: 'round' });
    rim.appendChild(svgNode('circle', { cx: 100, cy: 100, r: 93, 'stroke-width': 1.6, opacity: 0.8 }));
    function arc(centre) {
      var points = [];
      for (var k = 0; k <= 8; k++) {
        points.push(polar(between(random, 87, 99), centre - 14 + k * 3.5));
      }
      return 'M' + points.map(xy).join(' L');
    }
    for (var z = 0; z < 7; z++) {
      var centre = z * 360 / 7 + between(random, -15, 15);
      var bolt = svgNode('path', { d: arc(centre), 'stroke-width': 0.8 });
      loop(bolt, animate, { attributeName: 'd', calcMode: 'discrete', values: [arc(centre), arc(centre), arc(centre), arc(centre)].join(';'), dur: seconds(between(random, 0.4, 0.8)) });
      loop(bolt, animate, { attributeName: 'opacity', calcMode: 'discrete', dur: seconds(between(random, 1, 2)), values: jumpy(6, function () { return random() < 0.4 ? '0' : '1'; }) });
      rim.appendChild(bolt);
    }
    svg.appendChild(rim);
    return svg;
  }

  /**
   * Disco Ball: the whole record one mirror ball, a thousand little tiles
   * curving away to its edge - flashes racing from tile to tile, glints
   * popping, coloured spotlights wandering across it and bright highlights
   * sliding by as though it were turning in the lights.
   */
  function discoBallArt(random, animate) {
    var svg = svgCanvas();
    var dark = exclusiveToken('mirror-dark');
    var mirror = exclusiveToken('mirror');
    var bright = exclusiveToken('mirror-light');
    svg.appendChild(fullRect(dark));

    // The tiles: a grid of latitude and longitude, seen head on, each tile
    // shrunk a little inside its cell so the dark shows between them.
    // Lit from the top left, give or take - shaded into a few paths.
    var SHADES = 6;
    var shaded = [];
    for (var sh = 0; sh < SHADES; sh++) {
      shaded.push([]);
    }
    var tiles = [];
    var STEP = 7.5;
    function spot(lat, lon) {
      var la = lat * Math.PI / 180;
      var lo = lon * Math.PI / 180;
      return { x: 100 + 100 * Math.cos(la) * Math.sin(lo), y: 100 - 100 * Math.sin(la) };
    }
    for (var lat = -90; lat < 90; lat += STEP) {
      for (var lon = -90; lon < 90; lon += STEP) {
        var corners = [spot(lat, lon), spot(lat, lon + STEP), spot(lat + STEP, lon + STEP), spot(lat + STEP, lon)];
        var middle = spot(lat + STEP / 2, lon + STEP / 2);
        var reach = Math.hypot(middle.x - 100, middle.y - 100);
        if (reach < 28 || reach > 99) {
          continue;
        }
        var d = 'M' + corners.map(function (corner) {
          return xy({ x: middle.x + (corner.x - middle.x) * 0.84, y: middle.y + (corner.y - middle.y) * 0.84 });
        }).join(' L') + ' Z';
        var light = (100 - middle.x + (100 - middle.y)) / 280 + 0.5;
        var shade = Math.max(0, Math.min(SHADES - 1, Math.floor((light + between(random, -0.35, 0.35)) * SHADES)));
        shaded[shade].push(d);
        tiles.push(d);
      }
    }
    shaded.forEach(function (list, index) {
      svg.appendChild(svgNode('path', { d: list.join(' ') || 'M0 0' }, { fill: mix(dark, bright, 25 + index * 13) }));
    });
    // A few tiles catching coloured light.
    var tints = svgNode('g', { opacity: 0.75 });
    ['neon-pink', 'neon-cyan', 'sun', 'plasma-violet'].forEach(function (name) {
      var list = [];
      for (var t = 0; t < 22; t++) {
        list.push(tiles[Math.floor(random() * tiles.length)]);
      }
      tints.appendChild(svgNode('path', { d: list.join(' ') }, { fill: exclusiveToken(name) }));
    });
    svg.appendChild(tints);

    // Coloured spotlights wandering over the ball.
    var spots = svgNode('g', {}, { mixBlendMode: 'screen' });
    ['neon-pink', 'neon-cyan', 'sun'].forEach(function (name) {
      var color = exclusiveToken(name);
      var path = [];
      for (var w = 0; w < 4; w++) {
        path.push(polar(between(random, 40, 80), between(random, 0, 360)));
      }
      path.push(path[0]);
      var wander = { dur: seconds(between(random, 5, 8)), calcMode: 'spline', keyTimes: '0;0.25;0.5;0.75;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1' };
      var beam = svgNode('circle', { cx: path[0].x.toFixed(1), cy: path[0].y.toFixed(1), r: 30, opacity: 0.55, fill: gradient(svg, 'radial', {}, [[0, color, 0.9], [1, color, 0]]) });
      loop(beam, animate, Object.assign({ attributeName: 'cx', values: path.map(function (p) { return p.x.toFixed(1); }).join(';') }, wander));
      loop(beam, animate, Object.assign({ attributeName: 'cy', values: path.map(function (p) { return p.y.toFixed(1); }).join(';') }, wander));
      spots.appendChild(beam);
    });
    svg.appendChild(spots);

    // Highlights sliding across, as though it were turning.
    var sheen = gradient(svg, 'radial', {}, [[0, bright, 0.7], [1, bright, 0]]);
    for (var h = 0; h < 3; h++) {
      var y = 45 + h * 55;
      var slide = svgNode('ellipse', { cx: 100, cy: y, rx: 14, ry: 26, fill: sheen, opacity: 0.6 }, { mixBlendMode: 'screen' });
      loop(slide, animate, Object.assign({ attributeName: 'cx', values: '-20;220', dur: seconds(between(random, 2.6, 4)), begin: seconds(-random() * 4) }, { calcMode: 'spline', keyTimes: '0;1', keySplines: '0.4 0 0.6 1' }));
      svg.appendChild(slide);
    }

    // Flashes racing from tile to tile: a few lanes, each lighting its
    // tiles one after another.
    var flashes = svgNode('g', { filter: glowFilter(svg, 1.2) }, { fill: bright });
    for (var lane = 0; lane < 10; lane++) {
      var turn = between(random, 0.12, 0.22);
      var count = 16;
      for (var f = 0; f < count; f++) {
        var flash = svgNode('path', { d: tiles[Math.floor(random() * tiles.length)], opacity: 0 });
        loop(flash, animate, {
          attributeName: 'opacity', values: '0;1;0;0', keyTimes: [0, 0.3 / count, 1 / count, 1].map(function (k) { return k.toFixed(4); }).join(';'),
          dur: seconds(turn * count), begin: seconds(turn * f + lane * 0.05),
        });
        flashes.appendChild(flash);
      }
    }
    svg.appendChild(flashes);

    var glints = svgNode('g', { filter: glowFilter(svg, 0.8) }, { fill: bright });
    for (var g = 0; g < 12; g++) {
      glints.appendChild(poppingGlint(random, animate, polar(between(random, 36, 92), between(random, 0, 360)), between(random, 4, 8), between(random, 1.4, 3)));
    }
    svg.appendChild(glints);
    return svg;
  }

  /** `points` as a closed, smooth loop of quadratic curves through their midpoints. */
  function smoothLoop(points) {
    var mid = function (a, b) {
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    var d = 'M' + xy(mid(points[points.length - 1], points[0]));
    points.forEach(function (point, index) {
      d += ' Q' + xy(point) + ' ' + xy(mid(point, points[(index + 1) % points.length]));
    });
    return d;
  }

  /** `local` (x, y round 0 0, facing up) turned `degrees` and moved to `at`. */
  function placed(local, at, degrees) {
    var theta = degrees * Math.PI / 180;
    return {
      x: at.x + local.x * Math.cos(theta) - local.y * Math.sin(theta),
      y: at.y + local.x * Math.sin(theta) + local.y * Math.cos(theta),
    };
  }

  /**
   * Peacock: the whole record one fanned-out train - fine gold-green barbs,
   * and row on row of eyespots, gold, green, teal, blue and a navy heart.
   * The train rattles in waves that run round it, the eyes flicker
   * iridescent, and shimmer ripples out through the feathers.
   */
  function peacockArt(random, animate) {
    var svg = svgCanvas();
    var deep = exclusiveToken('peacock-deep');
    var teal = exclusiveToken('peacock-teal');
    var blue = exclusiveToken('peacock-blue');
    var green = exclusiveToken('peacock-green');
    var bronze = exclusiveToken('peacock-bronze');
    var gold = exclusiveToken('peacock-gold');
    var navy = exclusiveToken('peacock-navy');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0, mix(teal, deep, 50)], [0.6, mix(green, deep, 70)], [1, deep],
    ])));

    // The barbs: a haze of fine gold-green strands fanning out.
    var strands = [];
    for (var b = 0; b < 260; b++) {
      var a = between(random, 0, 360);
      strands.push('M' + xy(polar(between(random, 28, 40), a)) + ' L' + xy(polar(between(random, 72, 104), a + between(random, -5, 5))));
    }
    svg.appendChild(svgNode('path', { d: strands.join(' '), 'stroke-width': 0.35, opacity: 0.5 }, { stroke: mix(green, gold, 35), fill: 'none' }));

    // Shimmer rippling out through the train.
    var shimmer = svgNode('g', { filter: glowFilter(svg, 3) }, { fill: 'none', mixBlendMode: 'screen' });
    [teal, gold].forEach(function (color, index) {
      var ring = svgNode('circle', { cx: 100, cy: 100, r: 30, opacity: 0, 'stroke-width': 7 }, { stroke: color });
      var when = { dur: '3.6s', begin: seconds(-index * 1.8) };
      loop(ring, animate, Object.assign({ attributeName: 'r', values: '30;104' }, when));
      loop(ring, animate, Object.assign({ attributeName: 'opacity', values: '0;0.5;0', keyTimes: '0;0.3;1' }, when));
      shimmer.appendChild(ring);
    });

    // The feathers, outermost row first so the inner ones lie over them:
    // a shaft and a vane down to the label, an eyespot at the tip. Each
    // feather rattles for a moment every few seconds, in a wave round the
    // train.
    var vane = gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [[0, bronze, 0.85], [0.35, green, 0.55], [1, green, 0.1]]);
    var rattle = { keyTimes: '0;0.04;0.08;0.12;0.16;0.2;0.24;0.28;1', dur: '3.4s' };
    [
      { radius: 88, count: 20, offset: 0, size: 1 },
      { radius: 70, count: 20, offset: 9, size: 0.85 },
      { radius: 52, count: 14, offset: 4, size: 0.7 },
    ].forEach(function (row) {
      for (var f = 0; f < row.count; f++) {
        var angle = f * 360 / row.count + row.offset + between(random, -2.5, 2.5);
        var reach = row.radius - 28;
        var quiver = svgNode('g');
        var shake = between(random, 1, 1.8);
        loop(quiver, animate, Object.assign({
          attributeName: 'transform', type: 'rotate',
          values: [0, shake, -shake, shake * 0.8, -shake * 0.8, shake * 0.5, -shake * 0.3, 0, 0].map(function (v) { return v.toFixed(2) + ' 100 100'; }).join(';'),
          begin: seconds(-(angle / 360) * 1.2 - random() * 0.15),
        }, rattle), 'animateTransform');
        var feather = svgNode('g', { transform: 'rotate(' + angle.toFixed(1) + ' 100 100) translate(100 ' + (100 - row.radius) + ') scale(' + row.size + ')' });
        var base = reach / row.size;
        feather.appendChild(svgNode('path', {
          d: 'M0 ' + base.toFixed(1) + ' C5 ' + (base * 0.55).toFixed(1) + ' 11 8 0 -13 C-11 8 -5 ' + (base * 0.55).toFixed(1) + ' 0 ' + base.toFixed(1) + ' Z',
          fill: vane,
        }));
        feather.appendChild(svgNode('line', { x1: 0, y1: 6, x2: 0, y2: base.toFixed(1), 'stroke-width': 0.5 }, { stroke: mix(gold, bronze, 40) }));
        feather.appendChild(ellipseNode(0, 0, 7.5, 9.5, 0, { fill: gold }));
        feather.appendChild(ellipseNode(0, 0.3, 6.2, 8, 0, { fill: bronze }));
        feather.appendChild(ellipseNode(0, 0.6, 5.2, 6.8, 0, { fill: green }));
        var sheen = ellipseNode(0, 0.6, 5.2, 6.8, 0, { fill: teal });
        sheen.setAttribute('opacity', '0');
        loop(sheen, animate, Object.assign({ attributeName: 'opacity', values: '0;0.8;0', dur: seconds(between(random, 2, 4.5)), begin: seconds(-random() * 4) }, EASE_BACK_AND_FORTH));
        feather.appendChild(sheen);
        feather.appendChild(ellipseNode(0, 1, 3.8, 5, 0, { fill: blue }));
        feather.appendChild(ellipseNode(0, 1.6, 2.4, 3.2, 0, { fill: navy }));
        feather.appendChild(svgNode('circle', { cx: -0.8, cy: 0.2, r: 0.7, opacity: 0.7 }, { fill: exclusiveToken('eye-shine') }));
        quiver.appendChild(feather);
        svg.appendChild(quiver);
      }
    });
    svg.appendChild(shimmer);
    return svg;
  }

  /**
   * Tiger's Eye: the record one great amber eye, the label its pupil -
   * fibres of gold and orange streaming out from it to a dark rim, a
   * collarette of green-gold round the pupil. The pupil widens and narrows
   * as the light changes, the iris glows, and every few seconds the lids
   * sweep shut in a blink.
   */
  function tigerEyeArt(random, animate) {
    var svg = svgCanvas();
    var gold = exclusiveToken('eye-gold');
    var amber = exclusiveToken('eye-amber');
    var orange = exclusiveToken('eye-orange');
    var brown = exclusiveToken('eye-brown');
    var black = 'var(--color-black)';
    svg.appendChild(fullRect(gradient(svg, 'radial', { gradientUnits: 'userSpaceOnUse', cx: '100', cy: '100', r: '100' }, [
      [0.3, gold], [0.5, amber], [0.78, orange], [0.9, brown], [1, black],
    ])));

    // The fibres: fine streaks from the pupil out, three shades of them.
    [lighter(gold, 30), amber, darker(orange, 30)].forEach(function (color, shade) {
      var fibres = [];
      for (var i = 0; i < 110; i++) {
        var a = between(random, 0, 360);
        var bend = between(random, -3, 3);
        var from = polar(between(random, 32, 48), a);
        var to = polar(between(random, 66, 92), a + bend * 2);
        fibres.push('M' + xy(from) + ' Q' + xy(polar(between(random, 52, 62), a + bend)) + ' ' + xy(to));
      }
      svg.appendChild(svgNode('path', { d: fibres.join(' '), 'stroke-width': shade === 2 ? 0.8 : 0.5, opacity: shade === 2 ? 0.55 : 0.7 }, { stroke: color, fill: 'none' }));
    });
    // Crypts: little dark pits in the iris.
    for (var c = 0; c < 26; c++) {
      var at = between(random, 0, 360);
      var spot = polar(between(random, 50, 84), at);
      svg.appendChild(ellipseNode(spot.x, spot.y, between(random, 0.8, 1.8), between(random, 2, 4.5), at, { fill: brown, opacity: '0.45' }));
    }
    // The collarette: a jagged green-gold ring round the pupil.
    var jag = [];
    for (var j = 0; j < 72; j++) {
      jag.push(polar(j % 2 ? between(random, 46, 50) : between(random, 52, 58), j * 5));
    }
    svg.appendChild(svgNode('path', { d: 'M' + jag.map(xy).join(' L') + ' Z', 'stroke-width': 1.4, opacity: 0.7, filter: glowFilter(svg, 0.8) }, { fill: 'none', stroke: exclusiveToken('eye-green') }));
    // The limbal ring, dark round the iris's edge.
    svg.appendChild(svgNode('circle', { cx: 100, cy: 100, r: 95, 'stroke-width': 9, opacity: 0.85, filter: glowFilter(svg, 2) }, { fill: 'none', stroke: brown }));

    // The iris glowing, brighter and dimmer.
    var glow = svgNode('circle', {
      cx: 100, cy: 100, r: 70, opacity: 0.3,
      fill: gradient(svg, 'radial', {}, [[0.4, gold, 0], [0.7, gold, 0.8], [1, gold, 0]]),
    }, { mixBlendMode: 'screen' });
    loop(glow, animate, Object.assign({ attributeName: 'opacity', values: '0.15;0.55;0.15', dur: '4s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(glow);

    // The pupil, widening and narrowing, its edge soft.
    var pupil = svgNode('g');
    var edge = svgNode('circle', { cx: 100, cy: 100, r: 40, 'stroke-width': 5, opacity: 0.6, filter: glowFilter(svg, 1.5) }, { fill: 'none', stroke: black });
    var hole = svgNode('circle', { cx: 100, cy: 100, r: 40 }, { fill: black });
    var dilate = Object.assign({ dur: '6.5s' }, EASE_BACK_AND_FORTH);
    loop(edge, animate, Object.assign({ attributeName: 'r', values: '34;52;34' }, dilate));
    loop(hole, animate, Object.assign({ attributeName: 'r', values: '34;52;34' }, dilate));
    pupil.appendChild(edge);
    pupil.appendChild(hole);
    svg.appendChild(pupil);

    // Catchlights: the glint of a window on the wet eye.
    var shine = exclusiveToken('eye-shine');
    var window1 = polar(64, -38);
    svg.appendChild(ellipseNode(window1.x, window1.y, 8, 4.5, -38, { fill: shine, opacity: '0.85' }));
    var window2 = polar(56, 142);
    svg.appendChild(svgNode('circle', { cx: window2.x.toFixed(1), cy: window2.y.toFixed(1), r: 2.4, opacity: 0.7 }, { fill: shine }));

    // The lids, sweeping shut and open again: top and bottom, each a sheet
    // of fur with a dark lash line along its edge.
    var lid = exclusiveToken('eye-lid');
    function top(edgeY, sag) {
      return 'M-20 -20 H220 V' + edgeY + ' Q100 ' + (edgeY + sag) + ' -20 ' + edgeY + ' Z';
    }
    function bottom(edgeY, sag) {
      return 'M-20 220 H220 V' + edgeY + ' Q100 ' + (edgeY - sag) + ' -20 ' + edgeY + ' Z';
    }
    var blink = { keyTimes: '0;0.86;0.9;0.95;1', dur: seconds(between(random, 4.5, 6)), calcMode: 'spline', keySplines: '0 0 1 1;0.5 0 1 1;0 0 0.5 1;0 0 1 1' };
    var lids = svgNode('g', { 'stroke-width': 2.5 }, { fill: lid, stroke: black });
    var upper = svgNode('path', { d: top(-40, -20) });
    loop(upper, animate, Object.assign({ attributeName: 'd', values: [top(-40, -20), top(-40, -20), top(96, 20), top(-40, -20), top(-40, -20)].join(';') }, blink));
    var lower = svgNode('path', { d: bottom(240, -20) });
    loop(lower, animate, Object.assign({ attributeName: 'd', values: [bottom(240, -20), bottom(240, -20), bottom(104, 8), bottom(240, -20), bottom(240, -20)].join(';') }, blink));
    lids.appendChild(upper);
    lids.appendChild(lower);
    svg.appendChild(lids);
    return svg;
  }

  /**
   * Murmuration: starlings at dusk, a hundred and seventy of them, the whole
   * flock pouring from one shape into the next - a cloud, a spiral, a ring
   * round the label, two swirls, a comet - over reeds against a sunset.
   */
  function murmurationArt(random, animate) {
    var svg = svgCanvas();
    var low = exclusiveToken('dusk-low');
    svg.appendChild(fullRect(gradient(svg, 'linear', { x1: '0', y1: '0', x2: '0', y2: '1' }, [
      [0, exclusiveToken('dusk-top')], [0.55, exclusiveToken('dusk-mid')], [1, low],
    ])));
    svg.appendChild(svgNode('circle', {
      cx: 100, cy: 168, r: 40,
      fill: gradient(svg, 'radial', {}, [[0, exclusiveToken('eye-shine'), 0.95], [0.3, low, 0.8], [1, low, 0]]),
    }));
    var flock = exclusiveToken('flock');
    // Reeds along the bottom.
    var reeds = [];
    for (var r = 0; r < 70; r++) {
      var x = between(random, -5, 205);
      var h = between(random, 14, 34);
      reeds.push('M' + x.toFixed(1) + ' 205 Q' + (x + between(random, -3, 3)).toFixed(1) + ' ' + (205 - h / 2).toFixed(1) + ' ' + (x + between(random, -6, 6)).toFixed(1) + ' ' + (205 - h).toFixed(1));
    }
    svg.appendChild(svgNode('path', { d: reeds.join(' '), 'stroke-width': 1.1 }, { stroke: flock, fill: 'none' }));

    // The shapes the flock pours through, each as where the bird at (u, v)
    // goes - u along the flock, v across it - so neighbours stay together.
    function blob(cx, cy, rx, ry, turn) {
      return function (u, v) {
        var a = u * Math.PI * 2;
        var reach = Math.sqrt(v);
        var x = rx * reach * Math.cos(a);
        var y = ry * reach * Math.sin(a);
        var t = turn * Math.PI / 180;
        return { x: cx + x * Math.cos(t) - y * Math.sin(t), y: cy + x * Math.sin(t) + y * Math.cos(t) };
      };
    }
    var shapes = [
      blob(66, 64, 46, 24, 30),
      function (u, v) {
        return polar(40 + 54 * u + (v - 0.5) * 18, 30 + 400 * u);
      },
      function (u, v) {
        var a = u * 360;
        return polar(64 + (v - 0.5) * 26 + 8 * Math.sin(a * 3 * Math.PI / 180), a);
      },
      function (u, v) {
        return u < 0.5 ? blob(58, 138, 34, 20, -20)(u * 2, v) : blob(144, 64, 32, 20, 50)((u - 0.5) * 2, v);
      },
      // A comet, its head thick and its tail thinning, swept round the ring.
      function (u, v) {
        var t = Math.pow(u, 1.5);
        return polar(68 + (v - 0.5) * (40 * (1 - t) + 4), 130 + 190 * t);
      },
    ];
    shapes.push(shapes[0]);
    var times = shapes.map(function (shape, index) {
      return (index / (shapes.length - 1)).toFixed(3);
    }).join(';');
    var ease = shapes.slice(1).map(function () {
      return '0.45 0 0.55 1';
    }).join(';');
    var birds = svgNode('g', {}, { fill: flock });
    for (var i = 0; i < 170; i++) {
      var u = (i + random()) / 170;
      var v = random();
      var spots = shapes.map(function (shape) {
        return shape(u, v);
      });
      var bird = svgNode('circle', { cx: spots[0].x.toFixed(1), cy: spots[0].y.toFixed(1), r: between(random, 1.1, 1.8).toFixed(2) });
      var flight = { keyTimes: times, calcMode: 'spline', keySplines: ease, dur: '18s' };
      loop(bird, animate, Object.assign({ attributeName: 'cx', values: spots.map(function (p) { return p.x.toFixed(1); }).join(';') }, flight));
      loop(bird, animate, Object.assign({ attributeName: 'cy', values: spots.map(function (p) { return p.y.toFixed(1); }).join(';') }, flight));
      birds.appendChild(bird);
    }
    svg.appendChild(birds);
    return svg;
  }

  /**
   * A bee facing +x round 0 0: striped body, head, sting, and wings
   * buzzing - drawn twice life size, outlined dark with a soft shadow
   * under it (`shadow`, a blur filter), so it stands out from the honey on
   * a spinning record. The group it comes in is free for the caller to
   * animate.
   */
  function beeNode(animate, random, shadow) {
    var outer = svgNode('g');
    var bee = svgNode('g', { transform: 'scale(2.1)' });
    outer.appendChild(bee);
    bee.appendChild(ellipseNode(0.8, 1.2, 5.2, 3.4, 0, { fill: exclusiveToken('bee-black'), opacity: '0.45', filter: shadow }));
    var wings = svgNode('g', { opacity: 0.75 }, { fill: exclusiveToken('wing') });
    [-1, 1].forEach(function (side) {
      var wing = ellipseNode(-0.5, side * 2.6, 2.8, 1.6, side * 25, {});
      loop(wing, animate, { attributeName: 'ry', values: '1.6;0.3;1.6', dur: seconds(between(random, 0.07, 0.1)) });
      wings.appendChild(wing);
    });
    bee.appendChild(svgNode('path', { d: 'M-4.2 -0.6 L-5.6 0 L-4.2 0.6 Z' }, { fill: exclusiveToken('bee-black') }));
    bee.appendChild(ellipseNode(0, 0, 4, 2.5, 0, { fill: exclusiveToken('bee'), stroke: exclusiveToken('bee-black'), strokeWidth: '0.45' }));
    [-1.6, 0.6].forEach(function (x) {
      bee.appendChild(svgNode('line', { x1: x, y1: -2.4, x2: x, y2: 2.4, 'stroke-width': 0.9 }, { stroke: exclusiveToken('bee-black') }));
    });
    bee.appendChild(svgNode('circle', { cx: 4.2, cy: 0, r: 1.6 }, { fill: exclusiveToken('bee-black') }));
    bee.appendChild(wings);
    return outer;
  }


  /**
   * Honeycomb: the record a comb of wax cells - glowing honey, pale wax
   * caps, a few grubs, some empty - a warm glow washing out through the
   * honey, bees waggle-dancing on the comb and others buzzing over it.
   */
  function honeycombArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(exclusiveToken('hive-dark')));
    var honey = exclusiveToken('honey');
    var light = exclusiveToken('honey-light');
    var cap = exclusiveToken('wax-cap');
    var fills = {
      honey: gradient(svg, 'radial', { cx: '0.4', cy: '0.35', r: '0.75' }, [[0, light], [0.5, honey], [1, darker(honey, 45)]]),
      capped: gradient(svg, 'radial', { cx: '0.4', cy: '0.35', r: '0.75' }, [[0, lighter(cap, 30)], [1, darker(cap, 20)]]),
      grub: gradient(svg, 'radial', { cx: '0.4', cy: '0.35', r: '0.75' }, [[0, exclusiveToken('eye-shine')], [1, darker(cap, 15)]]),
      empty: gradient(svg, 'radial', { cx: '0.5', cy: '0.5', r: '0.7' }, [[0, darker(exclusiveToken('wax'), 60)], [1, exclusiveToken('wax')]]),
    };
    var SIZE = 8.5;
    function hexagon(cx, cy, size) {
      var corners = [];
      for (var k = 0; k < 6; k++) {
        corners.push({ x: cx + size * Math.cos(k * Math.PI / 3), y: cy + size * Math.sin(k * Math.PI / 3) });
      }
      return 'M' + corners.map(xy).join(' L') + ' Z';
    }
    var walls = [];
    var cells = { honey: [], capped: [], grub: [], empty: [] };
    var glows = svgNode('g', {}, { fill: light, mixBlendMode: 'screen' });
    for (var col = -9; col <= 9; col++) {
      for (var row = -8; row <= 8; row++) {
        var cx = 100 + col * 1.5 * SIZE;
        var cy = 100 + row * Math.sqrt(3) * SIZE + (Math.abs(col) % 2 ? Math.sqrt(3) * SIZE / 2 : 0);
        var reach = Math.hypot(cx - 100, cy - 100);
        if (reach < 22 || reach > 108) {
          continue;
        }
        walls.push(hexagon(cx, cy, SIZE));
        var roll = random();
        var kind = roll < 0.5 ? 'honey' : roll < 0.75 ? 'capped' : roll < 0.83 ? 'grub' : 'empty';
        var inner = hexagon(cx, cy, SIZE * 0.82);
        cells[kind].push(inner);
        // A warm glow washing out through the honey, ring by ring.
        if (kind === 'honey') {
          var shine = svgNode('path', { d: inner, opacity: 0 });
          loop(shine, animate, { attributeName: 'opacity', values: '0;0.75;0;0', keyTimes: '0;0.12;0.35;1', dur: '3.5s', begin: seconds(reach * 0.022) });
          glows.appendChild(shine);
        }
      }
    }
    Object.keys(cells).forEach(function (kind) {
      svg.appendChild(svgNode('path', { d: cells[kind].join(' ') || 'M0 0', fill: fills[kind] }));
    });
    svg.appendChild(glows);
    svg.appendChild(svgNode('path', { d: walls.join(' '), 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, { fill: 'none', stroke: exclusiveToken('wax') }));

    var shadow = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { stdDeviation: '1' }));
    });
    // Bees waggle-dancing on the comb: round a figure of eight, wagging
    // their bodies hard down the middle of it.
    for (var w = 0; w < 4; w++) {
      var centre = polar(between(random, 45, 75), w * 90 + between(random, -20, 20));
      var size = between(random, 14, 19);
      var turn = between(random, 0, 180);
      var eight = [];
      for (var e = 0; e < 32; e++) {
        var t = e / 32 * Math.PI * 2;
        eight.push(placed({ x: size * Math.sin(t), y: size * 0.55 * Math.sin(2 * t) }, centre, turn));
      }
      var dancer = svgNode('g', { transform: 'translate(' + xy(centre) + ') rotate(' + turn.toFixed(0) + ')' });
      if (animate) {
        dancer.removeAttribute('transform');
        loop(dancer, animate, { path: smoothLoop(eight), rotate: 'auto', dur: seconds(between(random, 3.5, 5)), begin: seconds(-random() * 5) }, 'animateMotion');
      }
      var wag = beeNode(animate, random, shadow);
      loop(wag, animate, { attributeName: 'transform', type: 'rotate', values: '-18;18;-18', dur: '0.16s' }, 'animateTransform');
      dancer.appendChild(wag);
      svg.appendChild(dancer);
    }
    // Bees buzzing over, in from the rim and out again.
    for (var f = 0; f < 4; f++) {
      var a = between(random, 0, 360);
      var from = polar(112, a);
      var to = polar(112, a + between(random, 120, 220));
      var via = [polar(between(random, 36, 70), a + between(random, 30, 80)), polar(between(random, 36, 70), a + between(random, 90, 150))];
      var flier = svgNode('g', { transform: 'translate(' + xy(via[0]) + ')' });
      if (animate) {
        flier.removeAttribute('transform');
        loop(flier, animate, { path: 'M' + xy(from) + ' C' + xy(via[0]) + ' ' + xy(via[1]) + ' ' + xy(to), rotate: 'auto', dur: seconds(between(random, 4, 7)), begin: seconds(-random() * 7) }, 'animateMotion');
      }
      var buzz = beeNode(animate, random, shadow);
      loop(buzz, animate, { attributeName: 'transform', type: 'translate', values: '0 0;0 2;0 -1.8;0 0', dur: '0.3s' }, 'animateTransform');
      flier.appendChild(buzz);
      svg.appendChild(flier);
    }
    return svg;
  }

  /** A monarch facing +x round 0 0, `size` across: veined orange wings flapping. */
  function monarchNode(random, animate, size) {
    var orange = exclusiveToken('monarch');
    var black = exclusiveToken('monarch-black');
    var white = exclusiveToken('monarch-white');
    var butterfly = svgNode('g', { transform: 'scale(' + size.toFixed(2) + ')' });
    var wings = svgNode('g');
    loop(wings, animate, { attributeName: 'transform', type: 'scale', values: '1 1;1 0.15;1 1', dur: seconds(between(random, 0.32, 0.45)), begin: seconds(-random()) }, 'animateTransform');
    [1, -1].forEach(function (side) {
      var half = svgNode('g', { transform: 'scale(1 ' + side + ')', 'stroke-linejoin': 'round' }, { stroke: black });
      half.appendChild(svgNode('path', { d: 'M0.5 -0.8 C2 -5 6 -11 9 -12.5 C6 -14 -2 -13 -5 -9.5 C-6 -7 -3 -3 0.5 -0.8 Z', 'stroke-width': 1 }, { fill: orange }));
      half.appendChild(svgNode('path', { d: 'M-0.5 -0.6 C-2 -2 -8 -3 -9 -6.5 C-9.5 -9 -5 -9.5 -2.5 -7.5 C-1 -5 -0.5 -3 -0.5 -0.6 Z', 'stroke-width': 1 }, { fill: darker(orange, 12) }));
      half.appendChild(svgNode('path', { d: 'M0.5 -1 L6 -11 M0 -1.5 L1 -12 M-0.5 -1.2 L-4 -9.5 M-0.8 -0.8 L-7.5 -6.5 M-0.8 -1 L-5 -8.6', 'stroke-width': 0.4 }, { fill: 'none' }));
      [[7.2, -12.6], [4.5, -13.1], [1.5, -13], [-2, -12.2], [-4.7, -10], [-8.6, -7.5]].forEach(function (dot) {
        half.appendChild(svgNode('circle', { cx: dot[0], cy: dot[1], r: 0.35 }, { fill: white, stroke: 'none' }));
      });
      wings.appendChild(half);
    });
    butterfly.appendChild(wings);
    butterfly.appendChild(ellipseNode(0, 0, 4.2, 0.9, 0, { fill: black }));
    butterfly.appendChild(svgNode('circle', { cx: 4.4, cy: 0, r: 0.9 }, { fill: black }));
    butterfly.appendChild(svgNode('path', { d: 'M4.8 -0.4 Q7 -2 8.5 -2.5 M4.8 0.4 Q7 2 8.5 2.5', 'stroke-width': 0.3 }, { fill: 'none', stroke: black }));
    return butterfly;
  }

  /**
   * Monarch Migration: a cloud of monarch butterflies fluttering out from
   * the label on the wind, wings beating, drifting on their own wavering
   * courses through a bright sky of passing clouds.
   */
  function monarchArt(random, animate) {
    var svg = svgCanvas();
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '62%' }, [
      [0, lighter(exclusiveToken('day-sky'), 35)], [0.5, exclusiveToken('day-sky')], [1, exclusiveToken('day-sky-deep')],
    ])));
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.85,
      filter: noiseFill(svg, random, {
        type: 'fractalNoise', frequency: '0.013 0.02', drift: '0.02 0.03', seconds: 16, octaves: 4,
        alpha: '2.2 0 0 0 -1.05', color: exclusiveToken('cloud'),
      }, animate),
    }));
    var MONARCHS = 15;
    for (var m = 0; m < MONARCHS; m++) {
      var angle = m * 360 / MONARCHS + between(random, -12, 12);
      var from = polar(26, angle);
      var to = polar(122, angle + between(random, -50, 50));
      var bends = [polar(between(random, 45, 65), angle + between(random, -35, 35)), polar(between(random, 70, 95), angle + between(random, -35, 35))];
      var route = 'M' + xy(from) + ' C' + xy(bends[0]) + ' ' + xy(bends[1]) + ' ' + xy(to);
      var flight = svgNode('g', { transform: 'translate(' + xy(bends[0]) + ') rotate(' + (angle - 90).toFixed(0) + ')' });
      if (animate) {
        flight.removeAttribute('transform');
        var trip = { dur: seconds(between(random, 7, 11)), begin: seconds(-random() * 11) };
        loop(flight, animate, Object.assign({ path: route, rotate: 'auto' }, trip), 'animateMotion');
        loop(flight, animate, Object.assign({ attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.12;0.85;1' }, trip));
      }
      // Bobbing up and down on each wingbeat's lift.
      var bob = svgNode('g');
      loop(bob, animate, Object.assign({ attributeName: 'transform', type: 'translate', values: '0 -1.5;0 1.5;0 -1.5', dur: seconds(between(random, 0.7, 1.1)) }, EASE_BACK_AND_FORTH), 'animateTransform');
      bob.appendChild(monarchNode(random, animate, between(random, 0.9, 1.5)));
      flight.appendChild(bob);
      svg.appendChild(flight);
    }
    return svg;
  }

  /**
   * Raven: a great raven perched on a gnarled dead branch, black against a
   * huge blood moon, blue and violet sheen on its feathers. It cocks its head
   * this way and that in quick bird-like jerks, now and then throws it
   * back to caw - beak gaping wide, rings of the call spreading out -
   * ruffles its wing and blinks its glowing purple eye, while crows flap
   * past the moon,
   * mist drifts through and black feathers come tumbling down.
   */
  function ravenArt(random, animate) {
    var svg = svgCanvas();
    var black = exclusiveToken('raven');
    var blue = exclusiveToken('raven-sheen-blue');
    var violet = exclusiveToken('raven-sheen-violet');
    var moon = exclusiveToken('blood-moon');
    var bone = exclusiveToken('bone');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '42%', r: '65%' }, [
      [0, exclusiveToken('raven-sky')], [1, exclusiveToken('raven-sky-deep')],
    ])));
    stars(svg, random, animate, 22, bone);

    // The blood moon, low and huge behind the raven, glowing and breathing.
    var moonAt = { x: 110, y: 140 };
    var halo = svgNode('circle', {
      cx: moonAt.x, cy: moonAt.y, r: 62,
      fill: gradient(svg, 'radial', {}, [[0.5, moon, 0.6], [1, moon, 0]]),
    });
    loop(halo, animate, Object.assign({ attributeName: 'r', values: '62;74;62', dur: '5s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(halo);
    svg.appendChild(svgNode('circle', {
      cx: moonAt.x, cy: moonAt.y, r: 42,
      fill: gradient(svg, 'radial', { cx: '0.4', cy: '0.38', r: '0.7' }, [[0, bone], [0.55, mix(bone, moon, 45)], [1, moon]]),
    }));
    for (var s = 0; s < 6; s++) {
      var sea = { x: moonAt.x + between(random, -22, 22), y: moonAt.y + between(random, -22, 22) };
      svg.appendChild(svgNode('circle', { cx: sea.x.toFixed(1), cy: sea.y.toFixed(1), r: between(random, 2, 5).toFixed(1), opacity: 0.25 }, { fill: darker(moon, 35) }));
    }

    // Crows flapping past, small against the sky.
    function crow(up) {
      var lift = up ? -4.5 : 2.2;
      return 'M-8 ' + lift + ' Q-4 ' + (lift / 2.5).toFixed(1) + ' 0 0.4 Q4 ' + (lift / 2.5).toFixed(1) + ' 8 ' + lift
        + ' Q4 ' + (lift / 4 + 1).toFixed(1) + ' 0 1.8 Q-4 ' + (lift / 4 + 1).toFixed(1) + ' -8 ' + lift + ' Z';
    }
    for (var c = 0; c < 5; c++) {
      var y = between(random, 20, 95);
      var flight = svgNode('g', { transform: 'translate(' + between(random, 20, 180).toFixed(0) + ' ' + y.toFixed(0) + ')' });
      if (animate) {
        flight.removeAttribute('transform');
        var across = 'M-15 ' + y.toFixed(1) + ' Q100 ' + (y + between(random, -25, 25)).toFixed(1) + ' 215 ' + (y + between(random, -15, 15)).toFixed(1);
        loop(flight, animate, { path: across, rotate: 'auto', dur: seconds(between(random, 6, 10)), begin: seconds(-random() * 10) }, 'animateMotion');
      }
      var bird = svgNode('g', { transform: 'scale(' + between(random, 0.7, 1.1).toFixed(2) + ')' }, { fill: black });
      var wings = svgNode('path', { d: crow(true) });
      loop(wings, animate, { attributeName: 'd', values: [crow(true), crow(false), crow(true)].join(';'), dur: seconds(between(random, 0.45, 0.65)) });
      bird.appendChild(wings);
      bird.appendChild(ellipseNode(0.5, 1, 2.2, 1, 0, {}));
      flight.appendChild(bird);
      svg.appendChild(flight);
    }

    // Mist drifting through.
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.5,
      filter: noiseFill(svg, random, {
        type: 'fractalNoise', frequency: '0.016 0.03', drift: '0.024 0.04', seconds: 12, octaves: 3,
        alpha: '1.8 0 0 0 -0.8', color: exclusiveToken('raven-mist'),
      }, animate),
    }));

    // The branch: gnarled, from rim to rim across the bottom, twigs off it.
    var branch = svgNode('g', {}, { fill: 'none', stroke: black, strokeLinecap: 'round' });
    branch.appendChild(svgNode('path', { d: 'M-5 150 C30 158 60 178 100 176 C130 174 160 160 205 168', 'stroke-width': 6 }));
    branch.appendChild(svgNode('path', { d: 'M-5 150 C30 158 60 178 100 176', 'stroke-width': 8, opacity: 0.8 }));
    [['M40 164 Q34 150 22 142', 2.2], ['M34 146 Q30 138 32 130', 1.2], ['M150 166 Q160 150 176 146', 2.4], ['M168 148 Q170 138 180 132', 1.2], ['M122 173 Q128 184 140 190', 1.8], ['M70 173 Q64 186 54 192', 1.6]].forEach(function (twig) {
      branch.appendChild(svgNode('path', { d: twig[0], 'stroke-width': twig[1] }));
    });
    svg.appendChild(branch);

    // The raven, drawn facing right with its feet at 0 0, a faint rim of
    // moonlight round it.
    var raven = svgNode('g', { transform: 'translate(96 177) scale(1.3)' }, { fill: black, stroke: mix(moon, bone, 40), strokeWidth: '0.4' });
    var sheen = gradient(svg, 'linear', { x1: '0', y1: '0', x2: '1', y2: '1' }, [[0, blue, 0.9], [0.5, violet, 0.6], [1, black, 0]]);
    raven.appendChild(svgNode('path', { d: 'M-1 -6 L-2 0 M4 -6 L5 0 M-5 0 L1 0 M2 0 L8 0', 'stroke-width': 1.3 }, { fill: 'none', stroke: black }));
    // Body and tail.
    raven.appendChild(svgNode('path', { d: 'M-18 -14 C-16 -24 -6 -30 4 -30 C10 -30 14 -27 16 -24 L12 -12 C8 -6 0 -4 -8 -4 L-28 8 L-33 6 L-21 -5 C-20 -9 -19 -12 -18 -14 Z' }));
    raven.appendChild(svgNode('path', { d: 'M-14 -22 C-4 -28 8 -27 12 -22', 'stroke-width': 1.2, opacity: 0.7 }, { fill: 'none', stroke: sheen }));
    // The wing, ruffling now and then.
    var wing = svgNode('g');
    loop(wing, animate, {
      attributeName: 'transform', type: 'rotate', values: '0 6 -24;0 6 -24;-14 6 -24;4 6 -24;-8 6 -24;0 6 -24;0 6 -24',
      keyTimes: '0;0.7;0.75;0.8;0.85;0.9;1', dur: '7.4s', begin: '-3s',
    }, 'animateTransform');
    wing.appendChild(svgNode('path', { d: 'M-12 -25 C-4 -30 8 -28 10 -21 C6 -13 -4 -9 -16 -3 C-21 0 -26 3 -30 5 C-24 -3 -18 -14 -12 -25 Z' }, { fill: mix(black, violet, 12) }));
    [['M-6 -22 C-12 -14 -18 -6 -26 2', 0.6], ['M0 -22 C-6 -14 -12 -8 -20 -2', 0.5], ['M5 -21 C0 -15 -6 -10 -13 -6', 0.45]].forEach(function (quill) {
      wing.appendChild(svgNode('path', { d: quill[0], 'stroke-width': quill[1], opacity: 0.85 }, { fill: 'none', stroke: sheen }));
    });
    raven.appendChild(wing);

    // The head: cocked this way and that in sudden jerks, thrown back to
    // caw, the beak gaping and the call ringing out.
    var head = svgNode('g');
    var HEAD = { keyTimes: '0;0.14;0.3;0.44;0.5;0.56;0.64;1', dur: '6.2s' };
    loop(head, animate, Object.assign({
      attributeName: 'transform', type: 'rotate', calcMode: 'discrete',
      values: '0 12 -28;-12 12 -28;8 12 -28;-18 12 -28;-18 12 -28;-18 12 -28;4 12 -28;0 12 -28',
    }, HEAD), 'animateTransform');
    // Head and neck in one smooth sweep down into the body, the throat's
    // shaggy hackles soft scallops along its edge. No outline of its own -
    // that would draw a seam across the body - only moonlight along the
    // crown and down the front of the throat.
    head.appendChild(svgNode('path', {
      d: 'M3 -29 C3 -37 9 -43.5 16 -43.5 C20.5 -43.5 23 -40.5 24 -37.5 L24 -31 C22.6 -27 21.2 -25.4 20 -24'
        + ' Q19.6 -21.4 18.2 -20.8 Q17.4 -22.8 16.2 -22.4 Q15.4 -20 13.6 -19.8 Q12.8 -21.8 11 -22.2 C7 -22.6 4 -25 3 -29 Z',
    }, { stroke: 'none' }));
    head.appendChild(svgNode('path', { d: 'M5 -34 C7 -40 11 -43.5 16 -43.5 C20.5 -43.5 23 -40.5 24 -37.5 M24 -31 C22.6 -27 21.2 -25.4 20 -24 Q19.6 -21.4 18.2 -20.8' }, { fill: 'none' }));
    // The beak, in two: on the caw the upper half tips up and the lower
    // drops right open.
    var CAW = function (angle, pivot) {
      return ['0', '0', '0', '0', String(angle), '0', '0', '0'].map(function (a) { return a + ' ' + pivot; }).join(';');
    };
    var bill = svgNode('path', { d: 'M23.5 -37.5 C27.5 -37.3 31.5 -35.6 36 -33 L23.5 -32 Z' });
    loop(bill, animate, Object.assign({ attributeName: 'transform', type: 'rotate', calcMode: 'discrete', values: CAW(-12, '24 -33') }, HEAD), 'animateTransform');
    var jaw = svgNode('path', { d: 'M23.5 -32.2 L34 -32.6 C30.5 -31 26.5 -30 23.5 -29.8 Z' });
    loop(jaw, animate, Object.assign({ attributeName: 'transform', type: 'rotate', calcMode: 'discrete', values: CAW(38, '24 -32') }, HEAD), 'animateTransform');
    head.appendChild(jaw);
    head.appendChild(bill);
    head.appendChild(svgNode('path', { d: 'M8 -38 C11.5 -42 18 -43 22 -40', 'stroke-width': 0.9, opacity: 0.7 }, { fill: 'none', stroke: sheen }));
    // The eye, glowing purple, its halo breathing, blinking now and then.
    var glowing = exclusiveToken('raven-eye');
    var blink = { keyTimes: '0;0.8;0.83;0.87;1', dur: '4.3s' };
    // No moonlight outline on the halo: it would ring the eye.
    var halo2 = svgNode('circle', { cx: 17.5, cy: -37.5, r: 3.6, fill: gradient(svg, 'radial', {}, [[0, glowing, 0.9], [1, glowing, 0]]) }, { stroke: 'none' });
    loop(halo2, animate, Object.assign({ attributeName: 'opacity', values: '0.6;1;0.6', dur: '2.2s' }, EASE_BACK_AND_FORTH));
    head.appendChild(halo2);
    var eye = svgNode('circle', { cx: 17.5, cy: -37.5, r: 1.3, filter: glowFilter(svg, 0.6) }, { fill: glowing, stroke: 'none' });
    loop(eye, animate, Object.assign({ attributeName: 'r', values: '1.3;1.3;0.2;1.3;1.3' }, blink));
    head.appendChild(eye);
    head.appendChild(svgNode('circle', { cx: 17.9, cy: -37.9, r: 0.35 }, { fill: lighter(glowing, 60), stroke: 'none' }));
    // The call, ringing out from the open beak.
    var call = svgNode('g', { transform: 'translate(36 -33)' }, { fill: 'none', stroke: bone });
    for (var r = 0; r < 3; r++) {
      var at = 0.44 + r * 0.03;
      var ring = svgNode('path', { d: 'M0 -6 A6 6 0 0 1 0 6', 'stroke-width': 1, opacity: 0 });
      var ringing = Object.assign({}, HEAD, { keyTimes: '0;' + at.toFixed(2) + ';' + (at + 0.01).toFixed(2) + ';' + (at + 0.16).toFixed(2) + ';1' });
      loop(ring, animate, Object.assign({ attributeName: 'opacity', values: '0;0;0.9;0;0' }, ringing));
      loop(ring, animate, Object.assign({ attributeName: 'transform', type: 'scale', values: '0.3;0.3;0.5;3;3' }, ringing), 'animateTransform');
      call.appendChild(ring);
    }
    head.appendChild(call);
    raven.appendChild(head);
    svg.appendChild(raven);

    // Black feathers tumbling down, turning as they fall.
    for (var f = 0; f < 7; f++) {
      var x = between(random, 10, 190);
      var fall = svgNode('g', { transform: 'translate(' + x.toFixed(0) + ' ' + between(random, 10, 190).toFixed(0) + ')' });
      if (animate) {
        fall.removeAttribute('transform');
        var drift = 'M' + x.toFixed(0) + ' -12 Q' + (x + between(random, -40, 40)).toFixed(0) + ' 70 ' + (x + between(random, -20, 20)).toFixed(0) + ' 110 T' + (x + between(random, -40, 40)).toFixed(0) + ' 214';
        loop(fall, animate, { path: drift, dur: seconds(between(random, 7, 12)), begin: seconds(-random() * 12) }, 'animateMotion');
      }
      var feather = svgNode('g', { transform: 'scale(' + between(random, 0.8, 1.4).toFixed(2) + ')' });
      var tumble = svgNode('g');
      loop(tumble, animate, { attributeName: 'transform', type: 'rotate', values: '-40;40;-40', dur: seconds(between(random, 2, 3.5)) }, 'animateTransform');
      tumble.appendChild(svgNode('path', { d: 'M0 -7 C2.6 -3 2.4 3 0 6 C-2.4 3 -2.6 -3 0 -7 Z' }, { fill: black }));
      tumble.appendChild(svgNode('path', { d: 'M0 -6 L0 8', 'stroke-width': 0.35 }, { stroke: blue }));
      feather.appendChild(tumble);
      fall.appendChild(feather);
      svg.appendChild(fall);
    }
    return svg;
  }

  /**
   * Wolf Moon: a huge full moon filling the middle, clouds drifting over
   * it, and on the dark hills round the rim a pack of wolves raising their
   * heads to howl at it - rings of their song rising up towards it.
   */
  function wolfMoonArt(random, animate) {
    var svg = svgCanvas();
    var night = exclusiveToken('wolf-night');
    var moonLight = exclusiveToken('moon-light');
    var black = exclusiveToken('silhouette');
    var howl = exclusiveToken('howl');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0.3, exclusiveToken('wolf-sky')], [1, night],
    ])));
    stars(svg, random, animate, 40);

    var halo = svgNode('circle', {
      cx: 100, cy: 100, r: 78,
      fill: gradient(svg, 'radial', {}, [[0.6, moonLight, 0.55], [0.75, howl, 0.2], [1, howl, 0]]),
    });
    loop(halo, animate, Object.assign({ attributeName: 'r', values: '74;84;74', dur: '5s' }, EASE_BACK_AND_FORTH));
    svg.appendChild(halo);
    svg.appendChild(svgNode('circle', {
      cx: 100, cy: 100, r: 52,
      fill: gradient(svg, 'radial', { cx: '0.42', cy: '0.4', r: '0.65' }, [[0, lighter(moonLight, 30)], [0.7, moonLight], [1, exclusiveToken('moon-shadow')]]),
    }));
    // The moon's seas.
    for (var c = 0; c < 9; c++) {
      var sea = polar(between(random, 32, 46), between(random, 0, 360));
      svg.appendChild(svgNode('circle', { cx: sea.x.toFixed(1), cy: sea.y.toFixed(1), r: between(random, 2, 6).toFixed(1), opacity: 0.35 }, { fill: exclusiveToken('moon-shadow') }));
    }
    // Clouds drifting across it.
    var mist = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { stdDeviation: '3.5' }));
    });
    for (var m = 0; m < 3; m++) {
      var y = 60 + m * 38 + between(random, -8, 8);
      var drift = svgNode('ellipse', { cx: 100, cy: y.toFixed(1), rx: between(random, 22, 34).toFixed(1), ry: between(random, 4, 7).toFixed(1), opacity: 0.55, filter: mist }, { fill: mix(exclusiveToken('wolf-sky'), howl, 30) });
      loop(drift, animate, { attributeName: 'cx', values: '-40;240', dur: seconds(between(random, 14, 22)), begin: seconds(-random() * 22) });
      svg.appendChild(drift);
    }

    // The hills round the rim, pines on them, and the pack.
    function ground(degrees) {
      var t = degrees * Math.PI / 180;
      return 88 - 4 - 4 * Math.sin(3 * t + 1) - 2 * Math.sin(7 * t);
    }
    var ridge = [];
    for (var d = 0; d <= 360; d += 3) {
      ridge.push(polar(ground(d), d));
    }
    svg.appendChild(svgNode('path', { d: 'M' + ridge.map(xy).join(' L') + ' L' + xy(polar(130, 360)) + ' A130 130 0 1 0 ' + xy(polar(130, 0.1)) + ' Z' }, { fill: black }));
    svg.appendChild(svgNode('path', { d: 'M' + ridge.map(xy).join(' L') + ' Z', 'stroke-width': 0.6, opacity: 0.6 }, { fill: 'none', stroke: howl }));
    var pines = [];
    for (var p = 0; p < 26; p++) {
      var at = between(random, 0, 360);
      var foot = polar(ground(at) + 1, at);
      var height = between(random, 6, 12);
      for (var tier = 0; tier < 3; tier++) {
        var lowEdge = height * tier / 3.4;
        var width = (3.4 - tier * 0.8) * height / 10;
        // Turned half round, so "up" is in, towards the moon.
        pines.push('M' + xy(placed({ x: -width, y: -lowEdge }, foot, at + 180)) + ' L' + xy(placed({ x: 0, y: -lowEdge - height * 0.5 }, foot, at + 180)) + ' L' + xy(placed({ x: width, y: -lowEdge }, foot, at + 180)) + ' Z');
      }
    }
    svg.appendChild(svgNode('path', { d: pines.join(' ') }, { fill: black }));

    var body = 'M-14 0 Q-18 -4 -12 -6 C-12 -14 -8 -18 -4 -20 L0 -26 L6 -31 Q8 -24 6 -18 L6 -2 L8 0 L4 0 L3 -12 L-2 -6 L-2 0 Z';
    var head = 'M-1 -27 L1 -31 L0 -35 L3 -33 L7 -38 L9.5 -39.5 L8 -36 L10 -35 L6 -31 L5 -26 Z';
    var WOLVES = 5;
    for (var w = 0; w < WOLVES; w++) {
      var angle = w * 360 / WOLVES + between(random, -15, 15);
      var size = between(random, 0.8, 0.95);
      var standing = ground(angle) + 1.5;
      // Turned half round, so up for the wolf is in, towards the moon.
      var wolf = svgNode('g', { transform: 'rotate(' + (angle + 180).toFixed(1) + ' 100 100) translate(100 ' + (100 + standing).toFixed(1) + ') scale(' + size.toFixed(2) + ')' }, { fill: black });
      wolf.appendChild(svgNode('path', { d: body }));
      var sing = { keyTimes: '0;0.12;0.7;0.8;1', dur: seconds(between(random, 5.5, 7.5)), begin: seconds(-random() * 7) };
      var raised = svgNode('path', { d: head, transform: 'rotate(35 1 -28)' });
      loop(raised, animate, Object.assign({ attributeName: 'transform', type: 'rotate', values: '35 1 -28;0 1 -28;0 1 -28;35 1 -28;35 1 -28' }, sing), 'animateTransform');
      wolf.appendChild(raised);
      // The song: rings rising from the muzzle while the head is up.
      for (var r = 0; r < 3; r++) {
        var ring = svgNode('g', { transform: 'translate(9 -40)' });
        var arc = svgNode('path', { d: 'M-6 0 A6 6 0 0 1 6 0', 'stroke-width': 1.2, opacity: 0 }, { fill: 'none', stroke: howl });
        var at2 = 0.14 + r * 0.16;
        loop(arc, animate, Object.assign({}, sing, { attributeName: 'opacity', values: '0;0;0.9;0;0', keyTimes: '0;' + at2.toFixed(2) + ';' + (at2 + 0.03).toFixed(2) + ';' + (at2 + 0.2).toFixed(2) + ';1' }));
        loop(arc, animate, Object.assign({}, sing, { attributeName: 'transform', type: 'scale', values: '0.3;0.3;0.5;2.4;2.4', keyTimes: '0;' + at2.toFixed(2) + ';' + (at2 + 0.03).toFixed(2) + ';' + (at2 + 0.2).toFixed(2) + ';1' }), 'animateTransform');
        ring.appendChild(arc);
        wolf.appendChild(ring);
      }
      svg.appendChild(wolf);
    }
    return svg;
  }

  /**
   * Fireflies: a meadow at night, grass reaching in from the rim and
   * swaying, fireflies drifting over it - most of them flashing together
   * in waves that ripple out from the middle, a few on their own.
   */
  function firefliesArt(random, animate) {
    var svg = svgCanvas();
    var fly = exclusiveToken('firefly');
    var glowColor = exclusiveToken('firefly-glow');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '60%' }, [
      [0.2, lighter(exclusiveToken('meadow-sky'), 12)], [0.7, exclusiveToken('meadow-sky')], [1, exclusiveToken('meadow-night')],
    ])));
    // Soft far-off glows.
    var haze = addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { stdDeviation: '3' }));
    });
    for (var h = 0; h < 12; h++) {
      var spot = polar(between(random, 36, 80), between(random, 0, 360));
      svg.appendChild(svgNode('circle', { cx: spot.x.toFixed(1), cy: spot.y.toFixed(1), r: between(random, 3, 7).toFixed(1), opacity: 0.12, filter: haze }, { fill: glowColor }));
    }

    // Grass, in clumps round the rim, each clump swaying from its root.
    var grass = exclusiveToken('grass');
    var light = exclusiveToken('grass-light');
    for (var c = 0; c < 20; c++) {
      var base = c * 18 + between(random, -4, 4);
      var root = polar(103, base);
      var clump = svgNode('g');
      var sway = between(random, 3, 6);
      loop(clump, animate, Object.assign({
        attributeName: 'transform', type: 'rotate',
        values: -sway + ' ' + xy(root) + ';' + sway + ' ' + xy(root) + ';' + -sway + ' ' + xy(root),
        dur: seconds(between(random, 3, 5)), begin: seconds(-random() * 5),
      }, EASE_BACK_AND_FORTH), 'animateTransform');
      for (var g = 0; g < 9; g++) {
        var a = base + between(random, -9, 9);
        var foot = polar(104, a);
        var tip = polar(between(random, 58, 86), a + between(random, -8, 8));
        var bendAt = polar(between(random, 80, 92), a + between(random, -4, 4));
        var half = between(random, 0.9, 1.6);
        clump.appendChild(svgNode('path', {
          d: 'M' + xy(polar(104, a - half)) + ' Q' + xy(bendAt) + ' ' + xy(tip) + ' Q' + xy(bendAt) + ' ' + xy(polar(104, a + half)) + ' Z',
        }, { fill: random() < 0.4 ? light : grass }));
      }
      svg.appendChild(clump);
    }

    // The fireflies: each wandering its own loop, glowing and flashing.
    var glow = gradient(svg, 'radial', {}, [[0, fly, 0.9], [0.3, glowColor, 0.5], [1, glowColor, 0]]);
    var FLASH = 2.6;
    for (var f = 0; f < 48; f++) {
      var home = { radius: between(random, 38, 90), angle: between(random, 0, 360) };
      var centre = polar(home.radius, home.angle);
      var loopPoints = [];
      for (var k = 0; k < 5; k++) {
        loopPoints.push({ x: centre.x + between(random, -14, 14), y: centre.y + between(random, -14, 14) });
      }
      var wander = svgNode('g', { transform: 'translate(' + xy(centre) + ')' });
      if (animate) {
        wander.removeAttribute('transform');
        loop(wander, animate, { path: smoothLoop(loopPoints), dur: seconds(between(random, 8, 14)), begin: seconds(-random() * 14) }, 'animateMotion');
      }
      var light2 = svgNode('g', { opacity: 0.3 });
      // Most flash in step, in a wave out from the middle; a few by themselves.
      var inStep = random() < 0.75;
      loop(light2, animate, {
        attributeName: 'opacity', values: '0.3;0.3;1;0.3', keyTimes: '0;0.62;0.7;1',
        dur: seconds(inStep ? FLASH : between(random, 1.8, 3.4)),
        begin: seconds(inStep ? -(1 - (home.radius - 38) / 52 * 0.45) * FLASH : -random() * 3),
      });
      light2.appendChild(svgNode('circle', { cx: 0, cy: 0, r: 7.5, fill: glow }));
      light2.appendChild(svgNode('circle', { cx: 0, cy: 0, r: 1.2 }, { fill: fly }));
      wander.appendChild(light2);
      svg.appendChild(wander);
    }
    return svg;
  }

  /**
   * Serpent Scales: the record wrapped in snakeskin - row on row of
   * overlapping scales, dark and olive, the skin rippling as though the
   * muscles moved beneath it, and rainbow iridescence washing out across
   * it wave after wave.
   */
  function serpentArt(random, animate) {
    var svg = svgCanvas();
    var dark = exclusiveToken('scale-dark');
    svg.appendChild(fullRect(dark));
    var shades = [dark, exclusiveToken('scale-mid'), mix(exclusiveToken('scale-mid'), exclusiveToken('scale-light'), 35)];
    var fills = [[], [], []];
    var highlights = [];
    var outlines = [];
    // Outer rows first, so each row inward lies over the one outside it.
    var row = 0;
    for (var radius = 100; radius > 28; radius -= 8) {
      var count = Math.round(2 * Math.PI * radius / 8.6);
      var step = 360 / count;
      var half = 4.6;
      var length = 6.2;
      for (var s = 0; s < count; s++) {
        var angle = s * step + (row % 2 ? step / 2 : 0);
        var centre = polar(radius, angle);
        // A scale pointing out to the rim: a rounded shield.
        var shape = [
          { x: 0, y: -length }, { x: half, y: -length * 0.25 }, { x: half * 0.7, y: length * 0.55 },
          { x: 0, y: length * 0.8 }, { x: -half * 0.7, y: length * 0.55 }, { x: -half, y: -length * 0.25 },
        ].map(function (p) {
          return placed(p, centre, angle);
        });
        var d = 'M' + xy(shape[0]) + ' Q' + xy(shape[1]) + ' ' + xy(shape[2]) + ' L' + xy(shape[3]) + ' L' + xy(shape[4]) + ' Q' + xy(shape[5]) + ' ' + xy(shape[0]) + ' Z';
        fills[Math.floor(random() * 3)].push(d);
        outlines.push(d);
        var gleam = [{ x: 0, y: -length * 0.8 }, { x: half * 0.45, y: -length * 0.2 }, { x: 0, y: length * 0.1 }, { x: -half * 0.45, y: -length * 0.2 }].map(function (p) {
          return placed(p, centre, angle);
        });
        highlights.push('M' + gleam.map(xy).join(' L') + ' Z');
      }
      row++;
    }
    var skin = svgNode('g', { filter: warp(svg, random, '0.03', 4, 0, animate ? [2, 6] : null, 4) });
    fills.forEach(function (list, index) {
      skin.appendChild(svgNode('path', { d: list.join(' ') }, { fill: shades[index] }));
    });
    skin.appendChild(svgNode('path', { d: highlights.join(' '), opacity: 0.35 }, { fill: exclusiveToken('scale-light') }));

    // Iridescence washing out across the scales, wave after wave.
    var sheen = svgNode('g', { filter: addFilter(svg, function (filter) {
      filter.appendChild(svgNode('feGaussianBlur', { stdDeviation: '4' }));
    }) }, { fill: 'none', mixBlendMode: 'screen' });
    ['iris-teal', 'iris-violet', 'iris-gold', 'iris-teal'].forEach(function (name, index) {
      var wave = svgNode('circle', { cx: 100, cy: 100, r: 40 + index * 18, opacity: 0.55, 'stroke-width': 14 }, { stroke: exclusiveToken(name) });
      var when = { dur: '5.2s', begin: seconds(-index * 1.3) };
      loop(wave, animate, Object.assign({ attributeName: 'r', values: '22;112' }, when));
      loop(wave, animate, Object.assign({ attributeName: 'opacity', values: '0;0.6;0.5;0', keyTimes: '0;0.2;0.75;1' }, when));
      sheen.appendChild(wave);
    });
    skin.appendChild(sheen);
    skin.appendChild(svgNode('path', { d: outlines.join(' '), 'stroke-width': 0.55 }, { fill: 'none', stroke: darker(dark, 50) }));
    svg.appendChild(skin);
    return svg;
  }

  /** A humpback facing +x round 0 0, seen from above: flukes beating, long fins sweeping. */
  function whaleNode(random, animate) {
    var body = exclusiveToken('whale-body');
    var light = exclusiveToken('whale-light');
    var whale = svgNode('g');
    var beat = { dur: seconds(between(random, 2, 2.8)) };
    [-1, 1].forEach(function (side) {
      var fin = svgNode('path', { d: 'M6 ' + side * 4.5 + ' C2 ' + side * 12 + ' -6 ' + side * 20 + ' -12 ' + side * 22 + ' C-8 ' + side * 15 + ' -2 ' + side * 8 + ' 2 ' + side * 4.5 + ' Z' }, { fill: mix(body, light, 30) });
      loop(fin, animate, Object.assign({ attributeName: 'transform', type: 'rotate', values: (side * 10) + ' 5 0;' + (side * -8) + ' 5 0;' + (side * 10) + ' 5 0' }, beat, EASE_BACK_AND_FORTH), 'animateTransform');
      whale.appendChild(fin);
    });
    var tail = svgNode('g');
    loop(tail, animate, Object.assign({ attributeName: 'transform', type: 'rotate', values: '-9 -28 0;9 -28 0;-9 -28 0' }, beat, EASE_BACK_AND_FORTH), 'animateTransform');
    var flukes = svgNode('path', { d: 'M-28 0 C-31 -2 -34 -8 -38 -10 C-36 -5 -36 -2 -37 0 C-36 2 -36 5 -38 10 C-34 8 -31 2 -28 0 Z' }, { fill: body });
    loop(flukes, animate, Object.assign({ attributeName: 'transform', type: 'scale', values: '1 1;1 0.65;1 1' }, { dur: seconds(parseFloat(beat.dur) / 2) }, EASE_BACK_AND_FORTH), 'animateTransform');
    tail.appendChild(flukes);
    whale.appendChild(tail);
    whale.appendChild(svgNode('path', { d: 'M22 0 C20 -5 12 -7 2 -7 C-8 -7 -18 -4 -26 -1.5 L-30 -1 L-30 1 L-26 1.5 C-18 4 -8 6.5 2 6.5 C12 6.5 20 4 22 0 Z' }, { fill: body }));
    whale.appendChild(svgNode('path', { d: 'M18 0 C14 -2.5 6 -3 -4 -2.5 C-14 -1.5 -20 -0.5 -24 0 C-20 0.5 -14 1.5 -4 2.5 C6 3 14 2.5 18 0 Z', opacity: 0.35 }, { fill: light }));
    // Knobbly tubercles on the head.
    [[18, -1.5], [16, 1.2], [13.5, -2.2], [11, 0.4], [9, -1.8]].forEach(function (knob) {
      whale.appendChild(svgNode('circle', { cx: knob[0], cy: knob[1], r: 0.7, opacity: 0.6 }, { fill: light }));
    });
    return whale;
  }

  /**
   * Whale Song: the deep blue, light rippling through it from above, and
   * two humpbacks gliding round and round, weaving in and out as they go -
   * flukes beating, long fins sweeping - rings of glowing song spreading
   * from them, bubbles streaming up.
   */
  function whaleSongArt(random, animate) {
    var svg = svgCanvas();
    var song = exclusiveToken('song');
    svg.appendChild(fullRect(gradient(svg, 'radial', { cx: '50%', cy: '50%', r: '62%' }, [
      [0, lighter(exclusiveToken('whale-blue'), 12)], [0.55, exclusiveToken('whale-blue')], [1, exclusiveToken('whale-deep')],
    ])));
    svg.appendChild(svgNode('rect', {
      x: 0, y: 0, width: 200, height: 200, opacity: 0.3,
      filter: noiseFill(svg, random, {
        type: 'turbulence', frequency: '0.028', drift: '0.036', seconds: 8, octaves: 2,
        alpha: '-4 0 0 0 1.3', color: exclusiveToken('caustic'),
      }, animate),
    }));
    stars(svg, random, animate, 24, song);

    // Their lap: round the record, in and out three times.
    var lap = [];
    var phase = between(random, 0, 360);
    for (var d = 0; d < 360; d += 5) {
      lap.push(polar(64 + 16 * Math.sin((3 * d + phase) * Math.PI / 180), d));
    }
    var route = smoothLoop(lap);
    var LAP_S = 30;
    for (var w = 0; w < 2; w++) {
      var swim = svgNode('g', { transform: 'translate(' + xy(lap[w * 36]) + ') rotate(' + (w * 180 + 90) + ')' });
      if (animate) {
        swim.removeAttribute('transform');
        loop(swim, animate, { path: route, rotate: 'auto', dur: LAP_S + 's', begin: seconds(-w * LAP_S / 2) }, 'animateMotion');
      }
      var size = svgNode('g', { transform: 'scale(' + (w ? 0.82 : 1) + ')' });
      // Song, ringing out from its head.
      var rings = svgNode('g', { filter: glowFilter(svg, 1.2) }, { fill: 'none', stroke: song });
      for (var r = 0; r < 3; r++) {
        var ring = svgNode('circle', { cx: 22, cy: 0, r: 4, opacity: 0, 'stroke-width': 1.4 });
        var sing = { dur: '4.2s', begin: seconds(-r * 0.5 - w * 2) };
        loop(ring, animate, Object.assign({ attributeName: 'r', values: '4;40;40', keyTimes: '0;0.5;1' }, sing));
        loop(ring, animate, Object.assign({ attributeName: 'opacity', values: '0.9;0;0', keyTimes: '0;0.5;1' }, sing));
        rings.appendChild(ring);
      }
      size.appendChild(rings);
      size.appendChild(whaleNode(random, animate));
      swim.appendChild(size);
      svg.appendChild(swim);
    }

    // Bubbles streaming up and away.
    var bubbles = svgNode('g', { 'stroke-width': 0.45 }, { fill: 'none', stroke: exclusiveToken('caustic') });
    for (var b = 0; b < 26; b++) {
      var a = between(random, 0, 360);
      var from = polar(between(random, 32, 70), a);
      var to = polar(106, a + between(random, -10, 10));
      var bubble = svgNode('circle', { cx: from.x.toFixed(1), cy: from.y.toFixed(1), r: between(random, 0.5, 1.6).toFixed(2), opacity: 0.7 });
      var rise = { dur: seconds(between(random, 3.5, 7)), begin: seconds(-random() * 7) };
      loop(bubble, animate, Object.assign({ attributeName: 'cx', values: from.x.toFixed(1) + ';' + to.x.toFixed(1) }, rise));
      loop(bubble, animate, Object.assign({ attributeName: 'cy', values: from.y.toFixed(1) + ';' + to.y.toFixed(1) }, rise));
      loop(bubble, animate, Object.assign({ attributeName: 'opacity', values: '0.8;0' }, rise));
      bubbles.appendChild(bubble);
    }
    svg.appendChild(bubbles);
    return svg;
  }

  /**
   * Holographic foil, the part that turns with the record: mirror-bright
   * silver, a fine prismatic grain of every colour catching the light in
   * thin spokes, glinting flakes and diffraction rings. The rainbow the
   * foil throws stays put over it as it turns (.vinyl__holo, style.css) -
   * the way a real hologram's, or a CD's, does.
   */
  function holographicDrawing(drawing, angle, random) {
    var silver = token('silver');
    var spectrum = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
    var grain = spectrum.map(function (name, index) {
      return seeThrough(token(name), 38) + ' ' + (index * 1.1).toFixed(1) + 'deg ' + ((index + 1) * 1.1).toFixed(1) + 'deg';
    });
    drawing.background = [
      // The prismatic grain: spokes of spectrum a degree wide, round and round.
      'repeating-conic-gradient(from ' + angle + 'deg, ' + grain.join(', ') + ')',
      // Mirror silver, bright and dark by turns, like polished metal.
      // Mid-toned, so the spectrum laid over it shows rich, not pastel.
      'conic-gradient(from ' + (angle + 20) + 'deg, ' + [
        darker(silver, 10), darker(silver, 55), lighter(silver, 20), darker(silver, 62),
        darker(silver, 10), darker(silver, 55), lighter(silver, 20), darker(silver, 62), darker(silver, 10),
      ].join(', ') + ')',
    ].join(', ');
    drawing.finish = [];
    // Flakes of foil, each glinting its own colour.
    for (var f = 0; f < 70; f++) {
      var flake = lighter(token(spectrum[Math.floor(random() * spectrum.length)]), 45);
      drawing.finish.push(dot(flake, between(random, 0.5, 1.4), between(random, 4, 96), between(random, 4, 96)));
    }
    // Fine diffraction rings, splitting the light.
    drawing.finish.push('repeating-radial-gradient(circle, transparent 0 1.6px, ' + seeThrough('var(--color-text)', 22) + ' 2.2px, transparent 2.8px)');
    // Brushed bands of light and shadow, shimmering as it spins.
    drawing.finish.push('repeating-conic-gradient(from ' + (angle + 7) + 'deg, '
      + seeThrough('var(--color-text)', 30) + ' 0deg 2deg, transparent 7deg 17deg, '
      + seeThrough('var(--color-black)', 22) + ' 22deg 24deg, transparent 29deg 40deg)');
  }

  // The colours each exclusive's card and unboxing glow in.
  var EXCLUSIVE_GLOWS = {
    aurora: ['aurora-green', 'aurora-violet'],
    supernova: ['nova-flare', 'hot-white'],
    holographic: ['neon-cyan', 'neon-pink'],
    blackhole: ['plasma', 'flame'],
    liquidgold: ['gold-warm', 'gold-light'],
    bioluminescent: ['biolume', 'biolume-soft'],
    thunderstorm: ['lightning', 'aurora-violet'],
    synthwave: ['neon-pink', 'neon-cyan'],
    stainedglass: ['sunset', 'aurora-teal'],
    inferno: ['fire', 'flame'],
    koipond: ['koi', 'lily'],
    kaleidoscope: ['sun', 'neon-pink'],
    digitalrain: ['code', 'neon-cyan'],
    eclipse: ['corona', 'hot-white'],
    hyperspace: ['warp', 'star'],
    cherryblossom: ['blossom', 'blossom-deep'],
    circuit: ['code', 'neon-cyan'],
    radar: ['radar', 'neon-cyan'],
    plasmaglobe: ['plasma-violet', 'plasma-pink'],
    equalizer: ['neon-cyan', 'neon-pink'],
    fireworks: ['neon-pink', 'firework-green'],
    glitch: ['bar-cyan', 'bar-magenta'],
    geode: ['amethyst', 'amethyst-light'],
    lasershow: ['laser-green', 'laser-red'],
    jellyfish: ['jelly-pink', 'jelly-blue'],
    helix: ['helix-a', 'helix-b'],
    atomic: ['electron', 'nucleus'],
    neoncity: ['neon-pink', 'window'],
    portal: ['portal', 'portal-core'],
    disco: ['mirror-light', 'neon-pink'],
    peacock: ['peacock-teal', 'peacock-gold'],
    tigereye: ['eye-amber', 'eye-gold'],
    murmuration: ['dusk-mid', 'dusk-low'],
    honeycomb: ['honey', 'honey-light'],
    monarch: ['monarch', 'day-sky'],
    raven: ['blood-moon', 'raven-sheen-violet'],
    wolfmoon: ['moon-light', 'howl'],
    fireflies: ['firefly-glow', 'firefly'],
    serpent: ['iris-teal', 'iris-violet'],
    whalesong: ['song', 'whale-blue'],
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
        holographicDrawing(drawing, angle, random);
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

      case 'koipond':
        drawing.art = koiPondArt(random, animate);
        break;

      case 'kaleidoscope':
        drawing.art = kaleidoscopeArt(random, animate);
        break;

      case 'digitalrain':
        drawing.art = digitalRainArt(random, animate);
        break;

      case 'eclipse':
        drawing.art = solarEclipseArt(random, animate);
        break;

      case 'hyperspace':
        drawing.art = hyperspaceArt(random, animate);
        break;

      case 'cherryblossom':
        drawing.art = cherryBlossomArt(random, animate);
        break;

      case 'circuit':
        drawing.art = circuitBoardArt(random, animate);
        break;

      case 'radar':
        drawing.art = radarSweepArt(random, animate);
        break;

      case 'plasmaglobe':
        drawing.art = plasmaGlobeArt(random, animate);
        break;

      case 'equalizer':
        drawing.art = equalizerArt(random, animate);
        break;

      case 'fireworks':
        drawing.art = fireworksArt(random, animate);
        break;

      case 'glitch':
        drawing.art = glitchArt(random, animate);
        break;

      case 'geode':
        drawing.art = geodeArt(random, animate);
        break;

      case 'lasershow':
        drawing.art = laserShowArt(random, animate);
        break;

      case 'jellyfish':
        drawing.art = jellyfishArt(random, animate);
        break;

      case 'helix':
        drawing.art = doubleHelixArt(random, animate);
        break;

      case 'atomic':
        drawing.art = atomicArt(random, animate);
        break;

      case 'neoncity':
        drawing.art = neonCityArt(random, animate);
        break;

      case 'portal':
        drawing.art = portalArt(random, animate);
        break;

      case 'disco':
        drawing.art = discoBallArt(random, animate);
        break;

      case 'peacock':
        drawing.art = peacockArt(random, animate);
        break;

      case 'tigereye':
        drawing.art = tigerEyeArt(random, animate);
        break;

      case 'murmuration':
        drawing.art = murmurationArt(random, animate);
        break;

      case 'honeycomb':
        drawing.art = honeycombArt(random, animate);
        break;

      case 'monarch':
        drawing.art = monarchArt(random, animate);
        break;

      case 'raven':
        drawing.art = ravenArt(random, animate);
        break;

      case 'wolfmoon':
        drawing.art = wolfMoonArt(random, animate);
        break;

      case 'fireflies':
        drawing.art = firefliesArt(random, animate);
        break;

      case 'serpent':
        drawing.art = serpentArt(random, animate);
        break;

      case 'whalesong':
        drawing.art = whaleSongArt(random, animate);
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
    // Holographic foil's rainbow, still while the record turns under it.
    if (spec.pattern === 'holographic') {
      vinyl.appendChild(div('vinyl__holo'));
    }
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
