// Single source of truth for the navbar tabs, used by every page route.
export const tabs = [
  { label: 'Concert Date Fetcher', href: '/concert-date-fetcher', external: false },
  { label: 'Followed Artists Graph', href: '/followed-artists-graph', external: false },
  { label: 'Setlist Fetcher', href: '/setlist-fetcher', external: false },
  { label: 'Concert History', href: '/concert-history', external: false },
  { label: 'Discogs', href: '/discogs', external: false },
  { label: 'Spotify Video Matcher', href: 'https://spotify-video-matcher.onrender.com/', external: true },
  { label: 'Spotify Release List', href: 'https://spotifyreleaselist.netlify.app/', external: true },
  { label: 'Spotify Listening Stats', href: 'https://stats.fm/user/cide?range=lifetime', external: true },
];

// Every internal page renders from a view of the same name.
export const pages = tabs
  .filter((tab) => !tab.external)
  .map((tab) => ({
    path: tab.href,
    view: tab.href.slice(1),
    title: tab.label,
  }));
