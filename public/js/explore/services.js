// Explore's "Streaming" panel: your country and the services you have. Saved on the server.
import { api } from '../lib/api.js';
import { $, esc } from '../lib/dom.js';
import { logo } from '../lib/images.js';

const COLLAPSED_COUNT = 24; // most popular services shown before "Show all"

const el = {
  button: $('#services-btn'),
  panel: $('#services-panel'),
  list: $('#services-list'),
  region: $('#region-select'),
  clear: $('#services-clear'),
};

let settings = null; // { region, services }
let providers = []; // services available in your country, most popular first
let regions = [];
let showAll = false;
let onSaved = () => {};

export const currentSettings = () => settings;

export async function loadSettings() {
  if (!settings) {
    settings = await api('/api/settings');
    renderButton();
  }
  return settings;
}

function renderButton() {
  const picked = settings?.services ?? [];
  const names = picked.map((id) => providers.find((p) => p.id === id)?.name).filter(Boolean);
  let label = 'All services';
  if (picked.length) label = names.length && names.length <= 2 ? names.join(', ') : `${picked.length} services`;
  el.button.textContent = `Streaming: ${label}`;
  el.button.setAttribute('aria-expanded', String(!el.panel.hidden));
}

function renderPanel() {
  el.region.innerHTML = regions.map((r) => `<option value="${r.code}">${esc(r.name)}</option>`).join('');
  el.region.value = settings.region;

  const picked = new Set(settings.services);
  // Picked services always show, even when the list is collapsed.
  const shown = showAll ? providers : providers.filter((p, i) => i < COLLAPSED_COUNT || picked.has(p.id));
  const toggle =
    providers.length > COLLAPSED_COUNT
      ? `<button type="button" id="services-more" class="link-btn">${showAll ? 'Show fewer' : `Show all ${providers.length}`}</button>`
      : '';
  el.list.innerHTML =
    shown
      .map(
        (p) => `
        <label class="service${picked.has(p.id) ? ' on' : ''}">
          <input type="checkbox" value="${p.id}"${picked.has(p.id) ? ' checked' : ''}>
          ${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}<span>${esc(p.name)}</span>
        </label>`,
      )
      .join('') + toggle;
}

async function loadServices() {
  el.list.innerHTML = '<p class="muted small">Loading services…</p>';
  try {
    [providers, regions] = await Promise.all([
      api(`/api/providers?region=${encodeURIComponent(settings.region)}`),
      regions.length ? regions : api('/api/regions'),
    ]);
    renderPanel();
    renderButton();
  } catch (err) {
    el.list.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
  }
}

async function save(patch) {
  try {
    settings = await api('/api/settings', { method: 'PUT', body: patch });
  } catch (err) {
    onSaved({ error: err });
    return;
  }
  renderButton();
  onSaved({ patch });
}

// onSettingsSaved({ patch }) runs after a change is saved, or ({ error }) if saving failed.
export function initServices(onSettingsSaved) {
  onSaved = onSettingsSaved;

  el.button.addEventListener('click', async () => {
    el.panel.hidden = !el.panel.hidden;
    el.button.classList.toggle('open', !el.panel.hidden);
    renderButton();
    if (!el.panel.hidden && !providers.length) await loadServices();
  });

  el.list.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    const services = new Set(settings.services);
    const id = Number(e.target.value);
    if (e.target.checked) services.add(id);
    else services.delete(id);
    e.target.closest('.service').classList.toggle('on', e.target.checked);
    save({ services: [...services] });
  });

  el.list.addEventListener('click', (e) => {
    if (e.target.id !== 'services-more') return;
    showAll = !showAll;
    renderPanel();
  });

  el.clear.addEventListener('click', async () => {
    await save({ services: [] });
    renderPanel();
  });

  // Services differ by country, so a new country starts with none picked.
  el.region.addEventListener('change', async () => {
    await save({ region: el.region.value, services: [] });
    providers = [];
    loadServices();
  });
}
