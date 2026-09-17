/**
 * Build-time wikilink resolution index (Task 3).
 *
 * Walks the synced content collection on disk (`src/content/notes/**\/*.md`)
 * and REUSES the pure ingestion pipeline (`src/lib/ingest/*`) to derive every
 * published note's `{ displayName, route, sourcePath }` — exactly the same
 * Slug/route rules the site build uses. From that it builds a normalized
 * `name -> route` Map keyed by BOTH the note Display_Name and the file basename
 * so `[[01 - Descriptive Statistics|…]]` and `[[Descriptive Statistics]]` both
 * resolve.
 *
 * This runs synchronously at Astro config load. The `prebuild` sync step
 * (`scripts/sync-content.ts`) populates `src/content/notes` before `astro build`
 * loads the config, so the directory is present. If it is missing (e.g. a bare
 * `astro check` before a sync), the walk yields nothing and every wikilink is
 * simply reported as unresolved rather than throwing.
 *
 * ## Root pinning
 *
 * Mirrors `src/lib/content.ts`: because all notes currently live under a single
 * top-level folder, `buildTree` would otherwise absorb that folder as the
 * content root and drop it from every route. A single phantom note placed
 * directly in the notes base directory pins the root; it is filtered out of the
 * produced index. Keeping this in lockstep with `content.ts` guarantees the
 * routes we resolve wikilinks to are byte-for-byte the routes the site emits.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, posix, basename } from 'node:path';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { ingest, type NoteReader, type NoteSource } from '../ingest/ingest';
import type { RawNode } from '../ingest/types';
import { NOTES_SECTION_SLUG } from '../section';
import { normalizeName } from './remark-wikilinks';

/** Synthetic root under which every note path is re-anchored (see content.ts). */
const SYNTHETIC_ROOT = '/__notes_root__';
/** Phantom note that pins the content root to the notes base directory. */
const PHANTOM_SOURCE_PATH = `${SYNTHETIC_ROOT}/__phantom_root_marker__.md`;
/** Display name / landing label for the notes section (matches content.ts). */
const NOTES_DISPLAY_NAME = 'Notes';

/** Default on-disk location of the synced notes collection. */
const NOTES_DIR = join(process.cwd(), 'src', 'content', 'notes');

/** One discovered markdown file: its synthetic path + real disk path. */
interface DiscoveredNote {
  /** Path re-anchored under {@link SYNTHETIC_ROOT} (drives tree assembly). */
  syntheticPath: string;
  /** Absolute path on disk (used to read frontmatter). */
  realPath: string;
  /** File basename without the `.md` extension (a wikilink lookup key). */
  baseName: string;
}

/**
 * A fully-derived per-note record: the site-accurate `{ route, displayName }`
 * (from the same ingestion pipeline the build uses) paired with the note's
 * on-disk `realPath` and file `baseName`. Only published notes are included.
 *
 * Exposed so the backlink builder (`backlink-index.ts`) can map every SOURCE
 * file to its own route/display name using EXACTLY the resolution the render
 * pipeline uses, without duplicating the ingest walk here.
 */
export interface NoteRecord {
  /** Absolute route the site emits for this note, e.g. `/notes/ai-ml/foo`. */
  route: string;
  /** Note Display_Name (prefix-stripped). */
  displayName: string;
  /** Absolute path on disk (used to read the note body). */
  realPath: string;
  /** File basename without the `.md` extension. */
  baseName: string;
}

