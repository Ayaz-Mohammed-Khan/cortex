/**
 * Note-page progress island (option B2).
 *
 * Wires the "Mark as complete" button under a note's title to the shared
 * {@link module:lib/progress progress store}. The button mirrors the roadmap
 * modal's "Mark done" control: a ghost green outline by default that fills
 * solid green with a tick once the note is complete. This island reflects any
 * completion saved on a previous visit, writes the reader's toggle back to the
 * store, and keeps the control in sync if the same note is completed elsewhere
 * (e.g. the roadmap modal) while the page is open.
 *
 * Follows the project island pattern: a listener bound once on `document`,
 * re-synced on `astro:page-load` so it survives View Transitions.
 */
import { isDone, toggleDone, onChange } from '@/lib/progress';

const WRAP = '[data-note-progress]';
const DONE_LABEL = 'Completed';
const TODO_LABEL = 'Mark as complete';

const TICK_SVG =
  '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
  '<path d="M2 6 l2.5 2.5 L10 3" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Reflect the store's state onto the button + label for the current note. */
function sync(): void {
  const wrap = document.querySelector<HTMLElement>(WRAP);
  if (!wrap) return;
  const route = wrap.dataset.route;
  const btn = wrap.querySelector<HTMLButtonElement>('[data-note-progress-input]');
  const label = wrap.querySelector<HTMLElement>('[data-note-progress-label]');
  const icon = wrap.querySelector<HTMLElement>('[data-note-progress-icon]');
  if (!route || !btn) return;
  const done = isDone(route);
  btn.classList.toggle('is-done', done);
  btn.setAttribute('aria-pressed', String(done));
  if (label) label.textContent = done ? DONE_LABEL : TODO_LABEL;
  if (icon) icon.innerHTML = done ? TICK_SVG : '';
}

/** Toggle the store when the reader clicks the button. */
function onClickEvent(event: MouseEvent): void {
  const btn = (event.target as Element | null)?.closest<HTMLButtonElement>(
    '[data-note-progress-input]',
  );
  if (!btn) return;
  const route = btn.closest<HTMLElement>(WRAP)?.dataset.route;
  if (!route) return;
  toggleDone(route); // write; `sync` (via onChange) reflects it back
}

let unsubscribe: (() => void) | null = null;

function bind(): void {
  sync();
  // Resubscribe fresh each page-load so we never stack listeners.
  unsubscribe?.();
  unsubscribe = onChange(sync);
}

document.addEventListener('click', onClickEvent);
document.addEventListener('astro:page-load', bind);
bind();

export {};
