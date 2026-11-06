import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { watchForCodeChanges } from './code-version.js';
import { createStore } from './store.js';
import { loadEnv } from './env.js';
import * as tmdb from './tmdb.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);
const port = Number(process.env.PORT) || 3000;
const libraryFile = path.join(root, 'data', 'library.json');

const store = createStore(libraryFile);
const result = await store.init();
console.log(result === 'created' ? `Created an empty library at ${libraryFile}` : `Using library at ${libraryFile}`);

const app = createApp({
  store,
  tmdb,
  publicDir: path.join(root, 'public'),
  syncOnStart: true,
  isOutdated: watchForCodeChanges(root),
});

const server = app.listen(port, () => {
  console.log(`Show & Movie Tracker running at http://localhost:${port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Is the app already running in another window?`);
    console.error('Close it first, or start this one on another port, e.g. PORT=3001 npm start');
  } else {
    console.error(err);
  }
  process.exit(1);
});
