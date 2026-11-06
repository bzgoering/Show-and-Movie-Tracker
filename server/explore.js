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

import { airedCount, latestAired, watchedCount } from '../public/progress.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// TMDB names TV genres differently ("Sci-Fi & Fantasy" vs "Science Fiction"), so split and align them.
export function normalizeGenres(names = []) {
  const out = new Set();
  for (const name of names) {
    for (const part of String(name).split(' & ')) out.add(part === 'Sci-Fi' ? 'Science Fiction' : part.trim());
  }
  return [...out];
}

// ---------- How much each library title says about your taste ----------

const hasStarted = (p) => Boolean(p) && (p.season > 1 || p.episode > 0);

// How far into a show you are. `known` is false when TMDB episode info hasn't been loaded yet.
export function engagement(item) {
  const cache = item.cache || {};
  const p = item.progress || { season: 1, episode: 0 };
  const started = hasStarted(p);
  const latest = latestAired(cache);
  const caughtUp =
    Boolean(latest) &&
    started &&
    (p.season > latest.season || (p.season === latest.season && p.episode >= latest.episode));
  const aired = latest ? airedCount(cache) : 0;
  const episodes = aired ? Math.min(aired, watchedCount(p, cache.seasons || [])) : 0;
  return { known: aired > 0, started, caughtUp, episodes, share: aired ? episodes / aired : 0 };
}

const daysSince = (iso, today) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? 0 : (today - t) / DAY_MS;
};

// 0..1: how much a library title says you like this kind of thing.
//   1     a show you finished, or are caught up on (that includes Waiting)
//   0.8   a movie you watched (a big commitment, but less than a whole show)
//   0.45–0.95  a show you're partway through: more the further in you are
//   0.3   something you saved for later (0.15 if you saved it from Explore, so Explore
//         doesn't just hear its own suggestions back)
//   0.15  a show you seem to have dropped: stuck near the start and untouched for two months
// `tracksProgress` is false when you never set episodes on any show, so "not started" means nothing.
export function affinity(item, { today = new Date(), tracksProgress = true } = {}) {
  if (item.label === 'planned') return item.addedFrom === 'explore' ? 0.15 : 0.3;
  if (item.type === 'movie') return item.label === 'watched' ? 0.8 : 0.3;
  const e = engagement(item);
  if (item.label === 'watched') {
    // You marked it watched, but your saved episode says you stopped well before the end: maybe a drop.
    return tracksProgress && e.known && e.started && !e.caughtUp && e.share < 0.5 ? 0.55 : 1;
  }
  if (item.label !== 'watching') return 0.3;
  if (e.caughtUp) return 1;
  if (!tracksProgress || !e.known) return 0.6;
  // Two seasons' worth of episodes counts as "deep in", even in a very long show.
  const depth = Math.max(e.share, Math.min(1, e.episodes / 24));
  const idle = daysSince(item.updatedAt || item.addedAt, today);
  if (depth < 0.25 && idle > 60) return 0.15;
  const liking = 0.45 + 0.5 * depth;
  return depth < 0.6 && idle > 180 ? liking * 0.75 : liking; // left halfway for half a year
}

const isAnimatedItem = (item) => normalizeGenres(item.cache?.genres).includes('Animation');

// Normalises so the biggest value is 1. Rounded so tiny floating-point noise doesn't matter.
function normalize(map) {
  const top = Math.max(0, ...map.values());
  return new Map([...map].map(([k, v]) => [k, top ? Math.round((v / top) * 1000) / 1000 : 0]));
}
const bump = (map, key, w) => map.set(key, (map.get(key) || 0) + w);
const sortedKeys = (map) => [...map].sort((a, b) => b[1] - a[1]).map(([k]) => k);

