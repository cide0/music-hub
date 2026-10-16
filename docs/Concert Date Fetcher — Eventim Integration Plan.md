# Concert Date Fetcher — Eventim Integration Plan

Oct 15, 2026 · @Elias

## Goal and scope

The Concert Date Fetcher gets Eventim as a second source. Artists are checked one at a time: Ticketmaster first, then Eventim, then the two results are merged before the next artist starts. A show that both shops sell becomes one card with a Ticketmaster link and an Eventim link, never two cards.

- **In scope:** `lib/eventim.js` (new parser), two new proxy routes in `routes/api.js`, the run loop, merge and cards in `public/js/concert-date-fetcher.js`, a new `eventimLookup` browser key, and the docs (`docs/PLAN.md`, `CLAUDE.md`).
- **Unchanged:** `GET /api/concerts` (the Ticketmaster proxy), `lib/cities.js`, `lib/artistMatch.js`, the `concertDateFetcher` key's existing fields, attending, calendar and coin logic.
- **Out of scope:** the Awin affiliate feed. It could later replace the parser behind the same routes.

**Repo rules this plan follows** (from `CLAUDE.md`):

- The app runs on Render's free plan with no database, and the server sleeps and restarts. Nothing Eventim-related is stored on the server; every cache lives in the browser.
- All browser storage goes through `MusicHub.storage` (`read` / `write` / `remove`), and new app-data keys are added to `APP_DATA_KEYS` in `public/js/storage.js` so Export/Import and the Drive sync see them.
- Proxies are called one after another from the frontend with a fixed delay; one failed lookup goes into the failed-artists notice instead of stopping the run.
- ES modules on the server, plain scripts in `public/js/`, colors only from `public/css/variables.css`, and every change must work on mobile.
- The steps below are built one at a time, with a test by you after each.

## How a run works

The existing `checkArtists` loop keeps its shape; each artist now gets two lookups and a merge before the loop moves on.

&#91;embedded content: one artist's turn · Ticketmaster, Eventim, merge\]

Each artist finishes both lookups and the merge before the next one starts; after the last artist the list is built, compared with the stored one and rendered.

1. Read the followed artists with `MusicHub.followedArtists.list()` (unchanged; each has `id` and `name`).
2. For artist *i* of *n*:
   1. Status `Checking Ticketmaster for <Artist> (i/n)` → `GET /api/concerts?artist=<name>` (unchanged), then the existing 220 ms pause. Progress moves to (i − 0.5)/n.
   2. Status `Checking Eventim for <Artist> (i/n)` → Eventim lookup. The browser cache decides whether any request is needed (see Browser-side Eventim cache). Requests go to `GET /api/eventim/artist`, then `GET /api/eventim/tour` for each new or changed tour.
   3. Merge this artist's Eventim shows into the run's matches (see Merging). A show already found on Ticketmaster gains an Eventim link; any other show is added as its own entry.
   4. Progress moves to i/n; the next artist starts.
3. After the last artist, `buildConcerts`, `applyPreviousState` and `storeRunResult` run as today, then the list renders.

A Ticketmaster failure does not skip Eventim for that artist, and the reverse. Cancel aborts both through the run's existing `AbortController`, and the partial result is merged into the stored list as today.

**Artists as objects:** `checkArtists` and the Retry list (`lastFailed`) work with names today. Both switch to `{ id, name }`, because the Eventim cache is keyed by Spotify id; Ticketmaster still gets only the name.

**Run time:** Ticketmaster stays at about 0.3 s per artist. Eventim requests are paced at 2 s. The first run for 350 artists takes roughly 15 to 20 minutes (artist pages plus every tour page); a daily run after that is about 12 minutes (one artist page each, plus changed tours). A second run within 20 hours reuses the cached Eventim shows and takes about as long as today's Ticketmaster-only run.

## Merging

An Eventim show that Ticketmaster already has is folded into the Ticketmaster entry, so the card keeps its Ticketmaster data and gains an Eventim link. The merge runs per artist, right after that artist's Eventim lookup, on the run's `matches` list (`{ artistName, event }` pairs).

### Same concert or not

An Eventim show and an entry already in `matches` are the same concert when all of these hold:

