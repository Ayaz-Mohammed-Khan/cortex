import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { buildToc, MIN_HEADING_DEPTH, MIN_TOC_HEADINGS, MAX_TOC_ENTRIES } from './toc';
import type { Heading } from './ingest/types';

// Feature: portfolio-website, Property 12: For any sequence of headings below the title level, when there are two or more headings the generated Table_Of_Contents lists them in document order with a length of min(headingCount, 500); when there are fewer than two such headings, no Table_Of_Contents is produced.

/**
 * Property 12: Table of contents preserves document order and cap, and is
 * omitted when sparse.
 *
 * Validates: Requirements 4.1, 4.5
 *
 * We generate arbitrary sequences of headings. Each heading has a `depth`, and
 * only headings below the title level (`depth >= MIN_HEADING_DEPTH`, i.e. the
 * title is depth 1) qualify for the Table_Of_Contents. The property asserts:
 *
 *  - When two or more qualifying headings exist, `buildToc` returns entries in
 *    the same document order they appeared in the source, with a length of
 *    `min(qualifyingCount, MAX_TOC_ENTRIES)`.
 *  - When fewer than two qualifying headings exist, `buildToc` returns `[]`
 *    (the TOC is omitted).
 */

const RUNS = { numRuns: 200 };

/** A heading arbitrary spanning both title-level (depth 1) and TOC-eligible depths (2..6). */
const headingArb: fc.Arbitrary<Heading> = fc.record({
  depth: fc.integer({ min: 1, max: 6 }),
  text: fc.string({ minLength: 0, maxLength: 20 }),
  slug: fc.string({ minLength: 1, maxLength: 20 }),
});

/** A heading arbitrary constrained to TOC-eligible depths only (depth >= 2). */
const qualifyingHeadingArb: fc.Arbitrary<Heading> = fc.record({
  depth: fc.integer({ min: MIN_HEADING_DEPTH, max: 6 }),
  text: fc.string({ minLength: 0, maxLength: 20 }),
  slug: fc.string({ minLength: 1, maxLength: 20 }),
});

/** Canonical identity of a heading vs. its TOC entry for order comparisons. */
function idOf(h: { depth: number; text: string; slug: string }): string {
  return `${h.depth}|${h.text}|${h.slug}`;
}

describe('buildToc order, cap, and omission (Property 12)', () => {
  it('lists two-or-more qualifying headings in document order', () => {
    fc.assert(
      fc.property(fc.array(headingArb, { minLength: 0, maxLength: 60 }), (headings) => {
        const qualifying = headings.filter((h) => h.depth >= MIN_HEADING_DEPTH);
        const toc = buildToc(headings);

        if (qualifying.length >= MIN_TOC_HEADINGS) {
          const expected = qualifying.slice(0, MAX_TOC_ENTRIES);
          // Same length as the (capped) qualifying set...
          expect(toc.length).toBe(expected.length);
          // ...and in the exact document order of the qualifying headings.
          expect(toc.map(idOf)).toEqual(expected.map(idOf));
        } else {
          // Fewer than two qualifying headings => TOC omitted.
          expect(toc).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  it('produces a length of min(headingCount, 500) when a TOC is produced', () => {
    fc.assert(
      fc.property(fc.array(headingArb, { minLength: 0, maxLength: 60 }), (headings) => {
        const qualifyingCount = headings.filter((h) => h.depth >= MIN_HEADING_DEPTH).length;
        const toc = buildToc(headings);

        if (qualifyingCount >= MIN_TOC_HEADINGS) {
          expect(toc.length).toBe(Math.min(qualifyingCount, MAX_TOC_ENTRIES));
        } else {
          expect(toc.length).toBe(0);
        }
      }),
      RUNS,
    );
  });

  it('omits the TOC when fewer than two headings are below the title level', () => {
    // Explicitly cover 0 and 1 qualifying headings, mixed with any number of
    // title-level (depth 1) headings which never qualify.
    const titleOnlyArb = fc.record({
      depth: fc.constant(1),
      text: fc.string({ maxLength: 20 }),
      slug: fc.string({ minLength: 1, maxLength: 20 }),
    });
    fc.assert(
      fc.property(
        fc.array(titleOnlyArb, { minLength: 0, maxLength: 10 }),
        fc.array(qualifyingHeadingArb, { minLength: 0, maxLength: 1 }),
        (titles, fewQualifying) => {
          // Interleave/append: total qualifying count is fewQualifying.length (< 2).
          const headings = [...titles, ...fewQualifying];
          expect(buildToc(headings)).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it('caps at 500 entries in document order when there are more than 500 qualifying headings', () => {
    fc.assert(
      fc.property(
        fc.array(qualifyingHeadingArb, { minLength: MAX_TOC_ENTRIES + 1, maxLength: MAX_TOC_ENTRIES + 120 }),
        (headings) => {
          const toc = buildToc(headings);
          // Capped to exactly 500...
          expect(toc.length).toBe(MAX_TOC_ENTRIES);
          // ...and those 500 are the first 500 in document order.
          expect(toc.map(idOf)).toEqual(headings.slice(0, MAX_TOC_ENTRIES).map(idOf));
        },
      ),
      { numRuns: 100 },
    );
  });
});
