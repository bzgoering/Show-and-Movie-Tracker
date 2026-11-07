// The Explore page: suggestions based on your library, best match first, filtered to your services.
import { providerStrip, whereToWatch } from '../components/where-to-watch.js';
import { api } from '../lib/api.js';
import { closeDialog, openDialog } from '../lib/dialog.js';
import { $, $$, esc, setSelected, showText } from '../lib/dom.js';
import { poster } from '../lib/images.js';
import { setSubTab } from '../lib/router.js';
import { readStored, writeStored } from '../lib/storage.js';
import { toast } from '../lib/toast.js';
import { library } from '../library/store.js';
import { EXPLORE_TABS, mediaKey } from '../../shared/media.js';
import { currentSettings, initServices, loadSettings } from './services.js';

const GENRE_KEY = 'exploreGenre'; // the genre filter is remembered for this browser tab
const TABS_KEY = 'exploreTabs'; // which tabs you have, remembered so a refresh shows the right ones at once

function savedTabs() {
  try {
    const tabs = JSON.parse(readStored(localStorage, TABS_KEY, 'null'));
    return Array.isArray(tabs) ? tabs : null;
  } catch {
    return null;
  }
}

const state = {
  tab: 'all',
  genre: readStored(sessionStorage, GENRE_KEY, ''), // '' = all genres
  genres: [], // genres you can filter by (from your library), as the server last sent them
  tabs: savedTabs(), // tabs you have, from your library (null until the first load)
  libraryEmpty: false, // nothing in your library yet: nothing to suggest from
  results: new Map(), // "tab|genre" -> suggestions
  stale: false, // your library changed since these were loaded
  stats: null, // { added, disliked, tuned }
  hiddenCount: 0,
  openKey: null, // the suggestion whose details are open
};

const el = {
  grid: $('#explore-grid'),
  filters: $('.explore-types'),
  tabs: () => $$('.explore-types .chip'),
  movieKind: $('#movie-kind'),
  genre: $('#explore-genre'),
  message: $('#explore-message'),
  stats: $('#explore-stats'),
  loading: $('#explore-loading'),
  empty: $('#explore-empty'),
};

const keyOf = (c) => mediaKey(c.type, c.tmdbId);
const resultsKey = (tab = state.tab, genre = state.genre) => `${tab}|${genre}`;
// "movie-live" and "movie-animated" are kinds of movie under the Movies tab.
const tabGroup = (tab) => (tab.startsWith('movie') ? 'movie' : tab);
const showMessage = (text) => showText(el.message, text);

function find(key) {
  for (const list of state.results.values()) {
    const found = list.find((c) => keyOf(c) === key);
    if (found) return found;
  }
  return null;
}

// ---------- Results ----------

// The match % with what it means in words, on hover.
function matchMeaning(m) {
  if (m >= 85) return 'Strong match: very likely your kind of thing';
  if (m >= 70) return 'Good match: likely your kind of thing';
  if (m >= 50) return 'Possible match: might be your kind of thing';
  return 'Long shot: probably not your kind of thing';
}

const matchTag = (c) => `<span class="match" title="${esc(matchMeaning(c.match))}">${c.match}% match</span>`;

const typeYear = (c, long = false) =>
  `${c.type === 'tv' ? (long ? 'TV show' : 'TV') : 'Movie'}${c.year ? ` · ${c.year}` : ''}`;

function card(c) {
  const key = esc(keyOf(c));
  return `
    <div class="explore-item${c.added ? ' added' : ''}">
      <button type="button" class="card" data-key="${key}" title="${esc(c.title)}">
        <div class="poster"><img src="${poster(c.posterPath)}" alt="" loading="lazy"></div>
        <div class="card-title">${esc(c.title)}</div>
        <div class="card-meta">${matchTag(c)} · ${typeYear(c)}</div>
        <div class="card-providers">${providerStrip(c.providers)}</div>
      </button>
      ${c.added ? '' : `<button type="button" class="dismiss" data-key="${key}" title="Not interested" aria-label="Not interested in ${esc(c.title)}">✕</button>`}
    </div>`;
}

function emptyText() {
  if (state.libraryEmpty) return 'Add a show or movie to your library, and Explore will suggest things you might like.';
  if (state.genre) return `No ${state.genre} suggestions here yet. Try another genre, or All genres.`;
  if (currentSettings()?.services.length) {
    return 'Nothing found on your streaming services. Try adding more services, or more titles to your library.';
  }
  return 'No suggestions yet. Add a few movies or shows to your library first.';
}

function renderResults() {
  const items = state.results.get(resultsKey()) ?? [];
  el.grid.innerHTML = items.map(card).join('');
  el.empty.hidden = items.length > 0 || !el.message.hidden;
  el.empty.textContent = emptyText();
}