1. Same city. Both sides already carry the canonical name from `matchCity` in `lib/cities.js` (Eventim's `FRANKFURT` becomes `Frankfurt am Main`).
2. Same `localDate`.
3. The artist is on both, **or** the venue names are equal after `normalizeName` (so `Rudolf Weber-Arena` equals `Rudolf Weber-ARENA`). "On both" means the match's `artistName`, or a name in its `attractionNames`, equals the artist after `normalizeArtistName` from `lib/artistMatch.js`.
4. If both have a start time and they are more than 2 hours apart, they are separate shows (matinee and evening).

### What happens

- **Match found:** copy `eventimUrl`, `eventimId` and `eventimHasVariants` onto that match's event object. No new entry. If the artist isn't yet on that entry (co-headline found through the venue), push `{ artistName, event: <that same event> }` so `buildConcerts` adds the name, as it does today.
- **No match:** push an Eventim-only entry: `{ artistName, event }` with `ticketmasterId: null`, `eventimId`, `eventName`, `imageUrl`, `localDate`, `localTime`, `dateTime`, `venueName`, `city`, `ticketUrl: null`, `eventimUrl`, `attractionNames: []`.
- **Late Ticketmaster match:** when a later artist's Ticketmaster results contain a show that is already in `matches` as Eventim-only (artist A only on Eventim, artist B on Ticketmaster), the Ticketmaster event takes over: it gets the Eventim fields, and the Eventim-only entry is re-pointed to it so artist A stays on the card.

### Changes inside `buildConcerts`

- `byEvent` keys on `ticketmasterId || 'eventim:' + eventimId`, so the same Eventim show found under two artists collapses into one entry.
- Grouping by `concertId(venueName, city, localDate)` and `pickRepresentative` stay as they are. Eventim-only entries have no variant listings, so they are their own representative.
- New fields on each built concert: `eventimUrl` (first event in the group that has one) and `eventimId`.
- `hasMultipleTicketOptions` is true when the group has more than one Ticketmaster entry **or** any event in it has `eventimHasVariants`.
- `ticketUrl` stays the Ticketmaster URL (null for Eventim-only cards), so stored data and the Setlist Fetcher keep working.

### Stable ids

A card's `id` is `concertId(...)` built from its representative's venue name. Two cases need care, because the id also keys the "New" marks and the coin reward (`concert:<id>` in the wallet):

- **Ticketmaster cards** keep their current ids, because the Ticketmaster event stays the representative. Nothing already stored changes.
- **An Eventim-only card that Ticketmaster lists later** would get a new id from Ticketmaster's venue spelling. `applyPreviousState` therefore gets a fallback: when no previous concert has the same id, look for one with the same `city`, the same `localDate` and a shared artist, and reuse that previous `id`. The card keeps its flags, is not marked "New" again, and the coins are not paid twice.

## Backend

The server only fetches and parses; it keeps no Eventim state between requests, which fits Render's sleeping free plan. One new dependency: `cheerio` (installed with `make npm-install`).

### `lib/eventim.js` (new, no network code)

- `slugify(name)`: lowercase; ä→ae, ö→oe, ü→ue, ß→ss; `&`→`und`; other accents stripped; every other non-alphanumeric run becomes `-`. Matches what eventim.de uses: `Gestört aber GeiL` → `gestoert-aber-geil`, `Badmómzjay` → `badmomzjay`, `& JULIA` → `und-julia`.
- `parseArtistPage(html, slug)` → `{ name, tours }`. `name` comes from the `<title>` (`Sido - Termine & Tickets`). Tours are links of the form `/artist/<same slug>/<tour-slug>-<productGroupId>/`; links to other slugs (the "Ähnliche Künstler" and "Empfehlungen" blocks) are ignored. Per tour: name, first and last date (`19.09.2027 ─ 08.10.2027`), show count (`24 Events`), teaser image, and whether it is "zurzeit nicht verfügbar".
- `parseTourPage(html)` → `{ shows, nextPage }`. Show links are `/event/<slug>-<eventId>/`. Per row: day, German month abbreviation (`Sept.`, `Okt.`, `Dez.`, `März`…), year, time (`20:00` or `ab 20:00`), the city heading (upper case, e.g. `FRANKFURT`), venue and availability. Rows whose link ends in `#tab=vip_packages` or `#tab=extras` are not separate shows; they set `hasVariants` on the regular row with the same date and venue. `nextPage` is the `?pnum=N` link when a "Nächste Seite" link exists.
- Before writing selectors, check whether the pages carry JSON-LD (`application/ld+json` with `Event` / `MusicEvent`) and prefer it if so. Anchor on link patterns rather than CSS classes.

**Tidy event names:** Eventim row titles carry shop suffixes (`SIDO - FRIEDEN TOUR 2027 / TICKETS ONLY & NFC-ALBUM | im Artistshop`). Cut everything from `|` on, so cards and calendar entries read like the Ticketmaster ones. Names that slugify to nothing (non-Latin scripts) are skipped without a request.

### Routes in `routes/api.js`

| Route | Returns |
| --- | --- |
| `GET /api/eventim/artist?artist=<name>&slug=<optional>` | `{ artist, slug, status, tours }`. Without `slug`, the route tries `slugify(artist)` and accepts the page only if its title name equals the artist after `normalizeArtistName`. `status` is `ok` or `not_found`. |
| `GET /api/eventim/tour?path=<tour path>` | `{ productGroupId, shows }`, following every result page. Each show: `eventimId`, `eventName`, `localDate`, `localTime`, `dateTime` (Europe/Berlin), `venueName`, `city`, `eventimUrl`, `imageUrl`, `hasVariants`. Shows outside the allowed cities are dropped with `matchCity`, as in `/api/concerts`. |

- **Input check:** `path` must match `^/artist/[a-z0-9-]+/[a-z0-9-]+-\d+/$`, and `slug` must match `^[a-z0-9-]+$`. The routes only ever request `https://www.eventim.de` + such a path, so they can't be used to fetch anything else.
- **Pacing:** a `waitForEventimSlot()` with `EVENTIM_REQUEST_INTERVAL_MS = 2000`, the same pattern as `waitForSetlistfmSlot()`. An in-memory slot is fine here: it only spaces requests and needs to survive nothing.
- **Requests:** `User-Agent` `MusicHub/1.0 +https://music-hub-r9w6.onrender.com` (like `DISCOGS_USER_AGENT`), 15 s timeout, no cookies, no login.
- **Errors:** a 403 or 429 from Eventim is passed on as `429` with `{ blocked: true }` and never retried. Other failures answer `502`, and a page that parses to nothing where tours were expected answers `502` with `{ parseError: true }`.
- **Allowed paths only:** `/artist/...` pages. Never `/api/`, `/search/`, URLs with `artistid=`, seat maps or `public-api.eventim.com`, all of which robots.txt excludes or Eventim refuses.

**Stop on cancel:** a tour route can fetch several result pages, 2 s apart. If the browser cancels (`req` emits `close`), stop before the next Eventim request instead of finishing the tour.

## Browser-side Eventim cache

The browser remembers each artist's Eventim slug and the shows of each tour, so most runs need one Eventim request per artist or none. It lives under a new `eventimLookup` key, written through `MusicHub.storage` and added to `APP_DATA_KEYS`, so it travels with Export/Import and the Drive sync.

```json
{
  "artists": {
    "<spotify artist id>": {
      "slug": "sido",
      "checkedAt": "2026-10-15T08:00:00Z",
      "fetchedAt": "2026-10-15T08:00:00Z",
      "tours": ["4082990", "3979516"]
    }
  },
  "tours": {
    "4082990": {
      "signature": "2027-09-19|2027-10-08|24",
      "fetchedAt": "2026-10-15T08:00:00Z",
      "shows": []
    }
  }
}
```

`shows` holds the parsed shows from `/api/eventim/tour`, already limited to the allowed cities.

### What the Eventim lookup does for one artist

1. **Known not on Eventim** (`slug: null`) and checked less than 30 days ago → no request, no shows.
2. **Fetched less than 20 hours ago** → no request; use the cached shows of its tours. This is what makes a second press of "Fetch concert dates" on the same day fast.
3. **Otherwise** → `GET /api/eventim/artist` (with the stored slug, if any). Store the slug or `null`.
4. For each tour in the answer: if its signature (first date, last date, show count) equals the cached one and the cached shows are under 7 days old, reuse them; else `GET /api/eventim/tour` and store the result.
5. Drop cached tours the artist page no longer lists; remove tours no artist points to.

**Fallback on failure:** when Eventim fails or is skipped for an artist, the run uses that artist's cached Eventim shows instead of none. Without this, a full run (which replaces the stored list) would silently drop Eventim links and Eventim-only cards every time Eventim has a bad moment.

**Why Retry checks both sources:** a retry merges into the stored list, where the fresh entry wins. An Eventim-only retry would rebuild a merged card as Eventim-only and lose its Ticketmaster data, so a retried artist always gets both lookups and the merge.

**Fewer writes:** keep `eventimLookup` in memory during a run and write it every 25 artists, at the end and on cancel. Writing after every artist would make the Drive sync upload a growing file every 2 seconds.

"Clear" on the concerts page keeps `eventimLookup`: it is a lookup cache, not concert data, and dropping it would only make the next run slow.

## Concerts page changes

The page keeps its layout; cards gain a second ticket link, and the status line and failure notice name the source.

- **Ticket links on the card:** the whole-card overlay (`.concert-card__link`) keeps opening `ticketUrl`, or `eventimUrl` on an Eventim-only card. A row of two small pill links, "Ticketmaster" and "Eventim", goes into `.concert-card__actions`, layered above the overlay; a card from one shop shows one pill. Each opens in a new tab with an `aria-label` like "Eventim tickets for Sido at Festhalle Frankfurt". Pills wrap on narrow screens and use colors from `variables.css`.
- **Multiple ticket options note:** same condition as today plus `eventimHasVariants`; the wording ends "check the ticket shop for details" instead of naming Ticketmaster.
- **Calendar event description:** `eventName` followed by every ticket link the card has (`buildCalendarEvent`).
- **Status line:** the two texts from How a run works. The ETA from `MusicHub.progressEta` keeps working as is, since it reads overall progress.
- **Failed-artists notice:** shows which artist failed for which source, and why. `failed` holds `{ name, source, reason }` instead of names, and the notice groups them by source, one line each:

  > Couldn't check every artist.\
**Ticketmaster:** Artist B (request failed)\
**Eventim:** Artist A (page couldn't be read), Artist C (no answer)

  Reasons: "request failed" (Ticketmaster error status), "no answer" (network error or timeout), "page couldn't be read" (`parseError`), "blocked" (403/429). A source with more than 10 failures shows the first 10 and "and N more", which expands on tap. A source with no failures has no line. An Eventim failure for an artist with cached dates adds "(showing last known dates)", so you know those cards are still there. Retry checks both sources again for every listed artist (see Browser-side Eventim cache for why both).
