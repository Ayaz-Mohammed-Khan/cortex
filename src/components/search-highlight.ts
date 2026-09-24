/**
 * Search-term highlighting on note pages, with a navigation + dismiss toolbar.
 *
 * When a visitor clicks a search result, the link carries a `?highlight=<query>`
 * query parameter (added by Pagefind — see `search.ts`, which calls
 * `pagefind.options({ highlightParam: 'highlight' })`). This island loads
 * Pagefind's highlight runtime on the destination page and instantiates
 * `PagefindHighlight`, which reads that parameter and wraps the matched words in
 * `<mark class="pagefind-highlight">` elements inside the `[data-pagefind-body]`
 * region — so the reader is pointed straight at the words they searched for.
 *
 * After highlighting, a small floating toolbar is shown so the reader can:
 *   - jump between every matched word with prev (‹) / next (›), like a browser's
 *     find bar (wrapping around, with the active match scrolled into view and
 *     given a distinct style), tracked by an "N of M" counter; and
 *   - dismiss highlighting entirely with the clear (✕) button — which unwraps
 *     every <mark> (restoring the original text), removes the toolbar, and
 *     strips the `?highlight=` param from the URL so a refresh/share is clean.
 *   - Keyboard while highlights are active: Enter = next, Shift+Enter = prev,
 *     Escape = clear (unless a dialog such as search is open).
 *
 * Like the Pagefind runtime itself, `/pagefind/pagefind-highlight.js` only
 * exists in the BUILT site (emitted by the `postbuild` step) and is absent
 * during `astro dev`. The dynamic import is therefore constructed through
 * `new Function` so Vite/Rollup leaves it as a genuine native browser import
 * (no preload wrapper / `__VITE_PRELOAD__` placeholder, no tree-shaking), and a
 * missing script degrades silently rather than breaking the page.
 */

const HIGHLIGHT_PARAM = 'highlight';
const MARK_CLASS = 'pagefind-highlight';
const ACTIVE_MARK_CLASS = 'pagefind-highlight-active';
const TOOLBAR_ID = 'search-highlight-toolbar';

interface PagefindHighlightCtor {
  new (opts: { highlightParam: string; markOptions?: { className?: string } }): unknown;
}

/** All highlight marks in document order, and the currently focused index. */
let marks: HTMLElement[] = [];
let activeIndex = -1;

/** Remove the `?highlight=` query param from the address bar without a reload. */
function stripHighlightParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(HIGHLIGHT_PARAM) && !url.searchParams.has(PHRASE_PARAM)) return;
  url.searchParams.delete(HIGHLIGHT_PARAM);
  url.searchParams.delete(PHRASE_PARAM);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

