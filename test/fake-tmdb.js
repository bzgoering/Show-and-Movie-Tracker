// A stand-in for server/tmdb.js so tests run without a network connection or API key.

const CATALOG = {
  'movie-27205': {
    search: { tmdbId: 27205, type: 'movie', title: 'Inception', year: 2010, posterPath: '/inception.jpg', overview: 'A thief who steals secrets through dreams.' },
    details: {
      title: 'Inception', year: 2010, posterPath: '/inception.jpg', overview: 'A thief who steals secrets through dreams.',
      cache: { status: 'Released', releaseDate: '2010-07-15', runtime: 148 },
    },
  },
  'tv-1396': {
    search: { tmdbId: 1396, type: 'tv', title: 'Breaking Bad', year: 2008, posterPath: '/bb.jpg', overview: 'A chemistry teacher turns to crime.' },
    details: {
      title: 'Breaking Bad', year: 2008, posterPath: '/bb.jpg', overview: 'A chemistry teacher turns to crime.',
      cache: {
        status: 'Ended', inProduction: false, numberOfSeasons: 5, numberOfEpisodes: 62,
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
        status: 'Returning Series', inProduction: true, numberOfSeasons: 2, numberOfEpisodes: 16,
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
