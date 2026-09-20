/**
 * Ticketmaster's `keyword` search matches substrings, so asking for "MAVI"
 * also returns "MAVIS". Every event is therefore re-checked here and only
 * kept when the followed artist's *full* name matches.
 */

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeArtistName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Dots and apostrophes vanish ("D.C." -> "dc"), other punctuation becomes
    // a separator ("AC/DC" -> "ac dc").
    .replace(/['’`´.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when this event really is the artist's. Ticketmaster names the acts of
 * an event in `_embedded.attractions`, so that list is authoritative when it
 * is there; otherwise the event title has to contain the full name as whole
 * words ("Metallica: M72 Tour" matches "Metallica", "MAVIS" does not match
 * "MAVI").
 */
export function eventMatchesArtist(event, artistName) {
  const target = normalizeArtistName(artistName);
  if (!target) {
    return false;
  }

  const attractions = event?._embedded?.attractions;
  if (Array.isArray(attractions) && attractions.length) {
    return attractions.some((attraction) => normalizeArtistName(attraction?.name) === target);
  }

  const title = normalizeArtistName(event?.name);
  if (!title) {
    return false;
  }
  return new RegExp(`(^| )${escapeRegExp(target)}( |$)`).test(title);
}
