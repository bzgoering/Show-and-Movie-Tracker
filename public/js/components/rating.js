// Your 3-star rating of a title: Meh, Good, Great. Everything in your library is something you liked,
// so Meh isn't a dislike, just "not as much as the others".
import { esc } from '../lib/dom.js';

export const RATING_NAMES = { 1: 'Meh', 2: 'Good', 3: 'Great' };
const RATINGS = [1, 2, 3];
const stars = (n) => '★'.repeat(n);

// The "Your rating" row in a title's details: three stars you can click any time.
export function ratingRow(rating) {
  const buttons = RATINGS.map(
    (r) =>
      `<button type="button" class="star${rating >= r ? ' on' : ''}" data-rating="${r}" title="${RATING_NAMES[r]}"` +
      ` aria-label="${RATING_NAMES[r]}, ${r} of 3 stars" aria-pressed="${rating === r}">★</button>`,
  ).join('');
  return `
    <div class="rating-row">
      <span class="rating-label">Your rating</span>
      <div class="stars" role="group" aria-label="Your rating">${buttons}</div>
      <span class="rating-word">${rating ? RATING_NAMES[rating] : 'Not rated'}</span>
      ${rating ? '<button type="button" class="link-btn clear-rating">Clear</button>' : ''}
    </div>`;
}

// The prompt shown when you've just finished (or marked as seen) something you haven't rated.
export function ratingPrompt(title, { lead = `You finished ${title}.` } = {}) {
  const options = RATINGS.map(
    (r) =>
      `<button type="button" class="btn rate-option" data-rating="${r}">` +
      `<span class="rate-stars" aria-hidden="true">${stars(r)}</span> ${RATING_NAMES[r]}</button>`,
  ).join('');
  return `
    <div class="rate-prompt" role="group" aria-label="Rate ${esc(title)}">
      <p><strong>${esc(lead)}</strong> How was it?</p>
      <div class="rate-options">${options}</div>
      <p class="muted small">
        Everything in your library is something you liked, so Meh just means less than the others.
        <button type="button" class="link-btn rate-later">Not now</button>
      </p>
    </div>`;
}

// Stars in the corner of a poster, for rated titles.
export const ratingBadge = (rating) =>
  rating
    ? `<span class="card-rating" title="Rated ${RATING_NAMES[rating]}" aria-label="Rated ${RATING_NAMES[rating]}">${stars(rating)}</span>`
    : '';
