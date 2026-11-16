// Starts the app: sets up the pages and shows the one in the address (#library, #explore, #account or #search/<text>).
import { initAccountPage, showAccount } from './account/page.js';
import { initExplorePage, showExplore } from './explore/page.js';
import { $, $$, setSelected } from './lib/dom.js';
import { installImageFallback } from './lib/images.js';
import { goToView, onRouteChange, readRoute } from './lib/router.js';
import { initLibraryPage, loadLibrary, showLibraryTab } from './library/page.js';
import { initSearch } from './search.js';
import { initSearchPage, showSearch } from './search/page.js';

const views = {
  library: $('#library-view'),
  explore: $('#explore-view'),
  account: $('#account-view'),
  search: $('#search-view'),
};
const viewTabs = $$('.view-tab');

// The search results page has no tab in the top bar, so no tab is selected while it's open.
function show({ view, sub }) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  setSelected(viewTabs, (tab) => tab.dataset.view === view);
  if (view === 'search') showSearch(sub);
  else if (view === 'explore') showExplore(sub);
  else if (view === 'account') showAccount();
  else showLibraryTab(sub);
}

installImageFallback();
initSearch();
initLibraryPage();
initExplorePage();
initAccountPage();
initSearchPage();

$('.views').addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (tab && readRoute().view !== tab.dataset.view) goToView(tab.dataset.view);
});
onRouteChange(show);

show(readRoute());
loadLibrary();