export function tasteProfile(items, { today = new Date() } = {}) {
  const tracksProgress = items.some((i) => i.type === 'tv' && i.label !== 'planned' && hasStarted(i.progress));
  const liking = new Map(items.map((i) => [i, affinity(i, { today, tracksProgress })]));
  const genres = new Map();
  const byType = { movie: new Map(), tv: new Map() };
  const amount = { movie: 0, tv: 0 }; // liking per type, all titles
  const genreAmount = { movie: 0, tv: 0 }; // liking per type, titles with genres
  const languages = new Map();
  const animatedLanguages = new Map();
  let total = 0;
  let languageKnown = 0;
  for (const item of items) {
    const w = liking.get(item);
    const type = item.type === 'movie' ? 'movie' : 'tv';
    total += w;
    amount[type] += w;
    const names = normalizeGenres(item.cache?.genres);
    if (names.length) genreAmount[type] += w;
    for (const g of names) {
      bump(genres, g, w);
      bump(byType[type], g, w);
    }
    const lang = item.cache?.originalLanguage;
    if (lang) {
      languageKnown++;
      bump(languages, lang, w);
      if (type === 'tv' && names.includes('Animation')) bump(animatedLanguages, lang, w);
    }
  }
  const genreWeights = normalize(genres);
  // Your movie and show tastes can differ (crime shows, sci-fi movies), so each type leans toward
  // the genres of that type, as far as you have enough titles of it to go on.
  const typeGenreWeights = {};
  for (const t of ['movie', 'tv']) {
    const own = normalize(byType[t]);
    const lean = genreAmount[t] / (genreAmount[t] + 3);
    const keys = new Set([...genreWeights.keys(), ...own.keys()]);
    typeGenreWeights[t] = normalize(
      new Map([...keys].map((g) => [g, (1 - lean) * (genreWeights.get(g) || 0) + lean * (own.get(g) || 0)])),
    );
  }
  const genreTotal = genreAmount.movie + genreAmount.tv;
  const languageTotal = [...languages.values()].reduce((a, b) => a + b, 0);
  const animTotal = [...animatedLanguages.values()].reduce((a, b) => a + b, 0);
  const [animLang, animLangW] = [...animatedLanguages].sort((a, b) => b[1] - a[1])[0] || [];
  return {
    liking, // library item -> 0..1
    rawGenres: genres, // summed liking per genre
    genreWeights, // 0..1, your favourite genre is 1
    typeGenreWeights, // the same, leaning toward movie or show genres
    topGenres: sortedKeys(genreWeights),
    topGenresByType: { movie: sortedKeys(typeGenreWeights.movie), tv: sortedKeys(typeGenreWeights.tv) },
    // How much to trust genres: a couple of titles say little, a dozen say a lot.
    genreConfidence: genreTotal / (genreTotal + 1.5),
    typeShare: { movie: total ? amount.movie / total : 0.5, tv: total ? amount.tv / total : 0.5 },
    languageShare: new Map([...languages].map(([l, w]) => [l, languageTotal ? w / languageTotal : 0])),
    languageKnown, // how many titles have a known language
    // The language most of your anime & cartoons are in, if one clearly leads (e.g. Japanese for anime).
    animatedLanguage: animTotal && animLangW / animTotal >= 0.6 ? animLang : null,
    empty: items.length === 0,
  };
}

// ---------- Scoring a suggestion ----------

// Drama is TMDB's catch-all (about half of all titles have it), so it says less about a title.
const GENRE_SPECIFICITY = { Drama: 0.5 };

// 0..1: how closely its genres match the ones you watch, or null when either side has no genres.
// Averaged over the title's genres, so a title tagged with many loosely related genres
// doesn't outscore one that closely matches what you watch. Drama counts as half a genre,
// so a title tagged only "Drama" gets half the credit: that alone doesn't make it your kind of thing.
export function genreFit(c, profile) {
  const genres = normalizeGenres(c.genres);
  const weights = profile.typeGenreWeights?.[c.type] || profile.genreWeights;
  if (!genres.length || !weights.size) return null;
  const s = (g) => GENRE_SPECIFICITY[g] ?? 1;
  const total = genres.reduce((sum, g) => sum + s(g), 0);
  return genres.reduce((sum, g) => sum + s(g) * (weights.get(g) || 0), 0) / Math.max(1, total);
}

