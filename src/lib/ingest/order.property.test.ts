import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { orderingKey, compareSiblings } from './order';
import type { ParsedName } from './types';

// Feature: portfolio-website, Property 3: For any list of sibling entries, the result of sorting with compareSiblings places all prefixed entries before all unprefixed entries; prefixed entries appear in ascending order value; entries sharing an order value (and all unprefixed entries) appear in ascending case-insensitive alphabetical order by Display_Name. This same ordering holds at every level of the built Navigation_Tree.

/**
 * Property 3: Sibling ordering is prefixed-first then ascending by (order, name).
 *
 * Validates: Requirements 1.5, 1.6, 5.1
 *
 * We generate arbitrary lists of sibling ParsedName entries (each either
 * prefixed with an integer order in 0..999,999,999, or unprefixed with
 * `order: null`), map them to OrderingKeys via `orderingKey`, sort with
 * `compareSiblings`, and assert the three ordering guarantees plus total-order
 * consistency. The tree-level claim is covered by the buildTree test (task 5.4);
 * here we validate the underlying comparator at the sibling-list level.
 */

const MAX_ORDER = 999_999_999;

/** Display names that intentionally vary in casing to exercise the case-insensitive tie-break. */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  // Mixed free-form strings.
  fc.string({ minLength: 0, maxLength: 12 }),
  // A small pool of names that repeat and differ only by case, forcing ties.
  fc.constantFrom('Alpha', 'alpha', 'ALPHA', 'Beta', 'beta', 'gamma', 'Gamma', 'delta'),
);

/** A single sibling: either prefixed (integer order) or unprefixed (null). */
const parsedNameArb: fc.Arbitrary<ParsedName> = fc.oneof(
  fc.record({
    order: fc.integer({ min: 0, max: MAX_ORDER }),
    displayName: displayNameArb,
  }),
  fc.record({
    order: fc.constant<null>(null),
    displayName: displayNameArb,
  }),
);

const siblingListArb: fc.Arbitrary<ParsedName[]> = fc.array(parsedNameArb, {
  minLength: 0,
  maxLength: 40,
});

const RUNS = { numRuns: 200 };

describe('compareSiblings ordering (Property 3)', () => {
  it('places all prefixed entries before all unprefixed entries', () => {
    fc.assert(
      fc.property(siblingListArb, (parsed) => {
        const keys = parsed.map(orderingKey);
        const sorted = [...keys].sort(compareSiblings);

        // Once we see an unprefixed entry, no prefixed entry may follow.
        let seenUnprefixed = false;
        for (const key of sorted) {
          if (!key.hasPrefix) {
            seenUnprefixed = true;
          } else {
            expect(seenUnprefixed).toBe(false);
          }
        }
      }),
      RUNS,
    );
  });

  it('orders prefixed entries by non-decreasing order value', () => {
    fc.assert(
      fc.property(siblingListArb, (parsed) => {
        const sorted = parsed.map(orderingKey).sort(compareSiblings);
        const prefixed = sorted.filter((k) => k.hasPrefix);

        for (let i = 1; i < prefixed.length; i++) {
          expect(prefixed[i]!.order).toBeGreaterThanOrEqual(prefixed[i - 1]!.order);
        }
      }),
      RUNS,
    );
  });

  it('breaks ties (equal order, and all unprefixed) by ascending case-insensitive name', () => {
    fc.assert(
      fc.property(siblingListArb, (parsed) => {
        const sorted = parsed.map(orderingKey).sort(compareSiblings);

        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]!;
          const curr = sorted[i]!;
          // Within the same group (same hasPrefix and same effective order),
          // nameKey must be non-decreasing.
          if (prev.hasPrefix === curr.hasPrefix && prev.order === curr.order) {
            expect(prev.nameKey <= curr.nameKey).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it('is a consistent total order (antisymmetry, transitivity of sign, stability under reordering)', () => {
    fc.assert(
      fc.property(siblingListArb, (parsed) => {
        const keys = parsed.map(orderingKey);

        // Antisymmetry: sign(cmp(a,b)) === -sign(cmp(b,a)). Normalize negative
        // zero (`-Math.sign(0)` is `-0`) so Object.is-based `toBe` treats the
        // equal case (both signs 0) as a match rather than `0 !== -0`.
        for (const a of keys) {
          for (const b of keys) {
            expect(Math.sign(compareSiblings(a, b))).toBe(-Math.sign(compareSiblings(b, a)) || 0);
          }
        }

        // Consistency: sorting is independent of initial arrangement. Sorting
        // the list and a reversed copy must yield identical key sequences.
        const sortedForward = [...keys].sort(compareSiblings);
        const sortedReversed = [...keys].reverse().sort(compareSiblings);
        expect(sortedReversed.map(keyId)).toEqual(sortedForward.map(keyId));
      }),
      RUNS,
    );
  });

  it('produces a fully-ordered result: every adjacent pair satisfies cmp <= 0', () => {
    fc.assert(
      fc.property(siblingListArb, (parsed) => {
        const sorted = parsed.map(orderingKey).sort(compareSiblings);
        for (let i = 1; i < sorted.length; i++) {
          expect(compareSiblings(sorted[i - 1]!, sorted[i]!)).toBeLessThanOrEqual(0);
        }
      }),
      RUNS,
    );
  });
});

/** Canonical string representation of an OrderingKey for sequence comparisons. */
function keyId(key: { order: number; hasPrefix: boolean; nameKey: string }): string {
  return `${key.hasPrefix ? 'P' : 'U'}|${key.order}|${key.nameKey}`;
}
