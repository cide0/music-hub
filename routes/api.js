import { Router } from 'express';

import { eventMatchesArtist } from '../lib/artistMatch.js';
import { citySearchNames, matchCity } from '../lib/cities.js';
import { requireEnv } from '../lib/oauth.js';

const router = Router();

const TICKETMASTER_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';
const LASTFM_URL = 'https://ws.audioscrobbler.com/2.0/';

/** Ticketmaster returns several sizes; take a reasonably large 16:9 one. */
function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return null;
  }
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  const wide = sorted.find((image) => image.ratio === '16_9' && (image.width || 0) <= 1200);
  return (wide || sorted[0]).url || null;
}

function parseEvent(event, city) {
  const venue = event._embedded?.venues?.[0];
  const start = event.dates?.start || {};

  // Without a date there is nothing to show, sort or deduplicate by.
  if (!start.localDate) {
    return null;
  }

  return {
    ticketmasterId: event.id,
    eventName: event.name || '',
    imageUrl: pickImage(event.images),
    localDate: start.localDate,
    localTime: start.localTime || null,
    dateTime: start.dateTime || null,
    venueName: venue?.name || '',
    city,
    ticketUrl: event.url || null,
    attractionNames: (event._embedded?.attractions || []).map((a) => a?.name).filter(Boolean),
  };
}

/**
 * Proxies the Ticketmaster Discovery API so the API key stays server-side,
 * and filters the response down to the allowed cities.
 */
