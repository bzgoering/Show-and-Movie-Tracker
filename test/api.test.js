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