/** Recursively collect every `.md` file under `dir`. */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...walkMarkdown(full));
    } else if (dirent.isFile() && /\.md$/i.test(dirent.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Derive the site-accurate per-note records ({@link NoteRecord}) for every
 * PUBLISHED note under `notesDir`, using the same ingestion pipeline + root
 * pinning the real build uses. Returns an empty array when the directory is
 * absent. Shared by {@link buildWikilinkIndex} and the backlink builder so
 * route/display-name derivation lives in exactly one place.
 */
export function buildNoteRecords(notesDir: string = NOTES_DIR): NoteRecord[] {
  if (!existsSync(notesDir)) return [];

  const discovered: DiscoveredNote[] = walkMarkdown(notesDir).map((realPath) => {
    // Re-anchor `…/src/content/notes/AI-ML/foo.md` -> `/__notes_root__/AI-ML/foo.md`.
    const rel = posix.relative(
      toPosix(notesDir),
      toPosix(realPath),
    );
    return {
      syntheticPath: `${SYNTHETIC_ROOT}/${rel}`,
      realPath,
      baseName: basename(realPath).replace(/\.md$/i, ''),
    };
  });

  const bySyntheticPath = new Map<string, DiscoveredNote>();
  const rawNodes: RawNode[] = [];
  for (const note of discovered) {
    bySyntheticPath.set(note.syntheticPath, note);
    rawNodes.push({
      absPath: note.syntheticPath,
      rawName: posix.basename(note.syntheticPath),
      isNote: true,
    });
  }

  // Phantom root-pinning note (filtered out of the records below).
  rawNodes.push({
    absPath: PHANTOM_SOURCE_PATH,
    rawName: posix.basename(PHANTOM_SOURCE_PATH),
    isNote: true,
  });

  const readNote: NoteReader = (node): NoteSource | null => {
    if (node.absPath === PHANTOM_SOURCE_PATH) {
      return { body: '', published: false };
    }
    const note = bySyntheticPath.get(node.absPath);
    if (!note) return null;
    // Only the `published` flag matters here; default to published.
    let published = true;
    try {
      const { frontmatter } = parseFrontmatter(readFileSync(note.realPath, 'utf8'));
      if (frontmatter && (frontmatter as { published?: unknown }).published === false) {
        published = false;
      }
    } catch {
      // Unreadable frontmatter -> treat as published; ingestion continues.
    }
    return { body: '', published };
  };

  const { entries } = ingest(rawNodes, readNote, {
    sectionSlug: NOTES_SECTION_SLUG,
    rootDisplayName: NOTES_DISPLAY_NAME,
  });

  const records: NoteRecord[] = [];
  for (const entry of entries) {
    if (!entry.published) continue; // unpublished notes have no live route
    const note = bySyntheticPath.get(entry.sourcePath);
    records.push({
      route: entry.route,
      displayName: entry.displayName,
      realPath: note?.realPath ?? entry.sourcePath,
      baseName: note?.baseName ?? '',
    });
  }
  return records;
}

/**
 * Build the normalized `name -> route` wikilink index from the synced notes.
 * Returns an empty map when the notes directory does not exist yet.
 *
 * Public signature/behavior is unchanged (astro.config.mjs depends on it); it
 * now derives its routes from {@link buildNoteRecords} so resolution logic is
 * shared with the backlink builder.
 */
export function buildWikilinkIndex(notesDir: string = NOTES_DIR): Map<string, string> {
  const index = new Map<string, string>();

  for (const record of buildNoteRecords(notesDir)) {
    // Key by Display_Name and by file basename (both normalized). `addKey`
    // keeps the first writer on a collision, which is fine for name lookups.
    addKey(index, record.displayName, record.route);
    if (record.baseName.length > 0) addKey(index, record.baseName, record.route);
  }

  return index;
}

/**
 * A LIVE, cached wikilink resolver.
 *
 * `resolve(normalizedName)` returns the note's route (or `undefined`). Unlike
 * the frozen Map from {@link buildWikilinkIndex}, this resolver stays fresh: it
 * builds the index lazily on first use and, before every lookup, cheaply checks
 * whether the notes directory changed (a signature over each `.md` file's path
 * + `mtimeMs`, computed with `stat` only — no file reads). If the signature
 * differs from the cached one, it rebuilds. This lets `astro dev` pick up
 * added/renamed/edited notes without a server restart, while a one-shot
 * `astro build` simply builds once (the signature is computed a single time).
 *
 * `invalidate()` clears the cache so the next `resolve` rebuilds — useful for a
 * dev watcher that wants to force a rebuild the instant a note file appears,
 * ahead of the automatic signature check.
 */
export interface WikilinkResolver {
  /** Resolve an ALREADY-normalized name to its route, or `undefined`. */
  resolve(normalizedName: string): string | undefined;
  /** Drop the cached index so the next `resolve` rebuilds from disk. */
  invalidate(): void;
}

/**
 * Compute a cheap freshness signature for the notes directory: every `.md`
 * file's path paired with its `mtimeMs`, joined deterministically. Uses `stat`
 * only (no file reads), so it stays inexpensive to run before each lookup.
 * Returns a stable sentinel when the directory is absent so an empty index is
 * cached rather than rebuilt on every call.
 */
function computeNotesSignature(notesDir: string): string {
  if (!existsSync(notesDir)) return '\u0000missing';
  // Reuse the SAME discovery walk the index build uses. Sort for a stable,
  // order-independent signature regardless of readdir ordering.
  const parts = walkMarkdown(notesDir)
    .map((file) => {
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        // A file that vanished mid-walk: treat as mtime 0; the rebuild it
        // triggers will settle on the real state.
      }
      return `${toPosix(file)}:${mtime}`;
    })
    .sort();
  return parts.join('\n');
}

/**
 * Create a live, cached, invalidatable wikilink resolver backed by
 * {@link buildWikilinkIndex}. See {@link WikilinkResolver}.
 */
export function createWikilinkResolver(
  notesDir: string = NOTES_DIR,
): WikilinkResolver {
  let cache: Map<string, string> | null = null;
  let signature: string | null = null;

  const ensureFresh = (): Map<string, string> => {
    const current = computeNotesSignature(notesDir);
    if (cache === null || current !== signature) {
      cache = buildWikilinkIndex(notesDir);
      signature = current;
    }
    return cache;
  };

  return {
    resolve(normalizedName: string): string | undefined {
      return ensureFresh().get(normalizedName);
    },
    invalidate(): void {
      cache = null;
      signature = null;
    },
  };
}

/** Add a normalized key without clobbering an earlier mapping. */
function addKey(index: Map<string, string>, name: string, route: string): void {
  const key = normalizeName(name);
  if (key.length > 0 && !index.has(key)) index.set(key, route);
}

/** Normalize a filesystem path to forward slashes. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}
