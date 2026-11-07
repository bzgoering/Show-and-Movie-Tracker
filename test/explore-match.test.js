// How much each library title counts, the extra signals, and whether the match % means what it says.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_WEIGHTS,
  affinity,
  buildExplore,
  calibrationShift,
  clearExploreCache,
  learnWeights,
  matchFor,
  pickSeeds,
  reasonFor,
  scoreCandidate,
  scoreParts,
  tasteProfile,
} from '../server/explore/index.js';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import * as sharedFake from './fake-tmdb.js';

beforeEach(() => clearExploreCache());

const TODAY = new Date('2026-11-06T12:00:00Z');
const ago = (days) => new Date(TODAY.getTime() - days * 864e5).toISOString();

// A library show. `progress` is the last episode finished; `idle` is days since you last changed it.
function show(
  tmdbId,
  title,
  label,
  { progress = [1, 0], seasons = [10], idle = 5, genres = ['Drama', 'Crime'], lang = 'en', from } = {},
) {
  const cache = {
    status: 'Returning Series',
    genres,
    originalLanguage: lang,
    seasons: seasons.map((n, i) => ({ season: i + 1, episodeCount: n, airDate: `${2015 + i}-01-01` })),
    lastEpisode: { season: seasons.length, episode: seasons.at(-1) },
  };
  if (!genres) delete cache.genres;
  if (!lang) delete cache.originalLanguage;
  const [season, episode] = label === 'watched' && !progress[0] ? [seasons.length, seasons.at(-1)] : progress;
  return {
    id: `tmdb-tv-${tmdbId}`,
    tmdbId,
    type: 'tv',
    title,
    label,
    progress: { season, episode },
    cache,
    addedAt: ago(idle + 1),
    updatedAt: ago(idle),
    ...(from ? { addedFrom: from } : {}),
  };
}
function film(tmdbId, title, label, { genres = ['Crime', 'Drama'], lang = 'en', from } = {}) {
  return {
    id: `tmdb-movie-${tmdbId}`,
    tmdbId,
    type: 'movie',
    title,
    label,
    cache: { genres, originalLanguage: lang },
    addedAt: ago(10),
    updatedAt: ago(10),
    ...(from ? { addedFrom: from } : {}),
  };
}

// ---------- How much each title counts ----------

test('a finished or caught-up show counts most, a dropped one least', () => {
  const finished = show(1, 'Finished', 'watched', { progress: [3, 10], seasons: [10, 10, 10] });
  const waiting = show(2, 'Waiting', 'watching', { progress: [2, 8], seasons: [10, 8] }); // caught up, more to come
  const deep = show(3, 'Deep', 'watching', { progress: [3, 2], seasons: [10, 10, 10] });
  const early = show(4, 'Early', 'watching', { progress: [1, 2], seasons: [10, 10, 10], idle: 3 });
  const dropped = show(5, 'Dropped', 'watching', { progress: [1, 2], seasons: [10, 10, 10], idle: 200 });
  const planned = show(6, 'Planned', 'planned');
  const fromExplore = show(7, 'Saved from Explore', 'planned', { from: 'explore' });
  const a = (i) => affinity(i, { today: TODAY });
  assert.equal(a(finished), 1);
  assert.equal(a(waiting), 1, 'caught up (Waiting) is as strong as finished');
  assert.ok(a(deep) > a(early), 'further in counts more');
  assert.ok(a(early) > a(planned), 'started beats only planned');
  assert.ok(a(dropped) < a(planned) && a(dropped) <= 0.2, 'stuck at S1E2 for months looks like a drop');
  assert.ok(a(fromExplore) < a(planned), "Explore's own suggestions don't echo back as strongly");
  assert.equal(a(film(8, 'Movie', 'watched')), 0.8);
  // Marked Watched, but the saved episode says you stopped early in season 1.
  assert.ok(a(show(9, 'Gave up', 'watched', { progress: [1, 3], seasons: [10, 10, 10] })) < a(finished));
});

test('people who never set episodes are not treated as dropping everything', () => {
  const lib = [
    show(1, 'A', 'watching', { idle: 300 }),
    show(2, 'B', 'watching', { idle: 300 }),
    show(3, 'C', 'watched'),
  ];
  const p = tasteProfile(lib, { today: TODAY });
  assert.equal(p.liking.get(lib[0]), 0.6, 'no progress anywhere, so "not started" says nothing');
});

