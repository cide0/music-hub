/*
 * The cities the Concerts page looks for concerts in: the default German
 * cities (each can be switched off) plus the user's own, each in one of the
 * countries Ticketmaster is searched in (COUNTRIES). Kept in the `concertCities`
 * setting as { off: [names], custom: [{ name, country }] } - nothing stored
 * means every default city, so the list only exists once it's changed.
 *
 * Cities in Germany are looked up on Ticketmaster and Eventim, the ones in
 * any other country on Ticketmaster only.
 *
 * Ticketmaster and Eventim spell some cities differently ("Köln",
 * "Cologne", "Koeln"), so a city is matched by every spelling of it we know
 * of (SPELLINGS); its name is always the one on this list.
 */
window.MusicHub = window.MusicHub || {};

(function (MusicHub) {
  'use strict';

  var SETTING = 'concertCities';
  var MAX_NAME_LENGTH = 60;
  var MAX_CUSTOM = 50;

  // The countries a city can be in (Ticketmaster's country codes): every EU
  // country Ticketmaster lists concerts in, plus Switzerland and the UK -
  // Germany first, then by name. The codes must stay in sync with
  // TICKETMASTER_COUNTRIES in lib/cities.js.
  //
  // `tickets` is the user's bought tickets on that country's Ticketmaster
  // site (the Concerts page's Ticketmaster button) - only the start page
  // where the site isn't Ticketmaster's usual one (France, Greece, Italy),
  // none where the country has no site of its own.
  var COUNTRIES = [
    { code: 'DE', name: 'Germany', timeZone: 'Europe/Berlin', tickets: 'https://www.ticketmaster.de/user/orders' },
    { code: 'AT', name: 'Austria', timeZone: 'Europe/Vienna', tickets: 'https://www.ticketmaster.at/user/orders' },
    { code: 'BE', name: 'Belgium', timeZone: 'Europe/Brussels', tickets: 'https://www.ticketmaster.be/user/orders' },
    { code: 'CZ', name: 'Czechia', timeZone: 'Europe/Prague', tickets: 'https://www.ticketmaster.cz/user/orders' },
    { code: 'DK', name: 'Denmark', timeZone: 'Europe/Copenhagen', tickets: 'https://www.ticketmaster.dk/user/orders' },
    { code: 'EE', name: 'Estonia', timeZone: 'Europe/Tallinn' },
    { code: 'FI', name: 'Finland', timeZone: 'Europe/Helsinki', tickets: 'https://www.ticketmaster.fi/user/orders' },
    { code: 'FR', name: 'France', timeZone: 'Europe/Paris', tickets: 'https://www.ticketmaster.fr/' },
    { code: 'GR', name: 'Greece', timeZone: 'Europe/Athens', tickets: 'https://www.ticketmaster.gr/' },
    { code: 'IE', name: 'Ireland', timeZone: 'Europe/Dublin', tickets: 'https://www.ticketmaster.ie/user/orders' },
    { code: 'IT', name: 'Italy', timeZone: 'Europe/Rome', tickets: 'https://www.ticketmaster.it/' },
    { code: 'LU', name: 'Luxembourg', timeZone: 'Europe/Luxembourg' },
    { code: 'NL', name: 'Netherlands', timeZone: 'Europe/Amsterdam', tickets: 'https://www.ticketmaster.nl/user/orders' },
    { code: 'PL', name: 'Poland', timeZone: 'Europe/Warsaw', tickets: 'https://www.ticketmaster.pl/user/orders' },
    { code: 'PT', name: 'Portugal', timeZone: 'Europe/Lisbon' },
    { code: 'ES', name: 'Spain', timeZone: 'Europe/Madrid', tickets: 'https://www.ticketmaster.es/user/orders' },
    { code: 'SE', name: 'Sweden', timeZone: 'Europe/Stockholm', tickets: 'https://www.ticketmaster.se/user/orders' },
    { code: 'CH', name: 'Switzerland', timeZone: 'Europe/Zurich', tickets: 'https://www.ticketmaster.ch/user/orders' },
    { code: 'GB', name: 'United Kingdom', timeZone: 'Europe/London', tickets: 'https://www.ticketmaster.co.uk/user/orders' },
  ];
  var DEFAULT_COUNTRY = 'DE';

  var DEFAULT_CITIES = [
    'Berlin',
    'Hamburg',
    'München',
    'Köln',
    'Frankfurt am Main',
    'Düsseldorf',
    'Stuttgart',
    'Leipzig',
    'Dortmund',
    'Essen',
    'Bremen',
    'Hannover',
    'Nürnberg',
    'Offenbach am Main',
  ];

  // Each line is one city's spellings in the shops (local, English, German,
  // without accents). Any one of them on the list finds all the others.
  var SPELLINGS = [
    ['München', 'Munich', 'Muenchen'],
    ['Köln', 'Cologne', 'Koeln'],
    ['Frankfurt am Main', 'Frankfurt', 'Frankfurt Main'],
    ['Düsseldorf', 'Duesseldorf'],
    ['Hannover', 'Hanover'],
    ['Nürnberg', 'Nuremberg', 'Nuernberg'],
    ['Offenbach am Main', 'Offenbach', 'Offenbach Main'],
    ['Wien', 'Vienna'],
    ['Zürich', 'Zurich', 'Zuerich'],
    ['Genève', 'Geneva', 'Genf'],
    ['Bern', 'Berne'],
    ['Basel', 'Bâle'],
    ['Luzern', 'Lucerne'],
    ['Den Haag', 'The Hague', "'s-Gravenhage"],
    ["'s-Hertogenbosch", 'Den Bosch'],
    ['Warszawa', 'Warsaw', 'Warschau'],
    ['Kraków', 'Cracow', 'Krakau'],
    ['Wrocław', 'Breslau'],
    ['Gdańsk', 'Danzig'],
    ['Poznań', 'Posen'],
    ['Łódź', 'Lodsch'],
    // Milan's big arena (Unipol Forum) is in Assago.
    ['Milano', 'Milan', 'Mailand', 'Assago'],
    ['Roma', 'Rome', 'Rom'],
    ['Napoli', 'Naples', 'Neapel'],
    ['Torino', 'Turin'],
    ['Firenze', 'Florence', 'Florenz'],
    ['Venezia', 'Venice', 'Venedig'],
    ['Göteborg', 'Gothenburg', 'Goeteborg'],
    ['Stockholm', 'Johanneshov', 'Skärholmen'],
    ['Bruxelles', 'Brussel', 'Brussels', 'Brüssel'],
    ['Antwerpen', 'Antwerp', 'Anvers'],
    ['Gent', 'Ghent', 'Gand'],
    ['Liège', 'Luik', 'Lüttich'],
    ['Brugge', 'Bruges', 'Brügge'],
    ['Praha', 'Prague', 'Prag'],
    ['Brno', 'Brünn'],
    // Frederiksberg (K.B. Hallen) lies within Copenhagen, and Ticketmaster
    // lists Stockholm's big arenas under their districts.
    ['København', 'Copenhagen', 'Kopenhagen', 'Frederiksberg'],
    ['Aarhus', 'Århus'],
    ['Helsinki', 'Helsingfors'],
    ['Turku', 'Åbo'],
    ['Tallinn', 'Reval'],
    ['Athína', 'Athens', 'Athen', 'Athina'],
    ['Thessaloniki', 'Saloniki'],
    ['Luxembourg', 'Luxemburg', 'Lëtzebuerg'],
    ['Esch-sur-Alzette', 'Esch-Alzette', 'Esch an der Alzette'],
    ['Sevilla', 'Seville'],
    ['A Coruña', 'La Coruña'],
    ['Lisboa', 'Lisbon', 'Lissabon'],
    ['Porto', 'Oporto'],
    // The big French arenas and stadiums lie just outside their cities:
    // Paris La Défense Arena, Stade de France, Groupama Stadium (Lyon),
    // Arkéa Arena (Bordeaux), Zénith Nantes.
    ['Paris', 'Nanterre', 'Saint-Denis'],
    ['Lyon', 'Décines-Charpieu'],
    ['Bordeaux', 'Floirac'],
    ['Nantes', 'Saint-Herblain'],
    ['Strasbourg', 'Straßburg'],
    ['Nice', 'Nizza'],
    ['Marseille', 'Marseilles'],
  ];

  /**
   * Lowercase, fold accents and drop anything that isn't a letter or digit.
   * "St" / "Sankt" before a name is "Saint" ("St Denis", "Sankt Gallen").
   */
  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/^(st|sankt)\.?[\s-]+/, 'saint ')
      .replace(/^ste\.?[\s-]+/, 'sainte ')
      .replace(/ß/g, 'ss')
      .replace(/ł/g, 'l')
      .replace(/ø/g, 'o')
      .replace(/æ/g, 'ae')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // Every known spelling -> all spellings of that city.
  var SPELLING_KEYS = {};
  SPELLINGS.forEach(function (names) {
    var keys = names.map(normalize);
    keys.forEach(function (key) {
      SPELLING_KEYS[key] = keys;
    });
  });

  /** The normalized spellings a city name is found by. */
  function keysOf(name) {
    var key = normalize(name);
    return SPELLING_KEYS[key] || [key];
  }

  function country(code) {
    return COUNTRIES.filter(function (entry) {
      return entry.code === code;
    })[0] || null;
  }

  function countryName(code) {
    var entry = country(code);
    return entry ? entry.name : code;
  }

  /** The time zone a concert in that country plays in. */
  function timeZone(code) {
    return (country(code) || country(DEFAULT_COUNTRY)).timeZone;
  }

  /** "  Bad   Homburg " -> "Bad Homburg" */
  function tidyName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * The stored setting, with anything that isn't a name or a known country
   * left out - it may come from an import or another device.
   */
  function stored() {
    var value = MusicHub.storage.getSetting(SETTING, null);
    var off = value && Array.isArray(value.off) ? value.off.filter(function (name) {
      return typeof name === 'string';
    }) : [];
    var custom = value && Array.isArray(value.custom) ? value.custom.filter(function (entry) {
      return entry && typeof entry.name === 'string' && tidyName(entry.name) && country(entry.country);
    }).map(function (entry) {
      return { name: tidyName(entry.name), country: entry.country };
    }) : [];
    return { off: off, custom: custom };
  }

  function save(value) {
    var off = value.off;
    // Nothing changed from the defaults: nothing stored.
    MusicHub.storage.setSetting(SETTING, off.length || value.custom.length ? { off: off, custom: value.custom } : null);
  }

  /**
   * Every city on the list, the defaults first and then the user's in the
   * order they were added: [{ name, country, custom, on }].
   */
  function all() {
    var value = stored();
    var cities = DEFAULT_CITIES.map(function (name) {
      return { name: name, country: DEFAULT_COUNTRY, custom: false };
    }).concat(value.custom.map(function (entry) {
      return { name: entry.name, country: entry.country, custom: true };
    }));
    return cities.map(function (city) {
      city.on = value.off.indexOf(city.name) === -1;
      return city;
    });
  }

  /** The cities switched on - the ones a fetch looks in. */
  function enabled() {
    return all().filter(function (city) {
      return city.on;
    });
  }

  /** The codes of the countries the switched-on cities are in, in COUNTRIES order. */
  function enabledCountries() {
    var cities = enabled();
    return COUNTRIES.map(function (entry) {
      return entry.code;
    }).filter(function (code) {
      return cities.some(function (city) {
        return city.country === code;
      });
    });
  }

  /**
   * The Ticketmaster page with the user's bought tickets: on the site of the
   * country most switched-on cities are in (a tie goes to the one first in
   * COUNTRIES), countries without a site of their own skipped - Germany's
   * when none is left.
   */
  function ticketmasterTickets() {
    var counts = {};
    enabled().forEach(function (city) {
      counts[city.country] = (counts[city.country] || 0) + 1;
    });
    var best = country(DEFAULT_COUNTRY);
    var bestCount = 0;
    COUNTRIES.forEach(function (entry) {
      if (entry.tickets && (counts[entry.code] || 0) > bestCount) {
        best = entry;
        bestCount = counts[entry.code];
      }
    });
    return best.tickets;
  }

  /**
   * The normalized spellings a shop's city name is found by: besides the
   * name itself, the name without its district - a number ("Praha 9"), a
   * Danish postal district's letters ("København S", "Odense SØ") or "City"
   * ("Limerick City") - the city a district names in brackets ("Forest
   * (Brussels)") and each city of a pair ("Gdańsk/Sopot").
   */
  function shopKeys(name) {
    var text = String(name || '').trim();
    var bracketed = /\(([^)]+)\)/.exec(text);
    var names = [
      text,
      text.replace(/\s+\d+$/, ''),
      text.replace(/\s+[A-ZÆØÅ]{1,2}$/, ''),
      text.replace(/\s+city$/i, ''),
    ].concat(bracketed ? [bracketed[1]] : [], text.split('/'));
    var keys = [];
    names.forEach(function (one) {
      keysOf(one).forEach(function (key) {
        if (key && keys.indexOf(key) === -1) {
          keys.push(key);
        }
      });
    });
    return keys;
  }

  /** The city of `cities` in that country found by one of `keys`, else null. */
  function findIn(cities, keys, code) {
    if (!keys.length || !keys[0]) {
      return null;
    }
    return cities.filter(function (city) {
      return city.country === code && keysOf(city.name).some(function (key) {
        return keys.indexOf(key) !== -1;
      });
    })[0] || null;
  }

  /**
   * This list's name for a shop's (or setlist.fm's) city in that country,
   * or null when it's none of `cities` - every city on the list by default.
   * A missing country is Germany, as for concerts stored before there was
   * a choice.
   */
  function match(name, code, cities) {
    var city = findIn(cities || all(), shopKeys(name), code || DEFAULT_COUNTRY);
    return city ? city.name : null;
  }

  function setOn(name, on) {
    var value = stored();
    value.off = value.off.filter(function (other) {
      return other !== name;
    });
    if (!on) {
      value.off.push(name);
    }
    save(value);
  }

  /**
   * Adds one of the user's own cities. Returns { city } once it's on the
   * list, or { error } saying why it isn't.
   */
  function add(name, code) {
    var tidy = tidyName(name);
    if (!tidy) {
      return { error: 'Enter a city first.' };
    }
    if (tidy.length > MAX_NAME_LENGTH) {
      return { error: 'A city name is at most ' + MAX_NAME_LENGTH + ' characters.' };
    }
    if (!normalize(tidy)) {
      return { error: 'That doesn’t look like a city name.' };
    }
    if (!country(code)) {
      return { error: 'Pick the country the city is in.' };
    }
    var existing = findIn(all(), keysOf(tidy), code);
    if (existing) {
      return {
        error: existing.name === tidy
          ? '“' + tidy + '” is already on the list.'
          : '“' + tidy + '” is already on the list, as “' + existing.name + '”.',
      };
    }
    var value = stored();
    if (value.custom.length >= MAX_CUSTOM) {
      return { error: 'That’s ' + MAX_CUSTOM + ' cities of your own already - remove one first.' };
    }
    var city = { name: tidy, country: code };
    value.custom.push(city);
    // A city of that name switched off before starts out switched on.
    value.off = value.off.filter(function (other) {
      return other !== tidy;
    });
    save(value);
    return { city: city };
  }

  /** Takes one of the user's own cities off the list. */
  function remove(name, code) {
    var value = stored();
    value.custom = value.custom.filter(function (city) {
      return city.name !== name || city.country !== code;
    });
    if (!value.custom.some(function (city) { return city.name === name; })) {
      value.off = value.off.filter(function (other) {
        return other !== name;
      });
    }
    save(value);
  }

  MusicHub.concertCities = {
    SETTING: SETTING,
    COUNTRIES: COUNTRIES,
    DEFAULT_COUNTRY: DEFAULT_COUNTRY,
    MAX_NAME_LENGTH: MAX_NAME_LENGTH,
    all: all,
    enabled: enabled,
    enabledCountries: enabledCountries,
    ticketmasterTickets: ticketmasterTickets,
    match: match,
    countryName: countryName,
    timeZone: timeZone,
    setOn: setOn,
    add: add,
    remove: remove,
  };
})(window.MusicHub);