- **Eventim blocked:** after 3 Eventim answers in a row with `blocked: true`, the run stops calling Eventim and finishes the Ticketmaster lookups. The notice's Eventim line then reads "Eventim stopped answering after Artist X; the remaining N artists use their last known Eventim dates" instead of listing hundreds of names.
- **Spec text:** the docs say "Ticketmaster" in several places (empty-state message, failed notice); update them to cover both shops.

## Implementation steps

Five steps, each ending in something you can test before the next one starts.

- [ ] **1. Parser.** Add `cheerio`; write `lib/eventim.js`. Save a few real pages (an artist with tours, a tour with two result pages, an artist with no tours) and run the parser over them with a short throwaway script. *Test:* Sido's 2027 tour yields one entry per regular show in the allowed cities (Wien and Zürich dropped), no VIP or extras rows, and the Hannover show has `hasVariants`.
- [ ] **2. Routes.** `GET /api/eventim/artist` and `GET /api/eventim/tour` in `routes/api.js`, with input checks, pacing and error answers. *Test:* `/api/eventim/artist?artist=Sido` returns slug `sido` and its current tours; a made-up name returns `not_found`; a `path` outside `/artist/` is refused with 400.
- [ ] **3. Cache and per-artist loop.** Add `eventimLookup` to `APP_DATA_KEYS`; add the Eventim lookup to `checkArtists` after each Ticketmaster call, with the cache rules and the two status texts. Eventim-only entries only, no merging yet, so a show both shops sell appears twice until step 4. *Test:* a run shows Eventim cards; a second run within 20 hours makes no Eventim requests (Network tab).
- [ ] **4. Merge.** Matching rules, the late-Ticketmaster case, the `buildConcerts` changes and the id fallback in `applyPreviousState`. *Test:* a show sold by both shops appears once; an existing card keeps "I'm attending" and isn't marked "New"; a co-headline show lists both artists.
- [ ] **5. Cards, notices, docs.** Ticket pills, note wording, calendar description, source-aware failed notice and Retry, the blocked notice, the CSS. Update `docs/PLAN.md` (Concert Date Fetcher section and stored-data example) and `CLAUDE.md` (layout and routes). *Test:* on a phone width, both pills fit and are tappable; Retry re-checks a failed Eventim artist.

