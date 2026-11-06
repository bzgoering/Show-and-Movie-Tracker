// TMDB image URLs, and a fallback for images that fail to load.
import { esc } from './dom.js';

const IMG = 'https://image.tmdb.org/t/p/';

export const poster = (path, size = 'w342') => (path ? `${IMG}${size}${path}` : '');
export const logo = (path) => (path ? `${IMG}w92${path}` : '');

// If TMDB can't serve an image (removed poster, slow connection), replace the browser's broken-image
// icon with something that keeps the layout: the title for posters, a grey box for small thumbnails,
// and the service name for logos.
export function installImageFallback() {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      const posterBox = img.closest('.poster');
      if (posterBox) {
        const title = img.closest('.card')?.querySelector('.card-title')?.textContent ?? '';
        posterBox.innerHTML = `<div class="no-poster">${esc(title)}</div>`;
      } else if (img.closest('.result, .hidden-list')) {
        img.replaceWith(Object.assign(document.createElement('span'), { className: 'thumb-empty' }));
      } else if (img.alt) {
        img.replaceWith(Object.assign(document.createElement('span'), { textContent: img.alt }));
      } else {
        img.remove();
      }
    },
    true, // image errors don't bubble, so listen while the event travels down
  );
}