// What's a typical TMDB rating for each type (shows are rated higher than movies on TMDB).
const TYPICAL_RATING = { movie: 6.7, tv: 7.4 };

// 0..1, where 0.5 is a typical rating, 1 is 1.5 points above it and 0 is 1.5 below.
// With few votes the rating is pulled toward typical, so a handful of fans can't make a title look great.
export function qualityOf(c) {
  const typical = TYPICAL_RATING[c.type] ?? 7;
  const votes = c.voteCount || 0;
  const rating = (votes * (c.voteAverage || 0) + 150 * typical) / (votes + 150);
  return Math.min(1, Math.max(0, (rating - typical + 1.5) / 3));
}

// 0..1: how much you watch titles in its original language, or null when we can't tell yet.
function languageFit(c, profile) {
  if (!c.originalLanguage || (profile.languageKnown || 0) < 5) return null;
  return Math.min(1, (profile.languageShare.get(c.originalLanguage) || 0) / 0.2);
}

// Each library title that TMDB says is similar adds evidence, weighted by how much you like it.
// It adds up with diminishing returns: one finished show gives 0.7, two give 0.91, three 0.97.
// Saved titles show what you're curious about rather than what you enjoy, so together they
// count at most as much as two of them.
const REC_RATE = 1.2;
function recEvidence(c, rate = REC_RATE) {
  let seen = 0;
  let saved = 0;
  for (const r of c.recommendedBy || []) {
    if (r.label === 'planned') saved += r.weight;
    else seen += r.weight;
  }
  return 1 - Math.exp(-rate * (seen + Math.min(0.6, saved)));
}

// The signals behind a suggestion, each 0..1 (genre and language are null when unknown).
// Saved with your feedback so Explore can learn which of them predict what you add.
export function scoreParts(c, profile) {
  return {
    genre: genreFit(c, profile),
    rec: recEvidence(c),
    quality: qualityOf(c),
    type: Math.min(1, (profile.typeShare?.[c.type] ?? 0.5) / 0.25), // 1 once a quarter of your library is this type
    language: languageFit(c, profile),
  };
}

// How much each signal counts by default. learnWeights adjusts these from your picks; the scoring
// below uses each weight relative to its default (a weight 20% above default counts 20% more).
export const DEFAULT_WEIGHTS = { rec: 0.4, genre: 0.3, quality: 0.15, type: 0.05, language: 0.1 };

// How much "Not interested" can pull a score down (in match points out of 100: 12).
// Smaller than the recommendation and genre signals, so dislikes balance the picture rather than drive it.
export const DISLIKE_WEIGHT = 0.12;

// Every title starts from 10%: with nothing for or against it, anyone might like it.
const BASELINE = 0.1;

