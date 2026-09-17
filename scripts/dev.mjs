/**
 * `dev` launcher — runs the content watcher and `astro dev` together.
 *
 * `npm run dev` needs to run TWO long-lived processes concurrently without
 * pulling in a dependency like `concurrently`:
 *   1. `node scripts/watch-content.ts` — keeps `src/content/notes/` mirrored
 *      from `content/` live (so new/renamed notes appear without a restart).
 *   2. `astro dev` — the dev server itself.
 *
 * This tiny launcher spawns both as children of the current Node process:
 *   - The watcher's stdio is inherited so its `[watch-content] synced N notes`
 *     lines show up in the same terminal.
 *   - Astro dev runs in the foreground (inherited stdio) and owns the terminal.
 *   - `CONTENT_ROOT` is forwarded to both children via the inherited env.
 *
 * Clean shutdown: Ctrl+C (SIGINT) / SIGTERM tear down BOTH children before the
 * launcher exits, and if either child exits on its own the other is killed so
 * we never leave an orphaned watcher or server behind.
 *
 * Cross-platform: children are spawned with `process.execPath` (this Node) and
 * explicit args, `shell: false`. Astro is invoked through its Node CLI entry so
 * no `.cmd`/shell resolution is needed on Windows/PowerShell.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

/** Env inherited by both children (forwards CONTENT_ROOT and everything else). */
const childEnv = process.env;

const children = [];
let shuttingDown = false;

/** Kill every live child once (idempotent). */
function killAll() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killAll();
  process.exit(code);
}

// 1. Content watcher — inherit stdio so its sync logs are visible.
// `--experimental-strip-types` makes the `.ts` watcher run on every Node >= 22
// minor: it is REQUIRED on 22.6–22.17 (where strip-types is opt-in) and a
// harmless no-op on 22.18+/23+/25 where type-stripping is already the default.
const watcher = spawn(
  process.execPath,
  ['--experimental-strip-types', resolve(__dirname, 'watch-content.ts')],
  { cwd: projectRoot, env: childEnv, stdio: 'inherit', shell: false },
);
children.push(watcher);

// 2. astro dev — invoke Astro's Node CLI entry directly (no shell needed).
const astroBin = resolve(projectRoot, 'node_modules', 'astro', 'astro.js');
const astro = spawn(process.execPath, [astroBin, 'dev'], {
  cwd: projectRoot,
  env: childEnv,
  stdio: 'inherit',
  shell: false,
});
children.push(astro);

// If either child exits, bring the whole dev session down cleanly.
watcher.on('exit', (code) => {
  if (!shuttingDown) {
    console.error('[dev] watcher exited; shutting down.');
    shutdown(code ?? 0);
  }
});
astro.on('exit', (code) => {
  if (!shuttingDown) {
    shutdown(code ?? 0);
  }
});

// Ctrl+C and termination signals kill both children before we exit.
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
