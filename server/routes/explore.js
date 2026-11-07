// /api/explore: suggestions, and titles you've hidden with "Not interested".
import { Router } from 'express';
import { mediaKey } from '../../public/shared/media.js';
import {
  buildExplore,
  EXPLORE_TYPES,
  exploreStats,
  genreOptions,
  recentSuggestion,
  recordFeedback,
  takeBackFeedback,
} from '../explore/index.js';
import { asyncRoute, HttpError, parseMediaRef } from '../http.js';
import { settingsOf } from '../settings.js';

export function exploreRoutes({ store, tmdb }) {
  const router = Router();

  router.get(
    '/explore',
    asyncRoute(async (req, res) => {
      const type = Object.hasOwn(EXPLORE_TYPES, req.query.type ?? '') ? req.query.type : 'all';
      const data = await store.read();
      const settings = settingsOf(data);
      const genres = genreOptions(data.items, type);
      const genre = genres.includes(req.query.genre) ? req.query.genre : '';
      const items = await buildExplore({
        tmdb,
        items: data.items,
        region: settings.region,
        services: settings.services,
        type,
        dislikes: data.dislikes,
        feedback: data.feedback,
        genre,
      });
      res.json({
        items,
        ...settings,
        genres, // the genres you can filter by (from your library)
        genre, // the one applied ('' if none, or if the requested one isn't in your library)
        hidden: data.dislikes.length,
        stats: exploreStats(data.feedback),
      });
    }),
  );

  router.get(
    '/explore/dislikes',
    asyncRoute(async (req, res) => {
      res.json((await store.read()).dislikes.toReversed()); // newest first
    }),
  );

  // "Not interested": hides a suggestion for good, and counts a little against titles like it.
  router.post(
    '/explore/dislikes',
    asyncRoute(async (req, res) => {
      const ref = parseMediaRef(req.body);
      const key = mediaKey(ref.type, ref.tmdbId);
      let info = recentSuggestion(key);
      if (!info) {
        const d = await tmdb.getDetails(ref.type, ref.tmdbId);
        info = { title: d.title, posterPath: d.posterPath, genres: d.cache.genres };
      }
      const dislike = await store.update((data) => {
        const existing = data.dislikes.find((d) => mediaKey(d.type, d.tmdbId) === key);
        if (existing) return existing;
        const created = {
          ...ref,
          title: info.title,
          posterPath: info.posterPath ?? null,
          genres: info.genres ?? [],
          at: new Date().toISOString(),
        };
        data.dislikes.push(created);
        recordFeedback(data, ref, 'disliked');
        return created;
      });
      res.status(201).json(dislike);
    }),
  );

  router.delete(
    '/explore/dislikes/:key',
    asyncRoute(async (req, res) => {
      const { key } = req.params;
      if (!/^(movie|tv)-\d+$/.test(key)) throw new HttpError(400, 'Key must look like tv-123.');
      await store.update((data) => {
        const before = data.dislikes.length;
        data.dislikes = data.dislikes.filter((d) => mediaKey(d.type, d.tmdbId) !== key);
        if (data.dislikes.length === before) throw new HttpError(404, 'That title is not hidden.');
        takeBackFeedback(data, key, 'disliked'); // so a mis-click doesn't teach Explore anything
      });
      res.status(204).end();
    }),
  );

  return router;
}
