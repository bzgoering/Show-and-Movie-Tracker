import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExplore,
  clearExploreCache,
  normalizeGenres,
  scoreCandidate,
  tasteProfile,
} from '../server/explore/index.js';
import * as fake from './fake-tmdb.js';

beforeEach(() => clearExploreCache());

const lib = [
  { type: 'tv', tmdbId: 1396, title: 'Breaking Bad', label: 'watched', cache: { genres: ['Drama', 'Crime'] } },
  {
    type: 'tv',
    tmdbId: 100088,
    title: 'The Last of Us',
    label: 'watching',
    cache: { genres: ['Drama', 'Sci-Fi & Fantasy'] },
  },
  {
    type: 'movie',
    tmdbId: 27205,
    title: 'Inception',
    label: 'planned',
    cache: { genres: ['Action', 'Science Fiction'] },
  },
];

test('TV and movie genre names line up', () => {
  assert.deepEqual(normalizeGenres(['Sci-Fi & Fantasy', 'Action & Adventure', 'Drama']), [
    'Science Fiction',
    'Fantasy',
    'Action',
    'Adventure',
    'Drama',
  ]);
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
  const similar = scoreCandidate(
    { type: 'tv', genres: ['Drama', 'Crime'], voteAverage: 8, voteCount: 1000, recommendedBy: [{ weight: 3 }] },
    p,
  );
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
  assert.deepEqual(
    ozark.providers.stream.map((p) => p.name),
    ['Netflix'],
  );
  assert.match(ozark.reason, /Because you (watched|saved)/);
  assert.ok(!('genres' in ozark), 'genres are not sent to the page');
});

test('picking streaming services only shows titles on them', async () => {
  const items = await buildExplore({ tmdb: fake, items: lib, services: [1899] });
  assert.ok(items.length > 0);
  assert.ok(
    items.every((i) => i.providers.stream.some((p) => p.id === 1899)),
    'all on Max',
  );
  const discoverCall = fake.calls.filter((c) => c[0] === 'discover').at(-1);
  assert.equal(discoverCall[2].with_watch_providers, '1899');
  assert.equal(discoverCall[2].watch_region, 'US');
});

test('type filter and region', async () => {
  const movies = await buildExplore({ tmdb: fake, items: lib, type: 'movie' });
  assert.ok(movies.length && movies.every((i) => i.type === 'movie'));
  const ca = await buildExplore({ tmdb: fake, items: lib, region: 'CA' });
  assert.ok(
    ca.every((i) => i.providers.stream.length === 0),
    'no US providers in Canada',
  );
});

test('an empty library gets no suggestions', async () => {
  assert.deepEqual(await buildExplore({ tmdb: fake, items: [] }), []);
});

import { DEFAULT_WEIGHTS, dislikeProfile, dislikeScore, exploreStats, learnWeights } from '../server/explore/index.js';

