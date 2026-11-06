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
