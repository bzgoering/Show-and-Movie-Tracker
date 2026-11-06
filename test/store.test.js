import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.js';

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-'));
  return path.join(dir, 'data', 'library.json');
}

test('init creates an empty library when the file is missing', async () => {
  const file = await tempFile();
  const store = createStore(file);
  assert.equal(await store.init(), 'created');
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { items: [], dislikes: [], feedback: [] });
});

test('init keeps an existing library', async () => {
  const file = await tempFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ items: [{ id: 'x' }] }));
  const store = createStore(file);
  assert.equal(await store.init(), 'loaded');
  assert.deepEqual((await store.read()).items, [{ id: 'x' }]);
});

test('a corrupt file is backed up and replaced with an empty library', async () => {
  const file = await tempFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{ not json');
  const store = createStore(file);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await store.init();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(await store.read(), { items: [], dislikes: [], feedback: [] });
  const files = await fs.readdir(path.dirname(file));
  assert.ok(files.some((f) => f.startsWith('library.json.corrupt-')));
});

test('concurrent updates do not overwrite each other', async () => {
  const file = await tempFile();
  const store = createStore(file);
  await store.init();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update((d) => d.items.push({ id: i }))));
  assert.equal((await store.read()).items.length, 20);
});

test('retries when another program has the file locked (OneDrive, antivirus)', async () => {
  const file = await tempFile();
  let failures = 2;
  const flakyRename = async (from, to) => {
    if (failures-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return fs.rename(from, to);
  };
  const store = createStore(file, { rename: flakyRename });
  await store.init();
  await store.update((d) => d.items.push({ id: 'saved' }));
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).items, [{ id: 'saved' }]);
});

test('falls back to writing directly if the file stays locked', async () => {
  const file = await tempFile();
  const alwaysLocked = async () => {
    throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  };
  const store = createStore(file, { rename: alwaysLocked });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await store.init();
    await store.update((d) => d.items.push({ id: 'kept' }));
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).items, [{ id: 'kept' }]);
  const files = await fs.readdir(path.dirname(file));
  assert.ok(!files.includes('library.json.tmp'), 'temp file cleaned up');
});

test('older library files get the lists they are missing, and keep everything else', async () => {
  const file = await tempFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ items: [{ id: 'x' }], settings: { region: 'CA' } }));
  const data = await createStore(file).read();
  assert.deepEqual(data, { items: [{ id: 'x' }], settings: { region: 'CA' }, dislikes: [], feedback: [] });
});