test('old library items without episode info or genres still work', () => {
  const bare = {
    type: 'tv',
    tmdbId: 1,
    title: 'Old',
    label: 'watching',
    progress: { season: 2, episode: 3 },
    cache: {},
  };
  assert.equal(affinity(bare, { today: TODAY }), 0.6);
  assert.equal(affinity({ type: 'tv', tmdbId: 2, label: 'watched' }, { today: TODAY }), 1);
  const p = tasteProfile([bare], { today: TODAY });
  assert.equal(p.genreConfidence, 0);
  assert.equal(scoreParts({ type: 'tv', genres: ['Drama'] }, p).genre, null, 'no genres to compare yet');
});

// ---------- Scenario: a crime-drama fan ----------

const GENRES = {
  tv: new Map([
    [18, 'Drama'],
    [80, 'Crime'],
    [9648, 'Mystery'],
    [35, 'Comedy'],
    [10764, 'Reality'],
    [16, 'Animation'],
    [10759, 'Action & Adventure'],
    [10765, 'Sci-Fi & Fantasy'],
  ]),
  movie: new Map([
    [18, 'Drama'],
    [80, 'Crime'],
    [53, 'Thriller'],
    [35, 'Comedy'],
    [28, 'Action'],
    [878, 'Science Fiction'],
  ]),
};
const cand = (tmdbId, type, title, genreIds, voteAverage, extra = {}) => ({
  tmdbId,
  type,
  title,
  year: 2020,
  releaseDate: '2020-01-01',
  posterPath: `/c${tmdbId}.jpg`,
  overview: '',
  genreIds,
  originalLanguage: 'en',
  voteAverage,
  voteCount: 3000,
  popularity: 100,
  ...extra,
});
function fakeTmdb(recs = {}, disc = {}) {
  const calls = [];
  return {
    calls,
    genreMap: async (type) => GENRES[type],
    recommendations: async (type, id) => (calls.push(['rec', type, id]), structuredClone(recs[`${type}-${id}`] || [])),
    discover: async (type, params) => (calls.push(['discover', type, params]), structuredClone(disc[type] || [])),
    watchProviders: async () => ({ link: null, stream: [], rent: [], buy: [] }),
  };
}

const crimeFan = [
  show(1, 'Breaking Bad', 'watched', { seasons: [7, 13, 13, 13, 16], idle: 200 }),
  show(2, 'Better Call Saul', 'watched', { seasons: [10, 10, 10, 10, 10, 13], idle: 90 }),
  show(3, 'Mindhunter', 'watching', { progress: [2, 9], seasons: [10, 9], genres: ['Crime', 'Drama', 'Mystery'] }), // caught up
  show(4, 'Ozark', 'watching', { progress: [3, 6], seasons: [10, 10, 14] }),
  show(5, 'The Wire', 'watching', { progress: [1, 2], seasons: [13, 12, 12], idle: 240 }), // stuck for 8 months
  film(6, 'The Godfather', 'watched'),
];
const peaky = cand(101, 'tv', 'Peaky Blinders', [18, 80], 8.5);
const byFinished = cand(104, 'tv', 'Recommended by a finished show', [18, 80], 8.2);
const byDropped = cand(103, 'tv', 'Recommended by a dropped show', [18, 80], 8.2);
const mediocre = cand(107, 'tv', 'Mediocre', [18, 80], 6.0);
const korean = cand(109, 'tv', 'Korean crime show', [18, 80], 8.2, { originalLanguage: 'ko' });
const unreleased = cand(108, 'tv', 'Not out yet', [18, 80], 0, { voteCount: 0, releaseDate: '2027-05-01' });
const crimeTmdb = () =>
  fakeTmdb(
    {
      'tv-1': [peaky, byFinished, mediocre, korean, unreleased],
      'tv-2': [peaky],
      'tv-3': [peaky],
      'tv-5': [byDropped],
      'movie-6': [cand(201, 'movie', 'Heat', [80, 18, 28], 7.9)],
    },
    {
      tv: [
        cand(102, 'tv', 'Popular Sitcom', [35], 8.6, { popularity: 400 }),
        cand(105, 'tv', 'Crime Mystery', [80, 9648, 18], 8.3),
        cand(106, 'tv', 'Drama Only', [18], 8.3),
        cand(110, 'tv', 'Anime', [16, 10759, 10765], 8.7, { originalLanguage: 'ja' }),
      ],
      movie: [cand(202, 'movie', 'Comedy Movie', [35], 7.0)],
    },
  );
