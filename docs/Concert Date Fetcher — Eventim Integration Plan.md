# Concert Date Fetcher — Eventim Integration Plan

Oct 15, 2026 · @Elias

## Goal and scope

The Concert Date Fetcher gets Eventim as a second source, read from the search API that eventim.de's own website uses: one request per artist returns that artist's upcoming shows as JSON. Artists are checked one at a time: Ticketmaster first, then Eventim, then the two results are merged before the next artist starts. A show both shops sell becomes one card with a Ticketmaster link and an Eventim link, never two cards.

**Why this source:** eventim.de's pages cut off non-browser requests, so parsing them is out. The search API answered a plain request from your computer with 200 on 2026-10-17. It is undocumented, and its `robots.txt` (checked 2026-10-17) allows only Googlebot to read `/websearch/` and disallows everyone else (`User-agent: *` / `Disallow: /`). Using it anyway is your decision, made knowing that (see Risks).

- **In scope:** `lib/eventim.js` (builds the request and normalizes the answer), one new route `GET /api/eventim/concerts` in `routes/api.js`, the run loop, merge and cards in `public/js/concert-date-fetcher.js`, and the docs (`docs/PLAN.md`, `CLAUDE.md`).
- **Unchanged:** `GET /api/concerts` (the Ticketmaster proxy), `lib/cities.js`, `lib/artistMatch.js`, the `concertDateFetcher` key's existing fields, attending, calendar and coin logic. The Setlist Fetcher keeps working with Eventim-only concerts too: it only reads `localDate`, `artists`, `venueName`, `city` and `id`, which every card has.
- **No new dependency:** the answer is JSON, so no HTML parser is needed.
- **Out of scope:** the Awin affiliate feed. Apply for it anyway; it can replace the route later without touching the page.

**Repo rules this plan follows** (from `CLAUDE.md`):

- The app runs on Render's free plan with no database, and the server sleeps and restarts. Nothing Eventim-related is stored on the server, and there is no Eventim cache anywhere: every fetch asks Eventim live.
- All browser storage goes through `MusicHub.storage` (`read` / `write` / `remove`). This plan adds no new storage key; the Eventim fields travel inside the existing `concertDateFetcher` key.
- Proxies are called one after another from the frontend with a fixed delay; one failed lookup goes into the failed-artists notice instead of stopping the run.
- ES modules on the server, plain scripts in `public/js/`, colors only from `public/css/variables.css`, and every change must work on mobile.
- The steps below are built one at a time, with a test by you after each.

## How a run works

The existing `checkArtists` loop keeps its shape; each artist now gets two lookups and a merge before the loop moves on.

&#91;embedded content: one artist's turn · Ticketmaster, Eventim, merge\]

Each artist finishes both lookups and the merge before the next one starts; after the last artist the list is built, compared with the stored one and rendered.

1. Read the followed artists with `MusicHub.followedArtists.list()` (unchanged; each has `id` and `name`).
2. For artist *i* of *n*:
   1. Status `Checking Ticketmaster for <Artist> (i/n)` → `GET /api/concerts?artist=<name>` (unchanged), then the existing 220 ms pause. Only if that request fails does the run fall back to the artist's stored Ticketmaster dates (see When a lookup fails). The progress bar doesn't move yet: the two lookups take very different times, and a half step would make the time estimate jump.
   2. Status `Checking Eventim for <Artist> (i/n)` → `GET /api/eventim/concerts?artist=<name>`, live on every fetch. Only if that request fails does the run fall back to what is already stored (see When a lookup fails).
   3. Merge this artist's Eventim shows into the run's matches (see Merging). A show already found on Ticketmaster gains an Eventim link; any other show is added as its own entry.
   4. Progress moves to i/n; the next artist starts.
3. After the last artist, `buildConcerts`, `applyPreviousState` and `storeRunResult` run as today, then the list renders.

A Ticketmaster failure does not skip Eventim for that artist, and the reverse. Cancel aborts both through the run's existing `AbortController`, and the partial result is merged into the stored list as today.

**Run time:** Ticketmaster stays at about 0.3 s per artist. Eventim requests are paced 2 s apart, usually one per artist (a further page only when the answer has more than 50 products). Because every fetch asks Eventim live, every fetch for 350 artists takes about 14 minutes, the first and every later one alike; artists whose name also matches many other products add a few seconds each.

