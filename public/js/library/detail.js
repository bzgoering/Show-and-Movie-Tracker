// A library title's details: label, episode progress, what's next, and where it streams.
import { whereToWatch } from '../components/where-to-watch.js';
import { closeDialog, openDialog, updateDialog } from '../lib/dialog.js';
import { $, esc, showText } from '../lib/dom.js';
import { poster } from '../lib/images.js';
import { LABELS_FOR, isEndedStatus } from '../../shared/media.js';
import {
  airedSeasons,
  currentEpisode,
  latestAired,
  progressForCurrent,
  progressSummary,
  statusOf,
} from '../../shared/progress.js';
import { LABEL_NAMES } from './labels.js';
import { nextBox } from './release.js';
import { library } from './store.js';

let openId = null;

const showError = (err) => showText($('#message'), err.message);

// Episode choices for one season. The newest season also gets a "Caught up" (or "Finished") choice.
function episodeOptions(seasons, season, current, latest, ended) {
  const count = seasons.find((s) => s.season === season)?.episodeCount ?? 0;
  const options = Array.from(
    { length: count },
    (_, i) => `<option value="${i + 1}"${current?.episode === i + 1 ? ' selected' : ''}>Episode ${i + 1}</option>`,
  );
  if (latest && season === latest.season) {
    options.push(`<option value="done"${current ? '' : ' selected'}>${ended ? '✓ Finished' : '✓ Caught up'}</option>`);
  }
  return options.join('');
}

const seasonLabel = (s) =>
  s.totalEpisodes > s.episodeCount
    ? `${s.name} (${s.episodeCount} of ${s.totalEpisodes} out)`
    : `${s.name} (${s.episodeCount})`;

// The main progress button: mark the episode you're on as watched, "Done" on the final episode of a
// finished show, or a note when you're caught up.
function progressButtons(item, { current, latest, ended }) {
  const atLatest = current && latest && current.season === latest.season && current.episode === latest.episode;
  const showDone = ended && latest && (atLatest || (!current && item.label !== 'watched'));
  let main;
  if (showDone) {
    main =
      '<button type="button" id="done-btn" class="btn primary">Done</button>' +
      '<span class="muted small">Marks the last episode watched and moves this show to Watched</span>';
  } else if (current) {
    main = `<button type="button" id="next-ep" class="btn primary">Mark S${current.season} E${current.episode} as watched</button>`;
  } else if (ended) {
    main = '<span id="next-ep" class="caught-up">✓ Finished</span>';
  } else {
    const waiting =
      statusOf(item) === 'waiting'
        ? '<span class="muted small"> · shown under Waiting until new episodes come out</span>'
        : '';
    main = `<span id="next-ep" class="caught-up">✓ Caught up${waiting}</span>`;
  }
  const jump =
    current && !atLatest
      ? `<button type="button" id="latest-ep" class="btn">Jump to latest (S${latest.season} E${latest.episode})</button>`
      : '';
  return `<div class="row buttons">${main}${jump}</div>`;
}

function showSections(item) {
  const c = item.cache ?? {};
  const seasons = airedSeasons(c);
  const latest = latestAired(c);
  const current = currentEpisode(item);
  const prediction = item.prediction ?? {};
  const ended = prediction.kind === 'ended';
  const shownSeason = current ? current.season : latest?.season;

  const progress = seasons.length
    ? `
      <p class="muted"><strong>${esc(progressSummary(item))}</strong></p>
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
      ${progressButtons(item, { current, latest, ended })}`
    : '<p class="muted small">No episodes have aired yet.</p>';

  const seasonCount = c.numberOfSeasons ?? 0;
  return `
    <section class="detail-section">
      <h3>Your progress</h3>
      ${progress}
    </section>
    <section class="detail-section">
      <h3>What's next</h3>
      ${nextBox(prediction)}
      <p class="muted small">TMDB status: ${esc(c.status || 'unknown')} · ${seasonCount} season${seasonCount === 1 ? '' : 's'}, ${c.numberOfEpisodes ?? 0} episodes</p>
      ${
        // Only offer this while TMDB still thinks the show is ongoing.
        isEndedStatus(c.status)
          ? ''
          : `<label class="check"><input type="checkbox" id="ended-toggle"${item.userMarkedEnded ? ' checked' : ''}> This series has ended</label>`
      }
    </section>`;
}

