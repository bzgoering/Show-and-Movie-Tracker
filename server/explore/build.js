// Explore: suggests movies and shows you're likely to enjoy, based on your library.
//
// 1. Read your library: how much each title says about your taste (a show you finished or are caught up
//    on says a lot, one you stopped early on says little), plus the genres and languages you watch and
//    whether you lean to movies or shows.
// 2. Gather candidates: TMDB's "recommended because you liked X" lists for the titles that say most about
//    you, plus popular titles in your favourite genres (on your streaming services, if you picked any).
// 3. Score each candidate by how strongly your library points at it, trimmed for poor ratings and for
//    kinds of title you rarely watch. The match % is that score, so it means the same thing on every tab.
// 4. Look up where the best ones stream, and return them best match first.

import { mediaKey } from '../../public/shared/media.js';
import { mapLimit } from '../http.js';
import {
  calibrationShift,
  DEFAULT_WEIGHTS,
  dislikeProfile,
  learnWeights,
  matchFor,
  reasonFor,
  scoreCandidate,
  scoreParts,
} from './score.js';
import { isAnimatedItem, normalizeGenres, tasteProfile } from './taste.js';

// TMDB answers are cached for a while. The promise itself is cached, so requests that arrive together
// share one fetch; failures are dropped so they're retried; expired entries are swept as the cache grows.
const cache = new Map();
const MAX_CACHE = 2000;
const HOURS = 60 * 60 * 1000;

function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  value.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHE) {
    for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k);
  }
  return value;
}

const keyOf = (c) => mediaKey(c.type, c.tmdbId);

