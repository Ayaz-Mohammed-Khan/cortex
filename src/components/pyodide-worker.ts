/**
 * Pyodide Web Worker — runs user Python off the main thread.
 *
 * This is the compute half of the runnable-code feature (plan D2/D5/D6). The
 * island (`./runnable-code.ts`) owns ONE instance of this worker per page
 * session and talks to it with the message contract in
 * `@/lib/runnable-code/protocol`.
 *
 * ── Loader choice (D2) ──────────────────────────────────────────────────────
 * This worker is instantiated as a MODULE worker (`{ type: 'module' }`) so Vite
 * can bundle it from the `new URL('./pyodide-worker.ts', import.meta.url)`
 * reference into a hashed static asset at build time (no server, no npm Pyodide
 * dependency). `importScripts` is NOT available in a module worker, so instead
 * of the classic-worker `importScripts(pyodide.js)` path we dynamically
 * `import()` the ESM entry `pyodide.mjs` from the jsDelivr CDN at runtime. The
 * CDN base + version live in one constant (`PYODIDE_VERSION`) so the pin is
 * auditable. The dynamic import is written so Vite does NOT try to resolve or
 * bundle it (the URL is built at runtime), keeping Pyodide a pure runtime CDN
 * load.
 *
 * ── Safety (D3) ─────────────────────────────────────────────────────────────
 * A pandas object is returned to the island as STRUCTURED data
 * ({ columns, index, rows }), never as an `_repr_html_` string. No HTML string
 * produced by Python is ever sent to the DOM; the island rebuilds the table
 * with `createElement` + `textContent`. This is enforced here by only ever
 * extracting plain strings from Python.
 *
 * ── Packages (D5) ───────────────────────────────────────────────────────────
 * Before each run, `loadPackagesFromImports(code)` inspects the submitted code
 * and loads only the packages it imports (numpy, pandas, matplotlib, scipy,
 * scikit-learn, …) from the Pyodide distribution (seaborn is not in it). A cell
 * that calls `cortex_data` also gets pandas loaded for it (see Datasets
 * below). matplotlib uses the
 * non-interactive Agg backend so `plt.show()` yields a capturable PNG instead
 * of trying to open a window.
 *
 * ── Datasets (`cortex_data`) ────────────────────────────────────────────────
 * Cells load bundled datasets with `cortex_data("name", **read_csv_kwargs)`.
 * The Python run is synchronous, so the data is PREFETCHED here first:
 * `prepareDatasets` scans the code for literal names (pure helpers in
 * `@/lib/runnable-code/datasets`), loads pandas (even without an explicit
 * import), fetches `/datasets/manifest.json` once, downloads each missing file
 * from the SITE origin (`self.location.origin`, never relative to this hashed
 * script under `/_astro/`), and writes it into Pyodide's virtual FS at
 * `/datasets/<file>`. Files, the manifest, and the pandas load are cached for
 * the worker's lifetime, so reruns need no network. All of this finishes
 * before `executing` is posted, so it never counts against the soft run
 * timeout. Failures surface as calm, already-friendly copy (`DatasetLoadError`)
 * and every failed step is retried on the next Run.
 */
/// <reference lib="webworker" />

import {
  DATASET_MANIFEST_PATH,
  PYODIDE_INDEX_URL,
  PYODIDE_VERSION,
  type RunError,
  type RunRequest,
  type RunResult,
} from '@/lib/runnable-code/protocol';
import {
  datasetFsPath,
  datasetUrl,
  extractDatasetNames,
  mentionsCortexData,
  parseManifest,
  type DatasetEntry,
  type DatasetManifest,
} from '@/lib/runnable-code/datasets';

// Minimal structural type for the bits of the Pyodide API we touch. Pyodide is
// loaded from the CDN at runtime, so there is no npm types package to import.
interface PyodideAPI {
  loadPackagesFromImports(code: string): Promise<unknown>;
  loadPackage(names: string[]): Promise<unknown>;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { get(name: string): unknown };
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: Uint8Array): void };
}

type LoadPyodideFn = (opts: { indexURL: string }) => Promise<PyodideAPI>;

