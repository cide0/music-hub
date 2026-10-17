/**
 * Ticketmaster's `keyword` search matches substrings, so asking for "MAVI"
 * also returns "MAVIS". Every event is therefore re-checked here and only
 * kept when the followed artist's *full* name matches.
 */

/** Lowercase, strip diacritics, dots and apostrophes ("D.C." -> "dc"). */
function fold(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`´.]/g, '');
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeArtistName(value) {
  // Other punctuation becomes a separator ("AC/DC" -> "ac dc").
  return fold(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Like normalizeArtistName, but a hyphen inside a word survives ("Gražinytė-Tyla"
 * -> "grazinyte-tyla"), so the title check can tell a double name from two words.
 */
function normalizeTitle(value) {
  return fold(value)
    .replace(/([a-z0-9])-+(?=[a-z0-9])/g, '$1\n')
    .replace(/[^a-z0-9\n]+/g, ' ')
    .replace(/\n/g, '-')
    .trim();
}

/**
 * True when this event really is the artist's. Ticketmaster names the acts of
 * an event in `_embedded.attractions`, so that list is authoritative when it
 * is there; otherwise the event title has to contain the full name as whole
 * words ("Metallica: M72 Tour" matches "Metallica", "MAVIS" does not match
 * "MAVI"). A name glued to the word before it is someone else's double name
 * ("Mirga Gražinytė-Tyla" is not Tyla), while "Sido-Konzert" is still Sido's.
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

  const title = normalizeTitle(event?.name);
  if (!title) {
    return false;
  }
  // The name's own words may be joined by a space or a hyphen ("Jay-Z", "Twenty-One Pilots").
  const words = target.split(' ').map(escapeRegExp).join('[ -]');
  return new RegExp(`(^| )${words}( |-|$)`).test(title);
}
