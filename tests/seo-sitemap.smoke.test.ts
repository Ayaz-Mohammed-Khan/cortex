import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  cleanupTemp,
  collectMarkdownFiles,
  collectNotePageFiles,
  countPublishedNotes,
  DIST_DIR,
  isPublishedMarkdown,
  resolveBuildContentRoot,
  restoreRealMirror,
  runBuild,
  slugifyBasename,
  type ContentRootChoice,
} from './smoke-support.ts';

/**
 * SEO output + sitemap build smoke test (Req 10.2, 10.3).
 *
 * WHAT THIS VALIDATES
 * -------------------
 * - Req 10.3: every pre-rendered Note page carries a `<link rel="canonical">`
 *   whose href is the page's own absolute URL (origin matches the sitemap
 *   origin; path matches the page's own route).
 * - Req 10.2: the `@astrojs/sitemap` output is generated, is a real sitemap
 *   index + URL-set, and lists exactly the published Note routes — every built
 *   Note page appears in the sitemap, and the published-vs-built COUNT matches
 *   the number of published `.md` notes in the content that was built.
 *
 * This is a build SMOKE test, not a property test — it asserts against the real
 * artifacts in `dist/` (the pure `publishedRoutes` filter and canonical-URL
 * helper are covered by their own property tests). So no `Property` tag.
 *
 * DATA SAFETY
 * -----------
 * The build runs against the Site_Owner's REAL `content/` by default (falling
 * back to a throwaway OS-temp fixture ONLY when `content/` has no notes), and
 * `afterAll` ALWAYS restores `src/content/notes/` to mirror the real content.
 * A run therefore never leaves dummy data in the generated mirror. All routes
 * are derived from the built output, so no dummy routes are hardcoded.
 */

const SITEMAP_INDEX = join(DIST_DIR, 'sitemap-index.xml');

/** Extract the text of every `<loc>...</loc>` element from a sitemap XML. */
function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/** The URL-set file the sitemap index references (e.g. `sitemap-0.xml`). */
function urlsetFileFromIndex(indexXml: string): string | null {
  const ref = extractLocs(indexXml).find((loc) => /sitemap-[^/]+\.xml$/.test(loc));
  if (!ref) return null;
  const name = ref.split('/').filter(Boolean).pop();
  return name ? join(DIST_DIR, name) : null;
}

/** Extract the `href` of the `<link rel="canonical">` tag, or null. */
function extractCanonical(html: string): string | null {
  const tag = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*>/i);
  if (!tag) return null;
  const href = tag[0].match(/\bhref=["']([^"']+)["']/i);
  return href ? href[1] : null;
}

/** Absolute route a built page occupies, derived from its `dist/` path. */
function routeFromDistPath(htmlPath: string): string {
  const rel = relative(DIST_DIR, htmlPath).replace(/\\/g, '/');
  const withoutIndex = rel.replace(/(?:^|\/)index\.html$/i, '');
  return '/' + withoutIndex;
}

/** Drop a trailing slash from a URL/path while keeping a bare origin intact. */
function stripTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

/** The path portion of an absolute URL, without trailing slash. */
function pathOf(url: string): string {
  return stripTrailingSlash(new URL(url).pathname);
}

interface NotePage {
  file: string;
  route: string;
  canonical: string | null;
  html: string;
}

let choice: ContentRootChoice;
let notePages: NotePage[] = [];
let sitemapIndexExists = false;
let sitemapIndexXml = '';
let urlsetFile: string | null = null;
let sitemapLocs: string[] = [];
let siteOrigin = '';
let publishedCount = 0;
let unpublishedSlugs: string[] = [];

beforeAll(() => {
  choice = resolveBuildContentRoot();

  // Always build with the content root chosen above, passed explicitly so the
  // build is deterministic regardless of the ambient shell environment.
  runBuild(choice.buildContentRoot, 'SEO/sitemap');

  const mdFiles = collectMarkdownFiles(choice.buildContentRoot);
  publishedCount = countPublishedNotes(choice.buildContentRoot);
  unpublishedSlugs = mdFiles
    .filter((f) => !isPublishedMarkdown(f))
    .map(slugifyBasename)
    .filter((s) => s.length > 0);

  sitemapIndexExists = existsSync(SITEMAP_INDEX);
  if (sitemapIndexExists) {
    sitemapIndexXml = readFileSync(SITEMAP_INDEX, 'utf8');
    const indexLocs = extractLocs(sitemapIndexXml);
    if (indexLocs.length > 0) siteOrigin = new URL(indexLocs[0]).origin;
    urlsetFile = urlsetFileFromIndex(sitemapIndexXml);
    if (urlsetFile && existsSync(urlsetFile)) {
      sitemapLocs = extractLocs(readFileSync(urlsetFile, 'utf8'));
    }
  }

  notePages = collectNotePageFiles().map((file) => {
    const html = readFileSync(file, 'utf8');
    return {
      file,
      route: routeFromDistPath(file),
      canonical: extractCanonical(html),
      html,
    };
  });
}, 180_000);