/** Lazily-created singleton: the boot promise, started on the first message. */
let pyodideReady: Promise<PyodideAPI> | null = null;

/**
 * Python harness executed once right after boot. It installs helpers used on
 * every run: an Agg matplotlib backend, stdout/stderr capture, a figure
 * collector, and a DataFrame-to-structured-data serializer. Defined in Python
 * so the extraction stays close to the objects it inspects.
 */
const SETUP_PYTHON = `
import sys, io, json, base64, os

# Force the non-interactive Agg backend so plt.show() renders to a buffer and
# never tries the interactive Pyodide/webagg backend. In a Web Worker there is
# no DOM, so matplotlib's default Pyodide backend (module://matplotlib_pyodide)
# fails with "cannot import name 'document' from 'js'". matplotlib is NOT loaded
# yet at boot (it is fetched on the first run that imports it), so we set the
# selection via the environment variable, which matplotlib reads the first time
# it is imported — this reliably pins Agg regardless of load order. We also try
# an immediate force in case matplotlib is somehow already present.
os.environ["MPLBACKEND"] = "agg"
try:
    import matplotlib
    matplotlib.use("Agg", force=True)
except Exception:
    pass

def _cortex_capture_figures():
    """Return every open matplotlib figure as a base64 PNG data URL, then close them."""
    urls = []
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return urls
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        try:
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            urls.append("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"))
        except Exception:
            pass
    plt.close("all")
    return urls

def _cortex_table(obj):
    """Serialize a pandas DataFrame/Series to {columns,index,rows} of STRINGS.

    Never returns HTML — the island rebuilds the table with text nodes only."""
    try:
        import pandas as pd
    except Exception:
        return None
    if isinstance(obj, pd.Series):
        obj = obj.to_frame()
    if not isinstance(obj, pd.DataFrame):
        return None
    df = obj
    # Cap the rendered size so a huge frame cannot flood the worker message.
    max_rows, max_cols = 200, 40
    if df.shape[0] > max_rows:
        df = df.head(max_rows)
    if df.shape[1] > max_cols:
        df = df.iloc[:, :max_cols]
    columns = [str(c) for c in df.columns.tolist()]
    index = [str(i) for i in df.index.tolist()]
    rows = [[("" if v is None else str(v)) for v in row] for row in df.values.tolist()]
    return {"columns": columns, "index": index, "rows": rows}

def _cortex_run(code):
    """Run user code with captured output; return a JSON string of the result."""
    out, err = io.StringIO(), io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = out, err
    result_repr = None
    table = None
    try:
        import ast
        parsed = ast.parse(code, mode="exec")
        last_expr = None
        if parsed.body and isinstance(parsed.body[-1], ast.Expr):
            last_expr = parsed.body.pop()
        exec(compile(parsed, "<cell>", "exec"), _CORTEX_NS)
        if last_expr is not None:
            value = eval(compile(ast.Expression(last_expr.value), "<cell>", "eval"), _CORTEX_NS)
            if value is not None:
                table = _cortex_table(value)
                if table is None:
                    result_repr = repr(value)
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    images = _cortex_capture_figures()
    return json.dumps({
        "stdout": out.getvalue(),
        "stderr": err.getvalue(),
        "result": result_repr,
        "table": table,
        "images": images,
    })

# The browser runner has no stdin: Pyodide runs in a Web Worker with no console
# to read from, so the real builtin input() fails with a cryptic
# "OSError: [Errno 29] I/O error". Replace it (and getpass) with a clear,
# teachable message that tells the reader to assign the value directly instead.
# This keeps every snippet self-contained, which is the runner's whole premise.
# A plain RuntimeError is raised (not a custom class) so the surfaced error
# reads "RuntimeError: input() isn't available ..." rather than an internal name.
def _cortex_input(prompt=""):
    raise RuntimeError(
        "input() isn't available in the browser runner (there's no console to "
        "type into). Assign the value directly instead, e.g. name = \\"Ada\\"."
    )

import builtins as _cortex_builtins
_cortex_builtins.input = _cortex_input
try:
    import getpass as _cortex_getpass
    _cortex_getpass.getpass = _cortex_input
except Exception:
    pass

# A persistent namespace so names defined in one run are visible in the next,
# matching a notebook-like session feel within a single page. input is exposed
# in the namespace too so the override is used even if a run rebinds builtins.
_CORTEX_NS = {"__name__": "__main__", "input": _cortex_input}

# Bundled datasets. This block MUST stay last: it uses json/os (imported on the
# first line), _cortex_builtins, and _CORTEX_NS, which are defined above. The
# worker installs the registry from manifest.json and writes each requested
# file into /datasets/ BEFORE the run, because the run itself is synchronous.
_CORTEX_DATASETS = {}  # name -> file, installed by the worker from manifest.json

def _cortex_set_datasets(payload):
    """Install the dataset registry (JSON {name: file}) from the worker."""
    global _CORTEX_DATASETS
    _CORTEX_DATASETS = dict(json.loads(payload))

def cortex_data(name, **read_csv_kwargs):
    """Load a bundled Cortex dataset as a pandas DataFrame (same kwargs as read_csv)."""
    import pandas as pd
    if not isinstance(name, str):
        raise TypeError('cortex_data() needs the dataset name as a string, e.g. cortex_data("ipl_matches").')
    if not _CORTEX_DATASETS:
        raise RuntimeError(
            'Write the dataset name as a literal string, e.g. cortex_data("ipl_matches"), '
            'so the runner can load it before your code starts.')
    file = _CORTEX_DATASETS.get(name)
    if file is None:
        raise ValueError("No dataset named " + repr(name) + ". Available datasets: "
                         + ", ".join(sorted(_CORTEX_DATASETS)) + ".")
    path = "/datasets/" + file
    if not os.path.exists(path):
        raise RuntimeError(
            "The dataset " + repr(name) + " was not loaded before the run. Write its name as a "
            'literal string, e.g. cortex_data("' + name + '"), and run again.')
    return pd.read_csv(path, **read_csv_kwargs)

_cortex_builtins.cortex_data = cortex_data
_CORTEX_NS["cortex_data"] = cortex_data
`;

