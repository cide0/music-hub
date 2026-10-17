import { eventMatchesArtist, normalizeArtistName } from './artistMatch.js';
import { matchCity } from './cities.js';

/**
 * Eventim's website search API (undocumented): builds the request and turns
 * its answer into the same show shape the Ticketmaster events end up in. No
 * network code lives here - routes/api.js does the fetching.
 */

const SEARCH_URL = 'https://public-api.eventim.com/websearch/search/api/exploration/v1/products';

// `Recommendation` puts the products that really belong to the search word
// first. The API ignores `page` (every page repeats page 1), so only the first
// 50 products can ever be read, and `DateAsc` would fill them with namesakes
// and loosely matching products before the artist's own shows.
const SORT = 'Recommendation';

/** The search request for one artist (and one page, which Eventim ignores). */
export function buildSearchUrl(artist, page = 1) {
  const params = new URLSearchParams({
    webId: 'web__eventim-de',
    language: 'de',
    retail_partner: 'EVE',
    search_term: artist,
    sort: SORT,
    top: '50',
    page: String(page),
  });
  return `${SEARCH_URL}?${params}`;
}

// Eventim's `status` is Available, SoldOut or Cancelled; anything with
// "cancel" in it is dropped, the rest (sold out, not on sale yet) stays.
function isCancelled(status) {
  return /cancel/i.test(String(status || ''));
}

/** "2027-09-21T20:00:00+02:00" -> { localDate, localTime }; the time may be missing. */
function splitStartDate(startDate) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?)?/.exec(String(startDate || ''));
  if (!match) {
    return null;
  }
  return { localDate: match[1], localTime: match[2] ? `${match[2]}:${match[3] || '00'}` : null };
}

/** "... NFC-ALBUM | im Artistshop" -> "... NFC-ALBUM" */
function tidyName(name) {
  return String(name || '').split('|')[0].trim();
}

/**
 * The artist's upcoming shows in the allowed cities out of one answer's
 * `products`. Cancelled products, other cities and products of other acts
 * (a search for "MAVI" also finds "MAVIS") are dropped.
 */
export function toShows(products, artist) {
  const shows = [];
  for (const product of Array.isArray(products) ? products : []) {
    if (product?.type !== 'LiveEntertainment' || isCancelled(product.status)) {
      continue;
    }
    // Without its id a show can't be told apart or linked to again.
    if (product.productId == null || product.productId === '') {
      continue;
    }
    const live = product.typeAttributes?.liveEntertainment;
    const when = splitStartDate(live?.startDate);
    if (!when) {
      continue;
    }

    const attractionNames = (Array.isArray(product.attractions) ? product.attractions : [])
      .map((attraction) => String(attraction?.name || '').trim())
      .filter(Boolean);
    const asEvent = {
      name: product.name,
      _embedded: { attractions: attractionNames.map((name) => ({ name })) },
    };
    if (!eventMatchesArtist(asEvent, artist)) {
      continue;
    }

    const city = matchCity(live.location?.city);
    if (!city) {
      continue;
    }

    shows.push({
      eventimId: String(product.productId),
      productGroupId: product.productGroupId == null ? null : String(product.productGroupId),
      eventName: tidyName(product.name),
      localDate: when.localDate,
      localTime: when.localTime,
      dateTime: live.startDate,
      venueName: live.location?.name || null,
      city,
      // Only a plain https link ever becomes a ticket link on the page.
      eventimUrl: /^https:\/\//.test(String(product.link || '')) ? product.link : null,
      imageUrl: null,
      attractionNames,
    });
  }
  return shows;
}

// Wording of the products Eventim sells besides the plain ticket.
const ADD_ON = /\b(vip|premium|lounge|loge|komfort|upgrade|paket|package|arrangement|hotel|meet\s*&\s*greet|backstage|suite)/i;

/**
 * VIP packages, lounge and comfort tickets are products of their own on the
 * same date and venue. They are folded into one show per date + city + venue: the
 * one without add-on wording (the shortest name on a tie), marked
 * `hasVariants: true` when its group had more than one product.
 */
export function collapseVariants(shows) {
  const groups = new Map();
  for (const show of shows) {
    const key = `${show.localDate}|${show.city}|${normalizeArtistName(show.venueName)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(show);
  }

  const result = [];
  for (const group of groups.values()) {
    const plain = group.filter((show) => !ADD_ON.test(show.eventName));
    const pool = plain.length ? plain : group;
    const representative = pool.reduce((best, show) => (show.eventName.length < best.eventName.length ? show : best));
    result.push({ ...representative, hasVariants: group.length > 1 });
  }
  return result.sort((a, b) => `${a.localDate}${a.localTime || ''}`.localeCompare(`${b.localDate}${b.localTime || ''}`));
}
