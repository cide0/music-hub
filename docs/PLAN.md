# Music Hub – Project Plan

2026-09-19 · @Someone

## Overview

Music Hub is a Node.js web app with Spotify integration (OAuth via Client ID/Secret). It is deployed on Render.com (Free Plan) — meaning **no database is available**, and the server process can idle or restart due to inactivity, which wipes any in-memory state. Login status and page content therefore need to be persisted client-side (in the browser).

The individual pages of the app will be added step by step below.

## Tech Stack & Infrastructure

**Backend:** Node.js (latest LTS/current version), running in a Docker container. **Frontend:** Plain HTML/CSS/JavaScript (no framework), served by the Node server. **Hosting:** Render.com, Free Plan. **Deployment:** the production deployment on Render uses the same Docker setup as local development (Render Web Service running the project's Docker image).

### Docker

- `Dockerfile` based on the latest official `node` image.
- `docker-compose.yml`, so `make up` / `make down` can start/stop the container.
- Pin an explicit Node.js version in the `Dockerfile` (e.g. `node:22-alpine`, updated deliberately) rather than the floating `latest` tag, so builds stay reproducible.

### Makefile Targets

| Target | Purpose |
| --- | --- |
| `make build-dev` | Build the Docker image |
| `make npm-install` | Install npm dependencies |
| `make install` | Runs `make npm-install` and `make build-dev` |
| `make up` | Start the container |
| `make down` | Stop the container |
| `make cleanup` | Remove all of the project's containers, images and volumes |
| `make list` | List all available make targets |
| `make generate-secret` | Print a random value (`openssl rand -hex 32`) to use as `SESSION_SECRET` |

`make list` can, for example, be generated automatically by parsing `##` comments next to each target (a standard pattern for self-documenting Makefiles).

## Environment Variables & Secrets

- `.env` holds the real values, is listed in `.gitignore`, and is **never** committed.
- `.env.example` holds the same keys with placeholders and is committed, so the project can be set up reproducibly.
- The redirect URI is environment-dependent: locally `http://127.0.0.1:8080/callback`, live (Render) `https://music-hub-r9w6.onrender.com/callback`. Recommendation: a single `SPOTIFY_REDIRECT_URI` variable set via `.env` (local) or a Render environment variable (live), instead of branching code on `NODE_ENV`.
- `SESSION_SECRET` is a random string used to HMAC-sign the OAuth `state` parameter during login (see the stateless PKCE flow under Step 1) — not a Spotify credential, just a locally generated secret. Generate it with `make generate-secret` and paste the printed value into `.env` (and, separately, as a Render environment variable for production). It's a one-time setup step per environment, not something regenerated on every run — the target just saves you from typing the `openssl` command by hand. Rotating it only invalidates logins that are literally mid-flow at that moment, nothing stored long-term.

### .env.example (placeholders)

```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8080/callback
SESSION_SECRET=your_random_secret_for_signing_oauth_state
TICKETMASTER_API_KEY=your_ticketmaster_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:8080/auth/google/callback
SETLISTFM_API_KEY=your_setlistfm_api_key
LASTFM_API_KEY=your_lastfm_api_key
DISCOGS_TOKEN=your_discogs_personal_access_token
PORT=8080
```

### .gitignore (addition)

```
.env
node_modules/
```

## Frontend & State Persistence Without a Database

Yes, this is possible without a database — via the browser. Three options compared:

| Option | Stored where | Size | Typical use | Server access |
| --- | --- | --- | --- | --- |
| Cookies | Browser, sent with every request to the server | \~4 KB total | Session/login token when the server needs to read it | Yes (automatic) |
| `sessionStorage` | Browser, current tab only | \~5–10 MB | Temporary UI state, lost when the tab closes | No |
| `localStorage` | Browser, persists across tabs/restarts | \~5–10 MB | Login token, page content, caches — stays until the user clears it | No |

**Recommendation for Music Hub:**

- Spotify login via the OAuth **Authorization Code Flow with PKCE** (no client secret needed in the browser for the actual user login flow; the client secret is only needed server-side for initial configuration/other flows).
- Access token, refresh token, and token expiry are stored in `localStorage`, so the login status survives page loads and browser restarts — even if the Render server restarts or goes to sleep in the meantime.

  Stored under a `spotifyAuth` key:

  ```
  {
    accessToken: "...",
    refreshToken: "...",
    expiresAt: 1735689600000
  }
  ```
- Automatic re-authorization: before each Spotify API call, check the stored expiry; if the access token is expired or about to expire, silently exchange the refresh token for a new access token via a small server-side proxy endpoint (needs the client secret, so it can't happen purely in the browser) — no user interaction required. Only fall back to the full Spotify login redirect if the refresh token itself is invalid, missing, or revoked, keeping re-logins as rare as possible.
- Page content (e.g. the most recently loaded data per page) is also cached in `localStorage` under its own keys, to be defined in detail per page below.
- Known trade-off: `localStorage` can be read via JavaScript (XSS risk), but without a database/server session it's the pragmatic default approach for pure client-side persistence on a free-tier host without a database.

### Cross-Device Data: Export / Import

Since all of Music Hub's app data lives in `localStorage`, it's tied to one browser on one device. To move it to another device, the navbar includes two global controls (next to the Spotify login button, available on every internal page):

- **Export data** — downloads a single JSON file (e.g. `music-hub-backup.json`) containing everything Music Hub has stored locally: Concert Date Fetcher's saved concert list (including `addedToCalendar` flags) and Concert History's full artist/concert/media folder structure. Auth tokens (Spotify, Google) are **not** included — they're device-specific and re-obtained via login, not something to carry across devices.
- **Import data** — lets the user pick a previously exported JSON file. After a confirmation prompt (since this **overwrites** whatever's currently stored on this device), it replaces the relevant `localStorage` keys with the imported content and reloads the current page so everything re-renders from the new data.

This is a manual, on-demand sync — moving data between devices means exporting on one and importing on the other (e.g. via AirDrop, email, or the file itself dropped into Google Drive); there's no automatic background sync.

## Design & Branding

Visual style takes cues from the Spotify app/web UI — rounded buttons and controls, generous spacing, a dark theme — but swaps Spotify's green for a purple accent.

**Primary accent:** `#7407B0` (replaces Spotify's green as the main call-to-action / active-state color). **Page background:** black (`#000000`), matching Spotify's dark theme.

**Full palette:**

| Hex | Suggested use |
| --- | --- |
| `#F6E7FE` | Lightest tint — text on very dark surfaces, subtle highlights |
| `#E5BAFC` | Light accents, hover states on dark backgrounds |
| `#D58EFA` | Secondary accents, active icons |
| `#C462F8` | Links, secondary buttons |
| `#B336F7` | Interactive highlights |
| `#A30AF5` | Bright accent, badges, active tab indicator |
| `#8508C9` | Hover/pressed state of the primary buttons |
| `#7407B0` | **Primary accent** — main buttons, active states, brand color |
| `#4B0571` | Darker accent, secondary surfaces |
| `#2E0345` | Card/panel backgrounds on top of black |
| `#100118` | Near-black surface, subtle elevation above pure black |
| `#000000` | Page background |

**Guidelines:**

- Primary buttons: fully rounded (pill-shaped), background `#7407B0`, hover/pressed state `#8508C9` — matching Spotify's rounded button style.
- Body text: white or `#F6E7FE` on black / `#100118` / `#2E0345` surfaces for strong contrast; avoid placing mid-palette purples (`#B336F7`–`#D58EFA`) as body text directly on black, since contrast can get weak there — use them for accents, icons, and large headings instead.
- Cards/panels: `#100118` or `#2E0345` on the black page background, to create the same kind of subtle surface elevation Spotify uses.
- Font: Spotify's own typeface (Circular) isn't freely licensable — use a similar geometric sans-serif such as Inter or Poppins (Google Fonts) for a comparable look and feel.
- Check contrast (WCAG AA, 4.5:1 for body text) wherever a purple sits directly on another purple or on black.
- Implementation: define every palette color as a CSS custom property (e.g. `--color-primary: #7407B0;`) in its own dedicated stylesheet (e.g. `colors.css` or `variables.css`), imported before the rest of the CSS. Components then reference `var(--color-primary)` etc. instead of hard-coded hex values.
- **Responsive/mobile:** every page's styles must work well on mobile screens too, not just desktop — grids of cards (concert items, artist folders, images) should collapse to fewer columns or a single column on narrow viewports, the navbar should adapt to small screens: the sub-page tabs collapse into a hamburger menu, while the "Login with Spotify" button and the "Export data"/"Import data" controls stay visible on mobile as compact icon buttons rather than being hidden in the menu, since login state and data export/import are things worth quick access to, and touch targets (buttons, tabs) should be large enough to tap comfortably. Use relative units and CSS media queries throughout rather than fixed desktop-only widths — this applies to every page in the app, not just specific ones.
- **Icons:** navbar icons (hamburger, login, export, import) and any other UI icons are inline SVGs, hand-picked from a free set (e.g. Feather or Heroicons) and pasted directly into the markup/CSS — no icon font or external icon library dependency.
- **Disabled/inactive button states** (e.g. "Fetching…", an already-"Added" calendar button): a muted gray, matching the same grayish tone used for concert item borders, rather than a dimmed version of the purple accent — keeps it visually distinct from an active, clickable purple button.
- **Focus states:** a visible keyboard-focus outline in the accent purple (`#7407B0`) on every interactive element (buttons, links, inputs), rather than relying on the browser's default outline — stays consistent with the palette while remaining clearly visible against the black background.

## Implementation Steps

**Execution rule for Claude Code:** implement these steps one at a time, in order. After finishing a step, stop and wait — don't start the next step until the user has tested the current one and given explicit confirmation to continue.

### Step 1: Base Setup & Navbar

Scope of the first implementation step:

1. Create a `CLAUDE.md` file at the repo root with the essential context and rules for this repo, so Claude Code doesn't have to rediscover them each session:
   - **Project summary:** Node.js/Express web app with Spotify integration at its core, plus Ticketmaster (concert search), Google Calendar and Google Drive (event/media embeds), Last.fm (artist similarity data), and setlist.fm (setlist search); plain HTML/CSS/JS frontend (multi-page, EJS-templated), Dockerized, deployed on Render.com (Free Plan — no database).
   - **Module system:** ES Modules.
   - **Rules:**
     - Never commit `.env` or any secret values — only `.env.example` with placeholders.
     - No API key or secret (Spotify client secret, Ticketmaster, Google, setlist.fm, `SESSION_SECRET`) is ever sent to or used in frontend/client-side code — each one is only read from `process.env` on the server, inside the backend proxy endpoint that needs it.
     - All persisted state (login tokens, page content/caches) lives in the browser (`localStorage`) — there is no database and no server-side session store.
     - All colors come from the CSS custom properties in `public/css/variables.css` — never hard-code hex values elsewhere.
     - Use the Makefile targets (`make install`, `make up`, `make down`, etc.) for Docker/dependency workflows rather than raw `docker`/`npm` commands.
     - Points to the full project plan (exported into the repo, e.g. `docs/PLAN.md`) for the page-by-page spec and design details.
       - Update the repo's top-level `README.md` from its current placeholder to a brief project description and basic setup instructions (`make install`, `make up`, where to find `.env.example`).
   - Keep it concise — a quick-reference file, not a duplicate of the full plan.
2. Apply the base setup from this plan: `Dockerfile` (pinned Node version), `docker-compose.yml`, Makefile targets (`build-dev`, `install`, `npm-install`, `up`, `down`, `cleanup`, `list`, `generate-secret`), `.env` / `.env.example`, `.gitignore`, `.dockerignore` (excluding `node_modules/`, `.env`, `.git/`). Load environment variables via the `dotenv` package. Use `nodemon` inside the container for local development, so `make up` picks up file changes without a rebuild.
3. Set up an **Express.js** backend serving a **multi-page** frontend: one plain HTML file per route (see table below), each served via its own Express route. Shared markup (the navbar) is included via a lightweight server-side template (EJS partial) rendered into each page, so the navbar isn't duplicated by hand across the five HTML files (Spotify Video Matcher and Spotify Release List are external links, not pages this app serves) — the rendered output is still plain HTML/CSS/JS on the client, no frontend framework.
4. Create the CSS variables file (e.g. `colors.css`) with the full purple palette as custom properties, imported by the main stylesheet.
5. Reference the favicon, already added at `public/favicon.png`, via `<link rel="icon" type="image/png" href="/favicon.png">` in the HTML `<head>` of every page — no need to add the file itself.
6. Build the navbar partial (rendered into every page), containing:
   - A **"Login with Spotify"** button, top right.
   - Fully functional **"Export data" / "Import data"** controls, also top right, built now (not deferred to a later step) since they only depend on whatever's already in `localStorage`, not on any specific page's data existing yet:
     - **Export data:** reads every Music Hub app-data key out of `localStorage` (as pages are added in later steps, e.g. Concert Date Fetcher's concert list, Followed Artists Graph's cached graph data, Concert History's folder structure, and the Discogs page's latest results — excluding auth tokens) and downloads them as one JSON file (e.g. `music-hub-backup.json`).
     - **Import data:** opens a file picker for a previously exported JSON file; after a confirmation prompt (since this **overwrites** whatever's currently stored on this device), writes its contents back into the matching `localStorage` keys and reloads the page.
   - Sub-page tabs, linking to (the root `/` redirects to `/concert-date-fetcher`, so that tab is open by default):

     | Tab label | Links to | Notes |
     | --- | --- | --- |
     | *(root)* | `/` → redirects to `/concert-date-fetcher` | not a navbar tab itself |
     | Concert Date Fetcher | `/concert-date-fetcher` | internal page, content defined later |
     | Followed Artists Graph | `/followed-artists-graph` | internal page, content defined later |
     | Setlist Fetcher | `/setlist-fetcher` | internal page, content defined later |
     | Concert History | `/concert-history` | internal page, content defined later |
     | Discogs | `/discogs` | internal page, content defined later |
     | Spotify Video Matcher | https://spotify-video-matcher.onrender.com/ | external app — opens that URL directly, not a page of Music Hub |
     | Spotify Release List | https://spotifyreleaselist.netlify.app/ | external app — opens that URL directly, not a page of Music Hub |
     | Spotify Listening Stats | https://stats.fm/user/cide?range=lifetime | external link — opens that URL directly, not a page of Music Hub |
7. Implement the real Spotify OAuth login now (Authorization Code Flow with PKCE), **stateless** — no server-side storage of the verifier, so it survives restarts and multiple instances:
   - `GET /login` — generates a PKCE code verifier + challenge, HMAC-signs the verifier (using `SESSION_SECRET`) into the `state` query param sent to Spotify's `/authorize` endpoint, and redirects the browser there.
   - `GET /callback` — receives the authorization code and the signed `state`; verifies the HMAC signature (rejects if invalid or tampered) and extracts the verifier directly from `state` — no server-side lookup needed. Exchanges the code + verifier for an access + refresh token at `https://accounts.spotify.com/api/token` (using the client secret, server-side only), then returns a small HTML page whose inline script writes the tokens (and expiry) into `localStorage` and redirects back to the page the user started from (or home).
   - The navbar's login button reflects login state by checking `localStorage` on page load (e.g. swap "Login with Spotify" for the user's display name/avatar once a valid token is present).
   - **Page-level gating:** every internal page (all except Spotify Video Matcher and Spotify Release List) checks Spotify login state on load. If the user isn't logged in, the page renders an empty state with the message "Please log in to Spotify first" instead of its normal content/controls — so a page's own buttons (e.g. Concert Date Fetcher's "Fetch concert dates") are simply not shown until the user has logged in. The navbar's Export/Import controls are unaffected by this — they work regardless of login state, since they operate on `localStorage` directly.
8. The server listens on `process.env.PORT` (falling back to the `.env` value, e.g. `8080`, for local dev) — Render assigns its own port to the web service in production, so it can't be hardcoded.
9. Each internal tab (all except Spotify Video Matcher and Spotify Release List) renders an empty page body for now, beyond the login-gating and navbar behavior above — just the navbar plus a blank content area. Page content follows in later implementation steps as each page is specced out below.

### Project Structure & Conventions

- **Module system:** ES Modules (`import`/`export`, `"type": "module"` in `package.json`) — the modern default for a fresh project on a current Node version.
- **Shared client-side auth logic:** one `public/js/auth.js`, included on every page, handling the token read/expiry-check/silent-refresh and toggling the navbar's login button/user display — so this logic isn't duplicated across the five HTML pages.
- **Suggested layout:**

```
music-hub/
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── package.json
├── .env.example
├── .gitignore
├── server.js
├── routes/
│   ├── auth.js          # /login, /callback
│   └── pages.js         # page routes
├── views/
│   ├── partials/
│   │   └── navbar.ejs
│   ├── concert-date-fetcher.ejs
│   ├── followed-artists-graph.ejs
│   ├── setlist-fetcher.ejs
│   ├── concert-history.ejs
│   └── discogs.ejs
└── public/
    ├── css/
    │   ├── variables.css
    │   └── style.css
    ├── js/
    │   └── auth.js
    └── favicon.png
```

*(No `index.ejs` — `/` only ever redirects to `/concert-date-fetcher`, it never renders its own page.)*

### Step 2: Concert Date Fetcher

Scope: implement only the Concert Date Fetcher page, per its full spec under "Pages of the App" below — the "Fetch concert dates" flow, Ticketmaster proxy endpoint, concert item cards (dedup, new/old border highlighting, info note), status bar, failed-artists notice, `localStorage` persistence, and the Google Calendar integration (connect button, OAuth flow, "Add to calendar" with persisted state). The other tabs (Followed Artists Graph, Setlist Fetcher, Concert History) stay empty placeholders, as set up in Step 1.

### Step 3: Concert History

Scope: implement only the Concert History page, per its full spec under "Pages of the App" below — artist/concert folder browsing, the Spotify-followed-artists picker, pasted Google Drive embed parsing, the images/videos display, and `localStorage` persistence. No new backend routes or environment variables are needed for this page. The remaining tabs (Followed Artists Graph, Setlist Fetcher) stay empty placeholders, as set up in Step 1.

### Step 4: Followed Artists Graph

Scope: implement only the Followed Artists Graph page, per its full spec under "Pages of the App" below — the Last.fm-based similarity graph generation (via a new backend proxy endpoint), D3-based force-directed rendering, concert-count badges (linking into Concert History), the "Recommended artists" toggle and its random selection, node hover/click behavior, and `localStorage` persistence. Needs one new backend route (`GET /api/similar-artists`) and one new environment variable (`LASTFM_API_KEY`). The remaining tab (Setlist Fetcher) stays an empty placeholder, as set up in Step 1.

### Step 5: Setlist Fetcher

Scope: implement only the Setlist Fetcher page, per its full spec under "Pages of the App" below — the setlist.fm search proxy, setlist selection, the removable song list, background Spotify track auto-matching with a manual fallback for unmatched songs, the editable-playlist picker, and the add-to-playlist flow. Unlike the other pages, this one doesn't persist its working state to `localStorage`. The remaining tab (Discogs) stays an empty placeholder, as set up in Step 1.

### Step 6: Discogs

Scope: implement only the Discogs page, per its full spec under "Pages of the App" below — both of its features: the "Pick of the Day" random-collection-item suggestion, and the "Check for new releases" flow (the Discogs proxy endpoints, throttled search + detail-fetch, the full-replace release list). Needs two new backend routes (`GET /api/discogs/releases`, `GET /api/discogs/random-collection-item`) and one new environment variable (`DISCOGS_TOKEN`). This completes all five pages — after this step, Music Hub's full feature set per this plan is implemented.

## Pages of the App

The following pages make up Music Hub. Each is detailed here as it's specced out.

| Page | Status |
| --- | --- |
| Concert Date Fetcher | specced below |
| Followed Artists Graph | specced below |
| Setlist Fetcher | specced below |
| Concert History | specced below |
| Discogs | specced below |
| Spotify Video Matcher | external link only — https://spotify-video-matcher.onrender.com/, no page content within this app |
| Spotify Release List | external link only — https://spotifyreleaselist.netlify.app/, no page content within this app |
| Spotify Listening Stats | external link only — https://stats.fm/user/cide?range=lifetime, no page content within this app |

### Concert Date Fetcher

Route: `/concert-date-fetcher` (also the app's default landing page, via the `/` redirect).

**Flow, triggered by a "Fetch concert dates" button:**

1. Call the Spotify Web API directly from the frontend (using the stored access token) to get all artists the user follows: `GET https://api.spotify.com/v1/me/following?type=artist&limit=50`, paginating via the response's `cursors.after` until all followed artists are collected. If the user follows no artists at all, skip Ticketmaster entirely and show "You don't follow any artists on Spotify yet."
2. For each followed artist, call a backend endpoint — `GET /api/concerts?artist=<name>` — that proxies the Ticketmaster Discovery API server-side (the Ticketmaster API key stays server-side, same reasoning as the Spotify client secret): `GET https://app.ticketmaster.com/discovery/v2/events.json?keyword=<name>&countryCode=DE&sort=date,asc&size=50&apikey=<TICKETMASTER_API_KEY>`. City filtering happens after the response comes back (matching each event's `_embedded.venue.city.name` against the allowed city list) rather than one Ticketmaster call per city — one call per artist instead of one per artist × city. These calls are made sequentially with a small fixed delay between each (e.g. \~220ms, capping the rate at roughly 4–4.5 requests/second) to stay safely under Ticketmaster's 5-requests-per-second limit, the same throttling approach used for Last.fm on Followed Artists Graph. If a given artist's lookup fails (rate limit, network error), skip it and record its name in a "failed artists" list, continuing with the rest rather than aborting the whole fetch.
3. While the fetch is running, the "Fetch concert dates" button is disabled and shows a "Fetching…" state, preventing a second fetch from starting concurrently. The frontend loops through the followed artists sequentially, awaiting each backend call in turn, updating the status bar after each one completes (e.g. "Checking concerts for \<Artist> (12/47)…").
4. Deduplicate: Ticketmaster sometimes lists the same concert several times as separate events (e.g. standard ticket, VIP ticket, VIP + hotel package), and the same real-world concert can also turn up under more than one followed artist (a co-headline tour, a support act). Before rendering, group results by venue name + city + date (same day) — **not** by artist — and keep only one item per group. If a group's matches came from more than one followed artist, merge their names into that single item's artist list. Record whether a group had more than one Ticketmaster match (i.e. multiple ticket options existed).
5. Compare the deduplicated, sorted list against the previously stored list in `localStorage`, using the same venue + city + date key: any item not present in the previous list is flagged "new" for this render. If there is no previous stored list at all (the very first fetch ever), every item is flagged "new" — nothing was known before, so the whole result set counts as newly found. When an item did already exist, carry forward its stored `addedToCalendar` and attending flags onto the freshly fetched version, so neither "Add to calendar" state nor the "I'm attending" toggle is lost across re-fetches.
6. Sort the list ascending by date and render one item per concert. Every item always gets a rounded, plain grayish border as its base style; items flagged "new" additionally get an accent-colored border (`#7407B0`) on top, to highlight what changed since the last fetch. If the deduplicated list ends up empty, show "No upcoming concerts found in the selected cities." instead of a blank area. Re-enable the "Fetch concert dates" button once rendering is done.
7. Save the full result (plus a "last fetched" timestamp) to `localStorage`, overwriting any previous fetch. The "new" flag itself isn't persisted — it only applies to the render right after a fetch; reopening the page later (without fetching) shows every stored item with the normal grayish border.
8. Once the fetch finishes, if the "failed artists" list from step 2 isn't empty, show a small dismissible notice/popup listing the artists whose Ticketmaster lookup failed (e.g. "Couldn't check concerts for: Artist A, Artist B"), so the user knows the result set might be incomplete. No popup appears if nothing failed.

**Allowed cities** (must match `_embedded.venue.city.name`): Berlin, Hamburg, München, Köln, Frankfurt am Main, Düsseldorf, Stuttgart, Leipzig, Dortmund, Essen, Bremen, Hannover, Nürnberg, Offenbach am Main.

**Each concert item shows:**

- Artist name(s) — a merged list when the concert matches more than one followed artist (e.g. co-headline tour, support act)
- Event/tour name
- Event image (from Ticketmaster's `images` array)
- Date & time
- Venue name & city
- A ticket link (the Ticketmaster event URL, opens in a new tab)
- An **"Add to calendar"** button (see Google Calendar integration below)
- An **"I'm attending"** toggle, independent of "Add to calendar" — it only sets a flag on the stored concert (`attending: true`/`false`), with no Google Calendar API call at all. This is for when the user already has the show in their calendar some other way (added manually, imported elsewhere) and just wants to mark it as one they're going to inside Music Hub, without creating a duplicate calendar entry.
- A small info note, shown only when the dedup step collapsed more than one match for that concert — e.g. "Multiple ticket options available (VIP, packages, etc.) — check Ticketmaster for details"
- Card styling: rounded corners and a plain grayish border on every item; items newly found by the current fetch (which on the very first fetch is all of them) additionally get an accent-colored (`#7407B0`) border instead of the plain gray one

**Status bar:** visible only while fetching; a short progress line updated as each followed artist is checked (frontend-driven, no SSE, per the chosen approach).

**Persistence:** on page load, if `localStorage` already holds a saved concert list, render it immediately (with the normal grayish borders — nothing is "new" on a plain page load), along with a small "Last fetched: \<timestamp>" label near the button, so closing and reopening the page keeps the last results. The button always triggers a fresh fetch, overwriting the stored list, updating the timestamp, and re-rendering. Either way (cached render or fresh fetch), any concert whose date has already passed is filtered out before rendering, so reopening the page after some time doesn't show stale, already-happened shows at the top of the list. One external mutation to be aware of: Setlist Fetcher can remove an artist (or a whole entry) from this same stored data once that artist's setlist has been added to a playlist there — see Setlist Fetcher's "Shows from Concert Date Fetcher" section for details. This doesn't affect what's shown here, since this page already excludes past concerts from its own display regardless of what remains in storage.

Stored under a `concertDateFetcher` key:

```
{
  lastFetchedAt: "2026-09-20T10:00:00Z",
  concerts: [
    {
      id: "venue|city|date",
      artists: ["Artist A", "Artist B"],
      eventName: "...",
      imageUrl: "...",
      date: "2026-11-05T20:00:00+01:00",
      venueName: "...",
      city: "Berlin",
      ticketUrl: "...",
      hasMultipleTicketOptions: false,
      addedToCalendar: false,
      attending: false
    }
  ]
}
```

**Google Calendar integration:**

- If Google isn't connected yet, clicking it starts the `/auth/google` flow first.
- Otherwise (refreshing the access token first if it's expired), it calls the Google Calendar API directly from the frontend: `POST https://www.googleapis.com/calendar/v3/calendars/primary/events` with `Authorization: Bearer <googleAccessToken>`.
- Event title (`summary`): `"<Artist> – <City>"` — the artist name(s) plus the location (city), no venue name. If the item has multiple merged artists, join them (e.g. `"Artist A, Artist B – City"`).
- Event time: uses the concert's exact start date/time if Ticketmaster provided one, defaulting to a 3-hour duration; falls back to an all-day event if only a date (no time) is available. All events use the `Europe/Berlin` timezone, since every allowed city is in Germany.
- On success, the concert's stored record gets both `addedToCalendar: true` and `attending: true` (persisted in `localStorage` — adding it to the calendar obviously means the user is going, so the "I'm attending" toggle flips on too), and the button switches to a disabled/muted "Added" state — this persists across reloads and re-fetches. On failure, an inline error message; the button stays clickable so the user can retry.

Google's tokens follow the same shape as Spotify's, stored separately under a `googleAuth` key:

```
{
  accessToken: "...",
  refreshToken: "...",
  expiresAt: 1735689600000
}
```

**Backend endpoints needed:**

- `GET /api/concerts?artist=<name>` — proxies the Ticketmaster Discovery API call above and returns the filtered/parsed event list as JSON.
- `GET /auth/google` / `GET /auth/google/callback` — Google OAuth authorization and token exchange.
- `POST /api/google/refresh` — silent Google access-token refresh.

**New environment variables:** `TICKETMASTER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — all added to `.env` / `.env.example`. `GOOGLE_REDIRECT_URI` is environment-dependent, same pattern as `SPOTIFY_REDIRECT_URI`: locally `http://127.0.0.1:8080/auth/google/callback`, live (Render) `https://music-hub-r9w6.onrender.com/auth/google/callback` (both already registered in the Google Cloud project's OAuth client). No separate Google "API key" is needed: writing events to a user's calendar goes through OAuth (client ID/secret + user consent), not an API key — those are only for public, unauthenticated requests.

### Followed Artists Graph

Route: `/followed-artists-graph`.

**Data source:** artist-to-artist connections — for both followed artists and the recommended/unfollowed suggestions — come from the **Last.fm API**'s `artist.getsimilar` endpoint, which returns real "fans also like" similarity data by artist name. (Spotify's own equivalent, `related-artists`, was permanently removed for new apps in November 2024, which is why this data comes from Last.fm instead.)

**Initial state:** just a **"Generate graph from followed artists"** button (subject to the usual page-level Spotify-login gating from Step 1). Once a graph has been generated at least once (i.e. `localStorage` already holds one), that button is replaced by two buttons for all later visits: **"Update graph"** (adds newly-followed artists only, reusing everyone else's cached Last.fm data) and **"Reload graph"** (rebuilds everything from scratch, re-fetching fresh Last.fm data for *every* followed artist and discarding the old cache — for when the cached similarity data has gone stale). Since "Reload graph" discards the cache and can take well over a minute for a large follow count, clicking it asks for confirmation first (mentioning it'll re-fetch everyone), similar to other destructive/slow confirmations elsewhere in the app.

**Generating the graph, triggered by the button:**

1. Fetch all followed artists via the same `GET /me/following?type=artist` call (paginated) used elsewhere. This response already includes each artist's full object (id, name, images, `external_urls.spotify`) — no extra per-artist Spotify calls needed for this step. If the user follows no artists at all, show "You don't follow any artists on Spotify yet." instead of an empty graph area.
2. For every followed artist whose Last.fm data needs fetching — all of them on "Generate graph" or "Reload graph", only the newly-added ones on "Update graph" — call a backend endpoint — `GET /api/similar-artists?artist=<name>` — that proxies Last.fm's `artist.getsimilar` server-side (the Last.fm API key stays server-side, same as every other third-party key in this project): `GET https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=<name>&api_key=<LASTFM_API_KEY>&format=json&limit=30`. These calls are made sequentially with a small fixed delay between each (e.g. \~220ms, capping the rate at roughly 4–4.5 requests/second) to stay safely under Last.fm's 5-requests-per-second limit. While this runs, whichever button was clicked is disabled and a **progress bar** is shown (a determinate one, since the total count of artists to fetch is known upfront) along with the current count (e.g. "Fetching similar artists… 120/360") — for someone following hundreds of artists this can take a while on "Generate" or "Reload," so visible, accurate progress matters here. Any single artist's failed lookup (rate limit, name not found, network error) is skipped rather than aborting the whole thing.
3. **"Generate graph" (no cached graph yet) or "Reload graph" (rebuild everything):** for every followed artist, cache their raw Last.fm similar-artist name list alongside their Spotify data — for "Reload graph" this replaces any previously cached lists entirely, rather than reusing them. Build an edge between two followed artists whenever either one's similar-artist list contains the other's name (a case-insensitive match, checked in both directions since Last.fm's similarity data isn't always symmetric). Artists whose list doesn't overlap with any other followed artist (or who have no Last.fm data at all) still appear as standalone, unconnected nodes rather than being filtered out.
4. **"Update graph" (a cached graph already exists):** fetch Last.fm data only for the newly-followed artists (already-cached artists reuse their stored similar-artist lists, no re-fetching them) — the same throttling and progress bar from step 2 apply, but the request count is usually much smaller since it's just the new artists. Add the new artists as nodes, with edges computed against *all* artists in the graph — existing and newly added — using the same both-directions name match as above. Artists already in the graph are left as they are — including anyone who might have been unfollowed since the last generation, since this is purely additive, not a full re-sync.
5. Render as an SVG force-directed graph using **D3.js** (loaded via a CDN `<script>` tag — a layout/rendering library, not a UI framework, so it doesn't conflict with the "plain HTML/CSS/JS, no framework" rule). Each followed artist is a circle node with the artist's Spotify profile image as its background and the artist name as a label (if an artist has no image at all — Spotify sometimes returns an empty images array — fall back to a plain accent-colored circle instead of a broken image); solid lines connect artists linked by Last.fm similarity.
6. Save the resulting graph data (followed artists, their cached Last.fm similar-artist lists, and the computed edges) to `localStorage`, overwriting the previous cache either way, so reopening the page shows the latest graph immediately without re-fetching. If the "Recommended artists" toggle was on when "Update graph" or "Reload graph" was clicked, it switches off and its gray nodes disappear — the base graph just changed, so that recommendation set is stale; the user can switch it back on afterward to get a fresh one.
7. Once the fetch finishes, if any artists' Last.fm lookups failed (per step 2), show a small dismissible notice/popup listing them (e.g. "Couldn't fetch similarity data for: Artist A, Artist B"), mirroring Concert Date Fetcher's failed-artists notice — so the user knows the graph might be missing some connections. No popup appears if nothing failed.

Stored under a `followedArtistsGraph` key:

```
{
  lastGeneratedAt: "2026-09-20T10:00:00Z",
  artists: [
    {
      spotifyArtistId: "...",
      name: "...",
      imageUrl: "...",
      spotifyUrl: "...",
      similarArtistNames: ["...", "..."]
    }
  ],
  edges: [
    ["spotifyArtistIdA", "spotifyArtistIdB"]
  ]
}
```

**Concert-count badge:** each followed-artist node shows a small circular badge (top-right of the node, per the reference image) with the number of concert subfolders that artist has under Concert History — shown only when that count is ≥ 1. Clicking the badge navigates to `/concert-history?artist=<spotifyArtistId>`; Concert History reads that query param on load and, if a matching artist folder exists, opens straight into that artist's Concerts view.

**"Recommended artists" toggle:** a toggle switch in the page's upper-right corner, labeled "Recommended artists," off by default.

- **When switched on:** pool every followed artist's already-cached Last.fm similar-artist names (from when the graph was generated/updated — no additional Last.fm calls needed here), discard any name that matches an already-followed artist, and dedupe the rest into one flat candidate pool.
- **Selecting 20:** pick 20 names from that pool by fully uniform random selection — no weighting, just a flat random draw (or all of them, if fewer than 20 exist).
- **Resolving to Spotify:** since Last.fm only gives names, search Spotify directly from the frontend (`GET /search?type=artist&q=<name>`, with the stored access token — a standard, non-gated endpoint) for each of the 20 picked names, to get its Spotify id, image, and `external_urls.spotify` link. Any name that doesn't resolve to a confident match is simply dropped rather than backfilled with another pick, so the rendered set can occasionally be slightly under 20.
- **Rendering:** each resolved candidate is a gray circle (using its own Spotify profile image as the node background), connected by a dashed line to *every* followed artist whose cached Last.fm list included it (there can be more than one — the reference image's single generic "unfollowed artists" node is just illustrative of the visual style, not literal). When the toggle is switched on, each new recommended node plays a small "bubbling up" entrance animation (e.g. scaling/fading in, growing from small to full size) as it's added to the graph, rather than just appearing instantly. If the candidate pool ends up empty after resolving (nothing to recommend), show "No recommended artists found." instead of silently rendering nothing. Recommended nodes never get a concert-count badge, since they have no Concert History folder.
- This always re-runs fresh and is never cached — switching the toggle off and on again (or reloading with it on) draws a new random set of 20 each time. It reuses the already-cached Last.fm data from graph generation, so only the Spotify-resolution search calls happen here, not new Last.fm lookups.
- **Switched off:** these nodes and their dashed edges simply aren't rendered; the underlying cached followed-artist graph is untouched.

**Node interactions (all nodes, followed and recommended alike):**

- Hover: a small scale-up animation on the circle (smooth CSS transition).
- Click: opens that artist's page in the **Spotify app** rather than the browser, via the `spotify:artist:<id>` URI scheme (built from the artist's Spotify id), not the `external_urls.spotify` web link. If the Spotify app isn't installed, the browser's own fallback handling applies (typically a prompt to install it, or nothing happens) — a known trade-off of using the app URI scheme instead of a plain web link.
- **Pan & zoom:** the graph area supports panning and zooming everywhere, not just on mobile — drag-to-pan and scroll-wheel-to-zoom with a mouse on desktop, pinch-to-zoom and drag-to-pan via touch on mobile (e.g. using D3's built-in zoom behavior for both). This matters most on narrow viewports, where a node graph can't just collapse to a single column like the card-grid pages do — panning/zooming keeps individual nodes reachable rather than squeezed into unreadable overlap — but it's useful at any screen size once the graph gets large.
- **Legend:** a small, unobtrusive key on the page explaining the visual language — solid line = Last.fm similarity connection between followed artists, dashed line = a recommended (unfollowed) artist's connection, gray circle = not followed, small badge = concert count (links to Concert History).

**Backend:** one endpoint is needed — `GET /api/similar-artists?artist=<name>` — proxying Last.fm's `artist.getsimilar` call described above. **New environment variable:** `LASTFM_API_KEY` (added to `.env` / `.env.example`).

### Setlist Fetcher

Route: `/setlist-fetcher`.

**Search:** two text inputs — **Artist name** and **City**, both required — plus a "Search setlists" button (subject to the usual page-level Spotify-login gating from Step 1). While a search is running (whether started from this button or from a "Fetch setlist" shortcut below), that button and every "Fetch setlist" button are disabled, preventing a second search from starting concurrently, and the one that was actually clicked shows a "Searching…" label while it runs — the same pattern used elsewhere in the app (e.g. Concert Date Fetcher's fetch button).

**Shows from Concert Date Fetcher:** in addition to the manual search above, the page also lists past concerts the user has flagged as ones they're going to on Concert Date Fetcher — read directly from that page's own `localStorage` data (no separate storage needed here, since Concert Date Fetcher already keeps every fetched concert, including ones its own display filters out once their date has passed): any stored concert where `addedToCalendar: true` **or** `attending: true` (either signal qualifies — a concert only needs one of them, not both), whose date is now in the past, sorted most-recently-occurred first.

- Each item shows the artist name(s), date, and venue/city — no setlist is loaded yet.
- For a merged item (a concert matching more than one followed artist, per Concert Date Fetcher's dedup logic), show one **"Fetch setlist"** button per artist, rather than one for the whole item, since setlist.fm needs a single artist name to search by.
- Clicking a button immediately runs the search below, pre-filled with that artist's name and the concert's city — the exact same flow as a manual search (newest-show selection, empty-setlist fallback, links, everything described below).
- Once a setlist has actually been **added to a playlist** (not just fetched/viewed) for an artist + venue + city + date matching one of these entries — whether that search started from this shortcut or was just a manual search that happened to match — that artist is removed from the underlying concert entry in Concert Date Fetcher's own `localStorage` data, deleting the whole entry if it was the only (or last remaining) artist on it. Since that's the same data this list is read from, the artist (or the whole item, once every artist on it has been handled) simply stops appearing here — no separate tracking needed. Concert Date Fetcher's own page is unaffected either way, since it already excludes past concerts from what it displays regardless of what's still in storage.
- If Concert Date Fetcher has no data yet, or nothing qualifies (no past concerts flagged as added-to-calendar or attending, or everything's already been handled), this section simply doesn't appear, rather than showing an empty placeholder.

**Flow:**

1. On search, call a backend endpoint — `GET /api/setlists?artist=<name>&city=<city>` — that proxies the setlist.fm search API server-side (the setlist.fm API key stays server-side, same reasoning as Ticketmaster's): `GET https://api.setlist.fm/rest/1.0/search/setlists?artistName=<name>&cityName=<city>` with the `x-api-key` header and `Accept: application/json`. If no setlists match, show "No setlists found for that artist and city." instead of an empty area.
2. If more than one setlist matches for that artist+city, determine the newest one by explicitly sorting the results by their `eventDate` — don't rely on the API's response order, which isn't guaranteed to already be date-sorted — and use that one automatically, with no selection step for the user.
3. If that newest match has no songs listed (setlist.fm sometimes has placeholder entries with an empty setlist), fall back to that **artist's** next most recent show overall, regardless of city — a separate search by artist name only, again explicitly sorted by `eventDate`, skipping any entries with no songs. Make it clear to the user when this fallback happened (e.g. "No setlist found for \<city> — showing \<artist>'s most recent show instead, in \<fallback city>.").
4. Show a small header above the song list with the chosen show's date and venue/city (e.g. "Setlist from 12 Jun 2024 at Mercedes-Benz Arena, Berlin"), so it's clear which show was picked — including when the fallback in step 3 kicked in. The header also includes two links to setlist.fm itself: one to that specific setlist's own page (the setlist object's `url` field), and one to the artist's setlist.fm page listing all of their recent shows (the artist object's `url` field, nested in the setlist result).
5. Flatten the chosen setlist's sets (including encores) into one ordered list of songs in their original order, and render them with a remove ("✕") control on each. Entries marked by setlist.fm as a non-performed tape/intro (rather than an actual song played) are filtered out automatically, since they're not real songs to add to a playlist. Entries setlist.fm marks as a cover show a small "(cover)" note under the title, using the original artist's name from that data for the matching step below instead of the artist that was searched for.
6. Removing a song only affects this working list — it's local curation before the playlist step; nothing is fetched or changed remotely.

**Auto-matching to Spotify tracks:** as soon as the songs are shown, the app searches Spotify for each one in the background, sequentially (`GET /search?type=track&q=track:<song title> artist:<artist name>`, called directly from the frontend with the stored access token), taking the top result as that song's track. Any song with no confident match is flagged with a small warning indicator right away — before the user even reaches the playlist step — rather than surfacing failures only after clicking "Add to playlist."

**Manual resolution for unmatched songs:** clicking a flagged song's warning opens an inline Spotify track search for that song specifically, pre-filled with the song title and the correct artist (the original artist for a marked cover, otherwise the searched artist) as a starting query — the user can adjust it, see results, and pick the correct track, or explicitly mark that song as skipped, excluding it from the playlist add.

**Adding to a playlist:**

- A dropdown of the user's own Spotify playlists, fetched via `GET /me/playlists` (paginated), filtered to only ones the user can actually edit (owned by them, or marked `collaborative`) — playlists they merely follow aren't shown, since adding tracks to those would fail. If that filtered list is empty, show "You don't have any editable playlists yet — create one in Spotify first" instead of the dropdown, and keep "Add to playlist" disabled.
- An "Add to playlist" button, enabled once a playlist is selected. It stays disabled while any song is still unresolved (no auto-match, no manual pick, and not explicitly skipped) — every remaining song has to be resolved one way or another first.
- On click: `POST` the resolved, ordered list of track URIs (in the same order as the — possibly trimmed — setlist) to `/playlists/{playlist_id}/tracks`, appending them to the end of the selected playlist.
- On success, a confirmation shows how many songs were added (e.g., "14 of 14 songs added to \<playlist name>").

**Persistence:** this page's own working state (current search, curated song list, match results) is **not** cached in `localStorage` — it's a one-off task (search → curate → add), not something meant to be revisited later, so a fresh page load always starts back at the search form. It doesn't maintain any storage of its own at all: the "Shows from Concert Date Fetcher" list is read directly from Concert Date Fetcher's existing data, and the one write this page ever makes is back into that same data — removing an artist (or the whole entry) once its setlist has been added to a playlist, as described above.

**Backend endpoint needed:** `GET /api/setlists?artist=<name>&city=<city>` — proxies the setlist.fm search API call above and returns the matching setlist(s) as JSON. `city` is optional: the fallback search in Flow step 3 (artist's next most recent show overall) calls this same endpoint with only `artist` set, and the backend omits `cityName` from the setlist.fm request when `city` isn't provided.

**New environment variable:** `SETLISTFM_API_KEY` (added to `.env` / `.env.example`).

### Concert History

Route: `/concert-history`.

**Data model** (all stored in `localStorage`, e.g. under a `concertHistory` key — this data is user-authored and is the *source of truth*, not a re-fetchable cache like Concert Date Fetcher's; clearing browser storage or switching browsers loses the folder structure, though the media itself stays safe in Google Drive):

```
{
  artists: [
    {
      spotifyArtistId: "...",
      artistName: "...",
      concerts: [
        {
          id: "...",
          name: "...",
          images: [ { id, embedSrc } ],
          videos: [ { id, embedSrc } ]
        }
      ]
    }
  ]
}
```

**Navigation:** a single page with client-side folder browsing and a breadcrumb ("Artists > \<Artist> > \<Concert>"):

1. **Artists view** (top level): a grid of artist folders already created, each showing the artist's Spotify profile image alongside the name (from the followed-artists API response) — same missing-image fallback as Followed Artists Graph: a plain accent-colored circle instead of a broken image if an artist has no image at all. If no artist folders exist yet, show "No artists yet — use '+ Add artist' to get started" instead of an empty grid. An "+ Add artist" control opens a searchable dropdown/autocomplete of the user's Spotify followed artists (the same `GET /me/following?type=artist` call, paginated, used by Concert Date Fetcher — worth sharing as one small helper, e.g. `public/js/spotify.js`), excluding artists that already have a folder — if that leaves nothing to pick from (no followed artists, or every one of them already has a folder), the control shows "No more artists to add" instead of an empty dropdown. Picking one creates the folder.
2. **Concerts view** (inside an artist folder): a grid of concert subfolders, sorted alphabetically by name (like the artist folders above them). An "+ Add concert" control is a plain text input where the user types a name (e.g. "Berlin, Summer 2024") to create a new subfolder.
3. **Media view** (inside a concert subfolder): two sections — **Images** (a grid of embedded Drive previews) and **Videos** (a single-column list of embedded Drive previews, larger). Each section has its own "+ Add image" / "+ Add video" control: a text area where the user pastes one or more Drive links/embed snippets — either Google Drive's **embed code** (the `<iframe>` snippet from Drive's *Share → Embed item*) or a plain Drive share link (`.../file/d/FILE_ID/view...`), one per line, mixed formats allowed. Submitting adds all of them at once. Which section the user adds it in determines whether they're stored as images or videos — Drive's URL format doesn't distinguish file type on its own.
4. The breadcrumb lets the user step back up a level at any point.
5. The page also supports a `?artist=<spotifyArtistId>` query param on load: if a matching artist folder already exists, the page opens directly into that artist's Concerts view instead of the top-level Artists view. Used by the Followed Artists Graph page's concert-count badge to deep-link here.

**Parsing pasted input:** the text area accepts multiple lines at once, each either a full `<iframe>` embed snippet or a plain Drive share link. Split the input by line, and for each non-empty line extract the Drive file ID (from the `src` of an `<iframe>`, or from the `/file/d/<ID>/` segment of a share link) via a simple regex, then build the page's own `<iframe src="https://drive.google.com/file/d/<ID>/preview">` with consistent, fixed dimensions for that section (grid cell vs. video list item) — never inserting the user's raw pasted HTML directly into the page, and ignoring whatever width/height attributes an embed snippet included. Lines with no recognizable Drive file ID are skipped and listed in an inline error ("Couldn't recognize N of the pasted lines") rather than blocking the valid ones from being added.

**Folder/media management:** every artist folder, concert subfolder, and individual media item can be deleted — all of them ask for confirmation first (for a folder, because deleting one removes everything nested inside it); concert subfolder names can be renamed. Deleting an artist folder makes that artist available again in the "+ Add artist" dropdown. Deleting a media item only removes its reference from this list — it never touches or deletes anything in the user's actual Google Drive.

**Backend:** none needed — this page is entirely client-side, reusing the same Spotify followed-artists endpoint as Concert Date Fetcher and storing everything in `localStorage`. No new environment variables.

### Discogs

Route: `/discogs`.

**Discogs profile link:** a plain link labeled "Discogs" pointing to `https://www.discogs.com/user/ci_de/collection`, shown near the top of the page. (The username `ci_de`, taken from that URL, is hardcoded — same as the other fixed personal links in this plan, like Spotify Video Matcher's and Spotify Release List's URLs — not an environment variable.)

**Pick of the Day:** the page's other feature, shown at the top, above "Check for new releases" below. On every page load — no button, nothing cached — the app picks one random item from the user's Discogs collection and suggests it as something to listen to today; reloading the page picks again.

- A backend endpoint — `GET /api/discogs/random-collection-item` — proxies this efficiently rather than downloading the whole collection on every load: it first requests a single item (`GET https://api.discogs.com/users/ci_de/collection/folders/0/releases?per_page=1&page=1`, folder `0` being Discogs's built-in "All" folder) purely to read the total item count from the response's `pagination.items`, picks a random index between 1 and that count, converts it to a page number + position using a fixed page size (e.g. `per_page=50`), then makes one more request for that specific page and returns just the item at that position (title, artist, cover image, and a link to that entry on Discogs).
- Rendered as a small card: cover image, title, artist, and a link that opens that item on Discogs in a new tab. While it's loading (both requests need to complete first), the card shows a small loading state rather than staying blank. If the lookup fails (rate limit, network error) or the collection turns out to be empty, the card shows a short message instead (e.g. "Couldn't load a pick for today" or "Your Discogs collection is empty") rather than an empty space.
- Not persisted anywhere in `localStorage` — this is intentionally ephemeral, changing every time the page loads, per the request. It's still subject to the same page-level Spotify-login gating as the rest of the page, even though it doesn't itself use any Spotify data, for consistency with every other internal page.

**Initial state:** on page load, "Pick of the Day" (above) loads automatically per its own description, and below it just a **"Check for new releases"** button — both subject to the usual page-level Spotify-login gating from Step 1.

**Flow, triggered by the button:**

1. Fetch all followed artists via the same `GET /me/following?type=artist` call (paginated) used elsewhere. If the user follows no artists at all, show "You don't follow any artists on Spotify yet."
2. Determine the cutoff: if the page has never checked before (no `lastCheckedAt` stored yet), use `2026-01-01` as the cutoff; otherwise use the stored `lastCheckedAt` from the previous check. Capture the current time as `checkStartedAt` before making any Discogs calls — this becomes the new `lastCheckedAt` once the check completes, so nothing released while the check itself is running gets missed on the next run.
3. For each followed artist, call a backend endpoint — `GET /api/discogs/releases?artist=<name>&since=<cutoff ISO date>` — that proxies the Discogs API server-side (the Discogs token stays server-side, same reasoning as every other third-party key in this project):
   - Searches `GET https://api.discogs.com/database/search?type=release&artist=<name>&sort=year&sort_order=desc` (with an `Authorization: Discogs token=<DISCOGS_TOKEN>` header and a descriptive `User-Agent` header — both required by Discogs), walking result pages newest-year-first and stopping as soon as a page's results drop below the cutoff's year — no need to page through an artist's entire back catalog every time.
   - For each candidate release whose year is at or after the cutoff's year, fetches its full detail (`GET https://api.discogs.com/releases/<id>`) to get the exact `released` date — search results only give a coarse year, not a full date — then keeps only the ones whose exact release date is after the cutoff. Candidates missing a year or a release date entirely (incomplete Discogs catalog entries happen) are skipped, since there's no way to tell if they're actually new.
   - Returns the filtered list (id, title, artist, Discogs release URL, cover image, exact release date) as JSON.
4. These calls (search and detail fetches together) are made sequentially with a small fixed delay between each (e.g. \~1100ms, keeping well under Discogs's 60-requests-per-minute limit for authenticated requests). While this runs, the button is disabled and shows a "Checking…" state, with a progress bar/count similar to Followed Artists Graph's Last.fm fetch. Any single artist's failed lookup (rate limit, network error) is skipped and recorded, continuing with the rest rather than aborting the whole thing.
5. Once the check finishes, if any artists' Discogs lookups failed, show a small dismissible notice listing them (e.g. "Couldn't check Discogs for: Artist A, Artist B"), mirroring the same pattern used on Concert Date Fetcher and Followed Artists Graph.
6. Dedupe the newly found releases (by Discogs release id, in case two followed artists both turn up on the same release) and sort them descending by release date (most recent first).
7. Render this run's release list and save it to `localStorage`, **replacing** whatever was stored before — previously found releases are not carried forward or merged; every check only ever shows what's newly found since the last one, and anything from before gets removed from storage as part of that overwrite. If nothing new turned up, show "No new releases found since your last check." instead of an empty area. `lastCheckedAt` only advances to `checkStartedAt` if the check had **zero** failed artist lookups; if any artist failed, the cutoff is left where it was, so the next check re-covers the same window rather than risking a permanently missed release from whichever artist failed.

**Each release item shows:**

- Cover image (Discogs's `cover_image`/`thumb`)
- Release title
- Artist name
- Release date
- A link to the release's Discogs page, opens in a new tab
- Card styling: rounded corners with a plain grayish border, consistent with the rest of the app. There's no new-vs-old distinction here (unlike Concert Date Fetcher and Followed Artists Graph) — since every render only ever contains the current check's fresh finds, there's nothing "old" left on screen to distinguish from.

**Persistence:** on page load, if `localStorage` already holds a result from the last check, render it immediately, along with a small "Last checked: \<timestamp>" label near the button, so closing and reopening the page keeps showing the last run's finds. The button always triggers a fresh check, and its result **fully replaces** whatever was stored — nothing accumulates across checks, unlike Concert Date Fetcher or Followed Artists Graph. Stored under a `discogsVinylReleases` key:

```
{
  lastCheckedAt: "2026-09-20T10:00:00Z",
  releases: [
    {
      id: "...",
      title: "...",
      artist: "...",
      imageUrl: "...",
      releaseUrl: "...",
      releasedDate: "2026-08-15"
    }
  ]
}
```

**Backend endpoint needed:** `GET /api/discogs/releases?artist=<name>&since=<ISO date>` — proxies the Discogs search + detail-fetch logic above and returns the filtered release list as JSON.

**New environment variable:** `DISCOGS_TOKEN` — a personal access token generated in Discogs' account settings (Settings → Developers), not a full OAuth app; the simplest option for a single-user project, same shape as the other simple-key integrations (Ticketmaster, setlist.fm, Last.fm). Added to `.env` / `.env.example`.

**Known limitation:** matching relies on searching Discogs by the artist's name text, and Discogs's naming conventions occasionally differ from Spotify's (e.g. articles moved to the end — "Beatles, The" instead of "The Beatles"), which can cause an occasional artist to be missed or mismatched. Same category of limitation as the Last.fm name-matching on Followed Artists Graph — not something to engineer around, just worth knowing.

## Deployment

This is a manual, one-time setup on Render's side — not something Claude Code can do, since it has no access to the Render dashboard:

1. Create a new **Web Service** on Render, connected to this GitHub repo.
2. Set the **runtime to Docker** — Render builds and runs the project's own `Dockerfile` directly, so no separate build/start command configuration is needed.
3. Set the **branch** to deploy from (typically `main`) — Render auto-deploys on every push to it by default.
4. Under the service's **Environment** settings, add every variable from `.env.example` with its real value: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` (the live one, `https://music-hub-r9w6.onrender.com/callback`), `SESSION_SECRET` (from `make generate-secret`), `TICKETMASTER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (the live one, `https://music-hub-r9w6.onrender.com/auth/google/callback`), `SETLISTFM_API_KEY`, `LASTFM_API_KEY`, `DISCOGS_TOKEN`. Do **not** set `PORT` — Render assigns and injects its own, which the app already reads via `process.env.PORT`.
5. Make sure `https://music-hub-r9w6.onrender.com/callback` and `https://music-hub-r9w6.onrender.com/auth/google/callback` are registered as redirect URIs in the Spotify Developer Dashboard and the Google Cloud OAuth client respectively (already done per earlier notes in this plan).

**Known limitations of the free plan** (already factored into this plan's design): the service spins down after a period of inactivity and cold-starts on the next request — which is why the app avoids any server-side session state — and there's no persistent disk or database, which is why everything user-specific lives in `localStorage`.