## Merging

An Eventim show that Ticketmaster already has is folded into the Ticketmaster entry, so the card keeps its Ticketmaster data and gains an Eventim link. The merge runs per artist, right after that artist's Eventim lookup, on the run's `matches` list (`{ artistName, event }` pairs).

### Same concert or not

An Eventim show and an entry already in `matches` are the same concert when all of these hold:

1. Same city. Both sides already carry the canonical name from `matchCity` in `lib/cities.js` (Eventim's `Frankfurt` becomes `Frankfurt am Main`).
2. Same `localDate`.
3. The artist is on both, **or** the venue names are equal after `normalizeName` (so `Rudolf Weber-Arena` equals `Rudolf Weber-ARENA`). "On both" means the match's `artistName`, or a name in its `attractionNames`, equals the artist after `normalizeName`. The page can't load `lib/artistMatch.js` (a server module), so the page's own `normalizeName` gains the umlaut and accent folding that `normalizeArtistName` has (`Motörhead` equals `Motorhead`).

Start times are not compared. Two shows on the same day at the same venue (matinee and evening) end up on one card either way, because cards are grouped by venue, city and date, as Ticketmaster's are today.

### What happens

- **Match found:** copy `eventimUrl`, `eventimId` and `eventimHasVariants` (the show's `hasVariants`) onto that match's event object. No new entry. If the artist isn't yet on that entry (co-headline found through the venue), push `{ artistName, event: <that same event> }` so `buildConcerts` adds the name, as it does today.
- **No match:** push an Eventim-only entry: `{ artistName, event }` where `event` is the route's show plus `ticketmasterId: null`, `ticketUrl: null` and `eventimHasVariants` (copied from the show's `hasVariants`, so `buildConcerts` reads one field name for both cases). Its `attractionNames` come from Eventim, so the support-act labels in `buildConcerts` keep working; `imageUrl` is null.
- **Late Ticketmaster match:** when a later artist's Ticketmaster results contain a show that is already in `matches` as Eventim-only (artist A only on Eventim, artist B on Ticketmaster), the Ticketmaster event takes over: it gets the Eventim fields, and the Eventim-only entry is re-pointed to it so artist A stays on the card.

### Changes inside `buildConcerts`

- `byEvent` keys on `ticketmasterId || 'eventim:' + eventimId`, so the same Eventim show found under two artists collapses into one entry.
- Grouping by `concertId(venueName, city, localDate)` and `pickRepresentative` stay as they are. Eventim's VIP and comfort products are already collapsed by the route (collapseVariants), so each Eventim show arrives as one entry and is its own representative.
- New fields on each built concert: `ticketmasterId` (the representative's, so the Ticketmaster fallback can rebuild the event), `eventimUrl` (first event in the group that has one) and `eventimId`.
- `hasMultipleTicketOptions` is true when the group has more than one Ticketmaster entry, **or** any event in it has `eventimHasVariants`, **or** an event rebuilt by the Ticketmaster fallback carries the stored card's `hasMultipleTicketOptions`.
- `ticketUrl` stays the Ticketmaster URL (null for Eventim-only cards), so stored data and the Setlist Fetcher keep working.

### Stable ids

A card's `id` is `concertId(...)` built from its representative's venue name. Two cases need care, because the id also keys the "New" marks and the coin reward (`concert:<id>` in the wallet):

- **Ticketmaster cards** keep their current ids, because the Ticketmaster event stays the representative. Nothing already stored changes.
- **An Eventim-only card that Ticketmaster lists later** would get a new id from Ticketmaster's venue spelling. `applyPreviousState` therefore gets a fallback: when no previous concert has the same id, look for one with the same `city`, the same `localDate` and a shared artist, and reuse that previous `id`. The card keeps its flags, is not marked "New" again, and the coins are not paid twice.

## Backend

One new route asks the search API about one artist and returns that artist's shows in the allowed cities, in the same shape the merge expects. The server keeps no state between requests, which fits Render's sleeping free plan.

### The request

`GET https://public-api.eventim.com/websearch/search/api/exploration/v1/products` with these query parameters:

| Parameter | Value |
| --- | --- |
| `webId` | `web__eventim-de` |
| `language` | `de` |
| `retail_partner` | `EVE` |
| `search_term` | the artist's name |
| `sort` | `DateAsc` |
| `top` | `50` (the maximum) |
| `page` | `1`, then further pages up to `totalPages` |

The answer has `products`, `totalResults`, `page` and `totalPages`. Each product carries `productId`, `productGroupId`, `name`, `type`, `status`, `inStock`, `link`, `attractions`, and `typeAttributes.liveEntertainment` with `startDate` (e.g. `2027-09-21T20:00:00+02:00`) and `location` (`name`, `city`, `geoLocation`). There is no image field.

### `lib/eventim.js` (new, no network code)

- `buildSearchUrl(artist, page)`: the URL above, with parameters set through `URLSearchParams`.
- `toShows(products, artist)`: keeps products of type `LiveEntertainment` that have a `startDate`, aren't cancelled, and belong to the artist. Sold-out and not-yet-on-sale products stay (see Decisions); a `status` that means cancelled drops the product, and step 1 records which `status` values exist. The artist check reuses `eventMatchesArtist` from `lib/artistMatch.js` by handing it `{ name, _embedded: { attractions } }` built from the product, so the attractions list decides when present and the title must contain the full name otherwise (`MAVI` doesn't match `MAVIS`). The city goes through `matchCity`; other cities are dropped. Each show: `eventimId` (`productId`), `productGroupId`, `eventName`, `localDate` and `localTime` cut from `startDate` (it already carries Berlin local time; `localTime` is null when no time is given), `dateTime` (`startDate`), `venueName`, `city`, `eventimUrl` (`link`), `imageUrl: null`, `attractionNames`.
- `collapseVariants(shows)`: Eventim lists VIP packages, lounge and comfort tickets as products of their own on the same date and venue. Shows are grouped by `localDate` + normalized venue name; the representative is the one whose name has no add-on wording (VIP, Premium, Lounge, Loge, Komfort, Upgrade, Paket, Package, Arrangement, Hotel, Meet & Greet, Backstage), the shortest name on a tie. It gets `hasVariants: true` when its group had more than one product.
- **Tidy names:** cut `eventName` from `|` on (`... NFC-ALBUM | im Artistshop` loses the shop suffix), so cards and calendar entries read like the Ticketmaster ones.

### Route in `routes/api.js`

`GET /api/eventim/concerts?artist=<name>` → `{ artist, shows }`.

- **Input:** `artist` is required and at most 200 characters, else 400. It only ever goes into the query string; the host and path are fixed, so the route can't be pointed anywhere else.
- **Paging:** fetch page 1; while `page < totalPages`, fetch the next page, at most 4 pages. Step 1 checks whether later pages really return further shows; if the API ignores paging, the 50 cap stands.
- **Pacing:** `waitForEventimSlot()` with `EVENTIM_REQUEST_INTERVAL_MS = 2000`, the same pattern as `waitForSetlistfmSlot()`. An in-memory slot is fine: it only spaces requests.
- **Request:** `User-Agent: MusicHub/1.0 +https://music-hub-r9w6.onrender.com` (like `DISCOGS_USER_AGENT`), `Accept: application/json`, 15 s timeout, no cookies, nothing disguised.
- **Stop on cancel:** listen on `res.on('close')` and treat it as a cancel when `res.writableEnded` is still false; then no further page is fetched. Not `req.on('close')`: in current Node versions that fires as soon as the request has been read, not when the browser goes away.

| Eventim answers | Route answers | Shown as |
| --- | --- | --- |
| 200 with a `products` array | 200 `{ artist, shows }` (may be empty) | normal result |
| 403 or 429 | 429 `{ blocked: true }`, never retried | blocked |
| 200 without a `products` array | 502 `{ unexpected: true }` | unexpected answer |
| other error status | 502 `{ error }` | request failed |
| timeout or network error | 504 `{ error }` | no answer |

## When a lookup fails

Every fetch asks both shops live for every artist; nothing is cached between fetches. Only when an artist's live request to one shop fails does the run fall back for that shop, and then to what is already on your concerts page, not to a separate cache. This also changes today's behavior: until now a failed Ticketmaster lookup dropped that artist's cards at the next full fetch.

- **Eventim fallback:** if the Eventim request for an artist fails, or Eventim is paused for the run, that artist's upcoming stored concerts (`concertDateFetcher`) that carry an `eventimId` are turned back into Eventim shows and merged as usual: `eventimId`, `eventimUrl`, `eventName`, `localDate`, `localTime`, `dateTime`, `venueName` and `city` come from the stored card, `attractionNames` from its `artists`, and `hasVariants` from `hasMultipleTicketOptions`.

  **Ticketmaster fallback:** if the Ticketmaster request for an artist fails, that artist's upcoming stored concerts that carry a `ticketUrl` are turned back into Ticketmaster events and added to the run's matches as if Ticketmaster had returned them: `ticketmasterId` (or `stored:` + the card's `id` for cards saved before this change), `eventName`, `imageUrl`, `localDate`, `localTime`, `dateTime`, `venueName`, `city` and `ticketUrl` from the stored card, `attractionNames` = the card's headliners followed by its `supportArtists` (so the support labels survive), and the card's `hasMultipleTicketOptions`, which `buildConcerts` keeps (the rebuilt card has only one Ticketmaster entry, so the note would otherwise vanish). The Eventim lookup and merge for that artist then run as usual.

  **Both:** past concerts are left to the existing past-concert logic. Without the fallback, a full fetch, which replaces the stored list, would drop a shop's links and cards every time that shop has a bad moment. The failed notice marks the artist "(showing last known dates)" on that shop's line.
- **Why Retry checks both sources:** a retry merges into the stored list, where the fresh entry wins. An Eventim-only retry would rebuild a merged card as Eventim-only and lose its Ticketmaster data, so a retried artist always gets both lookups and the merge.

## Concerts page changes

The page keeps its layout; cards gain a second ticket link, and the status line and failure notice name the source.

- **Ticket links on the card:** the whole-card overlay (`.concert-card__link`) keeps opening `ticketUrl`, or `eventimUrl` on an Eventim-only card. A row of two small pill links, "Ticketmaster" and "Eventim", goes into `.concert-card__actions`, layered above the overlay; a card from one shop shows one pill. Each opens in a new tab with an `aria-label` like "Eventim tickets for Sido at Festhalle Frankfurt". Pills wrap on narrow screens and use colors from `variables.css`.
- **Multiple ticket options note:** same condition as today plus `eventimHasVariants`; the wording ends "check the ticket shop for details" instead of naming Ticketmaster.
- **Calendar event description:** `eventName` followed by every ticket link the card has (`buildCalendarEvent`).
- **Status line:** the two texts from How a run works. The ETA from `MusicHub.progressEta` keeps working as is, since it reads overall progress.
- **Failed-artists notice:** shows which artist failed for which source, and why. `failed` holds `{ name, source, reason }` instead of names, and the notice groups them by source, one line each:

  > Couldn't check every artist.\
**Ticketmaster:** Artist B (request failed)\
**Eventim:** Artist A (unexpected answer), Artist C (no answer)

  Reasons, from the route's answer: "request failed" (an error status, including Ticketmaster's own 429), "no answer" (network error or timeout), "unexpected answer" (Eventim's JSON without its `products` list), "blocked" (only the Eventim route's `{ blocked: true }`). A source with more than 10 failures shows the first 10 and "and N more", which expands on tap. A source with no failures has no line. A failure for an artist who already had dates from that shop adds "(showing last known dates)", so you know those cards are still there. Retry checks both sources again for every listed artist (see When a lookup fails for why both).
- **Eventim blocked:** after 3 Eventim answers in a row with `blocked: true`, the run stops calling Eventim and finishes the Ticketmaster lookups. The notice's Eventim line then reads "Eventim stopped answering after Artist X; the remaining N artists use their last known Eventim dates" instead of listing hundreds of names. Retry offers only the artists listed by name, not that remainder; the next normal fetch covers them. Retry follows the same 3-in-a-row rule, so retrying right after a block stops quickly instead of hammering Eventim.
- **Wording:** the multiple-ticket-options note names Ticketmaster today, and the file's header comment describes a Ticketmaster-only page; both are updated to cover both shops.

## Implementation steps

Six steps, each ending in something you can test before the next one starts. Claude Code can't reach Eventim from its own environment, so step 1 works from answers you save on your computer.

**Before step 1**, save real answers from your own terminal into the repo folder. Your repo is public on GitHub, so add test/fixtures/eventim/ to .gitignore rather than publishing Eventim's data. If step 1 needs another answer (for example to try the city\_names filter), Claude Code writes the curl command and you run it:

```bash
mkdir -p test/fixtures/eventim
UA="MusicHub/1.0 +https://music-hub-r9w6.onrender.com"
BASE="https://public-api.eventim.com/websearch/search/api/exploration/v1/products?webId=web__eventim-de&language=de&retail_partner=EVE&sort=DateAsc&top=50"
curl -s --http1.1 -A "$UA" -o test/fixtures/eventim/sido-p1.json "$BASE&search_term=Sido&page=1"
curl -s --http1.1 -A "$UA" -o test/fixtures/eventim/mavi-p1.json "$BASE&search_term=MAVI&page=1"
curl -s --http1.1 -A "$UA" -o test/fixtures/eventim/none-p1.json "$BASE&search_term=qxzvbnartist&page=1"
# a broad word with hundreds of results, only to see whether paging works
curl -s --http1.1 -A "$UA" -o test/fixtures/eventim/rock-p1.json "$BASE&search_term=Rock&page=1"
curl -s --http1.1 -A "$UA" -o test/fixtures/eventim/rock-p2.json "$BASE&search_term=Rock&page=2"
```

- [ ] **1. Normalizing.** Write `lib/eventim.js` and run it over the saved answers with a short throwaway script. *Check while doing it:* what `attractions` items look like, how `location.city` spells cities (does `matchCity` accept them?), which `status` values occur, whether the Rock answer's page 2 holds different products than page 1 (if it repeats page 1, paging doesn't work), and how VIP and comfort tickets are named. *Test:* Sido's answer yields one show per date and venue in the allowed cities (Wien and Zürich dropped), VIP and comfort products are folded into their show with `hasVariants`, any product of another act that only matched the search word is dropped, and the made-up name yields nothing.
- [ ] **2. Route, then a live check on Render.** `GET /api/eventim/concerts` with input check, paging, pacing and the error table. *Test locally on your computer (make up):* `?artist=Sido` returns shows; an empty artist gets 400. *Then deploy and open* `https://music-hub-r9w6.onrender.com/api/eventim/concerts?artist=Sido`. Render's servers may be treated differently from your home connection; if Eventim blocks them, stop here before building steps 3 to 5.
- [ ] **3. Per-artist loop and fallbacks.** Add the Eventim lookup to `checkArtists` after each Ticketmaster call, the two status texts, `ticketmasterId` on built concerts, and the fallback for both shops. Eventim-only entries only, no merging yet, so a show both shops sell appears twice until step 4. *Test:* a run shows Eventim cards; a second fetch right after asks both shops again for every artist (Network tab); with one route made to fail (e.g. a temporary early `return res.status(502)` in it), a fetch keeps that shop's cards from before and the notice says "(showing last known dates)" on that shop's line.
- [ ] **4. Merge.** Matching rules, the late-Ticketmaster case, the `buildConcerts` changes and the id fallback in `applyPreviousState`. *Test:* a show sold by both shops appears once with both links; an existing card keeps "I'm attending" and isn't marked "New"; a co-headline show lists both artists.
- [ ] **5. Cards, notices, docs.** Ticket pills, note wording, calendar description, the source-aware failed notice and Retry, the paused notice, the CSS. Update `docs/PLAN.md` (Concert Date Fetcher section and stored-data example) and `CLAUDE.md` (layout and routes). *Test:* on a phone width, both pills fit and are tappable; Retry re-checks a failed Eventim artist.
- [ ] **6. Clean up.** Once steps 1 to 5 work, delete the temporary `test/fixtures/eventim/` folder with the saved Eventim answers (and `test/` too if nothing else is in it), then remove its line from `.gitignore`. The app never reads these files; it always asks Eventim live. *Test:* the folder is gone, `git status` shows only the `.gitignore` change, and a fetch still works.

