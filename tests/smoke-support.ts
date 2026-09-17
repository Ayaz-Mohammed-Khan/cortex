/**
 * Shared helpers for the two build smoke tests (`seo-sitemap`, `prerender`).
 *
 * DATA SAFETY (why this module exists)
 * ------------------------------------
 * The Site_Owner's REAL notes live in `content/` (the source of truth). The
 * prebuild sync step (`scripts/sync-content.ts`) mirrors that root into the
 * GENERATED, git-ignored directory `src/content/notes/` — and it is a TRUE
 * mirror: it clears the target before copying. The smoke tests must therefore
 * NEVER build against committed dummy fixtures, because doing so would leave
 * dummy notes sitting in `src/content/notes/` after the test run, clobbering
 * the owner's mirrored content.
 *
 * These helpers guarantee two things:
 *   1. Builds run against the owner's REAL `content/` by default. Only when
 *      `content/` has no notes at all does a test fall back to a THROWAWAY
 *      fixture created in the OS temp dir (never committed, always cleaned up).
 *   2. After every run the mirror is restored to the owner's real `content/`
 *      via {@link restoreRealMirror}, so a test can never leave dummy data in
 *      `src/content/notes/`.
 */
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncContent } from '../scripts/sync-content.ts';

/** Project root; all relative build paths resolve against this. */
export const PROJECT_ROOT = process.cwd();
/** The Site_Owner's real notes — the source of truth and default build input. */
export const REAL_CONTENT = join(PROJECT_ROOT, 'content');
/** Static build output directory. */
export const DIST_DIR = join(PROJECT_ROOT, 'dist');

/** The content root a build should use, plus whether it is a temp fallback. */
export interface ContentRootChoice {
  /** Absolute path passed to the build as `CONTENT_ROOT`. */
  buildContentRoot: string;
  /** True when a throwaway temp fixture was created (real content was empty). */
  usedTemp: boolean;
  /** The temp dir to remove on cleanup, or `null` when real content was used. */
  tempDir: string | null;
}

/**
 * Recursively collect every `.md` file under `dir`, skipping dot-directories.
 * This mirrors `scripts/sync-content.ts` (which never descends into `.`-dirs
 * and only treats `.md` files as notes), so the count matches what the build
 * will actually turn into Note pages.
 */
export function collectMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue; // skip .obsidian/.git/…
      out.push(...collectMarkdownFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Parse the leading `---\n…\n---` frontmatter block of a Markdown file and
 * report whether the note is published. A note is published UNLESS it declares
 * `published: false` (published is the default — matches the collection schema
 * in `src/content.config.ts`).
 */
export function isPublishedMarkdown(mdPath: string): boolean {
  let text = '';
  try {
    text = readFileSync(mdPath, 'utf8');
  } catch {
    return true; // unreadable → treat as published, build decides the rest
  }
  const fm = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return true; // no frontmatter → published by default
  return !/^\s*published\s*:\s*false\s*$/im.test(fm[1]);
}

/** Count the published `.md` notes under `dir` (published is the default). */
export function countPublishedNotes(dir: string): number {
  return collectMarkdownFiles(dir).filter(isPublishedMarkdown).length;
}

/**
 * URL-safe slug of a note's file basename (without extension), using the same
 * lower-case / non-alphanumeric-to-hyphen rules the ingestion slugifier uses.
 * Used only for a light "unpublished note is absent" check.
 */
export function slugifyBasename(mdPath: string): string {
  const base = mdPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const name = base.replace(/\.md$/i, '');
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Decide which content root a build should use.
 *
 * When the owner's `content/` has at least one `.md` note, that real content is
 * the build input (`usedTemp: false`). Otherwise a MINIMAL throwaway fixture is
 * created under the OS temp dir (one published note, one `published: false`
 * note) so the build still has something to exercise; that temp dir is returned
 * for later cleanup (`usedTemp: true`).
 */
export function resolveBuildContentRoot(): ContentRootChoice {
  // Any `.md` under the real content root (published or not) means we build
  // against the owner's genuine notes.
  if (collectMarkdownFiles(REAL_CONTENT).length >= 1) {
    return { buildContentRoot: REAL_CONTENT, usedTemp: false, tempDir: null };
  }

  // Real content has no notes → build a disposable fixture in the temp dir.
  const tempDir = mkdtempSync(join(tmpdir(), 'notes-smoke-'));
  const category = join(tempDir, 'Sample Notes');
  mkdirSync(category, { recursive: true });
  writeFileSync(
    join(category, 'Welcome.md'),
    '# Welcome\n\nThis is a temporary published note used only when the real ' +
      'content directory is empty. It exercises the static build so the smoke ' +
      'tests have a page to inspect.\n',
    'utf8',
  );
  writeFileSync(
    join(category, 'Draft.md'),
    '---\npublished: false\n---\n\n# Draft\n\nThis temporary note is ' +
      'unpublished and must never appear as a built page or sitemap entry.\n',
    'utf8',
  );
  return { buildContentRoot: tempDir, usedTemp: true, tempDir };
}

/**
 * Run the full production build (`prebuild` content-sync → `astro build` →
 * `postbuild` pagefind) with `CONTENT_ROOT` passed EXPLICITLY in `env`.
 *
 * Passing the content root explicitly (rather than trusting the ambient shell
 * environment, which may be polluted) keeps the build deterministic and pointed
 * at exactly the intended content.
 */
export function runBuild(contentRoot: string, label: string): void {
  try {
    execSync('npm run build', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CONTENT_ROOT: contentRoot },
    });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `Production build failed during ${label} smoke-test setup:\n` +
        `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`,
    );
  }
}

/**
 * Restore `src/content/notes/` to mirror the owner's REAL `content/`.
 *
 * ALWAYS call this in `afterAll` (even on failure) so a test run can never
 * leave dummy/temp data behind. When `content/` is empty this correctly clears
 * the mirror to empty.
 */
export function restoreRealMirror(): void {
  syncContent({ cwd: PROJECT_ROOT, contentRoot: REAL_CONTENT, silent: true });
}

/** Remove the throwaway temp fixture dir, if one was created. */
export function cleanupTemp(choice: ContentRootChoice): void {
  if (choice.usedTemp && choice.tempDir) {
    rmSync(choice.tempDir, { recursive: true, force: true });
  }
}

/** Recursively collect every `*.html` file under `dir`. */
export function collectHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectHtmlFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A built Note page is any `dist/**\/*.html` whose markup carries the
 * `data-pagefind-body` marker that only `NoteContent.astro` emits (Category
 * listing pages never carry it). Returns the absolute file paths.
 */
export function collectNotePageFiles(): string[] {
  return collectHtmlFiles(DIST_DIR).filter((file) =>
    readFileSync(file, 'utf8').includes('data-pagefind-body'),
  );
}
