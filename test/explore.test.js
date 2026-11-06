import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildExplore, clearExploreCache, normalizeGenres, scoreCandidate, tasteProfile } from '../server/explore.js';
import * as fake from './fake-tmdb.js';

beforeEach(() => clearExploreCache());

const lib = [
  { type: 'tv', tmdbId: 1396, title: 'Breaking Bad', label: 'watched', cache: { genres: ['Drama', 'Crime'] } },
  { type: 'tv', tmdbId: 100088, title: 'The Last of Us', label: 'watching', cache: { genres: ['Drama', 'Sci-Fi & Fantasy'] } },
  { type: 'movie', tmdbId: 27205, title: 'Inception', label: 'planned', cache: { genres: ['Action', 'Science Fiction'] } },
];

test('TV and movie genre names line up', () => {
  assert.deepEqual(normalizeGenres(['Sci-Fi & Fantasy', 'Action & Adventure', 'Drama']), ['Science Fiction', 'Fantasy', 'Action', 'Adventure', 'Drama']);
});

test('taste profile weights watched titles most', () => {
  const p = tasteProfile(lib);
  assert.equal(p.genreWeights.get('Drama'), 1, 'favourite genre');
  assert.ok(p.genreWeights.get('Crime') > p.genreWeights.get('Action'), 'watched beats planned');
  assert.ok(p.typeShare.tv > p.typeShare.movie);
  assert.equal(p.topGenres[0], 'Drama');
});

test('candidates matching your taste score higher', () => {
  const p = tasteProfile(lib);
  const similar = scoreCandidate({ type: 'tv', genres: ['Drama', 'Crime'], voteAverage: 8, voteCount: 1000, recommendedBy: [{ weight: 3 }] }, p);
  const different = scoreCandidate({ type: 'movie', genres: ['Horror'], voteAverage: 8, voteCount: 1000 }, p);
  assert.ok(similar > different);
  assert.ok(similar <= 1 && different >= 0);
});

test('explore ranks by match, skips owned titles and posterless ones, and lists where to stream', async () => {
  const items = await buildExplore({ tmdb: fake, items: lib });
  const titles = items.map((i) => i.title);
  assert.equal(titles[0], 'Ozark', 'recommended by two of your shows and matches your genres');
  assert.ok(!titles.includes('Breaking Bad'), 'already in library');
  assert.ok(!titles.includes('Scary Show'), 'no poster');
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].match >= items[i].match, 'sorted best match first');
  const ozark = items[0];
  assert.deepEqual(ozark.providers.stream.map((p) => p.name), ['Netflix']);
  assert.match(ozark.reason, /Because you (watched|saved)/);
  assert.ok(!('genres' in ozark), 'genres are not sent to the page');
});

test('picking streaming services only shows titles on them', async () => {
  const items = await buildExplore({ tmdb: fake, items: lib, services: [1899] });
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.providers.stream.some((p) => p.id === 1899)), 'all on Max');
  const discoverCall = fake.calls.filter((c) => c[0] === 'discover').at(-1);
  assert.equal(discoverCall[2].with_watch_providers, '1899');
  assert.equal(discoverCall[2].watch_region, 'US');
});

test('type filter and region', async () => {
  const movies = await buildExplore({ tmdb: fake, items: lib, type: 'movie' });
  assert.ok(movies.length && movies.every((i) => i.type === 'movie'));
  const ca = await buildExplore({ tmdb: fake, items: lib, region: 'CA' });
  assert.ok(ca.every((i) => i.providers.stream.length === 0), 'no US providers in Canada');
});

test('an empty library falls back to popular titles', async () => {
  const items = await buildExplore({ tmdb: fake, items: [] });
  assert.ok(items.some((i) => i.title === 'Trending Movie'));
  assert.equal(items.find((i) => i.title === 'Trending Movie').reason, 'Popular this week');
});
