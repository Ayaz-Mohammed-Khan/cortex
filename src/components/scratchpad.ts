/**
 * Scratchpad island — the per-note "your notes" textarea.
 *
 * Enhances the markup rendered by `NoteContent.astro`:
 *
 *   <section data-scratchpad data-route="/notes/...">
 *     <textarea data-scratchpad-input></textarea>
 *     <span data-scratchpad-status></span>
 *   </section>
 *
 * Behaviour:
 *   - On load (and every `astro:page-load`) the textarea is filled from the
 *     saved scratchpad for this note's route, and its height is fit to content.
 *   - Typing autosaves after a short debounce; the status line reflects
 *     "Saving…" → "Saved" so the reader trusts their words are kept.
 *   - A cross-tab edit (another tab of the same note) refreshes the textarea
 *     when it is not focused, so tabs stay consistent without clobbering typing.
 *
 * Follows the project island pattern: listeners are bound once on `document`
 * and the sync runs on `astro:page-load`, so it survives View Transitions. All
 * state lives in the shared store (`@/lib/scratchpad`); nothing leaves the tab.
 */

import { getScratch, setScratch, onScratchChange } from '@/lib/scratchpad';

const WRAP = '[data-scratchpad]';
const SAVE_DEBOUNCE_MS = 450;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;

/** The current page's scratchpad wrapper, if the page has one. */
function wrap(): HTMLElement | null {
  return document.querySelector<HTMLElement>(WRAP);
}

/** Grow the textarea to fit its content (no inner scrollbar until very long). */
function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 600) + 'px';
}

/** Set the status label text (and style via a data attribute). */
function setStatus(el: HTMLElement | null, state: 'idle' | 'saving' | 'saved'): void {
  if (!el) return;
  el.dataset.state = state;
  el.textContent = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : '';
}

/** Load saved text into the textarea and size it. Does not steal focus. */
function sync(): void {
  const w = wrap();
  if (!w) return;
  const route = w.dataset.route;
  const ta = w.querySelector<HTMLTextAreaElement>('[data-scratchpad-input]');
  if (!route || !ta) return;
  // Don't overwrite what the reader is actively typing.
  if (document.activeElement === ta) return;
  const saved = getScratch(route);
  if (ta.value !== saved) ta.value = saved;
  autosize(ta);
  setStatus(w.querySelector<HTMLElement>('[data-scratchpad-status]'), 'idle');
}

/** Handle input: autosize immediately, debounce the save, update status. */
function onInput(event: Event): void {
  const ta = (event.target as Element | null)?.closest<HTMLTextAreaElement>(
    '[data-scratchpad-input]',
  );
  if (!ta) return;
  const w = ta.closest<HTMLElement>(WRAP);
  const route = w?.dataset.route;
  if (!route) return;

  autosize(ta);
  const status = w?.querySelector<HTMLElement>('[data-scratchpad-status]') ?? null;
  setStatus(status, 'saving');

  if (saveTimer) clearTimeout(saveTimer);
  const value = ta.value;
  saveTimer = setTimeout(() => {
    setScratch(route, value);
    setStatus(status, 'saved');
    // Fade the "Saved" label back to idle after a moment.
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => setStatus(status, 'idle'), 1600);
  }, SAVE_DEBOUNCE_MS);
}

// --- bind once (survives View Transitions) ---
if (typeof document !== 'undefined') {
  document.addEventListener('input', onInput);
  document.addEventListener('astro:page-load', sync);
  // A change from another tab: refresh when we're not mid-edit.
  onScratchChange(() => {
    const ta = wrap()?.querySelector<HTMLTextAreaElement>('[data-scratchpad-input]');
    if (ta && document.activeElement !== ta) sync();
  });
  // First load (astro:page-load may have already fired before this ran).
  sync();
}
