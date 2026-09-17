/**
 * Reading-progress bar island (Tier 3).
 *
 * Manages the thin fixed bar rendered by `Layout.astro` as
 * `<div data-reading-progress aria-hidden="true">` at the very top of the
 * viewport. The bar's inner fill grows left→right as the reader scrolls the
 * page from top to bottom.
 *
 * Interaction model: a single set of passive `scroll`/`resize` listeners is
 * bound to `window` exactly once (the `window` object survives Astro View
 * Transitions, so there is no rebinding and no double-binding). The bar element
 * is re-resolved on every `astro:page-load` (the swapped `<body>` carries a
 * fresh element) and the fill is recomputed then so it reflects the new page
 * immediately.
 *
 * Progress is `scrollTop / (scrollHeight - clientHeight)` clamped to 0..1. On
 * pages too short to scroll (denominator ≤ 0) the fill collapses to 0 so the
 * bar is effectively invisible. `prefers-reduced-motion` disables the fill's
 * width transition (handled in CSS via a `data-reading-progress` attribute); the
 * fill value itself still updates, just without animation.
 */

/** The decorative bar container rendered in `Layout.astro`. */
let bar: HTMLElement | null = null;
/** The inner fill whose width tracks scroll progress. */
let fill: HTMLElement | null = null;

/** Re-resolve the bar + fill for the current document (idempotent). */
function resolveElements(): void {
  bar = document.querySelector<HTMLElement>('[data-reading-progress]');
  if (!bar) {
    fill = null;
    return;
  }
  // Lazily create the single inner fill element the first time we see a bar.
  fill = bar.querySelector<HTMLElement>('[data-reading-progress-fill]');
  if (!fill) {
    fill = document.createElement('div');
    fill.setAttribute('data-reading-progress-fill', '');
    bar.appendChild(fill);
  }
}

/** Compute the 0..1 scroll fraction and paint the fill's width. */
function update(): void {
  if (!fill) return;
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - doc.clientHeight;
  const fraction = scrollable > 0 ? doc.scrollTop / scrollable : 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  fill.style.width = `${clamped * 100}%`;
}

// Bind passive listeners once; `window` persists across View Transitions.
window.addEventListener('scroll', update, { passive: true });
window.addEventListener('resize', update, { passive: true });

// Re-resolve + repaint on each client-side navigation and on first load.
document.addEventListener('astro:page-load', () => {
  resolveElements();
  update();
});

// Initial resolve/paint for the very first paint of this island.
resolveElements();
update();
