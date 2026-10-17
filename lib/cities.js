/**
 * The countries the Concerts page can look in on Ticketmaster (its
 * `countryCode`s): every EU country Ticketmaster lists concerts in, plus
 * Switzerland and the UK. Eventim is only searched for Germany. Must stay in
 * sync with COUNTRIES in public/js/concert-cities.js, which holds the user's
 * cities and matches the shops' city names against them.
 */
export const TICKETMASTER_COUNTRIES = [
  'DE', 'AT', 'BE', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 'IE', 'IT', 'LU', 'NL', 'PL', 'PT', 'ES', 'SE',
  'CH', 'GB',
];

/** A request's `country`, upper-cased; Germany when none is given, null when unknown. */
export function ticketmasterCountry(value) {
  const code = String(value || 'DE').trim().toUpperCase();
  return TICKETMASTER_COUNTRIES.includes(code) ? code : null;
}

/**
 * The default cities of the Concerts page, by the names setlist.fm searches
 * are tried under (citySearchNames).
 */
export const ALLOWED_CITIES = [
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

// Ticketmaster sometimes returns the English or un-umlauted spelling, so each
// canonical city also accepts the variants we know of.
const ALIASES = {
  München: ['munich', 'muenchen'],
  Köln: ['cologne', 'koeln'],
  'Frankfurt am Main': ['frankfurt', 'frankfurtmain', 'frankfurtammain'],
  Düsseldorf: ['dusseldorf', 'duesseldorf'],
  Hannover: ['hanover'],
  Nürnberg: ['nuremberg', 'nuernberg'],
  'Offenbach am Main': ['offenbach', 'offenbachmain', 'offenbachammain'],
};

/** Lowercase, fold umlauts and drop anything that isn't a letter or digit. */
function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const LOOKUP = new Map();
for (const city of ALLOWED_CITIES) {
  LOOKUP.set(normalize(city), city);
  for (const alias of ALIASES[city] || []) {
    LOOKUP.set(normalize(alias), city);
  }
}

/**
 * Returns the canonical city name for a city of the default list, or null
 * when it's none of them.
 */
function matchCity(name) {
  const normalized = normalize(name);
  if (!normalized) {
    return null;
  }
  // "Frankfurt (Oder)" must not match "Frankfurt am Main", and
  // "Offenbach an der Queich" is a different town entirely.
  if (normalized.startsWith('frankfurt') && normalized.includes('oder')) {
    return null;
  }
  if (normalized.startsWith('offenbach') && normalized.includes('queich')) {
    return null;
  }
  return LOOKUP.get(normalized) || null;
}

// How other services (setlist.fm) may spell a city that isn't the canonical
// German name - tried in turn when the canonical name finds nothing.
const OTHER_SPELLINGS = {
  München: ['Munich'],
  Köln: ['Cologne'],
  'Frankfurt am Main': ['Frankfurt'],
  Hannover: ['Hanover'],
  Nürnberg: ['Nuremberg'],
  'Offenbach am Main': ['Offenbach'],
};

/**
 * The names to search a city by: what was given first, then the other known
 * spellings of that city. Cities outside the list are searched as given.
 */
export function citySearchNames(name) {
  const given = String(name || '').trim();
  const canonical = matchCity(given);
  if (!canonical) {
    return given ? [given] : [];
  }
  const names = [given, canonical, ...(OTHER_SPELLINGS[canonical] || [])];
  return names.filter((value, index) => names.findIndex((other) => normalize(other) === normalize(value)) === index);
}
