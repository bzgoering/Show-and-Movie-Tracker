import { $, api, esc, poster, providerStrip, whereToWatch } from './common.js';
import { readRoute, setSubTab } from './route.js';
import './explore-page.js';
import { hasGenre, libraryGenres, sortItems } from './sort.js';
import { airedSeasons, currentEpisode, latestAired, progressForCurrent, progressSummary, statusOf } from './progress.js';

const LABEL_NAMES = { planned: 'Planned', watching: 'Watching', waiting: 'Waiting', watched: 'Watched' };
const LABELS_FOR = { movie: ['planned', 'watched'], tv: ['planned', 'watching', 'watched'] };

// The chosen sort is remembered in this browser between visits.
function savedSort() {
  try {
    const sort = localStorage.getItem('sort');
    return ['title', 'progress', 'release'].includes(sort) ? sort : 'title';
  } catch {
    return 'title';
  }
}

const LIBRARY_TABS = ['all', 'watching', 'waiting', 'planned', 'watched', 'movie', 'tv'];
const startTab = readRoute().view === 'library' && LIBRARY_TABS.includes(readRoute().sub) ? readRoute().sub : 'all';

const state = { items: [], filter: startTab, query: '', sort: savedSort(), genre: '', openId: null };

const grid = $('#grid');
const searchInput = $('#search-input');
const searchResults = $('#search-results');
const dialog = $('#detail');
const detailBody = $('#detail-body');

function showMessage(text) {
  const el = $('#message');
  el.textContent = text;
  el.hidden = !text;
}

function upsert(item) {
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i === -1) state.items.unshift(item);
  else state.items[i] = item;
  document.dispatchEvent(new CustomEvent('library:changed'));
}

document.addEventListener('library:reload', () => load());

// Titles added from the Explore page.
document.addEventListener('library:added', (e) => {
  upsert(e.detail);
  renderGrid();
});

// ---------- Library grid ----------

// Lowercase, drop accents and punctuation, so "pokemon" finds "Pokémon" and "spiderman" finds "Spider-Man".
const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');

function matchesFilter(item) {
  if (state.filter === 'all' && !hasGenre(item, state.genre)) return false;
  if (state.query && !normalize(item.title).includes(normalize(state.query))) return false;
  const f = state.filter;
  if (f === 'all') return true;
  if (f === 'movie' || f === 'tv') return item.type === f;
  return statusOf(item) === f;
}

