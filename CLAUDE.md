# Music Hub – Claude Code Guide

## Project summary

Node.js/Express web app with Spotify integration at its core, plus Ticketmaster
(concert search), Google Calendar and Google Drive (event/media embeds), Last.fm
(artist similarity data), setlist.fm (setlist search) and Discogs (collection /
new releases). The frontend is plain HTML/CSS/JS — multi-page, EJS-templated,
no frontend framework. Dockerized, deployed on Render.com (Free Plan — **no
database**, and the service sleeps/restarts, so no server-side state survives).

**Module system:** ES Modules (`"type": "module"`, `import`/`export`).

## Rules

- Never commit `.env` or any secret value — only `.env.example` with placeholders.
- No API key or secret (Spotify client secret, Ticketmaster, Google, setlist.fm,
  Last.fm, Discogs, `SESSION_SECRET`) is ever sent to or used in client-side
  code. Each one is read from `process.env` on the server only, inside the
  backend proxy endpoint that needs it.
- All persisted state (login tokens, page content/caches) lives in the browser
  (`localStorage`) — there is no database and no server-side session store.
  Go through `public/js/storage.js`, and add any new app-data key to its
  `APP_DATA_KEYS` list so Export/Import keeps working.
- All colors come from the CSS custom properties in `public/css/variables.css` —
  never hard-code hex values elsewhere.
- Every page must work on mobile too (responsive grids, tabs collapsing into the
  hamburger menu, comfortable touch targets).
- Use the Makefile targets (`make install`, `make up`, `make down`, `make list`, …)
  for Docker/dependency workflows rather than raw `docker`/`npm` commands.

## Layout

```
server.js            Express app (static files, EJS views, routers)
config/navigation.js Navbar tabs + page routes (single source of truth)
routes/auth.js       /login, /callback, POST /api/spotify/refresh
routes/pages.js      Page routes; / redirects to /concert-date-fetcher
views/               EJS pages + partials/ (head, navbar)
public/css/          variables.css (palette) + style.css
public/js/           storage.js, navbar.js, auth.js (loaded on every page)
```

## Auth

Spotify login is the Authorization Code Flow with PKCE, **stateless**: the PKCE
verifier and the return path are HMAC-signed with `SESSION_SECRET` into the
OAuth `state` param, so nothing is stored server-side. `/callback` exchanges the
code server-side and hands the tokens to an inline script that writes them to
`localStorage` under `spotifyAuth`. `public/js/auth.js` handles expiry checks
and silent refresh (via `POST /api/spotify/refresh`) and gates page content:
elements marked `data-auth-required` render only when logged in, while
`data-auth-missing` shows "Please log in to Spotify first". The gating itself
is pure CSS, driven by `.is-logged-in` / `.is-logged-out` on `<html>` — set by
an inline script in `views/partials/head.ejs` before the first paint, so
neither state ever flashes. Mark new elements with those attributes rather
than toggling them from page scripts.

## Full spec

`docs/PLAN.md` holds the complete page-by-page specification, design palette and
the implementation steps. Implement those steps **one at a time**, stopping for
the user to test after each one.
