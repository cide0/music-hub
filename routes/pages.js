import { Router } from 'express';

import { pages, tabs } from '../config/navigation.js';

const router = Router();

// The app has no page of its own at `/` - it always opens on the default tab.
router.get('/', (req, res) => {
  res.redirect('/concert-date-fetcher');
});

for (const page of pages) {
  router.get(page.path, (req, res) => {
    res.render(page.view, {
      tabs,
      activePath: page.path,
      pageTitle: page.title,
    });
  });
}

export default router;
