import { normalizeArtistName } from './artistMatch.js';
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
 *
 * A product only counts when Eventim bills the artist by name in its
 * `attractions`. The title is never enough: products without attractions
 * are tributes ("The Elvis Presley Roadshow", "Hamburg Art Ensemble - plays
 * Billie Eilish"), namesakes ("Eva zu Beck", "Bruno Günna Knust") and the
 * like - never the artist's own show - and tribute acts are billed under
 * their own name ("Metakilla - Metallica Coverband").
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
    const target = normalizeArtistName(artist);
    if (!target || !attractionNames.some((name) => normalizeArtistName(name) === target)) {
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

/** Newer products have higher ids; ids that aren't numbers count as oldest. */
function productAge(show) {
  const id = Number(show.eventimId);
  return Number.isFinite(id) ? id : -Infinity;
}

/**
 * VIP packages, lounge and comfort tickets are products of their own on the
 * same date and venue. Eventim can also list one show twice under two venue
 * names (a show moved to another venue keeps its old product). So products
 * of the artist on the same date in the same city are one show when they
 * share the start time or the venue. Its representative is the one without
 * add-on wording, then the shortest name, then the newest product (the moved
 * show's), marked `hasVariants: true` when its group had products of more
 * than one name.
 */
export function collapseVariants(shows) {
  const groups = [];
  for (const show of shows) {
    const venue = normalizeArtistName(show.venueName);
    const group = groups.find((other) => other.some((member) => member.localDate === show.localDate
      && member.city === show.city
      && ((member.localTime || '') === (show.localTime || '') || normalizeArtistName(member.venueName) === venue)));
    if (group) {
      group.push(show);
    } else {
      groups.push([show]);
    }
  }

  const result = [];
  for (const group of groups) {
    const plain = group.filter((show) => !ADD_ON.test(show.eventName));
    const pool = plain.length ? plain : group;
    const representative = pool.reduce((best, show) => {
      const byLength = show.eventName.length - best.eventName.length;
      return byLength < 0 || (byLength === 0 && productAge(show) > productAge(best)) ? show : best;
    });
    const names = new Set(group.map((show) => normalizeArtistName(show.eventName)));
    result.push({ ...representative, hasVariants: names.size > 1 });
  }
  return result.sort((a, b) => `${a.localDate}${a.localTime || ''}`.localeCompare(`${b.localDate}${b.localTime || ''}`));
}