// "2026-11-13" -> "Nov 13" (or "Nov 13, 2027" when it's not this year)
function fmtDate(iso, { monthOnly = false } = {}) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (monthOnly) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(iso) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${iso}T00:00:00`) - today) / DAY_MS);
}

// Short "when" for cards: Today, Tomorrow, a weekday within the next week, otherwise a date.
function shortWhen(iso) {
  const days = daysUntil(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
  return fmtDate(iso);
}

// Longer "when" for the detail view: "Friday, Nov 13 · in 7 days"
function longWhen(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const days = daysUntil(iso);
  const rel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 ? `in ${days} days` : '';
  return rel ? `${date} · ${rel}` : date;
}

// Tag + text shown under the poster, e.g. "Next episode · Fri" or "Full season · Mar 5".
function cardRelease(p) {
  if (!p) return null;
  if (p.kind === 'confirmed') {
    const tag = p.scope === 'episode' ? 'Next episode' : p.scope === 'part' ? 'Next part' : p.pattern === 'all-at-once' ? 'Full season' : 'New season';
    return { tag, text: shortWhen(p.date), soon: daysUntil(p.date) < 7 };
  }
  if (p.kind === 'estimated') return { tag: 'New season', text: p.overdue ? 'overdue' : `~${fmtDate(p.date, { monthOnly: true })}` };
  if (p.kind === 'ended') return { tag: '', text: 'Ended' };
  return null;
}

function cardMeta(item) {
  if (item.type === 'movie') return item.year ? `Movie · ${item.year}` : 'Movie';
  if (item.label === 'planned') return 'TV';
  return progressSummary(item);
}

function renderGrid() {
  // Sorting and the genre picker are offered on the All tab; the other tabs stay A-Z.
  renderGenreOptions();
  const items = sortItems(state.items.filter(matchesFilter), state.filter === 'all' ? state.sort : 'title');
  sortSelect.hidden = state.filter !== 'all';
  grid.innerHTML = items
    .map((item) => {
      // Release info only matters once you're caught up (Waiting) or done (Watched).
      let release = item.type === 'tv' && ['waiting', 'watched'].includes(statusOf(item)) ? cardRelease(item.prediction) : null;
      if (release && item.prediction.kind === 'ended' && progressSummary(item) === 'Finished') release = null; // card already says "Finished"
      return `
      <button class="card" data-id="${esc(item.id)}" title="${esc(item.title)}">
        <div class="poster">
          ${item.posterPath ? `<img src="${poster(item.posterPath)}" alt="" loading="lazy">` : `<div class="no-poster">${esc(item.title)}</div>`}
        </div>
        <div class="card-title">${esc(item.title)}</div>
        <div class="card-meta"><span class="label ${statusOf(item)}">${LABEL_NAMES[statusOf(item)]}</span> · ${esc(cardMeta(item))}</div>
        ${
          release
            ? `<div class="card-next${release.soon ? ' soon' : ''}">${release.tag ? `<span class="next-tag">${esc(release.tag)}</span> ` : ''}${esc(release.text)}</div>`
            : ''
        }
        ${
          // Planned titles show where you can watch them, like Explore does.
          statusOf(item) === 'planned' && item.cache?.providers ? `<div class="card-providers">${providerStrip(item.cache.providers)}</div>` : ''
        }
      </button>`;
    })
    .join('');
  $('#empty').hidden = items.length > 0;
  if (state.items.length > 0 && items.length === 0 && state.genre && !state.query) $('#empty').textContent = `Nothing in ${state.genre}.`;
  else if (state.items.length > 0 && items.length === 0 && state.query) $('#empty').textContent = `Nothing in your library matches "${state.query}".`;
  else if (state.items.length > 0 && items.length === 0) $('#empty').textContent = 'Nothing matches this filter.';
  else $('#empty').textContent = 'Nothing here yet. Search for a movie or show above to add it.';
}

const genreSelect = $('#genre-select');

// Fills the genre picker with the genres in your library. Hidden until titles have genres
// (they're saved on the next refresh) and on tabs other than All.
function renderGenreOptions() {
  const genres = libraryGenres(state.items);
  if (state.genre && !genres.some((g) => g.name === state.genre)) state.genre = '';
  genreSelect.innerHTML =
    '<option value="">All genres</option>' +
    genres.map((g) => `<option value="${esc(g.name)}">${esc(g.name)} (${g.count})</option>`).join('');
  genreSelect.value = state.genre;
  genreSelect.hidden = state.filter !== 'all' || genres.length === 0;
}

genreSelect.addEventListener('change', () => {
  state.genre = genreSelect.value;
  renderGrid();
});

const sortSelect = $('#sort-select');
sortSelect.value = state.sort;
sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  try {
    localStorage.setItem('sort', state.sort);
  } catch {
    // Storage blocked (private window): the choice just isn't remembered.
  }
  renderGrid();
});

const libraryChips = () => document.querySelectorAll('#library-view .filters .chip');

function setFilter(filter) {
  state.filter = filter;
  libraryChips().forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
  setSubTab('library', filter);
}

// Coming back to the Library (Back button, or a link) reopens the tab in the address.
window.addEventListener('hashchange', () => {
  const { view, sub } = readRoute();
  if (view !== 'library') return;
  const tab = LIBRARY_TABS.includes(sub) ? sub : 'all';
  if (tab !== state.filter) {
    setFilter(tab);
    renderGrid();
  }
});

// Library search looks through everything, so it switches to the All tab.
const librarySearch = $('#library-search');
librarySearch.addEventListener('input', () => {
  state.query = librarySearch.value.trim();
  if (state.query && state.filter !== 'all') setFilter('all');
  renderGrid();
});
librarySearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && librarySearch.value) {
    librarySearch.value = '';
    state.query = '';
    renderGrid();
  }
});

document.querySelector('.filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  setFilter(chip.dataset.filter);
  renderGrid();
});

grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openDetail(card.dataset.id);
});

// ---------- Search ----------

let searchTimer;
let searchSeq = 0;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) return hideResults();
  searchTimer = setTimeout(() => runSearch(q), 350);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideResults();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) hideResults();
});

function hideResults() {
  searchResults.hidden = true;
  searchResults.innerHTML = '';
}

async function runSearch(q) {
  const seq = ++searchSeq;
  searchResults.hidden = false;
  searchResults.innerHTML = '<li class="result-note">Searching…</li>';
  try {
    const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return; // a newer search has started
    if (results.length === 0) {
      searchResults.innerHTML = '<li class="result-note">No matches.</li>';
      return;
    }
    searchResults.innerHTML = results
      .slice(0, 10)
      .map(
        (r) => `
        <li class="result">
          ${r.posterPath ? `<img src="${poster(r.posterPath, 'w92')}" alt="">` : '<div class="thumb-empty"></div>'}
          <div class="result-text">
            <strong>${esc(r.title)}</strong>
            <span>${r.type === 'tv' ? 'TV show' : 'Movie'}${r.year ? ` · ${r.year}` : ''}</span>
          </div>
          ${
            r.inLibrary
              ? '<span class="in-library">Added</span>'
              : `<button class="add" data-type="${r.type}" data-id="${r.tmdbId}">Add</button>`
          }
        </li>`,
      )
      .join('');
  } catch (err) {
    if (seq === searchSeq) searchResults.innerHTML = `<li class="result-note error">${esc(err.message)}</li>`;
  }
}

searchResults.addEventListener('click', async (e) => {
  const btn = e.target.closest('.add');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    const item = await api('/api/library', { method: 'POST', body: { type: btn.dataset.type, tmdbId: Number(btn.dataset.id) } });
    upsert(item);
    renderGrid();
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'in-library', textContent: 'Added' }));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Add';
    showMessage(err.message);
  }
});

// ---------- Detail modal ----------

function openDetail(id) {
  state.openId = id;
  renderDetail();
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => {
  state.openId = null;
});

// Clicking the dark backdrop closes the modal.
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

// Episode choices for one season. The newest season also gets a "Caught up" choice at the end.
function episodeOptions(seasons, season, current, latest, ended = false) {
  const count = seasons.find((s) => s.season === season)?.episodeCount || 0;
  const opts = [];
  for (let ep = 1; ep <= count; ep++) {
    opts.push(`<option value="${ep}"${current && ep === current.episode ? ' selected' : ''}>Episode ${ep}</option>`);
  }
  if (latest && season === latest.season) {
    opts.push(`<option value="done"${current ? '' : ' selected'}>${ended ? '✓ Finished' : '✓ Caught up'}</option>`);
  }
  return opts.join('');
}

const PATTERN_NOTES = {
  weekly: 'New episodes come out weekly.',
  'all-at-once': 'This show releases whole seasons at once.',
  parts: 'This show releases seasons in parts.',
};

// The "What's next" box in the detail view.
function nextBox(p) {
  let main = '';
  let when = '';
  const notes = [];

  if (p.kind === 'confirmed') {
    when = longWhen(p.date);
    if (p.scope === 'episode') {
      main = `S${p.season} E${p.episode}${p.episodeName ? ` · ${p.episodeName}` : ''}`;
      if (p.pattern === 'weekly') notes.push(PATTERN_NOTES.weekly);
      if (p.finale) notes.push(`Season finale (E${p.finale.episode}) on ${fmtDate(p.finale.airDate)}.`);
    } else if (p.scope === 'part') {
      main = `Season ${p.season}, next part (from E${p.episode})`;
      notes.push(PATTERN_NOTES.parts);
    } else if (p.pattern === 'all-at-once') {
      main = `Season ${p.season} · all ${p.episodeCount ? `${p.episodeCount} ` : ''}episodes at once`;
      notes.push(PATTERN_NOTES['all-at-once']);
    } else {
      main = `Season ${p.season} premiere`;
      if (p.pattern === 'weekly') notes.push('After the premiere, new episodes come out weekly.');
      else if (p.pattern === 'parts') notes.push(PATTERN_NOTES.parts);
    }
  } else if (p.kind === 'estimated') {
    main = `Season ${p.season}`;
    when = p.overdue
      ? `Expected around ${fmtDate(p.date, { monthOnly: true })}, but not announced yet`
      : `Around ${fmtDate(p.date, { monthOnly: true })} (estimate)`;
    if (p.basis) notes.push(`${p.basis}.`);
    if (PATTERN_NOTES[p.pattern]) notes.push(`Last season: ${PATTERN_NOTES[p.pattern].charAt(0).toLowerCase()}${PATTERN_NOTES[p.pattern].slice(1)}`);
  } else if (p.kind === 'ended') {
    main = p.label?.includes('you') ? 'You marked this series as finished' : `This series has ${p.label?.includes('canceled') ? 'been canceled' : 'ended'}`;
  } else {
    main = 'No new episodes announced';
  }

  const heading = p.kind === 'estimated' ? 'Next season (estimate)' : p.heading || "What's next";
  return `
    <div class="next-box ${esc(p.kind || 'unknown')}">
      <div class="next-tag">${esc(heading)}</div>
      <div class="next-main">${esc(main)}</div>
      ${when ? `<div class="next-when">${esc(when)}</div>` : ''}
      ${notes.length ? `<p class="muted small">${esc(notes.join(' '))}</p>` : ''}
    </div>`;
}

function tvSection(item) {
  const c = item.cache || {};
  const seasons = airedSeasons(c);
  const latest = latestAired(c);
  const current = currentEpisode(item);
  const shownSeason = current ? current.season : latest?.season;
  const pred = item.prediction || {};
  const atLatest = current && latest && current.season === latest.season && current.episode === latest.episode;
  const ended = pred.kind === 'ended';
  // On the final episode of a finished show (or caught up on one that's still labeled Watching/Planned): offer "Done".
  const showDone = ended && latest && (atLatest || (!current && item.label !== 'watched'));

  const seasonLabel = (s) =>
    s.totalEpisodes && s.totalEpisodes > s.episodeCount ? `${s.name} (${s.episodeCount} of ${s.totalEpisodes} out)` : `${s.name} (${s.episodeCount})`;

  const pickers = seasons.length
    ? `
      <div class="row">
        <label>Season
          <select id="season-select">
            ${seasons.map((s) => `<option value="${s.season}"${s.season === shownSeason ? ' selected' : ''}>${esc(seasonLabel(s))}</option>`).join('')}
          </select>
        </label>
        <label>Episode you're on
          <select id="episode-select">${episodeOptions(seasons, shownSeason, current, latest, ended)}</select>
        </label>
      </div>
      <div class="row buttons">
        ${
          showDone
            ? `<button id="done-btn" class="primary">Done</button><span class="muted small">Marks the last episode watched and moves this show to Watched</span>`
            : current
              ? `<button id="next-ep" class="primary">Mark S${current.season} E${current.episode} as watched</button>`
              : ended
                ? '<span id="next-ep" class="caught-up">✓ Finished</span>'
                : `<span id="next-ep" class="caught-up">✓ Caught up${statusOf(item) === 'waiting' ? '<span class="muted small"> · shown under Waiting until new episodes come out</span>' : ''}</span>`
        }
        ${current && !atLatest ? `<button id="latest-ep">Jump to latest (S${latest.season} E${latest.episode})</button>` : ''}
      </div>`
    : '<p class="muted small">No episodes have aired yet.</p>';

  return `
    <section class="detail-section">
      <h3>Your progress</h3>
      ${seasons.length ? `<p class="muted"><strong>${esc(progressSummary(item))}</strong></p>` : ''}
      ${pickers}
    </section>

    <section class="detail-section">
      <h3>What's next</h3>
      ${nextBox(pred)}
      <p class="muted small">TMDB status: ${esc(c.status || 'unknown')} · ${c.numberOfSeasons || 0} season${c.numberOfSeasons === 1 ? '' : 's'}, ${c.numberOfEpisodes || 0} episodes</p>
      ${
        // Only offer the toggle when TMDB still thinks the show is ongoing.
        ['Ended', 'Canceled'].includes(c.status)
          ? ''
          : `<label class="check"><input type="checkbox" id="ended-toggle" ${item.userMarkedEnded ? 'checked' : ''}> This series has ended</label>`
      }
    </section>`;
}

function renderDetail() {
  const item = state.items.find((i) => i.id === state.openId);
  if (!item) return dialog.open && dialog.close();

  const c = item.cache || {};
  const facts =
    item.type === 'movie'
      ? [c.releaseDate && `Released ${c.releaseDate}`, c.runtime && `${c.runtime} min`, c.status !== 'Released' && c.status].filter(Boolean)
      : [item.year && `First aired ${item.year}`];

  detailBody.innerHTML = `
    <div class="detail-head">
      ${item.posterPath ? `<img class="detail-poster" src="${poster(item.posterPath, 'w342')}" alt="">` : ''}
      <div>
        <h2>${esc(item.title)}</h2>
        <p class="muted">${item.type === 'tv' ? 'TV show' : 'Movie'}${facts.length ? ' · ' + esc(facts.join(' · ')) : ''}</p>
        <div class="label-picker" role="group" aria-label="Label">
          ${LABELS_FOR[item.type]
            .map((l) => `<button class="label-btn ${l}${item.label === l ? ' active' : ''}" data-label="${l}">${LABEL_NAMES[l]}</button>`)
            .join('')}
        </div>
        ${item.overview ? `<p class="overview">${esc(item.overview)}</p>` : ''}
      </div>
    </div>
    ${statusOf(item) === 'planned' && item.cache?.providers ? whereToWatch(item.cache.providers, item.cache.providers.region) : ''}
    ${item.type === 'tv' ? tvSection(item) : ''}
    <div class="detail-actions">
      <button id="refresh-btn">Refresh info</button>
      <button id="remove-btn" class="danger">Remove</button>
    </div>`;
}

async function save(patch) {
  const id = state.openId;
  try {
    const item = await api(`/api/library/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
    upsert(item);
    renderGrid();
    if (state.openId === id) renderDetail();
  } catch (err) {
    showMessage(err.message);
  }
}

