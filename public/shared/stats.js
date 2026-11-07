// Your stats: how much time you've spent watching, and what's in your library.
// Pure functions, so they run in the browser and in `npm test`.
import { isAnimatedTitle, normalizeGenres, ratingOf } from './media.js';
import { airedCount, statusOf, watchedCount } from './progress.js';

// Typical lengths, used when TMDB doesn't list a runtime (the page says how many titles were estimated).
export const TYPICAL_MINUTES = { movie: 110, episode: 45, animatedEpisode: 24 };

// Episodes of a show you've seen: every aired episode once you've marked it Watched, otherwise
// the episodes up to the one you're on.
export function episodesSeen(item) {
  if (item.type !== 'tv' || item.label === 'planned') return 0;
  const aired = airedCount(item.cache);
  if (item.label === 'watched') return aired;
  return Math.min(aired, watchedCount(item.progress, item.cache?.seasons));
}

// Time spent on one title, in minutes, and whether it's an estimate.
export function timeSpent(item) {
  if (item.type === 'movie') {
    if (item.label !== 'watched') return { minutes: 0, estimated: false };
    const runtime = item.cache?.runtime;
    return { minutes: runtime || TYPICAL_MINUTES.movie, estimated: !runtime };
  }
  const episodes = episodesSeen(item);
  const runtime = item.cache?.episodeRuntime;
  const typical = isAnimatedTitle(item) ? TYPICAL_MINUTES.animatedEpisode : TYPICAL_MINUTES.episode;
  return { minutes: episodes * (runtime || typical), estimated: episodes > 0 && !runtime, episodes };
}

export function libraryStats(items) {
  const stats = {
    totalMinutes: 0,
    shows: { minutes: 0, episodes: 0 },
    movies: { minutes: 0, watched: 0 },
    library: { watching: 0, waiting: 0, planned: 0, watched: 0 }, // titles under each Library tab
    ratings: { 3: 0, 2: 0, 1: 0 },
    estimatedTitles: 0,
    genres: [], // [{ name, minutes }], most time first
  };
  const genreMinutes = new Map();

  for (const item of items) {
    const { minutes, estimated, episodes = 0 } = timeSpent(item);
    stats.totalMinutes += minutes;
    if (estimated) stats.estimatedTitles++;
    stats.library[statusOf(item)]++;
    const rating = ratingOf(item);
    if (rating) stats.ratings[rating]++;

    if (item.type === 'movie') {
      stats.movies.minutes += minutes;
      if (item.label === 'watched') stats.movies.watched++;
    } else {
      stats.shows.minutes += minutes;
      stats.shows.episodes += episodes;
    }

    // A title counts toward each of its genres (so these add up to more than your total).
    for (const genre of normalizeGenres(item.cache?.genres)) {
      if (minutes) genreMinutes.set(genre, (genreMinutes.get(genre) ?? 0) + minutes);
    }
  }

  stats.genres = [...genreMinutes]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  return stats;
}
