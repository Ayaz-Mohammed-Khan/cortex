/**
 * Client-side search island (task 18.1; Req 6.2–6.7).
 *
 * Drives a modal search dialog backed by the Pagefind index that is built from
 * the static output after `astro build` (see the `postbuild` script). This
 * module owns the behavior that is *our* logic rather than the engine's:
 *
 *  - queries shorter than two characters are not run and show the min-length
 *    message (Req 6.4);
 *  - the ranked matches are capped with the pure `capResults` helper to the 50
 *    highest-ranked, preserving order (Req 6.3);
 *  - an empty match set shows the no-results message (Req 6.5);
 *  - each result renders the Note Display_Name and Category path and links to
 *    the Note (Req 6.6, 6.7).
 *
 * Pagefind is loaded lazily on first use. Its runtime lives at
 * `/pagefind/pagefind.js` in the built site and does not exist during `astro
 * dev`/build, so the import is hidden from Vite (`@vite-ignore`) and failures
 * degrade to an "unavailable" message rather than breaking the page.
 */

import { capResults, MAX_SEARCH_RESULTS } from '@/lib/search';

/** A single located match within a page. Pagefind's `sub_results[].url`
 *  already carries a `#:~:text=` text fragment (and/or an element anchor)
 *  pointing at the matched text, so linking to it makes the browser scroll to
 *  and highlight the match on the destination page. */
interface PagefindLocatedResult {
  url: string;
  excerpt: string;
}
interface PagefindData {
  /** The page URL (no text fragment). */
  url: string;
  excerpt: string;
  meta: Record<string, string>;
  /** Per-match anchors within the page; first is the best-ranked match. */
  sub_results?: PagefindLocatedResult[];
}
interface PagefindResult {
  data: () => Promise<PagefindData>;
}
interface PagefindApi {
  init?: () => Promise<void>;
  options?: (opts: Record<string, unknown>) => Promise<void>;
  search: (query: string) => Promise<{ results: PagefindResult[] }>;
}

/** Query parameter Pagefind appends to result URLs and that the destination
 *  page's PagefindHighlight reads to mark matched words. Both sides must match. */
const HIGHLIGHT_PARAM = 'highlight';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 180;

let pagefind: PagefindApi | null = null;
let loadFailed = false;
let debounceTimer: number | undefined;

async function loadPagefind(): Promise<PagefindApi | null> {
  if (pagefind || loadFailed) return pagefind;
  // Use a pre-initialized instance when one is already present on the global
  // (e.g. provided by the host page, or injected by tests) instead of loading
  // the runtime twice. In production this is normally absent and we fall
  // through to the dynamic import below.
  const injected = (globalThis as unknown as { pagefind?: PagefindApi }).pagefind;
  if (injected) {
    pagefind = injected;
    return pagefind;
  }
  try {
    // Load Pagefind's runtime, which only exists in the BUILT site at
    // `/pagefind/pagefind.js` (emitted by the `postbuild` step) and is absent
    // during `astro dev`.
    //
    // This import MUST stay invisible to Vite/Rollup. Every form of the static
    // `import()` syntax gets rewritten by Vite: a literal specifier is wrapped
    // in the preload helper (leaving an unresolved `__VITE_PRELOAD__` token that
    // throws at runtime), and a variable specifier caused Rollup to drop this
    // whole island from the build. The reliable escape hatch is to construct the
    // dynamic import through `new Function`, so the bundler sees only an opaque
    // string and emits a genuine native browser `import()` — no preload wrapper,
    // no placeholder, no tree-shaking of this module.
    const dynamicImport = new Function('u', 'return import(u)') as (
      u: string,
    ) => Promise<PagefindApi>;
    const module = await dynamicImport('/pagefind/pagefind.js');
    await module.init?.();
    // Ask Pagefind to append `?highlight=<query>` to result URLs so the
    // destination note page (which loads pagefind-highlight.js, see Layout)
    // can mark the matched words. Must match the param used by PagefindHighlight.
    await module.options?.({ highlightParam: HIGHLIGHT_PARAM });
    pagefind = module;
  } catch (error) {
    loadFailed = true;
    // Surface the real reason during development so a genuine breakage isn't
    // hidden behind the "unavailable" message. In dev the index doesn't exist,
    // so this is expected; in prod it should never fire.
    if (import.meta.env?.DEV) {
      console.warn('[search] Pagefind failed to load:', error);
    }
  }
  return pagefind;
}

function dialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('[data-search-dialog]');
}

function setStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('[data-search-status]');
  if (status) status.textContent = message;
}

function clearResults(): void {
  const list = document.querySelector<HTMLElement>('[data-search-results]');
  if (list) list.innerHTML = '';
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function renderResults(items: PagefindData[]): void {
  const list = document.querySelector<HTMLElement>('[data-search-results]');
  if (!list) return;
  list.innerHTML = items
    .map((item) => {
      const displayName = item.meta.displayName ?? item.meta.title ?? item.url;
      const categoryPath = item.meta.categoryPath ?? '';
      // Link to the best-ranked located match when available: its `url` carries
      // a `#:~:text=` fragment so the browser scrolls to and highlights the
      // matched word on the note page. Fall back to the plain page URL.
      const best = item.sub_results?.[0];
      const href = best?.url ?? item.url;
      // Prefer the match-centered excerpt so the snippet shows the hit in context.
      const excerpt = best?.excerpt ?? item.excerpt ?? '';
      return `
        <li>
          <a href="${escapeHtml(href)}" class="block rounded-md px-3 py-2 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 dark:hover:bg-gray-800">
            <span class="block font-medium text-gray-900 dark:text-gray-100">${escapeHtml(displayName)}</span>
            ${categoryPath ? `<span class="block text-xs text-gray-500 dark:text-gray-400">${escapeHtml(categoryPath)}</span>` : ''}
            <span class="mt-1 block text-sm text-gray-600 dark:text-gray-400">${excerpt}</span>
          </a>
        </li>`;
    })
    .join('');
}

async function runSearch(query: string): Promise<void> {
  const trimmed = query.trim();

  if (trimmed.length < MIN_QUERY_LENGTH) {
    clearResults();
    setStatus(`Type at least ${MIN_QUERY_LENGTH} characters to search.`);
    return;
  }

  const pf = await loadPagefind();
  if (!pf) {
    clearResults();
    setStatus('Search is unavailable. It works on the built site.');
    return;
  }

  setStatus('Searching…');
  const { results } = await pf.search(trimmed);
  // Cap to the 50 highest-ranked, preserving ranking order (Req 6.3).
  const capped = capResults(results);
  if (capped.length === 0) {
    clearResults();
    setStatus(`No results found for "${trimmed}".`);
    return;
  }

  const data = await Promise.all(capped.map((result) => result.data()));
  renderResults(data);
  const shown = data.length;
  const suffix = results.length > MAX_SEARCH_RESULTS ? ` (showing top ${shown})` : '';
  setStatus(`${results.length} result${results.length === 1 ? '' : 's'}${suffix}.`);
}

function openDialog(): void {
  const dlg = dialog();
  if (!dlg) return;
  if (!dlg.open) dlg.showModal();
  const input = dlg.querySelector<HTMLInputElement>('[data-search-input]');
  input?.focus();
  // Warm the index so the first keystroke is responsive.
  void loadPagefind();
}

function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target) return;
  if (target.closest('[data-search-open]')) {
    openDialog();
    return;
  }
  if (target.closest('[data-search-close]')) {
    dialog()?.close();
  }
}

function onInput(event: Event): void {
  const target = event.target as Element | null;
  if (!target?.closest('[data-search-input]')) return;
  const value = (target as HTMLInputElement).value;
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => void runSearch(value), DEBOUNCE_MS);
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl/Cmd+K opens search from anywhere.
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openDialog();
  }
}

document.addEventListener('click', onClick);
document.addEventListener('input', onInput);
document.addEventListener('keydown', onKeydown);
