import { formatProgress, nextEpisode, remainingCount } from './progress.js';

const IMG = 'https://image.tmdb.org/t/p/';
const LABEL_NAMES = { planned: 'Planned', watching: 'Watching', watched: 'Watched' };
const LABELS_FOR = { movie: ['planned', 'watched'], tv: ['planned', 'watching', 'watched'] };

const state = { items: [], filter: 'all', openId: null };

const $ = (sel) => document.querySelector(sel);
const grid = $('#grid');
const searchInput = $('#search-input');
const searchResults = $('#search-results');
const dialog = $('#detail');
const detailBody = $('#detail-body');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const poster = (path, size = 'w342') => (path ? `${IMG}${size}${path}` : '');

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showMessage(text) {
  const el = $('#message');
  el.textContent = text;
  el.hidden = !text;
}

function upsert(item) {
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i === -1) state.items.unshift(item);
  else state.items[i] = item;
}

// ---------- Library grid ----------

function matchesFilter(item) {
  const f = state.filter;
  if (f === 'all') return true;
  if (f === 'movie' || f === 'tv') return item.type === f;
  return item.label === f;
}

// "2026-11-13" -> "Nov 13" (or "Nov 13, 2027" when it's not this year)
function fmtDate(iso, { monthOnly = false } = {}) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (monthOnly) return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function releaseText(p) {
  if (!p) return '';
  if (p.kind === 'confirmed') return `S${p.season} E${p.episode} on ${fmtDate(p.date)}`;
  if (p.kind === 'estimated') return p.overdue ? `S${p.season} overdue` : `S${p.season} expected ${fmtDate(p.date, { monthOnly: true })}`;
  if (p.kind === 'ended') return 'Ended';
  return '';
}

function cardMeta(item) {
  if (item.type === 'movie') return item.year ? `Movie · ${item.year}` : 'Movie';
  if (item.label === 'planned') return 'TV';
  const parts = [formatProgress(item.progress)];
  const left = remainingCount(item);
  if (left > 0) parts.push(`${left} left`);
  return parts.join(' · ');
}

function renderGrid() {
  const items = state.items.filter(matchesFilter);
  grid.innerHTML = items
    .map((item) => {
      const release = item.type === 'tv' && item.label !== 'watched' ? releaseText(item.prediction) : '';
      return `
      <button class="card" data-id="${esc(item.id)}" title="${esc(item.title)}">
        <div class="poster">
          ${item.posterPath ? `<img src="${poster(item.posterPath)}" alt="" loading="lazy">` : `<div class="no-poster">${esc(item.title)}</div>`}
        </div>
        <div class="card-title">${esc(item.title)}</div>
        <div class="card-meta"><span class="label ${item.label}">${LABEL_NAMES[item.label]}</span> · ${esc(cardMeta(item))}</div>
        ${release ? `<div class="card-meta${item.prediction.kind === 'confirmed' ? ' soon' : ''}">${esc(release)}</div>` : ''}
      </button>`;
    })
    .join('');
  $('#empty').hidden = items.length > 0;
  if (state.items.length > 0 && items.length === 0) $('#empty').textContent = 'Nothing matches this filter.';
  else $('#empty').textContent = 'Nothing here yet. Search for a movie or show above to add it.';
}

document.querySelector('.filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.filter = chip.dataset.filter;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
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

function episodeOptions(seasons, season, selected) {
  const count = seasons.find((s) => s.season === season)?.episodeCount || 0;
  const opts = [`<option value="0"${selected === 0 ? ' selected' : ''}>—</option>`];
  for (let ep = 1; ep <= Math.max(count, selected); ep++) {
    opts.push(`<option value="${ep}"${ep === selected ? ' selected' : ''}>Episode ${ep}</option>`);
  }
  return opts.join('');
}

function releaseSentence(p) {
  if (p.kind === 'confirmed') return `Season ${p.season}, episode ${p.episode} comes out ${fmtDate(p.date)}.`;
  if (p.kind === 'estimated') {
    return p.overdue
      ? `Season ${p.season} was expected around ${fmtDate(p.date, { monthOnly: true })} but hasn't been announced.`
      : `Season ${p.season} will probably come out around ${fmtDate(p.date, { monthOnly: true })}.`;
  }
  if (p.kind === 'ended') return p.label.includes('you') ? 'You marked this series as finished.' : `This series has ${p.label.includes('canceled') ? 'been canceled' : 'ended'}.`;
  return 'No new episodes announced.';
}

function tvSection(item) {
  const c = item.cache || {};
  const seasons = c.seasons || [];
  const p = item.progress || { season: 1, episode: 0 };
  const next = nextEpisode(p, seasons);
  const left = remainingCount(item);
  const pred = item.prediction || {};

  return `
    <section class="detail-section">
      <h3>Your progress</h3>
      <p class="muted">Last watched: <strong>${esc(formatProgress(p))}</strong>${left > 0 ? ` · ${left} aired episode${left === 1 ? '' : 's'} left` : ' · All caught up'}</p>
      <div class="row">
        <label>Season
          <select id="season-select">
            ${seasons.map((s) => `<option value="${s.season}"${s.season === p.season ? ' selected' : ''}>${esc(s.name)} (${s.episodeCount})</option>`).join('')}
          </select>
        </label>
        <label>Episode
          <select id="episode-select">${episodeOptions(seasons, p.season, p.episode)}</select>
        </label>
      </div>
      <button id="next-ep" class="primary" ${next ? '' : 'disabled'}>
        ${next ? `Mark S${next.season} E${next.episode} as watched` : 'No more episodes yet'}
      </button>
    </section>

    <section class="detail-section">
      <h3>What's next</h3>
      <p>${esc(releaseSentence(pred))}</p>
      ${pred.basis ? `<p class="muted small">Estimated: ${esc(pred.basis.toLowerCase())}.</p>` : ''}
      <p class="muted small">TMDB status: ${esc(c.status || 'unknown')} · ${c.numberOfSeasons || 0} season${c.numberOfSeasons === 1 ? '' : 's'}, ${c.numberOfEpisodes || 0} episodes</p>
      <label class="check"><input type="checkbox" id="ended-toggle" ${item.userMarkedEnded ? 'checked' : ''}> This series has ended</label>
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
  if (item.label === 'planned' && progress.episode > 0) patch.label = 'watching';
  return save(patch);
}

detailBody.addEventListener('click', async (e) => {
  const item = state.items.find((i) => i.id === state.openId);
  if (!item) return;

  const labelBtn = e.target.closest('.label-btn');
  if (labelBtn) return save({ label: labelBtn.dataset.label });

  if (e.target.id === 'next-ep') {
    const next = nextEpisode(item.progress, item.cache?.seasons);
    if (next) return setProgress(item, next);
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
    // Picking a season starts you at episode 1 of it, unless it's the season you're already on.
    const season = Number(e.target.value);
    const episode = season === item.progress.season ? item.progress.episode : 1;
    return setProgress(item, { season, episode });
  }
  if (e.target.id === 'episode-select') {
    return setProgress(item, { season: item.progress.season, episode: Number(e.target.value) });
  }
  if (e.target.id === 'ended-toggle') {
    return save({ userMarkedEnded: e.target.checked });
  }
});

// ---------- Start ----------

async function load() {
  try {
    state.items = await api('/api/library');
    showMessage('');
  } catch (err) {
    showMessage(`Could not load your library: ${err.message}`);
  }
  renderGrid();
}

load();
