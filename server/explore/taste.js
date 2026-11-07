// What your library says about your taste: how much each title counts (a show you finished says a lot,
// one you stopped early on says little), the genres and languages you watch, and whether you lean
// to movies or shows.
import { normalizeGenres, ratingOf } from '../../public/shared/media.js';
import { airedCount, latestAired, watchedCount } from '../../public/shared/progress.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- How much each library title says about your taste ----------

const hasStarted = (p) => Boolean(p) && (p.season > 1 || p.episode > 0);

// How far into a show you are. `known` is false when TMDB episode info hasn't been loaded yet.
function engagement(item) {
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

// Your rating scales how much a title counts. Meh still counts (you liked it, just less than others);
// Great counts more than a title you finished without rating.
const RATING_WEIGHT = { 1: 0.6, 2: 1, 3: 1.3 };

// How much a library title says you like this kind of thing: what you did with it (below), scaled by
// your rating if you gave one. A rating is a clear opinion, so a rated title counts at least as much as
// one you're partway through, even if you haven't set episodes on it.
export function affinity(item, options = {}) {
  const base = engagementAffinity(item, options);
  const weight = RATING_WEIGHT[ratingOf(item)]; // ratings don't count while a title is in Planned
  return weight ? Math.max(base, 0.6) * weight : base;
}

// 0..1: how much a library title says you like this kind of thing, from what you've done with it.
//   1     a show you finished, or are caught up on (that includes Waiting)
//   0.8   a movie you watched (a big commitment, but less than a whole show)
//   0.45–0.95  a show you're partway through: more the further in you are
//   0.3   something you saved for later (0.15 if you saved it from Explore, so Explore
//         doesn't just hear its own suggestions back)
//   0.15  a show you seem to have dropped: stuck near the start and untouched for two months
// `tracksProgress` is false when you never set episodes on any show, so "not started" means nothing.
function engagementAffinity(item, { today = new Date(), tracksProgress = true } = {}) {
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
  };
}
