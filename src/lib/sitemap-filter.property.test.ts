import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { publishedRoutes, type SitemapNote } from './sitemap-filter';

// Feature: portfolio-website, Property 20: For any set of Notes with arbitrary published flags, the generated sitemap contains the route of every published Note and contains no route of any unpublished Note.

// Validates: Requirements 10.2

/**
 * An arbitrary Note route. Uses a small pool of realistic-looking route shapes
 * plus arbitrary strings so the property exercises duplicate routes, empty
 * strings, and unicode alike.
 */
const routeArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '/notes/ai-ml/intro',
    '/notes/ai-ml/deep-learning',
    '/notes/systems/networking',
    '/notes/',
    '/notes/misc/a',
  ),
  fc.string(),
);

/** A single Note carrying only the fields relevant to sitemap inclusion. */
const noteArb: fc.Arbitrary<SitemapNote> = fc.record({
  route: routeArb,
  published: fc.boolean(),
});

/** An arbitrary set of Notes with arbitrary published flags. */
const notesArb: fc.Arbitrary<SitemapNote[]> = fc.array(noteArb, {
  maxLength: 40,
});

describe('Sitemap route filter (Property 20: sitemap contains exactly the published Note routes)', () => {
  it('includes every published Note route and excludes every unpublished Note route', () => {
    fc.assert(
      fc.property(notesArb, (notes) => {
        const result = publishedRoutes(notes);

        // Independent oracle: the routes of exactly the published Notes,
        // derived directly from Requirement 10.2's wording.
        const expected = notes
          .filter((note) => note.published)
          .map((note) => note.route);

        // The sitemap contains the route of every published Note, in order,
        // and contains no route of any unpublished Note.
        expect(result).toEqual(expected);

        // Every published Note's route is present at least as often as it
        // appears among published Notes.
        for (const note of notes) {
          if (note.published) {
            expect(result).toContain(note.route);
          }
        }

        // No route originating solely from unpublished Notes leaks in: any
        // route in the result must correspond to some published Note.
        const publishedRouteSet = new Set(expected);
        for (const route of result) {
          expect(publishedRouteSet.has(route)).toBe(true);
        }

        // The count of emitted routes equals the number of published Notes.
        expect(result.length).toBe(notes.filter((n) => n.published).length);
      }),
      { numRuns: 100 },
    );
  });

  it('emits nothing when no Note is published', () => {
    fc.assert(
      fc.property(
        fc.array(routeArb, { maxLength: 40 }),
        (routes) => {
          const notes = routes.map((route) => ({ route, published: false }));
          expect(publishedRoutes(notes)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('emits every route when all Notes are published', () => {
    fc.assert(
      fc.property(
        fc.array(routeArb, { maxLength: 40 }),
        (routes) => {
          const notes = routes.map((route) => ({ route, published: true }));
          expect(publishedRoutes(notes)).toEqual(routes);
        },
      ),
      { numRuns: 100 },
    );
  });
});
