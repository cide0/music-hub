# Music Hub

A personal music dashboard built around Spotify: upcoming concert dates for the
artists you follow, a similarity graph of those artists, a setlist-to-playlist
tool, a concert history archive and Discogs release checks.

Node.js/Express with a plain HTML/CSS/JS frontend (EJS-templated, no framework),
running in Docker and deployed on Render.com. There is no database — everything
user-specific is stored in the browser's `localStorage`.

## Setup

```bash
cp .env.example .env    # then fill in the real values
make generate-secret    # random value for SESSION_SECRET
make install            # build the Docker image and install dependencies
make up                 # start the app on http://127.0.0.1:8080
make down               # stop it again
make list               # show all available targets
```

`.env.example` lists every environment variable the app reads (Spotify,
Ticketmaster, Google, setlist.fm, Last.fm and Discogs credentials plus `PORT`).
Your real `.env` is git-ignored and must never be committed.

## Documentation

- `docs/PLAN.md` — the full project plan and page-by-page specification.
- `CLAUDE.md` — quick reference and rules for working in this repo.
