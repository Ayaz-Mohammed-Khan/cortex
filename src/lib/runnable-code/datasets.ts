/**
 * Bundled-dataset helpers for the runnable-code feature.
 *
 * Runnable Python cells load real data with `cortex_data("name")`. The Pyodide
 * worker (`src/components/pyodide-worker.ts`) cannot fetch from inside the
 * synchronous Python run, so BEFORE each run it scans the submitted code for
 * literal dataset names (like `loadPackagesFromImports` scans imports), fetches
 * those files from `/datasets/` on the site's own origin, and writes them into
 * Pyodide's virtual FS. This module holds the pure parts of that flow so they
 * can be unit-tested: the name scan, URL and FS path building, and the
 * manifest parser.
 *
 * Security: user code never forms a URL or a path. Only names that match
 * `DATASET_NAME_RE` are extracted, only names present in the manifest are
 * fetched, and the manifest (not the user) supplies the file name, which is
 * validated again before it becomes a URL.
 *
 * Pure module: no DOM, no Node, no runtime imports, so it is safe to import
 * from a Worker AND from tests. Keep it strippable: no enums, namespaces, or
 * decorators.
 *
 * Design references: `.agents/tasks/pandas-design.md` sections 1.2, 1.3, 1.7.
 */

/** Valid dataset name: lowercase snake_case, 1-64 chars, starts with a letter or digit. */
export const DATASET_NAME_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

/** Valid shipped file name: `<name>.csv`. */
const DATASET_FILE_RE = /^[a-z0-9][a-z0-9_]{0,63}\.csv$/;

/** Lowercase hex SHA-256. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Largest file the manifest may describe (Cloudflare Pages' 25 MiB asset cap). */
const MAX_DATASET_BYTES = 26_214_400;

/** Most entries a manifest may list. */
const MAX_DATASETS = 200;

/**
 * Literal `cortex_data("name")`, `cortex_data('name')`, `cortex_data(name="name")`.
 * `(?:^|[^A-Za-z0-9_])` stands in for a lookbehind word boundary: older Safari
 * workers reject lookbehind at PARSE time, which would kill the whole worker
 * module. A quote prefix letter (`f"..."`, `r"..."`) does not match, so dynamic
 * and raw strings are left to the Python helper's friendly error.
 */
const CALL_RE =
  /(?:^|[^A-Za-z0-9_])cortex_data\s*\(\s*(?:name\s*=\s*)?(["'])([a-z0-9][a-z0-9_]{0,63})\1/g;

/** Any mention of `cortex_data` as a whole word (including dynamic calls). */
const MENTION_RE = /(?:^|[^A-Za-z0-9_])cortex_data(?![A-Za-z0-9_])/;

/** One shipped dataset as the worker needs it (the manifest carries more). */
export interface DatasetEntry {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
}

/** The validated part of `public/datasets/manifest.json`. */
export interface DatasetManifest {
  version: 1;
  datasets: DatasetEntry[];
}

/**
 * Dataset names called with a literal string, unique, in first-appearance
 * order. Names outside `DATASET_NAME_RE` (capitals, dots, slashes, `..`) are
 * never returned, so the result is safe to look up in the manifest.
 */
export function extractDatasetNames(code: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  CALL_RE.lastIndex = 0;
  for (const match of code.matchAll(CALL_RE)) {
    const name = match[2];
    if (name === undefined || seen.has(name)) continue;
    // The character class already restricts the shape; the anchored check is
    // the explicit guarantee the rest of the flow relies on.
    if (!DATASET_NAME_RE.test(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * True when the code mentions `cortex_data` at all, even dynamically. The
 * worker then prepares pandas and the dataset list, so a dynamic call still
 * reaches the Python helper and gets its friendly "literal string" error.
 */
export function mentionsCortexData(code: string): boolean {
  return MENTION_RE.test(code);
}

/**
 * Root-absolute dataset URL on the given origin, with a short content hash as
 * a cache-buster (`?v=`) so a regenerated file is never served stale.
 *
 * `origin` must be the SITE origin (`self.location.origin` in the worker). In a
 * module worker `self.location` is the hashed script URL under `/_astro/`, so
 * a relative URL would wrongly resolve to `/_astro/datasets/...`.
 */
export function datasetUrl(origin: string, file: string, sha256: string): string {
  if (!DATASET_FILE_RE.test(file) || !SHA256_RE.test(sha256)) {
    throw new Error('Invalid dataset file');
  }
  return new URL(`/datasets/${file}?v=${sha256.slice(0, 12)}`, origin).href;
}

/** Where the worker writes a dataset in Pyodide's virtual FS. */
export function datasetFsPath(file: string): string {
  return `/datasets/${file}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed `manifest.json` and return the fields the worker uses.
 * Throws an `Error` describing the first violation. Extra fields (title,
 * license, source, ...) are ignored here; the manifest unit test and the build
 * script enforce them.
 */
export function parseManifest(json: unknown): DatasetManifest {
  if (!isRecord(json)) throw new Error('manifest: not an object');
  if (json.version !== 1) throw new Error('manifest: unsupported version');
  const list = json.datasets;
  if (!Array.isArray(list)) throw new Error('manifest: datasets is not an array');
  if (list.length < 1 || list.length > MAX_DATASETS) {
    throw new Error('manifest: datasets must list 1 to 200 entries');
  }
  const names = new Set<string>();
  const datasets: DatasetEntry[] = [];
  list.forEach((raw: unknown, i: number) => {
    if (!isRecord(raw)) throw new Error(`manifest: entry ${i} is not an object`);
    const { name, file, bytes, sha256 } = raw;
    if (typeof name !== 'string' || !DATASET_NAME_RE.test(name)) {
      throw new Error(`manifest: entry ${i} has an invalid name`);
    }
    if (names.has(name)) throw new Error(`manifest: duplicate name ${name}`);
    if (file !== `${name}.csv`) throw new Error(`manifest: ${name} file must be ${name}.csv`);
    if (
      typeof bytes !== 'number' ||
      !Number.isInteger(bytes) ||
      bytes < 1 ||
      bytes > MAX_DATASET_BYTES
    ) {
      throw new Error(`manifest: ${name} has an invalid byte count`);
    }
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) {
      throw new Error(`manifest: ${name} has an invalid sha256`);
    }
    names.add(name);
    datasets.push({ name, file, bytes, sha256 });
  });
  return { version: 1, datasets };
}
