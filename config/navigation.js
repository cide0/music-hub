// Single source of truth for the navbar tabs, used by every page route.
export const tabs = [
  { label: 'Concerts', title: 'Upcoming concerts', href: '/concert-date-fetcher', external: false },
  { label: 'Artist Graph', href: '/followed-artists-graph', external: false },
  { label: 'Setlist Fetcher', href: '/setlist-fetcher', external: false },
  { label: 'Concert Gallery', href: '/concert-history', external: false },
  { label: 'Discogs', href: '/discogs', external: false },
  { label: 'Album Suggester', href: '/album-suggester', external: false },
  { label: 'Video Matcher', href: 'https://spotify-video-matcher.onrender.com/', external: true },
  { label: 'Release List', href: 'https://spotifyreleaselist.netlify.app/', external: true },
  { label: 'Listening Stats', href: 'https://stats.fm/user/cide?range=lifetime', external: true },
];

// Every internal page renders from a view of the same name. A tab can carry
// its own `title` when the page heading should read differently from the
// (shorter) label in the navbar. Settings isn't a tab - the navbar's gear
// icon links to it.
export const pages = tabs
  .filter((tab) => !tab.external)
  .map((tab) => ({
    path: tab.href,
    view: tab.href.slice(1),
    title: tab.title || tab.label,
  }))
  .concat({ path: '/settings', view: 'settings', title: 'Settings' });