const run = (tmdb, opts = {}) => buildExplore({ tmdb, items: crimeFan, today: TODAY, ...opts });
const pct = (list, title) => list.find((c) => c.title === title)?.match;

test('several finished shows in your favourite genres give a high match, far above a popular off-genre title', async () => {
  const list = await run(crimeTmdb());
  assert.ok(pct(list, 'Peaky Blinders') >= 90, `got ${pct(list, 'Peaky Blinders')}%`);
  assert.equal(list[0].title, 'Peaky Blinders');
  assert.ok(pct(list, 'Popular Sitcom') < 30, `popular but off-genre: ${pct(list, 'Popular Sitcom')}%`);
  assert.match(list[0].reason, /^Because you watched (Breaking Bad|Better Call Saul), plus 2 more of your titles$/);
});

test('a recommendation from a dropped show counts far less than one from a finished show', async () => {
  const tmdb = crimeTmdb();
  const list = await run(tmdb);
  const finished = pct(list, 'Recommended by a finished show');
  assert.ok(finished >= 75, `one finished show: ${finished}%`);
  assert.ok(!tmdb.calls.some((c) => c[0] === 'rec' && c[2] === 5), 'a dropped show does not seed suggestions');
  // Scored directly, with the same weight the library gives each show.
  const p = tasteProfile(crimeFan, { today: TODAY });
  const by = (item) =>
    matchFor(
      scoreCandidate({ ...byDropped, genres: ['Drama', 'Crime'], recommendedBy: [{ weight: p.liking.get(item) }] }, p),
    );
  assert.ok(by(crimeFan[0]) - by(crimeFan[4]) >= 20, `finished ${by(crimeFan[0])}% vs dropped ${by(crimeFan[4])}%`);
});

test('genre fit alone is a medium match, and Drama alone counts for less', async () => {
  const list = await run(crimeTmdb());
  const genreOnly = pct(list, 'Crime Mystery');
  assert.ok(genreOnly >= 35 && genreOnly <= 70, `close genres, nothing recommends it: ${genreOnly}%`);
  assert.ok(pct(list, 'Drama Only') < genreOnly, 'Drama is too broad to say much on its own');
  assert.ok(pct(list, 'Anime') < 25, 'nothing in your library is animated');
});

test('poor ratings and unfamiliar languages trim a match; unreleased titles are left out', async () => {
  const list = await run(crimeTmdb());
  const base = pct(list, 'Recommended by a finished show');
  assert.ok(pct(list, 'Mediocre') <= base - 10, 'same evidence, much worse rating');
  const ko = pct(list, 'Korean crime show');
  assert.ok(ko < base && ko >= base * 0.9 - 1, `a language you never watch costs at most 10%: ${ko}% vs ${base}%`);
  assert.ok(!list.some((c) => c.title === 'Not out yet'));
});

test('the match % only goes down the list, with dislikes and learned weights too', async () => {
  const feedback = [
    ...[0.9, 0.8, 0.95].map((rec) => ({
      action: 'added',
      parts: { genre: 0.8, rec, quality: 0.7, type: 1, language: 1 },
    })),
    ...[0.1, 0].map((rec) => ({ action: 'disliked', parts: { genre: 0.7, rec, quality: 0.7, type: 1, language: 1 } })),
  ];
  const dislikes = [{ type: 'tv', tmdbId: 999, title: 'Hidden', genres: ['Comedy'] }];
  for (const type of ['all', 'movie', 'tv-live', 'tv-animated']) {
    const list = await run(crimeTmdb(), { type, feedback, dislikes });
    assert.ok(list.length > 0, type);
    for (let i = 1; i < list.length; i++)
      assert.ok(list[i - 1].match >= list[i].match, `${type}: ${list[i - 1].title} before ${list[i].title}`);
  }
});

