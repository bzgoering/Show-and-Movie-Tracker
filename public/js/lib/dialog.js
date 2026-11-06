// The one details pop-up, shared by the Library and Explore pages. Whoever opens it owns it until it
// closes: clicks and changes inside it go to that owner's handlers only.
import { $ } from './dom.js';

const dialog = $('#detail');
const body = $('#detail-body');
let owner = null;

// Opens the pop-up with this content (or replaces what's in it). handlers: { onClick, onChange, onClose }.
export function openDialog(html, handlers = {}) {
  if (owner && owner !== handlers) owner.onClose?.();
  owner = handlers;
  body.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}

// Replaces the content while keeping the same owner (e.g. after saving a change).
export function updateDialog(html) {
  body.innerHTML = html;
}

export const closeDialog = () => dialog.open && dialog.close();
export const dialogBody = () => body;

body.addEventListener('click', (e) => owner?.onClick?.(e));
body.addEventListener('change', (e) => owner?.onChange?.(e));
dialog.addEventListener('close', () => {
  const closing = owner;
  owner = null;
  closing?.onClose?.();
});
// Clicking the dark backdrop closes it.
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});
