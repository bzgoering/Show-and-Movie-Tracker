// Small client for The Movie Database (TMDB) API.
// The key stays on the server; the browser only ever talks to our own /api routes.

const BASE_URL = 'https://api.themoviedb.org/3';

export class TmdbError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

function getKey() {
  // Tolerate quotes or a pasted "Bearer " prefix around the key.
  const key = (process.env.TMDB_API_KEY || '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '');
  if (!key) {
    throw new TmdbError('TMDB_API_KEY is not set. Copy .env.example to .env and add your key.', 500);
  }
  return key;
}

async function request(path, params = {}) {
  const key = getKey();
  const url = new URL(BASE_URL + path);
  const headers = { Accept: 'application/json' };

  // v4 "Read Access Tokens" are long JWTs sent as a Bearer header; v3 keys go in the query string.
  if (key.length > 40) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(name, value);
  }

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new TmdbError(`Could not reach TMDB: ${err.message}`);
  }

  if (res.status === 401) throw new TmdbError('TMDB rejected the API key. Check TMDB_API_KEY in .env.', 500);
  if (res.status === 404) throw new TmdbError('Title not found on TMDB.', 404);
  if (!res.ok) throw new TmdbError(`TMDB request failed (${res.status}).`);
  return res.json();
}

const yearOf = (date) => (date ? Number(date.slice(0, 4)) || null : null);

export async function search(query) {
  const data = await request('/search/multi', { query, include_adult: 'false', page: 1 });
  return (data.results || [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => ({
      tmdbId: r.id,
      type: r.media_type,
      title: r.media_type === 'movie' ? r.title : r.name,
      year: yearOf(r.media_type === 'movie' ? r.release_date : r.first_air_date),
      posterPath: r.poster_path || null,
      overview: r.overview || '',
    }));
}

function episodeInfo(ep) {
  if (!ep) return null;
  return {
    airDate: ep.air_date || null,
    season: ep.season_number,
    episode: ep.episode_number,
    name: ep.name || '',
  };
}

// Returns the base fields plus the "cache" block stored on each library item.
export async function getDetails(type, tmdbId) {
  if (type === 'movie') {
    const m = await request(`/movie/${tmdbId}`);
    return {
      title: m.title,
      year: yearOf(m.release_date),
      posterPath: m.poster_path || null,
      overview: m.overview || '',
      cache: {
        status: m.status || '',
        releaseDate: m.release_date || null,
        runtime: m.runtime || null,
        lastFetched: new Date().toISOString(),
      },
    };
  }

  if (type === 'tv') {
    const t = await request(`/tv/${tmdbId}`);
    return {
      title: t.name,
      year: yearOf(t.first_air_date),
      posterPath: t.poster_path || null,
      overview: t.overview || '',
      cache: {
        status: t.status || '',
        inProduction: Boolean(t.in_production),
        numberOfSeasons: t.number_of_seasons || 0,
        numberOfEpisodes: t.number_of_episodes || 0,
        lastAirDate: t.last_air_date || null,
        lastEpisode: episodeInfo(t.last_episode_to_air),
        nextEpisode: episodeInfo(t.next_episode_to_air),
        // Season 0 is "Specials" on TMDB; leave it out of progress tracking.
        seasons: (t.seasons || [])
          .filter((s) => s.season_number > 0)
          .map((s) => ({
            season: s.season_number,
            name: s.name || `Season ${s.season_number}`,
            episodeCount: s.episode_count || 0,
            airDate: s.air_date || null,
          })),
        lastFetched: new Date().toISOString(),
      },
    };
  }

  throw new TmdbError(`Unknown type "${type}".`, 400);
}
