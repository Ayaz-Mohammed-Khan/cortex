/**
 * `watch-content` dev auto-sync watcher.
 *
 * During `astro dev`, notes authored in the content root (`./content` by
 * default, or `$CONTENT_ROOT`) are only mirrored into `src/content/notes/` by
 * the one-shot `prebuild` step (`node scripts/sync-content.ts`). That means a
 * note added or renamed while the dev server is running does not reach the
 * directory Astro reads until the next build — new notes and their wikilinks
 * lag behind.
 *
 * This watcher closes that gap: it runs {@link syncContent} once up front and
 * then re-mirrors on every change under the content root, so the generated
 * mirror stays fresh live.
 *
 * How it complements the wikilink resolver:
 *   `src/lib/markdown/wikilink-index.ts` `createWikilinkResolver` already keeps
 *   itself fresh — before each lookup it computes a cheap `mtimeMs` signature
 *   over the notes directory and rebuilds its index when that signature
 *   changes. So this watcher's ONLY job is to keep the `src/content/notes/`
 *   mirror in sync with `content/`. Once the mirror updates here, the resolver
 *   notices the changed mtimes on the next render and re-resolves links without
 *   a server restart. No coupling between the two is needed.
 *
 * Design notes:
 *  - Dependency-free: uses Node's built-in `fs.watch(dir, { recursive: true })`.
 *    Recursive watch is supported on Windows and macOS. On Linux recursive mode
 *    may be unsupported and throws; we catch that and fall back to a simple
 *    `setInterval` re-sync (~1.5s) so the watcher still works everywhere.
 *  - Debounced: filesystem change bursts (editors write several events for one
 *    save) collapse into a single re-sync after a short quiet period.
 *  - Resilient: a transient fs error during a sync is caught and logged; the
 *    watcher never crashes the process on one.
 *
 * Run via `node scripts/watch-content.ts` (Node's native TypeScript execution).
 * It is launched alongside `astro dev` by `scripts/dev.mjs` (wired to
 * `npm run dev`).
 */
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentRoot } from '../src/lib/config.ts';
import { syncContent } from './sync-content.ts';

/** Quiet period (ms) after the last change event before we re-sync. */
const DEBOUNCE_MS = 200;
/** Fallback polling interval (ms) when recursive watch is unavailable. */
const FALLBACK_INTERVAL_MS = 1500;

const LOG_PREFIX = '[watch-content]';

/**
 * Run one sync and log a concise result line. Never throws — a transient fs
 * error is caught and logged so the watcher keeps running.
 */
function runSync(cwd: string, contentRoot: string): void {
  try {
    const result = syncContent({ cwd, contentRoot, silent: true });
    console.log(`${LOG_PREFIX} synced ${result.filesCopied} notes`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} sync failed: ${message}`);
  }
}

/**
 * Start the watcher: initial sync, then watch (or poll) the content root and
 * re-sync on change. Returns a `stop()` that tears down timers/watchers.
 */
export function startWatcher(
  cwd: string = process.cwd(),
  contentRoot: string = getContentRoot(),
): () => void {
  const sourceDir = resolve(cwd, contentRoot);

  console.log(
    `${LOG_PREFIX} watching "${contentRoot}" (resolved: ${sourceDir}) for changes...`,
  );

  // Initial mirror so the dev server starts from a fresh state.
  runSync(cwd, contentRoot);

  let debounceTimer: NodeJS.Timeout | null = null;
  const scheduleSync = (): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runSync(cwd, contentRoot);
    }, DEBOUNCE_MS);
  };

  let watcher: ReturnType<typeof watch> | null = null;
  let poller: NodeJS.Timeout | null = null;

  try {
    // Recursive watch (Windows/macOS). Throws on Linux where unsupported.
    watcher = watch(sourceDir, { recursive: true }, () => {
      scheduleSync();
    });
    watcher.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} watch error (continuing): ${message}`);
    });
  } catch {
    // Recursive watch unsupported (typically Linux) — fall back to polling.
    console.log(
      `${LOG_PREFIX} recursive watch unavailable; falling back to polling every ${FALLBACK_INTERVAL_MS}ms.`,
    );
    poller = setInterval(() => scheduleSync(), FALLBACK_INTERVAL_MS);
  }

  return function stop(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (poller) {
      clearInterval(poller);
      poller = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };
}

/** True when this module was executed directly (not imported). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  const stop = startWatcher();
  const shutdown = (): void => {
    stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
