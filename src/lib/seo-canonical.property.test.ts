import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonicalUrl, articleJsonLd } from './seo';
import type { ContentEntry } from './ingest/types';

// Feature: portfolio-website, Property 21: For any Note with route r and configured absolute base URL b, the emitted canonical URL equals b + r, and the emitted structured metadata identifies the page type as an article and includes the Note's Display_Name.

// Validates: Requirements 10.3, 10.4

/**
 * Slug-like segment matching the output shape of `slugify`
 * (^[a-z0-9]+(-[a-z0-9]+)*$). Non-empty so no route segment collapses.
 */
const slugArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .filter((s) => s.length > 0);

/**
 * A well-formed route beginning with "/" (as produced by `buildRoute`): a
 * non-empty sequence of slug segments joined by "/".
 */
const routeArb: fc.Arbitrary<string> = fc
  .array(slugArb, { minLength: 1, maxLength: 6 })
  .map((segments) => '/' + segments.join('/'));

/**
 * An absolute base URL WITHOUT a trailing slash, e.g. "https://example.com" or
 * "https://sub.example.com/path". For such well-formed bases the canonical URL
 * is exactly `base + route` (Design Property 21).
 */
const baseUrlArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('https', 'http'),
    slugArb,
    fc.array(slugArb, { maxLength: 3 }),
  )
  .map(([scheme, host, path]) => {
    const domain = `${host}.com`;
    return path.length > 0 ? `${scheme}://${domain}/${path.join('/')}` : `${scheme}://${domain}`;
  });

/** Arbitrary Display_Name: any non-empty string. */
const displayNameArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 120 });

/** Build a minimal but complete ContentEntry from a route + display name. */
function makeEntry(route: string, displayName: string): ContentEntry {
  return {
    id: route,
    sectionSlug: 'notes',
    slug: route.split('/').pop() ?? 'note',
    route,
    displayName,
    order: 0,
    ancestors: [],
    body: '',
    headings: [],
    sourcePath: `/src/content${route}.md`,
    published: true,
  };
}

describe('canonicalUrl + articleJsonLd (Property 21: canonical URL and article metadata)', () => {
  it('canonical URL equals base + route for well-formed inputs', () => {
    fc.assert(
      fc.property(baseUrlArb, routeArb, (base, route) => {
        expect(canonicalUrl(base, route)).toBe(base + route);
      }),
      { numRuns: 100 },
    );
  });

  it('structured metadata identifies the page as an Article and includes the Display_Name', () => {
    fc.assert(
      fc.property(baseUrlArb, routeArb, displayNameArb, (base, route, displayName) => {
        const canonical = canonicalUrl(base, route);
        const entry = makeEntry(route, displayName);
        const jsonLd = articleJsonLd(entry, canonical);

        // Page type is an article.
        expect(jsonLd['@type']).toBe('Article');
        expect(jsonLd['@context']).toBe('https://schema.org');

        // Includes the Note's Display_Name.
        expect(jsonLd.headline).toBe(displayName);
        expect(jsonLd.name).toBe(displayName);

        // Uses the canonical URL (= base + route) for the page identity.
        expect(jsonLd.url).toBe(base + route);
        expect(jsonLd.mainEntityOfPage['@id']).toBe(base + route);
      }),
      { numRuns: 100 },
    );
  });
});
