// The details pop-up for a search result. A title already in your library opens its normal Library
// details; anything else shows what TMDB knows (loaded from the server) with buttons to add it.
import { whereToWatch } from '../components/where-to-watch.js';
import { api } from '../lib/api.js';
import { openDialog } from '../lib/dialog.js';
import { $, $$, esc } from '../lib/dom.js';
import { formatDate, formatDuration } from '../lib/dates.js';
import { poster } from '../lib/images.js';
import { openDetail } from '../library/detail.js';
import { library } from '../library/store.js';
import { libraryId, mediaKey } from '../../shared/media.js';

let openKey = null; // the result whose pop-up is open, so a slow load for an older one is ignored
let openData = null; // what the server sent for it (null while loading or after an error)

const typeName = (type) => (type === 'tv' ? 'TV show' : 'Movie');

// The line under the title: type, then the facts that fit that kind of title.
function facts(t) {
  const parts = [typeName(t.type)];
  if (t.type === 'movie') {
    if (t.releaseDate) parts.push(`Released ${formatDate(t.releaseDate)}`);
    else if (t.year) parts.push(String(t.year));
    if (t.runtime) parts.push(formatDuration(t.runtime));
    if (t.status && t.status !== 'Released') parts.push(t.status);
  } else {
    if (t.year) parts.push(`First aired ${t.year}`);
    const seasons = `${t.numberOfSeasons} season${t.numberOfSeasons === 1 ? '' : 's'}`;
    parts.push(`${seasons}, ${t.numberOfEpisodes} episode${t.numberOfEpisodes === 1 ? '' : 's'}`);
    if (t.status) parts.push(`TMDB status: ${t.status}`);
  }
  return parts.join(' · ');
}

const head = (t, inner) => `
  <div class="detail-head">
    ${t.posterPath ? `<img class="detail-poster" src="${poster(t.posterPath)}" alt="">` : ''}
    <div>
      <h2 id="detail-title">${esc(t.title)}</h2>
      ${inner}
    </div>
  </div>`;

// Shown straight away from the search result, while the rest loads.
const loadingHtml = (r) =>
  head(
    r,
    `<p class="muted">${esc(typeName(r.type))}${r.year ? ` · ${esc(r.year)}` : ''}</p>
     <p class="muted" role="status">Loading details…</p>`,
  );

const errorHtml = (r, message) =>
  head(
    r,
    `<p class="muted">${esc(typeName(r.type))}${r.year ? ` · ${esc(r.year)}` : ''}</p>
     <p class="detail-error" role="alert">Couldn't load details: ${esc(message)}</p>`,
  );

function loadedHtml(t) {
  // The browser's copy of your library can lag behind the server, so don't offer to add what's already there.
  const actions = t.inLibrary
    ? '<div class="row buttons"><span class="caught-up">✓ Already in your library</span></div>'
    : `<div class="row buttons">
         <button type="button" class="btn primary search-add" data-label="planned">Add to Planned</button>
         <button type="button" class="btn search-add" data-label="watched">Watched</button>
       </div>`;
  return (
    head(
      t,
      `<p class="muted">${esc(facts(t))}</p>
       ${t.genres.length ? `<p class="muted small">${esc(t.genres.join(', '))}</p>` : ''}
       ${actions}
       <p class="detail-error" role="alert" hidden></p>
       ${t.overview ? `<p class="overview">${esc(t.overview)}</p>` : ''}`,
    ) + whereToWatch(t.providers, t.region)
  );
}

async function addTitle(button, body) {
  const t = openData;
  const label = button.dataset.label; // 'planned' or 'watched'
  const original = button.textContent;
  const buttons = $$('.search-add', body);
  buttons.forEach((b) => (b.disabled = true));
  button.textContent = 'Adding…';
  try {
    const item = await library.add({ type: t.type, tmdbId: t.tmdbId, label });
    // Now it's yours: carry on in the normal details, where you can rate and track it.
    openDetail(item.id);
  } catch (err) {
    buttons.forEach((b) => (b.disabled = false));
    button.textContent = original;
    const message = $('.detail-error', body);
    message.textContent = err.message;
    message.hidden = false;
  }
}

const handlers = {
  onClick(e) {
    const add = e.target.closest('.search-add');
    if (add && openData) addTitle(add, e.currentTarget);
  },
  onClose() {
    openKey = null;
    openData = null;
  },
};

// Opens details for a search result: { type, tmdbId, title, year, posterPath, overview, inLibrary }.
export async function openSearchResult(result) {
  const id = libraryId(result.type, result.tmdbId);
  // Ask the browser's own copy of your library, so a title added a moment ago counts too.
  if (library.find(id)) return openDetail(id);

  const key = mediaKey(result.type, result.tmdbId);
  openKey = key;
  openData = null;
  openDialog(loadingHtml(result), handlers);
  try {
    const data = await api(`/api/titles/${encodeURIComponent(result.type)}/${encodeURIComponent(result.tmdbId)}`);
    if (openKey !== key) return; // closed, or another title was opened meanwhile
    // Added from somewhere else while this was loading: go straight to its Library details.
    if (library.find(id)) return openDetail(id);
    openData = data;
    openDialog(loadedHtml(data), handlers);
  } catch (err) {
    if (openKey === key) openDialog(errorHtml(result, err.message), handlers);
  }
}
