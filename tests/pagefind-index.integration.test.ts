import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pagefindIndexer from 'pagefind';

/**
 * Pagefind index integration test (task 18.3; Req 6.1, 6.2).
 *
 * WHAT THIS VALIDATES
 * -------------------
 * - Req 6.1: the build's Search_Index maps terms from each Note's title,
 *   Category path, and body text to that Note. This test asserts that a term
 *   taken from *each* of those three regions retrieves the expected Note.
 * - Req 6.2: matching Notes are ranked by relevance so a Note with more query
 *   term matches ranks before one with fewer.
 *
 * These are behaviors of the Pagefind engine combined with our page markup
 * wiring (the `data-pagefind-body` region plus the `data-pagefind-meta`
 * `displayName` / `categoryPath` markers emitted by `NoteContent.astro`), not
 * of our own pure logic — so per the design's Testing Strategy this is an
 * example-based integration test rather than a property test.
 *
 * APPROACH (documented per task guidance)
 * ---------------------------------------
 * A full `astro build` inside the unit-test runtime is slow and drags in the
 * whole content pipeline, so instead we drive the exact two moving parts that
 * production uses:
 *
 *   1. INDEXER — the `pagefind` NodeJS package (the same binary the
 *      `postbuild: pagefind --site dist` script runs) indexes a few in-memory
 *      fixture note pages. Each fixture reproduces the markup `NoteContent.astro`
 *      emits: an `<article data-pagefind-body>` whose
 *      `<h1 data-pagefind-meta="displayName">` holds the title, followed by a
 *      `data-pagefind-meta="categoryPath"` element carrying the Category path,
 *      then the body. The built bundle is written to a temp directory.
 *
 *   2. SEARCH RUNTIME — the `pagefind.js` that ships inside that bundle is
 *      loaded and queried, exactly as the browser search island does.
 *
 * Pagefind's search runtime is browser-oriented: there is no separate "Node
 * search" API (the Node package only *builds* indexes). The runtime fetches its
 * bundle assets (`pagefind-entry.json`, the wasm, and per-query `index/` +
 * `fragment/` chunks) over `fetch` and runs the query in WebAssembly. To drive
 * it from Node we:
 *   - install a `globalThis.fetch` shim that serves the written bundle files
 *     from disk (the runtime requests them under the `/pagefind/` base path);
 *   - import the runtime through Node's native ESM loader (bypassing Vite) from
 *     a `.mjs` copy so it is unambiguously an ES module regardless of the temp
 *     directory's package scope.
 * The runtime detects there is no `Worker` in jsdom and runs on the main
 * thread, decoding the index and instantiating the wasm from the fetched bytes
 * — no browser required.
 */

// --- Fixture note pages ---------------------------------------------------
//
// Distinct sentinel tokens are each placed in exactly ONE region of ONE fixture
// so that a hit unambiguously proves retrieval via that region:
//   - "backpropagation" -> only in Note A's TITLE
//   - "optimization"    -> only in Note A's CATEGORY PATH
//   - "mitochondria"    -> only in Note A's BODY
//   - "gradient"        -> many times in Note A's body, once in Note B's body
//     (drives the relevance-ranking assertion), and never in Note C.

const NOTE_A_URL = '/notes/ai-ml/optimization/backpropagation/';
const NOTE_B_URL = '/notes/biology/cells/respiration/';
const NOTE_C_URL = '/notes/misc/overview/';

const NOTE_A_NAME = 'Backpropagation';
const NOTE_B_NAME = 'Cellular Respiration';
const NOTE_C_NAME = 'General Overview';

