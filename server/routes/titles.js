// /api/titles/:type/:tmdbId: everything the "look at this title" pop-up shows, for titles you may not have added yet.
import { Router } from 'express';
import { libraryId } from '../../public/shared/media.js';
import { asyncRoute, parseMediaRef } from '../http.js';
import { settingsOf } from '../settings.js';

// Only the fields the page needs, not TMDB's whole payload.
function titleView({ type, tmdbId }, details, providers, region, inLibrary) {
  const c = details.cache ?? {};
  return {
    type,
    tmdbId,
    title: details.title,
    year: details.year ?? null,
    posterPath: details.posterPath ?? null,
    overview: details.overview ?? '',
    genres: c.genres ?? [],
    status: c.status ?? '',
    ...(type === 'movie'
      ? { releaseDate: c.releaseDate ?? null, runtime: c.runtime ?? null }
      : {
          numberOfSeasons: c.numberOfSeasons ?? 0,
          numberOfEpisodes: c.numberOfEpisodes ?? 0,
        }),
    providers,
    region,
    inLibrary,
  };
}

export function titleRoutes({ store, tmdb }) {
  const router = Router();

  router.get(
    '/titles/:type/:tmdbId',
    asyncRoute(async (req, res) => {
      const ref = parseMediaRef(req.params);
      const data = await store.read();
      const { region } = settingsOf(data);
      const [details, providers] = await Promise.all([
        tmdb.getDetails(ref.type, ref.tmdbId),
        tmdb.watchProviders(ref.type, ref.tmdbId, region),
      ]);
      const inLibrary = data.items.some((i) => i.id === libraryId(ref.type, ref.tmdbId));
      res.json(titleView(ref, details, providers, region, inLibrary));
    }),
  );

  return router;
}
