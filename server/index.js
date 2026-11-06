import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createStore } from './store.js';
import * as tmdb from './tmdb.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3000;
const libraryFile = path.join(root, 'data', 'library.json');

const store = createStore(libraryFile);
const result = await store.init();
console.log(result === 'created' ? `Created an empty library at ${libraryFile}` : `Using library at ${libraryFile}`);

const app = createApp({ store, tmdb, publicDir: path.join(root, 'public') });

app.listen(port, () => {
  console.log(`Show & Movie Tracker running at http://localhost:${port}`);
  if (!process.env.TMDB_API_KEY) {
    console.warn('Warning: TMDB_API_KEY is not set, so search will not work. See .env.example.');
  }
});
