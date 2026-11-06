// Small helpers shared by the Library and Explore pages.

export const IMG = 'https://image.tmdb.org/t/p/';

export const $ = (sel) => document.querySelector(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const poster = (path, size = 'w342') => (path ? `${IMG}${size}${path}` : '');

export async function api(path, options = {}) {
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

// ---------- Where to watch (used by Explore and Planned titles) ----------

export const logo = (path) => (path ? `${IMG}w92${path}` : '');

// Compact service logos for a card. One service also shows its name.
export function providerStrip(providers) {
  const stream = providers?.stream || [];
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
  if (providers?.rent?.length || providers?.buy?.length) return '<span class="muted">Rent or buy</span>';
  return '<span class="muted">Not streaming in your country</span>';
}

export function providerChips(list) {
  return list
    .map((p) => `<span class="provider">${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}${esc(p.name)}</span>`)
    .join('');
}

// The "Where to watch" section of a details view.
export function whereToWatch(providers, region) {
  const w = providers || { stream: [], rent: [], buy: [] };
  const rows = [
    w.stream?.length ? `<p class="where-label">Stream</p><div class="providers">${providerChips(w.stream)}</div>` : '',
    w.rent?.length ? `<p class="where-label">Rent</p><div class="providers">${providerChips(w.rent)}</div>` : '',
    w.buy?.length ? `<p class="where-label">Buy</p><div class="providers">${providerChips(w.buy)}</div>` : '',
  ].join('');
  return `
    <section class="detail-section">
      <h3>Where to watch${region ? ` in ${esc(region)}` : ''}</h3>
      ${rows || '<p class="muted">Not available to stream, rent or buy in your country right now.</p>'}
      ${w.link ? `<p class="small"><a href="${esc(w.link)}" target="_blank" rel="noopener">See all options</a></p>` : ''}
    </section>`;
}
