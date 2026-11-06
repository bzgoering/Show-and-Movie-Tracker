// Wording for "what's next" on a show, from the prediction the server sends with each show.
import { esc } from '../lib/dom.js';
import { daysUntil, formatDate, longWhen, shortWhen } from '../lib/dates.js';

const PATTERN_NOTES = {
  weekly: 'New episodes come out weekly.',
  'all-at-once': 'This show releases whole seasons at once.',
  parts: 'This show releases seasons in parts.',
};

const HEADINGS = {
  episode: 'Next episode',
  part: 'Next part',
  season: 'Next season',
};

// Tag and text under a poster, e.g. "NEXT EPISODE Fri" or "FULL SEASON Mar 5". Null when there's nothing to say.
export function cardRelease(p) {
  if (!p) return null;
  if (p.kind === 'confirmed') {
    const tag = p.scope === 'season' ? (p.pattern === 'all-at-once' ? 'Full season' : 'New season') : HEADINGS[p.scope];
    return { tag, text: shortWhen(p.date), soon: daysUntil(p.date) < 7 };
  }
  if (p.kind === 'estimated') {
    return { tag: 'New season', text: p.overdue ? 'overdue' : `~${formatDate(p.date, { monthOnly: true })}` };
  }
  if (p.kind === 'ended') return { tag: '', text: 'Ended' };
  return null;
}

function confirmedText(p) {
  if (p.scope === 'episode') {
    const notes = [p.pattern === 'weekly' && PATTERN_NOTES.weekly];
    if (p.finale) notes.push(`Season finale (E${p.finale.episode}) on ${formatDate(p.finale.airDate)}.`);
    return { main: `S${p.season} E${p.episode}${p.episodeName ? ` · ${p.episodeName}` : ''}`, notes };
  }
  if (p.scope === 'part')
    return { main: `Season ${p.season}, next part (from E${p.episode})`, notes: [PATTERN_NOTES.parts] };
  if (p.pattern === 'all-at-once') {
    const count = p.episodeCount ? `${p.episodeCount} ` : '';
    return { main: `Season ${p.season} · all ${count}episodes at once`, notes: [PATTERN_NOTES['all-at-once']] };
  }
  const after = { weekly: 'After the premiere, new episodes come out weekly.', parts: PATTERN_NOTES.parts };
  return { main: `Season ${p.season} premiere`, notes: [after[p.pattern]] };
}

function nextText(p) {
  if (p.kind === 'confirmed') return { heading: HEADINGS[p.scope], when: longWhen(p.date), ...confirmedText(p) };
  if (p.kind === 'estimated') {
    const month = formatDate(p.date, { monthOnly: true });
    const last = PATTERN_NOTES[p.pattern];
    return {
      heading: 'Next season (estimate)',
      main: `Season ${p.season}`,
      when: p.overdue ? `Expected around ${month}, but not announced yet` : `Around ${month} (estimate)`,
      notes: [
        p.gapMonths && `Seasons have premiered about every ${p.gapMonths} month${p.gapMonths === 1 ? '' : 's'}.`,
        last && `Last season: ${last.charAt(0).toLowerCase()}${last.slice(1)}`,
      ],
    };
  }
  if (p.kind === 'ended') {
    const main =
      p.endedBy === 'user'
        ? 'You marked this series as finished'
        : `This series has ${p.status === 'Canceled' ? 'been canceled' : 'ended'}`;
    return { heading: 'Series ended', main };
  }
  return { heading: 'Next season', main: 'No new episodes announced' };
}

// The "What's next" box in a show's details.
export function nextBox(p = {}) {
  const { heading, main, when, notes = [] } = nextText(p);
  const note = notes.filter(Boolean).join(' ');
  return `
    <div class="next-box ${esc(p.kind ?? 'unknown')}">
      <div class="next-tag">${esc(heading)}</div>
      <div class="next-main">${esc(main)}</div>
      ${when ? `<div class="next-when">${esc(when)}</div>` : ''}
      ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    </div>`;
}
