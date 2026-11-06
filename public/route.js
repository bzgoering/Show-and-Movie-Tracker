// Keeps the page and sub-tab in the address, e.g. #library/watching or #explore/tv-animated,
// so a refresh reopens exactly where you were. Switching pages adds a browser history entry
// (so Back works); switching sub-tabs just updates the address.

export function readRoute() {
  const [view, sub] = location.hash.slice(1).split('/');
  return { view: view === 'explore' ? 'explore' : 'library', sub: sub || 'all' };
}

const hashFor = (view, sub) =>
  sub && sub !== 'all' ? `#${view}/${sub}` : view === 'library' ? '#library' : `#${view}`;

// Last sub-tab seen on each page, so coming back to a page reopens its tab, even after a
// refresh. Kept for this browser tab only; if storage is blocked it just isn't remembered.
function loadLast() {
  try {
    return { library: 'all', explore: 'all', ...JSON.parse(sessionStorage.getItem('lastSubTabs') || '{}') };
  } catch {
    return { library: 'all', explore: 'all' };
  }
}
const lastSub = loadLast();
lastSub[readRoute().view] = readRoute().sub;

export function setSubTab(view, sub) {
  lastSub[view] = sub;
  try {
    sessionStorage.setItem('lastSubTabs', JSON.stringify(lastSub));
  } catch {
    // Storage blocked (private window): the tab just isn't remembered across refreshes.
  }
  if (readRoute().view === view) history.replaceState(null, '', hashFor(view, sub));
}

export function goToView(view) {
  location.hash = hashFor(view, lastSub[view]); // fires hashchange
}
