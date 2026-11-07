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

// "45m", "12h 30m", or "1,234h" for long totals.
export function formatDuration(minutes) {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (hours >= 100) return `${Math.round(total / 60).toLocaleString()}h`; // minutes stop mattering
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

// "about 3 days" for totals of a day or more, otherwise ''.
export function aboutDays(minutes) {
  const days = minutes / (60 * 24);
  if (days < 1) return '';
  const shown = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return `about ${shown.toLocaleString()} day${shown === 1 ? '' : 's'}`;
}
