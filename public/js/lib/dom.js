// Tiny DOM helpers.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Escapes text for safe use inside HTML templates (all page HTML is built with template strings).
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

// Marks which button in a group is selected: highlighted, and announced as pressed by screen readers.
export function setSelected(buttons, isSelected) {
  for (const button of buttons) {
    const on = isSelected(button);
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
  }
}

// Shows a message in an element, or hides the element when the text is empty.
export function showText(el, text) {
  el.textContent = text;
  el.hidden = !text;
}
