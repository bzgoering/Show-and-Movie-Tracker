// A stand-in for server/tmdb.js so tests run without a network connection or API key.

const CATALOG = {
  'movie-27205': {
    search: { tmdbId: 27205, type: 'movie', title: 'Inception', year: 2010, posterPath: '/inception.jpg', overview: 'A thief who steals secrets through dreams.' },
    details: {
      title: 'Inception', year: 2010, posterPath: '/inception.jpg', overview: 'A thief who steals secrets through dreams.',
      cache: { status: 'Released', releaseDate: '2010-07-15', originalLanguage: 'en', runtime: 148 },
    },
  },
  'tv-1396': {
    search: { tmdbId: 1396, type: 'tv', title: 'Breaking Bad', year: 2008, posterPath: '/bb.jpg', overview: 'A chemistry teacher turns to crime.' },
    details: {
      title: 'Breaking Bad', year: 2008, posterPath: '/bb.jpg', overview: 'A chemistry teacher turns to crime.',
      cache: {
        status: 'Ended', originalLanguage: 'en', inProduction: false, numberOfSeasons: 5, numberOfEpisodes: 62,
        lastAirDate: '2013-09-29', lastEpisode: { airDate: '2013-09-29', season: 5, episode: 16, name: 'Felina' }, nextEpisode: null,
        seasons: [
          { season: 1, name: 'Season 1', episodeCount: 7, airDate: '2008-01-20' },
          { season: 2, name: 'Season 2', episodeCount: 13, airDate: '2009-03-08' },
          { season: 3, name: 'Season 3', episodeCount: 13, airDate: '2010-03-21' },
          { season: 4, name: 'Season 4', episodeCount: 13, airDate: '2011-07-17' },
          { season: 5, name: 'Season 5', episodeCount: 16, airDate: '2012-07-15' },
        ],
      },
    },
  },
  'tv-100088': {
    search: { tmdbId: 100088, type: 'tv', title: 'The Last of Us', year: 2023, posterPath: '/tlou.jpg', overview: 'Survivors cross a ruined America.' },
    details: {
      title: 'The Last of Us', year: 2023, posterPath: '/tlou.jpg', overview: 'Survivors cross a ruined America.',
      cache: {
        status: 'Returning Series', originalLanguage: 'en', inProduction: true, numberOfSeasons: 2, numberOfEpisodes: 16,
        lastAirDate: '2025-05-25', lastEpisode: { airDate: '2025-05-25', season: 2, episode: 7, name: 'Convergence' }, nextEpisode: null,
        seasons: [
          { season: 1, name: 'Season 1', episodeCount: 9, airDate: '2023-01-15' },
          { season: 2, name: 'Season 2', episodeCount: 7, airDate: '2025-04-13' },
        ],
      },
    },
  },
};

export const calls = [];

export async function search(query) {
  calls.push(['search', query]);
  const q = query.toLowerCase();
  return Object.values(CATALOG).map((c) => c.search).filter((r) => r.title.toLowerCase().includes(q));
}

export async function getDetails(type, tmdbId) {
  calls.push(['details', type, tmdbId]);
  const entry = CATALOG[`${type}-${tmdbId}`];
  if (!entry) throw Object.assign(new Error('Title not found on TMDB.'), { status: 404 });
  const d = structuredClone(entry.details);
  d.cache.lastFetched = new Date().toISOString();
  return d;
}

// ---------- Explore ----------

const GENRES = {
  movie: new Map([[28, 'Action'], [18, 'Drama'], [35, 'Comedy'], [878, 'Science Fiction'], [80, 'Crime'], [27, 'Horror']]),
  tv: new Map([[10759, 'Action & Adventure'], [18, 'Drama'], [35, 'Comedy'], [10765, 'Sci-Fi & Fantasy'], [80, 'Crime'], [16, 'Animation']]),
};
const cand = (tmdbId, type, title, genreIds, voteAverage, extra = {}) => ({
  tmdbId, type, title, year: 2020, releaseDate: '2020-01-01', posterPath: `/c${tmdbId}.jpg`, overview: `${title} overview`,
  genreIds, originalLanguage: 'en', voteAverage, voteCount: 2000, popularity: 100, ...extra,
});
export const EXPLORE = {
  'tv-1396': [cand(1, 'tv', 'Better Call Saul', [18, 80], 8.9), cand(2, 'tv', 'Ozark', [18, 80], 8.2), cand(3, 'movie', 'El Camino', [80, 18], 7.0)],
  'tv-100088': [cand(4, 'tv', 'Station Eleven', [18, 10765], 7.9), cand(2, 'tv', 'Ozark', [18, 80], 8.2), cand(11, 'tv', 'Arcane', [16, 10765, 10759], 8.7)],
  'movie-27205': [cand(5, 'movie', 'Interstellar', [878, 18], 8.6), cand(6, 'movie', 'Tenet', [28, 878], 7.2)],
  discover: { movie: [cand(7, 'movie', 'Funny Movie', [35], 6.5), cand(5, 'movie', 'Interstellar', [878, 18], 8.6)], tv: [cand(8, 'tv', 'Sitcom', [35], 7.0), cand(9, 'tv', 'Scary Show', [27], 6.0, { posterPath: null }), cand(12, 'tv', 'Frieren', [16, 10759, 10765], 8.9, { originalLanguage: 'ja' })] },
  trending: [cand(10, 'movie', 'Trending Movie', [28], 7.5)],
};
const NETFLIX = { id: 8, name: 'Netflix', logoPath: '/netflix.jpg' };
const MAX = { id: 1899, name: 'Max', logoPath: '/max.jpg' };
const PROVIDERS = { 1: [NETFLIX], 2: [NETFLIX], 4: [MAX], 5: [MAX], 8: [NETFLIX, MAX] };

export async function genreMap(type) { return GENRES[type]; }
export async function recommendations(type, tmdbId) { calls.push(['recommendations', type, tmdbId]); return structuredClone(EXPLORE[`${type}-${tmdbId}`] || []); }
export async function discover(type, params) { calls.push(['discover', type, params]); return structuredClone(EXPLORE.discover[type]); }
export async function trending() { return structuredClone(EXPLORE.trending); }
export async function watchProviders(type, tmdbId, region) {
  if (region !== 'US') return { link: null, stream: [], rent: [], buy: [] };
  return { link: `https://www.themoviedb.org/${type}/${tmdbId}/watch`, stream: PROVIDERS[tmdbId] || [], rent: [{ id: 2, name: 'Apple TV', logoPath: null }], buy: [] };
}
export async function providerList() { return [NETFLIX, MAX, { id: 9, name: 'Prime Video', logoPath: null }]; }
export async function regions() { return [{ code: 'CA', name: 'Canada' }, { code: 'US', name: 'United States' }]; }
