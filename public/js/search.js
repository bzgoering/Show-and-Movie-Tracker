// The "Add a movie or show…" search in the header: searches TMDB, adds results to your library, and
// opens a result's details when you click its title or poster. Pressing Enter opens the full results page.
import { api } from './lib/api.js';
import { $, esc, showText } from './lib/dom.js';
import { poster } from './lib/images.js';
import { goToSearch } from './lib/router.js';
import { library } from './library/store.js';
import { mediaKey } from '../shared/media.js';
import { openSearchResult } from './search/detail.js';

const DEBOUNCE_MS = 350;
const MAX_RESULTS = 10;

const input = $('#search-input');
const results = $('#search-results');
let found = []; // the results on show, so clicking one can open its details
let timer;
let latestSearch = 0; // so a slow, older search can't overwrite a newer one

function hide() {
  latestSearch++; // a search still on its way must not bring the list back
  found = [];
  results.hidden = true;
  results.innerHTML = '';
}

const note = (text, className = '') => `<li class="result-note ${className}">${esc(text)}</li>`;

function resultRow(r) {
  const action = r.inLibrary
    ? '<span class="in-library">Added</span>'
    : `<button type="button" class="btn add" data-type="${r.type}" data-id="${r.tmdbId}">Add</button>`;
  return `
    <li class="result">
      ${r.posterPath ? `<img src="${poster(r.posterPath, 'w92')}" alt="">` : '<div class="thumb-empty"></div>'}
      <button type="button" class="result-text" data-key="${esc(mediaKey(r.type, r.tmdbId))}">
        <strong>${esc(r.title)}</strong>
        <span>${r.type === 'tv' ? 'TV show' : 'Movie'}${r.year ? ` · ${r.year}` : ''}</span>
      </button>
      ${action}
    </li>`;
}

async function search(query) {
  const id = ++latestSearch;
  results.hidden = false;
  results.innerHTML = note('Searching…');
  try {
    const { results: list } = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (id !== latestSearch) return;
    found = list.slice(0, MAX_RESULTS);
    results.innerHTML = found.length ? found.map(resultRow).join('') : note('No matches.');
  } catch (err) {
    if (id === latestSearch) results.innerHTML = note(err.message, 'error');
  }
}

async function add(button) {
  button.disabled = true;
  button.textContent = 'Adding…';
  try {
    await library.add({ type: button.dataset.type, tmdbId: Number(button.dataset.id) });
    button.replaceWith(
      Object.assign(document.createElement('span'), { className: 'in-library', textContent: 'Added' }),
    );
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Add';
    showText($('#message'), err.message);
  }
}

export function initSearch() {
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (!query) return hide();
    timer = setTimeout(() => search(query), DEBOUNCE_MS);
  });
  // Enter goes to the results page. The text stays in the box, and the dropdown (and any search about
  // to start for it) is dropped, since the page shows the same results. Enter on nothing does nothing.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    clearTimeout(timer);
    hide();
    goToSearch(query);
  });
  // Esc closes the results, wherever focus is (e.g. after clicking Add). The details pop-up handles its own Esc.
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !results.hidden && hide());
  document.addEventListener('click', (e) => !e.target.closest('.search') && hide());
  results.addEventListener('click', (e) => {
    const button = e.target.closest('.add');
    if (button) return add(button);
    // Anywhere else on a row (poster, title, empty space) opens its details.
    const row = e.target.closest('.result');
    if (!row) return;
    const result = found.find((r) => mediaKey(r.type, r.tmdbId) === row.querySelector('.result-text').dataset.key);
    if (!result) return;
    openSearchResult(result);
    hide(); // the pop-up has the focus now
  });
}
