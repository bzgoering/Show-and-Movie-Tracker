// Starts the app: sets up the pages and shows the one in the address (#library, #explore or #account).
import { initAccountPage, showAccount } from './account/page.js';
import { initExplorePage, showExplore } from './explore/page.js';
import { $, $$, setSelected } from './lib/dom.js';
import { installImageFallback } from './lib/images.js';
import { goToView, onRouteChange, readRoute } from './lib/router.js';
import { initLibraryPage, loadLibrary, showLibraryTab } from './library/page.js';
import { initSearch } from './search.js';

const views = { library: $('#library-view'), explore: $('#explore-view'), account: $('#account-view') };
const viewTabs = $$('.view-tab');

function show({ view, sub }) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  setSelected(viewTabs, (tab) => tab.dataset.view === view);
  if (view === 'explore') showExplore(sub);
  else if (view === 'account') showAccount();
  else showLibraryTab(sub);
}

installImageFallback();
initSearch();
initLibraryPage();
initExplorePage();
initAccountPage();

$('.views').addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (tab && readRoute().view !== tab.dataset.view) goToView(tab.dataset.view);
});
onRouteChange(show);

show(readRoute());
loadLibrary();