/** Unwrap every highlight <mark>, restoring the original text nodes. */
function removeHighlights(): void {
  document.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    // Replace the <mark> with its own children (the original text), then merge
    // adjacent text nodes so the DOM matches its pre-highlight state.
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/** Tear down highlighting entirely: marks, the toolbar, listeners, and the URL param. */
function clearHighlighting(): void {
  removeHighlights();
  document.getElementById(TOOLBAR_ID)?.remove();
  document.removeEventListener('keydown', onKeydown);
  marks = [];
  activeIndex = -1;
  stripHighlightParam();
}

/** Update the "N of M" counter in the toolbar. */
function updateCounter(): void {
  const counter = document.querySelector<HTMLElement>(`#${TOOLBAR_ID} [data-hl-counter]`);
  if (counter) {
    counter.textContent = marks.length ? `${activeIndex + 1} of ${marks.length}` : '0';
  }
}

/** Focus a match by index (wrapping), scroll it into view, and style it active. */
function goToMatch(index: number): void {
  if (marks.length === 0) return;
  // Wrap around both directions.
  activeIndex = ((index % marks.length) + marks.length) % marks.length;
  marks.forEach((m, i) => m.classList.toggle(ACTIVE_MARK_CLASS, i === activeIndex));
  const target = marks[activeIndex];
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  updateCounter();
}

function nextMatch(): void {
  goToMatch(activeIndex + 1);
}
function prevMatch(): void {
  goToMatch(activeIndex - 1);
}

function makeButton(label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.className =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium ' +
    'text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-violet-600 dark:text-violet-200 dark:hover:bg-gray-800';
  btn.addEventListener('click', onClick);
  return btn;
}

/** Show the floating prev / counter / next / clear toolbar (once). */
function showToolbar(): void {
  if (document.getElementById(TOOLBAR_ID)) return;
  const bar = document.createElement('div');
  bar.id = TOOLBAR_ID;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Search highlight navigation');
  bar.className =
    'fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full ' +
    'border border-violet-300 bg-white/95 px-2 py-1 shadow-lg backdrop-blur ' +
    'dark:border-violet-500/50 dark:bg-gray-900/95';

  const prev = makeButton('‹', 'Previous match', prevMatch);
  const counter = document.createElement('span');
  counter.setAttribute('data-hl-counter', '');
  counter.setAttribute('aria-live', 'polite');
  counter.className = 'px-1 text-xs tabular-nums text-gray-600 dark:text-gray-300';
  const next = makeButton('›', 'Next match', nextMatch);

  // A thin separator before the clear action.
  const sep = document.createElement('span');
  sep.setAttribute('aria-hidden', 'true');
  sep.className = 'mx-0.5 h-5 w-px bg-gray-300 dark:bg-white/15';

  const clear = makeButton('✕', 'Clear search highlights', clearHighlighting);

  bar.append(prev, counter, next, sep, clear);
  document.body.appendChild(bar);
  document.addEventListener('keydown', onKeydown);
}

function onKeydown(event: KeyboardEvent): void {
  if (marks.length === 0) return;
  // Don't hijack keys while a dialog (e.g. the search modal) is open.
  if (document.querySelector('dialog[open]')) return;

  if (event.key === 'Escape') {
    clearHighlighting();
    return;
  }
  if (event.key === 'Enter') {
    // Enter = next match, Shift+Enter = previous — mirrors a browser find bar.
    event.preventDefault();
    if (event.shiftKey) prevMatch();
    else nextMatch();
  }
}

/** Query param set by the search island for exact-phrase results, telling this
 *  page to mark the whole contiguous phrase instead of each word. */
const PHRASE_PARAM = 'phrase';

/**
 * Highlight the whole contiguous PHRASE (e.g. "normal distribution") inside the
 * note body, rather than each word separately. Pagefind's own highlighter is
 * word-by-word only, so for an exact-phrase search result we do it ourselves.
 *
 * Walks the text nodes of `[data-pagefind-body]` and wraps each case-insensitive
 * occurrence of `phrase` in a `<mark class="pagefind-highlight">`, matching the
 * markup Pagefind would emit so the toolbar/navigation logic is unchanged. Only
 * matches WITHIN a single text node (phrases rarely straddle inline element
 * boundaries in prose, and this keeps the DOM edit safe and simple).
 */
function highlightPhrase(phrase: string): number {
  const body = document.querySelector<HTMLElement>('[data-pagefind-body]');
  if (!body) return 0;
  const needle = phrase.toLowerCase();
  if (!needle) return 0;

  // Collect candidate text nodes first (mutating during walk invalidates it).
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      // Skip already-highlighted marks, scripts/styles, and empty text.
      if (!p || p.closest(`mark.${MARK_CLASS}, script, style`)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.toLowerCase().includes(needle)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);

  let count = 0;
  for (const textNode of targets) {
    const text = textNode.nodeValue ?? '';
    const lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let pos = 0;
    let idx = lower.indexOf(needle, pos);
    while (idx !== -1) {
      if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
      const mark = document.createElement('mark');
      mark.className = MARK_CLASS;
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      count += 1;
      pos = idx + needle.length;
      idx = lower.indexOf(needle, pos);
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return count;
}

async function applyHighlight(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  // Nothing to do if the page wasn't opened from a search result.
  const query = params.get(HIGHLIGHT_PARAM);
  if (query === null) return;

  // Exact-phrase result: the search island passes the full phrase in `?phrase=`
  // (Pagefind splits `?highlight=` into one param PER WORD, so we cannot rebuild
  // the phrase from it). Mark the whole contiguous phrase ourselves.
  const phrase = (params.get(PHRASE_PARAM) ?? '').trim();
  if (phrase.includes(' ')) {
    const n = highlightPhrase(phrase);
    requestAnimationFrame(() => {
      marks = Array.from(document.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`));
      if (marks.length === 0) return;
      showToolbar();
      goToMatch(0);
    });
    if (n > 0) return; // phrase found & marked; done
    // No in-node phrase occurrence found (rare): fall through to word highlighting.
  }

  try {
    const dynamicImport = new Function('u', 'return import(u)') as (
      u: string,
    ) => Promise<{ PagefindHighlight?: PagefindHighlightCtor }>;
    const module = await dynamicImport('/pagefind/pagefind-highlight.js');
    const Ctor =
      module.PagefindHighlight ??
      (globalThis as unknown as { PagefindHighlight?: PagefindHighlightCtor }).PagefindHighlight;
    if (!Ctor) return;
    // Pin the mark class so we can find, navigate, and unwrap the marks.
    new Ctor({ highlightParam: HIGHLIGHT_PARAM, markOptions: { className: MARK_CLASS } });
    // After marks are in place, collect them and reveal the toolbar. Focus the
    // first match (Pagefind already scrolled to the section; this centers the
    // exact word and starts the "1 of M" counter).
    requestAnimationFrame(() => {
      marks = Array.from(document.querySelectorAll<HTMLElement>(`mark.${MARK_CLASS}`));
      if (marks.length === 0) return;
      showToolbar();
      goToMatch(0);
    });
  } catch (error) {
    if (import.meta.env?.DEV) {
      console.warn('[search-highlight] Pagefind highlight failed to load:', error);
    }
  }
}

void applyHighlight();
// View Transitions swap the DOM without a full reload; clean up any stale
// toolbar/listeners and re-apply on the new page for client-side navigation.
document.addEventListener('astro:after-swap', () => {
  document.getElementById(TOOLBAR_ID)?.remove();
  document.removeEventListener('keydown', onKeydown);
  marks = [];
  activeIndex = -1;
  void applyHighlight();
});
