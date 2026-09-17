import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildSiteModel,
  type Section,
  type SectionInput,
} from './section';
import type { CategoryNode, TreeNode } from './ingest/types';

// Feature: portfolio-website, Property 23: For any set of Sections, the content entries and routes produced for one Section depend only on that Section's own input; adding, changing, or removing any other Section leaves every unaffected Section's entries and routes unchanged.

// Validates: Requirements 11.1, 11.4

/**
 * Slug-like string: lowercase alphanumerics separated by single hyphens, matching
 * the shape of ingested slugs (^[a-z0-9]+(-[a-z0-9]+)*$). Non-empty so no route
 * segment collapses.
 */
const slugArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .filter((s) => s.length > 0);

/** A note (leaf) node whose route is prefixed by the owning section's slug. */
function noteNodeArb(sectionSlug: string): fc.Arbitrary<TreeNode> {
  return fc.record({
    slug: slugArb,
    displayName: fc.string(),
    order: fc.integer({ min: 0, max: 1000 }),
    hasPrefix: fc.boolean(),
  }).map(({ slug, displayName, order, hasPrefix }) => ({
    kind: 'note' as const,
    entryId: `/${sectionSlug}/${slug}`,
    displayName,
    slug,
    route: `/${sectionSlug}/${slug}`,
    order,
    hasPrefix,
  }));
}

/** A section root {@link CategoryNode} whose content lives entirely under its own slug. */
function rootNodeArb(sectionSlug: string): fc.Arbitrary<CategoryNode> {
  return fc
    .array(noteNodeArb(sectionSlug), { maxLength: 6 })
    .map((children) => ({
      kind: 'category' as const,
      displayName: sectionSlug,
      slug: sectionSlug,
      route: `/${sectionSlug}`,
      order: 0,
      hasPrefix: false,
      children,
    }));
}

/** A full section input built from a given (unique) slug. */
function sectionInputArb(slug: string): fc.Arbitrary<SectionInput> {
  return fc.record({
    displayName: fc.string(),
    order: fc.integer({ min: 0, max: 1000 }),
    rootNode: rootNodeArb(slug),
  }).map(({ displayName, order, rootNode }) => ({
    slug,
    displayName,
    order,
    rootNode,
  }));
}

/**
 * Flatten a section into the full sequence of (route, entryId) pairs it
 * produces — the section's landing route plus every route/entry reachable
 * through its own navigation tree. This is exactly the "content entries and
 * routes produced for one Section" that Property 23 requires to be stable.
 */
function sectionRoutesAndEntries(section: Section): unknown {
  const collected: Array<{ route: string; entryId?: string }> = [];

  const walk = (node: TreeNode): void => {
    if (node.kind === 'note') {
      collected.push({ route: node.route, entryId: node.entryId });
    } else {
      collected.push({ route: node.route });
      for (const child of node.children) {
        walk(child);
      }
    }
  };

  walk(section.rootNode);

  return {
    slug: section.slug,
    landingRoute: section.landingRoute,
    entries: collected,
  };
}

/**
 * A set of section inputs with pairwise-unique slugs (Req 11.6 forbids
 * duplicate slugs, which `buildSiteModel` enforces by throwing), plus a chosen
 * target index into that set.
 */
const sectionSetWithTargetArb = fc
  .uniqueArray(slugArb, { minLength: 2, maxLength: 6 })
  .chain((slugs) =>
    fc.tuple(
      fc.tuple(...slugs.map((slug) => sectionInputArb(slug))),
      fc.nat({ max: slugs.length - 1 }),
    ),
  )
  .map(([inputs, targetIndex]) => ({ inputs: [...inputs], targetIndex }));

describe('Section isolation and route stability (Property 23)', () => {
  it("a built Section's entries and routes depend only on its own input", () => {
    fc.assert(
      fc.property(sectionSetWithTargetArb, ({ inputs, targetIndex }) => {
        const target = inputs[targetIndex]!;

        // Reference: full site model containing every section.
        const full = buildSiteModel(inputs);
        const fullTarget = full.sections.find((s) => s.slug === target.slug)!;
        const reference = sectionRoutesAndEntries(fullTarget);

        // Isolated: a site model built from ONLY the target section.
        const isolated = buildSiteModel([target]);
        const isolatedTarget = isolated.sections.find((s) => s.slug === target.slug)!;

        // Entries/routes are identical whether or not other sections exist.
        expect(sectionRoutesAndEntries(isolatedTarget)).toEqual(reference);
      }),
      { numRuns: 100 },
    );
  });

  it("adding, changing, or removing other Sections leaves the target Section's entries and routes unchanged", () => {
    fc.assert(
      fc.property(sectionSetWithTargetArb, ({ inputs, targetIndex }) => {
        const target = inputs[targetIndex]!;

        const baseline = buildSiteModel(inputs);
        const baselineTarget = baseline.sections.find((s) => s.slug === target.slug)!;
        const reference = sectionRoutesAndEntries(baselineTarget);

        // Perturb every OTHER section: drop it, or replace its content/routes
        // wholesale, while leaving the target section input untouched.
        const perturbed: SectionInput[] = [];
        inputs.forEach((input, i) => {
          if (i === targetIndex) {
            perturbed.push(input);
            return;
          }
          // Randomly drop some other sections entirely...
          if (input.order % 2 === 0) {
            return;
          }
          // ...and mutate the rest so their trees/routes differ.
          const mutatedSlug = `${input.slug}-x`;
          perturbed.push({
            slug: mutatedSlug,
            displayName: `${input.displayName}!`,
            order: input.order + 500,
            rootNode: {
              kind: 'category',
              displayName: mutatedSlug,
              slug: mutatedSlug,
              route: `/${mutatedSlug}`,
              order: 0,
              hasPrefix: false,
              children: [
                {
                  kind: 'note',
                  entryId: `/${mutatedSlug}/extra`,
                  displayName: 'extra',
                  slug: 'extra',
                  route: `/${mutatedSlug}/extra`,
                  order: 0,
                  hasPrefix: false,
                },
              ],
            },
          });
        });

        // Also add a brand-new section that did not exist before.
        perturbed.push({
          slug: 'freshly-added-section',
          displayName: 'Freshly Added',
          order: 9999,
          rootNode: {
            kind: 'category',
            displayName: 'freshly-added-section',
            slug: 'freshly-added-section',
            route: '/freshly-added-section',
            order: 0,
            hasPrefix: false,
            children: [],
          },
        });

        const changed = buildSiteModel(perturbed);
        const changedTarget = changed.sections.find((s) => s.slug === target.slug)!;

        expect(sectionRoutesAndEntries(changedTarget)).toEqual(reference);
      }),
      { numRuns: 100 },
    );
  });
});
