import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortItems, releaseDate } from '../public/sort.js';

const seasons = [{ season: 1, episodeCount: 8, airDate: '2020-01-01' }];
const latest = { season: 1, episode: 8 };
const tv = (title, label, progress, extra = {}) => ({
  type: 'tv', title, label, progress,
  cache: { seasons, lastEpisode: latest, ...extra.cache },
  prediction: extra.prediction || { kind: 'confirmed' },
  year: extra.year,
});
const movie = (title, label, cache = {}, year) => ({ type: 'movie', title, label, cache, year });

const items = [
  tv('Zebra Watch', 'watching', { season: 1, episode: 2 }, { cache: { genres: ['Drama'], firstAirDate: '2019-05-01' } }),
  tv('apple Wait', 'watching', { season: 1, episode: 8 }, { cache: { genres: ['Comedy'], firstAirDate: '2024-02-01' } }),
  movie('Middle Movie', 'planned', { genres: ['Action'], releaseDate: '2022-07-01' }),
  movie('Banana Done', 'watched', { genres: ['Drama'] }, 2010),
  tv('No Data', 'planned', { season: 1, episode: 0 }),
];
const titles = (list) => list.map((i) => i.title);

test('A-Z ignores case and is the default', () => {
  assert.deepEqual(titles(sortItems(items)), ['apple Wait', 'Banana Done', 'Middle Movie', 'No Data', 'Zebra Watch']);
});

test('progress goes Watching, Waiting, Planned, Watched, then A-Z', () => {
  assert.deepEqual(titles(sortItems(items, 'progress')), ['Zebra Watch', 'apple Wait', 'Middle Movie', 'No Data', 'Banana Done']);
});

test('release date is newest first, with the year as a fallback and unknowns last', () => {
  assert.deepEqual(titles(sortItems(items, 'release')), ['apple Wait', 'Middle Movie', 'Zebra Watch', 'Banana Done', 'No Data']);
  assert.equal(releaseDate(items[3]), '2010-01-01');
});

test('genre groups by main genre, A-Z inside, unknowns last', () => {
  assert.deepEqual(titles(sortItems(items, 'genre')), ['Middle Movie', 'apple Wait', 'Banana Done', 'Zebra Watch', 'No Data']);
});

test('does not change the original list', () => {
  const before = titles(items);
  sortItems(items, 'genre');
  assert.deepEqual(titles(items), before);
});