// The genre picker lists the genres in your library; hidden until there are some.
function renderGenres() {
  el.genre.innerHTML =
    '<option value="">All genres</option>' +
    state.genres.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  el.genre.value = state.genre;
  el.genre.hidden = state.genres.length === 0;
}

function setGenre(genre) {
  state.genre = genre;
  writeStored(sessionStorage, GENRE_KEY, genre);
}

// "Your picks" line: how often you add what Explore suggests, plus the hidden list.
function renderStats() {
  const s = state.stats;
  const parts = [];
  const acted = s ? s.added + s.disliked : 0;
  if (acted) {
    parts.push(`Your picks: ${s.added} added, ${s.disliked} not interested`);
    if (acted >= 3) parts.push(`${Math.round((s.added / acted) * 100)}% hit rate`); // means little before that
    if (s.tuned) parts.push('tuned to your picks');
  }
  if (state.hiddenCount) {
    parts.push(`<button type="button" id="show-hidden" class="link-btn">${state.hiddenCount} hidden</button>`);
  }
  el.stats.innerHTML = parts.join(' · ');
  el.stats.hidden = parts.length === 0;
}

// Shows only the tabs you have (the server works them out from your library). Until the first load,
// the tabs remembered from last time are used.
function renderTabs() {
  if (!state.tabs) return;
  for (const chip of el.tabs()) chip.hidden = !state.tabs.includes(chip.dataset.type);
  el.filters.hidden = state.tabs.length === 0;
  el.movieKind.hidden = tabGroup(state.tab) !== 'movie' || !state.tabs.includes('movie-live');
}

let latestLoad = 0; // so a slow, older load can't overwrite a newer one

async function loadResults() {
  if (state.stale) {
    state.results.clear();
    state.stale = false;
  }
  if (state.results.has(resultsKey())) return renderResults();
  const load = ++latestLoad;
  const { tab, genre } = state;
  el.grid.innerHTML = '';
  el.empty.hidden = true;
  el.loading.hidden = false;
  showMessage('');
  try {
    const query = genre ? `type=${tab}&genre=${encodeURIComponent(genre)}` : `type=${tab}`;
    const data = await api(`/api/explore?${query}`);
    // The server may show a different tab (one you have) or drop a genre that doesn't apply here.
    state.results.set(resultsKey(data.tab ?? tab, data.genre), data.items);
    state.tabs = data.tabs;
    writeStored(localStorage, TABS_KEY, JSON.stringify(data.tabs));
    state.libraryEmpty = data.tabs.length === 0;
    state.stats = data.stats;
    state.hiddenCount = data.hidden;
    if (load === latestLoad) {
      if (data.tab && data.tab !== state.tab) {
        setTab(data.tab);
        setSubTab('explore', data.tab);
      }
      state.genres = data.genres;
      if (data.genre !== state.genre) setGenre(data.genre);
      renderGenres();
      renderTabs();
    }
    renderStats();
  } catch (err) {
    showMessage(`Couldn't load suggestions: ${err.message}`);
  } finally {
    if (load === latestLoad) el.loading.hidden = true;
  }
  if (load === latestLoad) renderResults();
}

function setTab(tab) {
  state.tab = EXPLORE_TABS.includes(tab) ? tab : 'all';
  setSelected(el.tabs(), (chip) => chip.dataset.type === tabGroup(state.tab));
  el.movieKind.value = state.tab;
  renderTabs();
}

// Switching tab (or kind of movie) from the page: remember it in the address, then load.
function changeTab(tab) {
  setTab(tab);
  setSubTab('explore', state.tab);
  loadResults();
}

// Opens Explore on a tab (from the address, e.g. after a refresh or the Back button).
export async function showExplore(tab) {
  setTab(tab);
  try {
    await loadSettings();
  } catch (err) {
    showMessage(err.message);
    return;
  }
  loadResults();
}

// ---------- Not interested ----------

async function notInterested(key) {
  const c = find(key);
  if (!c) return;
  try {
    await api('/api/explore/dislikes', { method: 'POST', body: { type: c.type, tmdbId: c.tmdbId } });
  } catch (err) {
    showMessage(err.message);
    return;
  }
  for (const [tab, list] of state.results)
    state.results.set(
      tab,
      list.filter((x) => keyOf(x) !== key),
    );
  if (state.openKey === key) closeDialog();
  state.hiddenCount++;
  if (state.stats) state.stats.disliked++;
  renderResults();
  renderStats();
  toast(`Hidden "${c.title}". Explore will suggest less like it.`, () => unhide(key));
}

