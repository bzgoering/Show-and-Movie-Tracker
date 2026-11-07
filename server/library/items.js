// Library items: creating them, changing them, and merging in fresh TMDB info.
// Pure functions (no file or network access), so they're easy to test.
import { isRating, LABELS_FOR, libraryId } from '../../public/shared/media.js';
import { HttpError } from '../http.js';
import { isRevived, predictNextRelease } from '../predict.js';

// If the app is left open, anything older than this is refreshed again on the next page load.
const STALE_MS = 6 * 60 * 60 * 1000;

export const isStale = (item, now = Date.now()) =>
  !item.cache?.lastFetched || now - Date.parse(item.cache.lastFetched) > STALE_MS;

// Planned titles show where they stream, in your country.
export const needsProviders = (item, region) => item.label === 'planned' && item.cache?.providers?.region !== region;

// What the browser gets: the item plus, for shows, what's coming next.
export function withPrediction(item) {
  if (item.type !== 'tv') return item;
  return { ...item, prediction: predictNextRelease(item.cache, { userMarkedEnded: item.userMarkedEnded }) };
}

export function newItem({ type, tmdbId, details, label = 'planned', fromExplore = false, now = new Date() }) {
  const at = now.toISOString();
  const latest = details.cache.lastEpisode;
  return {
    id: libraryId(type, tmdbId),
    tmdbId,
    type,
    title: details.title,
    year: details.year,
    posterPath: details.posterPath,
    overview: details.overview,
    label: LABELS_FOR[type].includes(label) ? label : 'planned',
    ...(type === 'tv' && {
      // Saved progress is the last episode finished. A show added as already watched is caught up.
      progress:
        label === 'watched' && latest ? { season: latest.season, episode: latest.episode } : { season: 1, episode: 0 },
      userMarkedEnded: false,
    }),
    ...(fromExplore && { addedFrom: 'explore' }),
    cache: details.cache,
    addedAt: at,
    updatedAt: at,
  };
}

// Applies a change from the browser ({ label, progress, userMarkedEnded }), or throws a 400.
export function applyChanges(item, changes = {}, now = new Date()) {
  if ('label' in changes) {
    const allowed = LABELS_FOR[item.type];
    if (!allowed.includes(changes.label)) throw new HttpError(400, `Label must be one of: ${allowed.join(', ')}.`);
    item.label = changes.label;
  }

  if ('rating' in changes) {
    // null clears it.
    if (changes.rating === null) delete item.rating;
    else if (isRating(changes.rating)) item.rating = changes.rating;
    else throw new HttpError(400, 'Rating must be 1 (Meh), 2 (Good), 3 (Great), or null to clear it.');
  }

  if (item.type === 'tv') {
    if ('progress' in changes) item.progress = parseProgress(item, changes.progress);
    if ('userMarkedEnded' in changes) item.userMarkedEnded = Boolean(changes.userMarkedEnded);
  }

  item.updatedAt = now.toISOString(); // "you last changed this" (the TMDB refresh doesn't touch it)
  return item;
}

function parseProgress(item, progress) {
  const season = Number(progress?.season);
  const episode = Number(progress?.episode);
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 0) {
    throw new HttpError(400, 'Progress needs a season of 1 or more and an episode of 0 or more.');
  }
  const last = item.cache?.lastEpisode;
  if (last && (season > last.season || (season === last.season && episode > last.episode))) {
    throw new HttpError(
      400,
      `S${season} E${episode} hasn't aired yet. The newest episode is S${last.season} E${last.episode}.`,
    );
  }
  return { season, episode };
}

// Merges fresh TMDB info into an item. Your label and progress are kept, except that a finished
// show that has come back (renewed, revived, rebranded) moves out of Watched, so it shows up
// under Waiting again (or Watching if new episodes are already out). Returns true in that case.
export function applyDetails(item, details, now = new Date()) {
  const revived =
    item.type === 'tv' && Boolean(item.cache) && isRevived(item.cache, details.cache, item.userMarkedEnded);
  if (revived) {
    item.userMarkedEnded = false;
    if (item.label === 'watched') item.label = 'watching';
    item.revivedAt = now.toISOString();
  }
  // Streaming info is per country and looked up separately; keep it until it's replaced.
  const providers = item.cache?.providers;
  Object.assign(item, {
    title: details.title,
    year: details.year,
    posterPath: details.posterPath,
    overview: details.overview,
    cache: providers ? { ...details.cache, providers } : details.cache, // cache.lastFetched = when TMDB was asked
  });
  return revived;
}

export const applyProviders = (item, region, providers) => {
  item.cache = { ...item.cache, providers: { region, ...providers } };
};
