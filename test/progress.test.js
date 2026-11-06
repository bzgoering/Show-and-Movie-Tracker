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

import { airedSeasons, isCaughtUp, latestAired } from '../public/progress.js';

const airing = { seasons, lastEpisode: { season: 2, episode: 4 } };

test('pickers only include aired seasons and episodes', () => {
  const aired = airedSeasons(airing);
  assert.deepEqual(aired.map((s) => s.season), [1, 2], 'season 3 has not started');
  assert.equal(aired[1].episodeCount, 4, 'only 4 of 10 episodes are out');
  assert.equal(aired[1].totalEpisodes, 10);
});

test('next episode stops at the newest aired one', () => {
  assert.equal(nextEpisode({ season: 2, episode: 4 }, airedSeasons(airing)), null);
  assert.deepEqual(nextEpisode({ season: 2, episode: 3 }, airedSeasons(airing)), { season: 2, episode: 4 });
});

test('latest aired and caught-up checks', () => {
  assert.deepEqual(latestAired(airing), { season: 2, episode: 4 });
  assert.equal(isCaughtUp({ season: 2, episode: 4 }, airing), true);
  assert.equal(isCaughtUp({ season: 1, episode: 8 }, airing), false);
});

test('nothing aired yet means no seasons to pick', () => {
  const upcoming = { seasons: [{ season: 1, episodeCount: 8, airDate: '2099-01-01' }] };
  assert.equal(latestAired(upcoming), null);
  assert.deepEqual(airedSeasons(upcoming), []);
});

test('without a last episode, falls back to seasons that have premiered', () => {
  const cache = { seasons: [{ season: 1, episodeCount: 8, airDate: '2020-01-01' }, { season: 2, episodeCount: 8, airDate: '2099-01-01' }] };
  assert.deepEqual(latestAired(cache), { season: 1, episode: 8 });
});