// ── Dataset prefetch (see the header) ───────────────────────────────────────

/** A dataset-preparation failure whose message is already user-facing copy. */
class DatasetLoadError extends Error {}

/** pandas has been loaded once (cortex_data needs it even without an import). */
let pandasLoaded = false;
/** Lazily fetched + validated manifest; reset to null on any failure so the
 *  next Run retries (a parse failure only succeeds once a fixed manifest is
 *  deployed). */
let manifestPromise: Promise<DatasetManifest> | null = null;
/** The registry has been installed in Python for the current manifest. */
let registryInstalled = false;
/** Dataset names already written into the virtual FS. */
const written = new Set<string>();
/** In-flight downloads, so two cells starting at once share one fetch. */
const inflight = new Map<string, Promise<void>>();
/** `/datasets` exists in the virtual FS. */
let fsDirReady = false;

/** Fetch and validate the manifest once per worker (retried after failure). */
function getManifest(): Promise<DatasetManifest> {
  if (manifestPromise) return manifestPromise;
  const url = new URL(DATASET_MANIFEST_PATH, self.location.origin).href;
  const attempt = (async (): Promise<DatasetManifest> => {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
    } catch (err) {
      console.warn('[cortex] dataset manifest fetch failed', err);
      throw new DatasetLoadError("Couldn't load the dataset list. Check your connection and run again.");
    }
    if (!res.ok) {
      console.warn('[cortex] dataset manifest fetch failed', res.status);
      throw new DatasetLoadError("Couldn't load the dataset list. Check your connection and run again.");
    }
    try {
      return parseManifest(await res.json());
    } catch (err) {
      console.error('[cortex] dataset manifest is invalid', err);
      throw new DatasetLoadError("The dataset list is invalid, so datasets can't be loaded right now.");
    }
  })();
  manifestPromise = attempt;
  attempt.catch(() => {
    if (manifestPromise === attempt) manifestPromise = null;
  });
  return attempt;
}