test('a dislike barely affects genres you watch a lot, but counts for ones you do not', () => {
  const dp = dislikeProfile(lib, [
    { type: 'movie', tmdbId: 1, genres: ['Drama'] },
    { type: 'movie', tmdbId: 2, genres: ['Horror'] },
  ]);
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

import { isAnimated } from '../server/explore/index.js';

test('shows split into live action and anime & cartoons', async () => {
  const live = await buildExplore({ tmdb: fake, items: lib, type: 'tv-live' });
  const toons = await buildExplore({ tmdb: fake, items: lib, type: 'tv-animated' });
  assert.ok(live.length && live.every((i) => i.type === 'tv'));
  assert.ok(!live.some((i) => ['Arcane', 'Frieren'].includes(i.title)), 'no animation in live action');
  assert.deepEqual(toons.map((i) => i.title).sort(), ['Arcane', 'Frieren'], 'only animated shows');

  const disc = (animatedTab) =>
    fake.calls
      .filter((c) => c[0] === 'discover' && c[1] === 'tv')
      .map((c) => c[2])
      .find((p) => (animatedTab ? p.with_genres === '16' : p.without_genres === '16'));
  assert.ok(disc(true), 'anime & cartoons searches animated shows');
  assert.ok(disc(false), 'live action leaves animation out of its search');

  const all = await buildExplore({ tmdb: fake, items: lib });
  assert.ok(all.some((i) => i.title === 'Arcane') && all.some((i) => i.title === 'Ozark'), 'All still has both');
  assert.equal(isAnimated({ genreIds: [16, 18] }), true);
});

import { genreOptions } from '../server/explore/index.js';

test('genre options come from your library, with movie and show names aligned', () => {
  assert.deepEqual(genreOptions(lib), ['Action', 'Crime', 'Drama', 'Fantasy', 'Science Fiction']);
  const withAnimation = [
    ...lib,
    { type: 'tv', tmdbId: 9, label: 'watched', cache: { genres: ['Animation', 'Comedy'] } },
  ];
  assert.ok(genreOptions(withAnimation, 'all').includes('Animation'));
  assert.ok(!genreOptions(withAnimation, 'tv-animated').includes('Animation'), 'implied on anime tabs');
  assert.ok(!genreOptions(withAnimation, 'movie-live').includes('Animation'), 'impossible on live-action tabs');
  assert.deepEqual(genreOptions([]), []);
});

test('movies split into live action and anime & cartoons', async () => {
  const live = await buildExplore({ tmdb: fake, items: lib, type: 'movie-live' });
  const toons = await buildExplore({ tmdb: fake, items: lib, type: 'movie-animated' });
  const all = await buildExplore({ tmdb: fake, items: lib, type: 'movie' });
  assert.ok(live.length && live.every((i) => i.type === 'movie') && !live.some((i) => i.title === 'Spirited Away'));
  assert.deepEqual(
    toons.map((i) => i.title),
    ['Spirited Away'],
  );
  assert.ok(all.some((i) => i.title === 'Spirited Away') && all.some((i) => i.title === 'Interstellar'));
});

test('the genre filter narrows the list without changing anyone’s match', async () => {
  const unfiltered = await buildExplore({ tmdb: fake, items: lib });
  fake.calls.length = 0;
  const sciFi = await buildExplore({ tmdb: fake, items: lib, genre: 'Science Fiction' });
  assert.ok(sciFi.length > 0);
  const titles = sciFi.map((i) => i.title);
  assert.ok(
    titles.includes('Interstellar') && titles.includes('Station Eleven'),
    'movies and shows (Sci-Fi & Fantasy)',
  );
  assert.ok(!titles.includes('Ozark') && !titles.includes('Sitcom'), 'other genres left out');
  for (const s of sciFi) {
    const same = unfiltered.find((u) => u.title === s.title);
    if (same) assert.equal(s.match, same.match, `${s.title} keeps its %`);
  }
  // An extra search for the genre keeps the list full: Science Fiction on movies, Sci-Fi & Fantasy on shows.
  const genreSearches = fake.calls.filter((c) => c[0] === 'discover' && /878|10765/.test(c[2].with_genres ?? ''));
  assert.ok(genreSearches.some((c) => c[1] === 'movie') && genreSearches.some((c) => c[1] === 'tv'));
});

test('a genre on an anime tab searches animated titles in that genre', async () => {
  fake.calls.length = 0;
  await buildExplore({ tmdb: fake, items: lib, type: 'movie-animated', genre: 'Science Fiction' });
  assert.ok(fake.calls.some((c) => c[0] === 'discover' && c[2].with_genres === '16,878'));
});

import { exploreTabs, resolveTab } from '../server/explore/index.js';

const title = (type, genres = ['Drama']) => ({ type, label: 'watched', cache: { genres } });
const cartoon = (type) => title(type, ['Animation', 'Comedy']);

test('tabs only appear for the kinds of title you have', () => {
  assert.deepEqual(exploreTabs([]), [], 'empty library: no tabs');
  assert.deepEqual(exploreTabs([title('movie')]), ['movie'], 'only movies');
  assert.deepEqual(exploreTabs([title('tv')]), ['tv'], 'only live-action shows: one Shows tab');
  assert.deepEqual(exploreTabs([cartoon('tv')]), ['tv'], 'only cartoons: still one Shows tab');
  assert.deepEqual(exploreTabs([title('movie'), title('tv')]), ['all', 'movie', 'tv']);
  assert.deepEqual(exploreTabs([title('movie'), title('tv'), cartoon('tv')]), [
    'all',
    'movie',
    'tv-live',
    'tv-animated',
  ]);
  assert.deepEqual(
    exploreTabs([title('tv'), cartoon('tv')]),
    ['all', 'tv-live', 'tv-animated'],
    'both kinds, no movies',
  );
  assert.deepEqual(
    exploreTabs([title('movie'), cartoon('movie')]),
    ['movie', 'movie-live', 'movie-animated'],
    'movie kinds',
  );
});

test('a tab you do not have falls back to the closest one you do', () => {
  const oneKind = ['all', 'movie', 'tv'];
  assert.equal(resolveTab('tv-animated', oneKind), 'tv');
  assert.equal(resolveTab('movie-live', oneKind), 'movie');
  assert.equal(resolveTab('tv', ['all', 'movie', 'tv-live', 'tv-animated']), 'tv-live');
  assert.equal(resolveTab('all', ['movie']), 'movie');
  assert.equal(resolveTab(undefined, oneKind), 'all');
  assert.equal(resolveTab('nonsense', oneKind), 'all');
});

import { affinity, reasonFor } from '../server/explore/index.js';

test('ratings scale how much a title counts, and Meh is still a like', () => {
  const finished = { type: 'tv', label: 'watched', progress: { season: 5, episode: 16 }, cache: {} };
  const unrated = affinity(finished);
  const great = affinity({ ...finished, rating: 3 });
  const good = affinity({ ...finished, rating: 2 });
  const meh = affinity({ ...finished, rating: 1 });
  assert.ok(great > good && good === unrated && meh < good, `${great} > ${good} = ${unrated} > ${meh}`);
  const dropped = {
    type: 'tv',
    label: 'watching',
    progress: { season: 1, episode: 2 },
    updatedAt: '2020-01-01',
    addedAt: '2020-01-01',
    cache: { seasons: [{ season: 1, episodeCount: 20 }], lastEpisode: { season: 1, episode: 20 } },
  };
  assert.ok(meh > affinity(dropped), 'a Meh rating still counts more than a show that looks dropped');
  // A rating is a clear opinion: a show you rated Great counts well above a dropped one, even if you
  // stopped early, though less than one you finished.
  assert.ok(affinity({ ...dropped, rating: 3 }) > 0.6, 'rated Great counts like a real like');
  assert.ok(affinity({ ...dropped, rating: 3 }) < affinity({ ...finished, rating: 3 }));
});

test('suggestions from a title you rated Great say you loved it', () => {
  assert.equal(
    reasonFor({ recommendedBy: [{ title: 'Severance', label: 'watching', rating: 3, weight: 1.3 }] }),
    'Because you loved Severance',
  );
});

test('a rating does not count while the title is in Planned', () => {
  const planned = { type: 'movie', label: 'planned', rating: 3, cache: {} };
  assert.equal(affinity(planned), affinity({ ...planned, rating: undefined }));
});
