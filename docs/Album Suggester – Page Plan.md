# Album Suggester – Page Plan

Sep 23, 2026 · @Elias

Standalone plan for a new **Album Suggester** page, part of the Doc app.

## Overview

A page where the user "cases" a random album out of their Spotify library (Saved Albums), CS:GO-case-opening style, then listens, marks it listened or not, and can find that album's vinyl releases on Discogs.

## Album Suggester

Route: `/album-suggester`.

**Library source:** the page's "library" is simply the user's Spotify **Saved Albums** ("Your Library" on Spotify) — fetched directly from the frontend with the stored access token via `GET https://api.spotify.com/v1/me/albums?limit=50`, paginating via the response's `next` URL until every saved album is collected. There's no separate library-management UI on this page — the user adds/removes albums the normal way, from Spotify itself (or the Spotify app), and this page always reflects Spotify's current Saved Albums as the pool of albums available to be "cased." If an album has no cover art at all (Spotify's images array is occasionally empty, the same issue Followed Artists Graph handles for artist photos), it falls back to a plain accent-colored square instead of a broken image — everywhere a cover is shown on this page: the reel, the big reveal, and the listened-history thumbnails.

**Initial state:** on page load (subject to the usual page-level Spotify-login gating), the app fetches the full Saved Albums list fresh — a single paginated call, cheap enough not to need `localStorage` caching. If the user has no saved albums at all, show "Your Spotify library has no saved albums yet." instead of the case UI. Otherwise, show the current library count (e.g. "42 albums in your library") and a big "Open case" button. If the initial fetch itself fails (network or auth error, as opposed to a genuinely empty result), show an inline error message with a "Retry" button instead, rather than treating it as an empty library.

**Case-opening flow, triggered by the "Open case" button:**

1. The button is disabled while a case is open/animating, preventing a second spin from starting concurrently.
2. Build a horizontal reel: a long strip of album cover images, built by repeating/shuffling the current library pool enough times (roughly 40–60 covers total, regardless of how few or many distinct albums are in the pool) that the strip is long enough to scroll smoothly — a CS:GO-style case-opening reel. Each cover gets a small accent-purple bar along its bottom edge (`#7407B0`, the app's primary accent) — visually echoing the rarity-color bar CS:GO shows under each item in its case reel, though here it's purely decorative and identical on every cover, since there are no rarity tiers (per step 3). Reel width and cover size scale down on narrow (mobile) viewports, per the app's usual responsive rule, rather than forcing horizontal page scroll.
3. Before the reel starts scrolling, the winning album is already decided: a **uniform random index** into the current library pool (plain `Math.random()`, no backend call needed). Unlike CS:GO's rarity tiers, every album in the library has **exactly equal odds** of being picked — there is no rarity system here.
4. The reel scrolls fast at first — with a slight horizontal motion blur — and decelerates using an easing curve that mirrors CS:GO's own case-opening motion as closely as possible (quick at the start, a long slow crawl over the final few covers), ending centered on the pre-decided winning album under a fixed marker. The sound effect follows the same shape as CS:GO's case-opening audio as closely as possible without reusing it: a rising whoosh as the reel starts scrolling, a soft tick timed to each cover passing the marker as the reel slows, and a bright "reveal" chime the instant it stops on the winning album — bundled as a royalty-free static asset (e.g. `public/audio/case-open.mp3`), not CS:GO's actual proprietary audio, which isn't licensable for this project. Since playback is triggered directly by the user's "Open case"/"Re-roll" click, it's a user gesture and isn't subject to browser autoplay-blocking.
5. Right as the reel comes to rest, a brief celebratory flourish plays before the big reveal appears: a short burst of purple-tinted particles/confetti radiates out from the winning cover, a soft screen-wide pulse of purple light flashes once, and the winning cover scales up slightly with a spring/bounce easing. This wraps up in under a second — enough to feel like a payoff without meaningfully delaying the reveal — and reuses the app's existing accent purple (`#7407B0`) rather than introducing new colors. It plays at this same full intensity every single time the reel settles, including every re-roll — there's no toned-down repeat version. If the browser's `prefers-reduced-motion` setting is on, this flourish (the light pulse and particle burst specifically) is skipped entirely, and the reel-scroll animation in step 4 also drops its motion blur and runs a simple, shorter, linear scroll to the winning cover instead of the eased CS:GO-style deceleration — the winning album and reveal still land the same, just without the extra motion.
6. Once the flourish above finishes — roughly 4–7 seconds total from the initial click, combining the reel scroll (step 4) and the brief flourish (step 5) — the animation area is replaced by a **big reveal**: the winning album's cover art large and centered, album title, artist name, a **"Listen on Spotify"** link that opens the album directly in the **Spotify app** rather than the browser, via the `spotify:album:<id>` URI scheme (built from the album's Spotify id) — the same approach Followed Artists Graph uses for artist nodes; if the Spotify app isn't installed, the browser's own fallback handling applies (typically a prompt to install it, or nothing happens) — and a **"Find vinyl on Discogs"** link.

