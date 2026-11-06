import express from 'express';
import { isRevived, predictNextRelease } from './predict.js';
import { buildExplore, exploreStats, recentSuggestion } from './explore.js';

// If the app is left open, anything older than this is refreshed again on the next page load.
const STALE_MS = 6 * 60 * 60 * 1000;
const REFRESH_CONCURRENCY = 4;
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

// Remembers what you did with an Explore suggestion and what its score was based on,
// so Explore can learn which signals match your taste (see learnWeights in explore.js).
function recordFeedback(data, type, tmdbId, action) {
  const s = recentSuggestion(`${type}-${tmdbId}`);
  data.feedback = [...(data.feedback || []), { key: `${type}-${tmdbId}`, action, match: s?.match ?? null, parts: s?.parts ?? null, at: new Date().toISOString() }].slice(-500);
}

function withPrediction(item) {
  if (item.type !== 'tv') return item;
  return { ...item, prediction: predictNextRelease(item.cache, { userMarkedEnded: item.userMarkedEnded }) };
}

const isStale = (item) => !item.cache?.lastFetched || Date.now() - Date.parse(item.cache.lastFetched) > STALE_MS;

// `tmdb` is injected so tests can swap in a fake.
export function createApp({ store, tmdb, publicDir, syncOnStart = false }) {
  const app = express();
  app.use(express.json());
  if (publicDir) app.use(express.static(publicDir));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  const defaultRegion = () => (process.env.WATCH_REGION || 'US').toUpperCase();
  const settingsOf = (data) => ({ region: defaultRegion(), services: [], ...(data.settings || {}) });

  // Where a Planned title is streaming, in your country. Saved with the title's info.
  const needsProviders = (item, region) => item.label === 'planned' && item.cache?.providers?.region !== region;
  async function attachProviders(item, region) {
    try {
      const w = await tmdb.watchProviders(item.type, item.tmdbId, region);
      item.cache = { ...item.cache, providers: { region, ...w } };
    } catch {
      // Not critical: the card just won't show services until the next refresh.
    }
  }

  // Fills in streaming info for Planned titles that don't have it for your country yet.
  async function ensureProviders() {
    if (!process.env.TMDB_API_KEY) return;
    const data = await store.read();
    const region = settingsOf(data).region;
    if (!data.items.some((i) => needsProviders(i, region))) return;
    await store.update(async (d) => {
      const queue = d.items.filter((i) => needsProviders(i, region));
      const worker = async () => {
        for (let item = queue.shift(); item; item = queue.shift()) await attachProviders(item, region);
      };
      await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
    });
  }

  async function refreshItem(item, region) {
    const details = await tmdb.getDetails(item.type, item.tmdbId);

    // A finished show came back (renewed, revived, rebranded): un-finish it so it shows up
    // again under Waiting, or Watching if new episodes are already out.
    if (item.type === 'tv' && item.cache && isRevived(item.cache, details.cache, item.userMarkedEnded)) {
      item.userMarkedEnded = false;
      if (item.label === 'watched') item.label = 'watching';
      item.revivedAt = new Date().toISOString();
      console.log(`[sync] "${details.title}" is back (${details.cache.status}). Moved it out of Watched.`);
    }

    Object.assign(item, {
      title: details.title,
      year: details.year,
      posterPath: details.posterPath,
      overview: details.overview,
      cache: details.cache, // cache.lastFetched records when TMDB info was refreshed
    });
    if (item.label === 'planned' && region) await attachProviders(item, region);
  }

  app.get('/api/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    const [results, data] = await Promise.all([tmdb.search(q), store.read()]);
    const owned = new Set(data.items.map((i) => i.id));
    res.json(results.map((r) => ({ ...r, inLibrary: owned.has(itemId(r.type, r.tmdbId)) })));
  }));

  // Refreshes saved titles from TMDB, a few at a time. User data (labels, progress) is never touched,
  // and if TMDB can't be reached the saved info is kept as it was.
  let lastSync = null;
  async function refreshAll({ onlyStale = false } = {}) {
    if (!process.env.TMDB_API_KEY) {
      lastSync = { at: new Date().toISOString(), updated: 0, failed: 0, error: 'TMDB_API_KEY is not set.' };
      return lastSync;
    }
    let updated = 0;
    const errors = [];
    await store.update(async (data) => {
      const region = settingsOf(data).region;
      const queue = data.items.filter((i) => !onlyStale || isStale(i));
      async function worker() {
        for (let item = queue.shift(); item; item = queue.shift()) {
          try {
            await refreshItem(item, region);
            updated++;
          } catch (err) {
            errors.push(err.message);
          }
        }
      }
      await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
    });
    lastSync = { at: new Date().toISOString(), updated, failed: errors.length, error: errors[0] || null };
    if (updated || errors.length) {
      console.log(`[sync] Updated ${updated} title${updated === 1 ? '' : 's'} from TMDB${errors.length ? `, ${errors.length} failed (${errors[0]})` : ''}.`);
    }
    return lastSync;
  }

  // The app usually isn't left running, so every start refreshes the whole library.
  // The first page load waits for this so it never shows outdated info.
  let startupSync = syncOnStart ? refreshAll().catch((err) => ({ error: err.message })) : null;
  app.refreshAll = refreshAll;

  app.get('/api/library', wrap(async (req, res) => {
    if (startupSync) {
      await startupSync;
      startupSync = null;
    } else if (process.env.TMDB_API_KEY && (await store.read()).items.some(isStale)) {
      await refreshAll({ onlyStale: true });
    }
    await ensureProviders();
    const data = await store.read();
    res.json({ items: data.items.map(withPrediction), sync: lastSync });
  }));

  app.post('/api/library', wrap(async (req, res) => {
    const { type, tmdbId } = req.body || {};
    const id = Number(tmdbId);
    if (!LABELS[type] || !Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Body must include type ("movie" or "tv") and a numeric tmdbId.');
    }
    const label = LABELS[type].includes(req.body.label) ? req.body.label : 'planned';
    const fromExplore = req.body.from === 'explore';
    const details = await tmdb.getDetails(type, id);

    const item = await store.update(async (data) => {
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
      if (fromExplore) {
        created.addedFrom = 'explore';
        recordFeedback(data, type, id, 'added');
      }
      if (created.label === 'planned') await attachProviders(created, settingsOf(data).region);
      // Adding something you'd hidden means you're interested after all.
      if (data.dislikes) data.dislikes = data.dislikes.filter((d) => !(d.type === type && d.tmdbId === id));
      data.items.unshift(created);
      return created;
    });
    res.status(201).json(withPrediction(item));
  }));

  app.patch('/api/library/:id', wrap(async (req, res) => {
    const body = req.body || {};
    const item = await store.update(async (data) => {
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
          const last = found.cache?.lastEpisode;
          if (last && (season > last.season || (season === last.season && episode > last.episode))) {
            throw new HttpError(400, `S${season} E${episode} hasn't aired yet. The newest episode is S${last.season} E${last.episode}.`);
          }
          found.progress = { season, episode };
        }
        if ('userMarkedEnded' in body) found.userMarkedEnded = Boolean(body.userMarkedEnded);
      }

      found.updatedAt = new Date().toISOString();
      if (needsProviders(found, settingsOf(data).region)) await attachProviders(found, settingsOf(data).region);
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
      await refreshItem(found, settingsOf(data).region);
      return found;
    });
    res.json(withPrediction(item));
  }));

  // ---------- Explore ----------


  app.get('/api/settings', wrap(async (req, res) => {
    res.json(settingsOf(await store.read()));
  }));

  app.put('/api/settings', wrap(async (req, res) => {
    const body = req.body || {};
    const settings = await store.update((data) => {
      const next = settingsOf(data);
      if ('region' in body) {
        if (!/^[A-Z]{2}$/.test(String(body.region))) throw new HttpError(400, 'Region must be a two-letter country code, like US.');
        next.region = body.region;
      }
      if ('services' in body) {
        const ids = Array.isArray(body.services) ? body.services.map(Number) : [];
        if (ids.some((id) => !Number.isInteger(id) || id <= 0) || ids.length > 50) throw new HttpError(400, 'Services must be a list of provider ids.');
        next.services = [...new Set(ids)];
      }
      data.settings = next;
      return next;
    });
    res.json(settings);
  }));

  app.get('/api/providers', wrap(async (req, res) => {
    const region = String(req.query.region || settingsOf(await store.read()).region).toUpperCase();
    res.json(await tmdb.providerList(region));
  }));

  app.get('/api/regions', wrap(async (req, res) => {
    res.json(await tmdb.regions());
  }));

  app.get('/api/explore', wrap(async (req, res) => {
    const type = ['movie', 'tv'].includes(req.query.type) ? req.query.type : 'all';
    const data = await store.read();
    const settings = settingsOf(data);
    const items = await buildExplore({
      tmdb,
      items: data.items,
      region: settings.region,
      services: settings.services,
      type,
      dislikes: data.dislikes || [],
      feedback: data.feedback || [],
    });
    res.json({ items, ...settings, hidden: (data.dislikes || []).length, stats: exploreStats(data.feedback) });
  }));

  // "Not interested": hides a suggestion and counts against titles like it.
  app.get('/api/explore/dislikes', wrap(async (req, res) => {
    res.json([...((await store.read()).dislikes || [])].reverse());
  }));

  app.post('/api/explore/dislikes', wrap(async (req, res) => {
    const { type, tmdbId } = req.body || {};
    const id = Number(tmdbId);
    if (!LABELS[type] || !Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Body must include type and tmdbId.');
    let info = recentSuggestion(`${type}-${id}`);
    if (!info) {
      const d = await tmdb.getDetails(type, id);
      info = { title: d.title, posterPath: d.posterPath, genres: d.cache.genres || [] };
    }
    const dislike = await store.update((data) => {
      data.dislikes = data.dislikes || [];
      const existing = data.dislikes.find((d) => d.type === type && d.tmdbId === id);
      if (existing) return existing;
      const created = { type, tmdbId: id, title: info.title, posterPath: info.posterPath || null, genres: info.genres || [], at: new Date().toISOString() };
      data.dislikes.push(created);
      recordFeedback(data, type, id, 'disliked');
      return created;
    });
    res.status(201).json(dislike);
  }));

  app.delete('/api/explore/dislikes/:key', wrap(async (req, res) => {
    const m = /^(movie|tv)-(\d+)$/.exec(req.params.key);
    if (!m) throw new HttpError(400, 'Key must look like tv-123.');
    const [, type, idText] = m;
    const id = Number(idText);
    await store.update((data) => {
      const before = (data.dislikes || []).length;
      data.dislikes = (data.dislikes || []).filter((d) => !(d.type === type && d.tmdbId === id));
      if (data.dislikes.length === before) throw new HttpError(404, 'That title is not hidden.');
      // Undoing also takes back the feedback, so a mis-click doesn't teach Explore anything.
      const fb = data.feedback || [];
      const last = fb.map((f) => f.key === req.params.key && f.action === 'disliked').lastIndexOf(true);
      if (last !== -1) fb.splice(last, 1);
    });
    res.status(204).end();
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
