import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CategoryNode } from './ingest/types';
import {
  buildSiteModel,
  sectionNavItems,
  NOTES_SECTION_SLUG,
  type SectionInput,
} from './section';

// Feature: portfolio-website, Property 24: For any set of available Sections, the site-level navigation lists every Section by Display_Name with the notes Section first, followed by the remaining Sections in their configured order.

// Validates: Requirements 11.2

/**
 * Slug-like string matching the output shape of `slugify`
 * (^[a-z0-9]+(-[a-z0-9]+)*$), kept non-empty so it is a valid section slug.
 */
const slugArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .filter((s) => s.length > 0 && s !== NOTES_SECTION_SLUG);

/** An arbitrary human-readable Display_Name (allowed to be anything non-empty). */
const displayNameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

/** Minimal isolated CategoryNode root for a section (content is irrelevant here). */
function makeRootNode(slug: string, displayName: string): CategoryNode {
  return {
    kind: 'category',
    displayName,
    slug,
    route: '/' + slug,
    order: 0,
    hasPrefix: false,
    children: [],
  };
}

/** Build a SectionInput from a slug, display name, and configured order value. */
function makeInput(slug: string, displayName: string, order: number): SectionInput {
  return {
    slug,
    displayName,
    order,
    rootNode: makeRootNode(slug, displayName),
  };
}

/**
 * Generate a set of non-notes sections with pairwise-unique slugs and pairwise
 * DISTINCT order values, so "their configured order" is unambiguous.
 */
const nonNotesSectionsArb: fc.Arbitrary<SectionInput[]> = fc
  .uniqueArray(
    fc.record({
      slug: slugArb,
      displayName: displayNameArb,
      order: fc.integer({ min: -1000, max: 1000 }),
    }),
    { minLength: 0, maxLength: 8, selector: (s) => s.slug },
  )
  // Enforce distinct order values across the non-notes sections.
  .map((arr) => {
    const seen = new Set<number>();
    const result: SectionInput[] = [];
    let bump = 0;
    for (const s of arr) {
      let order = s.order;
      while (seen.has(order)) {
        order = 2000 + bump++;
      }
      seen.add(order);
      result.push(makeInput(s.slug, s.displayName, order));
    }
    return result;
  });

/** Shuffle helper driven by fast-check for input-order independence. */
const shuffledInputsArb = (includeNotes: boolean) =>
  nonNotesSectionsArb.chain((rest) => {
    const all = includeNotes
      ? [makeInput(NOTES_SECTION_SLUG, 'Notes', 5), ...rest]
      : [...rest];
    return fc.constant(all).chain((xs) => fc.shuffledSubarray(xs, { minLength: xs.length }));
  });

describe('sectionNavItems (Property 24: site-level section navigation ordering)', () => {
  it('lists every Section by Display_Name (completeness)', () => {
    fc.assert(
      fc.property(fc.boolean(), (includeNotes) =>
        fc.assert(
          fc.property(shuffledInputsArb(includeNotes), (inputs) => {
            const model = buildSiteModel(inputs);
            const items = sectionNavItems(model);

            // One nav item per section, no more, no fewer.
            expect(items.length).toBe(inputs.length);

            // Every section's (slug -> displayName) pair is present.
            const itemBySlug = new Map(items.map((i) => [i.slug, i.displayName]));
            for (const input of inputs) {
              expect(itemBySlug.get(input.slug)).toBe(input.displayName);
            }
          }),
          { numRuns: 25 },
        ),
      ),
      { numRuns: 4 },
    );
  });

  it('places the notes Section first when present', () => {
    fc.assert(
      fc.property(shuffledInputsArb(true), (inputs) => {
        const model = buildSiteModel(inputs);
        const items = sectionNavItems(model);
        expect(items.length).toBeGreaterThan(0);
        expect(items[0]?.slug).toBe(NOTES_SECTION_SLUG);
      }),
      { numRuns: 100 },
    );
  });

  it('lists the remaining Sections after notes in ascending configured order', () => {
    fc.assert(
      fc.property(shuffledInputsArb(true), (inputs) => {
        const model = buildSiteModel(inputs);
        const items = sectionNavItems(model);

        // Everything after the leading notes section is the remainder.
        const rest = items.slice(1);
        const orderBySlug = new Map(inputs.map((i) => [i.slug, i.order]));

        // No notes section leaks into the remainder.
        for (const item of rest) {
          expect(item.slug).not.toBe(NOTES_SECTION_SLUG);
        }

        // Remainder is sorted by ascending configured order value.
        const orders = rest.map((i) => orderBySlug.get(i.slug) as number);
        for (let k = 1; k < orders.length; k++) {
          expect(orders[k - 1]! <= orders[k]!).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('orders all Sections by configured order when no notes Section exists', () => {
    fc.assert(
      fc.property(shuffledInputsArb(false), (inputs) => {
        const model = buildSiteModel(inputs);
        const items = sectionNavItems(model);
        const orderBySlug = new Map(inputs.map((i) => [i.slug, i.order]));
        const orders = items.map((i) => orderBySlug.get(i.slug) as number);
        for (let k = 1; k < orders.length; k++) {
          expect(orders[k - 1]! <= orders[k]!).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