async function unhide(key) {
  try {
    await api(`/api/explore/dislikes/${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (err) {
    showMessage(err.message);
    return;
  }
  state.results.clear(); // scores change when a dislike goes away
  loadResults();
}

async function showHiddenList() {
  let list;
  try {
    list = await api('/api/explore/dislikes');
  } catch (err) {
    showMessage(err.message);
    return;
  }
  const rows = list
    .map(
      (d) => `
      <li>
        ${d.posterPath ? `<img src="${poster(d.posterPath, 'w92')}" alt="">` : '<span class="thumb-empty"></span>'}
        <span class="hidden-title">${esc(d.title)}<span class="muted small"> · ${d.type === 'tv' ? 'TV' : 'Movie'}</span></span>
        <button type="button" class="btn small-btn unhide" data-key="${esc(keyOf(d))}">Show again</button>
      </li>`,
    )
    .join('');
  openDialog(
    `<h2 id="detail-title">Hidden from Explore</h2>
     <p class="muted small">Titles you marked "Not interested". Explore won't suggest them, and suggests a little less like them.</p>
     <ul class="hidden-list">${rows}</ul>`,
    {
      onClick(e) {
        const button = e.target.closest('.unhide');
        if (!button) return;
        button.closest('li').remove();
        state.hiddenCount = Math.max(0, state.hiddenCount - 1);
        renderStats();
        unhide(button.dataset.key);
      },
    },
  );
}

// ---------- Suggestion details ----------

function suggestionHtml(c) {
  const actions = c.added
    ? `<span class="caught-up">✓ In your library as ${c.added === 'watched' ? 'Watched' : 'Planned'}</span>`
    : `<button type="button" class="btn primary explore-add" data-label="planned">Add to Planned</button>
       <button type="button" class="btn explore-add" data-label="watched">Watched</button>
       <button type="button" id="explore-dislike" class="btn">Not interested</button>`;
  return `
    <div class="detail-head">
      <img class="detail-poster" src="${poster(c.posterPath)}" alt="">
      <div>
        <h2 id="detail-title">${esc(c.title)}</h2>
        <p class="muted">${typeYear(c, true)} · ${matchTag(c)}</p>
        <p class="muted small">${esc(c.reason)}</p>
        <div class="row buttons">${actions}</div>
        ${c.overview ? `<p class="overview">${esc(c.overview)}</p>` : ''}
      </div>
    </div>
    ${whereToWatch(c.providers, currentSettings()?.region)}`;
}

async function addSuggestion(c, button, body) {
  const label = button.dataset.label; // 'planned' or 'watched'
  const original = button.textContent;
  const buttons = $$('.explore-add, #explore-dislike', body);
  buttons.forEach((b) => (b.disabled = true));
  button.textContent = 'Adding…';
  try {
    await library.add({ type: c.type, tmdbId: c.tmdbId, from: 'explore', label });
    c.added = label;
    if (state.stats) state.stats.added++;
    openSuggestion(keyOf(c));
    renderResults();
    renderStats();
  } catch (err) {
    buttons.forEach((b) => (b.disabled = false));
    button.textContent = original;
    showMessage(err.message);
  }
}

const suggestionHandlers = {
  onClick(e) {
    const c = find(state.openKey);
    if (!c) return;
    if (e.target.closest('#explore-dislike')) return notInterested(state.openKey);
    const add = e.target.closest('.explore-add');
    if (add) addSuggestion(c, add, e.currentTarget);
  },
  onClose: () => (state.openKey = null),
};

function openSuggestion(key) {
  const c = find(key);
  if (!c) return;
  state.openKey = key;
  openDialog(suggestionHtml(c), suggestionHandlers);
}

// ---------- Setup ----------

export function initExplorePage() {
  // Your library changed (added, removed, relabeled): recompute suggestions the next time they're shown.
  library.onChange((reason) => {
    if (reason === 'load') return;
    state.stale = true;
    // Your first title changes everything here: if Explore is open and empty, refresh it straight away.
    if (state.libraryEmpty && !$('#explore-view').hidden) loadResults();
  });

  initServices(({ patch, error }) => {
    if (error) return showMessage(error.message);
    state.results.clear();
    loadResults();
    if ('region' in patch) library.load(); // Planned titles' streaming info is per country
  });

  $('.explore-types').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) changeTab(chip.dataset.type);
  });

  el.movieKind.addEventListener('change', () => changeTab(el.movieKind.value));

  el.genre.addEventListener('change', () => {
    setGenre(el.genre.value);
    loadResults();
  });

  el.grid.addEventListener('click', (e) => {
    const dismiss = e.target.closest('.dismiss');
    if (dismiss) return notInterested(dismiss.dataset.key);
    const target = e.target.closest('.card');
    if (target) openSuggestion(target.dataset.key);
  });

  el.stats.addEventListener('click', (e) => {
    if (e.target.id === 'show-hidden') showHiddenList();
  });
}
