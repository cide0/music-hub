/*
 * Every record the Store's Mystery Vinyl can hold, as Discogs-style format
 * text that vinyl.js draws ("Oxblood & Cream Marble"), and the random pick
 * of one the collection doesn't have yet - plus the Daily Spin's forty wheel
 * exclusives, which only the wheel ever hands out. Used by the Store (to
 * unbox), the Daily Spin and the Collection (for "12 of 2,823 collected").
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  // Record colours the catalog mixes, with the words vinyl.js reads back
  // into the same colour.
  var COLOR_NAMES = {
    black: 'Black', white: 'White', cream: 'Cream', grey: 'Grey', silver: 'Silver',
    gold: 'Gold', bronze: 'Bronze', red: 'Red', oxblood: 'Oxblood', orange: 'Orange',
    yellow: 'Yellow', green: 'Green', lime: 'Lime', mint: 'Mint', olive: 'Olive',
    teal: 'Teal', blue: 'Blue', navy: 'Navy', sky: 'Baby Blue', purple: 'Purple',
    lilac: 'Lilac', pink: 'Pink', magenta: 'Magenta', brown: 'Brown', clear: 'Clear',
  };
  var SOLID = Object.keys(COLOR_NAMES).filter(function (color) {
    return color !== 'clear';
  });
  var TINTS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'magenta', 'sky', 'oxblood', 'lime'];
  var PAIRS = ['black', 'white', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple',
    'pink', 'magenta', 'gold', 'silver', 'cream', 'sky', 'mint', 'lilac', 'oxblood', 'clear'];
  var DARK = ['black', 'navy', 'purple', 'oxblood'];
  var WAX = ['orange', 'red', 'yellow', 'lime', 'pink', 'teal', 'sky', 'mint'];

  function name(color) {
    return COLOR_NAMES[color];
  }

  function eachPair(colors, build) {
    var out = [];
    colors.forEach(function (first) {
      colors.forEach(function (second) {
        if (first !== second) {
          out.push(build(name(first), name(second)));
        }
      });
    });
    return out;
  }

  /*
   * Every record the box can hold, as Discogs-style format text for
   * vinyl.js, grouped into families. A pick rolls a family first (by
   * weight - zoetropes and glow in the dark are the rare ones), then a
   * record from it, so the everyday two-colour patterns don't crowd out
   * the rest just by being many. `needsCover`: drawn from the album's
   * cover art, so only picked when the album has one.
   */
  var FAMILIES = [
    { name: 'Solid', weight: 8, formats: SOLID.map(name) },
    { name: 'Translucent', weight: 8, formats: TINTS.map(function (c) { return name(c) + ' Translucent'; }).concat('Clear') },
    // Not gold, silver or bronze: plain, those are metallic already.
    { name: 'Metallic', weight: 5, formats: ['red', 'blue', 'purple', 'pink', 'green', 'teal', 'black', 'magenta', 'orange', 'navy'].map(function (c) { return name(c) + ' Metallic'; }) },
    { name: 'Glitter', weight: 6, formats: ['black', 'clear', 'purple', 'navy', 'pink', 'red', 'teal', 'white'].reduce(function (out, c) {
      return out.concat(name(c) + ' With Gold Glitter', name(c) + ' With Silver Glitter');
    }, []) },
    { name: 'Marble', weight: 9, formats: eachPair(PAIRS, function (a, b) { return a + ' & ' + b + ' Marble'; }) },
    { name: 'Swirl', weight: 9, formats: eachPair(PAIRS, function (a, b) { return a + ' & ' + b + ' Swirl'; }) },
    { name: 'Splatter', weight: 9, formats: eachPair(PAIRS, function (a, b) { return a + ' With ' + b + ' Splatter'; }) },
    { name: 'Colour Smash', weight: 6, formats: eachPair(PAIRS, function (a, b) { return a + ' & ' + b + ' Smash'; }) },
    { name: 'Half & Half', weight: 6, formats: eachPair(PAIRS, function (a, b) { return a + ' & ' + b + ' Half And Half'; }) },
    { name: 'Stripes', weight: 5, formats: eachPair(PAIRS, function (a, b) { return a + ' & ' + b + ' Stripe'; }) },
    { name: 'Colour In Colour', weight: 5, formats: eachPair(PAIRS, function (a, b) { return a + ' In ' + b; }) },
    { name: 'Smoke', weight: 4, formats: ['Smoke'].concat(['blue', 'purple', 'red', 'green', 'teal', 'orange', 'pink', 'navy'].map(function (c) { return name(c) + ' Smoke'; })) },
    { name: 'Lava Lamp', weight: 3, formats: ['Lava'].concat(TINTS.map(function (c) { return name(c) + ' Lava'; }), DARK.reduce(function (out, lamp) {
      return out.concat(WAX.map(function (wax) { return name(lamp) + ' & ' + name(wax) + ' Lava'; }));
    }, [])) },
    { name: 'Peppermint', weight: 3, formats: ['Peppermint'].concat(['green', 'blue', 'purple', 'pink', 'orange', 'teal', 'magenta'].map(function (c) { return name(c) + ' Peppermint'; })) },
    { name: 'Galaxy', weight: 2, formats: ['Galaxy', 'Purple & Black Galaxy', 'Navy & Purple Galaxy', 'Black & Blue Galaxy', 'Navy & Pink Galaxy', 'Black & Teal Galaxy'] },
    { name: 'Rainbow', weight: 2, formats: ['Rainbow', 'Rainbow Swirl', 'Rainbow Splatter', 'Rainbow Stripe', 'Rainbow Marble', 'Rainbow Smash', 'Rainbow Lava', 'White With Rainbow Splatter', 'Black With Rainbow Splatter', 'Clear With Rainbow Splatter'] },
    { name: 'Zoetrope', weight: 1, formats: ['Zoetrope', 'White Zoetrope', 'Navy Zoetrope', 'Purple Zoetrope', 'Oxblood Zoetrope', 'Teal Zoetrope'] },
    { name: 'Glow In The Dark', weight: 1, formats: ['Glow In The Dark'] },
    // The album's cover printed across the whole record. Not "With Gold
    // Glitter": vinyl.js would make that brushed metal as well.
    { name: 'Picture Disc', weight: 3, needsCover: true, formats: ['Picture Disc', 'Picture Disc With Glitter', 'Metallic Picture Disc', 'Clear Picture Disc', 'Glow In The Dark Picture Disc'] },
  ];

  /*
   * The wheel exclusives: won only on the Daily Spin, never in the Mystery
   * Vinyl's box (see `wheelOnly` below). Each is its own pattern in
   * vinyl.js, named by its format; `text` is what the wheel's showcase
   * says about it.
   */
  var EXCLUSIVES = [
    { format: 'Aurora Borealis', text: 'Curtains of green and violet light rippling across a starry polar sky.' },
    { format: 'Supernova', text: 'A star blowing itself apart: a white-hot core, turning rays and shockwaves racing out to the rim.' },
    { format: 'Holographic', text: 'Rainbow foil that never sits still - every colour shifting through every other as it turns.' },
    { format: 'Black Hole', text: 'A blazing accretion disc whirling into the dark, ringed by white-hot light.' },
    { format: 'Liquid Gold', text: 'Molten gold, bright and dark streams of it folding into each other and flowing on.' },
    { format: 'Bioluminescent', text: 'The deep sea at night: rippling light, glowing trails and plankton pulsing in the dark.' },
    { format: 'Thunderstorm', text: 'Churning storm clouds, slanting rain and lightning forking out to the rim.' },
    { format: 'Synthwave Sunset', text: 'A striped neon sun sinking behind the mountains, a glowing grid racing towards you.' },
    { format: 'Stained Glass', text: 'A cathedral rose window of jewel-coloured glass, sunlight wandering across it.' },
    { format: 'Inferno', text: 'A ring of fire roaring out from the label, embers flying off the rim.' },
    { format: 'Koi Pond', text: 'Koi circling through deep green water under drifting lily pads, ripples spreading where they surface.' },
    { format: 'Kaleidoscope', text: 'Coloured glass mirrored twelve ways round, folding into new patterns as every colour shifts.' },
    { format: 'Digital Rain', text: 'Columns of glowing green code streaming in from every side to the middle, each led by a white-hot character.' },
    { format: 'Solar Eclipse', text: 'The moon dead black over the sun, the corona streaming round it and a diamond ring flaring at its edge.' },
    { format: 'Hyperspace', text: 'Stars stretched into streaks, racing out past you faster and faster down a tunnel of blue light.' },
    { format: 'Cherry Blossom', text: 'Branches heavy with pink flowers swaying at dusk, petals drifting down under a pale moon.' },
    { format: 'Circuit Board', text: 'Gold traces on green board, chips blinking and pulses of signal racing out to the rim.' },
    { format: 'Radar Sweep', text: 'A green radar screen, its beam sweeping round and lighting up every blip it passes.' },
    { format: 'Plasma Globe', text: 'Violet tendrils of electricity crackling out to the glass, a hot spot flickering wherever one touches.' },
    { format: 'Equalizer', text: 'A ring of bars bouncing to the beat, soundwaves circling the rim and the label pulsing on every kick.' },
    { format: 'Fireworks', text: 'Rockets streaking in from the rim and bursting into showers of colour, sparks drooping as they fade into the smoke.' },
    { format: 'Glitch', text: 'A TV test card breaking up: colour channels tearing apart, slices jumping sideways, static flashing and a scan bar rolling through.' },
    { format: 'Amethyst Geode', text: 'A geode cracked open: rings of agate flowing round a hollow of purple crystal points, glints popping and energy pulsing out.' },
    { format: 'Laser Show', text: 'Fans of green, red and blue lasers sweeping through the haze from all round the rim, strobes firing.' },
    { format: 'Jellyfish Bloom', text: 'Glowing jellyfish pulsing their way out through the deep, tentacles trailing, sunbeams wavering down through the water.' },
    { format: 'Double Helix', text: 'A glowing strand of DNA wound all the way round, twisting as pulses of light race along it and a scanner sweeps in and out.' },
    { format: 'Atomic', text: 'Electrons whirling round crossed orbits with comet tails, the nucleus jostling and photons flying off.' },
    { format: 'Neon City', text: 'A tiny neon planet of skyscrapers: windows flickering, signs blinking, traffic streaming round and searchlights sweeping the sky.' },
    { format: 'Dimension Portal', text: 'A vortex of fiery red and orange energy churning round and round, lightning crackling at its rim and the stars around it sucked in.' },
    { format: 'Disco Ball', text: 'A ball of a thousand mirror tiles: flashes racing across it, coloured spotlights wandering over it, highlights sliding by.' },
    { format: 'Peacock', text: 'A whole fanned-out train of eyespot feathers, rattling in waves round the tail as the eyes flicker iridescent.' },
    { format: "Tiger's Eye", text: 'One great amber eye staring back: the pupil widening and narrowing, the iris glowing, the lids sweeping shut in a blink.' },
    { format: 'Murmuration', text: 'A flock of starlings at dusk pouring from one shape into the next - a cloud, a spiral, a ring, a comet.' },
    { format: 'Honeycomb', text: 'Wax cells of glowing honey, a warm glow washing through them, bees waggle-dancing on the comb and buzzing over it.' },
    { format: 'Monarch Migration', text: 'Monarch butterflies fluttering out on the wind through a bright sky, wings beating, clouds drifting by.' },
    { format: 'Raven', text: 'A great raven on a dead branch under a blood moon, cocking its head and cawing, crows flapping past and black feathers tumbling down.' },
    { format: 'Wolf Moon', text: 'A huge full moon, clouds drifting over it, and a pack on the hills round it raising their heads to howl.' },
    { format: 'Fireflies', text: 'A meadow at night, grass swaying, fireflies drifting over it and flashing together in waves.' },
    { format: 'Serpent Scales', text: 'Snakeskin rippling as though muscles moved beneath it, rainbow iridescence washing out across the scales.' },
    { format: 'Whale Song', text: 'Two humpbacks gliding round the deep, flukes beating and fins sweeping, rings of glowing song spreading from them.' },
  ];

  FAMILIES.push({
    name: 'Wheel Exclusive',
    weight: 0,
    // Never picked for the Mystery Vinyl - see pickExclusive.
    wheelOnly: true,
    formats: EXCLUSIVES.map(function (exclusive) {
      return exclusive.format;
    }),
  });

  var CATALOG_SIZE = FAMILIES.reduce(function (sum, family) {
    return sum + family.formats.length;
  }, 0);

  function seed() {
    return Math.random().toString(36).slice(2, 10);
  }

  /**
   * A random record not among `vinyls` (the collection so far), or null
   * when it holds them all. `options.cover`: whether the album it's for
   * has cover art - without, picture discs are left out.
   */
  function pick(vinyls, options) {
    var cover = !!(options && options.cover);
    var owned = {};
    vinyls.forEach(function (vinyl) {
      owned[vinyl.format] = true;
    });
    var open = FAMILIES.filter(function (family) {
      return !family.wheelOnly && (cover || !family.needsCover);
    }).map(function (family) {
      return {
        family: family,
        formats: family.formats.filter(function (format) {
          return !owned[format];
        }),
      };
    }).filter(function (entry) {
      return entry.formats.length > 0;
    });
    if (!open.length) {
      return null;
    }
    var total = open.reduce(function (sum, entry) {
      return sum + entry.family.weight;
    }, 0);
    var roll = Math.random() * total;
    var chosen = open[open.length - 1];
    for (var i = 0; i < open.length; i += 1) {
      roll -= open[i].family.weight;
      if (roll < 0) {
        chosen = open[i];
        break;
      }
    }
    return {
      format: chosen.formats[Math.floor(Math.random() * chosen.formats.length)],
      family: chosen.family.name,
      // Its own marbling or splatter, the same on every visit.
      seed: seed(),
      unboxedAt: new Date().toISOString(),
    };
  }

  /**
   * A random wheel exclusive not among `vinyls` (the collection, plus any
   * won but not pressed yet), or null when they're all there.
   */
  function pickExclusive(vinyls) {
    var owned = {};
    vinyls.forEach(function (vinyl) {
      owned[vinyl.format] = true;
    });
    var open = EXCLUSIVES.filter(function (exclusive) {
      return !owned[exclusive.format];
    });
    if (!open.length) {
      return null;
    }
    return {
      format: open[Math.floor(Math.random() * open.length)].format,
      family: 'Wheel Exclusive',
      seed: seed(),
    };
  }

  MusicHub.vinylCatalog = {
    families: FAMILIES,
    size: CATALOG_SIZE,
    exclusives: EXCLUSIVES,
    pick: pick,
    pickExclusive: pickExclusive,
  };
})(window.MusicHub);