test('a title shows the same match on every tab it appears on', async () => {
  const all = await run(crimeTmdb());
  const live = await run(crimeTmdb(), { type: 'tv-live' });
  const movies = await run(crimeTmdb(), { type: 'movie' });
  const anime = await run(crimeTmdb(), { type: 'tv-animated' });
  assert.equal(pct(live, 'Peaky Blinders'), pct(all, 'Peaky Blinders'));
  assert.equal(pct(movies, 'Heat'), pct(all, 'Heat'));
  assert.equal(pct(anime, 'Anime'), pct(all, 'Anime'));
});

test('a new user with one saved title gets modest matches', async () => {
  const one = await buildExplore({ tmdb: crimeTmdb(), items: [show(1, 'Breaking Bad', 'planned')], today: TODAY });
  assert.ok(pct(one, 'Peaky Blinders') <= 50, `one saved title is thin evidence: ${pct(one, 'Peaky Blinders')}%`);
});

test('an old library file without genres or languages still gets sensible matches', async () => {
  const items = crimeFan.map((i) => ({ ...i, cache: { ...i.cache, genres: undefined, originalLanguage: undefined } }));
  const list = await buildExplore({ tmdb: crimeTmdb(), items, today: TODAY });
  assert.ok(pct(list, 'Recommended by a finished show') >= 60);
  assert.equal(
    pct(list, 'Korean crime show'),
    pct(list, 'Recommended by a finished show'),
    'language unknown, so no trim',
  );
});

// ---------- Seeds and searches ----------

test('seeds: a movie-only library uses all 10 on movies', () => {
  const movies = Array.from({ length: 15 }, (_, i) => film(50 + i, `Movie ${i}`, 'watched'));
  assert.equal(pickSeeds(movies, { liking: tasteProfile(movies, { today: TODAY }).liking }).length, 10);
});

test('seeds: shows and movies each get their own, both kinds of show get a turn, dropped shows are skipped', () => {
  const live = Array.from({ length: 10 }, (_, i) => show(10 + i, `Live ${i}`, 'watched'));
  const anime = Array.from({ length: 3 }, (_, i) =>
    show(30 + i, `Anime ${i}`, 'watched', { genres: ['Animation', 'Action & Adventure'], lang: 'ja', idle: 400 }),
  );
  const dropped = show(40, 'Dropped', 'watching', { progress: [1, 1], seasons: [10, 10], idle: 300 });
  const movies = Array.from({ length: 8 }, (_, i) => film(50 + i, `Movie ${i}`, 'watched'));
  const items = [...live, ...anime, dropped, ...movies, film(60, 'Saved', 'planned')];
  const seeds = pickSeeds(items, { liking: tasteProfile(items, { today: TODAY }).liking });
  const shows = seeds.filter((s) => s.type === 'tv');
  assert.ok(seeds.length <= 10, 'one request each, so at most 10');
  assert.ok(shows.length >= 4 && seeds.length - shows.length >= 4, 'shows and movies each get at least 4');
  assert.equal(shows.filter((s) => s.title.startsWith('Anime')).length, 3, 'the older anime still seed the anime tab');
  assert.ok(!seeds.includes(dropped));
  assert.ok(
    seeds.some((s) => s.title === 'Saved'),
    'a planned movie gets a turn',
  );
});

