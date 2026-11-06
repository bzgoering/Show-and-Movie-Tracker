import express from 'express';
import { predictNextRelease } from './predict.js';

const STALE_MS = 24 * 60 * 60 * 1000;
const LABELS = {
  movie: ['planned', 'watched'],
  tv: ['planned', 'watching', 'watched'],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const itemId = (type, tmdbId) => `tmdb-${type}-${tmdbId}`;

function withPrediction(item) {
  if (item.type !== 'tv') return item;
  return { ...item, prediction: predictNextRelease(item.cache, { userMarkedEnded: item.userMarkedEnded }) };
}

const isStale = (item) => !item.cache?.lastFetched || Date.now() - Date.parse(item.cache.lastFetched) > STALE_MS;

// `tmdb` is injected so tests can swap in a fake.
export function createApp({ store, tmdb, publicDir }) {
  const app = express();
  app.use(express.json());
  if (publicDir) app.use(express.static(publicDir));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  async function refreshItem(item) {
    const details = await tmdb.getDetails(item.type, item.tmdbId);
    Object.assign(item, {
      title: details.title,
      year: details.year,
      posterPath: details.posterPath,
      overview: details.overview,
      cache: details.cache,
      updatedAt: new Date().toISOString(),
    });
  }

  app.get('/api/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const [results, data] = await Promise.all([tmdb.search(q), store.read()]);
    const owned = new Set(data.items.map((i) => i.id));
    res.json(results.map((r) => ({ ...r, inLibrary: owned.has(itemId(r.type, r.tmdbId)) })));
  }));

  app.get('/api/library', wrap(async (req, res) => {
    let data = await store.read();
    if (process.env.TMDB_API_KEY && data.items.some(isStale)) {
      // Refresh anything older than a day. If TMDB is down, the old data is kept.
      data = await store.update(async (d) => {
        await Promise.allSettled(d.items.filter(isStale).map(refreshItem));
        return d;
      });
    }
    res.json(data.items.map(withPrediction));
  }));

  app.post('/api/library', wrap(async (req, res) => {
    const { type, tmdbId } = req.body || {};
    const id = Number(tmdbId);
    if (!LABELS[type] || !Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Body must include type ("movie" or "tv") and a numeric tmdbId.');
    }
    const label = LABELS[type].includes(req.body.label) ? req.body.label : 'planned';
    const details = await tmdb.getDetails(type, id);

    const item = await store.update((data) => {
      const existing = data.items.find((i) => i.id === itemId(type, id));
      if (existing) return existing;
      const now = new Date().toISOString();
      const created = {
        id: itemId(type, id),
        tmdbId: id,
        type,
        title: details.title,
        year: details.year,
        posterPath: details.posterPath,
        overview: details.overview,
        label,
        ...(type === 'tv' ? { progress: { season: 1, episode: 0 }, userMarkedEnded: false } : {}),
        cache: details.cache,
        addedAt: now,
        updatedAt: now,
      };
      data.items.unshift(created);
      return created;
    });
    res.status(201).json(withPrediction(item));
  }));

  app.patch('/api/library/:id', wrap(async (req, res) => {
    const body = req.body || {};
    const item = await store.update((data) => {
      const found = data.items.find((i) => i.id === req.params.id);
      if (!found) throw new HttpError(404, 'Item not in library.');

      if ('label' in body) {
        if (!LABELS[found.type].includes(body.label)) {
          throw new HttpError(400, `Label must be one of: ${LABELS[found.type].join(', ')}.`);
        }
        found.label = body.label;
      }

      if (found.type === 'tv') {
        if ('progress' in body) {
          const season = Number(body.progress?.season);
          const episode = Number(body.progress?.episode);
          if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 0) {
            throw new HttpError(400, 'Progress needs a season of 1 or more and an episode of 0 or more.');
          }
          found.progress = { season, episode };
        }
        if ('userMarkedEnded' in body) found.userMarkedEnded = Boolean(body.userMarkedEnded);
      }

      found.updatedAt = new Date().toISOString();
      return found;
    });
    res.json(withPrediction(item));
  }));

  app.delete('/api/library/:id', wrap(async (req, res) => {
    await store.update((data) => {
      const before = data.items.length;
      data.items = data.items.filter((i) => i.id !== req.params.id);
      if (data.items.length === before) throw new HttpError(404, 'Item not in library.');
    });
    res.status(204).end();
  }));

  app.post('/api/library/:id/refresh', wrap(async (req, res) => {
    const item = await store.update(async (data) => {
      const found = data.items.find((i) => i.id === req.params.id);
      if (!found) throw new HttpError(404, 'Item not in library.');
      await refreshItem(found);
      return found;
    });
    res.json(withPrediction(item));
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err.name === 'TmdbError' ? `[tmdb] ${err.message}` : err);
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });

  return app;
}