/** Download one dataset and write it into the virtual FS (shared if in flight). */
function fetchAndWrite(pyodide: PyodideAPI, entry: DatasetEntry): Promise<void> {
  const existing = inflight.get(entry.name);
  if (existing) return existing;
  const job = (async (): Promise<void> => {
    const url = datasetUrl(self.location.origin, entry.file, entry.sha256);
    let res: Response;
    try {
      res = await fetch(url, { credentials: 'same-origin' });
    } catch (err) {
      console.warn('[cortex] dataset fetch failed', url, err);
      throw new DatasetLoadError(
        `Couldn't download the dataset "${entry.name}". Check your connection and run again.`,
      );
    }
    if (!res.ok) {
      console.warn('[cortex] dataset fetch failed', url, res.status);
      throw new DatasetLoadError(
        `Couldn't download the dataset "${entry.name}" (HTTP ${res.status}). Check your connection and run again.`,
      );
    }
    let buffer: ArrayBuffer;
    try {
      buffer = await res.arrayBuffer();
    } catch (err) {
      console.warn('[cortex] dataset read failed', url, err);
      throw new DatasetLoadError(
        `Couldn't download the dataset "${entry.name}". Check your connection and run again.`,
      );
    }
    if (buffer.byteLength !== entry.bytes) {
      console.warn('[cortex] dataset size mismatch', url, entry.bytes, buffer.byteLength);
      throw new DatasetLoadError(
        `The dataset "${entry.name}" did not download completely. Run again to retry.`,
      );
    }
    try {
      if (!fsDirReady) {
        pyodide.FS.mkdirTree('/datasets');
        fsDirReady = true;
      }
      pyodide.FS.writeFile(datasetFsPath(entry.file), new Uint8Array(buffer));
    } catch (err) {
      console.error('[cortex] dataset FS write failed', err);
      throw err;
    }
    written.add(entry.name);
  })();
  inflight.set(entry.name, job);
  // Drop the entry when settled: success is then answered by `written`, and a
  // failure is retried by the next Run.
  void job.then(
    () => inflight.delete(entry.name),
    () => inflight.delete(entry.name),
  );
  return job;
}

/**
 * Make every dataset the code names available in the FS before the run.
 * Posts `loading-data` once, up front, only when network work is pending.
 */
async function prepareDatasets(pyodide: PyodideAPI, req: RunRequest): Promise<void> {
  if (!mentionsCortexData(req.code)) return;
  const names = extractDatasetNames(req.code);

  // Decide whether network work is pending BEFORE awaiting anything. Until the
  // manifest is known, `!pandasLoaded || manifest unresolved` already holds on
  // every first-run path, so one check here covers them all.
  // `registryInstalled` implies the manifest promise has already resolved, so
  // this await settles immediately and never waits on the network.
  const known: DatasetManifest | null =
    manifestPromise && registryInstalled ? await manifestPromise.catch(() => null) : null;
  const needsNetwork =
    !pandasLoaded ||
    known === null ||
    names.some((n) => known.datasets.some((d) => d.name === n) && !written.has(n));
  if (needsNetwork) {
    self.postMessage({ type: 'status', phase: 'loading-data', id: req.id });
  }

  if (!pandasLoaded) {
    try {
      await pyodide.loadPackage(['pandas']);
    } catch (err) {
      console.warn('[cortex] pandas load failed', err);
      throw new DatasetLoadError(
        "Couldn't load pandas, which cortex_data() needs. Check your connection and run again.",
      );
    }
    pandasLoaded = true;
  }

  const manifest = await getManifest();
  if (!registryInstalled) {
    const registry: Record<string, string> = {};
    for (const d of manifest.datasets) registry[d.name] = d.file;
    const install = pyodide.globals.get('_cortex_set_datasets') as (payload: string) => void;
    install(JSON.stringify(registry));
    registryInstalled = true;
  }

  const byName = new Map(manifest.datasets.map((d) => [d.name, d] as const));
  const missing: DatasetEntry[] = [];
  for (const n of names) {
    const entry = byName.get(n);
    // Unknown names are skipped: the Python helper raises the friendly
    // "No dataset named ..." error listing what is available.
    if (entry && !written.has(n)) missing.push(entry);
  }
  await Promise.all(missing.map((entry) => fetchAndWrite(pyodide, entry)));
}