router.get('/api/concerts', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  if (!artist) {
    res.status(400).json({ error: 'artist is required' });
    return;
  }

  try {
    const params = new URLSearchParams({
      keyword: artist,
      countryCode: 'DE',
      sort: 'date,asc',
      size: '50',
      apikey: requireEnv('TICKETMASTER_API_KEY'),
    });

    const response = await fetch(`${TICKETMASTER_URL}?${params.toString()}`);
    if (!response.ok) {
      const detail = await response.text();
      res.status(response.status === 429 ? 429 : 502).json({
        error: `Ticketmaster request failed (${response.status})`,
        detail: detail.slice(0, 200),
      });
      return;
    }

    const data = await response.json();
    const events = [];
    for (const event of data._embedded?.events || []) {
      // Ticketmaster matches substrings, so drop anything that isn't really
      // this artist (e.g. "MAVIS" when the followed artist is "MAVI").
      if (!eventMatchesArtist(event, artist)) {
        continue;
      }

      const city = matchCity(event._embedded?.venues?.[0]?.city?.name);
      if (!city) {
        continue;
      }
      const parsed = parseEvent(event, city);
      if (parsed) {
        events.push(parsed);
      }
    }

    res.json({ artist, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Proxies Last.fm's artist.getsimilar so the API key stays server-side.
 * (Spotify removed its own related-artists endpoint for new apps in 2024,
 * which is why the similarity data comes from Last.fm.)
 */
router.get('/api/similar-artists', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  if (!artist) {
    res.status(400).json({ error: 'artist is required' });
    return;
  }

  try {
    const params = new URLSearchParams({
      method: 'artist.getsimilar',
      artist,
      api_key: requireEnv('LASTFM_API_KEY'),
      format: 'json',
      limit: '30',
    });

    const response = await fetch(`${LASTFM_URL}?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || data.error) {
      // Last.fm reports its own errors in the body, often with status 200.
      res.status(response.status === 200 ? 502 : response.status).json({
        error: data.message || `Last.fm request failed (${response.status})`,
      });
      return;
    }

    const similar = (data.similarartists?.artist || [])
      .map((entry) => entry?.name)
      .filter(Boolean);

    res.json({ artist, similar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
 * Last.fm's tags stand in for genres: Spotify's own genre data is empty on the
 * followed-artists response and its batch /artists endpoint answers 403 for
 * this app. Tags are user-generated, so the obvious non-genre ones are
 * filtered out and only reasonably agreed-on tags are kept.
 */
const TAG_BLOCKLIST = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'my favorites',
  'albums i own', 'vinyl', 'awesome', 'cool', 'love', 'beautiful', 'great',
  'amazing', 'best', 'loved', 'music', 'check out', 'spotify', 'under 2000 listeners',
  'all', 'live', 'concert', 'male vocalists', 'female vocalists', 'male vocalist',
  'female vocalist', 'singer-songwriter-ish', 'favorite artists',
]);

// Last.fm weighs each tag 0-100 for the artist. Low enough that smaller
// artists, whose tags all score weakly, still get a genre.
const MIN_TAG_COUNT = 5;
const MAX_TAGS = 5;

router.get('/api/artist-tags', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  if (!artist) {
    res.status(400).json({ error: 'artist is required' });
    return;
  }

  try {
    const params = new URLSearchParams({
      method: 'artist.gettoptags',
      artist,
      api_key: requireEnv('LASTFM_API_KEY'),
      format: 'json',
      autocorrect: '1',
    });

    const response = await fetch(`${LASTFM_URL}?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || data.error) {
      res.status(response.status === 200 ? 502 : response.status).json({
        error: data.message || `Last.fm request failed (${response.status})`,
      });
      return;
    }

    const usable = (data.toptags?.tag || [])
      .map((tag) => ({
        name: String(tag?.name || '').trim().toLowerCase(),
        count: Number(tag?.count) || 0,
      }))
      .filter((tag) => tag.name && !TAG_BLOCKLIST.has(tag.name));

    let tags = usable.filter((tag) => tag.count >= MIN_TAG_COUNT);
    // Nothing clears the bar: the strongest remaining tag beats no genre.
    if (!tags.length && usable.length) {
      tags = usable.slice(0, 1);
    }
    tags = tags.slice(0, MAX_TAGS).map((tag) => tag.name);

    res.json({ artist, tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SETLISTFM_URL = 'https://api.setlist.fm/rest/1.0/search/setlists';
// setlist.fm pages by 20 and usually (not reliably) answers newest first, so a
// few pages are read and sorted here. Enough to get past placeholder entries
// without spending much of the 2 requests/second budget.
const SETLISTFM_MAX_PAGES = 3;
// setlist.fm allows 2 requests a second. Every request this server makes -
// whichever search or page it's for - takes the next free slot on one shared
// clock: the page's follow-up search (the artist's shows anywhere, when the
// city's newest setlist is empty) arrives the moment the first one answers,
// so gaps inside a single search aren't enough. The gap also counts from when
// the previous answer came back, not just from when it was sent - a slow
// request can reach setlist.fm late and leave the next one right behind it.
// Cached answers (setlist.fm caches each query for 60s) don't count.
const SETLISTFM_REQUEST_INTERVAL_MS = 550;
// setlist.fm's throttling is looser than that on some runs and stricter on
// others - a request well over a second after the last one can still get a
// 429. Nothing was served then, so it's retried, each time after a longer
// pause (1.5s, then 3s).
const SETLISTFM_MAX_RETRIES = 2;
const SETLISTFM_RATE_LIMITED_PAUSE_MS = 1500;

let setlistfmNextSlotAt = 0;

/** Waits for, and takes, the next free setlist.fm request slot. */
async function waitForSetlistfmSlot() {
  const now = Date.now();
  const startAt = Math.max(now, setlistfmNextSlotAt);
  setlistfmNextSlotAt = startAt + SETLISTFM_REQUEST_INTERVAL_MS;
  if (startAt > now) {
    await wait(startAt - now);
  }
}

function sameName(a, b) {
  const fold = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return fold(a) === fold(b);
}

/** setlist.fm dates come as dd-MM-yyyy; ISO sorts and compares as plain text. */
function isoDate(eventDate) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(eventDate || ''));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/**
 * Every set (encores included) flattened into one ordered song list.
 * Nameless entries are unknown songs and can't go on a playlist. Tapes
 * (intros/outros played from a recording) stay in, flagged so the page can
 * label them.
 */
function flattenSongs(setlist) {
  const songs = [];
  for (const set of setlist.sets?.set || []) {
    for (const song of set.song || []) {
      const name = String(song?.name || '').trim();
      if (!name) {
        continue;
      }
      songs.push({ name, coverOf: song.cover?.name || null, tape: Boolean(song.tape) });
    }
  }
  return songs;
}

function parseSetlist(setlist) {
  const venue = setlist.venue || {};
  return {
    id: setlist.id,
    eventDate: isoDate(setlist.eventDate),
    url: setlist.url || null,
    artistName: setlist.artist?.name || '',
    artistUrl: setlist.artist?.url || null,
    venueName: venue.name || '',
    city: venue.city?.name || '',
    // The same city as Concert Date Fetcher names it (null outside its
    // list), so the page can match this show to a stored concert.
    knownCity: matchCity(venue.city?.name),
    country: venue.city?.country?.name || '',
    songs: flattenSongs(setlist),
  };
}

async function fetchSetlistPage(params, page, attempt = 0) {
  await waitForSetlistfmSlot();
  const response = await fetch(`${SETLISTFM_URL}?${params.toString()}&p=${page}`, {
    headers: {
      'x-api-key': requireEnv('SETLISTFM_API_KEY'),
      Accept: 'application/json',
    },
  });
  setlistfmNextSlotAt = Math.max(setlistfmNextSlotAt, Date.now() + SETLISTFM_REQUEST_INTERVAL_MS);
  // setlist.fm answers "no results" with a 404 rather than an empty list.
  if (response.status === 404) {
    return { setlist: [], total: 0, itemsPerPage: 20 };
  }
  if (response.status === 429 && attempt < SETLISTFM_MAX_RETRIES) {
    const pause = SETLISTFM_RATE_LIMITED_PAUSE_MS * (attempt + 1);
    setlistfmNextSlotAt = Math.max(setlistfmNextSlotAt, Date.now() + pause);
    return fetchSetlistPage(params, page, attempt + 1);
  }
  if (!response.ok) {
    const error = new Error(`setlist.fm request failed (${response.status})`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  return response.json();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Up to SETLISTFM_MAX_PAGES pages of raw setlist.fm results. */
async function searchSetlists(artist, cityName) {
  const params = new URLSearchParams({ artistName: artist });
  if (cityName) {
    params.set('cityName', cityName);
  }

  const results = [];
  for (let page = 1; page <= SETLISTFM_MAX_PAGES; page++) {
    const data = await fetchSetlistPage(params, page);
    results.push(...(data.setlist || []));
    if (page * (data.itemsPerPage || 20) >= (data.total || 0)) {
      break;
    }
  }
  return results;
}

/**
 * Proxies setlist.fm's setlist search so the API key stays server-side.
 * `city` is optional: without it, it's the artist's shows anywhere.
 */
router.get('/api/setlists', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const city = String(req.query.city || '').trim();
  if (!artist) {
    res.status(400).json({ error: 'artist is required' });
    return;
  }

  try {
    // Ticketmaster (and so Concert Date Fetcher) says "Köln" where
    // setlist.fm may say "Cologne": try the other spellings on a miss.
    const cityNames = city ? citySearchNames(city) : [null];
    let results = [];
    for (const cityName of cityNames) {
      results = await searchSetlists(artist, cityName);
      if (results.length) {
        break;
      }
    }

    let setlists = results.map(parseSetlist).filter((setlist) => setlist.eventDate);
    // The artist search is fuzzy ("Muse" also finds tribute acts), so keep
    // only the exact artist whenever it's among the results.
    const exact = setlists.filter((setlist) => sameName(setlist.artistName, artist));
    if (exact.length) {
      setlists = exact;
    }
    setlists.sort((a, b) => (a.eventDate < b.eventDate ? 1 : a.eventDate > b.eventDate ? -1 : 0));

    res.json({ artist, city: city || null, setlists });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

const DISCOGS_URL = 'https://api.discogs.com';
// Discogs rejects requests without a descriptive User-Agent.
const DISCOGS_USER_AGENT = 'MusicHub/1.0 +https://music-hub-r9w6.onrender.com';
// Discogs allows 60 authenticated requests in any 60 seconds. Every request
// this server makes - whichever page or artist it's for - takes the next free
// slot on one shared clock, spaced from when requests *start*, so the time
// Discogs takes to answer doesn't add to the gap. Slightly over a second
// leaves a little room in Discogs's moving window.
const DISCOGS_REQUEST_INTERVAL_MS = 1050;
// When Discogs's own count says the window is (nearly) used up, the next
// request waits a little longer; after a 429, a lot longer.
const DISCOGS_LOW_REMAINING = 1;
const DISCOGS_LOW_REMAINING_PAUSE_MS = 2000;
const DISCOGS_RATE_LIMITED_PAUSE_MS = 10000;
const DISCOGS_SEARCH_PAGE_SIZE = 100;
// Newest-year-first, so a few pages always reach back past the cutoff year;
// this only caps artists with an unusually large current-year catalog.
const DISCOGS_MAX_SEARCH_PAGES = 5;
const DISCOGS_COLLECTION_PAGE_SIZE = 50;

let discogsNextSlotAt = 0;

function pushBackDiscogsSlot(ms) {
  discogsNextSlotAt = Math.max(discogsNextSlotAt, Date.now() + ms);
}

/** Waits for, and takes, the next free request slot. */
async function waitForDiscogsSlot() {
  const now = Date.now();
  const startAt = Math.max(now, discogsNextSlotAt);
  discogsNextSlotAt = startAt + DISCOGS_REQUEST_INTERVAL_MS;
  if (startAt > now) {
    await wait(startAt - now);
  }
}

async function discogsJson(pathAndQuery, signal) {
  await waitForDiscogsSlot();
  if (signal?.aborted) {
    throw new Error('aborted');
  }
  const response = await fetch(`${DISCOGS_URL}${pathAndQuery}`, {
    headers: {
      Authorization: `Discogs token=${requireEnv('DISCOGS_TOKEN')}`,
      'User-Agent': DISCOGS_USER_AGENT,
      Accept: 'application/json',
    },
    signal,
  });

  const remaining = Number(response.headers.get('x-discogs-ratelimit-remaining'));
  if (response.status === 429) {
    pushBackDiscogsSlot(DISCOGS_RATE_LIMITED_PAUSE_MS);
  } else if (response.headers.has('x-discogs-ratelimit-remaining') && remaining <= DISCOGS_LOW_REMAINING) {
    pushBackDiscogsSlot(DISCOGS_LOW_REMAINING_PAUSE_MS);
  }

  if (!response.ok) {
    const error = new Error(`Discogs request failed (${response.status})`);
    error.status = response.status === 429 ? 429 : 502;
    error.upstreamStatus = response.status;
    throw error;
  }
  return response.json();
}

/** Discogs tells same-named artists apart as "Name (2)" and marks name variations with "*". */
function cleanDiscogsName(name) {
  return String(name || '').replace(/\s+\(\d+\)$/, '').replace(/\*$/, '').trim();
}

/** "Artist A & Artist B", from a release's credited artists and their join words. */
function joinDiscogsArtists(artists) {
  return (artists || []).map((artist, index, list) => {
    const name = cleanDiscogsName(artist.name);
    const join = String(artist.join || '').trim();
    if (index === list.length - 1) {
      return name;
    }
    return join === ',' ? `${name}, ` : `${name} ${join || '&'} `;
  }).join('');
}

/** Folded for comparison, with a leading or Discogs-style trailing "The" dropped. */
function foldArtistName(value) {
  return cleanDiscogsName(value)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/,\s*the$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Whether a search result's credit text may include the followed artist - a
 * cheap first pass before spending a detail request on it. Discogs's artist
 * search is loose ("Low" also finds "Low Roar"). Collaborations are split on
 * the usual joiners, and the whole credit is tried too so acts like
 * "Simon & Garfunkel" match; the release detail's artist list settles it.
 */
function creditMatchesArtist(credit, artist) {
  const wanted = foldArtistName(artist);
  if (!wanted) {
    return false;
  }
  const parts = [credit, ...String(credit).split(/\s*(?:,|&|\+|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bvs\.?|\band\b|\bwith\b|\bx\b)\s*/i)];
  return parts.some((part) => foldArtistName(part) === wanted);
}

/**
 * A release's formats the way Discogs writes them, e.g. "Vinyl, LP, Album,
 * Limited Edition, Red Translucent". The colour / variant ("Red Translucent")
 * is the format's free-text part, which only the release detail carries -
 * the search results leave it out.
 */
function describeFormats(formats) {
  return (formats || []).map((format) => {
    const qty = Number(format.qty) || 1;
    const name = qty > 1 ? `${qty} × ${format.name}` : format.name;
    return [name, ...(format.descriptions || []), format.text]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(', ');
  }).filter(Boolean).join(' + ');
}

/**
 * A release's `released` field as 'YYYY-MM-DD', or 'YYYY-MM' when Discogs
 * only knows the month (it writes the unknown day as "00"). Year-only and
 * missing dates give null: there's no telling whether those are new.
 */
function parseReleased(released) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(released || ''));
  if (!match || match[2] === '00') {
    return null;
  }
  return match[3] && match[3] !== '00'
    ? `${match[1]}-${match[2]}-${match[3]}`
    : `${match[1]}-${match[2]}`;
}

/**
 * Compared at the release date's own precision, so a month-only date counts
 * as long as its month reaches the cutoff's.
 */
function releasedSince(released, cutoffDay) {
  return released >= cutoffDay.slice(0, released.length);
}

/**
 * Proxies Discogs's database search + release details so the token stays
 * server-side: every vinyl release (bootlegs included) credited to `artist`
 * whose exact release date is on or after `since` (the start of the page's
 * look-back window; which of these are new is the page's call). Search
 * results only carry a year, so each candidate from the cutoff year on needs
 * its detail fetched for the date - which is why other formats are dropped
 * at the search stage already.
 *
 * `skip` lists release ids (comma-separated) the page already checked for
 * this artist on an earlier run - shown, or ruled out - so they don't cost a
 * detail request again. The ones ruled out this time come back in `rejected`
 * (id -> release date, or the search year when the detail named other
 * artists), for the page to add to its list. Releases Discogs only dates
 * by year come back in `undated`: the page skips those for a while, then has
 * them looked at again in case a full date has been added since.
 */
router.get('/api/discogs/releases', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const since = String(req.query.since || '').trim();
  if (!artist || !/^\d{4}-\d{2}-\d{2}/.test(since)) {
    res.status(400).json({ error: 'artist and since (an ISO date) are required' });
    return;
  }

  const cutoffDay = since.slice(0, 10);
  const cutoffYear = Number(cutoffDay.slice(0, 4));
  const skip = new Set(String(req.query.skip || '').split(',').filter((id) => /^\d+$/.test(id)));

  // The page cancelled its check: stop spending the rate limit on it.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const candidates = [];
    const seen = new Set();
    for (let page = 1; page <= DISCOGS_MAX_SEARCH_PAGES; page++) {
      const params = new URLSearchParams({
        type: 'release',
        format: 'Vinyl',
        artist,
        sort: 'year',
        sort_order: 'desc',
        per_page: String(DISCOGS_SEARCH_PAGE_SIZE),
        page: String(page),
      });
      const data = await discogsJson(`/database/search?${params.toString()}`, controller.signal);
      const results = data.results || [];

      let reachedOlder = false;
      for (const result of results) {
        const year = Number(result.year);
        if (!year) {
          continue;
        }
        if (year < cutoffYear) {
          reachedOlder = true;
          continue;
        }
        // Search titles read "Artist - Title".
        const credit = String(result.title || '').split(' - ')[0];
        if (seen.has(result.id) || skip.has(String(result.id)) || !creditMatchesArtist(credit, artist)) {
          continue;
        }
        seen.add(result.id);
        candidates.push(result);
      }

      if (reachedOlder || !results.length || page >= (data.pagination?.pages || 0)) {
        break;
      }
    }

    const releases = [];
    const rejected = {};
    const undated = [];
    for (const candidate of candidates) {
      const detail = await discogsJson(`/releases/${encodeURIComponent(candidate.id)}`, controller.signal);
      const releasedDate = parseReleased(detail.released);
      if (!releasedDate) {
        undated.push(String(candidate.id));
        continue;
      }
      // The search title only told us the credit text; the detail names the
      // actual artists, so the duo "Fresh & Low" doesn't count for "Low".
      if (detail.artists?.length && !detail.artists.some((credited) => foldArtistName(credited.name) === foldArtistName(artist))) {
        rejected[candidate.id] = String(candidate.year);
        continue;
      }
      if (!releasedSince(releasedDate, cutoffDay)) {
        rejected[candidate.id] = releasedDate;
        continue;
      }
      const [creditTitle, ...titleParts] = String(candidate.title || '').split(' - ');
      releases.push({
        id: String(detail.id || candidate.id),
        title: detail.title || titleParts.join(' - ') || creditTitle,
        artist: joinDiscogsArtists(detail.artists) || cleanDiscogsName(creditTitle),
        imageUrl: candidate.cover_image || candidate.thumb || null,
        releaseUrl: detail.uri || `https://www.discogs.com/release/${candidate.id}`,
        releasedDate,
        // Several pressings of one album are separate releases on Discogs,
        // so the format - colour included - tells their cards apart.
        format: describeFormats(detail.formats)
          || (Array.isArray(candidate.format) ? [...new Set(candidate.format)].join(', ') : ''),
      });
    }

    res.json({ artist, since: cutoffDay, releases, rejected, undated });
  } catch (err) {
    if (controller.signal.aborted) {
      return;
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * One random item from `username`'s Discogs collection (the one saved on the
 * Settings page), without downloading all of it: a one-item page just to read
 * the total, then the single page of DISCOGS_COLLECTION_PAGE_SIZE that holds
 * the randomly picked position. The request goes out with this app's token,
 * so another user's collection is only readable if they've made it public.
 */
router.get('/api/discogs/random-collection-item', async (req, res) => {
  const username = String(req.query.username || '').trim();
  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }
  const collectionPath = `/users/${encodeURIComponent(username)}/collection/folders/0/releases`;

  try {
    const first = await discogsJson(`${collectionPath}?per_page=1&page=1`);
    const total = Number(first.pagination?.items) || 0;
    if (!total) {
      res.json({ item: null });
      return;
    }

    const index = Math.floor(Math.random() * total);
    const page = Math.floor(index / DISCOGS_COLLECTION_PAGE_SIZE) + 1;
    const data = await discogsJson(
      `${collectionPath}?per_page=${DISCOGS_COLLECTION_PAGE_SIZE}&page=${page}`,
    );
    const releases = data.releases || [];
    const entry = releases[index % DISCOGS_COLLECTION_PAGE_SIZE] || releases[releases.length - 1];
    if (!entry) {
      res.json({ item: null });
      return;
    }

    const info = entry.basic_information || {};
    const id = info.id || entry.id;
    res.json({
      item: {
        id: String(id),
        title: info.title || '',
        artist: joinDiscogsArtists(info.artists),
        imageUrl: info.cover_image || info.thumb || null,
        year: Number(info.year) || null,
        url: `https://www.discogs.com/release/${id}`,
      },
    });
  } catch (err) {
    // "No such user" and "collection not public" get their own answers, so
    // the page can say which one it is.
    if (err.upstreamStatus === 404) {
      res.status(404).json({ error: 'unknown Discogs user' });
      return;
    }
    if (err.upstreamStatus === 401 || err.upstreamStatus === 403) {
      res.status(403).json({ error: 'collection is private' });
      return;
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
