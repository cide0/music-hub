import { Router } from 'express';

import { eventMatchesArtist } from '../lib/artistMatch.js';
import { matchCity } from '../lib/cities.js';
import { requireEnv } from '../lib/oauth.js';

const router = Router();

const TICKETMASTER_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

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

export default router;
