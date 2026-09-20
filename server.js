import path from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import express from 'express';

import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import googleRouter from './routes/google.js';
import pagesRouter from './routes/pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

app.use(authRouter);
app.use(googleRouter);
app.use(apiRouter);
app.use(pagesRouter);

app.use((req, res) => {
  res.status(404).send('Not found');
});

// Render assigns its own port in production; locally this falls back to the
// value from .env.
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Music Hub listening on port ${port}`);
});
