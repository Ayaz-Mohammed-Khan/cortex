/**
 * `sync-content` prebuild step.
 *
 * Mirrors the configured content root (see `src/lib/config.ts`) into the
 * project's `src/content/notes/` directory, preserving the folder hierarchy.
 *
 * What gets mirrored (design "Content sync step", Req 1.1, 1.9):
 *  - `.md` files (extension compared case-insensitively) — these become the
 *    NOTES that Astro's `notes` collection globs and ingestion turns into pages.
 *    Requirement 1.1 governs which files become Notes: only `.md`.
 *  - Referenced image/asset files (`.png .jpg .jpeg .gif .svg .webp .avif`,
 *    case-insensitive). Images are NOT content in their own right; they are
 *    staged next to the notes ONLY so that relative image references inside a
 *    note (e.g. `![](./diagram.png)`) resolve during `astro build`. Without
 *    this, Astro fails with `[UNRESOLVED_IMPORT] Module not found` when a note
 *    embeds a local image. Non-note / non-image files (`.txt`, `.json`, `.py`,
 *    `.markdown`, …) are intentionally never copied.
 *
 * Directory walking rules:
 *  - Dot-directories are skipped entirely (never recursed into): anything whose
 *    name starts with `.` — e.g. `.obsidian`, `.trash`, `.venv`, `.git`,
 *    `.makemd`, `.space`. This keeps Obsidian/vault/tooling junk out of the
 *    mirror.
 *
 * True mirror (determinism): before copying, the target `src/content/notes/`
 * is cleared of its previous contents so a build never sees stale notes from an
 * earlier sync (the directory itself is kept). The one exception is the
 * `in-place` case (the content root already IS the target) — there we must not
 * delete what we are about to read.
 *
 * Behaviour summary:
 *  - Always ensures the target directory exists.
 *  - When the content root is missing / not a directory / empty, completes
 *    cleanly, leaving an empty target so downstream globbing sees an empty set.
 *  - When the content root already resolves to the target directory, reads in
 *    place and skips copying (and clearing) onto itself.
 *
 * Run via `node scripts/sync-content.ts` (Node's native TypeScript execution).
 *
 * The core `syncContent` function is exported so it can be unit-tested in
 * isolation (with an explicit working directory and content root) without
 * spawning a subprocess. It only runs automatically when this module is the
 * entry point (i.e. executed directly via `node`).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentRoot, NOTES_TARGET_DIR } from '../src/lib/config.ts';

/** Case-insensitive `.md` extension check — decides which files become Notes. */
function isMarkdown(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.md');
}

/**
 * Image/asset extensions that are staged alongside notes so relative image
 * references in Markdown resolve at build time. These files are NOT treated as
 * content; they exist only to satisfy Astro's image import resolution.
 */
const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
] as const;

/** Case-insensitive image/asset extension check. */
function isImageAsset(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A directory is skipped entirely when its name starts with a dot. */
function isDotDirectory(name: string): boolean {
  return name.startsWith('.');
}

export interface SyncStats {
  /** Number of `.md` NOTE files copied (Requirement 1.1 content selection). */
  filesCopied: number;
  /**
   * Number of image/asset files copied. These are staged only so relative
   * image references resolve during the build; they are not Notes.
   */
  assetsCopied: number;
  /** Number of target folders created while mirroring. */
  dirsCreated: number;
}

/** Outcome of a sync run, useful for logging and tests. */
export interface SyncResult extends SyncStats {
  /** Absolute path of the resolved content root (source). */
  sourceDir: string;
  /** Absolute path of the resolved `src/content/notes` target. */
  targetDir: string;
  /** What the run actually did. */
  status: 'copied' | 'missing-source' | 'source-not-directory' | 'in-place';
}

/** Options controlling a sync run; defaults mirror the CLI behaviour. */
export interface SyncOptions {
  /** Base working directory to resolve relative paths against. */
  cwd?: string;
  /** Content root (absolute, or relative to `cwd`). Defaults to config. */
  contentRoot?: string;
  /** When true, suppress the informational console output. */
  silent?: boolean;
}

/**
 * Recursively mirror `.md` note files and referenced image assets from
 * `sourceDir` into `targetDir`, re-creating the folder structure. Dot-
 * directories are skipped entirely; all other files are ignored.
 */
function mirrorDirectory(
  sourceDir: string,
  targetDir: string,
  stats: SyncStats,
): void {
  const dirents = readdirSync(sourceDir, { withFileTypes: true });

  for (const dirent of dirents) {
    const sourcePath = join(sourceDir, dirent.name);

    if (dirent.isDirectory()) {
      // Never descend into dot-directories (`.obsidian`, `.git`, `.trash`, …):
      // they hold vault/tooling junk that must stay out of the mirror.
      if (isDotDirectory(dirent.name)) {
        continue;
      }
      const nestedTarget = join(targetDir, dirent.name);
      mirrorDirectory(sourcePath, nestedTarget, stats);
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    const isNote = isMarkdown(dirent.name);
    const isAsset = !isNote && isImageAsset(dirent.name);
    if (!isNote && !isAsset) {
      // Not a note and not an image asset → never copied.
      continue;
    }

    // Ensure the destination folder exists only when there is a file to place
    // in it, so empty category folders don't create empty mirrors.
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      stats.dirsCreated += 1;
    }

    copyFileSync(sourcePath, join(targetDir, dirent.name));
    if (isNote) {
      stats.filesCopied += 1;
    } else {
      stats.assetsCopied += 1;
    }
  }
}

/** Remove every entry inside `dir` while keeping `dir` itself in place. */
function clearDirectoryContents(dir: string): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    rmSync(join(dir, dirent.name), { recursive: true, force: true });
  }
}

