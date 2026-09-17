import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { buildToc, MIN_HEADING_DEPTH, INDENT_STEP } from './toc';
import type { Heading } from './ingest/types';

// Feature: portfolio-website, Property 13: For any two Table_Of_Contents entries, the entry for a deeper heading level has a strictly greater start-margin indentation than the entry for any shallower heading level, and the indentation increment applied per successive level is constant.

/**
 * Property 13: Table of contents indentation is strictly monotonic in heading
 * depth, with a constant per-level increment.
 *
 * Validates: Requirements 4.2
 *
 * We generate arbitrary sequences of qualifying headings (depth >= 2) with
 * varying depths and assert, over the produced {@link buildToc} entries:
 *
 *  - Monotonicity: for any two entries, if one heading is deeper than another
 *    then its `indent` is strictly greater; equal depths have equal indent.
 *  - Constant increment: the indentation is an affine function of depth, i.e.
 *    `indent = (depth - minDepth) * INDENT_STEP`, so the difference in indent
 *    between any two consecutive levels equals the same constant `INDENT_STEP`.
 */

const RUNS = { numRuns: 200 };

/** A qualifying heading arbitrary (depth in the TOC-eligible range 2..6). */
const qualifyingHeadingArb: fc.Arbitrary<Heading> = fc.record({
  depth: fc.integer({ min: MIN_HEADING_DEPTH, max: 6 }),
  text: fc.string({ minLength: 0, maxLength: 20 }),
  slug: fc.string({ minLength: 1, maxLength: 20 }),
});

describe('buildToc indentation monotonicity and constant increment (Property 13)', () => {
  it('gives deeper headings strictly greater indentation than shallower ones', () => {
    fc.assert(
      fc.property(
        // At least two headings so a TOC is actually produced.
        fc.array(qualifyingHeadingArb, { minLength: 2, maxLength: 60 }),
        (headings) => {
          const toc = buildToc(headings);
          // With >= 2 qualifying headings a TOC is always produced.
          expect(toc.length).toBeGreaterThanOrEqual(2);

          for (const a of toc) {
            for (const b of toc) {
              if (a.depth < b.depth) {
                // Shallower depth => strictly smaller indent.
                expect(a.indent).toBeLessThan(b.indent);
              } else if (a.depth === b.depth) {
                // Equal depth => equal indent.
                expect(a.indent).toBe(b.indent);
              } else {
                // Deeper depth => strictly greater indent.
                expect(a.indent).toBeGreaterThan(b.indent);
              }
            }
          }
        },
      ),
      RUNS,
    );
  });

  it('applies a constant indentation increment per successive level', () => {
    fc.assert(
      fc.property(
        fc.array(qualifyingHeadingArb, { minLength: 2, maxLength: 60 }),
        (headings) => {
          const toc = buildToc(headings);
          const minDepth = Math.min(...toc.map((e) => e.depth));

          // Indentation is exactly an affine function of depth with slope
          // INDENT_STEP anchored at 0 for the shallowest present level. This
          // guarantees the increment between any two successive levels is the
          // same positive constant.
          for (const entry of toc) {
            expect(entry.indent).toBe((entry.depth - minDepth) * INDENT_STEP);
          }

          // The shallowest present level is anchored at indent 0.
          expect(Math.min(...toc.map((e) => e.indent))).toBe(0);

          // Any two entries one level apart differ by exactly INDENT_STEP.
          for (const a of toc) {
            for (const b of toc) {
              if (b.depth - a.depth === 1) {
                expect(b.indent - a.indent).toBe(INDENT_STEP);
              }
            }
          }
        },
      ),
      RUNS,
    );
  });
});
