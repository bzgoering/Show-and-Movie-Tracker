import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';
import { createLibrarySync } from '../server/library/sync.js';
import { applyChanges, applyDetails, isStale, newItem } from '../server/library/items.js';
import { applySettingsPatch, settingsOf } from '../server/settings.js';
import * as fakeTmdb from './fake-tmdb.js';

const show = (extra = {}) => ({
  id: 'tmdb-tv-1396',
  tmdbId: 1396,
  type: 'tv',
  title: 'Old title',
  label: 'watching',
  progress: { season: 2, episode: 3 },
  cache: {
    status: 'Returning Series',
    lastEpisode: { season: 5, episode: 16 },
    lastFetched: '2020-01-01T00:00:00.000Z',
  },
  ...extra,
});

async function storeWith(items) {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-lib-')), 'library.json');
  await fs.writeFile(file, JSON.stringify({ items }));
  return createStore(file);
}

test('saving a change does not wait for a slow TMDB refresh', async () => {
  const store = await storeWith([show()]);
  let release;
  const slowTmdb = {
    ...fakeTmdb,
    getDetails: async (...args) => {
      await new Promise((r) => (release = r));
      return fakeTmdb.getDetails(...args);
    },
  };
  process.env.TMDB_API_KEY = 'test';
  try {
    const sync = createLibrarySync({ store, tmdb: slowTmdb, log: () => {} });
    const refreshing = sync.refreshAll();
    await new Promise((r) => setTimeout(r, 20)); // the refresh is now waiting on TMDB

    // A label change goes through straight away instead of queueing behind the refresh.
    const saved = await Promise.race([
      store.update((d) => applyChanges(d.items[0], { label: 'watched' })),
      new Promise((r) => setTimeout(() => r('timed out'), 500)),
    ]);
    assert.notEqual(saved, 'timed out');

    release();
    const summary = await refreshing;
    assert.equal(summary.updated, 1);
    const [item] = (await store.read()).items;
    assert.equal(item.title, 'Breaking Bad', 'refresh saved');
    assert.equal(item.label, 'watched', 'and the change made during it was kept');
  } finally {
    delete process.env.TMDB_API_KEY;
  }
});

test('a refresh keeps titles removed while it ran removed', async () => {
  const store = await storeWith([show()]);
  let release;
  const slowTmdb = {
    ...fakeTmdb,
    getDetails: async (...a) => (await new Promise((r) => (release = r)), fakeTmdb.getDetails(...a)),
  };
  process.env.TMDB_API_KEY = 'test';
  try {
    const sync = createLibrarySync({ store, tmdb: slowTmdb, log: () => {} });
    const refreshing = sync.refreshAll();
    await new Promise((r) => setTimeout(r, 20));
    await store.update((d) => (d.items = []));
    release();
    await refreshing;
    assert.deepEqual((await store.read()).items, []);
  } finally {
    delete process.env.TMDB_API_KEY;
  }
});

test('refreshing without a key reports why, and changes nothing', async () => {
  const store = await storeWith([show()]);
  const summary = await createLibrarySync({ store, tmdb: fakeTmdb }).refreshAll();
  assert.match(summary.error, /TMDB_API_KEY/);
  assert.equal((await store.read()).items[0].title, 'Old title');
});

test('new items: planned by default, shows start at the beginning or caught up when watched', () => {
  const details = {
    title: 'T',
    year: 2020,
    posterPath: null,
    overview: '',
    cache: { lastEpisode: { season: 3, episode: 8 } },
  };
  const now = new Date('2026-01-01T00:00:00Z');
  const planned = newItem({ type: 'tv', tmdbId: 1, details, now });
  assert.equal(planned.id, 'tmdb-tv-1');
  assert.equal(planned.label, 'planned');
  assert.deepEqual(planned.progress, { season: 1, episode: 0 });
  assert.deepEqual(newItem({ type: 'tv', tmdbId: 1, details, label: 'watched' }).progress, { season: 3, episode: 8 });
  const movie = newItem({ type: 'movie', tmdbId: 2, details, label: 'watching', fromExplore: true });
  assert.equal(movie.label, 'planned', 'movies cannot be "watching"');
  assert.equal(movie.addedFrom, 'explore');
  assert.equal('progress' in movie, false);
});

