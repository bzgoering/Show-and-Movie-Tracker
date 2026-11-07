// Facts about titles shared by the browser and the server, so both sides agree on them.

// Labels a title can have. Movies are either still to watch or watched; shows can be in progress.
export const LABELS_FOR = {
  movie: ['planned', 'watched'],
  tv: ['planned', 'watching', 'watched'],
};

export const isMediaType = (type) => Object.hasOwn(LABELS_FOR, type);

// TMDB statuses that mean a show is over.
const ENDED_STATUSES = ['Ended', 'Canceled'];
export const isEndedStatus = (status) => ENDED_STATUSES.includes(status);

// The Explore tabs. Movies and shows can be split by TMDB's Animation genre (anime and cartoons).
export const EXPLORE_TABS = ['all', 'movie', 'movie-live', 'movie-animated', 'tv', 'tv-live', 'tv-animated'];

// Your rating of a title: 1 = Meh, 2 = Good, 3 = Great. Everything in your library is something you
// liked, so Meh isn't a dislike, just "not as much as the others".
export const RATINGS = [1, 2, 3];
export const isRating = (value) => RATINGS.includes(value);

// Titles in Planned haven't been seen yet, so they can't be rated. A rating given earlier is kept
// (in case the title was moved to Planned by mistake) but hidden and ignored until it leaves Planned.
export const canRate = (item) => item.label !== 'planned';
export const ratingOf = (item) => (canRate(item) ? item.rating : undefined);

// A library item's id, e.g. "tmdb-tv-1396".
export const libraryId = (type, tmdbId) => `tmdb-${type}-${tmdbId}`;

// A title's key in Explore and in the hidden list, e.g. "tv-1396".
export const mediaKey = (type, tmdbId) => `${type}-${tmdbId}`;