### Files touched

| File | Change |
| --- | --- |
| `lib/eventim.js` | New: request URL, normalizing, variant collapsing |
| `routes/api.js` | `GET /api/eventim/concerts`, `waitForEventimSlot()` |
| `public/js/concert-date-fetcher.js` | Live Eventim lookup, fallback for both shops, per-artist merge, `buildConcerts`, `applyPreviousState`, cards, notices |
| `public/css/style.css` | Ticket pills on the card |
| `docs/PLAN.md`, `CLAUDE.md` | Describe Eventim alongside Ticketmaster |
| `test/fixtures/eventim/` | The saved answers from before step 1, kept out of git and deleted in step 6 |
| .gitignore | Add test/fixtures/eventim/ during the work, remove the line in step 6 |

No new dependency and no new environment variables: the API needs no key, and the pacing and `User-Agent` are constants like the Discogs and setlist.fm ones.

## Risks and decisions

The main risks are that Eventim changes or closes the search API, or blocks the app; the plan keeps both failures visible and the Awin feed as the way out.

### Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Robots opt-out and terms | robots.txt admits only Googlebot and disallows everyone else; Eventim may object or block the app | Your decision, made knowing it: honest `User-Agent`, nothing disguised, one request per artist 2 s apart, pause Eventim after 3 blocked answers in a row, apply for the Awin feed in parallel. Not legal advice. |
| Render blocked | Works from home, fails live | Live check on Render right after step 2, before steps 3 to 5 |
| Undocumented API changes | Fields move or the endpoint disappears; `unexpected` answers | All field access in `lib/eventim.js`, saved answers to re-check against, failures shown per artist in the notice |
| Blocking during a run | Eventim answers 403/429 | Pause Eventim after 3 in a row, keep the artist's Eventim dates from the last fetch, no retries or workarounds |
| Name search | A namesake's or tribute act's shows appear | `eventMatchesArtist`: attractions decide, else the full name as whole words |
| Different spellings | Same show on two cards | Canonical cities from `matchCity`, artist-or-venue match rule, id fallback |