function setProgress(item, progress) {
  const patch = { progress };
  // Starting a planned show moves it to Watching automatically.
  if (item.label === 'planned' && (progress.season > 1 || progress.episode > 0)) patch.label = 'watching';
  return save(patch);
}

detailBody.addEventListener('click', async (e) => {
  const item = state.items.find((i) => i.id === state.openId);
  if (!item) return;

  const labelBtn = e.target.closest('.label-btn');
  if (labelBtn) return save({ label: labelBtn.dataset.label });

  if (e.target.id === 'next-ep') {
    const current = currentEpisode(item);
    if (current) return setProgress(item, current); // finished this one, so it becomes the last watched
  }

  if (e.target.id === 'done-btn') {
    const latest = latestAired(item.cache);
    if (latest) return save({ progress: { season: latest.season, episode: latest.episode }, label: 'watched' });
  }

  if (e.target.id === 'latest-ep') {
    const latest = latestAired(item.cache);
    if (latest) return setProgress(item, progressForCurrent(latest.season, latest.episode));
  }

  if (e.target.id === 'refresh-btn') {
    e.target.disabled = true;
    e.target.textContent = 'Refreshing…';
    try {
      upsert(await api(`/api/library/${encodeURIComponent(item.id)}/refresh`, { method: 'POST' }));
      renderGrid();
      renderDetail();
    } catch (err) {
      showMessage(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Refresh info';
    }
  }

  if (e.target.id === 'remove-btn') {
    if (!confirm(`Remove "${item.title}" from your library?`)) return;
    try {
      await api(`/api/library/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      state.items = state.items.filter((i) => i.id !== item.id);
      document.dispatchEvent(new CustomEvent('library:changed'));
      dialog.close();
      renderGrid();
    } catch (err) {
      showMessage(err.message);
    }
  }
});

detailBody.addEventListener('change', (e) => {
  const item = state.items.find((i) => i.id === state.openId);
  if (!item) return;

  if (e.target.id === 'season-select') {
    // Picking a season puts you on its first episode.
    return setProgress(item, progressForCurrent(Number(e.target.value), 1));
  }
  if (e.target.id === 'episode-select') {
    const season = Number($('#season-select').value);
    if (e.target.value === 'done') {
      const latest = latestAired(item.cache);
      return setProgress(item, { season: latest.season, episode: latest.episode });
    }
    return setProgress(item, progressForCurrent(season, Number(e.target.value)));
  }
  if (e.target.id === 'ended-toggle') {
    return save({ userMarkedEnded: e.target.checked });
  }
});

// ---------- Start ----------

function showSync(sync) {
  const el = $('#sync-status');
  if (!sync) {
    el.textContent = '';
    return;
  }
  if (sync.failed && !sync.updated) {
    showMessage(`Couldn't update from TMDB (${sync.error}). Showing your saved info.`);
  } else if (sync.error && !sync.failed) {
    showMessage(`Search and updates are off: ${sync.error} See the README for setup.`);
  }
  const time = new Date(sync.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  el.textContent = sync.updated ? `Updated ${time}` : '';
}

async function load() {
  $('#sync-status').textContent = 'Updating…';
  grid.classList.add('loading');
  try {
    const { items, sync } = await api('/api/library');
    state.items = items;
    showMessage('');
    showSync(sync);
  } catch (err) {
    $('#sync-status').textContent = '';
    showMessage(`Could not load your library: ${err.message}`);
  }
  grid.classList.remove('loading');
  renderGrid();
}

load();
