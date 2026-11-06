// Reads and writes the library as a single local JSON file.
import fs from 'node:fs/promises';
import path from 'node:path';

export function createStore(filePath) {
  let queue = Promise.resolve();

  async function read() {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { items: [] };
      throw err;
    }
    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) throw new Error('missing "items" array');
      return data;
    } catch (err) {
      // Keep the broken file so nothing is lost, then start with an empty library.
      const backup = `${filePath}.corrupt-${Date.now()}`;
      await fs.rename(filePath, backup);
      console.warn(`[store] ${filePath} was not valid (${err.message}). Moved it to ${backup}.`);
      return { items: [] };
    }
  }

  async function write(data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
    await fs.rename(tmp, filePath); // atomic swap, so a crash never leaves a half-written file
  }

  // Run read-modify-write changes one at a time so two requests can't overwrite each other.
  function update(fn) {
    const run = queue.then(async () => {
      const data = await read();
      const result = await fn(data);
      await write(data);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  // Use the existing library file if there is one, otherwise create an empty one.
  async function init() {
    try {
      await fs.access(filePath);
    } catch {
      await write({ items: [] });
      return 'created';
    }
    await write(await read()); // also repairs a corrupt file
    return 'loaded';
  }

  return { init, read: () => queue.then(read), update };
}
