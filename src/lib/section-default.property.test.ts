import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildSiteModel,
  defaultLanding,
  NOTES_SECTION_SLUG,
  type SectionInput,
} from './section';
import type { CategoryNode } from './ingest/types';

// Feature: portfolio-website, Property 25: For any set of available Sections (whether one or many), resolving the site root produces the notes Section as the default landing content.

// Validates: Requirements 11.3, 11.7

/**
 * Arbitrary slug-like string matching the output shape of `slugify`
 * (^[a-z0-9]+(-[a-z0-9]+)*$), kept non-empty like real ingested slugs.
 */
const slugArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .filter((s) => s.length > 0);

/** A minimal CategoryNode root for a section; contents are irrelevant here. */
function rootFor(slug: string): CategoryNode {
  return {
    kind: 'category',
    displayName: slug,
    slug,
    route: '/' + slug,
    order: 0,
    hasPrefix: false,
    children: [],
  };
}

/** Build a SectionInput from a slug and an order. */
function sectionInput(slug: string, order: number): SectionInput {
  return {
    slug,
    displayName: slug.toUpperCase(),
    order,
    rootNode: rootFor(slug),
  };
}

/**
 * Arbitrary set of Section inputs that always contains exactly one notes
 * Section (whose slug is NOTES_SECTION_SLUG), plus zero or more additional
 * Sections with unique, non-notes slugs. Order of inputs is arbitrary, so the
 * notes Section may appear anywhere in the list — this exercises "whether one
 * or many" Sections in any arrangement.
 */
const sectionInputsArb: fc.Arbitrary<SectionInput[]> = fc
  .uniqueArray(slugArb.filter((s) => s !== NOTES_SECTION_SLUG), {
    minLength: 0,
    maxLength: 8,
  })
  .chain((otherSlugs) => {
    const notesOrder = fc.integer({ min: -1000, max: 1000 });
    const otherOrders = fc.array(fc.integer({ min: -1000, max: 1000 }), {
      minLength: otherSlugs.length,
      maxLength: otherSlugs.length,
    });
    // Position at which to insert the notes section among the others.
    const insertAt = fc.integer({ min: 0, max: otherSlugs.length });
    return fc.tuple(notesOrder, otherOrders, insertAt).map(([nOrder, orders, at]) => {
      const others = otherSlugs.map((slug, i) => sectionInput(slug, orders[i] ?? 0));
      const notes = sectionInput(NOTES_SECTION_SLUG, nOrder);
      const inputs = [...others];
      inputs.splice(at, 0, notes);
      return inputs;
    });
  });

describe('defaultLanding (Property 25: default landing content is the notes Section)', () => {
  it('resolves the site root to the notes Section for any set of Sections', () => {
    fc.assert(
      fc.property(sectionInputsArb, (inputs) => {
        const model = buildSiteModel(inputs);
        const landing = defaultLanding(model);

        expect(landing).not.toBeNull();
        expect(landing?.slug).toBe(NOTES_SECTION_SLUG);
        // The landing route belongs to the notes Section.
        expect(landing?.landingRoute.startsWith('/' + NOTES_SECTION_SLUG)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for a single (notes-only) Section as well as many', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (order) => {
        const model = buildSiteModel([sectionInput(NOTES_SECTION_SLUG, order)]);
        const landing = defaultLanding(model);

        expect(landing).not.toBeNull();
        expect(landing?.slug).toBe(NOTES_SECTION_SLUG);
      }),
      { numRuns: 100 },
    );
  });
});
