import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airedCount, formatProgress, nextEpisode, remainingCount, watchedCount } from '../public/shared/progress.js';

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

import { airedSeasons, isCaughtUp, latestAired } from '../public/shared/progress.js';

const airing = { seasons, lastEpisode: { season: 2, episode: 4 } };

test('pickers only include aired seasons and episodes', () => {
  const aired = airedSeasons(airing);
  assert.deepEqual(
    aired.map((s) => s.season),
    [1, 2],
    'season 3 has not started',
  );
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
  const cache = {
    seasons: [
      { season: 1, episodeCount: 8, airDate: '2020-01-01' },
      { season: 2, episodeCount: 8, airDate: '2099-01-01' },
    ],
  };
  assert.deepEqual(latestAired(cache), { season: 1, episode: 8 });
});

import { statusOf } from '../public/shared/progress.js';

test('caught-up Watching shows with more coming show as Waiting', () => {
  const show = (progress, prediction, label = 'watching') => ({
    type: 'tv',
    label,
    progress,
    cache: airing,
    prediction,
  });
  assert.equal(statusOf(show({ season: 2, episode: 4 }, { kind: 'confirmed' })), 'waiting');
  assert.equal(statusOf(show({ season: 2, episode: 4 }, { kind: 'estimated' })), 'waiting');
  assert.equal(statusOf(show({ season: 2, episode: 3 }, { kind: 'confirmed' })), 'watching', 'not caught up');
  assert.equal(statusOf(show({ season: 2, episode: 4 }, { kind: 'ended' })), 'watching', 'nothing more is coming');
  assert.equal(statusOf(show({ season: 2, episode: 4 }, { kind: 'confirmed' }, 'watched')), 'watched');
  assert.equal(statusOf(show({ season: 1, episode: 0 }, { kind: 'confirmed' }, 'planned')), 'planned');
  assert.equal(statusOf({ type: 'movie', label: 'watched' }), 'watched');
});

import { currentEpisode, progressForCurrent, progressSummary } from '../public/shared/progress.js';

test('the episode you are on is the one after your last watched', () => {
  const show = (progress, prediction) => ({ type: 'tv', progress, cache: airing, prediction });
  assert.deepEqual(currentEpisode(show({ season: 1, episode: 0 })), { season: 1, episode: 1 });
  assert.deepEqual(
    currentEpisode(show({ season: 1, episode: 8 })),
    { season: 2, episode: 1 },
    'rolls into next season',
  );
  assert.deepEqual(currentEpisode(show({ season: 2, episode: 3 })), { season: 2, episode: 4 });
  assert.equal(currentEpisode(show({ season: 2, episode: 4 })), null, 'caught up on the newest episode');

  assert.equal(progressSummary(show({ season: 2, episode: 3 })), 'On S2 E4');
  assert.equal(progressSummary(show({ season: 2, episode: 4 }, { kind: 'confirmed' })), 'Caught up');
  assert.equal(progressSummary(show({ season: 2, episode: 4 }, { kind: 'ended' })), 'Finished');
  assert.equal(
    progressSummary({ type: 'tv', progress: { season: 1, episode: 0 }, cache: { seasons: [] } }),
    'Not out yet',
  );
});

test('picking "I am on S2 E4" saves S2 E3 as last watched', () => {
  assert.deepEqual(progressForCurrent(2, 4), { season: 2, episode: 3 });
  // Being on episode 1 of a season means the earlier seasons are done.
  const onSeason2 = progressForCurrent(2, 1);
  assert.deepEqual(onSeason2, { season: 2, episode: 0 });
  assert.deepEqual(currentEpisode({ progress: onSeason2, cache: airing }), { season: 2, episode: 1 });
  assert.equal(remainingCount({ progress: onSeason2, cache: airing }), 4);
});