test('changes are validated', () => {
  assert.throws(() => applyChanges(show(), { label: 'nope' }), /Label must be one of/);
  assert.throws(() => applyChanges(show(), { progress: { season: 0, episode: 1 } }), /season of 1 or more/);
  assert.throws(() => applyChanges(show(), { progress: { season: 6, episode: 1 } }), /hasn't aired yet/);
  const item = applyChanges(show(), { progress: { season: '5', episode: '16' }, userMarkedEnded: 1 });
  assert.deepEqual(item.progress, { season: 5, episode: 16 });
  assert.equal(item.userMarkedEnded, true);
});

test('fresh TMDB info keeps your label, progress and streaming info', () => {
  const item = show({
    label: 'planned',
    cache: { status: 'Returning Series', providers: { region: 'US', stream: [] } },
  });
  const revived = applyDetails(item, {
    title: 'New',
    year: 2008,
    posterPath: '/p.jpg',
    overview: 'o',
    cache: { status: 'Returning Series' },
  });
  assert.equal(revived, false);
  assert.equal(item.title, 'New');
  assert.equal(item.label, 'planned');
  assert.deepEqual(item.progress, { season: 2, episode: 3 });
  assert.deepEqual(item.cache.providers, { region: 'US', stream: [] });
});

test('stale check', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(isStale({ cache: { lastFetched: '2026-01-01T10:00:00Z' } }, now), false);
  assert.equal(isStale({ cache: { lastFetched: '2026-01-01T00:00:00Z' } }, now), true);
  assert.equal(isStale({}, now), true);
});

test('settings default to WATCH_REGION and are validated', () => {
  process.env.WATCH_REGION = 'gb';
  try {
    assert.deepEqual(settingsOf({}), { region: 'GB', services: [] });
  } finally {
    delete process.env.WATCH_REGION;
  }
  assert.deepEqual(applySettingsPatch({ region: 'US', services: [] }, { services: [8, '9', 8] }), {
    region: 'US',
    services: [8, 9],
  });
  assert.throws(() => applySettingsPatch({}, { region: 'usa' }), /two-letter/);
  assert.throws(() => applySettingsPatch({}, { services: 'netflix' }), /list of provider ids/);
});

test('notices when server code changes after starting', async () => {
  const { watchForCodeChanges } = await import('../server/code-version.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-code-'));
  await fs.mkdir(path.join(root, 'server', 'routes'), { recursive: true });
  const file = path.join(root, 'server', 'routes', 'a.js');
  await fs.writeFile(file, '// v1');
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(file, past, past);
  const isOutdated = watchForCodeChanges(root, ['server']);
  assert.equal(isOutdated(), false);
  await fs.writeFile(file, '// v2'); // e.g. git pull
  assert.equal(isOutdated(), true);
});

test('ratings: 1-3 saved, null clears, anything else refused', () => {
  const item = show();
  assert.equal(applyChanges(item, { rating: 3 }).rating, 3);
  assert.equal('rating' in applyChanges(item, { rating: null }), false);
  for (const bad of [0, 4, 2.5, '2', 'great']) {
    assert.throws(() => applyChanges(show(), { rating: bad }), /Rating must be/);
  }
  const movie = applyChanges({ type: 'movie', label: 'watched' }, { rating: 1 });
  assert.equal(movie.rating, 1, 'any title you have seen can be rated, any time');
});

test('titles in Planned cannot be rated; an earlier rating is kept but hidden', async () => {
  const { ratingOf } = await import('../public/shared/media.js');
  assert.throws(() => applyChanges({ type: 'movie', label: 'planned' }, { rating: 2 }), /Planned can't be rated/);
  assert.equal(
    applyChanges({ type: 'movie', label: 'planned' }, { label: 'watched', rating: 2 }).rating,
    2,
    'rated as it leaves Planned',
  );
  const item = applyChanges({ type: 'tv', label: 'watched', cache: {} }, { rating: 3 });
  applyChanges(item, { label: 'planned' }); // moved to Planned (maybe by mistake)
  assert.equal(item.rating, 3, 'kept');
  assert.equal(ratingOf(item), undefined, 'but hidden while in Planned');
  assert.equal('rating' in applyChanges(item, { rating: null }), false, 'clearing still works');
  applyChanges(item, { label: 'watched', rating: 3 });
  assert.equal(ratingOf(item), 3, 'back once it leaves Planned');
});
