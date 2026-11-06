// Small helpers for Express routes.
import { isMediaType } from '../public/shared/media.js';

// An error with an HTTP status; the app's error handler sends its message to the browser.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

// Lets route handlers be async: a rejected promise goes to Express's error handler.
export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

// Reads { type, tmdbId } from a request body, or throws a 400.
export function parseMediaRef(body = {}) {
  const tmdbId = Number(body.tmdbId);
  if (!isMediaType(body.type) || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new HttpError(400, 'Body must include type ("movie" or "tv") and a numeric tmdbId.');
  }
  return { type: body.type, tmdbId };
}

// Runs fn over list with at most `limit` running at once, keeping the results in order.
export async function mapLimit(list, limit, fn) {
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
