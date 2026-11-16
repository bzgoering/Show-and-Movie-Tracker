// The search results page (#search/<text>), reached by pressing Enter in the header search: every match
// from TMDB as a poster grid like Explore's, filtered by All / Movies / Shows, with Load more for the next page.
import { api } from '../lib/api.js';
import { $, $$, esc, setSelected, showText } from '../lib/dom.js';
import { library } from '../library/store.js';
import { libraryId, mediaKey } from '../../shared/media.js';
import { poster } from '../lib/images.js';
import { openSearchResult } from './detail.js';

const state = {
  query: '',
  tab: 'all', // 'all', 'movie' or 'tv': a filter on what's loaded, not part of the address
  items: [], // every result loaded so far, across pages
  page: 0, // the last page loaded
  totalPages: 0,
  loading: false, // the first page is on its way
  loadingMore: false, // the next page is on its way
};

const el = {
  view: $('#search-view'),
  title: $('#search-title'),
  tabs: () => $$('#search-view .chip'),
  message: $('#search-message'),
  loading: $('#search-loading'),
  grid: $('#search-grid'),
  empty: $('#search-empty'),
  more: $('#search-more'),
  input: $('#search-input'),
};

let latestSearch = 0; // so a slow, older search (or its next page) can't overwrite a newer one

const keyOf = (r) => mediaKey(r.type, r.tmdbId);
const hasMore = () => state.page < state.totalPages;
const typeName = (type) => (type === 'tv' ? 'TV' : 'Movie');

// Once your library has loaded it's the truth (a title may have been added or removed since the search ran).
const isAdded = (r) => (library.loaded() ? Boolean(library.find(libraryId(r.type, r.tmdbId))) : r.inLibrary);

function card(r) {
  const added = isAdded(r);
  const key = esc(keyOf(r));
  const image = r.posterPath
    ? `<img src="${poster(r.posterPath)}" alt="" loading="lazy">`
    : `<div class="no-poster">${esc(r.title)}</div>`;
  return `
    <div class="explore-item${added ? ' added' : ''}">
      <button type="button" class="card" data-key="${key}" title="${esc(r.title)}">
        <div class="poster">${image}</div>
        <div class="card-title">${esc(r.title)}</div>
        <div class="card-meta">${typeName(r.type)}${r.year ? ` · ${r.year}` : ''}</div>
        ${added ? '<div class="card-meta"><span class="in-library">✓ Added</span></div>' : ''}
      </button>
    </div>`;
}

function emptyText() {
  const kind = { movie: 'movies', tv: 'shows' }[state.tab];
  if (!kind) return `No matches for "${state.query}".`;
  return hasMore()
    ? `No ${kind} among the results so far. Try Load more, or All.`
    : `No ${kind} for "${state.query}". Try All.`;
}

function render() {
  const shown = state.items.filter((r) => state.tab === 'all' || r.type === state.tab);
  el.title.textContent = `Results for "${state.query}"`;
  setSelected(el.tabs(), (chip) => chip.dataset.type === state.tab);
  el.grid.innerHTML = shown.map(card).join('');
  const settled = !state.loading && el.message.hidden;
  showText(el.empty, settled && shown.length === 0 ? emptyText() : '');
  el.loading.hidden = !state.loading;
  el.more.hidden = state.loading || !hasMore();
  el.more.disabled = state.loadingMore;
  el.more.textContent = state.loadingMore ? 'Loading…' : 'Load more';
}

async function fetchPage(query, page) {
  return api(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
}

async function load(query) {
  const id = ++latestSearch;
  Object.assign(state, { query, items: [], page: 0, totalPages: 0, loading: true, loadingMore: false });
  showText(el.message, '');
  render();
  try {
    const data = await fetchPage(query, 1);
    if (id !== latestSearch) return;
    Object.assign(state, { items: data.results, page: data.page, totalPages: data.totalPages });
  } catch (err) {
    if (id !== latestSearch) return;
    showText(el.message, `Couldn't search: ${err.message}`);
  }
  state.loading = false;
  render();
}

async function loadMore() {
  if (state.loading || state.loadingMore || !hasMore()) return;
  const id = latestSearch;
  state.loadingMore = true;
  showText(el.message, '');
  render();
  try {
    const data = await fetchPage(state.query, state.page + 1);
    if (id !== latestSearch) return;
    // TMDB's pages can shift while you read, so leave out anything already shown.
    const seen = new Set(state.items.map(keyOf));
    state.items.push(...data.results.filter((r) => !seen.has(keyOf(r))));
    Object.assign(state, { page: data.page, totalPages: data.totalPages });
  } catch (err) {
    if (id !== latestSearch) return;
    showText(el.message, `Couldn't load more: ${err.message}`);
  }
  state.loadingMore = false;
  render();
}

// Opens the page for a search (from the address, so also after a refresh or Back).
export function showSearch(query) {
  if (query !== state.query) state.tab = 'all';
  el.input.value = query; // so a refresh, or Back to an older search, shows what the results are for
  load(query);
}

export function initSearchPage() {
  $('#search-view .filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.tab = chip.dataset.type;
    render();
  });

  el.grid.addEventListener('click', (e) => {
    const target = e.target.closest('.card');
    const result = target && state.items.find((r) => keyOf(r) === target.dataset.key);
    if (result) openSearchResult({ ...result, inLibrary: isAdded(result) });
  });

  el.more.addEventListener('click', loadMore);

  // Adding from the details pop-up (or anywhere) updates the "Added" markers.
  library.onChange(() => {
    if (!el.view.hidden) render();
  });
}
