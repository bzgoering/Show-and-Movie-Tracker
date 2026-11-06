// Small client for The Movie Database (TMDB) API.
// The key stays on the server; the browser only ever talks to our own /api routes.

import { detectPattern } from './release.js';

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
        genres: (m.genres || []).map((g) => g.name), // for the genre picker and Explore (never shown on cards)
        originalLanguage: m.original_language || null, // e.g. "ja"; Explore uses it to learn what you watch
        runtime: m.runtime || null,
        lastFetched: new Date().toISOString(),
      },
    };
  }

  if (type === 'tv') {
    const t = await request(`/tv/${tmdbId}`);
    const release = await getReleaseInfo(tmdbId, t);
    return {
      title: t.name,
      year: yearOf(t.first_air_date),
      posterPath: t.poster_path || null,
      overview: t.overview || '',
      cache: {
        status: t.status || '',
        firstAirDate: t.first_air_date || null,
        genres: (t.genres || []).map((g) => g.name), // for the genre picker and Explore (never shown on cards)
        originalLanguage: t.original_language || null, // e.g. "ja"; Explore uses it to learn what you watch
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
        release,
        lastFetched: new Date().toISOString(),
      },
    };
  }

  throw new TmdbError(`Unknown type "${type}".`, 400);
}

async function getSeasonEpisodes(tmdbId, season) {
  const data = await request(`/tv/${tmdbId}/season/${season}`);
  return (data.episodes || []).map((e) => ({ episode: e.episode_number, airDate: e.air_date || null }));
}

// Looks at the upcoming (or most recent) season to see whether the show releases weekly
// or drops whole seasons at once. If that season has no dates yet, the season before it
// is used as a guide. Failures here never block adding a show.
async function getReleaseInfo(tmdbId, t) {
  const season =
    t.next_episode_to_air?.season_number ||
    t.last_episode_to_air?.season_number ||
    Math.max(0, ...(t.seasons || []).map((s) => s.season_number));
  if (!season) return null;

  try {
    const episodes = await getSeasonEpisodes(tmdbId, season);
    const info = { season, episodesInSeason: episodes.length, ...detectPattern(episodes), basedOnSeason: season };
    if (info.pattern === 'unknown' && season > 1) {
      info.pattern = detectPattern(await getSeasonEpisodes(tmdbId, season - 1)).pattern;
      info.basedOnSeason = season - 1;
    }
    return info;
  } catch {
    return null;
  }
}

// ---------- Explore: recommendations, discovery and where-to-watch ----------

function toCandidate(r, fallbackType) {
  const type = r.media_type === 'movie' || r.media_type === 'tv' ? r.media_type : fallbackType;
  const date = (type === 'movie' ? r.release_date : r.first_air_date) || null;
  return {
    tmdbId: r.id,
    type,
    title: type === 'movie' ? r.title : r.name,
    year: yearOf(date),
    releaseDate: date,
    posterPath: r.poster_path || null,
    overview: r.overview || '',
    genreIds: r.genre_ids || [],
    originalLanguage: r.original_language || null,
    voteAverage: r.vote_average || 0,
    voteCount: r.vote_count || 0,
    popularity: r.popularity || 0,
  };
}

const genreMaps = {};

// Genre id -> name, e.g. 18 -> "Drama". Fetched once per type.
export async function genreMap(type) {
  if (!genreMaps[type]) {
    const data = await request(`/genre/${type}/list`);
    genreMaps[type] = new Map((data.genres || []).map((g) => [g.id, g.name]));
  }
  return genreMaps[type];
}

// "If you liked this, try..." list TMDB keeps for every title.
export async function recommendations(type, tmdbId) {
  const data = await request(`/${type}/${tmdbId}/recommendations`, { page: 1 });
  return (data.results || []).filter((r) => r.media_type !== 'person').map((r) => toCandidate(r, type));
}

// Popular titles matching filters, e.g. { with_genres: '18|80', with_watch_providers: '8|9', watch_region: 'US' }.
export async function discover(type, params = {}) {
  const data = await request(`/discover/${type}`, {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    'vote_count.gte': 50,
    page: 1,
    ...params,
  });
  return (data.results || []).map((r) => toCandidate(r, type));
}

export async function trending() {
  const data = await request('/trending/all/week');
  return (data.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').map((r) => toCandidate(r));
}

const toProvider = (p) => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path || null });

// Where a title can be watched in one country (data from JustWatch, via TMDB).
// stream = included with a subscription, free, or free with ads.
export async function watchProviders(type, tmdbId, region) {
  const data = await request(`/${type}/${tmdbId}/watch/providers`);
  const r = data.results?.[region];
  if (!r) return { link: null, stream: [], rent: [], buy: [] };
  const seen = new Set();
  const stream = [...(r.flatrate || []), ...(r.free || []), ...(r.ads || [])]
    .map(toProvider)
    .filter((p) => !seen.has(p.id) && seen.add(p.id));
  return { link: r.link || null, stream, rent: (r.rent || []).map(toProvider), buy: (r.buy || []).map(toProvider) };
}

// Every streaming service available in a country, most popular first.
export async function providerList(region) {
  const lists = await Promise.all(['movie', 'tv'].map((type) => request(`/watch/providers/${type}`, { watch_region: region })));
  const byId = new Map();
  for (const p of lists.flatMap((l) => l.results || [])) {
    const priority = p.display_priorities?.[region] ?? p.display_priority ?? 999;
    const existing = byId.get(p.provider_id);
    if (!existing || priority < existing.priority) byId.set(p.provider_id, { ...toProvider(p), priority });
  }
  return [...byId.values()].sort((a, b) => a.priority - b.priority).map(({ priority, ...p }) => p);
}

export async function regions() {
  const data = await request('/watch/providers/regions');
  return (data.results || [])
    .map((r) => ({ code: r.iso_3166_1, name: r.english_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
