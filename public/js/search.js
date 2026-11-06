// The "Add a movie or show…" search in the header: searches TMDB and adds results to your library.
import { api } from './lib/api.js';
import { $, esc, showText } from './lib/dom.js';
import { poster } from './lib/images.js';
import { library } from './library/store.js';

const DEBOUNCE_MS = 350;
const MAX_RESULTS = 10;

const input = $('#search-input');
const results = $('#search-results');
let timer;
let latestSearch = 0; // so a slow, older search can't overwrite a newer one

function hide() {
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
      <div class="result-text">
        <strong>${esc(r.title)}</strong>
        <span>${r.type === 'tv' ? 'TV show' : 'Movie'}${r.year ? ` · ${r.year}` : ''}</span>
      </div>
      ${action}
    </li>`;
}

async function search(query) {
  const id = ++latestSearch;
  results.hidden = false;
  results.innerHTML = note('Searching…');
  try {
    const found = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (id !== latestSearch) return;
    results.innerHTML = found.length ? found.slice(0, MAX_RESULTS).map(resultRow).join('') : note('No matches.');
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
  input.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  document.addEventListener('click', (e) => !e.target.closest('.search') && hide());
  results.addEventListener('click', (e) => {
    const button = e.target.closest('.add');
    if (button) add(button);
  });
}