afterAll(() => {
  // DATA SAFETY: restore the mirror to the owner's real notes no matter what,
  // then remove any throwaway temp fixture.
  restoreRealMirror();
  cleanupTemp(choice);
});

describe('SEO output and sitemap (build smoke test)', () => {
  it('generates a valid @astrojs/sitemap index referencing a URL-set', () => {
    expect(sitemapIndexExists, `missing ${SITEMAP_INDEX}`).toBe(true);
    expect(sitemapIndexXml).toMatch(/<sitemapindex\b/);
    // The index references a URL-set file (e.g. sitemap-0.xml)…
    expect(urlsetFile, 'sitemap index does not reference a sitemap-*.xml').not.toBeNull();
    expect(existsSync(urlsetFile!), `missing URL-set file ${urlsetFile}`).toBe(true);
    // …and that file is a real <urlset>.
    const urlsetXml = readFileSync(urlsetFile!, 'utf8');
    expect(urlsetXml).toMatch(/<urlset\b/);
  });

  it('emits an absolute self-referential canonical URL on every built Note page', () => {
    if (notePages.length === 0 && !choice.usedTemp) {
      // Empty real content and no temp fallback: nothing to assert about notes.
      console.warn(
        '[seo-sitemap.smoke] No Note pages built (empty content/, no temp fixture); ' +
          'skipping Note-page canonical/sitemap assertions.',
      );
      return;
    }

    expect(notePages.length).toBeGreaterThanOrEqual(1);
    for (const page of notePages) {
      expect(page.canonical, `canonical missing on ${page.file}`).toBeTruthy();
      const url = new URL(page.canonical!); // absolute URL (throws otherwise)
      // Origin matches the sitemap origin; path is the page's own route.
      expect(url.origin).toBe(siteOrigin);
      expect(pathOf(page.canonical!)).toBe(page.route);
    }
  });

  it('lists every built Note route in the sitemap', () => {
    if (notePages.length === 0 && !choice.usedTemp) {
      console.warn(
        '[seo-sitemap.smoke] No Note pages built; skipping sitemap route-parity check.',
      );
      return;
    }

    const sitemapPaths = new Set(sitemapLocs.map(pathOf));
    for (const page of notePages) {
      expect(
        sitemapPaths.has(page.route),
        `sitemap is missing built Note route ${page.route}`,
      ).toBe(true);
    }
  });

  it('builds exactly the published Notes (count parity, no hardcoded routes)', () => {
    if (notePages.length === 0 && !choice.usedTemp) {
      console.warn(
        '[seo-sitemap.smoke] No Note pages built; skipping published-count parity check.',
      );
      return;
    }

    // The number of built Note pages equals the number of published `.md`
    // notes in the content that was built — the primary published-only
    // guarantee, derived generically from frontmatter (published defaults true).
    expect(notePages.length).toBe(publishedCount);
  });

  it('excludes unpublished Notes from the build output and the sitemap', () => {
    // Light contrast check: no built page and no sitemap <loc> ends with the
    // slugified basename of any `published: false` note.
    if (unpublishedSlugs.length === 0) {
      // No unpublished notes in the built content — nothing to exclude.
      return;
    }

    for (const slug of unpublishedSlugs) {
      const tail = new RegExp(`/${slug}/?$`, 'i');
      for (const loc of sitemapLocs) {
        expect(
          tail.test(loc),
          `sitemap unexpectedly contains unpublished note slug "${slug}" (${loc})`,
        ).toBe(false);
      }
      for (const page of notePages) {
        expect(
          tail.test(page.route),
          `unpublished note slug "${slug}" was unexpectedly built at ${page.route}`,
        ).toBe(false);
      }
    }
  });
});
