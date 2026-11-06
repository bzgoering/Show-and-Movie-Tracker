// Episode-counting helpers. Pure functions, so they run in the browser and in `npm test`.

const countBefore = (seasons, seasonNumber) =>
  seasons.filter((s) => s.season < seasonNumber).reduce((sum, s) => sum + (s.episodeCount || 0), 0);

// The newest episode that has aired, e.g. { season: 6, episode: 3 }, or null if nothing has aired.
export function latestAired(cache = {}, today = new Date()) {
  const last = cache.lastEpisode;
  if (last && last.season && last.episode) return { season: last.season, episode: last.episode };
  // No "last episode" from TMDB: fall back to the newest season that has premiered.
  const iso = today.toISOString().slice(0, 10);
  const started = (cache.seasons || []).filter((s) => s.airDate && s.airDate <= iso && s.episodeCount > 0);
  const newest = started.sort((a, b) => b.season - a.season)[0];
  return newest ? { season: newest.season, episode: newest.episodeCount } : null;
}

// Seasons trimmed to what has aired: later seasons are dropped and the newest one
// only counts the episodes that are out. Used for the pickers so you can't pick the future.
export function airedSeasons(cache = {}, today = new Date()) {
  const latest = latestAired(cache, today);
  if (!latest) return [];
  return (cache.seasons || [])
    .filter((s) => s.season <= latest.season)
    .map((s) => (s.season === latest.season ? { ...s, totalEpisodes: s.episodeCount, episodeCount: latest.episode } : s));
}

export function isCaughtUp(progress, cache) {
  const latest = latestAired(cache);
  if (!latest || !progress) return true;
  return progress.season > latest.season || (progress.season === latest.season && progress.episode >= latest.episode);
}

// Episodes that have actually aired so far.
export function airedCount(cache = {}) {
  return airedSeasons(cache).reduce((sum, s) => sum + (s.episodeCount || 0), 0);
}

// Episodes the user has watched, counting every episode up to and including their progress.
export function watchedCount(progress = { season: 1, episode: 0 }, seasons = []) {
  return countBefore(seasons, progress.season) + progress.episode;
}

export function remainingCount(item) {
  return Math.max(0, airedCount(item.cache) - watchedCount(item.progress, item.cache?.seasons));
}

// The episode after the current one, moving into the next season when needed.
// Returns null when there is nothing after it.
export function nextEpisode(progress, seasons = []) {
  const current = seasons.find((s) => s.season === progress.season);
  if (current && progress.episode < current.episodeCount) {
    return { season: progress.season, episode: progress.episode + 1 };
  }
  const following = seasons
    .filter((s) => s.season > progress.season && s.episodeCount > 0)
    .sort((a, b) => a.season - b.season)[0];
  return following ? { season: following.season, episode: 1 } : null;
}

export function formatProgress(progress) {
  if (!progress || (progress.season === 1 && progress.episode === 0)) return 'Not started';
  return `S${progress.season} · E${progress.episode}`;
}

// What a title shows as in the library. A "Watching" show you're caught up on, with more
// episodes or seasons still to come, shows as "Waiting" until something new comes out.
export function statusOf(item) {
  if (item.type === 'tv' && item.label === 'watching' && item.prediction?.kind !== 'ended' && isCaughtUp(item.progress, item.cache)) {
    return 'waiting';
  }
  return item.label;
}
