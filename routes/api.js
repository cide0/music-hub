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
const SETLISTFM_PAGE_DELAY_MS = 550;

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

async function fetchSetlistPage(params, page) {
  const response = await fetch(`${SETLISTFM_URL}?${params.toString()}&p=${page}`, {
    headers: {
      'x-api-key': requireEnv('SETLISTFM_API_KEY'),
      Accept: 'application/json',
    },
  });
  // setlist.fm answers "no results" with a 404 rather than an empty list.
  if (response.status === 404) {
    return { setlist: [], total: 0, itemsPerPage: 20 };
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
    if (page > 1) {
      await wait(SETLISTFM_PAGE_DELAY_MS);
    }
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
    for (const [index, cityName] of cityNames.entries()) {
      if (index > 0) {
        await wait(SETLISTFM_PAGE_DELAY_MS);
      }
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

export default router;
