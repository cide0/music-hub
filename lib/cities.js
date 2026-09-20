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
