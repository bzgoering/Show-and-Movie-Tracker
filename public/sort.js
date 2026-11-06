// Sorting for the library grid. Pure functions, so they run in the browser and in `npm test`.
import { statusOf } from './progress.js';

const PROGRESS_ORDER = { watching: 0, waiting: 1, planned: 2, watched: 3 };

const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true });

// Movies: release date. Shows: first air date (or January 1st of the first year as a fallback).
export function releaseDate(item) {
  const c = item.cache || {};
  return (item.type === 'movie' ? c.releaseDate : c.firstAirDate) || (item.year ? `${item.year}-01-01` : null);
}

export const mainGenre = (item) => item.cache?.genres?.[0] || null;

// Puts items missing the value at the end, then falls back to A-Z.
function by(value, compare) {
  return (a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return byTitle(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    return compare(va, vb) || byTitle(a, b);
  };
}

export const SORTS = {
  title: byTitle,
  progress: by((i) => PROGRESS_ORDER[statusOf(i)], (a, b) => a - b),
  release: by(releaseDate, (a, b) => b.localeCompare(a)), // newest first
  genre: by(mainGenre, (a, b) => a.localeCompare(b)),
};

export function sortItems(items, sort = 'title') {
  return [...items].sort(SORTS[sort] || SORTS.title);
}
