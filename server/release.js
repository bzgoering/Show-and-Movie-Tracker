// Works out how a season is being released, from the air dates of its episodes.
//
//   weekly       - episodes come out one (or a few) at a time on different dates
//   all-at-once  - the whole season drops on the same day
//   parts        - the season drops in a few big chunks (e.g. "Volume 1" and "Volume 2")
//   unknown      - not enough dates to tell

export function detectPattern(episodes = []) {
  const dated = episodes.filter((e) => e.airDate).sort((a, b) => a.episode - b.episode);
  const last = episodes.length ? episodes.reduce((a, b) => (b.episode > a.episode ? b : a)) : null;
  const finale = last ? { episode: last.episode, airDate: last.airDate || null } : null;

  if (dated.length < 2) return { pattern: 'unknown', finale };

  const counts = new Map();
  for (const e of dated) counts.set(e.airDate, (counts.get(e.airDate) || 0) + 1);
  const biggest = Math.max(...counts.values());

  let pattern = 'weekly';
  if (biggest / dated.length >= 0.8) pattern = 'all-at-once';
  else if (counts.size <= 3 && dated.length >= 4 && biggest >= 3) pattern = 'parts';

  return { pattern, finale };
}
