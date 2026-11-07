// Your library in the browser: the list of saved titles, and every change to it goes through here.
// Pages subscribe with onChange to re-render; the reason says what happened ('load', 'add', 'update',
// 'remove'), so e.g. Explore can tell a fresh load from you adding a title.
import { api } from '../lib/api.js';

const items = [];
let loaded = false;
const events = new EventTarget();

const emit = (reason) => events.dispatchEvent(new CustomEvent('change', { detail: reason }));

function put(item, reason) {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) items.unshift(item);
  else items[i] = item;
  emit(reason);
  return item;
}

export const library = {
  items: () => items,
  loaded: () => loaded, // false until the first load finishes
  find: (id) => items.find((item) => item.id === id),
  onChange: (handler) => events.addEventListener('change', (e) => handler(e.detail)),

  // Loads the library (the server refreshes it from TMDB first). Returns the refresh summary, and
  // whether the server needs restarting to pick up an update.
  async load() {
    const { items: fresh, sync, restartNeeded } = await api('/api/library');
    items.splice(0, items.length, ...fresh);
    loaded = true;
    emit('load');
    return { sync, restartNeeded };
  },

  // body: { type, tmdbId, label?, from? }
  add: async (body) => put(await api('/api/library', { method: 'POST', body }), 'add'),

  update: async (id, changes) =>
    put(await api(`/api/library/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes }), 'update'),

  refresh: async (id) => put(await api(`/api/library/${encodeURIComponent(id)}/refresh`, { method: 'POST' }), 'update'),

  async remove(id) {
    await api(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const i = items.findIndex((item) => item.id === id);
    if (i !== -1) items.splice(i, 1);
    emit('remove');
  },
};
