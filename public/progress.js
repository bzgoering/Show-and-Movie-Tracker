// Episode-counting helpers. Pure functions, so they run in the browser and in `npm test`.

const countBefore = (seasons, seasonNumber) =>
  seasons.filter((s) => s.season < seasonNumber).reduce((sum, s) => sum + (s.episodeCount || 0), 0);

// Episodes that have actually aired so far.
export function airedCount(cache = {}) {
  const seasons = cache.seasons || [];
  const last = cache.lastEpisode;
  if (last && last.season) return countBefore(seasons, last.season) + last.episode;
  return seasons.reduce((sum, s) => sum + (s.episodeCount || 0), 0);
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
