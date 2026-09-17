import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildRoute } from './route';

// Feature: portfolio-website, Property 9: For any section Slug, ordered ancestor Slugs, and self Slug, buildRoute returns "/" + [sectionSlug, ...ancestorSlugs, selfSlug].join("/"), so the produced route's segments equal that sequence in order and the route begins with the section Slug. For any Section, every route within it begins with "/" + section.slug, and Section Slugs are pairwise unique across the site.

// Validates: Requirements 2.2, 11.6

/**
 * Arbitrary slug-like string: lowercase alphanumerics and hyphens, matching the
 * output shape of `slugify` (^[a-z0-9]+(-[a-z0-9]+)*$). Kept non-empty so no
 * segment collapses, which mirrors real ingested slugs.
 */
const slugArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .filter((s) => s.length > 0);

const ancestorSlugsArb: fc.Arbitrary<string[]> = fc.array(slugArb, {
  maxLength: 8,
});

describe('buildRoute (Property 9: route construction and section prefixing)', () => {
  it('equals "/" + [sectionSlug, ...ancestorSlugs, selfSlug].join("/")', () => {
    fc.assert(
      fc.property(slugArb, ancestorSlugsArb, slugArb, (sectionSlug, ancestorSlugs, selfSlug) => {
        const expected = '/' + [sectionSlug, ...ancestorSlugs, selfSlug].join('/');
        expect(buildRoute(sectionSlug, ancestorSlugs, selfSlug)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('produces segments equal to [sectionSlug, ...ancestorSlugs, selfSlug] in order', () => {
    fc.assert(
      fc.property(slugArb, ancestorSlugsArb, slugArb, (sectionSlug, ancestorSlugs, selfSlug) => {
        const route = buildRoute(sectionSlug, ancestorSlugs, selfSlug);
        // Leading "/" yields an empty first element; drop it to get the segments.
        const segments = route.split('/');
        expect(segments[0]).toBe('');
        expect(segments.slice(1)).toEqual([sectionSlug, ...ancestorSlugs, selfSlug]);
      }),
      { numRuns: 200 },
    );
  });

  it('begins with "/" + sectionSlug', () => {
    fc.assert(
      fc.property(slugArb, ancestorSlugsArb, slugArb, (sectionSlug, ancestorSlugs, selfSlug) => {
        const route = buildRoute(sectionSlug, ancestorSlugs, selfSlug);
        expect(route.startsWith('/' + sectionSlug)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('every route within a section begins with "/" + section.slug, and distinct sections yield distinct prefixes', () => {
    fc.assert(
      fc.property(
        // Two distinct section slugs as a fixed-length [string, string] tuple so
        // the destructured elements are properly typed under
        // noUncheckedIndexedAccess (uniqueArray yields `string | undefined`).
        fc.tuple(slugArb, slugArb).filter(([a, b]) => a !== b),
        ancestorSlugsArb,
        slugArb,
        ancestorSlugsArb,
        slugArb,
        ([sectionA, sectionB], ancestorsA, selfA, ancestorsB, selfB) => {
          const routeA = buildRoute(sectionA, ancestorsA, selfA);
          const routeB = buildRoute(sectionB, ancestorsB, selfB);

          // Each route begins with its own section prefix.
          expect(routeA.startsWith('/' + sectionA)).toBe(true);
          expect(routeB.startsWith('/' + sectionB)).toBe(true);

          // Distinct section slugs mean the first segment differs, so routes
          // belong to distinguishable sections.
          const firstSegmentA = routeA.split('/')[1];
          const firstSegmentB = routeB.split('/')[1];
          expect(firstSegmentA).toBe(sectionA);
          expect(firstSegmentB).toBe(sectionB);
          expect(firstSegmentA).not.toBe(firstSegmentB);
        },
      ),
      { numRuns: 200 },
    );
  });
});
