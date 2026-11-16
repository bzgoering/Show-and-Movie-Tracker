// Keeps the page and sub-tab in the address, e.g. #library/watching, #explore/tv-animated or #account, so a refresh
// reopens exactly where you were. Switching pages adds a browser history entry (so Back works);
// switching sub-tabs just updates the address. (index.html reads the same format before the first paint.)
// The search results page, #search/<text>, is only reached by searching: it isn't in the top bar, and the
// search text isn't a sub-tab, so it's never remembered like one. The format itself is in shared/route.js.
import { parseHash, searchHash, TAB_PAGES } from '../../shared/route.js';
import { readStored, writeStored } from './storage.js';

export const readRoute = () => parseHash(location.hash);

const hashFor = (view, sub) => (sub && sub !== 'all' ? `#${view}/${sub}` : `#${view}`);

// The last sub-tab seen on each page, so coming back to a page reopens its tab, even after a refresh.
// Kept for this browser tab only.
const STORAGE_KEY = 'lastSubTabs';
const lastSub = Object.fromEntries(TAB_PAGES.map((view) => [view, 'all']));
try {
  Object.assign(lastSub, JSON.parse(readStored(sessionStorage, STORAGE_KEY, '{}')));
} catch {
  // Unreadable saved value: start fresh.
}
if (readRoute().view in lastSub) lastSub[readRoute().view] = readRoute().sub;

export function setSubTab(view, sub) {
  lastSub[view] = sub;
  writeStored(sessionStorage, STORAGE_KEY, JSON.stringify(lastSub));
  if (readRoute().view === view) history.replaceState(null, '', hashFor(view, sub));
}

export function goToView(view) {
  location.hash = hashFor(view, lastSub[view]); // fires hashchange
}

// Opens the results page for a search, as a new history entry. Searching again for what's already
// showing doesn't change the address, so the page is told to load it afresh.
export function goToSearch(query) {
  const hash = searchHash(query);
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function onRouteChange(handler) {
  window.addEventListener('hashchange', () => handler(readRoute()));
}