### Decisions

- **Source:** Eventim's website search API, after it answered a plain request from your computer with 200 on 2026-10-17, knowing its `robots.txt` admits only Googlebot and disallows all other automated access.
- **Live cards:** no. The list renders once at the end of a run, as today.
- **Pace:** 2 s between Eventim requests (`EVENTIM_REQUEST_INTERVAL_MS = 2000`).
- **"New" on the first Eventim run:** every Eventim-only show found on that run is marked "New", like any other newly found concert.
- **Not on sale yet and sold out:** shown like any other concert, with no label, as Ticketmaster's are today.
- **Past concerts you went to:** already kept across full fetches by a fix made outside this plan. Steps 3 and 4 build on that code as it now stands and must not undo it; Eventim-only concerts you attended are kept the same way. Pull the latest code before step 3.
- **Always live:** every fetch asks both shops for every artist; there is no cache. Stored dates are used only for an artist whose live request to that shop failed.
- **Fallback for both shops:** a failed Ticketmaster lookup keeps the artist's last known Ticketmaster dates, the same way a failed Eventim lookup keeps the Eventim ones.

### Known limits

- **No images on Eventim-only cards:** the search API has no image field. Cards that also come from Ticketmaster keep Ticketmaster's image; the card already renders without one.
- **50 per page:** if step 1 shows the API ignores later pages, an artist with more than 50 matching Eventim products (VIP products and other acts that only matched the search word included) loses the latest ones. Step 1 can then try the API's `city_names` filter with the allowed cities, which keeps most answers well under 50.
- **Festivals:** found only if Eventim lists the artist among the festival product's `attractions`; step 1 shows whether it does.
- **Keep the page open during a fetch:** a fetch now takes about 14 minutes instead of about 2. On a phone, locking the screen or switching apps can suspend the page: lookups made while it's away fail (those artists keep their stored dates), and if the browser closes the page, nothing from that run is saved because results are stored only at the end; the previous list stays as it was. Start long fetches on a computer, or keep the phone's screen on.

### Sources

- [Eventim search API notes (gist)](https://gist.github.com/DeveloperMarius/7e8aff4c69ccbf59238d76163c86d9c9)
- [public-api.eventim.com robots.txt](https://public-api.eventim.com/robots.txt) (read by you on 2026-10-17)
- [Eventim partner program](https://www.eventim.de/campaign/eventim-partner/)
- [eventim DE program on Awin](https://ui.awin.com/merchant-profile/11388)
- [cide0/music-hub](https://github.com/cide0/music-hub) (`CLAUDE.md`, `routes/api.js`, `public/js/concert-date-fetcher.js`, `lib/cities.js`, `lib/artistMatch.js`)
