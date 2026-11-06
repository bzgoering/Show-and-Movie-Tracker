// Keeps saved titles up to date with TMDB.
//
// Everything is fetched first and only then saved in one quick change, so the library file is never
// locked while waiting on the network: labels and progress can be saved during a refresh.
// If TMDB can't be reached, the saved info is kept as it was.
import { mapLimit } from '../http.js';
import { settingsOf } from '../settings.js';
import { applyDetails, applyProviders, isStale, needsProviders } from './items.js';

const CONCURRENCY = 4;

export function createLibrarySync({ store, tmdb, log = console.log }) {
  const hasKey = () => Boolean(process.env.TMDB_API_KEY);
  let lastSync = null;

  // Where a title streams in a country, or null if TMDB couldn't say (not critical: retried later).
  async function fetchProviders(item, region) {
    try {
      return await tmdb.watchProviders(item.type, item.tmdbId, region);
    } catch {
      return null;
    }
  }

  async function fetchFresh(item, region) {
    const details = await tmdb.getDetails(item.type, item.tmdbId);
    const providers = item.label === 'planned' ? await fetchProviders(item, region) : null;
    return { details, providers };
  }

  function saveFresh(item, { details, providers }, region) {
    if (applyDetails(item, details))
      log(`[sync] "${item.title}" is back (${details.cache.status}). Moved it out of Watched.`);
    if (providers && item.label === 'planned') applyProviders(item, region, providers);
  }

  // Refreshes every saved title (or only ones not refreshed for a while). Returns a summary.
  async function refreshAll({ onlyStale = false } = {}) {
    if (!hasKey()) {
      lastSync = { at: new Date().toISOString(), updated: 0, failed: 0, error: 'TMDB_API_KEY is not set.' };
      return lastSync;
    }
    const data = await store.read();
    const { region } = settingsOf(data);
    const targets = data.items.filter((item) => !onlyStale || isStale(item));
    const results = await mapLimit(targets, CONCURRENCY, async (item) => {
      try {
        return { id: item.id, fresh: await fetchFresh(item, region) };
      } catch (err) {
        return { id: item.id, error: err.message };
      }
    });

    const ok = results.filter((r) => r.fresh);
    if (ok.length) {
      await store.update((d) => {
        for (const { id, fresh } of ok) {
          const item = d.items.find((i) => i.id === id); // may have been removed meanwhile
          if (item) saveFresh(item, fresh, region);
        }
      });
    }

    const errors = results.filter((r) => r.error).map((r) => r.error);
    lastSync = { at: new Date().toISOString(), updated: ok.length, failed: errors.length, error: errors[0] ?? null };
    if (ok.length || errors.length) {
      const failed = errors.length ? `, ${errors.length} failed (${errors[0]})` : '';
      log(`[sync] Updated ${ok.length} title${ok.length === 1 ? '' : 's'} from TMDB${failed}.`);
    }
    return lastSync;
  }

  // Refreshes stale titles when the app has been left open; a no-op without a key.
  async function refreshStale() {
    if (hasKey() && (await store.read()).items.some((item) => isStale(item))) await refreshAll({ onlyStale: true });
  }

  // Refreshes one title. Returns the saved item, or null if it's not in the library.
  async function refreshOne(id) {
    const data = await store.read();
    const item = data.items.find((i) => i.id === id);
    if (!item) return null;
    const { region } = settingsOf(data);
    const fresh = await fetchFresh(item, region);
    return store.update((d) => {
      const saved = d.items.find((i) => i.id === id);
      if (saved) saveFresh(saved, fresh, region);
      return saved ?? null;
    });
  }

  // Looks up streaming info for Planned titles that don't have it for your country yet.
  // `ids` limits it to particular titles (e.g. the one just added or relabeled).
  async function ensureProviders(ids = null) {
    if (!hasKey() && !ids) return;
    const data = await store.read();
    const { region } = settingsOf(data);
    const targets = data.items.filter((i) => needsProviders(i, region) && (!ids || ids.includes(i.id)));
    if (!targets.length) return;
    const found = await mapLimit(targets, CONCURRENCY, async (item) => ({
      id: item.id,
      providers: await fetchProviders(item, region),
    }));
    await store.update((d) => {
      for (const { id, providers } of found) {
        const item = d.items.find((i) => i.id === id);
        if (item && providers && needsProviders(item, region)) applyProviders(item, region, providers);
      }
    });
  }

  return { refreshAll, refreshStale, refreshOne, ensureProviders, fetchProviders, lastSync: () => lastSync };
}
