// Explore: suggests movies and shows you're likely to enjoy, based on your library.
//
// 1. Build a taste profile: which genres you watch, and whether you lean to movies or shows.
//    Titles you've watched count most, ones you're watching a bit less, planned ones least.
// 2. Gather candidates: TMDB's "recommended because you liked X" lists for your top titles,
//    plus popular titles in your favourite genres (on your streaming services, if you picked any).
// 3. Score each candidate, look up where it streams, and return them best match first.

// How much each label says about your taste.
const LABEL_WEIGHT = { watched: 3, watching: 2.5, planned: 1 };

// TMDB names TV genres differently ("Sci-Fi & Fantasy" vs "Science Fiction"), so split and align them.
export function normalizeGenres(names = []) {
  const out = new Set();
  for (const name of names) {
    for (const part of String(name).split(' & ')) out.add(part === 'Sci-Fi' ? 'Science Fiction' : part.trim());
  }
  return [...out];
}

export function tasteProfile(items) {
  const genres = new Map();
  const types = { movie: 0, tv: 0 };
  let total = 0;
  for (const item of items) {
    const w = LABEL_WEIGHT[item.label] || 1;
    total += w;
    types[item.type] = (types[item.type] || 0) + w;
    for (const g of normalizeGenres(item.cache?.genres)) genres.set(g, (genres.get(g) || 0) + w);
  }
  const top = Math.max(0, ...genres.values());
  const genreWeights = new Map([...genres].map(([g, w]) => [g, top ? w / top : 0]));
  return {
    rawGenres: genres, // summed label weights per genre
    genreWeights, // 0..1, your favourite genre is 1
    typeShare: { movie: total ? types.movie / total : 0.5, tv: total ? types.tv / total : 0.5 },
    topGenres: [...genreWeights].sort((a, b) => b[1] - a[1]).map(([g]) => g),
    empty: items.length === 0,
  };
}

// The four positive signals, each 0..1.
export function scoreParts(c, profile) {
  const genres = normalizeGenres(c.genres);
  const genreSum = genres.reduce((sum, g) => sum + (profile.genreWeights.get(g) || 0), 0);
  const genre = genres.length ? Math.min(1, genreSum / Math.min(genres.length, 3)) : 0;

  // Recommended by several of your titles = a strong signal.
  const rec = Math.min(1, (c.recommendedBy || []).reduce((sum, r) => sum + r.weight, 0) / 6);

  // Rating, trusted more as votes grow.
  const confidence = Math.min(1, (c.voteCount || 0) / 500);
  const quality = ((c.voteAverage || 0) / 10) * confidence + 0.5 * (1 - confidence);

  const type = profile.typeShare[c.type] ?? 0.5;
  return { genre, rec, quality, type };
}

export const DEFAULT_WEIGHTS = { genre: 0.45, rec: 0.3, quality: 0.15, type: 0.1 };

// How much "Not interested" can pull a score down. Smaller than the genre and
// recommendation signals, so dislikes balance the picture rather than drive it.
export const DISLIKE_WEIGHT = 0.12;

// Learns which signals actually predict what you add, from your Explore history.
// Compares the signals behind titles you added with the ones you hid, and nudges
// each weight up or down by at most half. Needs a few of each before it changes anything.
export function learnWeights(feedback = []) {
  const added = feedback.filter((f) => f.action === 'added' && f.parts);
  const hidden = feedback.filter((f) => f.action === 'disliked' && f.parts);
  if (added.length < 3 || hidden.length < 2) return { ...DEFAULT_WEIGHTS };
  const mean = (list, k) => list.reduce((sum, f) => sum + (f.parts[k] || 0), 0) / list.length;
  const raw = {};
  for (const [k, w] of Object.entries(DEFAULT_WEIGHTS)) {
    const diff = mean(added, k) - mean(hidden, k); // -1..1
    raw[k] = w * Math.min(1.5, Math.max(0.5, 1 + 0.8 * diff));
  }
  const total = Object.values(raw).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
}

// What your "Not interested" titles have in common.
// A genre counts against a title only as far as you hide it more than you watch it.
export function dislikeProfile(items, dislikes = []) {
  const liked = tasteProfile(items).rawGenres;
  const hidden = new Map();
  for (const d of dislikes) for (const g of normalizeGenres(d.genres)) hidden.set(g, (hidden.get(g) || 0) + 2);
  const share = new Map([...hidden].map(([g, h]) => [g, h / (h + (liked.get(g) || 0))]));
  return { genreShare: share, empty: dislikes.length === 0 };
}

// 0..1: how much a candidate looks like what you've hidden.
export function dislikeScore(c, dprofile) {
  if (!dprofile || dprofile.empty) return 0;
  const genres = normalizeGenres(c.genres);
  const genre = genres.length ? genres.reduce((sum, g) => sum + (dprofile.genreShare.get(g) || 0), 0) / genres.length : 0;
  const similar = Math.min(1, (c.similarToDisliked || 0) / 2);
  return 0.6 * genre + 0.4 * similar;
}

// 0..1, higher = more likely you'd enjoy it.
export function scoreCandidate(c, profile, { weights = DEFAULT_WEIGHTS, dprofile = null } = {}) {
  const parts = scoreParts(c, profile);
  if (profile.empty) return 0.6 * parts.quality + 0.4 * Math.min(1, (c.popularity || 0) / 200);
  const positive = Object.entries(weights).reduce((sum, [k, w]) => sum + w * parts[k], 0);
  return Math.max(0, positive - DISLIKE_WEIGHT * dislikeScore(c, dprofile));
}

