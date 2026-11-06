// The web app: serves the page and the JSON API under /api.
// `store` and `tmdb` are passed in so tests can use a temporary file and a fake TMDB.
import express from 'express';
import { createLibrarySync } from './library/sync.js';
import { exploreRoutes } from './routes/explore.js';
import { libraryRoutes } from './routes/library.js';
import { settingsRoutes } from './routes/settings.js';

// The refresh started when the app starts. wait() resolves once it's done: true the first time
// (that page load got fresh data), false after that or when there was no startup refresh.
function startupRefresh(sync, enabled) {
  let pending = enabled ? sync.refreshAll().catch((err) => console.error('[sync]', err.message)) : null;
  return {
    async wait() {
      if (!pending) return false;
      await pending;
      pending = null;
      return true;
    },
  };
}

// isOutdated() says whether the server's code changed on disk since it started (see code-version.js).
export function createApp({ store, tmdb, publicDir, syncOnStart = false, isOutdated = () => false }) {
  const sync = createLibrarySync({ store, tmdb });
  const startupSync = startupRefresh(sync, syncOnStart);

  const app = express();
  app.use(express.json());
  if (publicDir) app.use(express.static(publicDir));

  app.use('/api', libraryRoutes({ store, tmdb, sync, startupSync, isOutdated }));
  app.use('/api', settingsRoutes({ store, tmdb }));
  app.use('/api', exploreRoutes({ store, tmdb }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // Errors with a status (bad input, TMDB problems) show their message; unexpected ones are logged
  // and the browser gets a generic message instead of internal details.
  app.use((err, req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    const expected = status < 500 || err.name === 'TmdbError';
    if (status >= 500) console.error(err.name === 'TmdbError' ? `[tmdb] ${err.message}` : err);
    res.status(status).json({ error: expected ? err.message : 'Something went wrong.' });
  });

  return app;
}