// TMDB genre ids for your favourite genres, in order of preference, for TMDB's discover search.
async function genreIdsFor(tmdb, type, wanted) {
  const map = await tmdb.genreMap(type);
  const ids = [];
  for (const g of wanted) {
    for (const [id, name] of map) if (normalizeGenres([name]).includes(g) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// A mix from one group of titles, for seeds. What you're watching now says most about your current
// taste (newest first), what you've finished says a lot, and a planned title adds what you're curious
// about. Leftover slots go to whatever you like most.
function pickMix(list, max, liking) {
  if (max <= 0) return [];
  const recency = (i) => i.updatedAt || i.addedAt || '';
  const newest = (l) => [...l].sort((a, b) => recency(b).localeCompare(recency(a)));
  const strongest = (l) => [...l].sort((a, b) => liking(b) - liking(a) || recency(b).localeCompare(recency(a)));
  const planned = strongest(list.filter((i) => i.label === 'planned')).slice(0, Math.max(1, Math.round(max / 4)));
  const current = newest(list.filter((i) => i.label === 'watching')).slice(0, Math.ceil((max - planned.length) / 2));
  const finished = newest(list.filter((i) => i.label === 'watched')).slice(0, max - planned.length - current.length);
  const picked = [...current, ...finished, ...planned];
  return [...picked, ...strongest(list.filter((i) => !picked.includes(i)))].slice(0, max);
}

// Shares `total` slots between two groups by how much of each you watch, with at least `min` each
// (or all a group has). Slots one group can't use go to the other.
function shareSlots(total, a, b, shareOfA, min) {
  const wantA = Math.min(a.length, Math.max(Math.min(min, a.length), Math.round(total * shareOfA)));
  const slotsB = Math.min(b.length, Math.max(total - wantA, Math.min(min, b.length)));
  return [Math.min(a.length, total - slotsB), slotsB];
}

// Which library titles to ask TMDB for "if you liked this" lists (one request each, cached for a day).
// Up to 10, shared between shows and movies (TMDB recommends shows for a show and movies for a movie),
// at least 4 each when you have them. Shows are shared the same way between live action and animation,
// at least 3 each, so both show tabs get their own "because you watched" suggestions.
// Shows you seem to have dropped are left out.
export function pickSeeds(items, { liking = new Map(), max = 10 } = {}) {
  const like = (i) => liking.get(i) ?? 0.5;
  const usable = items.filter((i) => !(i.type === 'tv' && i.label === 'watching' && like(i) < 0.25));
  const shareOf = (part, whole) =>
    part.reduce((s, i) => s + like(i), 0) / (whole.reduce((s, i) => s + like(i), 0) || 1);
  const shows = usable.filter((i) => i.type === 'tv');
  const movies = usable.filter((i) => i.type === 'movie');
  const [showSlots, movieSlots] = shareSlots(max, shows, movies, shareOf(shows, usable), 4);
  const live = shows.filter((i) => !isAnimatedItem(i));
  const animated = shows.filter(isAnimatedItem);
  const [liveSlots, animSlots] = shareSlots(showSlots, live, animated, shareOf(live, shows), 3);
  return [
    ...pickMix(live, liveSlots, like),
    ...pickMix(animated, animSlots, like),
    ...pickMix(movies, movieSlots, like),
  ];
}

// TMDB's "Animation" genre (same id for movies and TV) covers both anime and Western cartoons.
const ANIMATION = 16;
export const isAnimated = (c) => (c.genreIds || []).includes(ANIMATION);

// The Explore tabs. Movies and shows can each be split into live action and anime & cartoons.
export const EXPLORE_TYPES = {
  all: { types: ['movie', 'tv'] },
  movie: { types: ['movie'] },
  'movie-live': { types: ['movie'], animated: false },
  'movie-animated': { types: ['movie'], animated: true },
  tv: { types: ['tv'] },
  'tv-live': { types: ['tv'], animated: false },
  'tv-animated': { types: ['tv'], animated: true },
};

// Which Explore tabs you have. A tab only appears once your library has that kind of title:
//   Movies              if you have movies
//   Shows               if your shows are all live action, or all animated
//   Live-action shows + Anime & cartoons   once you have both kinds of show
//   All                 when there's more than one of the above
// Movies also get "movie-live" and "movie-animated" (the kind-of-movie picker) once you have both kinds.
export function exploreTabs(items) {
  const movies = items.filter((i) => i.type === 'movie');
  const shows = items.filter((i) => i.type === 'tv');
  const both = (list) => {
    const animated = list.filter(isAnimatedItem).length;
    return animated > 0 && animated < list.length;
  };
  const top = [];
  if (movies.length) top.push('movie');
  if (shows.length) top.push(...(both(shows) ? ['tv-live', 'tv-animated'] : ['tv']));
  const tabs = top.length > 1 ? ['all', ...top] : top;
  if (both(movies)) tabs.push('movie-live', 'movie-animated');
  return tabs;
}

// The tab to show: the one asked for if you have it, otherwise the closest one you do have
// (e.g. an old link to Anime & cartoons opens Shows when your shows are all one kind).
export function resolveTab(requested = '', tabs) {
  if (tabs.includes(requested)) return requested;
  if (requested.startsWith('movie') && tabs.includes('movie')) return 'movie';
  if (requested.startsWith('tv')) return tabs.find((t) => t === 'tv' || t === 'tv-live') ?? tabs[0];
  return tabs[0];
}

// The genres Explore can filter by: the ones in your library, A-Z (movie and show genre names aligned,
// so "Sci-Fi & Fantasy" counts as Science Fiction and Fantasy). On a live-action or anime tab,
// Animation is left out: it would match nothing or everything there.
export function genreOptions(items, type = 'all') {
  const { animated } = EXPLORE_TYPES[type] ?? EXPLORE_TYPES.all;
  const names = new Set(items.flatMap((item) => normalizeGenres(item.cache?.genres)));
  if (animated !== undefined) names.delete('Animation');
  return [...names].sort((a, b) => a.localeCompare(b));
}

// An extra discover search when you filter by a genre, so the list stays full: popular titles in
// that genre (animated or not, to match the tab).
async function genreQuery(tmdb, type, genre, animated) {
  const ids = (await genreIdsFor(tmdb, type, [genre])).filter((id) => id !== ANIMATION || genre === 'Animation');
  if (!ids.length) return null; // e.g. "Thriller" is a movie genre only
  if (animated === true) return { with_genres: ids.map((id) => `${ANIMATION},${id}`).join('|') };
  return { with_genres: ids.join('|'), ...(animated === false && { without_genres: String(ANIMATION) }) };
}

// The discover searches for one type on one tab: popular titles in any of your top 3 genres, and
// popular titles in both of your top 2 (more specific). Anime & cartoons searches animated titles,
// in your top genre and your usual language for animation; live action leaves animation out.
async function discoverQueries(tmdb, type, profile, animated) {
  const top = profile.topGenresByType[type].filter((g) => animated === undefined || g !== 'Animation').slice(0, 3);
  const ids = top.length
    ? (await genreIdsFor(tmdb, type, top)).filter((id) => animated === undefined || id !== ANIMATION)
    : [];
  if (animated === true) {
    const specific = { with_genres: ids.length ? `${ANIMATION},${ids[0]}` : String(ANIMATION) };
    if (profile.animatedLanguage) specific.with_original_language = profile.animatedLanguage;
    return specific.with_genres === String(ANIMATION) && !specific.with_original_language
      ? [specific]
      : [{ with_genres: String(ANIMATION) }, specific];
  }
  const queries = [ids.length ? { with_genres: ids.join('|') } : {}];
  if (ids.length >= 2) queries.push({ with_genres: `${ids[0]},${ids[1]}` });
  return animated === false ? queries.map((q) => ({ ...q, without_genres: String(ANIMATION) })) : queries;
}

// Recently scored suggestions, so feedback (add / not interested) can record what the score was based on.
const recent = new Map();
export const recentSuggestion = (key) => recent.get(key) || null;

export async function buildExplore({
  tmdb,
  items,
  region = 'US',
  services = [],
  type = 'all',
  limit = 40,
  dislikes = [],
  feedback = [],
  genre = '', // only show suggestions in this genre (one of genreOptions)
  today = new Date(),
}) {
  if (!items.length) return []; // nothing to base suggestions on
  const profile = tasteProfile(items, { today });
  const dprofile = dislikeProfile(items, dislikes, { today });
  const weights = learnWeights(feedback);
  const shift = calibrationShift(feedback);
  const owned = new Set([
    ...items.map((i) => `${i.type}-${i.tmdbId}`),
    ...dislikes.map((d) => `${d.type}-${d.tmdbId}`),
  ]);
  const { types, animated } = EXPLORE_TYPES[type] || EXPLORE_TYPES.all;
  const candidates = new Map();

  // Not out yet (no ratings, nowhere to stream): leave it out.
  const todayIso = today.toISOString().slice(0, 10);
  const unreleased = (c) => (c.releaseDate ? c.releaseDate > todayIso : !c.voteCount);

  function add(list, seed) {
    for (const c of list) {
      if (!types.includes(c.type) || owned.has(keyOf(c)) || !c.posterPath || unreleased(c)) continue;
      if (animated !== undefined && isAnimated(c) !== animated) continue;
      const entry = candidates.get(keyOf(c)) || { ...c, recommendedBy: [] };
      if (seed && !entry.recommendedBy.some((r) => r.key === seed.key)) entry.recommendedBy.push(seed);
      candidates.set(keyOf(c), entry);
    }
  }

  // Only seeds of this tab's types: a show's recommendations are shows, so they'd be thrown away on Movies.
  // Both show tabs use all show seeds, so a title gets the same evidence (and match %) on every tab.
  const seeds = pickSeeds(items, { liking: profile.liking }).filter((s) => types.includes(s.type));
  const jobs = seeds.map(
    (s) => () =>
      cached(`rec:${s.type}:${s.tmdbId}`, 24 * HOURS, () => tmdb.recommendations(s.type, s.tmdbId)).then((list) =>
        add(list, {
          key: `${s.type}-${s.tmdbId}`,
          title: s.title,
          label: s.label,
          rating: s.rating,
          weight: profile.liking.get(s),
        }),
      ),
  );

  // Popular titles in your favourite genres, limited to your services if you picked any.
  const providerParams = services.length
    ? {
        with_watch_providers: services.join('|'),
        watch_region: region,
        with_watch_monetization_types: 'flatrate|free|ads',
      }
    : {};
  for (const t of types) {
    jobs.push(async () => {
      const queries = await discoverQueries(tmdb, t, profile, animated);
      if (genre) queries.push(await genreQuery(tmdb, t, genre, animated));
      await Promise.all(
        queries.filter(Boolean).map(async (q) => {
          const params = { ...providerParams, ...q };
          add(await cached(`disc:${t}:${JSON.stringify(params)}`, 12 * HOURS, () => tmdb.discover(t, params)));
        }),
      );
    });
  }

  // Titles TMDB considers similar to your most recent "Not interested" picks.
  const similarToDisliked = new Map();
  for (const d of dislikes.slice(-5)) {
    jobs.push(async () => {
      const list = await cached(`rec:${d.type}:${d.tmdbId}`, 24 * HOURS, () => tmdb.recommendations(d.type, d.tmdbId));
      for (const c of list) similarToDisliked.set(keyOf(c), (similarToDisliked.get(keyOf(c)) || 0) + 1);
    });
  }

  const results = await Promise.allSettled(jobs.map((job) => job()));
  const firstError = results.find((r) => r.status === 'rejected');
  if (candidates.size === 0 && firstError) throw firstError.reason;

  // Genre names for scoring.
  const maps = Object.fromEntries(await Promise.all(types.map(async (t) => [t, await tmdb.genreMap(t)])));
  const scored = [...candidates.values()].map((c) => {
    const genres = (c.genreIds || []).map((id) => maps[c.type]?.get(id)).filter(Boolean);
    const withGenres = { ...c, genres, similarToDisliked: similarToDisliked.get(keyOf(c)) || 0 };
    return {
      ...withGenres,
      score: scoreCandidate(withGenres, profile, { weights, dprofile }),
      reason: reasonFor(withGenres),
    };
  });
  // The genre filter only narrows the list; it doesn't change anyone's match %.
  const inGenre = (c) => !genre || normalizeGenres(c.genres).includes(genre);
  scored.sort((a, b) => b.score - a.score);
  const matching = scored.filter(inGenre);

  // Where to watch, for the best matches only (one request each, cached for a day).
  const shortlist = matching.slice(0, services.length ? limit * 3 : Math.ceil(limit * 1.5));
  await mapLimit(shortlist, 6, async (c) => {
    try {
      c.providers = await cached(`prov:${c.type}:${c.tmdbId}:${region}`, 24 * HOURS, () =>
        tmdb.watchProviders(c.type, c.tmdbId, region),
      );
    } catch {
      c.providers = { link: null, stream: [], rent: [], buy: [] };
    }
  });

  const wanted = new Set(services.map(Number));
  const picks = shortlist
    .filter((c) => !wanted.size || c.providers.stream.some((p) => wanted.has(p.id)))
    .slice(0, limit)
    .map((c) => ({ ...c, match: matchFor(c.score, shift) }));

  for (const c of picks) {
    recent.set(keyOf(c), {
      type: c.type,
      tmdbId: c.tmdbId,
      title: c.title,
      posterPath: c.posterPath,
      genres: c.genres,
      match: c.match,
      score: c.score,
      parts: scoreParts(c, profile),
    });
  }
  while (recent.size > 2000) recent.delete(recent.keys().next().value);

  return picks.map(
    ({ genreIds, genres, recommendedBy, popularity, voteCount, originalLanguage, similarToDisliked: _s, ...c }) => c,
  );
}

// How Explore is doing: of the suggestions you acted on, how many you added.
export function exploreStats(feedback = []) {
  const added = feedback.filter((f) => f.action === 'added').length;
  const disliked = feedback.filter((f) => f.action === 'disliked').length;
  const acted = added + disliked;
  const weights = learnWeights(feedback);
  const tuned =
    Object.entries(weights).some(([k, w]) => Math.abs(w - DEFAULT_WEIGHTS[k]) > 0.005) ||
    calibrationShift(feedback) !== 0;
  return { added, disliked, hitRate: acted ? Math.round((added / acted) * 100) : null, tuned };
}

export function clearExploreCache() {
  cache.clear();
  recent.clear();
}
