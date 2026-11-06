import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airedCount, formatProgress, nextEpisode, remainingCount, watchedCount } from '../public/progress.js';

const seasons = [
  { season: 1, episodeCount: 8 },
  { season: 2, episodeCount: 10 },
  { season: 3, episodeCount: 6 },
];

test('nextEpisode moves within a season', () => {
  assert.deepEqual(nextEpisode({ season: 1, episode: 0 }, seasons), { season: 1, episode: 1 });
  assert.deepEqual(nextEpisode({ season: 2, episode: 4 }, seasons), { season: 2, episode: 5 });
});

test('nextEpisode rolls over to the next season', () => {
  assert.deepEqual(nextEpisode({ season: 1, episode: 8 }, seasons), { season: 2, episode: 1 });
});

test('nextEpisode returns null at the very end', () => {
  assert.equal(nextEpisode({ season: 3, episode: 6 }, seasons), null);
});

test('counts aired and watched episodes', () => {
  const cache = { seasons, lastEpisode: { season: 3, episode: 2 } };
  assert.equal(airedCount(cache), 8 + 10 + 2);
  assert.equal(watchedCount({ season: 2, episode: 3 }, seasons), 8 + 3);
  assert.equal(remainingCount({ progress: { season: 2, episode: 3 }, cache }), 20 - 11);
});

test('remaining never goes below zero', () => {
  const cache = { seasons, lastEpisode: { season: 1, episode: 2 } };
  assert.equal(remainingCount({ progress: { season: 2, episode: 5 }, cache }), 0);
});

test('formats progress', () => {
  assert.equal(formatProgress({ season: 1, episode: 0 }), 'Not started');
  assert.equal(formatProgress({ season: 2, episode: 5 }), 'S2 · E5');
});