function render(item) {
  const c = item.cache ?? {};
  const facts =
    item.type === 'movie'
      ? [
          c.releaseDate && `Released ${c.releaseDate}`,
          c.runtime && `${c.runtime} min`,
          c.status !== 'Released' && c.status,
        ]
      : [item.year && `First aired ${item.year}`];
  const factText = facts.filter(Boolean).join(' · ');
  const labels = LABELS_FOR[item.type]
    .map(
      (l) =>
        `<button type="button" class="label-btn ${l}${item.label === l ? ' active' : ''}" data-label="${l}" aria-pressed="${item.label === l}">${LABEL_NAMES[l]}</button>`,
    )
    .join('');

  return `
    <div class="detail-head">
      ${item.posterPath ? `<img class="detail-poster" src="${poster(item.posterPath)}" alt="">` : ''}
      <div>
        <h2 id="detail-title">${esc(item.title)}</h2>
        <p class="muted">${item.type === 'tv' ? 'TV show' : 'Movie'}${factText ? ` · ${esc(factText)}` : ''}</p>
        <div class="label-picker" role="group" aria-label="Label">${labels}</div>
        ${item.overview ? `<p class="overview">${esc(item.overview)}</p>` : ''}
      </div>
    </div>
    ${statusOf(item) === 'planned' && c.providers ? whereToWatch(c.providers, c.providers.region) : ''}
    ${item.type === 'tv' ? showSections(item) : ''}
    <div class="detail-actions">
      <button type="button" id="refresh-btn" class="btn">Refresh info</button>
      <button type="button" id="remove-btn" class="btn danger">Remove</button>
    </div>`;
}

const save = (item, changes) => library.update(item.id, changes).catch(showError);

// Saving progress on a Planned show means you've started it, so it moves to Watching.
function setProgress(item, progress) {
  const started = progress.season > 1 || progress.episode > 0;
  return save(item, item.label === 'planned' && started ? { progress, label: 'watching' } : { progress });
}

async function onClick(e) {
  const item = library.find(openId);
  if (!item) return;
  const target = e.target.closest('button');
  if (!target) return;

  if (target.classList.contains('label-btn')) return save(item, { label: target.dataset.label });

  const latest = latestAired(item.cache);
  switch (target.id) {
    case 'next-ep': {
      const current = currentEpisode(item);
      return current && setProgress(item, current); // finished this one, so it becomes the last watched
    }
    case 'done-btn':
      return latest && save(item, { progress: latest, label: 'watched' });
    case 'latest-ep':
      return latest && setProgress(item, progressForCurrent(latest.season, latest.episode));
    case 'refresh-btn':
      target.disabled = true;
      target.textContent = 'Refreshing…';
      try {
        await library.refresh(item.id);
      } catch (err) {
        showError(err);
        target.disabled = false;
        target.textContent = 'Refresh info';
      }
      return;
    case 'remove-btn':
      if (!confirm(`Remove "${item.title}" from your library?`)) return;
      try {
        await library.remove(item.id);
        closeDialog();
      } catch (err) {
        showError(err);
      }
  }
}

function onChange(e) {
  const item = library.find(openId);
  if (!item) return;
  const { id, value, checked } = e.target;
  if (id === 'season-select') return setProgress(item, progressForCurrent(Number(value), 1)); // on its first episode
  if (id === 'episode-select') {
    if (value === 'done') return setProgress(item, latestAired(item.cache));
    return setProgress(item, progressForCurrent(Number($('#season-select').value), Number(value)));
  }
  if (id === 'ended-toggle') return save(item, { userMarkedEnded: checked });
}

const handlers = { onClick, onChange, onClose: () => (openId = null) };

export function openDetail(id) {
  const item = library.find(id);
  if (!item) return;
  openId = id;
  openDialog(render(item), handlers);
}

// Keep the open details in step with the library (after saving a change, a refresh, or removal).
library.onChange(() => {
  if (!openId) return;
  const item = library.find(openId);
  if (item) updateDialog(render(item));
  else closeDialog();
});
