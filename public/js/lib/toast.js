// A short message at the bottom of the screen, optionally with an Undo button.
import { $, esc } from './dom.js';

const el = $('#toast');
let timer;

export function toast(text, onUndo) {
  el.innerHTML = `<span>${esc(text)}</span>${onUndo ? '<button type="button" class="link-btn">Undo</button>' : ''}`;
  el.hidden = false;
  el.querySelector('button')?.addEventListener('click', () => {
    el.hidden = true;
    onUndo();
  });
  clearTimeout(timer);
  timer = setTimeout(() => (el.hidden = true), 7000);
}
