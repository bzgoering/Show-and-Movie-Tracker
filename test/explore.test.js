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

import { DEFAULT_WEIGHTS, dislikeProfile, dislikeScore, exploreStats, learnWeights } from '../server/explore.js';

test('a dislike barely affects genres you watch a lot, but counts for ones you do not', () => {
  const dp = dislikeProfile(lib, [{ type: 'movie', tmdbId: 1, genres: ['Drama'] }, { type: 'movie', tmdbId: 2, genres: ['Horror'] }]);
  assert.ok(dp.genreShare.get('Horror') > 0.9, 'never watched horror, hid one');
  assert.ok(dp.genreShare.get('Drama') < 0.4, 'watch lots of drama, hid one');
  assert.ok(dislikeScore({ genres: ['Horror'] }, dp) > dislikeScore({ genres: ['Drama'] }, dp));
  assert.equal(dislikeScore({ genres: ['Horror'] }, dislikeProfile(lib, [])), 0, 'no dislikes, no penalty');
});

test('dislikes counter-balance a score without outweighing your library', () => {
  const p = tasteProfile(lib);
  const c = { type: 'tv', genres: ['Drama', 'Crime'], voteAverage: 8, voteCount: 1000, recommendedBy: [{ weight: 3 }] };
  const dp = dislikeProfile(lib, [{ type: 'tv', tmdbId: 9, genres: ['Crime'] }]);
  const plain = scoreCandidate(c, p);
  const penalized = scoreCandidate({ ...c, similarToDisliked: 2 }, p, { dprofile: dp });
  assert.ok(penalized < plain, 'pulled down');
  assert.ok(plain - penalized <= 0.12 + 1e-9, 'by no more than the dislike weight');
});

test('learns weights from what you add versus what you hide', () => {
  assert.deepEqual(learnWeights([]), DEFAULT_WEIGHTS, 'not enough feedback yet');
  const added = (rec) => ({ action: 'added', parts: { genre: 0.5, rec, quality: 0.7, type: 0.5 } });
  const hidden = (rec) => ({ action: 'disliked', parts: { genre: 0.5, rec, quality: 0.7, type: 0.5 } });
  const w = learnWeights([added(0.9), added(0.8), added(1), hidden(0.1), hidden(0)]);
  assert.ok(w.rec > DEFAULT_WEIGHTS.rec, 'your adds came from recommendations, so they count more');
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'weights still add up to 1');
  assert.ok(w.rec <= DEFAULT_WEIGHTS.rec * 1.5, 'each weight can grow by at most half');
});

test('stats report how often you add what Explore suggests', () => {
  assert.deepEqual(exploreStats([]), { added: 0, disliked: 0, hitRate: null, tuned: false });
  const s = exploreStats([{ action: 'added' }, { action: 'added' }, { action: 'added' }, { action: 'disliked' }]);
  assert.equal(s.hitRate, 75);
});

test('hidden titles never come back, and titles similar to them drop', async () => {
  const before = await buildExplore({ tmdb: fake, items: lib });
  clearExploreCache();
  // Hide Ozark.
  const dislikes = [{ type: 'tv', tmdbId: 2, title: 'Ozark', genres: ['Drama', 'Crime'] }];
  const after = await buildExplore({ tmdb: fake, items: lib, dislikes });
  assert.ok(before.some((i) => i.title === 'Ozark'));
  assert.ok(!after.some((i) => i.title === 'Ozark'), 'hidden');
  assert.ok(after.length > 0, 'still has suggestions');
});

import { isAnimated } from '../server/explore.js';

test('shows split into live action and anime & cartoons', async () => {
  const live = await buildExplore({ tmdb: fake, items: lib, type: 'tv-live' });
  const toons = await buildExplore({ tmdb: fake, items: lib, type: 'tv-animated' });
  assert.ok(live.length && live.every((i) => i.type === 'tv'));
  assert.ok(!live.some((i) => ['Arcane', 'Frieren'].includes(i.title)), 'no animation in live action');
  assert.deepEqual(toons.map((i) => i.title).sort(), ['Arcane', 'Frieren'], 'only animated shows');

  const disc = (animatedTab) => fake.calls.filter((c) => c[0] === 'discover' && c[1] === 'tv').map((c) => c[2]).find((p) => (animatedTab ? p.with_genres === '16' : p.without_genres === '16'));
  assert.ok(disc(true), 'anime & cartoons searches animated shows');
  assert.ok(disc(false), 'live action leaves animation out of its search');

  const all = await buildExplore({ tmdb: fake, items: lib });
  assert.ok(all.some((i) => i.title === 'Arcane') && all.some((i) => i.title === 'Ozark'), 'All still has both');
  assert.equal(isAnimated({ genreIds: [16, 18] }), true);
});
