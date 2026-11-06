// Works out when the next episode or season of a show is likely to come out.
//
// Result kinds:
//   confirmed - TMDB has a scheduled next episode (scope: episode, season or part)
//   ended     - the user or TMDB says the show is over
//   estimated - guessed from the average gap between past season premieres
//   unknown   - not enough information to guess

const DAY_MS = 24 * 60 * 60 * 1000;
export const ENDED_STATUSES = new Set(['Ended', 'Canceled']);

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
    let heading = premiere ? 'Next season' : 'Next episode';
    let label = premiere
      ? `Season ${next.season} premieres ${next.airDate}`
      : `S${next.season} E${next.episode} airs ${next.airDate}`;
    if (pattern === 'all-at-once' && premiere) {
      label = `Season ${next.season}: all ${episodeCount ? `${episodeCount} ` : ''}episodes release ${next.airDate}`;
    } else if (pattern === 'parts' && !premiere) {
      scope = 'part';
      heading = 'Next part';
      label = `S${next.season} from E${next.episode} releases ${next.airDate}`;
    }

    return {
      kind: 'confirmed',
      scope,
      heading,
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
      label,
    };
  }

  if (userMarkedEnded) return { kind: 'ended', heading: 'Series ended', label: 'Series ended (marked by you)' };
  if (ENDED_STATUSES.has(cache.status))
    return { kind: 'ended', heading: 'Series ended', label: `Series ${cache.status.toLowerCase()}` };

  const premieres = (cache.seasons || [])
    .map((s) => ({ season: s.season, date: toDate(s.airDate) }))
    .filter((s) => s.date && !Number.isNaN(s.date.getTime()))
    .sort((a, b) => a.date - b.date);

  if (premieres.length < 2) {
    return {
      kind: 'unknown',
      heading: 'Next season',
      pattern: release.pattern || 'unknown',
      label: 'No release date announced',
    };
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
    heading: 'Next season',
    pattern: release.pattern || 'unknown',
    date: toIso(estimate),
    season: nextSeason,
    overdue,
    label: overdue
      ? `Season ${nextSeason} is overdue (expected around ${toIso(estimate)})`
      : `Season ${nextSeason} expected around ${toIso(estimate)}`,
    basis: `Seasons have premiered about every ${months} month${months === 1 ? '' : 's'}`,
  };
}

// True when a show that was over (TMDB said Ended/Canceled, or the user marked it ended)
// has come back: TMDB lists it as ongoing again, or a new episode has been scheduled.
export function isRevived(oldCache = {}, newCache = {}, userMarkedEnded = false) {
  const tmdbWasEnded = ENDED_STATUSES.has(oldCache.status);
  if (!tmdbWasEnded && !userMarkedEnded) return false;
  if (newCache.nextEpisode?.airDate) return true;
  return tmdbWasEnded && Boolean(newCache.status) && !ENDED_STATUSES.has(newCache.status);
}
