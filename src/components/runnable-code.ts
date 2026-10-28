/**
 * Runnable-code island — turns authored Python fences into live, editable cells.
 *
 * Progressive enhancement layered ON TOP of `./code-block.ts` (plan D1/D4/D6).
 * On a note that opts in (`.note-body[data-runnable="true"]`), every Shiki
 * `python`/`py` fence gets a Run button, an editable area, and an output region.
 * With no JS — or before the first Run — the note is complete: the authored
 * code plus its static output fences render exactly as written.
 *
 * ── Coexistence with code-block.ts ──────────────────────────────────────────
 * `code-block.ts` already wrapped each `<pre data-language>` in a `.code-block`
 * container (copy button + language label). This island runs on the SAME
 * `astro:page-load` event and must not re-wrap: it finds the existing
 * `.code-block` wrapper and APPENDS a top bar + output region, guarded by a
 * `pre.dataset.runnableEnhanced` flag for idempotency across View Transition
 * swaps. Module scripts are imported once and do not re-run on client
 * navigations, so the `astro:page-load` listener is what re-enhances swapped-in
 * content. Injected chrome carries `data-pagefind-ignore`.
 *
 * ── Shared worker (D2/D6) ───────────────────────────────────────────────────
 * ONE Pyodide worker per page session, created lazily on the first Run and held
 * in a module-level singleton (`worker`) so it survives View Transition swaps
 * and is reused across every cell. Boot happens once; later runs are instant.
 *
 * ── Runtime safety (D3) ─────────────────────────────────────────────────────
 * Output HTML from Python is NEVER assigned via innerHTML. A pandas object
 * arrives as structured { columns, index, rows } (see the worker) and is
 * rebuilt here with `document.createElement` + `textContent` only, so a cell
 * value like `<script>` renders as literal text, not an element. The build-time
 * sanitize boundary (`src/lib/sanitize.ts`) governs authored Markdown only and
 * does NOT cover this runtime DOM, so safety here is enforced by construction.
 */

import {
  BOOT_STATUS_TEXT,
  RUN_TIMEOUT_MS,
  type DataFrameTable,
  type RunError,
  type RunRequest,
  type RunResult,
  type WorkerMessage,
} from '@/lib/runnable-code/protocol';
import { highlightPython } from '@/lib/runnable-code/highlight';

// ── Pure, testable helpers ──────────────────────────────────────────────────

/** Fence languages treated as runnable Python. */
const PYTHON_LANGS = new Set(['python', 'py']);

/** Exact first-line marker that opts a single block OUT of being runnable. */
const NORUN_MARKER = '# cortex:norun';

/** Re-exported so the status copy has a single source and the test can assert
 *  the exact string the pill shows on the first Run. */
export const bootStatusText = BOOT_STATUS_TEXT;

/**
 * True when the FIRST non-empty line of the code is exactly `# cortex:norun`
 * (trimmed). Only the first non-empty line counts, so a later comment with the
 * same text does not disable the block.
 */
export function hasNorunMarker(code: string): boolean {
  for (const line of code.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    return trimmed === NORUN_MARKER;
  }
  return false;
}

/**
 * Remove the leading `# cortex:norun` directive line from a block's RENDERED
 * output so the reader never sees the internal marker. Shiki emits one line per
 * child "line" element inside `<code>` (plus whitespace text nodes). We find the
 * first element line whose text equals the marker and remove it, along with a
 * trailing newline text node if present, preserving the syntax highlighting of
 * every other line. Falls back to a plain-text strip if the structure is flat.
 */
function stripNorunMarkerFromDisplay(pre: HTMLPreElement): void {
  const code = pre.querySelector('code');
  if (!code) return;

  // Shiki line elements are the element children of <code> (commonly <span class="line">).
  const lineEls = Array.from(code.children) as HTMLElement[];
  const markerEl = lineEls.find((el) => el.textContent?.trim() === NORUN_MARKER);
  if (markerEl) {
    // Drop a following whitespace/newline text node so no blank first line is left.
    const next = markerEl.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && (next.textContent ?? '').trim() === '') {
      next.remove();
    }
    markerEl.remove();
    return;
  }

  // Fallback: no per-line elements (flat text). Strip the first line textually.
  const text = code.textContent ?? '';
  const nl = text.indexOf('\n');
  if (nl >= 0 && text.slice(0, nl).trim() === NORUN_MARKER) {
    code.textContent = text.slice(nl + 1);
  }
}

