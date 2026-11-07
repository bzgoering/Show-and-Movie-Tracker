import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodesSeen, libraryStats, timeSpent, TYPICAL_MINUTES } from '../public/shared/stats.js';
import { aboutDays, formatDuration } from '../public/js/lib/dates.js';

const seasons = [
  { season: 1, episodeCount: 8 },
  { season: 2, episodeCount: 10 },
];
const show = (label, progress, extra = {}) => ({
  type: 'tv',
  label,
  progress,
  cache: { seasons, lastEpisode: { season: 2, episode: 10 }, episodeRuntime: 50, genres: ['Drama', 'Crime'] },
  ...extra,
});
const movie = (label, runtime, extra = {}) => ({
  type: 'movie',
  label,
  cache: { runtime, genres: ['Drama'] },
  ...extra,
});

test('episodes seen: all aired once watched, up to your progress while watching, none while planned', () => {
  assert.equal(episodesSeen(show('watched', { season: 1, episode: 0 })), 18, 'marked watched = all aired');
  assert.equal(episodesSeen(show('watching', { season: 2, episode: 3 })), 11);
  assert.equal(episodesSeen(show('planned', { season: 2, episode: 3 })), 0);
  const halfAired = show('watched', { season: 2, episode: 4 }, {});
  halfAired.cache = { ...halfAired.cache, lastEpisode: { season: 2, episode: 4 } };
  assert.equal(episodesSeen(halfAired), 12, 'only what has aired');
});

test('time per title uses TMDB runtimes, with typical lengths as a marked estimate', () => {
  assert.deepEqual(timeSpent(movie('watched', 148)), { minutes: 148, estimated: false });
  assert.deepEqual(timeSpent(movie('watched', null)), { minutes: TYPICAL_MINUTES.movie, estimated: true });
  assert.deepEqual(timeSpent(movie('planned', 148)), { minutes: 0, estimated: false });
  assert.equal(timeSpent(show('watching', { season: 1, episode: 4 })).minutes, 4 * 50);
  const noRuntime = show('watching', { season: 1, episode: 4 });
  noRuntime.cache = { ...noRuntime.cache, episodeRuntime: null };
  assert.deepEqual(timeSpent(noRuntime), { minutes: 4 * 45, estimated: true, episodes: 4 });
  noRuntime.cache.genres = ['Animation', 'Comedy'];
  assert.equal(timeSpent(noRuntime).minutes, 4 * 24, 'cartoons are shorter');
  assert.equal(
    timeSpent(show('watching', { season: 1, episode: 0 })).estimated,
    false,
    'nothing watched, nothing estimated',
  );
});

test('library stats add it all up', () => {
  const stats = libraryStats([
    show('watched', { season: 2, episode: 10 }, { rating: 3 }), // 18 x 50 = 900
    show('watching', { season: 1, episode: 2 }, { rating: 1 }), // 2 x 50 = 100
    show('planned', { season: 1, episode: 0 }, { rating: 2 }), // rating hidden while Planned
    movie('watched', 120, { rating: 2 }),
    movie('watched', null), // 110, estimated
    movie('planned', 90),
  ]);
  assert.equal(stats.shows.minutes, 1000);
  assert.equal(stats.shows.episodes, 20);
  assert.equal(stats.movies.minutes, 230);
  assert.equal(stats.movies.watched, 2);
  assert.equal(stats.totalMinutes, 1230);
  assert.deepEqual(stats.library, { watching: 1, waiting: 0, planned: 2, watched: 3 });
  assert.equal(stats.estimatedTitles, 1);
  assert.deepEqual(stats.ratings, { 3: 1, 2: 1, 1: 1 });
  assert.deepEqual(stats.genres, [
    { name: 'Drama', minutes: 1230 },
    { name: 'Crime', minutes: 1000 },
  ]);
});

test('caught-up shows count as Waiting, like the Library tab', () => {
  const caughtUp = show('watching', { season: 2, episode: 10 });
  caughtUp.cache = { ...caughtUp.cache, status: 'Returning Series' };
  assert.deepEqual(libraryStats([caughtUp]).library, { watching: 0, waiting: 1, planned: 0, watched: 0 });
});

test('an empty library has nothing to add up', () => {
  const stats = libraryStats([]);
  assert.equal(stats.totalMinutes, 0);
  assert.deepEqual(stats.genres, []);
});

test('times read as minutes, hours and minutes, or whole hours once they get long', () => {
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(120), '2h');
  assert.equal(formatDuration(750), '12h 30m');
  assert.equal(formatDuration(6645), '111h', '110h 45m rounds to the nearest hour');
  assert.equal(aboutDays(500), '', 'under a day');
  assert.equal(aboutDays(1440), 'about 1 day');
  assert.equal(aboutDays(6645), 'about 4.6 days');
  assert.equal(aboutDays(20000), 'about 14 days');
});