// 0..1, higher = more likely you'd enjoy it. This is the match % (matchFor adds the feedback check).
//  - Recommendations from your library are the strongest evidence. When there are some, the score is
//    mostly that evidence, nudged by the genre fit (a recommendation in genres you never watch is often noise).
//  - Without recommendations, a close genre fit alone is decent but never strong evidence (at most 70%,
//    less when your library is small).
//  - Then it's trimmed: up to 30% off for a below-par rating (a great rating keeps the score but doesn't
//    add to it), and up to 10% each for a type (movies vs shows) or a language you rarely watch.
//  - Titles like ones you hid lose up to 12 points.
export function scoreCandidate(c, profile, { weights = DEFAULT_WEIGHTS, dprofile = null } = {}) {
  const parts = scoreParts(c, profile);
  if (profile.empty) return 0.6 * parts.quality + 0.4 * Math.min(1, (c.popularity || 0) / 200);
  const m = Object.fromEntries(
    Object.keys(DEFAULT_WEIGHTS).map((k) => [k, (weights[k] ?? DEFAULT_WEIGHTS[k]) / DEFAULT_WEIGHTS[k]]),
  );
  const rec = recEvidence(c, REC_RATE * m.rec);
  const genreOnly = Math.min(0.9, 0.7 * m.genre) * (parts.genre ?? 0) * profile.genreConfidence;
  const evidence = rec * (0.7 + 0.3 * (parts.genre ?? 0.5)) + (1 - rec) * genreOnly;
  const fit = BASELINE + (1 - BASELINE) * evidence;
  const quality = 1 - Math.min(0.5, 0.3 * m.quality) * (1 - Math.min(1, parts.quality / 0.8));
  const type = 1 - Math.min(0.3, 0.1 * m.type) * (1 - parts.type);
  const language = parts.language === null ? 1 : 1 - Math.min(0.3, 0.1 * m.language) * (1 - parts.language);
  return Math.max(0, fit * quality * type * language - DISLIKE_WEIGHT * dislikeScore(c, dprofile));
}

// Learns which signals actually predict what you add, from your Explore history.
// Compares the signals behind titles you added with the ones you hid, and nudges
// each weight up or down by at most half. Needs a few of each before it changes anything.
export function learnWeights(feedback = []) {
  const added = feedback.filter((f) => f.action === 'added' && f.parts);
  const hidden = feedback.filter((f) => f.action === 'disliked' && f.parts);
  const known = (list, k) => list.filter((f) => typeof f.parts[k] === 'number');
  const mean = (list, k) => list.reduce((sum, f) => sum + f.parts[k], 0) / list.length;
  const raw = {};
  let changed = false;
  for (const [k, w] of Object.entries(DEFAULT_WEIGHTS)) {
    const a = known(added, k);
    const h = known(hidden, k);
    if (a.length < 3 || h.length < 2) {
      raw[k] = w;
      continue;
    }
    changed = true;
    const diff = mean(a, k) - mean(h, k); // -1..1
    raw[k] = w * Math.min(1.5, Math.max(0.5, 1 + 0.8 * diff));
  }
  if (!changed) return { ...DEFAULT_WEIGHTS };
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
}

// Checks the match numbers against what you actually do with suggestions. If the ones you acted on
// averaged 70% but you added only 4 in 10, the numbers were too generous, so they all come down a little
// (half the gap, at most 10 points); if you add more than the numbers suggest, they go up.
// Needs 10 picks, with at least 3 adds and 3 hides. Moving every number by the same amount keeps the order.
export function calibrationShift(feedback = []) {
  const scored = feedback.filter(
    (f) => typeof f.score === 'number' && (f.action === 'added' || f.action === 'disliked'),
  );
  const added = scored.filter((f) => f.action === 'added').length;
  if (scored.length < 10 || added < 3 || scored.length - added < 3) return 0;
  const shown = scored.reduce((sum, f) => sum + f.score, 0) / scored.length;
  // In whole match points, so floating-point dust doesn't count as a change.
  return Math.round(Math.max(-0.1, Math.min(0.1, (added / scored.length - shown) / 2)) * 100) / 100 || 0;
}

// The % shown on the card. Capped at 99: Explore is never certain.
export const matchFor = (score, shift = 0) => Math.max(0, Math.min(99, Math.round((score + shift) * 100)));

// What your "Not interested" titles have in common.
// A genre counts against a title only as far as you hide it more than you watch it.
const HIDDEN_WEIGHT = 0.7; // one hidden title counts about as much as a watched movie
export function dislikeProfile(items, dislikes = [], { today = new Date() } = {}) {
  const liked = tasteProfile(items, { today }).rawGenres;
  const hidden = new Map();
  for (const d of dislikes) for (const g of normalizeGenres(d.genres)) bump(hidden, g, HIDDEN_WEIGHT);
  const share = new Map([...hidden].map(([g, h]) => [g, h / (h + (liked.get(g) || 0))]));
  return { genreShare: share, empty: dislikes.length === 0 };
}

