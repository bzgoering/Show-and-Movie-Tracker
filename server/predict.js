// Works out when the next episode or season of a show is likely to come out.
// Returns plain data; the page decides how to word it.
//
// Result kinds:
//   confirmed - TMDB has a scheduled next episode (scope: episode, season or part)
//   ended     - the show is over (endedBy: 'user' or 'tmdb'; status is TMDB's, e.g. "Canceled")
//   estimated - guessed from the average gap between past season premieres (gapMonths)
//   unknown   - not enough information to guess
import { isEndedStatus } from '../public/shared/media.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (s) => (s ? new Date(`${s}T00:00:00Z`) : null);
const toIso = (d) => d.toISOString().slice(0, 10);

export function predictNextRelease(cache = {}, { userMarkedEnded = false, today = new Date() } = {}) {
  const release = cache.release || {};
  const next = cache.nextEpisode;

  if (next && next.airDate) {
    const sameSeason = release.season === next.season;
    const pattern = sameSeason || next.episode === 1 ? release.pattern || 'unknown' : 'unknown';
    const premiere = next.episode === 1;
    const seasonInfo = (cache.seasons || []).find((s) => s.season === next.season);
    const episodeCount = (sameSeason && release.episodesInSeason) || seasonInfo?.episodeCount || null;

    let scope = premiere ? 'season' : 'episode';
    if (pattern === 'parts' && !premiere) scope = 'part';

    return {
      kind: 'confirmed',
      scope,
      pattern,
      date: next.airDate,
      season: next.season,
      episode: next.episode,
      episodeName: next.name || '',
      episodeCount,
      // Only useful for weekly shows: when the current run of episodes wraps up.
      finale:
        pattern === 'weekly' && sameSeason && release.finale?.airDate && release.finale.episode > next.episode
          ? release.finale
          : null,
    };
  }

  if (userMarkedEnded) return { kind: 'ended', endedBy: 'user', status: cache.status ?? null };
  if (isEndedStatus(cache.status)) return { kind: 'ended', endedBy: 'tmdb', status: cache.status };

  const premieres = (cache.seasons || [])
    .map((s) => ({ season: s.season, date: toDate(s.airDate) }))
    .filter((s) => s.date && !Number.isNaN(s.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (premieres.length < 2) return { kind: 'unknown', pattern: release.pattern || 'unknown' };

  // Average the gaps between consecutive premieres; the most recent gaps say the most about the future.
  const gaps = [];
  for (let i = 1; i < premieres.length; i++) gaps.push(premieres[i].date - premieres[i - 1].date);
  const recent = gaps.slice(-3);
  const avgGap = recent.reduce((a, b) => a + b, 0) / recent.length;

  const last = premieres[premieres.length - 1];
  const estimate = new Date(last.date.getTime() + avgGap);
  return {
    kind: 'estimated',
    pattern: release.pattern || 'unknown',
    date: toIso(estimate),
    season: last.season + 1,
    overdue: estimate < today,
    gapMonths: Math.round(avgGap / (30.44 * DAY_MS)), // how far apart past seasons premiered
  };
}

// True when a show that was over (TMDB said Ended/Canceled, or the user marked it ended)
// has come back: TMDB lists it as ongoing again, or a new episode has been scheduled.
export function isRevived(oldCache = {}, newCache = {}, userMarkedEnded = false) {
  const tmdbWasEnded = isEndedStatus(oldCache.status);
  if (!tmdbWasEnded && !userMarkedEnded) return false;
  if (newCache.nextEpisode?.airDate) return true;
  return tmdbWasEnded && Boolean(newCache.status) && !isEndedStatus(newCache.status);
}
