import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPattern } from '../server/release.js';

const eps = (...dates) => dates.map((airDate, i) => ({ episode: i + 1, airDate }));

test('weekly when episodes come out on different dates', () => {
  const r = detectPattern(eps('2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'));
  assert.equal(r.pattern, 'weekly');
  assert.deepEqual(r.finale, { episode: 4, airDate: '2026-10-23' });
});

test('weekly also covers a two-episode premiere', () => {
  assert.equal(
    detectPattern(eps('2026-10-02', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23')).pattern,
    'weekly',
  );
});

test('all-at-once when the whole season shares a date', () => {
  assert.equal(
    detectPattern(eps('2027-03-05', '2027-03-05', '2027-03-05', '2027-03-05', '2027-03-05', '2027-03-05')).pattern,
    'all-at-once',
  );
});

test('parts when a season drops in a few big chunks', () => {
  const r = detectPattern(
    eps(
      '2022-05-27',
      '2022-05-27',
      '2022-05-27',
      '2022-05-27',
      '2022-05-27',
      '2022-05-27',
      '2022-05-27',
      '2022-07-01',
      '2022-07-01',
    ),
  );
  assert.equal(r.pattern, 'parts');
});

test('unknown with fewer than two dates', () => {
  assert.equal(detectPattern(eps('2027-01-01', null, null)).pattern, 'unknown');
  assert.equal(detectPattern([]).pattern, 'unknown');
});
