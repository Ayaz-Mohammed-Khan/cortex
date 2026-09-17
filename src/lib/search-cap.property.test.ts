import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { capResults, MAX_SEARCH_RESULTS } from './search';

// Feature: portfolio-website, Property 15: For any ranked list of matching Notes of length n, the displayed result set has length min(n, 50) and preserves the relative ranking order of the retained entries.

/**
 * Property 15: Search result capping.
 *
 * Validates: Requirements 6.3
 *
 * We generate arbitrary ranked lists of matching Notes (modelled here as
 * uniquely-identifiable records so retained-order preservation can be checked
 * exactly), cap them with `capResults`, and assert:
 *  - the capped length equals `min(n, MAX_SEARCH_RESULTS)` (50);
 *  - the retained entries are exactly the first `min(n, 50)` of the input, in
 *    the same relative ranking order (a prefix of the input);
 *  - the input array is never mutated.
 */

/** A single ranked match, tagged with a stable id to track ranking position. */
interface RankedNote {
  id: number;
  displayName: string;
}

/**
 * A ranked list whose ids are the entry's index, so the expected retained
 * order is simply `[0, 1, 2, ...]`. Lengths span below, at, and above the cap.
 */
const rankedListArb: fc.Arbitrary<RankedNote[]> = fc
  .array(fc.string({ maxLength: 12 }), { minLength: 0, maxLength: 120 })
  .map((names) => names.map((displayName, id) => ({ id, displayName })));

const RUNS = { numRuns: 100 };

describe('capResults result capping (Property 15)', () => {
  it('caps the displayed set to length min(n, 50)', () => {
    fc.assert(
      fc.property(rankedListArb, (ranked) => {
        const capped = capResults(ranked);
        expect(capped.length).toBe(Math.min(ranked.length, MAX_SEARCH_RESULTS));
      }),
      RUNS,
    );
  });

  it('preserves the relative ranking order of retained entries (a prefix of the input)', () => {
    fc.assert(
      fc.property(rankedListArb, (ranked) => {
        const capped = capResults(ranked);
        const expected = ranked.slice(0, Math.min(ranked.length, MAX_SEARCH_RESULTS));

        // Retained ids must match the leading prefix of the input exactly and
        // in order — no reordering, no gaps, no dropped-then-kept entries.
        expect(capped.map((n) => n.id)).toEqual(expected.map((n) => n.id));
      }),
      RUNS,
    );
  });

  it('does not mutate the input array', () => {
    fc.assert(
      fc.property(rankedListArb, (ranked) => {
        const snapshotIds = ranked.map((n) => n.id);
        capResults(ranked);
        expect(ranked.map((n) => n.id)).toEqual(snapshotIds);
      }),
      RUNS,
    );
  });
});
