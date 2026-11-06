// The Explore page: suggestions based on your library, filtered to your streaming services.
import { $, api, esc, poster } from './common.js';

const ex = {
  type: 'all',
  results: new Map(), // type -> items
  stale: false, // your library changed since these were loaded
  settings: null, // { region, services }
  providers: [], // services available in your country
  regions: [],
  showAllServices: false,
  openKey: null,
};

const views = { library: $('#library-view'), explore: $('#explore-view') };
const exploreGrid = $('#explore-grid');
const servicesPanel = $('#services-panel');
const servicesBtn = $('#services-btn');
const dialog = $('#detail');
const detailBody = $('#detail-body');

const keyOf = (c) => `${c.type}-${c.tmdbId}`;
const logo = (path) => (path ? `https://image.tmdb.org/t/p/w92${path}` : '');

function showExploreMessage(text) {
  const el = $('#explore-message');
  el.textContent = text;
  el.hidden = !text;
}

// ---------- Switching between Library and Explore ----------

document.querySelector('.views').addEventListener('click', (e) => {
  const tab = e.target.closest('.view-tab');
  if (!tab) return;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== tab.dataset.view;
  document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t === tab));
  if (tab.dataset.view === 'explore') openExplore();
});

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
    const { items } = await api(`/api/explore?type=${type}`);
    ex.results.set(type, items);
  } catch (err) {
    showExploreMessage(`Couldn't load suggestions: ${err.message}`);
  } finally {
    $('#explore-loading').hidden = true;
  }
  if (type === ex.type) renderResults();
}

function providerStrip(c) {
  const stream = c.providers?.stream || [];
  if (stream.length === 1) {
    const p = stream[0];
    return `${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}<span>${esc(p.name)}</span>`;
  }
  if (stream.length) {
    const shown = stream.slice(0, 4);
    const more = stream.length - shown.length;
    return (
      shown
        .map((p) => (p.logoPath ? `<img src="${logo(p.logoPath)}" alt="${esc(p.name)}" title="${esc(p.name)}">` : `<span>${esc(p.name)}</span>`))
        .join('') + (more > 0 ? `<span class="more">+${more}</span>` : '')
    );
  }
  if (c.providers?.rent?.length || c.providers?.buy?.length) return '<span class="muted">Rent or buy</span>';
  return '<span class="muted">Not streaming in your country</span>';
}

function renderResults() {
  const items = ex.results.get(ex.type) || [];
  exploreGrid.innerHTML = items
    .map(
      (c) => `
      <button class="card" data-key="${esc(keyOf(c))}" title="${esc(c.title)}">
        <div class="poster"><img src="${poster(c.posterPath)}" alt="" loading="lazy"></div>
        <div class="card-title">${esc(c.title)}</div>
        <div class="card-meta"><span class="match">${c.match}% match</span> · ${c.type === 'tv' ? 'TV' : 'Movie'}${c.year ? ` · ${c.year}` : ''}</div>
        <div class="card-providers">${providerStrip(c)}</div>
      </button>`,
    )
    .join('');
  const empty = $('#explore-empty');
  empty.hidden = items.length > 0 || !$('#explore-message').hidden;
  empty.textContent = ex.settings?.services.length
    ? 'Nothing found on your streaming services. Try adding more services, or more titles to your library.'
    : 'No suggestions yet. Add a few movies or shows to your library first.';
}

document.querySelector('.explore-types').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  ex.type = chip.dataset.type;
  document.querySelectorAll('.explore-types .chip').forEach((c) => c.classList.toggle('active', c === chip));
  dropIfStale();
  loadResults();
});

exploreGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openSuggestion(card.dataset.key);
});

// ---------- Suggestion detail ----------

function findSuggestion(key) {
  for (const list of ex.results.values()) {
    const found = list.find((c) => keyOf(c) === key);
    if (found) return found;
  }
  return null;
}

function providerChips(list) {
  return list
    .map((p) => `<span class="provider">${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}${esc(p.name)}</span>`)
    .join('');
}

function openSuggestion(key) {
  const c = findSuggestion(key);
  if (!c) return;
  ex.openKey = key;
  const w = c.providers || { stream: [], rent: [], buy: [] };
  const where = [
    w.stream.length ? `<p class="where-label">Stream</p><div class="providers">${providerChips(w.stream)}</div>` : '',
    w.rent.length ? `<p class="where-label">Rent</p><div class="providers">${providerChips(w.rent)}</div>` : '',
    w.buy.length ? `<p class="where-label">Buy</p><div class="providers">${providerChips(w.buy)}</div>` : '',
  ].join('');

  detailBody.innerHTML = `
    <div class="detail-head">
      <img class="detail-poster" src="${poster(c.posterPath)}" alt="">
      <div>
        <h2>${esc(c.title)}</h2>
        <p class="muted">${c.type === 'tv' ? 'TV show' : 'Movie'}${c.year ? ` · ${c.year}` : ''} · <span class="match">${c.match}% match</span></p>
        <p class="muted small">${esc(c.reason)}</p>
        <div class="row buttons">
          ${c.added ? '<span class="caught-up">✓ In your library</span>' : '<button id="explore-add" class="primary">Add to library</button>'}
        </div>
        ${c.overview ? `<p class="overview">${esc(c.overview)}</p>` : ''}
      </div>
    </div>
    <section class="detail-section">
      <h3>Where to watch in ${esc(ex.settings?.region || '')}</h3>
      ${where || '<p class="muted">Not available to stream, rent or buy in your country right now.</p>'}
      ${w.link ? `<p class="small"><a href="${esc(w.link)}" target="_blank" rel="noopener">See all options</a></p>` : ''}
    </section>`;
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('close', () => {
  ex.openKey = null;
});

detailBody.addEventListener('click', async (e) => {
  if (e.target.id !== 'explore-add' || !ex.openKey) return;
  const c = findSuggestion(ex.openKey);
  e.target.disabled = true;
  e.target.textContent = 'Adding…';
  try {
    const item = await api('/api/library', { method: 'POST', body: { type: c.type, tmdbId: c.tmdbId } });
    document.dispatchEvent(new CustomEvent('library:added', { detail: item }));
    c.added = true;
    openSuggestion(ex.openKey);
    exploreGrid.querySelector(`[data-key="${CSS.escape(keyOf(c))}"]`)?.classList.add('added');
  } catch (err) {
    e.target.disabled = false;
    e.target.textContent = 'Add to library';
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
  ex.providers = [];
  loadServices();
});
