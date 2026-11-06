// Explore settings saved in the library file: your country and streaming services.
import { HttpError } from './http.js';

const defaultRegion = () => (process.env.WATCH_REGION || 'US').toUpperCase();

export const isRegion = (value) => /^[A-Z]{2}$/.test(String(value));

export function settingsOf(data) {
  return { region: defaultRegion(), services: [], ...data.settings };
}

// Validates a settings change and returns the new settings, or throws a 400.
export function applySettingsPatch(current, patch = {}) {
  const next = { ...current };
  if ('region' in patch) {
    if (!isRegion(patch.region)) throw new HttpError(400, 'Region must be a two-letter country code, like US.');
    next.region = patch.region;
  }
  if ('services' in patch) {
    const ids = Array.isArray(patch.services) ? patch.services.map(Number) : [];
    if (!Array.isArray(patch.services) || ids.length > 50 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new HttpError(400, 'Services must be a list of provider ids.');
    }
    next.services = [...new Set(ids)];
  }
  return next;
}
