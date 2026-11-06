// Facts about titles shared by the browser and the server, so both sides agree on them.

// Labels a title can have. Movies are either still to watch or watched; shows can be in progress.
export const LABELS_FOR = {
  movie: ['planned', 'watched'],
  tv: ['planned', 'watching', 'watched'],
};

export const isMediaType = (type) => Object.hasOwn(LABELS_FOR, type);

// TMDB statuses that mean a show is over.
export const ENDED_STATUSES = ['Ended', 'Canceled'];
export const isEndedStatus = (status) => ENDED_STATUSES.includes(status);

// The Explore tabs. Shows are split by TMDB's Animation genre.
export const EXPLORE_TABS = ['all', 'movie', 'tv-live', 'tv-animated'];

// A library item's id, e.g. "tmdb-tv-1396".
export const libraryId = (type, tmdbId) => `tmdb-${type}-${tmdbId}`;

// A title's key in Explore and in the hidden list, e.g. "tv-1396".
export const mediaKey = (type, tmdbId) => `${type}-${tmdbId}`;
