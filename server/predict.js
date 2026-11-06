// Works out when the next episode or season of a show is likely to come out.
//
// Result kinds:
//   confirmed - TMDB has a scheduled next episode
//   ended     - the user or TMDB says the show is over
//   estimated - guessed from the average gap between past season premieres
//   unknown   - not enough information to guess

const DAY_MS = 24 * 60 * 60 * 1000;
const ENDED_STATUSES = new Set(['Ended', 'Canceled']);

const toDate = (s) => (s ? new Date(`${s}T00:00:00Z`) : null);
const toIso = (d) => d.toISOString().slice(0, 10);

export function predictNextRelease(cache = {}, { userMarkedEnded = false, today = new Date() } = {}) {
  const next = cache.nextEpisode;
  if (next && next.airDate) {
    return {
      kind: 'confirmed',
      date: next.airDate,
      season: next.season,
      episode: next.episode,
      label: `S${next.season} E${next.episode} airs ${next.airDate}`,
    };
  }

  if (userMarkedEnded) return { kind: 'ended', label: 'Series ended (marked by you)' };
  if (ENDED_STATUSES.has(cache.status)) return { kind: 'ended', label: `Series ${cache.status.toLowerCase()}` };

  const premieres = (cache.seasons || [])
    .map((s) => ({ season: s.season, date: toDate(s.airDate) }))
    .filter((s) => s.date && !Number.isNaN(s.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (premieres.length < 2) {
    return { kind: 'unknown', label: 'No release date announced' };
  }

  // Average the gaps between consecutive premieres; the most recent gaps say the most about the future.
  const gaps = [];
  for (let i = 1; i < premieres.length; i++) gaps.push(premieres[i].date - premieres[i - 1].date);
  const recent = gaps.slice(-3);
  const avgGap = recent.reduce((a, b) => a + b, 0) / recent.length;

  const last = premieres[premieres.length - 1];
  const estimate = new Date(last.date.getTime() + avgGap);
  const nextSeason = last.season + 1;
  const overdue = estimate < today;
  const months = Math.round(avgGap / (30.44 * DAY_MS));

  return {
    kind: 'estimated',
    date: toIso(estimate),
    season: nextSeason,
    overdue,
    label: overdue
      ? `Season ${nextSeason} is overdue (expected around ${toIso(estimate)})`
      : `Season ${nextSeason} expected around ${toIso(estimate)}`,
    basis: `Seasons have premiered about every ${months} month${months === 1 ? '' : 's'}`,
  };
}
