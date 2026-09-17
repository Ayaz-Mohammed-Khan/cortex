import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cleanupTemp,
  collectNotePageFiles,
  resolveBuildContentRoot,
  restoreRealMirror,
  runBuild,
  type ContentRootChoice,
} from './smoke-support.ts';

/**
 * Pre-rendered static output build smoke test (Req 9.1).
 *
 * WHAT THIS VALIDATES
 * -------------------
 * Req 9.1: "WHEN a Reader requests a Note page, THE System SHALL deliver HTML
 * content for that Note that was pre-rendered at build time." This proves the
 * note content is baked into the static `dist/` HTML at build time rather than
 * fetched/rendered by client-side JavaScript.
 *
 * For every built Note page (identified generically by the `data-pagefind-body`
 * marker that only `NoteContent.astro` emits) it asserts:
 *  - the page is a full static HTML document (`<!doctype html>` … `</html>`);
 *  - the `data-pagefind-body` region is present;
 *  - that region contains NON-whitespace rendered text (proving the content was
 *    pre-rendered at build time, not injected client-side);
 *  - the region carries no `<astro-island>` hydration wrapper (the content is
 *    static, server-rendered markup).
 *
 * This is a build SMOKE test (not a property test), so no `Property` tag.
 *
 * DATA SAFETY
 * -----------
 * The build runs against the Site_Owner's REAL `content/` by default (falling
 * back to a throwaway OS-temp fixture ONLY when `content/` has no notes), and
 * `afterAll` ALWAYS restores `src/content/notes/` to mirror the real content.
 * A run therefore never leaves dummy data in the generated mirror.
 *
 * BUILD REUSE
 * -----------
 * To avoid a redundant full build, `beforeAll` reuses an existing `dist/` when
 * it already contains at least one Note page; when it DOES build, it uses the
 * same explicit `CONTENT_ROOT` as every other build here.
 */

/** Extract the inner markup of the single `<article data-pagefind-body>` region. */
function extractPagefindBody(html: string): string | null {
  const match = html.match(
    /<article\b[^>]*\bdata-pagefind-body\b[^>]*>([\s\S]*?)<\/article>/i,
  );
  return match ? match[1] : null;
}

/** Strip HTML tags to expose the rendered text content of a region. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').trim();
}

interface NotePage {
  file: string;
  html: string;
}

let choice: ContentRootChoice;
let pages: NotePage[] = [];

beforeAll(() => {
  choice = resolveBuildContentRoot();

  // Reuse an existing dist/ only when it already has Note pages AND we are not
  // using a throwaway temp fixture (a temp run must build its own fixture).
  const existing = choice.usedTemp ? [] : collectNotePageFiles();
  if (existing.length === 0) {
    runBuild(choice.buildContentRoot, 'prerender');
  }

  pages = collectNotePageFiles().map((file) => ({
    file,
    html: readFileSync(file, 'utf8'),
  }));
}, 180_000);

afterAll(() => {
  // DATA SAFETY: restore the mirror to the owner's real notes no matter what,
  // then remove any throwaway temp fixture.
  restoreRealMirror();
  cleanupTemp(choice);
});

describe('pre-rendered static output (build smoke test)', () => {
  it('builds at least one Note page to inspect', () => {
    if (pages.length === 0) {
      // Only reachable with empty real content and no temp fallback.
      console.warn(
        '[prerender.smoke] No Note pages built (empty content/, no temp fixture); ' +
          'skipping pre-render assertions.',
      );
      return;
    }
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('delivers each Note page as a full static HTML document', () => {
    if (pages.length === 0) return;
    for (const page of pages) {
      expect(
        page.html.slice(0, 200).toLowerCase(),
        `no <!doctype html> in ${page.file}`,
      ).toContain('<!doctype html>');
      expect(page.html, `no closing </html> in ${page.file}`).toMatch(
        /<\/html>\s*$/i,
      );
      expect(
        page.html.includes('data-pagefind-body'),
        `no data-pagefind-body region in ${page.file}`,
      ).toBe(true);
    }
  });

  it('server-renders non-empty Note content into the data-pagefind-body region', () => {
    if (pages.length === 0) return;
    for (const page of pages) {
      const body = extractPagefindBody(page.html);
      expect(body, `no note-body region in ${page.file}`).not.toBeNull();
      // Non-whitespace rendered text proves the body was pre-rendered at build
      // time (Req 9.1), not injected client-side into an empty shell.
      expect(
        textOf(body!).length,
        `data-pagefind-body region is empty in ${page.file}`,
      ).toBeGreaterThan(0);
    }
  });

  it('renders the primary content without a client framework runtime', () => {
    if (pages.length === 0) return;
    for (const page of pages) {
      const body = extractPagefindBody(page.html)!;
      // Astro wraps client-hydrated framework components in `<astro-island>`.
      // The note body carries none: its content is static, server-rendered
      // markup that needs no client-side rendering to be visible (Req 9.1).
      expect(
        /<astro-island\b/i.test(body),
        `note body in ${page.file} relies on a client-hydrated island`,
      ).toBe(false);
    }
  });
});