/**
 * Build a `<table class="rc-df">` from structured DataFrame data using text
 * nodes only. NO HTML string from Python is ever parsed — this is the D3 safety
 * boundary. A cell containing `<script>` becomes literal text, never an element.
 */
export function buildTable(table: DataFrameTable, doc: Document = document): HTMLTableElement {
  const el = doc.createElement('table');
  el.className = 'rc-df';

  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  // Top-left corner cell for the index column.
  headRow.appendChild(doc.createElement('th'));
  for (const col of table.columns) {
    const th = doc.createElement('th');
    th.scope = 'col';
    th.textContent = col; // textContent — never innerHTML.
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  el.appendChild(thead);

  const tbody = doc.createElement('tbody');
  table.rows.forEach((row, r) => {
    const tr = doc.createElement('tr');
    const indexCell = doc.createElement('th');
    indexCell.scope = 'row';
    indexCell.textContent = table.index[r] ?? '';
    tr.appendChild(indexCell);
    for (const value of row) {
      const td = doc.createElement('td');
      td.textContent = value; // textContent — never innerHTML.
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);

  return el;
}

// ── Shared worker singleton (module scope; survives page-load swaps) ─────────

let worker: Worker | null = null;
/** Monotonic request id so responses correlate to the cell that asked. */
let nextRequestId = 1;
/** Pending runs keyed by request id: resolve/reject plus a timeout handle.
 *  `timer` is 0 until the run's soft timeout is armed — which happens only when
 *  the worker posts `status: executing` for this id, i.e. AFTER its one-time
 *  boot and after any first-time package download. Neither the (tens-of-seconds)
 *  Pyodide boot nor a heavy package fetch is counted against the per-run
 *  timeout (D6: the ~15s limit is a RUN timeout guarding runaway user code). */
interface Pending {
  resolve: (r: RunResult) => void;
  reject: (e: RunError) => void;
  timer: number;
}

/** Arm the soft run-timeout for one pending run. Separated out so it can be
 *  called after boot completes rather than at submit time (see `runInWorker`). */
function armTimeout(id: number): void {
  const entry = pending.get(id);
  if (!entry || entry.timer !== 0) return;
  entry.timer = window.setTimeout(() => {
    pending.delete(id);
    entry.reject({
      id,
      ok: false,
      error: `This run took longer than ${Math.round(
        RUN_TIMEOUT_MS / 1000,
      )}s and was stopped. Try simplifying the code (for example, smaller loops or data).`,
      stderr: '',
      timeMs: RUN_TIMEOUT_MS,
    });
  }, RUN_TIMEOUT_MS);
}
const pending = new Map<number, Pending>();
/** Resolvers waiting for the worker's first `ready` status (boot complete). */
let bootWaiters: Array<() => void> = [];
let booted = false;

/** Lazily create the ONE worker for this page session and wire its messages. */
function getWorker(): Worker {
  if (worker) return worker;
  // `new URL(..., import.meta.url)` is the Vite/Astro pattern that makes the
  // bundler emit the worker as a hashed static asset. `type: 'module'` matches
  // the worker's ESM dynamic import of Pyodide.
  worker = new Worker(new URL('./pyodide-worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if ('type' in msg) {
      if (msg.phase === 'ready') {
        booted = true;
        bootWaiters.forEach((fn) => fn());
        bootWaiters = [];
      } else if (msg.phase === 'executing' && typeof msg.id === 'number') {
        // The worker has finished boot AND any one-time package download for
        // this run, and is about to run the user's code — arm the per-run soft
        // timeout NOW so neither boot nor package download counts against the
        // 15s run limit (the limit guards runaway user code, D6).
        armTimeout(msg.id);
      }
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg);
    else entry.reject(msg);
  });
  return worker;
}

/**
 * Submit code to the shared worker. Enforces a SOFT timeout (D6): because one
 * worker is shared across cells, a hard terminate would kill sibling cells, so
 * on timeout we reject this run with a friendly message and leave the worker
 * usable (any late result for this id is ignored).
 */
function runInWorker(code: string): Promise<RunResult> {
  const w = getWorker();
  const id = nextRequestId++;
  return new Promise<RunResult>((resolve, reject) => {
    // Register the pending run WITHOUT arming its timer yet (timer: 0). The soft
    // timeout is armed by `armTimeout` either right now (worker already booted)
    // or from the `ready` handler once the one-time boot completes. This keeps
    // the possibly-long Pyodide boot out of the per-run 15s budget (D6).
    pending.set(id, { resolve, reject, timer: 0 });
    const req: RunRequest = { id, code };
    w.postMessage(req);
    // The per-run soft timeout is armed later, when the worker posts the
    // `executing` status for this id (after boot + any package download). See
    // the worker message handler in `getWorker`.
  });
}

// ── SVG icons (decorative; controls carry accessible names) ──────────────────

function playIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 5v14l11-7z');
  svg.appendChild(path);
  return svg;
}

// ── Per-cell enhancement ─────────────────────────────────────────────────────

/** State captured per enhanced cell. */
interface CellState {
  /** The original authored code text (for Reset + first run). */
  original: string;
  /** The original highlighted `<code>` innerHTML, so Reset restores colour. */
  originalHtml: string;
  /** The overlay textarea that holds the editable code once live, else null. */
  textarea: HTMLTextAreaElement | null;
  /** The status pill element. */
  status: HTMLSpanElement;
  /** The adopted "Python" language label, lit green once the worker is live. */
  langLabel: HTMLElement | null;
  /** The output region (created on first Run). */
  output: HTMLElement;
  /** The meta/status footer line. */
  meta: HTMLElement;
  /** True once the editable transition has happened. */
  live: boolean;
}

/** Set the status pill text + state class. */
function setStatus(state: CellState, text: string, kind: 'idle' | 'run' | 'live'): void {
  state.status.textContent = text;
  state.status.dataset.state = kind;
  state.status.hidden = text.length === 0;
}

/** Read the current code: from the editor if live, else the original <code>. */
function currentCode(pre: HTMLPreElement, state: CellState): string {
  if (state.live && state.textarea) return state.textarea.value;
  return pre.querySelector('code')?.textContent ?? state.original;
}

/**
 * Make the cell editable (D4) using a TEXTAREA OVERLAY, the standard
 * lightweight-code-editor pattern (Prism-live / CodeJar style).
 *
 * Why not `contenteditable` on the Shiki `<pre>`: Shiki wraps every line in a
 * `<span class="line">`, and making the container editable makes the browser
 * draw a focus/selection box around EACH line span (the stray purple per-line
 * outlines) and makes single-click caret placement unreliable (needing a
 * double-click). Instead we:
 *   - keep the coloured Shiki `<pre>` as a non-interactive visual UNDERLAY
 *     (`aria-hidden`, `pointer-events: none`), so the reader still sees full
 *     syntax colour, and
 *   - overlay a real `<textarea>` with transparent text + a visible caret,
 *     pixel-aligned to the underlay (same font, size, line-height, padding), so
 *     editing is native: single-click focus, normal caret, selection, and no
 *     per-line boxes.
 * As the user types, the textarea is the source of truth and the underlay is
 * re-highlighted on every edit by a tiny client-side Python highlighter
 * (`highlightPython`), so colour persists while typing instead of collapsing to
 * plain text. Reset restores the original build-time (Shiki) highlighted HTML.
 */
function makeEditable(pre: HTMLPreElement, state: CellState): void {
  if (state.live) return;
  const code = pre.querySelector('code');
  if (!code) return;

  // Position the <pre> as the underlay and add a textarea sibling over it.
  pre.classList.add('rc-underlay');
  pre.setAttribute('aria-hidden', 'true');

  const textarea = document.createElement('textarea');
  textarea.className = 'rc-textarea';
  textarea.value = state.original;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Editable Python code. Press Shift plus Enter to run.');
  textarea.setAttribute('data-pagefind-ignore', '');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.wrap = 'off';
  // Size the textarea to the code's height so the whole block is editable.
  textarea.rows = state.original.split('\n').length;

  // Keep the visible underlay in sync with what is typed, RE-HIGHLIGHTING on
  // every edit (via the tiny client-side Python highlighter) so the live editor
  // stays coloured while the reader types instead of collapsing to plain text.
  // The spans carry inline `color` + `--shiki-dark`, so dark theme swaps colour
  // exactly like a static Shiki block.
  const sync = (): void => {
    code.innerHTML = highlightPython(textarea.value);
    textarea.rows = Math.max(1, textarea.value.split('\n').length);
  };
  textarea.addEventListener('input', sync);

  // Horizontal responsiveness: lines longer than the cell (common on phones)
  // must scroll, not get clipped. The textarea is the top layer and scrolls
  // natively; the coloured underlay sits beneath with `overflow: hidden`, so we
  // mirror the textarea's scroll offset onto it to keep glyphs aligned as the
  // reader scrolls a long line into view. One listener per cell.
  const mirrorScroll = (): void => {
    pre.scrollLeft = textarea.scrollLeft;
    pre.scrollTop = textarea.scrollTop;
  };
  textarea.addEventListener('scroll', mirrorScroll);

  // Wrap ONLY the <pre> in a relative container and overlay the textarea at
  // inset:0 of that wrapper, so the two share the exact same box and align with
  // no pixel math (robust against the top bar / output around them).
  const codeWrap = document.createElement('div');
  codeWrap.className = 'rc-code-wrap';
  pre.parentElement?.insertBefore(codeWrap, pre);
  codeWrap.appendChild(pre);
  codeWrap.appendChild(textarea);

  state.textarea = textarea;
  state.live = true;
}

/**
 * A small "Output" header row (status dot + label) that sits atop the output
 * region so a result reads as a distinct, labelled panel rather than loose text
 * hanging under the code. `kind` tints the dot (ok = result, err = error).
 */
function outputHeader(label: string, kind: 'ok' | 'err' = 'ok'): HTMLElement {
  const head = document.createElement('div');
  head.className = 'rc-output-head';
  head.dataset.state = kind;
  const dot = document.createElement('span');
  dot.className = 'rc-output-dot';
  dot.setAttribute('aria-hidden', 'true');
  head.appendChild(dot);
  const text = document.createElement('span');
  text.textContent = label;
  head.appendChild(text);
  return head;
}

/** Render a RunResult into the output region (D3 safe DOM building). */
function renderResult(state: CellState, res: RunResult): void {
  const out = state.output;
  out.replaceChildren();
  out.hidden = false;
  out.appendChild(outputHeader('Output'));

  let produced = false;

  const text = [res.stdout, res.stderr].filter((s) => s.length > 0).join('');
  if (text.length > 0) {
    const block = document.createElement('pre');
    block.className = 'rc-stream';
    block.textContent = text; // text only.
    out.appendChild(block);
    produced = true;
  }

  if (res.table) {
    const wrap = document.createElement('div');
    wrap.className = 'rc-df-wrap';
    wrap.appendChild(buildTable(res.table));
    out.appendChild(wrap);
    produced = true;
  }

  if (res.result) {
    const block = document.createElement('pre');
    block.className = 'rc-stream rc-repr';
    block.textContent = res.result; // repr string as text.
    out.appendChild(block);
    produced = true;
  }

  for (const src of res.images) {
    // `src` is a data: URL the worker built from base64 PNG bytes; it carries no
    // markup and cannot execute script. Rendered as an <img>.
    const img = document.createElement('img');
    img.className = 'rc-img';
    img.src = src;
    img.alt = 'Figure produced by running this code';
    img.loading = 'lazy';
    out.appendChild(img);
    produced = true;
  }

  if (!produced) {
    const note = document.createElement('p');
    note.className = 'rc-empty';
    note.textContent = 'Ran successfully with no output.';
    out.appendChild(note);
  }

  setMeta(state, `ran in ${(res.timeMs / 1000).toFixed(2)}s`, 'ok');
}

/** Render a RunError distinctly. */
function renderError(state: CellState, err: RunError): void {
  const out = state.output;
  out.replaceChildren();
  out.hidden = false;
  out.appendChild(outputHeader('Error', 'err'));
  const block = document.createElement('pre');
  block.className = 'rc-error';
  block.setAttribute('role', 'alert');
  block.textContent = [err.stderr, err.error].filter((s) => s && s.length > 0).join('\n');
  out.appendChild(block);
  setMeta(state, `error after ${(err.timeMs / 1000).toFixed(2)}s`, 'err');
}

/** Set the meta footer line text + state. */
function setMeta(state: CellState, text: string, kind: 'ok' | 'err' | 'none'): void {
  state.meta.textContent = text;
  state.meta.dataset.state = kind;
  state.meta.hidden = text.length === 0;
}

/** Execute the current code: boot on first use, run, render. */
async function doRun(pre: HTMLPreElement, state: CellState, runButton: HTMLButtonElement): Promise<void> {
  runButton.disabled = true;
  setMeta(state, '', 'none');

  // First ever Run (worker not yet booted): show the one-time boot copy.
  const firstBoot = !booted && !worker;
  if (firstBoot) {
    setStatus(state, bootStatusText, 'run');
  } else if (!booted) {
    // Worker exists but is still booting from another cell's first Run.
    setStatus(state, bootStatusText, 'run');
  } else {
    setStatus(state, 'Running...', 'run');
  }

  const code = currentCode(pre, state);

  // Cells are made editable on mount now, so `state.live` is already true here.
  // Kept as a defensive no-op in case a cell is ever run before enhance wires
  // the editor (e.g. a programmatic run).
  if (!state.live) makeEditable(pre, state);

  try {
    const res = await runInWorker(code);
    markLive(state);
    renderResult(state, res);
  } catch (e) {
    const err = e as RunError;
    markLive(state);
    renderError(state, err);
  } finally {
    runButton.disabled = false;
  }
}

/**
 * Signal that Python is booted and live. Rather than a separate "Python live"
 * status pill, we light the existing "Python" language label green (a subtle
 * glow) — a cleaner, less cluttered cue — and retire the transient status pill,
 * whose job (Editable / boot / Running…) is done once the cell is live.
 */
function markLive(state: CellState): void {
  if (state.langLabel) state.langLabel.dataset.live = 'true';
  setStatus(state, '', 'live');
}

/** Enhance one eligible `<pre>` with the runnable chrome. */
function enhance(pre: HTMLPreElement): void {
  if (pre.dataset.runnableEnhanced === 'true') return;

  const lang = (pre.dataset.language ?? '').toLowerCase();
  if (!PYTHON_LANGS.has(lang)) return;

  const original = pre.querySelector('code')?.textContent ?? '';
  if (hasNorunMarker(original)) {
    // Opt-out block: it stays a normal (copy-only) code block and never gets a
    // Run button. But the `# cortex:norun` directive is an internal marker, not
    // something the reader should see, so strip that first line from the
    // rendered code. Guarded so a View Transition re-run does not strip twice.
    if (pre.dataset.runnableNorunStripped !== 'true') {
      pre.dataset.runnableNorunStripped = 'true';
      stripNorunMarkerFromDisplay(pre);
    }
    return;
  }

  pre.dataset.runnableEnhanced = 'true';

  // Locate the `.code-block` wrapper created by `code-block.ts`. If that island
  // has not run yet (ordering), fall back to the pre's own parent so we never
  // double-wrap; code-block's own guard keeps it from re-wrapping later.
  const wrapper =
    (pre.closest('.code-block') as HTMLElement | null) ?? (pre.parentElement as HTMLElement | null);
  if (!wrapper) return;
  wrapper.classList.add('rc-cell');

  // Top bar, left to right: language label + status pill, a flexible spacer,
  // then the keyboard hint and the Run / Reset / Copy actions.
  const bar = document.createElement('div');
  bar.className = 'rc-bar';
  bar.setAttribute('data-pagefind-ignore', '');

  // Adopt the language label ("Python") that code-block.ts positioned ABSOLUTELY
  // in the top-left corner. Left floating, it overlaps the bar's status pill on
  // narrow screens ("Python" colliding with "Editable"); moved into the bar it
  // becomes a normal flex item with proper spacing. `.rc-cell` CSS neutralises
  // its absolute positioning.
  const langLabel = wrapper.querySelector<HTMLElement>('.code-block__lang');
  if (langLabel) {
    langLabel.classList.add('rc-adopted-lang');
    bar.appendChild(langLabel);
  }

  const status = document.createElement('span');
  status.className = 'rc-status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  bar.appendChild(status);

  const spacer = document.createElement('span');
  spacer.className = 'rc-spacer';
  bar.appendChild(spacer);

  // Quiet keyboard hint so the Shift+Enter run gesture is discoverable now that
  // the cell is editable from the start. Hidden from assistive tech (the run
  // button already carries the accessible label) and from narrow viewports.
  const hint = document.createElement('span');
  hint.className = 'rc-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = 'Shift+Enter to run';
  bar.appendChild(hint);

  // Group the three action buttons in their own flex container so that when the
  // bar is too narrow to fit everything on one line they wrap TOGETHER, as a
  // unit, onto a second row below the "Python / Editable" labels — rather than
  // flex-wrap breaking the group up (Copy dropping to its own line while Run and
  // Reset stay put, which looked broken).
  const actions = document.createElement('div');
  actions.className = 'rc-actions';

  const runButton = document.createElement('button');
  runButton.type = 'button';
  runButton.className = 'rc-run';
  runButton.setAttribute('aria-label', 'Run this Python code');
  runButton.appendChild(playIcon());
  const runLabel = document.createElement('span');
  runLabel.textContent = 'Run';
  runButton.appendChild(runLabel);
  actions.appendChild(runButton);

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'rc-reset';
  resetButton.textContent = 'Reset';
  resetButton.setAttribute('aria-label', 'Reset the code to the original');
  resetButton.hidden = true; // shown once the cell is live.
  actions.appendChild(resetButton);

  // Adopt the copy button that `code-block.ts` positioned absolutely in the
  // top-right corner: move it INTO the actions group so Run, Reset, and Copy
  // share one row (and wrap together). `.rc-cell` CSS neutralises its absolute
  // positioning.
  const copyButton = wrapper.querySelector<HTMLButtonElement>('.code-block__copy');
  if (copyButton) {
    copyButton.classList.add('rc-adopted-copy');
    actions.appendChild(copyButton);
  }

  bar.appendChild(actions);

  // Output region (populated on Run) and meta footer.
  const output = document.createElement('div');
  output.className = 'rc-output';
  output.setAttribute('data-pagefind-ignore', '');
  output.hidden = true;

  const meta = document.createElement('div');
  meta.className = 'rc-meta';
  meta.setAttribute('data-pagefind-ignore', '');
  meta.hidden = true;

  // The bar goes at the TOP of the wrapper; output + meta go at the BOTTOM,
  // below the <pre>, so the authored code stays visually first.
  wrapper.insertBefore(bar, wrapper.firstChild);
  wrapper.appendChild(output);
  wrapper.appendChild(meta);

  const state: CellState = {
    original,
    originalHtml: pre.querySelector('code')?.innerHTML ?? '',
    textarea: null,
    status,
    langLabel: langLabel ?? null,
    output,
    meta,
    live: false,
  };

  // Make the cell editable IMMEDIATELY (not on first Run). Previously the code
  // was read-only until the first Run, which made it look non-interactive and
  // confused readers. Entering edit mode on mount means a single click focuses
  // the code, the caret shows, and "Run" is honest: edit, then run, any time.
  makeEditable(pre, state);

  // Reflect the interactive state from the start: a neutral "Editable" pill
  // (Python is not booted yet — that happens on the first Run) and a Reset
  // button, plus a quiet "Shift+Enter to run" hint so the gesture is
  // discoverable without cluttering the bar.
  setStatus(state, 'Editable', 'idle');
  resetButton.hidden = false;

  runButton.addEventListener('click', () => {
    void doRun(pre, state, runButton);
  });

  resetButton.addEventListener('click', () => {
    // Restore the ORIGINAL highlighted code (innerHTML, so Shiki colours come
    // back) in the underlay, reset the textarea's text, then clear the output
    // and status so the cell reads as freshly reset but still live/editable.
    const code = pre.querySelector('code');
    if (code && state.originalHtml) code.innerHTML = state.originalHtml;
    if (state.textarea) {
      state.textarea.value = state.original;
      state.textarea.rows = Math.max(1, state.original.split('\n').length);
    }
    state.output.replaceChildren();
    state.output.hidden = true;
    setMeta(state, '', 'none');
  });

  // Shift+Enter in the overlay textarea runs; plain Enter inserts a newline as
  // usual. Delegated via the wrapper so it works after makeEditable adds the
  // textarea. One listener per cell.
  wrapper.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList.contains('rc-textarea')) return;
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      resetButton.hidden = false;
      void doRun(pre, state, runButton);
    }
  });

}

/** Enhance every eligible python fence in opted-in note bodies. */
function enhanceAll(): void {
  const blocks = document.querySelectorAll<HTMLPreElement>(
    '.note-body[data-runnable="true"] pre[data-language]',
  );
  blocks.forEach(enhance);
}

// Run on first load AND after every View Transition swap. The shared worker
// singleton lives at module scope, so a swap reuses the already-warm instance.
document.addEventListener('astro:page-load', enhanceAll);