/** Build a note page mirroring the markup `NoteContent.astro` emits. */
function notePage(opts: { title: string; categoryPath: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${opts.title}</title></head>
  <body>
    <article data-pagefind-body>
      <h1 data-pagefind-meta="displayName">${opts.title}</h1>
      <span class="sr-only" data-pagefind-meta="categoryPath">${opts.categoryPath}</span>
      <div class="note-body">${opts.body}</div>
    </article>
  </body>
</html>`;
}

const NOTE_A = notePage({
  title: NOTE_A_NAME,
  categoryPath: 'AI-ML / Optimization',
  body: `<p>Error signals travel backward across every layer of the network.
    gradient gradient gradient gradient gradient gradient gradient gradient
    steer the descent toward a lower loss.</p>
    <p>The word mitochondria is embedded here only as a unique body marker.</p>`,
});

const NOTE_B = notePage({
  title: NOTE_B_NAME,
  categoryPath: 'Biology / Cells',
  body: `<p>Cells convert nutrients into usable chemical energy through a long
    series of controlled reactions across specialized membranes. A single proton
    gradient assists the final synthesis step, and this page deliberately keeps
    plenty of unrelated surrounding text so the shared token stays sparse.</p>`,
});

const NOTE_C = notePage({
  title: NOTE_C_NAME,
  categoryPath: 'Misc / Notes',
  body: `<p>An unrelated overview covering tooling, formatting, and general
    housekeeping topics, with no shared search tokens at all.</p>`,
});

// --- Bundle location + fetch shim ----------------------------------------

let tmpRoot: string;
let bundleDir: string;
let originalFetch: typeof globalThis.fetch | undefined;
// The loaded Pagefind search runtime (browser API surface); typed loosely.
let runtime: {
  options: (o: Record<string, unknown>) => Promise<void>;
  init: () => Promise<void>;
  search: (term: string) => Promise<{ results: Array<{ data: () => Promise<PagefindData> }> }>;
  destroy?: () => Promise<void>;
};

interface PagefindData {
  url: string;
  meta?: Record<string, string>;
}

/**
 * Minimal `fetch` implementation serving the built Pagefind bundle from disk.
 * The runtime requests assets under the `/pagefind/` base path (with a `?ts=`
 * cache-buster on the entry file); we map the path after `/pagefind/` onto the
 * temp bundle directory and return a Response-like object exposing just the
 * `json()` / `arrayBuffer()` / `text()` methods the runtime uses.
 */
function pagefindFetch(input: unknown): Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}> {
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : ((input as { url?: string })?.url ?? String(input));
  const pathPart = raw.split('?')[0];
  const marker = '/pagefind/';
  const markerAt = pathPart.indexOf(marker);
  const rel = markerAt >= 0 ? pathPart.slice(markerAt + marker.length) : pathPart.replace(/^\/+/, '');
  const filePath = join(bundleDir, rel);

  if (!existsSync(filePath)) {
    return Promise.resolve({
      ok: false,
      status: 404,
      arrayBuffer: () => Promise.reject(new Error(`404: ${filePath}`)),
      json: () => Promise.reject(new Error(`404: ${filePath}`)),
      text: () => Promise.reject(new Error(`404: ${filePath}`)),
    });
  }

  const buf = readFileSync(filePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(ab),
    json: () => Promise.resolve(JSON.parse(buf.toString('utf-8'))),
    text: () => Promise.resolve(buf.toString('utf-8')),
  });
}

/** Run a query and return each result's `{ displayName, url }` in ranked order. */
async function resultsFor(query: string): Promise<Array<{ displayName: string; url: string }>> {
  const search = await runtime.search(query);
  const data = await Promise.all(search.results.map((r) => r.data()));
  return data.map((d) => ({ displayName: String(d.meta?.displayName ?? ''), url: d.url }));
}

beforeAll(async () => {
  // Keep the temp bundle inside the project root so (a) importing the runtime
  // stays within Vite's allowed filesystem scope and (b) the project's
  // `type: module` package scope applies. It is removed in `afterAll`.
  tmpRoot = mkdtempSync(join(process.cwd(), '.pagefind-it-'));
  bundleDir = join(tmpRoot, 'pagefind');

  // 1. Build a real Pagefind index from the fixture pages.
  const { index, errors } = await pagefindIndexer.createIndex();
  if (errors?.length || !index) {
    throw new Error(`Pagefind createIndex failed: ${errors?.join('; ')}`);
  }
  for (const [url, content] of [
    [NOTE_A_URL, NOTE_A],
    [NOTE_B_URL, NOTE_B],
    [NOTE_C_URL, NOTE_C],
  ] as const) {
    const res = await index.addHTMLFile({ url, content });
    if (res.errors?.length) {
      throw new Error(`addHTMLFile failed for ${url}: ${res.errors.join('; ')}`);
    }
  }
  const write = await index.writeFiles({ outputPath: bundleDir });
  if (write.errors?.length) {
    throw new Error(`writeFiles failed: ${write.errors.join('; ')}`);
  }
  await pagefindIndexer.close();

  const runtimeJs = join(bundleDir, 'pagefind.js');
  if (!existsSync(runtimeJs)) {
    throw new Error('pagefind.js was not written into the bundle');
  }

  // 2. Serve the bundle over a fetch shim and load the runtime as native ESM.
  originalFetch = globalThis.fetch;
  globalThis.fetch = pagefindFetch as unknown as typeof globalThis.fetch;

  // An English `lang` makes the runtime load the English index + segmenter,
  // matching how the fixtures were indexed (`<html lang="en">`).
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = 'en';
  }

  // Copy to `.mjs` so the file is unambiguously ES module, then import it via a
  // file URL. The runtime has no static imports and reads its globals
  // (`fetch`, `WebAssembly`, `window`/`document`) from the shared global, so it
  // runs unchanged under the test module loader.
  const runtimeMjs = join(bundleDir, 'pagefind.mjs');
  copyFileSync(runtimeJs, runtimeMjs);
  runtime = (await import(/* @vite-ignore */ pathToFileURL(runtimeMjs).href)) as typeof runtime;

  // Point the runtime at our base path and keep it on the main thread.
  await runtime.options({ basePath: '/pagefind/', noWorker: true });
  await runtime.init();
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.destroy?.();
  } catch {
    /* ignore */
  }
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
  try {
    await pagefindIndexer.close();
  } catch {
    /* ignore */
  }
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe('Pagefind index retrieval and ranking (task 18.3)', () => {
  it('retrieves a Note by a term from its title (Req 6.1)', async () => {
    const hits = await resultsFor('backpropagation');
    expect(hits.map((h) => h.displayName)).toContain(NOTE_A_NAME);
    expect(hits.map((h) => h.url)).toContain(NOTE_A_URL);
  }, 30_000);

  it('retrieves a Note by a term from its Category path (Req 6.1)', async () => {
    const hits = await resultsFor('optimization');
    expect(hits.map((h) => h.displayName)).toContain(NOTE_A_NAME);
    expect(hits.map((h) => h.url)).toContain(NOTE_A_URL);
  }, 30_000);

  it('retrieves a Note by a term from its body text (Req 6.1)', async () => {
    const hits = await resultsFor('mitochondria');
    expect(hits.map((h) => h.displayName)).toContain(NOTE_A_NAME);
    expect(hits.map((h) => h.url)).toContain(NOTE_A_URL);
  }, 30_000);

  it('ranks Notes with more query-term matches first (Req 6.2)', async () => {
    const hits = await resultsFor('gradient');
    const names = hits.map((h) => h.displayName);

    // Both A (many matches) and B (one match) match; C does not.
    expect(names).toContain(NOTE_A_NAME);
    expect(names).toContain(NOTE_B_NAME);
    expect(names).not.toContain(NOTE_C_NAME);

    // Higher match count ranks first (Req 6.2).
    expect(names[0]).toBe(NOTE_A_NAME);
    expect(names.indexOf(NOTE_A_NAME)).toBeLessThan(names.indexOf(NOTE_B_NAME));
  }, 30_000);
});
