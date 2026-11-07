// The match %: how strongly your library points at a suggestion, and a short reason why.
import { normalizeGenres } from '../../public/shared/media.js';
import { tasteProfile } from './taste.js';

// Drama is TMDB's catch-all (about half of all titles have it), so it says less about a title.
const GENRE_SPECIFICITY = { Drama: 0.5 };

// 0..1: how closely its genres match the ones you watch, or null when either side has no genres.
// Averaged over the title's genres, so a title tagged with many loosely related genres
// doesn't outscore one that closely matches what you watch. Drama counts as half a genre,
// so a title tagged only "Drama" gets half the credit: that alone doesn't make it your kind of thing.
function genreFit(c, profile) {
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
function qualityOf(c) {
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
const DISLIKE_WEIGHT = 0.12;

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
  for (const d of dislikes)
    for (const g of normalizeGenres(d.genres)) hidden.set(g, (hidden.get(g) || 0) + HIDDEN_WEIGHT);
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
export function reasonFor(c) {
  // The title that says most about your taste; between equals, one you finished reads best.
  const rank = { watched: 0, watching: 1, planned: 2 };
  const recs = [...(c.recommendedBy || [])].sort(
    (a, b) => b.weight - a.weight || (rank[a.label] ?? 3) - (rank[b.label] ?? 3),
  );
  if (recs.length) {
    const verb =
      recs[0].rating === 3
        ? 'you loved'
        : { watching: "you're watching", planned: 'you saved' }[recs[0].label] || 'you watched';
    const more = recs.length > 1 ? `, plus ${recs.length - 1} more of your titles` : '';
    return `Because ${verb} ${recs[0].title}${more}`;
  }
  return `Popular with ${c.type === 'movie' ? 'movies' : 'shows'} like yours`;
}
