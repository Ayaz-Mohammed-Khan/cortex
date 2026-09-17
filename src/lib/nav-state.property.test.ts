import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { computeNavState } from './nav-state';
import type { CategoryNode, NoteNode, TreeNode } from './ingest/types';

// Feature: portfolio-website, Property 14: For any Note in a generated tree, the computed navigation state marks that Note as selected and marks exactly the set of its ancestor Categories as expanded (no more, no fewer), so the full Category path from root to the Note is visible.

/**
 * Property 14: Active navigation path.
 *
 * Validates: Requirements 5.4
 *
 * We generate an arbitrary navigation tree of Categories (folders) and Notes
 * (leaves) with globally unique routes and Note `entryId`s. During generation
 * we record, for every Note, the exact set of ancestor Category routes on the
 * path from the root down to that Note's immediate parent.
 *
 * For each Note in the generated tree, `computeNavState` must:
 *  - mark that Note as selected (`selectedNoteId === entryId`, `isSelected`),
 *  - mark EXACTLY that Note's ancestor Categories as expanded — no more, no
 *    fewer (`expandedCategoryRoutes` equals the recorded ancestor set, and
 *    `isExpanded` agrees for every Category route in the tree).
 */

const RUNS = { numRuns: 100 };

/**
 * A shape-only tree node produced by the arbitrary. Concrete routes / ids are
 * assigned deterministically afterwards so we can guarantee global uniqueness.
 */
type Shape = { kind: 'note' } | { kind: 'category'; children: Shape[] };

const shapeArb: fc.Arbitrary<Shape> = fc.letrec<{ node: Shape }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 4, depthSize: 'small' },
    // Leaf: a Note.
    fc.constant<Shape>({ kind: 'note' }),
    // Branch: a Category with 1..4 children.
    fc
      .array(tie('node'), { minLength: 1, maxLength: 4 })
      .map<Shape>((children) => ({ kind: 'category', children })),
  ),
})).node;

/** A forest of top-level nodes. */
const forestArb: fc.Arbitrary<Shape[]> = fc.array(shapeArb, {
  minLength: 1,
  maxLength: 4,
});

interface Built {
  nodes: TreeNode[];
  /** Every Note's entryId -> the exact set of its ancestor Category routes. */
  noteAncestors: Map<string, Set<string>>;
  /** Every Category route present in the tree. */
  allCategoryRoutes: Set<string>;
}

/**
 * Assign globally-unique routes / entryIds to a shape forest and record each
 * Note's exact ancestor Category routes. `path` uniquely identifies a node's
 * position, guaranteeing uniqueness across the whole tree.
 */
function build(shapes: Shape[], path: string, ancestors: string[], acc: Built): TreeNode[] {
  return shapes.map((shape, i) => {
    const nodePath = `${path}/${i}`;
    if (shape.kind === 'note') {
      const note: NoteNode = {
        kind: 'note',
        entryId: `note${nodePath}`,
        displayName: `Note ${nodePath}`,
        slug: `note-${i}`,
        route: `/route${nodePath}`,
        order: i,
        hasPrefix: false,
      };
      acc.noteAncestors.set(note.entryId, new Set(ancestors));
      return note;
    }
    const route = `/route${nodePath}`;
    acc.allCategoryRoutes.add(route);
    const category: CategoryNode = {
      kind: 'category',
      displayName: `Cat ${nodePath}`,
      slug: `cat-${i}`,
      route,
      order: i,
      hasPrefix: false,
      children: build(shape.children, nodePath, [...ancestors, route], acc),
    };
    return category;
  });
}

function buildForest(shapes: Shape[]): Built {
  const acc: Built = {
    nodes: [],
    noteAncestors: new Map(),
    allCategoryRoutes: new Set(),
  };
  acc.nodes = build(shapes, '', [], acc);
  return acc;
}

describe('computeNavState active path (Property 14)', () => {
  it('selects the Note and expands exactly its ancestor Categories', () => {
    fc.assert(
      fc.property(forestArb, (shapes) => {
        const { nodes, noteAncestors, allCategoryRoutes } = buildForest(shapes);

        // Only meaningful when the tree contains at least one Note.
        fc.pre(noteAncestors.size > 0);

        for (const [entryId, expectedAncestors] of noteAncestors) {
          const state = computeNavState(nodes, entryId);

          // The Note is selected.
          expect(state.selectedNoteId).toBe(entryId);
          expect(state.isSelected(entryId)).toBe(true);

          // Exactly the ancestor Categories are expanded — no more, no fewer.
          expect(new Set(state.expandedCategoryRoutes)).toEqual(expectedAncestors);

          // isExpanded agrees for every Category route in the tree.
          for (const route of allCategoryRoutes) {
            expect(state.isExpanded(route)).toBe(expectedAncestors.has(route));
          }
        }
      }),
      RUNS,
    );
  });
});