### Files touched

| File | Change |
| --- | --- |
| `package.json` | Add `cheerio` |
| `lib/eventim.js` | New: slugify, artist page and tour page parsers |
| `routes/api.js` | Two Eventim routes, `waitForEventimSlot()` |
| `public/js/storage.js` | `eventimLookup` in `APP_DATA_KEYS` |
| `public/js/concert-date-fetcher.js` | Eventim lookup and cache, per-artist merge, `buildConcerts`, `applyPreviousState`, cards, notices |
| `public/css/style.css` | Ticket pills on the card |
| `docs/PLAN.md`, `CLAUDE.md` | Describe Eventim alongside Ticketmaster |

No new environment variables: Eventim needs no key, and the pacing and `User-Agent` are constants like the Discogs and setlist.fm ones.

## Risks and decisions

The main costs are the slow first run and parser upkeep when Eventim changes its pages.

### Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| First-run time | About 15 to 20 minutes for 350 artists at 2 s per Eventim request | Browser cache: repeat runs within 20 hours skip Eventim; unchanged tours are re-fetched at most once a week |
| Eventim redesign | Parser finds nothing; `parseError` answers | Link-pattern parsing, saved pages to re-check against, parse errors shown in the failed notice |
| Blocking | Eventim answers 403/429 | Stop after 3 in a row, no workarounds; switch the routes to the Awin feed if it persists |
| Wrong artist | A namesake's shows appear | Title check on the artist page, cache keyed by Spotify id |
| Different spellings | Same show on two cards | Canonical cities from `matchCity`, artist-or-venue match rule, id fallback |
| Drive sync size | `eventimLookup` is one more synced file | Shows are limited to the allowed cities; tours no artist points to are removed |
| Terms of use | Eventim may object to automated reading | Only robots-allowed pages, low rate, honest `User-Agent`, no login. Not legal advice. |

