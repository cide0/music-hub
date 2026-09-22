import { Router } from 'express';

import { eventMatchesArtist } from '../lib/artistMatch.js';
import { matchCity } from '../lib/cities.js';
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

export default router;