// A short, human reason for a suggestion.
export function reasonFor(c, profile) {
  const recs = [...(c.recommendedBy || [])].sort((a, b) => b.weight - a.weight);
  if (recs.length) return `Because you ${recs[0].label === 'planned' ? 'saved' : 'watched'} ${recs[0].title}`;
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

// TV and movie genre ids that match your favourite genres, for TMDB's discover search.
async function genreIdsFor(tmdb, type, wanted) {
  const map = await tmdb.genreMap(type);
  return [...map].filter(([, name]) => normalizeGenres([name]).some((g) => wanted.includes(g))).map(([id]) => id);
}

// Recently scored suggestions, so feedback (add / not interested) can record what the score was based on.
const recent = new Map();
export const recentSuggestion = (key) => recent.get(key) || null;

export async function buildExplore({ tmdb, items, region = 'US', services = [], type = 'all', limit = 40, dislikes = [], feedback = [] }) {
  const profile = tasteProfile(items);
  const dprofile = dislikeProfile(items, dislikes);
  const weights = learnWeights(feedback);
  const owned = new Set([...items.map((i) => `${i.type}-${i.tmdbId}`), ...dislikes.map((d) => `${d.type}-${d.tmdbId}`)]);
  const types = type === 'all' ? ['movie', 'tv'] : [type];
  const candidates = new Map();

  function add(list, seed) {
    for (const c of list) {
      if (!types.includes(c.type) || owned.has(keyOf(c)) || !c.posterPath) continue;
      const entry = candidates.get(keyOf(c)) || { ...c, recommendedBy: [] };
      if (seed && !entry.recommendedBy.some((r) => r.title === seed.title)) entry.recommendedBy.push(seed);
      candidates.set(keyOf(c), entry);
    }
  }

  // Seeds: your strongest signals first (watched, then watching, then planned).
  const seeds = [...items]
    .sort((a, b) => (LABEL_WEIGHT[b.label] || 1) - (LABEL_WEIGHT[a.label] || 1) || (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 10);
  const jobs = seeds.map((s) => () =>
    cached(`rec:${s.type}:${s.tmdbId}`, 24 * HOURS, () => tmdb.recommendations(s.type, s.tmdbId)).then((list) =>
      add(list, { title: s.title, label: s.label, weight: LABEL_WEIGHT[s.label] || 1 }),
    ),
  );

  // Popular titles in your favourite genres, limited to your services if you picked any.
  const providerParams = services.length
    ? { with_watch_providers: services.join('|'), watch_region: region, with_watch_monetization_types: 'flatrate|free|ads' }
    : {};
  const topGenres = profile.topGenres.slice(0, 3);
  for (const t of types) {
    jobs.push(async () => {
      const ids = topGenres.length ? await genreIdsFor(tmdb, t, topGenres) : [];
      const params = { ...providerParams, ...(ids.length ? { with_genres: ids.join('|') } : {}) };
      add(await cached(`disc:${t}:${JSON.stringify(params)}`, 12 * HOURS, () => tmdb.discover(t, params)));
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
    const genres = c.genreIds.map((id) => maps[c.type]?.get(id)).filter(Boolean);
    const withGenres = { ...c, genres, similarToDisliked: similarToDisliked.get(keyOf(c)) || 0 };
    return { ...withGenres, score: scoreCandidate(withGenres, profile, { weights, dprofile }), reason: reasonFor(withGenres, profile) };
  });
  scored.sort((a, b) => b.score - a.score);

  // Where to watch, for the best matches only (one request each, cached for a day).
  const shortlist = scored.slice(0, services.length ? limit * 3 : Math.ceil(limit * 1.5));
  await mapLimit(shortlist, 6, async (c) => {
    try {
      c.providers = await cached(`prov:${c.type}:${c.tmdbId}:${region}`, 24 * HOURS, () => tmdb.watchProviders(c.type, c.tmdbId, region));
    } catch {
      c.providers = { link: null, stream: [], rent: [], buy: [] };
    }
  });

  const wanted = new Set(services.map(Number));
  const picks = shortlist
    .filter((c) => !wanted.size || c.providers.stream.some((p) => wanted.has(p.id)))
    .slice(0, limit)
    .map((c) => ({ ...c, match: Math.round(c.score * 100) }));

  for (const c of picks) {
    recent.set(keyOf(c), { type: c.type, tmdbId: c.tmdbId, title: c.title, posterPath: c.posterPath, genres: c.genres, match: c.match, parts: scoreParts(c, profile) });
  }
  while (recent.size > 2000) recent.delete(recent.keys().next().value);

  return picks.map(({ genreIds, genres, recommendedBy, popularity, voteCount, similarToDisliked: _s, ...c }) => c);
}

// How Explore is doing: of the suggestions you acted on, how many you added.
export function exploreStats(feedback = []) {
  const added = feedback.filter((f) => f.action === 'added').length;
  const disliked = feedback.filter((f) => f.action === 'disliked').length;
  const acted = added + disliked;
  const weights = learnWeights(feedback);
  const tuned = Object.entries(weights).some(([k, w]) => Math.abs(w - DEFAULT_WEIGHTS[k]) > 0.005);
  return { added, disliked, hitRate: acted ? Math.round((added / acted) * 100) : null, tuned };
}

export function clearExploreCache() {
  cache.clear();
  recent.clear();
}