### Decisions

- **Live cards:** no. The list renders once at the end of a run, as today.
- **Slug overrides:** skipped for now. Artists whose Eventim slug differs from their name simply get no Eventim results until this comes up.
- **Pace:** 2 s between Eventim requests (`EVENTIM_REQUEST_INTERVAL_MS = 2000`).
- **"New" on the first Eventim run:** every Eventim-only show found on that run is marked "New", like any other newly found concert. No special case in `applyPreviousState`.
- **Not on sale yet and sold out:** shown like any other concert, with no label, as Ticketmaster's are today. The parser still reads availability but the page doesn't use it.

### Known limits

- **Festivals:** an artist's festival appearances sit on the festival's Eventim page, not the artist's, so they won't be found. Ticketmaster has the same gap today.
- **Namesakes:** with slug overrides skipped, an artist whose name matches a different act on Eventim gets that act's shows.
- **Single shows:** if an artist page links a show directly (an /event/ link instead of a tour link), the artist parser returns it as a one-show tour so it isn't missed. Step 1 confirms this with a saved page.

### Sources

- [eventim.de robots.txt](https://www.eventim.de/robots.txt)
- [Example artist page (Sido)](https://www.eventim.de/artist/sido/)
- [Example tour page (Frieden Tour 2027)](https://www.eventim.de/artist/sido/sido-frieden-tour-2027-tickets-only-nfc-album-tickets-4082990/)
- [Eventim partner program](https://www.eventim.de/campaign/eventim-partner/)
- [cide0/music-hub](https://github.com/cide0/music-hub) (`CLAUDE.md`, `routes/api.js`, `public/js/concert-date-fetcher.js`, `lib/cities.js`)
