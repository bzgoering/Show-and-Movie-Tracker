// Reads and writes the library as a single local JSON file.
import fs from 'node:fs/promises';
import path from 'node:path';

// Errors Windows gives when another program (OneDrive, antivirus) has the file open.
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function createStore(filePath, { rename = fs.rename } = {}) {
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
    const json = JSON.stringify(data, null, 2) + '\n';
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, json);

    // Swap the new file in, so a crash never leaves a half-written library.
    // On Windows, OneDrive/Dropbox or antivirus can briefly lock the file, so retry a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, filePath);
        return;
      } catch (err) {
        if (!LOCKED.has(err.code)) throw err;
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          continue;
        }
        // Still locked: write straight into the file instead, so the change isn't lost.
        console.warn(`[store] ${filePath} stayed locked (${err.code}); writing it directly.`);
        await fs.writeFile(filePath, json);
        await fs.rm(tmp, { force: true });
        return;
      }
    }
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
