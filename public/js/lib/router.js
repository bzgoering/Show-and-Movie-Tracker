// Keeps the page and sub-tab in the address, e.g. #library/watching or #explore/tv-animated, so a refresh
// reopens exactly where you were. Switching pages adds a browser history entry (so Back works);
// switching sub-tabs just updates the address. (index.html reads the same format before the first paint.)
import { readStored, writeStored } from './storage.js';

export function readRoute() {
  const [view, sub] = location.hash.slice(1).split('/');
  return { view: view === 'explore' ? 'explore' : 'library', sub: sub || 'all' };
}

const hashFor = (view, sub) => (sub && sub !== 'all' ? `#${view}/${sub}` : `#${view}`);

// The last sub-tab seen on each page, so coming back to a page reopens its tab, even after a refresh.
// Kept for this browser tab only.
const STORAGE_KEY = 'lastSubTabs';
const lastSub = { library: 'all', explore: 'all' };
try {
  Object.assign(lastSub, JSON.parse(readStored(sessionStorage, STORAGE_KEY, '{}')));
} catch {
  // Unreadable saved value: start fresh.
}
lastSub[readRoute().view] = readRoute().sub;

export function setSubTab(view, sub) {
  lastSub[view] = sub;
  writeStored(sessionStorage, STORAGE_KEY, JSON.stringify(lastSub));
  if (readRoute().view === view) history.replaceState(null, '', hashFor(view, sub));
}

export function goToView(view) {
  location.hash = hashFor(view, lastSub[view]); // fires hashchange
}

export function onRouteChange(handler) {
  window.addEventListener('hashchange', () => handler(readRoute()));
}
