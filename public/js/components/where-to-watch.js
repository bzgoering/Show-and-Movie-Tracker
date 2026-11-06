// Where a title streams: the compact logo strip on cards, and the "Where to watch" section in details.
// Used by Explore suggestions and Planned titles.
import { esc } from '../lib/dom.js';
import { logo } from '../lib/images.js';

const MAX_LOGOS = 4;

// Compact service logos for a card. A single service also shows its name.
export function providerStrip(providers) {
  const stream = providers?.stream ?? [];
  if (stream.length === 1) {
    const [p] = stream;
    return `${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}<span>${esc(p.name)}</span>`;
  }
  if (stream.length) {
    const more = stream.length - MAX_LOGOS;
    const logos = stream
      .slice(0, MAX_LOGOS)
      .map((p) =>
        p.logoPath
          ? `<img src="${logo(p.logoPath)}" alt="${esc(p.name)}" title="${esc(p.name)}">`
          : `<span>${esc(p.name)}</span>`,
      )
      .join('');
    return logos + (more > 0 ? `<span class="more">+${more}</span>` : '');
  }
  if (providers?.rent?.length || providers?.buy?.length) return '<span class="muted">Rent or buy</span>';
  return '<span class="muted">Not streaming in your country</span>';
}

const chips = (list) =>
  list
    .map(
      (p) =>
        `<span class="provider">${p.logoPath ? `<img src="${logo(p.logoPath)}" alt="">` : ''}${esc(p.name)}</span>`,
    )
    .join('');

// The "Where to watch" section of a details view.
export function whereToWatch(providers, region) {
  const { stream = [], rent = [], buy = [], link = null } = providers ?? {};
  const rows = [
    ['Stream', stream],
    ['Rent', rent],
    ['Buy', buy],
  ]
    .filter(([, list]) => list.length)
    .map(([label, list]) => `<p class="where-label">${label}</p><div class="providers">${chips(list)}</div>`)
    .join('');
  return `
    <section class="detail-section">
      <h3>Where to watch${region ? ` in ${esc(region)}` : ''}</h3>
      ${rows || '<p class="muted">Not available to stream, rent or buy in your country right now.</p>'}
      ${link ? `<p class="small"><a href="${esc(link)}" target="_blank" rel="noopener">See all options</a></p>` : ''}
    </section>`;
}
