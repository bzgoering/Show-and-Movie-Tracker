// The Library page: your titles as a poster grid, with tabs, sort, genre picker and search.
import { providerStrip } from '../components/where-to-watch.js';
import { $, $$, esc, setSelected, showText } from '../lib/dom.js';
import { poster } from '../lib/images.js';
import { setSubTab } from '../lib/router.js';
import { readStored, writeStored } from '../lib/storage.js';
import { progressSummary, statusOf } from '../../shared/progress.js';
import { openDetail } from './detail.js';
import { LABEL_NAMES } from './labels.js';
import { cardRelease } from './release.js';
import { hasGenre, libraryGenres, SORTS, sortItems } from './sort.js';
import { library } from './store.js';

const TABS = ['all', 'watching', 'waiting', 'planned', 'watched', 'movie', 'tv'];
const SORT_KEY = 'sort';

const state = {
  tab: 'all',
  query: '',
  genre: '',
  sort: Object.hasOwn(SORTS, readStored(localStorage, SORT_KEY, '')) ? readStored(localStorage, SORT_KEY, '') : 'title',
};

const el = {
  grid: $('#grid'),
  empty: $('#empty'),
  message: $('#message'),
  sync: $('#sync-status'),
  tabs: () => $$('#library-view .filters .chip'),
  genre: $('#genre-select'),
  sort: $('#sort-select'),
  search: $('#library-search'),
};

export const showMessage = (text) => showText(el.message, text);

// Lowercase, drop accents and punctuation, so "pokemon" finds "Pokémon" and "spiderman" finds "Spider-Man".
const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');

function matches(item) {
  if (state.query && !normalize(item.title).includes(normalize(state.query))) return false;
  if (state.tab === 'all') return hasGenre(item, state.genre);
  if (state.tab === 'movie' || state.tab === 'tv') return item.type === state.tab;
  return statusOf(item) === state.tab;
}

function cardMeta(item) {
  if (item.type === 'movie') return item.year ? `Movie · ${item.year}` : 'Movie';
  if (item.label === 'planned') return 'TV';
  return progressSummary(item);
}

// What's coming next, shown only once you're caught up (Waiting) or done (Watched),
// and not for a finished show (the card already says "Finished").
function releaseLine(item, status) {
  if (item.type !== 'tv' || !['waiting', 'watched'].includes(status)) return '';
  const release = cardRelease(item.prediction);
  if (!release || (item.prediction.kind === 'ended' && progressSummary(item) === 'Finished')) return '';
  const tag = release.tag ? `<span class="next-tag">${esc(release.tag)}</span> ` : '';
  return `<div class="card-next${release.soon ? ' soon' : ''}">${tag}${esc(release.text)}</div>`;
}

function card(item) {
  const status = statusOf(item);
  return `
    <button type="button" class="card" data-id="${esc(item.id)}" title="${esc(item.title)}">
      <div class="poster">
        ${item.posterPath ? `<img src="${poster(item.posterPath)}" alt="" loading="lazy">` : `<div class="no-poster">${esc(item.title)}</div>`}
      </div>
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-meta"><span class="label ${status}">${LABEL_NAMES[status]}</span> · ${esc(cardMeta(item))}</div>
      ${releaseLine(item, status)}
      ${status === 'planned' && item.cache?.providers ? `<div class="card-providers">${providerStrip(item.cache.providers)}</div>` : ''}
    </button>`;
}

function emptyText(total) {
  if (!total) return 'Nothing here yet. Search for a movie or show above to add it.';
  if (state.query) return `Nothing in your library matches "${state.query}".`;
  if (state.genre) return `Nothing in ${state.genre}.`;
  return 'Nothing matches this filter.';
}

// The genre picker lists the genres in your library. It's hidden until titles have genres
// (they're saved on the next refresh), and on tabs other than All.
function renderGenres() {
  const genres = libraryGenres(library.items());
  if (state.genre && !genres.some((g) => g.name === state.genre)) state.genre = '';
  el.genre.innerHTML =
    '<option value="">All genres</option>' +
    genres.map((g) => `<option value="${esc(g.name)}">${esc(g.name)} (${g.count})</option>`).join('');
  el.genre.value = state.genre;
  el.genre.hidden = state.tab !== 'all' || genres.length === 0;
}

function render() {
  renderGenres();
  // Sorting is offered on the All tab; the other tabs stay A-Z.
  el.sort.hidden = state.tab !== 'all';
  const items = sortItems(library.items().filter(matches), state.tab === 'all' ? state.sort : 'title');
  el.grid.innerHTML = items.map(card).join('');
  el.empty.hidden = items.length > 0;
  el.empty.textContent = emptyText(library.items().length);
}

function setTab(tab) {
  state.tab = TABS.includes(tab) ? tab : 'all';
  setSelected(el.tabs(), (chip) => chip.dataset.filter === state.tab);
}

// Opens a tab (from the address, e.g. after a refresh or the Back button).
export function showLibraryTab(tab) {
  setTab(tab);
  render();
}

function showSync(sync) {
  if (!sync) return (el.sync.textContent = '');
  if (sync.failed && !sync.updated) showMessage(`Couldn't update from TMDB (${sync.error}). Showing your saved info.`);
  else if (sync.error && !sync.failed)
    showMessage(`Search and updates are off: ${sync.error} See the README for setup.`);
  const time = new Date(sync.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  el.sync.textContent = sync.updated ? `Updated ${time}` : '';
}

export async function loadLibrary() {
  el.sync.textContent = 'Updating…';
  el.grid.classList.add('loading');
  try {
    const { sync, restartNeeded } = await library.load();
    showMessage('');
    showSync(sync);
    if (restartNeeded) {
      showMessage('This app was updated. Restart it to finish: press Ctrl+C in its window, then run npm start.');
    }
  } catch (err) {
    el.sync.textContent = '';
    showMessage(`Could not load your library: ${err.message}`);
  }
  el.grid.classList.remove('loading');
}

export function initLibraryPage() {
  library.onChange(render);

  $('#library-view .filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    setTab(chip.dataset.filter);
    setSubTab('library', state.tab);
    render();
  });

  el.grid.addEventListener('click', (e) => {
    const target = e.target.closest('.card');
    if (target) openDetail(target.dataset.id);
  });

  el.genre.addEventListener('change', () => {
    state.genre = el.genre.value;
    render();
  });

  el.sort.value = state.sort;
  el.sort.addEventListener('change', () => {
    state.sort = el.sort.value;
    writeStored(localStorage, SORT_KEY, state.sort);
    render();
  });

  // Library search looks through everything, so it switches to the All tab.
  el.search.addEventListener('input', () => {
    state.query = el.search.value.trim();
    if (state.query && state.tab !== 'all') {
      setTab('all');
      setSubTab('library', 'all');
    }
    render();
  });
  el.search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !el.search.value) return;
    el.search.value = '';
    state.query = '';
    render();
  });
}
