import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictNextRelease } from '../server/predict.js';

const today = new Date('2026-11-06T00:00:00Z');
const seasons = (...dates) => dates.map((airDate, i) => ({ season: i + 1, episodeCount: 10, airDate }));

test('uses the scheduled next episode when TMDB has one', () => {
  const p = predictNextRelease(
    { status: 'Returning Series', nextEpisode: { airDate: '2026-12-01', season: 3, episode: 4 }, seasons: seasons('2022-01-01') },
    { today },
  );
  assert.equal(p.kind, 'confirmed');
  assert.equal(p.date, '2026-12-01');
  assert.equal(p.season, 3);
  assert.equal(p.episode, 4);
});

test('a scheduled episode wins over the user marking the show ended', () => {
  const p = predictNextRelease({ nextEpisode: { airDate: '2026-12-01', season: 2, episode: 1 } }, { userMarkedEnded: true, today });
  assert.equal(p.kind, 'confirmed');
});

test('reports ended when the user marks it ended', () => {
  const p = predictNextRelease({ status: 'Returning Series', seasons: seasons('2020-01-01', '2021-01-01') }, { userMarkedEnded: true, today });
  assert.equal(p.kind, 'ended');
});

test('reports ended or canceled from TMDB status', () => {
  assert.equal(predictNextRelease({ status: 'Ended', seasons: [] }, { today }).kind, 'ended');
  assert.equal(predictNextRelease({ status: 'Canceled', seasons: [] }, { today }).kind, 'ended');
});

test('estimates the next season from the gaps between premieres', () => {
  const p = predictNextRelease({ status: 'Returning Series', seasons: seasons('2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01') }, { today });
  assert.equal(p.kind, 'estimated');
  assert.equal(p.season, 5);
  assert.equal(p.date.slice(0, 7), '2027-01');
  assert.equal(p.overdue, false);
  assert.match(p.basis, /12 months/);
});

test('flags an estimate that has already passed as overdue', () => {
  const p = predictNextRelease({ status: 'Returning Series', seasons: seasons('2020-01-01', '2021-01-01') }, { today });
  assert.equal(p.kind, 'estimated');
  assert.equal(p.overdue, true);
});

test('ignores seasons without a premiere date', () => {
  const p = predictNextRelease(
    { status: 'Returning Series', seasons: [...seasons('2024-01-01', '2025-01-01'), { season: 3, episodeCount: 0, airDate: null }] },
    { today },
  );
  assert.equal(p.kind, 'estimated');
  assert.equal(p.season, 3);
});

test('returns unknown with fewer than two dated seasons', () => {
  assert.equal(predictNextRelease({ status: 'Returning Series', seasons: seasons('2025-01-01') }, { today }).kind, 'unknown');
  assert.equal(predictNextRelease({}, { today }).kind, 'unknown');
});

const upcoming = (next, release) => ({ status: 'Returning Series', nextEpisode: next, release, seasons: seasons('2024-01-01', '2025-01-01', '2026-10-02') });

test('mid-season weekly show: "Next episode" with the season finale', () => {
  const p = predictNextRelease(
    upcoming({ airDate: '2026-11-13', season: 3, episode: 7, name: 'The Trip' }, { season: 3, pattern: 'weekly', episodesInSeason: 10, finale: { episode: 10, airDate: '2026-12-04' } }),
    { today },
  );
  assert.equal(p.scope, 'episode');
  assert.equal(p.heading, 'Next episode');
  assert.equal(p.episodeName, 'The Trip');
  assert.deepEqual(p.finale, { episode: 10, airDate: '2026-12-04' });
});

test('binge show: "Next season" with every episode at once', () => {
  const p = predictNextRelease(upcoming({ airDate: '2027-03-05', season: 4, episode: 1 }, { season: 4, pattern: 'all-at-once', episodesInSeason: 8 }), { today });
  assert.equal(p.scope, 'season');
  assert.equal(p.heading, 'Next season');
  assert.equal(p.pattern, 'all-at-once');
  assert.equal(p.episodeCount, 8);
  assert.equal(p.finale, null);
  assert.match(p.label, /all 8 episodes/);
});

test('weekly season premiere is a "Next season"', () => {
  const p = predictNextRelease(upcoming({ airDate: '2027-01-10', season: 4, episode: 1 }, { season: 4, pattern: 'weekly', basedOnSeason: 3 }), { today });
  assert.equal(p.scope, 'season');
  assert.equal(p.pattern, 'weekly');
});

test('a season released in parts shows the next part', () => {
  const p = predictNextRelease(upcoming({ airDate: '2026-12-25', season: 5, episode: 5 }, { season: 5, pattern: 'parts' }), { today });
  assert.equal(p.scope, 'part');
  assert.equal(p.heading, 'Next part');
});

test('estimates carry the last known release pattern', () => {
  const p = predictNextRelease({ status: 'Returning Series', release: { pattern: 'all-at-once' }, seasons: seasons('2024-01-01', '2025-01-01') }, { today });
  assert.equal(p.kind, 'estimated');
  assert.equal(p.pattern, 'all-at-once');
});

import { isRevived } from '../server/predict.js';

test('detects a finished show coming back', () => {
  const ended = { status: 'Ended' };
  assert.equal(isRevived(ended, { status: 'Returning Series' }), true, 'TMDB status flipped back');
  assert.equal(isRevived(ended, { status: 'Ended', nextEpisode: { airDate: '2027-01-01' } }), true, 'new episode scheduled');
  assert.equal(isRevived(ended, { status: 'Ended' }), false, 'still ended');
  assert.equal(isRevived({ status: 'Returning Series' }, { status: 'Returning Series' }, true), false, 'user-marked ended, nothing new');
  assert.equal(isRevived({ status: 'Returning Series' }, { status: 'Returning Series', nextEpisode: { airDate: '2027-01-01' } }, true), true, 'user-marked ended, new episode');
  assert.equal(isRevived({ status: 'Returning Series' }, { status: 'Returning Series', nextEpisode: { airDate: '2027-01-01' } }), false, 'was never ended');
});
