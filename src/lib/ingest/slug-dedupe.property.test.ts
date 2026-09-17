import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { slugify, dedupeSlug, type SlugCollision } from './slug';

// Feature: portfolio-website, Property 7: For any list of sibling names under one parent, dedupeSlug yields Slugs that are pairwise unique within that parent; when a base Slug repeats, the first occurrence keeps the base Slug and subsequent occurrences receive a -n suffix where n starts at 2 and increments by 1 per collision, and each collision is recorded.
//
// Validates: Requirements 2.3

/**
 * A small pool of sibling Display_Names. It intentionally includes several
 * distinct names so that duplicates are *forced* frequently when drawing from
 * it, exercising the collision path. The names are chosen so their slugs are
 * pairwise "prefix-free" of one another's suffixed forms (e.g. no pool slug
 * equals `${otherSlug}-2`), which keeps the deterministic suffix reasoning
 * below exact: within a single sibling scope the only source of `${base}-n`
 * candidates is repetitions of `base` itself.
 */
const NAME_POOL = [
  'Alpha Note',
  'Beta Note',
  'Gamma',
  'Delta Topic',
  'Épsilon', // exercises diacritic stripping in slugify -> "epsilon"
  'Zeta 42',
];

const siblingNamesArb = fc.array(fc.constantFrom(...NAME_POOL), {
  minLength: 0,
  maxLength: 40,
});

describe('dedupeSlug — sibling slug uniqueness with deterministic suffixes (Property 7)', () => {
  it('assigns pairwise-unique slugs with -n suffixes and records each collision', () => {
    fc.assert(
      fc.property(siblingNamesArb, (names) => {
        const taken = new Set<string>();
        const collisions: SlugCollision[] = [];

        // The base slug of each sibling, then the assigned (deduped) slug.
        const bases = names.map((n) => slugify(n));
        const assigned = bases.map((base) => dedupeSlug(base, taken, collisions));

        // Independently recompute what each assignment *should* be by tracking
        // how many times each base slug has been seen so far.
        const seen = new Map<string, number>();
        const expectedAssigned: string[] = [];
        const expectedCollisions: SlugCollision[] = [];
        for (const base of bases) {
          const occurrence = (seen.get(base) ?? 0) + 1;
          seen.set(base, occurrence);
          if (occurrence === 1) {
            // (2) First occurrence of a base keeps the base slug unchanged.
            expectedAssigned.push(base);
          } else {
            // (3) Subsequent occurrences get -2, -3, ... incrementing by 1.
            const suffixed = `${base}-${occurrence}`;
            expectedAssigned.push(suffixed);
            // (4) One recorded collision per suffixed assignment.
            expectedCollisions.push({ base, assigned: suffixed });
          }
        }

        // (2) + (3): assignments follow the deterministic suffix scheme.
        expect(assigned).toEqual(expectedAssigned);

        // (1): all assigned slugs are pairwise unique within this sibling scope.
        expect(new Set(assigned).size).toBe(assigned.length);

        // The mutated `taken` set holds exactly the assigned slugs.
        expect(taken.size).toBe(assigned.length);
        for (const slug of assigned) {
          expect(taken.has(slug)).toBe(true);
        }

        // (4): collisions recorded — one per suffixed assignment, in order.
        expect(collisions).toEqual(expectedCollisions);
      }),
      { numRuns: 200 },
    );
  });

  it('increments the suffix by exactly 1 per repeat of the same base (2,3,4,...)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NAME_POOL),
        fc.integer({ min: 1, max: 12 }),
        (name, repeats) => {
          const taken = new Set<string>();
          const collisions: SlugCollision[] = [];
          const base = slugify(name);

          const assigned = Array.from({ length: repeats }, () =>
            dedupeSlug(base, taken, collisions),
          );

          // First keeps the base; the k-th (k>=2) receives `${base}-${k}`.
          expect(assigned[0]).toBe(base);
          for (let k = 2; k <= repeats; k += 1) {
            expect(assigned[k - 1]).toBe(`${base}-${k}`);
          }

          // Pairwise unique and one recorded collision per suffixed assignment.
          expect(new Set(assigned).size).toBe(repeats);
          expect(collisions.length).toBe(Math.max(0, repeats - 1));
        },
      ),
      { numRuns: 100 },
    );
  });
});
