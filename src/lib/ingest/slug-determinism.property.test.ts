import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { slugify } from './slug';

// Feature: portfolio-website, Property 8: For any source name, invoking slugify twice returns identical results, and ingesting the same input hierarchy twice produces identical Slugs and routes for every entry.
//
// Validates: Requirements 2.4
//
// The module under test here is `slug.ts`, so this file focuses on the
// `slugify` determinism clause of Property 8: repeated invocations on the same
// source name always return identical results. The hierarchy-level determinism
// clause (identical Slugs and routes when ingesting the same input twice) is
// covered where `buildTree`/`ingest` are tested (Task 5.x), since those modules
// are not exercised by this file.
describe('Property 8: slug generation is deterministic', () => {
  it('slugify(x) === slugify(x) for arbitrary input strings', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        expect(slugify(name)).toBe(slugify(name));
      }),
      { numRuns: 100 },
    );
  });

  it('is stable across a fresh call sequence for the same input', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        // A first invocation, then several more in a fresh sequence, must all
        // agree — slugify holds no mutable state, so nothing about prior calls
        // can influence a later result.
        const first = slugify(name);
        for (let i = 0; i < 5; i += 1) {
          expect(slugify(name)).toBe(first);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('is order-independent: shuffling the input set does not change per-name results', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (names) => {
        // Slugify each name in the given order.
        const forward = names.map((n) => slugify(n));
        // Slugify the same names in reverse order; because slugify depends only
        // on its single argument, each name maps to the same Slug regardless of
        // the surrounding processing order.
        const reversed = [...names].reverse().map((n) => slugify(n));
        expect([...reversed].reverse()).toEqual(forward);
      }),
      { numRuns: 100 },
    );
  });
});
