// The Account page: your stats. There's no sign-in: the library lives on this computer, so the
// account is really a place to see how much you've watched.
import { RATING_NAMES } from '../components/rating.js';
import { aboutDays, formatDuration } from '../lib/dates.js';
import { $, esc } from '../lib/dom.js';
import { library } from '../library/store.js';
import { libraryStats } from '../../shared/stats.js';

const MAX_GENRES = 8;
const view = $('#account-view');
const content = $('#account-content');

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const tile = (label, value, sub = '') => `
  <div class="stat-tile">
    <span class="stat-label">${esc(label)}</span>
    <span class="stat-value">${esc(value)}</span>
    ${sub ? `<span class="stat-sub">${esc(sub)}</span>` : ''}
  </div>`;

// Genres you've spent the most time with, as ranked bars (longest first, one colour).
function genreBars(genres) {
  if (!genres.length)
    return '<p class="muted small">Genres show up here once your titles have been refreshed from TMDB.</p>';
  const top = genres.slice(0, MAX_GENRES);
  const longest = top[0].minutes;
  const rows = top
    .map(({ name, minutes }) => {
      const time = formatDuration(minutes);
      const width = Math.max(2, (minutes / longest) * 100);
      return `
        <li title="${esc(`${name}: ${time}`)}">
          <span class="bar-name">${esc(name)}</span>
          <span class="bar-track"><span class="bar" style="width: ${width.toFixed(1)}%"></span></span>
          <span class="bar-value">${esc(time)}</span>
        </li>`;
    })
    .join('');
  return `<ol class="bar-list">${rows}</ol>
    <p class="muted small">A title counts toward each of its genres, so these add up to more than your total.</p>`;
}

function render() {
  if (!library.loaded()) {
    content.innerHTML = `<p class="empty">Adding it all up…</p>`;
    return;
  }
  const items = library.items();
  if (!items.length) {
    content.innerHTML = `<p class="empty">Add a show or movie to your library, and your stats will show up here.</p>`;
    return;
  }
  const s = libraryStats(items);
  const ratings = [3, 2, 1]
    .map((r) => tile(`${'★'.repeat(r)} ${RATING_NAMES[r]}`, s.ratings[r].toLocaleString()))
    .join('');

  content.innerHTML = `
    <section class="stat-tiles hero" aria-label="Time spent watching">
      ${tile('All time', formatDuration(s.totalMinutes), aboutDays(s.totalMinutes))}
      ${tile('Shows', formatDuration(s.shows.minutes), plural(s.shows.episodes, 'episode'))}
      ${tile('Movies', formatDuration(s.movies.minutes), `${plural(s.movies.watched, 'movie')} watched`)}
    </section>
    ${
      s.estimatedTitles
        ? `<p class="muted small">Includes typical lengths for ${plural(s.estimatedTitles, 'title')} TMDB doesn't list a runtime for.</p>`
        : ''
    }

    <h3 class="section-title">Your library</h3>
    <section class="stat-tiles">
      ${tile('Watching', s.library.watching.toLocaleString())}
      ${tile('Waiting', s.library.waiting.toLocaleString(), 'caught up, more coming')}
      ${tile('Planned', s.library.planned.toLocaleString())}
      ${tile('Watched', s.library.watched.toLocaleString())}
    </section>

    <h3 class="section-title">Your ratings</h3>
    <section class="stat-tiles ratings">${ratings}</section>

    <h3 class="section-title">Genres you've spent the most time with</h3>
    ${genreBars(s.genres)}`;
}

export const showAccount = render;

export function initAccountPage() {
  // Keep the numbers current as your library changes (only while the page is showing).
  library.onChange(() => {
    if (!view.hidden) render();
  });
}
