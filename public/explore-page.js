// The Explore page: suggestions based on your library, filtered to your streaming services.
import { $, api, esc, logo, poster, providerStrip, whereToWatch } from './common.js';
import { goToView, readRoute, setSubTab } from './route.js';

const ex = {
  type: 'all',
  results: new Map(), // type -> items
  stale: false, // your library changed since these were loaded
  settings: null, // { region, services }
  providers: [], // services available in your country
  regions: [],
  showAllServices: false,
  openKey: null,
  stats: null, // { added, disliked, hitRate, tuned }
  hiddenCount: 0,
};

const views = { library: $('#library-view'), explore: $('#explore-view') };
const exploreGrid = $('#explore-grid');
const servicesPanel = $('#services-panel');
const servicesBtn = $('#services-btn');
const dialog = $('#detail');
const detailBody = $('#detail-body');

const keyOf = (c) => `${c.type}-${c.tmdbId}`;

function showExploreMessage(text) {
  const el = $('#explore-message');
  el.textContent = text;
  el.hidden = !text;
}

// ---------- Switching between Library and Explore ----------

// The page and tab you're on are kept in the address (see route.js).
const EXPLORE_TABS = ['all', 'movie', 'tv-live', 'tv-animated'];

function showView(view) {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'explore') {
    const { sub } = readRoute();
    setExploreType(EXPLORE_TABS.includes(sub) ? sub : 'all');
    openExplore();
  }
}

document.querySelector('.views').addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (!tab || readRoute().view === tab.dataset.view) return;
  goToView(tab.dataset.view);
});

window.addEventListener('hashchange', () => showView(readRoute().view));

// Your library changed (added, removed, relabeled): recompute suggestions the next time they're opened.
document.addEventListener('library:changed', () => {
  ex.stale = true;
});

function dropIfStale() {
  if (!ex.stale) return;
  ex.results.clear();
  ex.stale = false;
}

async function openExplore() {
  if (!ex.settings) {
    try {
      ex.settings = await api('/api/settings');
      renderServicesButton();
    } catch (err) {
      showExploreMessage(err.message);
      return;
    }
  }
  dropIfStale();
  loadResults();
}

// ---------- Results ----------

async function loadResults() {
  const type = ex.type;
  if (ex.results.has(type)) return renderResults();
  exploreGrid.innerHTML = '';
  $('#explore-empty').hidden = true;
  $('#explore-loading').hidden = false;
  showExploreMessage('');
  try {
    const { items, stats, hidden } = await api(`/api/explore?type=${type}`);
    ex.results.set(type, items);
    ex.stats = stats;
    ex.hiddenCount = hidden;
    renderStats();
  } catch (err) {
    showExploreMessage(`Couldn't load suggestions: ${err.message}`);
  } finally {
    $('#explore-loading').hidden = true;
  }
  if (type === ex.type) renderResults();
}

function renderResults() {
  const items = ex.results.get(ex.type) || [];
  exploreGrid.innerHTML = items
    .map(
      (c) => `
      <div class="explore-item${c.added ? ' added' : ''}">
        <button class="card" data-key="${esc(keyOf(c))}" title="${esc(c.title)}">
          <div class="poster"><img src="${poster(c.posterPath)}" alt="" loading="lazy"></div>
          <div class="card-title">${esc(c.title)}</div>
          <div class="card-meta"><span class="match">${c.match}% match</span> · ${c.type === 'tv' ? 'TV' : 'Movie'}${c.year ? ` · ${c.year}` : ''}</div>
          <div class="card-providers">${providerStrip(c.providers)}</div>
        </button>
        ${c.added ? '' : `<button class="dismiss" data-key="${esc(keyOf(c))}" title="Not interested" aria-label="Not interested in ${esc(c.title)}">✕</button>`}
      </div>`,
    )
    .join('');
  const empty = $('#explore-empty');
  empty.hidden = items.length > 0 || !$('#explore-message').hidden;
  empty.textContent = ex.settings?.services.length
    ? 'Nothing found on your streaming services. Try adding more services, or more titles to your library.'
    : 'No suggestions yet. Add a few movies or shows to your library first.';
}

function setExploreType(type) {
  ex.type = type;
  document.querySelectorAll('.explore-types .chip').forEach((c) => c.classList.toggle('active', c.dataset.type === type));
}

document.querySelector('.explore-types').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  setExploreType(chip.dataset.type);
  setSubTab('explore', ex.type);
  dropIfStale();
  loadResults();
});

exploreGrid.addEventListener('click', (e) => {
  const dismiss = e.target.closest('.dismiss');
  if (dismiss) return notInterested(dismiss.dataset.key);
  const card = e.target.closest('.card');
  if (card) openSuggestion(card.dataset.key);
});

