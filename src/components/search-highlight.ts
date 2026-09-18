/**
 * Search-term highlighting on note pages.
 *
 * When a visitor clicks a search result, the link carries a `?highlight=<query>`
 * query parameter (added by Pagefind — see `search.ts`, which calls
 * `pagefind.options({ highlightParam: 'highlight' })`). This island loads
 * Pagefind's highlight runtime on the destination page and instantiates
 * `PagefindHighlight`, which reads that parameter and wraps the matched words in
 * `<mark>` elements inside the `[data-pagefind-body]` region — so the reader is
 * pointed straight at the word they searched for.
 *
 * Like the Pagefind runtime itself, `/pagefind/pagefind-highlight.js` only
 * exists in the BUILT site (emitted by the `postbuild` step) and is absent
 * during `astro dev`. The dynamic import is therefore constructed through
 * `new Function` so Vite/Rollup leaves it as a genuine native browser import
 * (no preload wrapper / `__VITE_PRELOAD__` placeholder, no tree-shaking), and a
 * missing script degrades silently rather than breaking the page.
 */

const HIGHLIGHT_PARAM = 'highlight';

interface PagefindHighlightCtor {
  new (opts: { highlightParam: string }): unknown;
}

async function applyHighlight(): Promise<void> {
  // Nothing to do if the page wasn't opened from a search result.
  if (!new URLSearchParams(window.location.search).has(HIGHLIGHT_PARAM)) return;
  try {
    const dynamicImport = new Function('u', 'return import(u)') as (
      u: string,
    ) => Promise<{ PagefindHighlight?: PagefindHighlightCtor }>;
    const module = await dynamicImport('/pagefind/pagefind-highlight.js');
    const Ctor =
      module.PagefindHighlight ??
      (globalThis as unknown as { PagefindHighlight?: PagefindHighlightCtor }).PagefindHighlight;
    if (Ctor) new Ctor({ highlightParam: HIGHLIGHT_PARAM });
  } catch (error) {
    if (import.meta.env?.DEV) {
      console.warn('[search-highlight] Pagefind highlight failed to load:', error);
    }
  }
}

void applyHighlight();
// View Transitions swap the DOM without a full reload; re-apply after each swap
// so highlighting works when navigating between notes client-side.
document.addEventListener('astro:after-swap', () => void applyHighlight());
