/**
 * Shared message contract for the runnable-code feature.
 *
 * Single-sources the request/response shape exchanged between the island
 * (`src/components/runnable-code.ts`, runs on the main thread) and the Pyodide
 * Web Worker (`src/components/pyodide-worker.ts`). Importing these types in both
 * places keeps the contract from drifting.
 *
 * This module is pure types + constants — no runtime imports, no DOM, no Node —
 * so it is safe to import from a Worker context AND from `node --strip-types`
 * tooling. Keep it strippable: no enums, namespaces, or decorators.
 *
 * Design references: plan steps D6 (message shape) and D2 (version pin).
 */

/**
 * Pinned Pyodide version. The worker builds every CDN URL from this single
 * constant so the pin is auditable in one place. Confirmed stable on jsDelivr
 * (https://cdn.jsdelivr.net/pyodide/v0.29.3/full/) at implementation time.
 *
 * If a CSP is ever added to the site, it must allow `https://cdn.jsdelivr.net`
 * for `script-src` / `connect-src` / `worker-src` for this to keep working.
 */
export const PYODIDE_VERSION = '0.29.3';

/** CDN base URL for the pinned Pyodide distribution (full build). */
export const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/** The `indexURL` Pyodide needs to resolve its own assets and packages. */
export const PYODIDE_INDEX_URL = PYODIDE_CDN_BASE;

/** Entry script Pyodide exposes for the classic `importScripts` loader. */
export const PYODIDE_LOADER_URL = `${PYODIDE_CDN_BASE}pyodide.js`;

/** Soft run timeout (ms). See D6 — a shared worker cannot be hard-terminated
 *  per run without killing sibling cells, so the island enforces this as a soft
 *  timeout that reports a friendly message and leaves the worker usable. */
export const RUN_TIMEOUT_MS = 15_000;

/** The exact one-time boot copy shown in the status pill on the first Run.
 *  House style: straight quotes, three literal dots, no em dash. */
export const BOOT_STATUS_TEXT = 'Warming up Python... this happens once.';

/** Status pill copy while datasets (and pandas) download for `cortex_data`.
 *  House style: three literal dots, no em dash. */
export const DATASET_STATUS_TEXT = 'Loading dataset...';

/** Root-absolute path the bundled datasets are served from
 *  (`public/datasets/` is copied to `/datasets/` by Astro). */
export const DATASETS_PATH = '/datasets/';

/** Root-absolute path of the dataset manifest the worker fetches lazily. */
export const DATASET_MANIFEST_PATH = '/datasets/manifest.json';

/**
 * A pandas DataFrame (or Series) extracted as STRUCTURED data, never as a raw
 * HTML string. The island rebuilds a `<table>` from these fields using
 * `document.createElement` + `textContent` only, so no untrusted HTML from
 * Python output is ever parsed into the DOM (see D3).
 */
export interface DataFrameTable {
  /** Column headers, already stringified in Python. */
  columns: string[];
  /** Row index labels, already stringified in Python. */
  index: string[];
  /** Cell values as strings, row-major; `rows[r][c]` aligns to `index[r]` /
   *  `columns[c]`. */
  rows: string[][];
  /** The FULL size of the original frame as `[rows, columns]`, before any
   *  truncation. Optional so older payloads and tests stay valid. */
  shape?: [number, number];
  /** True when the worker cut the frame down pandas-style (first and last rows
   *  with a "..." gap row, and/or a "..." gap column). The "..." cells are then
   *  part of `rows` / `columns` / `index`. */
  truncated?: boolean;
}

/** Island → worker: run this code. `id` correlates the response. */
export interface RunRequest {
  id: number;
  code: string;
}

/**
 * Worker → island: progress signals.
 *
 * `booting`/`ready` bracket the one-time Pyodide boot (first run only).
 * `executing` is posted (with the run's `id`) once per run, immediately before
 * the user's code actually runs — i.e. AFTER `loadPackagesFromImports` has
 * finished fetching any first-time packages from the CDN. The island arms its
 * per-run soft timeout on `executing`, so neither the boot nor the one-time
 * package download (which can take tens of seconds for heavy libraries like
 * matplotlib) is charged against the 15s RUN limit — the limit guards runaway
 * user code, not infrastructure downloads (D6).
 *
 * `loading-data` is posted at most once per run, only when dataset preparation
 * for `cortex_data(...)` needs the network (pandas not yet loaded, dataset list
 * not yet fetched, or a dataset file not yet downloaded), and always BEFORE
 * `executing`. Dataset downloads therefore never count against the run limit
 * either.
 */
export interface StatusMessage {
  type: 'status';
  phase: 'booting' | 'ready' | 'loading-data' | 'executing';
  /** Present for `loading-data` and `executing`: the run id the status belongs to. */
  id?: number;
}

/** Worker → island: a successful run. */
export interface RunResult {
  id: number;
  ok: true;
  /** Captured stdout text (may be empty). */
  stdout: string;
  /** Captured stderr text (may be empty). */
  stderr: string;
  /** `repr()` of the last expression, or null when there was none. */
  result: string | null;
  /** A pandas DataFrame/Series rendered to structured data, or null. */
  table: DataFrameTable | null;
  /** Matplotlib figures as `data:image/png;base64,...` URLs. */
  images: string[];
  /** Wall-clock run time in milliseconds (excludes first-run boot). */
  timeMs: number;
}

/** Worker → island: a failed run (Python error or load failure). */
export interface RunError {
  id: number;
  ok: false;
  /** Friendly, already-formatted error text (e.g. a trimmed traceback). */
  error: string;
  /** Any stderr captured before the failure. */
  stderr: string;
  /** Wall-clock time spent before failing, in milliseconds. */
  timeMs: number;
}

/** Every message the worker can post back to the island. */
export type WorkerMessage = StatusMessage | RunResult | RunError;
