import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import * as fakeTmdb from './fake-tmdb.js';

let server;
let base;
let file;

before(async () => {
  file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-api-')), 'library.json');
  const store = createStore(file);
  await store.init();
  server = createApp({ store, tmdb: fakeTmdb }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test('library starts empty', async () => {
  assert.deepEqual((await call('GET', '/api/library')).body.items, []);
});

test('search marks what is already in the library', async () => {
  await call('POST', '/api/library', { type: 'movie', tmdbId: 27205 });
  const { body } = await call('GET', '/api/search?q=inc');
  assert.equal(body[0].title, 'Inception');
  assert.equal(body[0].inLibrary, true);
});

test('adding a show sets defaults and a prediction', async () => {
  const { status, body } = await call('POST', '/api/library', { type: 'tv', tmdbId: 100088 });
  assert.equal(status, 201);
  assert.equal(body.label, 'planned');
  assert.deepEqual(body.progress, { season: 1, episode: 0 });
  assert.equal(body.prediction.kind, 'estimated');
});

test('adding the same title twice does not duplicate it', async () => {
  await call('POST', '/api/library', { type: 'tv', tmdbId: 100088 });
  const { body } = await call('GET', '/api/library');
  assert.equal(body.items.filter((i) => i.id === 'tmdb-tv-100088').length, 1);
});

test('updates label, progress and ended flag, and saves them to disk', async () => {
  const { body } = await call('PATCH', '/api/library/tmdb-tv-100088', {
    label: 'watching',
    progress: { season: 2, episode: 3 },
    userMarkedEnded: true,
  });
  assert.equal(body.label, 'watching');
  assert.deepEqual(body.progress, { season: 2, episode: 3 });
  assert.equal(body.prediction.kind, 'ended');

  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(saved.items.find((i) => i.id === 'tmdb-tv-100088').label, 'watching');
});

test('rejects bad input', async () => {
  assert.equal((await call('PATCH', '/api/library/tmdb-movie-27205', { label: 'watching' })).status, 400);
  assert.equal((await call('PATCH', '/api/library/tmdb-tv-100088', { progress: { season: 0, episode: 1 } })).status, 400);
  assert.equal((await call('POST', '/api/library', { type: 'book', tmdbId: 1 })).status, 400);
  assert.equal((await call('PATCH', '/api/library/nope', { label: 'watched' })).status, 404);
});

test('refresh and delete', async () => {
  assert.equal((await call('POST', '/api/library/tmdb-movie-27205/refresh')).status, 200);
  assert.equal((await call('DELETE', '/api/library/tmdb-movie-27205')).status, 204);
  assert.equal((await call('DELETE', '/api/library/tmdb-movie-27205')).status, 404);
});

test('progress past the newest aired episode is rejected', async () => {
  await call('POST', '/api/library', { type: 'tv', tmdbId: 1396 }); // Breaking Bad: last episode S5 E16
  const bad = await call('PATCH', '/api/library/tmdb-tv-1396', { progress: { season: 6, episode: 1 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /hasn't aired/);
  assert.equal((await call('PATCH', '/api/library/tmdb-tv-1396', { progress: { season: 5, episode: 16 } })).status, 200);
});

test('syncOnStart refreshes every saved title before the first page load', async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-sync-')), 'library.json');
  const old = '2020-01-01T00:00:00.000Z';
  await fs.writeFile(f, JSON.stringify({ items: [
    { id: 'tmdb-tv-1396', tmdbId: 1396, type: 'tv', title: 'Old title', label: 'watching', progress: { season: 2, episode: 3 }, cache: { status: 'Returning Series', lastFetched: old } },
    { id: 'tmdb-movie-27205', tmdbId: 27205, type: 'movie', title: 'Inception', label: 'planned', cache: { lastFetched: new Date().toISOString() } },
    { id: 'tmdb-tv-999', tmdbId: 999, type: 'tv', title: 'Removed from TMDB', label: 'planned', progress: { season: 1, episode: 0 }, cache: { lastFetched: old } },
  ] }));
  process.env.TMDB_API_KEY = 'test';
  const log = console.log;
  console.log = () => {};
  try {
    const s = createApp({ store: createStore(f), tmdb: fakeTmdb, syncOnStart: true }).listen(0);
    await new Promise((r) => s.once('listening', r));
    const res = await (await fetch(`http://localhost:${s.address().port}/api/library`)).json();
    s.close();

    const bb = res.items.find((i) => i.id === 'tmdb-tv-1396');
    assert.equal(bb.title, 'Breaking Bad', 'refreshed from TMDB');
    assert.equal(bb.cache.status, 'Ended');
    assert.deepEqual(bb.progress, { season: 2, episode: 3 }, 'user progress is kept');
    assert.equal(bb.label, 'watching');
    assert.equal(res.items.find((i) => i.id === 'tmdb-tv-999').title, 'Removed from TMDB', 'failed refresh keeps saved info');
    assert.equal(res.sync.updated, 2, 'fresh items are refreshed on start too');
    assert.equal(res.sync.failed, 1);
  } finally {
    console.log = log;
    delete process.env.TMDB_API_KEY;
  }
});

test('a finished show that comes back moves out of Watched on refresh', async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-revive-')), 'library.json');
  const seasons = [{ season: 1, name: 'Season 1', episodeCount: 8, airDate: '2020-01-01' }];
  await fs.writeFile(f, JSON.stringify({ items: [{
    id: 'tmdb-tv-42', tmdbId: 42, type: 'tv', title: 'Old Name', label: 'watched', userMarkedEnded: true,
    progress: { season: 1, episode: 8 },
    cache: { status: 'Ended', seasons, lastEpisode: { season: 1, episode: 8 }, lastFetched: '2020-01-01T00:00:00.000Z' },
  }] }));
  const revivedTmdb = {
    search: async () => [],
    getDetails: async () => ({
      title: 'New Name', year: 2020, posterPath: null, overview: '',
      cache: {
        status: 'Returning Series', seasons: [...seasons, { season: 2, name: 'Season 2', episodeCount: 8, airDate: '2027-02-01' }],
        lastEpisode: { season: 1, episode: 8 }, nextEpisode: { airDate: '2027-02-01', season: 2, episode: 1 },
        lastFetched: new Date().toISOString(),
      },
    }),
  };
  process.env.TMDB_API_KEY = 'test';
  const log = console.log;
  console.log = () => {};
  try {
    const s = createApp({ store: createStore(f), tmdb: revivedTmdb, syncOnStart: true }).listen(0);
    await new Promise((r) => s.once('listening', r));
    const { items } = await (await fetch(`http://localhost:${s.address().port}/api/library`)).json();
    s.close();
    const show = items[0];
    assert.equal(show.title, 'New Name', 'rebrand picked up');
    assert.equal(show.label, 'watching', 'no longer Watched (the page shows it under Waiting)');
    assert.equal(show.userMarkedEnded, false);
    assert.equal(show.prediction.kind, 'confirmed');
    assert.deepEqual(show.progress, { season: 1, episode: 8 }, 'progress kept');
  } finally {
    console.log = log;
    delete process.env.TMDB_API_KEY;
  }
});

test('settings save region and services', async () => {
  const def = (await call('GET', '/api/settings')).body;
  assert.equal(def.region, 'US');
  assert.deepEqual(def.services, []);
  const saved = await call('PUT', '/api/settings', { region: 'CA', services: [8, '1899', 8] });
  assert.deepEqual(saved.body, { region: 'CA', services: [8, 1899] });
  assert.equal((await call('PUT', '/api/settings', { region: 'usa' })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { services: ['x'] })).status, 400);
  await call('PUT', '/api/settings', { region: 'US', services: [] });
});

test('explore, providers and regions endpoints', async () => {
  const ex = await call('GET', '/api/explore?type=tv');
  assert.equal(ex.status, 200);
  assert.ok(ex.body.items.length > 0 && ex.body.items.every((i) => i.type === 'tv'));
  assert.equal(ex.body.region, 'US');
  assert.equal((await call('GET', '/api/providers')).body[0].name, 'Netflix');
  assert.equal((await call('GET', '/api/regions')).body[1].code, 'US');
});

test('not interested: hide, list, undo, and adding from Explore records feedback', async () => {
  await call('GET', '/api/explore'); // scores suggestions so feedback can record their signals
  const hid = await call('POST', '/api/explore/dislikes', { type: 'tv', tmdbId: 4 });
  assert.equal(hid.status, 201);
  assert.equal(hid.body.title, 'Station Eleven');
  assert.deepEqual((await call('GET', '/api/explore/dislikes')).body.map((d) => d.title), ['Station Eleven']);
  let ex = await call('GET', '/api/explore');
  assert.ok(!ex.body.items.some((i) => i.title === 'Station Eleven'), 'hidden from Explore');
  assert.equal(ex.body.hidden, 1);
  assert.equal(ex.body.stats.disliked, 1);

  assert.equal((await call('DELETE', '/api/explore/dislikes/tv-4')).status, 204);
  ex = await call('GET', '/api/explore');
  assert.ok(ex.body.items.some((i) => i.title === 'Station Eleven'), 'back after undo');
  assert.equal(ex.body.stats.disliked, 0, 'undo takes the feedback back too');
  assert.equal((await call('DELETE', '/api/explore/dislikes/tv-4')).status, 404);

  // Hide it again, then add it from Explore: it leaves the hidden list and counts as a hit.
  await call('POST', '/api/explore/dislikes', { type: 'tv', tmdbId: 1 });
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.ok(saved.dislikes.some((d) => d.tmdbId === 1));
  assert.ok(saved.feedback.at(-1).parts, 'signals recorded with the feedback');
});

test('planned titles get where-to-watch info for your country', async () => {
  await call('DELETE', '/api/library/tmdb-movie-27205');
  const added = await call('POST', '/api/library', { type: 'movie', tmdbId: 27205 });
  assert.equal(added.body.label, 'planned');
  assert.equal(added.body.cache.providers.region, 'US');
  assert.deepEqual(added.body.cache.providers.rent.map((p) => p.name), ['Apple TV']);

  // Changing country: the next library load looks it up again for the new one.
  await call('PUT', '/api/settings', { region: 'CA' });
  process.env.TMDB_API_KEY = 'test';
  try {
    const { body } = await call('GET', '/api/library');
    const movie = body.items.find((i) => i.id === 'tmdb-movie-27205');
    assert.equal(movie.cache.providers.region, 'CA');
    assert.deepEqual(movie.cache.providers.stream, []);
    assert.ok(body.items.filter((i) => i.label !== 'planned').every((i) => !i.cache?.providers || i.cache.providers.region !== 'CA'), 'only planned titles are looked up');
  } finally {
    delete process.env.TMDB_API_KEY;
    await call('PUT', '/api/settings', { region: 'US' });
  }

  // Relabeling to Planned looks it up too.
  const watched = await call('PATCH', '/api/library/tmdb-tv-1396', { label: 'watched' });
  const replanned = await call('PATCH', '/api/library/tmdb-tv-1396', { label: 'planned' });
  assert.equal(watched.status, 200);
  assert.equal(replanned.body.cache.providers.region, 'US');
});

test('explore accepts the show tabs and ignores unknown types', async () => {
  const toons = await call('GET', '/api/explore?type=tv-animated');
  assert.equal(toons.status, 200);
  assert.ok(toons.body.items.every((i) => i.type === 'tv'));
  assert.equal((await call('GET', '/api/explore?type=toString')).status, 200, 'falls back to All instead of crashing');
});
