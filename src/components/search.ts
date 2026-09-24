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

/** One matched SECTION of a page. Pagefind groups matches by heading and gives
 *  each group a `title` (the heading text), a `url` that already carries the
 *  `#anchor` (plus a `?highlight=` param, added via `options`), the heading
 *  `anchor` (or `null` for the note-intro region above the first heading), and
 *  the `locations` of every match inside that section. */
interface PagefindSubResult {
  title: string;
  url: string;
  excerpt: string;
  anchor: { element: string; id: string; text: string } | null;
  /** One entry per matched word occurrence within this section. */
  locations?: number[];
}
interface PagefindData {
  /** The page URL (no text fragment). */
  url: string;
  excerpt: string;
  meta: Record<string, string>;
  /** The note's full indexed text. Used to count exact-phrase / term
   *  occurrences for the count pill and the phrase-first tiering. */
  content?: string;
  /** Every matched word occurrence on the page; its length is the note's
   *  total match count shown as the count pill. */
  locations?: number[];
  /** Per-heading match groups; the section list rendered under each note. */
  sub_results?: PagefindSubResult[];
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

/** Regex matching a single Pagefind `<mark>…</mark>` highlight, term captured. */
const MARK_RE = /<mark>([^<]*)<\/mark>/g;

/** Split a string into lowercased alphanumeric terms (mirrors how Pagefind
 *  tokenizes words), dropping punctuation and empties. */
function terms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

/**
 * Whether a highlighted term is a GENUINE match for the query, not a loose
 * fragment. Pagefind will happily match the leading "a" of "ayaz" and mark
 * every "a" in the corpus; that must not count. A marked term counts only when,
 * for some query term, either:
 *   - the marked term contains the whole query term (covers exact + the note
 *     containing a longer word, e.g. query "variance" -> marked "variance."), or
 *   - the query term is a PREFIX of the marked term and they share at least
 *     `min(queryTermLength, PREFIX_MIN)` leading characters (covers real prefix
 *     search like "statis" -> "statistics", while rejecting "ayaz" -> "a").
 */
const PREFIX_MIN = 3;
function markedTermIsRelevant(marked: string, queryTerms: string[]): boolean {
  return queryTerms.some((q) => {
    if (q.length < 2) return false;
    if (marked.includes(q)) return true;
    const need = Math.min(q.length, PREFIX_MIN);
    return marked.startsWith(q.slice(0, need)) && marked.length >= need && q.startsWith(marked.slice(0, need));
  });
}

/** Collect the highlighted terms across a result's excerpt and its sections. */
function markedTerms(item: PagefindData): string[] {
  const excerpts = [item.excerpt ?? '', ...(item.sub_results ?? []).map((s) => s.excerpt ?? '')];
  const out: string[] = [];
  for (const html of excerpts) {
    for (const m of html.matchAll(MARK_RE)) {
      for (const t of terms(m[1] ?? '')) out.push(t);
    }
  }
  return out;
}

/**
 * A result is real when at least one of its highlighted terms genuinely matches
 * a query term. This filters out Pagefind's loose single-letter/fragment
 * fallback matches (the "ayaz" -> "a" problem) so a query with no true hit
 * correctly shows "No results".
 */
function isRealMatch(item: PagefindData, query: string): boolean {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return false;
  const marks = markedTerms(item);
  // No highlights at all: nothing to trust, treat as not relevant.
  if (marks.length === 0) return false;
  return marks.some((mark) => markedTermIsRelevant(mark, queryTerms));
}

/** Normalize note text / a query for phrase counting: lowercase and collapse
 *  every run of whitespace to a single space, so a phrase split across a line
 *  break in the source still counts as contiguous. */
function normalizeForPhrase(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Count how many times the exact query PHRASE occurs in a note's content, in
 * order and contiguous (interpretation A: "normal distribution" also counts
 * inside "standard normal distribution"). Only meaningful for multi-word
 * queries; a single word is handled by {@link termCount}.
 */
function phraseCount(item: PagefindData, query: string): number {
  const needle = normalizeForPhrase(query).trim();
  if (!needle.includes(' ')) return 0; // single word: not a phrase
  const hay = normalizeForPhrase(item.content ?? '');
  if (!hay) return 0;
  let count = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    count += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return count;
}

/**
 * Count whole-word occurrences of a single query TERM in a note's content
 * (word-boundary, so "normal" counts "normal" but not "normally"'s stem noise
 * beyond the word). Used for the single-term count pill.
 */
function termCount(item: PagefindData, query: string): number {
  const q = terms(query)[0];
  if (!q) return 0;
  const words = (item.content ?? '').toLowerCase().match(/[a-z0-9]+/g);
  if (!words) return 0;
  let n = 0;
  for (const w of words) if (w === q) n += 1;
  return n;
}

/** A Pagefind result paired with the "what the user typed" count we display. */
interface RankedNote {
  data: PagefindData;
  /** Phrase-occurrence count when the query is a phrase found in this note;
   *  otherwise the single-term occurrence count. Shown in the pill. */
  count: number;
  /** True when this note contains the exact query phrase (drives the tier). */
  isPhraseMatch: boolean;
}

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

/** How many matched sections to list per note before collapsing the rest into
 *  a "+N more" line. A note can match a dozen-plus headings; showing them all
 *  would bury the other notes and make the dropdown scroll forever. */
const MAX_SECTIONS_PER_NOTE = 5;

/** Build the "N matches" pill text from the note's count of the typed
 *  phrase/term (falls back to Pagefind's location count if unknown). */
function matchCountLabel(note: RankedNote): string {
  const n = note.count > 0 ? note.count : (note.data.locations?.length ?? 0);
  return `${n} ${n === 1 ? 'match' : 'matches'}`;
}

/** The heading label a section row should show. Prefer the anchor's own text;
 *  fall back to the sub_result title. */
function sectionLabel(sub: PagefindSubResult): string {
  return (sub.anchor?.text ?? sub.title ?? '').trim();
}

/**
 * Carry the exact phrase to the destination page for a phrase-tier match, so
 * its highlighter marks the whole contiguous phrase rather than each word
 * separately (Pagefind's own highlighter is word-by-word only, and it even
 * splits the URL into repeated `?highlight=word` params, so we cannot rebuild
 * the phrase there). We add a single `&phrase=<full phrase>` param carrying the
 * query verbatim. Left untouched for single-term / fallback matches, which keep
 * the default word highlighting.
 */
function withPhraseFlag(url: string, isPhrase: boolean, phrase: string): string {
  if (!isPhrase) return url;
  // The url already has `?highlight=…` and maybe a `#anchor`; insert the flag
  // into the query string, before any hash.
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}phrase=${encodeURIComponent(phrase)}${hash}`;
}

/** Render one matched SECTION row: the heading text, linking to its anchor. */
function renderSection(sub: PagefindSubResult, isPhrase: boolean, phrase: string): string {
  return `
    <li>
      <a href="${escapeHtml(withPhraseFlag(sub.url, isPhrase, phrase))}"
         class="group/sec flex items-center gap-2 rounded-md py-1 pl-3 pr-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-violet-300">
        <svg class="h-3 w-3 shrink-0 text-gray-400 group-hover/sec:text-violet-500 dark:text-gray-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 4l6 6-6 6" />
        </svg>
        <span class="min-w-0 flex-1 truncate">${escapeHtml(sectionLabel(sub))}</span>
      </a>
    </li>`;
}

/**
 * Option C: each result is a NOTE with its title, category, a match-count pill,
 * and a list of the sections where the term appears (each linking to that
 * section's anchor). The raw match text is no longer shown; the reader picks a
 * section and the note itself highlights the hits (unchanged).
 */
function renderResults(notes: RankedNote[], query: string): void {
  const list = document.querySelector<HTMLElement>('[data-search-results]');
  if (!list) return;
  list.innerHTML = notes
    .map((note) => {
      const item = note.data;
      const displayName = item.meta.displayName ?? item.meta.title ?? item.url;
      const categoryPath = item.meta.categoryPath ?? '';
      const noteHref = withPhraseFlag(
        item.sub_results?.[0]?.url ?? item.url,
        note.isPhraseMatch,
        query,
      );

      // Drop the intro sub-result that merely echoes the note title: it adds no
      // navigational value beyond the title row already shown above.
      const subs = (item.sub_results ?? []).filter(
        (sub) => sectionLabel(sub).toLowerCase() !== displayName.trim().toLowerCase(),
      );
      const shown = subs.slice(0, MAX_SECTIONS_PER_NOTE);
      const extra = subs.length - shown.length;

      const sectionsHtml = shown
        .map((sub) => renderSection(sub, note.isPhraseMatch, query))
        .join('');
      const moreHtml =
        extra > 0
          ? `<li class="py-1 pl-3 pr-2 text-xs text-gray-400 dark:text-gray-500">+${extra} more section${extra === 1 ? '' : 's'}</li>`
          : '';

      return `
        <li class="rounded-lg px-1 py-1">
          <a href="${escapeHtml(noteHref)}"
             class="flex items-baseline gap-2 rounded-md px-3 py-2 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 dark:hover:bg-gray-800">
            <span class="min-w-0 flex-1 font-medium text-gray-900 dark:text-gray-100">${escapeHtml(displayName)}</span>
            <span class="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[0.7rem] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">${escapeHtml(matchCountLabel(note))}</span>
          </a>
          ${categoryPath ? `<p class="px-3 text-xs text-gray-500 dark:text-gray-400">${escapeHtml(categoryPath)}</p>` : ''}
          ${sectionsHtml ? `<ul class="mt-1 space-y-0.5 border-l border-gray-100 pl-3 dark:border-white/5">${sectionsHtml}${moreHtml}</ul>` : ''}
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
  const data = await Promise.all(capped.map((result) => result.data()));

  // Drop junk matches. Pagefind matches loosely: a query with no real hit (e.g.
  // "ayaz") still returns notes because it matches a leading fragment like the
  // single letter "a", highlighting it everywhere. Keep only notes where a
  // highlighted term genuinely corresponds to a query term (see `isRealMatch`).
  const relevant = data.filter((item) => isRealMatch(item, trimmed));

  // Two tiers.
  //   - EXACT PHRASE: notes that contain the typed multi-word phrase verbatim
  //     (in order, contiguous). When ANY exist, show ONLY those, ranked by how
  //     often the phrase appears. This is what makes "normal distribution" show
  //     the Normal Distribution note, not every note stuffed with "distribution".
  //   - FALLBACK: no note has the phrase (or it is a single word), so fall back
  //     to Pagefind's all-terms matches. The pill then counts the single term.
  // In both tiers the count reflects EXACTLY what the user typed, never a sum of
  // separately-matched words.
  const phraseMatches: RankedNote[] = relevant
    .map((item) => ({ data: item, count: phraseCount(item, trimmed), isPhraseMatch: true }))
    .filter((n) => n.count > 0)
    .sort((a, b) => b.count - a.count);

  const notes: RankedNote[] =
    phraseMatches.length > 0
      ? phraseMatches
      : relevant.map((item) => ({
          data: item,
          count: termCount(item, trimmed),
          isPhraseMatch: false,
        }));

  if (notes.length === 0) {
    clearResults();
    setStatus(`No results found for "${trimmed}".`);
    return;
  }

  renderResults(notes, trimmed);
  const shown = notes.length;
  const suffix = shown > MAX_SEARCH_RESULTS ? ` (showing top ${MAX_SEARCH_RESULTS})` : '';
  // Each result is a note now, so count notes rather than "results".
  setStatus(`${shown} note${shown === 1 ? '' : 's'} matched${suffix}.`);
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
