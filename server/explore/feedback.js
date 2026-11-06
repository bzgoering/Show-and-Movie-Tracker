// What you did with Explore suggestions (added, or hid with "Not interested"), saved with what each
// score was based on, so Explore can learn which signals match your taste (learnWeights) and check
// its match numbers against what you actually pick (calibrationShift). Kept in the library file.
import { mediaKey } from '../../public/shared/media.js';
import { recentSuggestion } from './build.js';

const MAX_FEEDBACK = 500;

export function recordFeedback(data, { type, tmdbId }, action, extra = {}) {
  const key = mediaKey(type, tmdbId);
  const s = recentSuggestion(key);
  data.feedback.push({
    key,
    action,
    match: s?.match ?? null,
    score: s?.score ?? null, // the match before the calibration check
    parts: s?.parts ?? null,
    ...extra,
    at: new Date().toISOString(),
  });
  data.feedback = data.feedback.slice(-MAX_FEEDBACK);
}

// Takes back the most recent feedback of one kind for a title (e.g. when "Not interested" is undone,
// so a mis-click doesn't teach Explore anything).
export function takeBackFeedback(data, key, action) {
  const i = data.feedback.findLastIndex((f) => f.key === key && f.action === action);
  if (i !== -1) data.feedback.splice(i, 1);
}