/**
 * Mirror the configured content root into `src/content/notes`.
 *
 * Always ensures the target directory exists and performs a TRUE mirror: the
 * target's previous contents are cleared before copying so no stale notes
 * survive across builds. Completes cleanly (leaving an empty target) when the
 * content root is missing, is not a directory, or contains no notes/assets.
 * The `in-place` case (content root === target) reads in place and never
 * clears or copies onto itself.
 */
export function syncContent(options: SyncOptions = {}): SyncResult {
  const cwd = options.cwd ?? process.cwd();
  const contentRoot = options.contentRoot ?? getContentRoot();
  const silent = options.silent ?? false;
  const log = (message: string): void => {
    if (!silent) {
      console.log(message);
    }
  };

  const sourceDir = resolve(cwd, contentRoot);
  const targetDir = resolve(cwd, NOTES_TARGET_DIR);

  // The target directory must always exist so downstream globbing has a
  // well-defined (possibly empty) directory to read.
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const stats: SyncStats = { filesCopied: 0, assetsCopied: 0, dirsCreated: 0 };

  if (!existsSync(sourceDir)) {
    // True mirror of "nothing" ⇒ an empty target (no stale content retained).
    clearDirectoryContents(targetDir);
    log(
      `[sync-content] Content root "${contentRoot}" (resolved: ${sourceDir}) does not exist. ` +
        `Target ${NOTES_TARGET_DIR} prepared (empty); copied 0 files.`,
    );
    return { ...stats, sourceDir, targetDir, status: 'missing-source' };
  }

  if (!statSync(sourceDir).isDirectory()) {
    clearDirectoryContents(targetDir);
    log(
      `[sync-content] Content root "${contentRoot}" (resolved: ${sourceDir}) is not a directory. ` +
        `Target ${NOTES_TARGET_DIR} prepared (empty); copied 0 files.`,
    );
    return { ...stats, sourceDir, targetDir, status: 'source-not-directory' };
  }

  if (sourceDir === targetDir) {
    // Reading in place: the source IS the target, so clearing would delete the
    // very content we are meant to serve. Leave everything untouched.
    log(
      `[sync-content] Content root already resolves to ${NOTES_TARGET_DIR}; reading in place, no copy needed.`,
    );
    return { ...stats, sourceDir, targetDir, status: 'in-place' };
  }

  // True mirror: drop previous contents before copying the current source so a
  // build never sees notes deleted/renamed since the last sync.
  clearDirectoryContents(targetDir);

  mirrorDirectory(sourceDir, targetDir, stats);

  log(
    `[sync-content] Mirrored ${stats.filesCopied} Markdown file(s) and ${stats.assetsCopied} image asset(s) ` +
      `from ${sourceDir} into ${relative(cwd, targetDir) || '.'} (${stats.dirsCreated} folder(s) created).`,
  );

  return { ...stats, sourceDir, targetDir, status: 'copied' };
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
  syncContent();
}
