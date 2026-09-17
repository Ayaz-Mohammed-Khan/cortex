// @vitest-environment node
//
// Rendering a real `.astro` component with Astro's container API is a
// server-side render, so this file runs in the `node` environment. That makes
// Vitest use its SSR transform for the imported `.astro` module (the default
// jsdom/web transform compiles it for client hydration, which the container
// cannot server-render). No DOM is needed here.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import CategoryListing from './CategoryListing.astro';
import { buildTree } from '@/lib/ingest/tree';
import type { CategoryNode, RawNode } from '@/lib/ingest/types';

// Unit test for `CategoryListing.astro` (task 17.5; Req 5.2, 5.7).
//
// The component renders a Category's child Categories and Notes in display
// order (the tree is pre-ordered by the Ingestion Domain), and shows a "no
// content" message when the Category is empty.
//
// Approach: the display-order rule lives in the Ingestion Domain
// (`compareSiblings` via `buildTree`), and the empty-state message text lives
// only inside the component. There is no separate importable presentation
// helper for either behavior, so we render the real `.astro` component with
// Astro's container API and assert on the produced HTML. The expected display
// order is derived from `buildTree` (reusing the real ordering) rather than
// hand-ordered, so the test verifies the component preserves the computed order.
//
// Validates: Requirements 5.2 (children rendered in display order) and 5.7
// (empty-Category message).

/**
 * Builds a single-level Category whose children exercise every ordering rule:
 * prefixed-before-unprefixed, ascending order value, then case-insensitive
 * alphabetical. Input is deliberately scrambled and interleaves Categories and
 * Notes so the assertion proves ordering is by order/name, not by kind or input
 * order. Display_Names are capitalized while Slugs are lowercased, so a
 * case-sensitive search for a Display_Name never collides with a `href` slug.
 */
function buildScrambledCategory(): CategoryNode {
  const parent = '/content';
  const nodes: RawNode[] = [
    { absPath: `${parent}/Zebra.md`, rawName: 'Zebra.md', isNote: true }, // unprefixed note
    { absPath: `${parent}/02 Beta.md`, rawName: '02 Beta.md', isNote: true }, // order 2 note
    { absPath: `${parent}/Cherry`, rawName: 'Cherry', isNote: false }, // unprefixed category
    { absPath: `${parent}/01 Alpha`, rawName: '01 Alpha', isNote: false }, // order 1 category
    { absPath: `${parent}/Mango.md`, rawName: 'Mango.md', isNote: true }, // unprefixed note
  ];
  return buildTree(nodes);
}

describe('CategoryListing.astro (Req 5.2, 5.7)', () => {
  let container: AstroContainer;

  beforeAll(async () => {
    container = await AstroContainer.create();
  });

  it('renders child Categories and Notes in the computed display order (Req 5.2)', async () => {
    const node = buildScrambledCategory();
    const expectedOrder = node.children.map((child) => child.displayName);

    // Guard: the Ingestion Domain ordering (prefixed-first, then ascending
    // order value, then case-insensitive alphabetical) produced this sequence.
    // A note (Beta) precedes a category (Cherry), proving ordering ignores kind.
    expect(expectedOrder).toEqual(['Alpha', 'Beta', 'Cherry', 'Mango', 'Zebra']);

    const html = await container.renderToString(CategoryListing, {
      props: { node },
    });

    // Every child is rendered as a link, and both kinds are labelled.
    expect(html).toContain('<ul');
    expect(html).toContain('<a');
    expect(html).toContain('Category');
    expect(html).toContain('Note');
    expect(html).not.toContain('has no content yet');

    // The rendered Display_Names appear in exactly the computed display order.
    const positions = expectedOrder.map((name) => html.indexOf(name));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('shows the "no content" message for an empty Category (Req 5.7)', async () => {
    const emptyCategory: CategoryNode = {
      kind: 'category',
      displayName: 'Empty Topic',
      slug: 'empty-topic',
      route: '/notes/empty-topic',
      order: 0,
      hasPrefix: false,
      children: [],
    };

    const html = await container.renderToString(CategoryListing, {
      props: { node: emptyCategory },
    });

    // The Category heading still renders...
    expect(html).toContain('Empty Topic');
    // ...alongside the empty-state message, and no listing/links are emitted.
    expect(html).toContain('This category has no content yet.');
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<a');
  });
});
