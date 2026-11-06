// Loads TMDB_API_KEY (and PORT) from the .env file in the project folder.
// Looks next to package.json, so it works no matter which folder you start the app from.
import fs from 'node:fs';
import path from 'node:path';

const PLACEHOLDERS = new Set(['', 'your_key_here']);

export function loadEnv(root) {
  const envFile = path.join(root, '.env');

  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
  } else {
    // Common mix-ups, especially on Windows where file extensions are hidden.
    const lookalike = ['.env.txt', 'env', 'env.txt', '.env.example.txt'].find((f) => fs.existsSync(path.join(root, f)));
    if (lookalike) {
      console.warn(`Found "${lookalike}" but not ".env". Rename it to exactly ".env" (no extension).`);
    } else {
      console.warn(`No .env file found at ${envFile}`);
    }
  }

  const key = (process.env.TMDB_API_KEY || '').trim();
  if (PLACEHOLDERS.has(key)) {
    delete process.env.TMDB_API_KEY;
    console.warn('TMDB_API_KEY is not set, so search will not work.');
    console.warn(`  Put this line in ${envFile}:`);
    console.warn('  TMDB_API_KEY=your_token_from_themoviedb.org');
    return false;
  }
  console.log(`Loaded TMDB key from ${envFile} (ends in ...${key.slice(-4)})`);
  return true;
}
