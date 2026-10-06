/**
 * Back-to-top island.
 *
 * Shows a small floating button, bottom-right, only AFTER the reader has
 * scrolled past ~1.5 viewport heights — so it never clutters short pages or the
 * initial view, and earns its place only on long notes where returning to the
 * top (or the table of contents) is real friction, especially on mobile where
 * there is no keyboard Home key.
 *
 * The button itself is rendered by `Layout.astro` as:
 *   <button data-back-to-top aria-label="Back to top" hidden>…</button>
 *
 * Clicking scrolls smoothly to the top (respecting reduced-motion). Visibility
 * is toggled with a `.is-visible` class so CSS owns the fade/slide; the `hidden`
 * attribute is removed once so the element can transition.
 *
 * Project island pattern: a single passive scroll listener bound once on
 * `window` (which survives View Transitions), with the button re-resolved and
 * re-evaluated on every `astro:page-load`.
 */

const SELECTOR = '[data-back-to-top]';
const SHOW_AFTER_VH = 1.5; // show once scrolled past 1.5 screenfuls

let btn: HTMLButtonElement | null = null;
let ticking = false;

/** Re-resolve the button for the current page and wire its click once. */
function resolve(): void {
  btn = document.querySelector<HTMLButtonElement>(SELECTOR);
  if (btn && btn.dataset.bound !== 'true') {
    btn.dataset.bound = 'true';
    btn.hidden = false; // allow CSS transitions; visibility is class-driven
    btn.addEventListener('click', scrollToTop);
  }
  evaluate();
}

/** Show/hide based on current scroll depth. */
function evaluate(): void {
  if (!btn) return;
  const past = window.scrollY > window.innerHeight * SHOW_AFTER_VH;
  btn.classList.toggle('is-visible', past);
}

/** rAF-throttled scroll handler. */
function onScroll(): void {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    evaluate();
    ticking = false;
  });
}

/** Smoothly return to the top, honouring reduced-motion. */
function scrollToTop(): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', evaluate, { passive: true });
  document.addEventListener('astro:page-load', resolve);
  resolve();
}
