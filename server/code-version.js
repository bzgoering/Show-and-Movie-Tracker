// Notices when the app's server code changes on disk after it started (e.g. after `git pull`), so the
// page can say "restart the app" instead of quietly running the old code. The page itself is always
// read fresh, but Node keeps the server code it started with.
import fs from 'node:fs';
import path from 'node:path';

const newestChange = (dirs) =>
  Math.max(
    0,
    ...dirs.flatMap((dir) =>
      fs
        .readdirSync(dir, { recursive: true })
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.statSync(path.join(dir, file)).mtimeMs),
    ),
  );

// Returns a function that says whether any server code changed since this was called.
export function watchForCodeChanges(root, dirs = ['server', 'public/shared']) {
  const folders = dirs.map((d) => path.join(root, d));
  const startedWith = newestChange(folders);
  return () => {
    try {
      return newestChange(folders) > startedWith;
    } catch {
      return false; // a file was mid-update: check again next time
    }
  };
}
