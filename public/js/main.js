// Starts the app: sets up both pages and shows the one in the address (#library or #explore).
import { initExplorePage, showExplore } from './explore/page.js';
import { $, $$, setSelected } from './lib/dom.js';
import { installImageFallback } from './lib/images.js';
import { goToView, onRouteChange, readRoute } from './lib/router.js';
import { initLibraryPage, loadLibrary, showLibraryTab } from './library/page.js';
import { initSearch } from './search.js';

const views = { library: $('#library-view'), explore: $('#explore-view') };
const viewTabs = $$('.view-tab');

function show({ view, sub }) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  setSelected(viewTabs, (tab) => tab.dataset.view === view);
  if (view === 'explore') showExplore(sub);
  else showLibraryTab(sub);
}

installImageFallback();
initSearch();
initLibraryPage();
initExplorePage();

$('.views').addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (tab && readRoute().view !== tab.dataset.view) goToView(tab.dataset.view);
});
onRouteChange(show);

show(readRoute());
loadLibrary();
