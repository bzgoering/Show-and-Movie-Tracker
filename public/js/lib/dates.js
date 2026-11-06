// Formatting the release dates TMDB gives as "YYYY-MM-DD" (read as local dates, not UTC).

const DAY_MS = 24 * 60 * 60 * 1000;
const parse = (iso) => new Date(`${iso}T00:00:00`);
const isThisYear = (d) => d.getFullYear() === new Date().getFullYear();

// "Nov 13" (or "Nov 13, 2027" when it's not this year). monthOnly: "Nov 2027".
export function formatDate(iso, { monthOnly = false } = {}) {
  if (!iso) return '';
  const d = parse(iso);
  if (monthOnly) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(!isThisYear(d) && { year: 'numeric' }),
  });
}

export function daysUntil(iso) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parse(iso) - today) / DAY_MS);
}

// Short "when" for cards: Today, Tomorrow, a weekday within the next week, otherwise a date.
export function shortWhen(iso) {
  const days = daysUntil(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return parse(iso).toLocaleDateString(undefined, { weekday: 'short' });
  return formatDate(iso);
}

// Longer "when" for the details view: "Friday, Nov 13 · in 7 days".
export function longWhen(iso) {
  const d = parse(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(!isThisYear(d) && { year: 'numeric' }),
  });
  const days = daysUntil(iso);
  const relative = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 ? `in ${days} days` : '';
  return relative ? `${date} · ${relative}` : date;
}