**Discogs link:** a plain constructed search-results link — `https://www.discogs.com/search/?q=<artist> <album title>&type=release&format=Vinyl`, both URL-encoded and joined with a space (e.g. for "Radiohead" / "OK Computer": https://www.discogs.com/search/?q=Radiohead%20OK%20Computer&type=release&format=Vinyl) — no Discogs API call needed. Opens in a new tab, to Discogs' search results for every vinyl release of that album, so the user can pick a specific release and add it to their Discogs want list themselves.

**Resolving the reveal — three actions:**

- **"Re-roll"** — runs the case-opening animation again immediately (step 2 onward), drawing a fresh uniform-random pick from the current library pool, excluding the album that was just revealed so a re-roll can't immediately land on the same one again. If the library only has that one album left, no re-roll is offered — only "Mark as listened" or "Mark as not listened."
- **"Mark as not listened"** — dismisses the reveal and returns to the "Open case" button; the album stays untouched in the Spotify library/pool for a future spin.
- **"Mark as listened"** — asks for confirmation first, since it unsaves the album from the user's real Spotify library (not just this page's own data). The confirmation step includes an optional **rating** field — an integer from 1 to 100 — the user can fill in or leave blank; a rating is never required to mark something listened. Once confirmed, calls Spotify's `DELETE https://api.spotify.com/v1/me/albums?ids=<id>` to unsave the album. On success, it disappears from Saved Albums (and therefore from this page's case pool on the next fetch); the app removes it from the in-memory pool immediately (so an instant re-roll can't pick it again), appends it to the listened history along with the given rating, if any (see Persistence below), and returns to the "Open case" button — or, if that was the last album in the pool, to the "library exhausted" empty state described below. On failure (network/auth error), show an inline error instead — the album is left exactly as it was, not marked listened and not removed from the pool, so the user can retry (the entered rating, if any, is kept in the confirmation dialog for the retry).

**Library exhausted:** once the last album has been marked listened and the pool is empty, the page shows the same "Your Spotify library has no saved albums yet."-style empty state as the initial no-saved-albums case (no case UI, no button) — the listened history section below it still shows everything the user has gone through. There's no manual "Refresh library" control; the pool only refreshes on the next full page load.

**Persistence:** the library pool itself is never cached in `localStorage` — it's always the user's current Spotify Saved Albums, fetched fresh on page load. The **listened history**, however, is user-generated (Spotify has no "listened" concept of its own), so it's the source of truth, kept in `localStorage` under an `albumSuggesterHistory` key:

```
{
  listened: [
    {
      spotifyAlbumId: "...",
      albumName: "...",
      artistName: "...",
      imageUrl: "...",
      spotifyUrl: "...",
      listenedAt: "2026-09-23T10:00:00Z",
      rating: 87 // or null if the user left it unrated
    }
  ]
}
```

Below the case UI, a **"Listened history"** section lists these entries (cover thumbnail, title, artist, listened date, and the rating if one was given — shown as "unrated" otherwise), newest-listened first by default. Two **sort controls** let the user reorder the list, mutually exclusive (only one is active at a time — picking one deactivates the other, there's no combined/secondary sort): by listened date (newest/oldest first) or by **rating** (highest/lowest first, with unrated entries always sorting after every rated one, regardless of direction) — since the album itself is gone from Spotify's Saved Albums by that point, this list is its only remaining record inside Music Hub. There's no delete control on individual entries for now — it's a simple, append-only record. A rating, once given at "Mark as listened" time, can't be edited afterward from this history list — rating only happens at that one moment.

**Backend:** none needed — this page is entirely client-side, reusing the same Spotify access-token pattern as the rest of the app (`GET /me/albums`, `DELETE /me/albums`) and storing only the listened history in `localStorage`. No new environment variables.

## Implementation

Add a new "Album Suggester" tab to the navbar's sub-page tabs (linking to `/album-suggester`), then build the Spotify Saved Albums fetch, the CS:GO-style case-opening reel animation with its sound effect, the big reveal (Spotify + Discogs links), the re-roll / mark-listened / mark-not-listened actions, unsaving from Spotify on "listened," and the `localStorage`-backed listened history. No new backend routes or environment variables are needed.
