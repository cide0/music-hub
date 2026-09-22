/**
 * The cities Concert Date Fetcher keeps events for. Ticketmaster's city names
 * are matched against this list after the response comes back (one request per
 * artist rather than one per artist x city).
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
 * Returns the canonical city name for a Ticketmaster city, or null when the
 * event isn't in one of the allowed cities.
 */
export function matchCity(name) {
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