test('the Movies tab only asks for movie recommendations; Anime & cartoons searches in your anime language', async () => {
  const tmdb = crimeTmdb();
  await run(tmdb, { type: 'movie' });
  assert.deepEqual(
    tmdb.calls.filter((c) => c[0] === 'rec').map((c) => c[1]),
    ['movie'],
  );

  const animeFan = [
    show(1, 'Frieren', 'watching', {
      progress: [1, 28],
      seasons: [28],
      genres: ['Animation', 'Action & Adventure'],
      lang: 'ja',
    }),
    show(2, 'Attack on Titan', 'watched', { seasons: [25, 12], genres: ['Animation', 'Sci-Fi & Fantasy'], lang: 'ja' }),
  ];
  const t2 = crimeTmdb();
  await buildExplore({ tmdb: t2, items: animeFan, type: 'tv-animated', today: TODAY });
  const searches = t2.calls.filter((c) => c[0] === 'discover').map((c) => c[2]);
  assert.ok(
    searches.some((p) => p.with_genres === '16'),
    'popular animation',
  );
  assert.ok(
    searches.some((p) => p.with_genres === '16,10759' && p.with_original_language === 'ja'),
    'animated, in your top genre and language',
  );

  const t3 = crimeTmdb();
  await run(t3, { type: 'tv-live' });
  const live = t3.calls.filter((c) => c[0] === 'discover').map((c) => c[2]);
  assert.ok(
    live.some((p) => p.with_genres === '18|80|9648'),
    'any of your top genres',
  );
  assert.ok(
    live.some((p) => p.with_genres === '18,80'),
    'both of your top two',
  );
  assert.ok(live.every((p) => p.without_genres === '16'));
});

// ---------- Learning and the feedback check ----------

test('the match numbers move toward how often you actually add suggestions', () => {
  const picks = (adds, hides, score) => [
    ...Array.from({ length: adds }, () => ({ action: 'added', score })),
    ...Array.from({ length: hides }, () => ({ action: 'disliked', score })),
  ];
  assert.equal(calibrationShift(picks(3, 3, 0.8)), 0, 'needs 10 picks');
  assert.equal(
    calibrationShift([...picks(3, 6, 0.8), { action: 'added', match: 80 }]),
    0,
    'old feedback without a score is ignored',
  );
  assert.ok(
    Math.abs(calibrationShift(picks(4, 6, 0.8)) - -0.1) < 1e-9,
    '80% shown but 40% added: down, at most 10 points',
  );
  assert.ok(Math.abs(calibrationShift(picks(6, 4, 0.5)) - 0.05) < 1e-9, '50% shown but 60% added: up by half the gap');
  assert.equal(calibrationShift(picks(7, 3, 0.7)), 0, 'already right');
  assert.equal(matchFor(0.995), 99, 'never 100%');
  assert.equal(matchFor(0.05, -0.1), 0);
  assert.ok(matchFor(0.8, -0.1) >= matchFor(0.7, -0.1), 'the same shift for every title keeps the order');
});

test('learning ignores signals that old feedback did not record', () => {
  const same = { genre: 0.5, rec: 0.5, quality: 0.5, type: 0.5 }; // no language
  const fb = [
    ...Array.from({ length: 3 }, () => ({ action: 'added', parts: same })),
    ...Array.from({ length: 2 }, () => ({ action: 'disliked', parts: same })),
  ];
  const w = learnWeights(fb);
  for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) assert.ok(Math.abs(w[k] - v) < 1e-9, k);
});

test('reasons mention how many of your titles point to a suggestion, leading with one you finished', () => {
  const recs = [
    { title: 'Ozark', label: 'watching', weight: 1 },
    { title: 'Breaking Bad', label: 'watched', weight: 1 },
    { title: 'Narcos', label: 'planned', weight: 0.3 },
  ];
  assert.equal(reasonFor({ recommendedBy: recs }), 'Because you watched Breaking Bad, plus 2 more of your titles');
});

test('feedback saves the score behind the match, for the feedback check', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-score-')), 'library.json');
  const store = createStore(file);
  await store.init();
  await store.update((d) =>
    d.items.push({
      id: 'tmdb-tv-1396',
      tmdbId: 1396,
      type: 'tv',
      title: 'Breaking Bad',
      label: 'watched',
      cache: { genres: ['Drama', 'Crime'] },
    }),
  );
  const s = createApp({ store, tmdb: sharedFake }).listen(0);
  await new Promise((r) => s.once('listening', r));
  const base = `http://localhost:${s.address().port}`;
  try {
    const { items } = await (await fetch(`${base}/api/explore`)).json();
    const target = items[0];
    await fetch(`${base}/api/explore/dislikes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: target.type, tmdbId: target.tmdbId }),
    });
    const fb = JSON.parse(await fs.readFile(file, 'utf8')).feedback.at(-1);
    assert.equal(typeof fb.score, 'number');
    assert.equal(fb.match, matchFor(fb.score));
    assert.equal(fb.match, target.match);
  } finally {
    s.close();
  }
});
