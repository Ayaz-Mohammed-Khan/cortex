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
 * and loads only the packages it imports (numpy, pandas, matplotlib, seaborn,
 * scipy, scikit-learn, …) from the Pyodide distribution. matplotlib uses the
 * non-interactive Agg backend so `plt.show()` yields a capturable PNG instead
 * of trying to open a window.
 */
/// <reference lib="webworker" />

import {
  PYODIDE_INDEX_URL,
  PYODIDE_VERSION,
  type RunError,
  type RunRequest,
  type RunResult,
} from '@/lib/runnable-code/protocol';

// Minimal structural type for the bits of the Pyodide API we touch. Pyodide is
// loaded from the CDN at runtime, so there is no npm types package to import.
interface PyodideAPI {
  loadPackagesFromImports(code: string): Promise<unknown>;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { get(name: string): unknown };
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
`;

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
      error: friendlyError(err),
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