// ---------- Not interested ----------

async function notInterested(key) {
  const c = findSuggestion(key);
  if (!c) return;
  try {
    await api('/api/explore/dislikes', { method: 'POST', body: { type: c.type, tmdbId: c.tmdbId } });
  } catch (err) {
    showExploreMessage(err.message);
    return;
  }
  for (const [t, list] of ex.results) ex.results.set(t, list.filter((x) => keyOf(x) !== key));
  if (ex.openKey === key && dialog.open) dialog.close();
  ex.hiddenCount++;
  if (ex.stats) ex.stats.disliked++;
  renderResults();
  renderStats();
  toast(`Hidden "${c.title}". Explore will suggest less like it.`, () => unhide(key));
}

async function unhide(key) {
  try {
    await api(`/api/explore/dislikes/${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch (err) {
    showExploreMessage(err.message);
    return;
  }
  ex.results.clear(); // scores change when a dislike goes away
  loadResults();
}

let toastTimer;
function toast(text, onUndo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${onUndo ? '<button type="button" class="link-btn">Undo</button>' : ''}`;
  el.hidden = false;
  el.querySelector('button')?.addEventListener('click', () => {
    el.hidden = true;
    onUndo();
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 7000);
}

// "Your picks" line: how often you add what Explore suggests, plus the hidden list.
function renderStats() {
  const el = $('#explore-stats');
  const s = ex.stats;
  const parts = [];
  if (s && s.added + s.disliked > 0) {
    parts.push(`Your picks: ${s.added} added, ${s.disliked} not interested`);
    // A percentage means little until you've acted on a few suggestions.
    if (s.added + s.disliked >= 3) parts.push(`${Math.round((s.added / (s.added + s.disliked)) * 100)}% hit rate`);
    if (s.tuned) parts.push('tuned to your picks');
  }
  if (ex.hiddenCount) parts.push(`<button type="button" id="show-hidden" class="link-btn">${ex.hiddenCount} hidden</button>`);
  el.innerHTML = parts.join(' · ');
  el.hidden = parts.length === 0;
}

$('#explore-stats').addEventListener('click', async (e) => {
  if (e.target.id !== 'show-hidden') return;
  let list = [];
  try {
    list = await api('/api/explore/dislikes');
  } catch (err) {
    showExploreMessage(err.message);
    return;
  }
  ex.openKey = null;
  detailBody.innerHTML = `
    <h2>Hidden from Explore</h2>
    <p class="muted small">Titles you marked "Not interested". Explore won't suggest them, and suggests a little less like them.</p>
    <ul class="hidden-list">
      ${list
        .map(
          (d) => `
        <li>
          ${d.posterPath ? `<img src="${poster(d.posterPath, 'w92')}" alt="">` : '<span class="thumb-empty"></span>'}
          <span class="hidden-title">${esc(d.title)}<span class="muted small"> · ${d.type === 'tv' ? 'TV' : 'Movie'}</span></span>
          <button type="button" class="unhide" data-key="${esc(`${d.type}-${d.tmdbId}`)}">Show again</button>
        </li>`,
        )
        .join('')}
    </ul>`;
  if (!dialog.open) dialog.showModal();
});

// ---------- Suggestion detail ----------

function findSuggestion(key) {
  for (const list of ex.results.values()) {
    const found = list.find((c) => keyOf(c) === key);
    if (found) return found;
  }
  return null;
}

function openSuggestion(key) {
  const c = findSuggestion(key);
  if (!c) return;
  ex.openKey = key;
  detailBody.innerHTML = `
    <div class="detail-head">
      <img class="detail-poster" src="${poster(c.posterPath)}" alt="">
      <div>
        <h2>${esc(c.title)}</h2>
        <p class="muted">${c.type === 'tv' ? 'TV show' : 'Movie'}${c.year ? ` · ${c.year}` : ''} · <span class="match">${c.match}% match</span></p>
        <p class="muted small">${esc(c.reason)}</p>
        <div class="row buttons">
          ${
            c.added
              ? `<span class="caught-up">✓ In your library as ${c.added === 'watched' ? 'Watched' : 'Planned'}</span>`
              : `<button class="primary explore-add" data-label="planned">Add to Planned</button>
                 <button class="secondary explore-add" data-label="watched">Watched</button>
                 <button id="explore-dislike" class="secondary">Not interested</button>`
          }
        </div>
        ${c.overview ? `<p class="overview">${esc(c.overview)}</p>` : ''}
      </div>
    </div>
    ${whereToWatch(c.providers, ex.settings?.region)}`;
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => {
  ex.openKey = null;
});

detailBody.addEventListener('click', async (e) => {
  const unhideBtn = e.target.closest('.unhide');
  if (unhideBtn) {
    unhideBtn.closest('li').remove();
    ex.hiddenCount = Math.max(0, ex.hiddenCount - 1);
    renderStats();
    return unhide(unhideBtn.dataset.key);
  }
  if (e.target.id === 'explore-dislike' && ex.openKey) return notInterested(ex.openKey);
  const addBtn = e.target.closest('.explore-add');
  if (!addBtn || !ex.openKey) return;
  const c = findSuggestion(ex.openKey);
  const label = addBtn.dataset.label; // 'planned' or 'watched'
  const original = addBtn.textContent;
  detailBody.querySelectorAll('.explore-add, #explore-dislike').forEach((b) => (b.disabled = true));
  addBtn.textContent = 'Adding…';
  try {
    const item = await api('/api/library', { method: 'POST', body: { type: c.type, tmdbId: c.tmdbId, from: 'explore', label } });
    document.dispatchEvent(new CustomEvent('library:added', { detail: item }));
    c.added = label;
    if (ex.stats) ex.stats.added++;
    openSuggestion(ex.openKey);
    renderResults();
    renderStats();
  } catch (err) {
    detailBody.querySelectorAll('.explore-add, #explore-dislike').forEach((b) => (b.disabled = false));
    addBtn.textContent = original;
    showExploreMessage(err.message);
  }
});

// ---------- Streaming services ----------

function renderServicesButton() {
  const picked = ex.settings?.services || [];
  let label = 'All services';
  if (picked.length) {
    const names = picked.map((id) => ex.providers.find((p) => p.id === id)?.name).filter(Boolean);
    label = names.length && names.length <= 2 ? names.join(', ') : `${picked.length} services`;
  }
  servicesBtn.textContent = `Streaming: ${label}`;
}

servicesBtn.addEventListener('click', async () => {
  servicesPanel.hidden = !servicesPanel.hidden;
  servicesBtn.classList.toggle('open', !servicesPanel.hidden);
  if (!servicesPanel.hidden && !ex.providers.length) await loadServices();
});

async function loadServices() {
  $('#services-list').innerHTML = '<p class="muted small">Loading services…</p>';
  try {
    const [providers, regions] = await Promise.all([api(`/api/providers?region=${ex.settings.region}`), ex.regions.length ? ex.regions : api('/api/regions')]);
    ex.providers = providers;
    ex.regions = regions;
    renderServices();
    renderServicesButton();
  } catch (err) {
    $('#services-list').innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
  }
}

function renderServices() {
  const regionSelect = $('#region-select');
  regionSelect.innerHTML = ex.regions.map((r) => `<option value="${r.code}">${esc(r.name)}</option>`).join('');
  regionSelect.value = ex.settings.region;

  const picked = new Set(ex.settings.services);
  // Popular services first; picked ones always show even when the list is collapsed.
  const list = ex.showAllServices ? ex.providers : ex.providers.filter((p, i) => i < 24 || picked.has(p.id));
  $('#services-list').innerHTML =
    list
      .map(
        (p) => `
        <label class="service${picked.has(p.id) ? ' on' : ''}">
          <input type="checkbox" value="${p.id}" ${picked.has(p.id) ? 'checked' : ''}>
          ${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}<span>${esc(p.name)}</span>
        </label>`,
      )
      .join('') +
    (ex.providers.length > 24
      ? `<button type="button" id="services-more" class="link-btn">${ex.showAllServices ? 'Show fewer' : `Show all ${ex.providers.length}`}</button>`
      : '');
}

async function saveSettings(patch) {
  try {
    ex.settings = await api('/api/settings', { method: 'PUT', body: patch });
    ex.results.clear();
    renderServicesButton();
    loadResults();
  } catch (err) {
    showExploreMessage(err.message);
  }
}

$('#services-list').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const id = Number(e.target.value);
  const services = new Set(ex.settings.services);
  if (e.target.checked) services.add(id);
  else services.delete(id);
  e.target.closest('.service').classList.toggle('on', e.target.checked);
  saveSettings({ services: [...services] });
});

$('#services-list').addEventListener('click', (e) => {
  if (e.target.id !== 'services-more') return;
  ex.showAllServices = !ex.showAllServices;
  renderServices();
});

$('#services-clear').addEventListener('click', () => {
  saveSettings({ services: [] }).then(renderServices);
});

$('#region-select').addEventListener('change', async (e) => {
  // Services differ by country, so start fresh in the new one.
  await saveSettings({ region: e.target.value, services: [] });
  document.dispatchEvent(new CustomEvent('library:reload')); // Planned titles' streaming info is per country
  ex.providers = [];
  loadServices();
});

// Open whichever page the address points to (e.g. after a refresh).
showView(readRoute().view);
