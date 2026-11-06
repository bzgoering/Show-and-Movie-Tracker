// /api/settings, /api/providers and /api/regions: your country and streaming services.
import { Router } from 'express';
import { asyncRoute, HttpError } from '../http.js';
import { applySettingsPatch, isRegion, settingsOf } from '../settings.js';

export function settingsRoutes({ store, tmdb }) {
  const router = Router();

  router.get(
    '/settings',
    asyncRoute(async (req, res) => {
      res.json(settingsOf(await store.read()));
    }),
  );

  router.put(
    '/settings',
    asyncRoute(async (req, res) => {
      const settings = await store.update((data) => {
        data.settings = applySettingsPatch(settingsOf(data), req.body);
        return data.settings;
      });
      res.json(settings);
    }),
  );

  // Every streaming service available in a country (yours unless ?region= says otherwise).
  router.get(
    '/providers',
    asyncRoute(async (req, res) => {
      const region = String(req.query.region ?? settingsOf(await store.read()).region).toUpperCase();
      if (!isRegion(region)) throw new HttpError(400, 'Region must be a two-letter country code, like US.');
      res.json(await tmdb.providerList(region));
    }),
  );

  router.get(
    '/regions',
    asyncRoute(async (req, res) => {
      res.json(await tmdb.regions());
    }),
  );

  return router;
}