// 0..1: how much a candidate looks like what you've hidden.
export function dislikeScore(c, dprofile) {
  if (!dprofile || dprofile.empty) return 0;
  const genres = normalizeGenres(c.genres);
  const genre = genres.length
    ? genres.reduce((sum, g) => sum + (dprofile.genreShare.get(g) || 0), 0) / genres.length
    : 0;
  const similar = Math.min(1, (c.similarToDisliked || 0) / 2);
  return 0.6 * genre + 0.4 * similar;
}

// A short, human reason for a suggestion.
export function reasonFor(c, profile) {
  // The title that says most about your taste; between equals, one you finished reads best.
  const rank = { watched: 0, watching: 1, planned: 2 };
  const recs = [...(c.recommendedBy || [])].sort(
    (a, b) => b.weight - a.weight || (rank[a.label] ?? 3) - (rank[b.label] ?? 3),
  );
  if (recs.length) {
    const verb = { watching: "you're watching", planned: 'you saved' }[recs[0].label] || 'you watched';
    const more = recs.length > 1 ? `, plus ${recs.length - 1} more of your titles` : '';
    return `Because ${verb} ${recs[0].title}${more}`;
  }
  if (profile.empty) return 'Popular this week';
  return `Popular with ${c.type === 'movie' ? 'movies' : 'shows'} like yours`;
}

// ---------- gathering (talks to TMDB) ----------

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
const HOURS = 60 * 60 * 1000;

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

const keyOf = (c) => `${c.type}-${c.tmdbId}`;

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
export const ANIMATION = 16;
export const isAnimated = (c) => (c.genreIds || []).includes(ANIMATION);

// The Explore tabs. Shows are split into live action and anime & cartoons.
export const EXPLORE_TYPES = {
  all: { types: ['movie', 'tv'] },
  movie: { types: ['movie'] },
  tv: { types: ['tv'] },
  'tv-live': { types: ['tv'], animated: false },
  'tv-animated': { types: ['tv'], animated: true },
};

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
  today = new Date(),
}) {
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
        add(list, { key: `${s.type}-${s.tmdbId}`, title: s.title, label: s.label, weight: profile.liking.get(s) }),
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
      await Promise.all(
        queries.map(async (q) => {
          const params = { ...providerParams, ...q };
          add(await cached(`disc:${t}:${JSON.stringify(params)}`, 12 * HOURS, () => tmdb.discover(t, params)));
        }),
      );
    });
  }
  if (profile.empty) jobs.push(async () => add(await cached('trending', 6 * HOURS, () => tmdb.trending())));

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
      reason: reasonFor(withGenres, profile),
    };
  });
  scored.sort((a, b) => b.score - a.score);

  // Where to watch, for the best matches only (one request each, cached for a day).
  const shortlist = scored.slice(0, services.length ? limit * 3 : Math.ceil(limit * 1.5));
  await mapLimit(shortlist, 6, async (c) => {
    try {
      c.providers = await cached(`prov:${c.type}:${c.tmdbId}:${region}`, 24 * HOURS, () =>
        tmdb.watchProviders(c.type, c.tmdbId, region),
      );
    } catch {
      c.providers = { link: null, stream: [], rent: [], buy: [] };
    }
  });

  // With an empty library there's nothing to match against, so no % is shown (the page says "Trending").
  const wanted = new Set(services.map(Number));
  const picks = shortlist
    .filter((c) => !wanted.size || c.providers.stream.some((p) => wanted.has(p.id)))
    .slice(0, limit)
    .map((c) => ({ ...c, match: profile.empty ? null : matchFor(c.score, shift) }));

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
