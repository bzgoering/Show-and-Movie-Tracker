// /api/search and /api/library: finding titles and managing your saved ones.
import { Router } from 'express';
import { libraryId, mediaKey } from '../../public/shared/media.js';
import { recordFeedback } from '../explore/index.js';
import { asyncRoute, HttpError, parseMediaRef } from '../http.js';
import { applyChanges, needsProviders, newItem, withPrediction } from '../library/items.js';
import { settingsOf } from '../settings.js';

export function libraryRoutes({ store, tmdb, sync, startupSync }) {
  const router = Router();
  const findItem = async (id) => (await store.read()).items.find((i) => i.id === id);

  router.get(
    '/search',
    asyncRoute(async (req, res) => {
      const q = String(req.query.q ?? '').trim();
      if (!q) return res.json([]);
      const [results, data] = await Promise.all([tmdb.search(q), store.read()]);
      const owned = new Set(data.items.map((i) => i.id));
      res.json(results.map((r) => ({ ...r, inLibrary: owned.has(libraryId(r.type, r.tmdbId)) })));
    }),
  );

  router.get(
    '/library',
    asyncRoute(async (req, res) => {
      // The app usually isn't left running, so every start refreshes the whole library, and the
      // first page load waits for that so it never shows outdated info.
      if (!(await startupSync.wait())) await sync.refreshStale();
      await sync.ensureProviders();
      const data = await store.read();
      res.json({ items: data.items.map(withPrediction), sync: sync.lastSync() });
    }),
  );

  router.post(
    '/library',
    asyncRoute(async (req, res) => {
      const ref = parseMediaRef(req.body);
      const fromExplore = req.body.from === 'explore';
      const details = await tmdb.getDetails(ref.type, ref.tmdbId);

      const { item, created } = await store.update((data) => {
        const existing = data.items.find((i) => i.id === libraryId(ref.type, ref.tmdbId));
        if (existing) return { item: existing, created: false };
        const item = newItem({ ...ref, details, label: req.body.label, fromExplore });
        data.items.unshift(item);
        // Adding something you'd hidden from Explore means you're interested after all.
        data.dislikes = data.dislikes.filter((d) => mediaKey(d.type, d.tmdbId) !== mediaKey(ref.type, ref.tmdbId));
        // Adding a suggestion to watch later, or saying you've already watched it, both mean it was a good one.
        if (fromExplore) recordFeedback(data, ref, 'added', { label: item.label });
        return { item, created: true };
      });

      if (!created) return res.json(withPrediction(item));
      if (item.label === 'planned') await sync.ensureProviders([item.id]);
      res.status(201).json(withPrediction(await findItem(item.id)));
    }),
  );

  router.patch(
    '/library/:id',
    asyncRoute(async (req, res) => {
      const { item, region } = await store.update((data) => {
        const found = data.items.find((i) => i.id === req.params.id);
        if (!found) throw new HttpError(404, 'Item not in library.');
        return { item: applyChanges(found, req.body), region: settingsOf(data).region };
      });
      // Relabeled as Planned: look up where it streams.
      if (needsProviders(item, region)) await sync.ensureProviders([item.id]);
      res.json(withPrediction((await findItem(item.id)) ?? item));
    }),
  );

  router.delete(
    '/library/:id',
    asyncRoute(async (req, res) => {
      await store.update((data) => {
        const before = data.items.length;
        data.items = data.items.filter((i) => i.id !== req.params.id);
        if (data.items.length === before) throw new HttpError(404, 'Item not in library.');
      });
      res.status(204).end();
    }),
  );

  router.post(
    '/library/:id/refresh',
    asyncRoute(async (req, res) => {
      const item = await sync.refreshOne(req.params.id);
      if (!item) throw new HttpError(404, 'Item not in library.');
      res.json(withPrediction(item));
    }),
  );

  return router;
}