/** Boot Pyodide once: dynamic-import the ESM entry from the CDN, then setup. */
async function bootPyodide(): Promise<PyodideAPI> {
  self.postMessage({ type: 'status', phase: 'booting' });

  // Build the ESM entry URL at runtime so Vite leaves the import alone (it must
  // NOT be bundled — Pyodide is a pure CDN load). The `/* @vite-ignore */` hint
  // plus a computed specifier keeps the bundler out of it.
  const entry = `${PYODIDE_INDEX_URL}pyodide.mjs`;
  const mod = (await import(/* @vite-ignore */ entry)) as { loadPyodide: LoadPyodideFn };
  const pyodide = await mod.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  await pyodide.runPythonAsync(SETUP_PYTHON);

  self.postMessage({ type: 'status', phase: 'ready' });
  return pyodide;
}

/** Trim a Python traceback to something friendly but still useful. */
function friendlyError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw);
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  // The last non-empty line is usually "ExceptionType: message" — show that
  // plus a little context if present, rather than the full internal trace.
  if (lines.length <= 6) return text.trim();
  return lines.slice(-6).join('\n');
}

/** Handle one run request end to end and post back a RunResult / RunError. */
async function handleRun(req: RunRequest): Promise<void> {
  // Reset to the moment user code actually starts (just before the `executing`
  // signal) so `timeMs` reports execution time, excluding boot + package load.
  let started = performance.now();
  try {
    if (!pyodideReady) pyodideReady = bootPyodide();
    const pyodide = await pyodideReady;

    // D5: load only the packages the submitted code imports. First-time loads
    // fetch wheels from the CDN and can take tens of seconds for heavy
    // libraries (matplotlib and friends); this happens BEFORE we signal
    // `executing`, so the island does not charge that download time against the
    // per-run soft timeout.
    try {
      await pyodide.loadPackagesFromImports(req.code);
    } catch {
      // A failed package autoload should not abort the run outright — the code
      // may still run (or will raise a clear ImportError we surface below).
    }

    // Datasets named in `cortex_data("...")` calls: load pandas, fetch the
    // manifest and any missing files into the FS. Also BEFORE `executing`, so
    // the download is never charged against the run timeout.
    await prepareDatasets(pyodide, req);

    // Packages are ready; the next thing is the user's actual code. Tell the
    // island to START the run timeout now (boot + package download excluded),
    // and reset the execution clock so `timeMs` measures only the run.
    started = performance.now();
    self.postMessage({ type: 'status', phase: 'executing', id: req.id });

    // Stash the user's code string in a Python global, then run the harness.
    pyodide.globals.get; // (no-op reference; keeps the API type exercised)
    const runner = pyodide.globals.get('_cortex_run') as
      | ((code: string) => Promise<unknown>)
      | undefined;
    let payload: string;
    if (typeof runner === 'function') {
      payload = String(await runner(req.code));
    } else {
      // Fallback: should not happen once setup ran, but stay defensive.
      payload = String(
        await pyodide.runPythonAsync(`_cortex_run(${JSON.stringify(req.code)})`),
      );
    }

    const parsed = JSON.parse(payload) as {
      stdout: string;
      stderr: string;
      result: string | null;
      table: RunResult['table'];
      images: string[];
    };

    const result: RunResult = {
      id: req.id,
      ok: true,
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      result: parsed.result,
      table: parsed.table,
      images: parsed.images,
      timeMs: Math.round(performance.now() - started),
    };
    self.postMessage(result);
  } catch (err) {
    const error: RunError = {
      id: req.id,
      ok: false,
      error: err instanceof DatasetLoadError ? err.message : friendlyError(err),
      stderr: '',
      timeMs: Math.round(performance.now() - started),
    };
    self.postMessage(error);
  }
}

self.addEventListener('message', (event: MessageEvent<RunRequest>) => {
  const req = event.data;
  if (!req || typeof req.code !== 'string' || typeof req.id !== 'number') return;
  void handleRun(req);
});

// Touch the version constant so a tree-shaking pass cannot drop the pin from
// the emitted chunk (useful when auditing the built asset).
void PYODIDE_VERSION;
