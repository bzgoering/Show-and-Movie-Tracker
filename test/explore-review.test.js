// Checks found while reviewing the Explore algorithm.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildExplore, clearExploreCache, reasonFor, scoreParts, tasteProfile } from '../server/explore/index.js';
import * as fake from './fake-tmdb.js';

beforeEach(() => clearExploreCache());

const day = (n) => new Date(Date.UTC(2026, 0, n)).toISOString();

test('shows you are currently watching seed recommendations even with a big Watched list', async () => {
  const watched = Array.from({ length: 12 }, (_, i) => ({
    type: 'movie',
    tmdbId: 500 + i,
    title: `Old ${i}`,
    label: 'watched',
    addedAt: day(1),
    updatedAt: day(1),
    cache: { genres: ['Drama'] },
  }));
  const watching = [
    {
      type: 'tv',
      tmdbId: 100088,
      title: 'The Last of Us',
      label: 'watching',
      addedAt: day(20),
      updatedAt: day(20),
      cache: { genres: ['Drama'] },
    },
  ];
  const planned = [
    {
      type: 'movie',
      tmdbId: 27205,
      title: 'Inception',
      label: 'planned',
      addedAt: day(25),
      updatedAt: day(25),
      cache: { genres: ['Action'] },
    },
  ];
  fake.calls.length = 0;
  await buildExplore({ tmdb: fake, items: [...watched, ...watching, ...planned] });
  const seeded = fake.calls.filter((c) => c[0] === 'recommendations').map((c) => `${c[1]}-${c[2]}`);
  assert.ok(seeded.includes('tv-100088'), 'the show you are watching seeds suggestions');
  assert.ok(seeded.includes('movie-27205'), 'a planned title gets a turn too');
  assert.ok(seeded.length <= 10, 'still capped');
});

test('extra loosely-matching genres do not beat a single genre you like more', () => {
  // Drama is the favourite (1.0), Crime 0.6, and five other genres 0.5 each.
  const p = tasteProfile([
    ...Array.from({ length: 10 }, () => ({ type: 'tv', label: 'planned', cache: { genres: ['Drama'] } })),
    ...Array.from({ length: 6 }, () => ({ type: 'tv', label: 'planned', cache: { genres: ['Crime'] } })),
    ...Array.from({ length: 5 }, () => ({
      type: 'tv',
      label: 'planned',
      cache: { genres: ['Mystery', 'Comedy', 'Action', 'Family', 'Western'] },
    })),
  ]);
  assert.equal(p.genreWeights.get('Crime'), 0.6);
  const crime = scoreParts({ type: 'tv', genres: ['Crime'] }, p).genre;
  const scattered = scoreParts({ type: 'tv', genres: ['Mystery', 'Comedy', 'Action', 'Family', 'Western'] }, p).genre;
  assert.ok(crime > scattered, `Crime (${crime}) should beat five half-liked genres (${scattered})`);
});

test('reasons match what you are doing with the title', () => {
  const p = tasteProfile([{ type: 'tv', label: 'watched', cache: {} }]);
  assert.equal(
    reasonFor({ recommendedBy: [{ title: 'Severance', label: 'watching', weight: 2.5 }] }, p),
    "Because you're watching Severance",
  );
  assert.equal(
    reasonFor({ recommendedBy: [{ title: 'Dune', label: 'watched', weight: 3 }] }, p),
    'Because you watched Dune',
  );
  assert.equal(
    reasonFor({ recommendedBy: [{ title: 'Arrival', label: 'planned', weight: 1 }] }, p),
    'Because you saved Arrival',
  );
});
