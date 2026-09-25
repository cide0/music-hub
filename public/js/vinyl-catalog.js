/*
 * Every record the Store's Mystery Vinyl can hold, as Discogs-style format
 * text that vinyl.js draws ("Oxblood & Cream Marble"), and the random pick
 * of one the collection doesn't have yet. Used by the Store (to unbox) and
 * the Collection (for "12 of 2,813 collected").
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

  var CATALOG_SIZE = FAMILIES.reduce(function (sum, family) {
    return sum + family.formats.length;
  }, 0);

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
      return cover || !family.needsCover;
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
      seed: Math.random().toString(36).slice(2, 10),
      unboxedAt: new Date().toISOString(),
    };
  }

  MusicHub.vinylCatalog = {
    families: FAMILIES,
    size: CATALOG_SIZE,
    pick: pick,
  };
})(window.MusicHub);
