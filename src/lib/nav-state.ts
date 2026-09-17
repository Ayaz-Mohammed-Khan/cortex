/**
 * Pure, framework-free navigation active-path state helper.
 *
 * Given the navigation tree (a root {@link CategoryNode} or a list of
 * {@link TreeNode}) and the identity of the currently viewed Note, this module
 * computes the navigation state consumed by the presentation layer's NavTree
 * component (task 16.1):
 *
 *  - the current Note is marked as the *selected* entry, and
 *  - EXACTLY the ancestor Categories of that Note (from the content root down
 *    to the Note's immediate parent) are marked as *expanded* — no more, no
 *    fewer — so the full Category path from root to the Note is visible.
 *
 * This satisfies Design Property 14 (Requirement 5.4).
 *
 * The module has NO dependency on Astro, the DOM, or the filesystem: it
 * operates purely on the plain tree data produced by the Ingestion Domain, so
 * the exact-ancestors guarantee is directly unit- and property-testable.
 */

import type { CategoryNode, TreeNode } from './ingest/types';

/**
 * The navigation tree passed to {@link computeNavState}. Accepts either the
 * root {@link CategoryNode} or a bare list of top-level {@link TreeNode}s
 * (e.g. the root's children), whichever the caller has on hand.
 */
export type NavTree = CategoryNode | TreeNode[];

/**
 * The computed navigation state.
 *
 * `selectedNoteId` is the `entryId` of the matched Note, or `null` when the
 * supplied identifier does not correspond to any Note in the tree.
 *
 * `expandedCategoryRoutes` is the set of Category `route`s that must be shown
 * expanded. Per Property 14 this set equals *precisely* the ancestor
 * Categories of the selected Note; it is empty when no Note matched.
 */
export interface NavState {
  /** `entryId` of the selected Note, or `null` when nothing matched. */
  readonly selectedNoteId: string | null;
  /** Routes of exactly the ancestor Categories of the selected Note. */
  readonly expandedCategoryRoutes: ReadonlySet<string>;
  /** True when `route` belongs to an ancestor Category of the selected Note. */
  isExpanded(route: string): boolean;
  /** True when `entryId` is the selected Note. */
  isSelected(entryId: string): boolean;
}

/** Normalize the tree argument to a list of top-level nodes. */
function toNodeList(tree: NavTree): TreeNode[] {
  if (Array.isArray(tree)) {
    return tree;
  }
  return tree.children;
}

/**
 * Depth-first search for the Note identified by `currentNoteId`, matching on
 * either its `entryId` or its `route`. On success returns the routes of the
 * Categories along the path from the root down to the Note's immediate parent,
 * in root-to-parent order, together with the matched Note's `entryId`.
 *
 * `ancestorRoutes` accumulates the Category routes on the current path. It is
 * mutated during traversal and restored (via slicing a fresh array per branch)
 * so sibling branches never see each other's ancestors — guaranteeing the
 * returned set contains *exactly* the matched Note's ancestors.
 */
function findNotePath(
  nodes: readonly TreeNode[],
  currentNoteId: string,
  ancestorRoutes: readonly string[],
): { entryId: string; ancestorRoutes: readonly string[] } | null {
  for (const node of nodes) {
    if (node.kind === 'note') {
      if (node.entryId === currentNoteId || node.route === currentNoteId) {
        return { entryId: node.entryId, ancestorRoutes };
      }
    } else {
      // Category: descend with this category appended to the ancestor path.
      const found = findNotePath(node.children, currentNoteId, [
        ...ancestorRoutes,
        node.route,
      ]);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Compute the navigation state for the currently viewed Note.
 *
 * @param tree          the navigation tree (root Category or top-level nodes)
 * @param currentNoteId the current Note's `entryId` or `route`
 * @returns a {@link NavState} marking the Note selected and exactly its
 *          ancestor Categories expanded.
 *
 * When `currentNoteId` matches no Note in the tree, the returned state selects
 * nothing and expands no Category.
 */
export function computeNavState(tree: NavTree, currentNoteId: string): NavState {
  const match = findNotePath(toNodeList(tree), currentNoteId, []);

  const selectedNoteId = match ? match.entryId : null;
  const expandedCategoryRoutes: ReadonlySet<string> = new Set(
    match ? match.ancestorRoutes : [],
  );

  return {
    selectedNoteId,
    expandedCategoryRoutes,
    isExpanded(route: string): boolean {
      return expandedCategoryRoutes.has(route);
    },
    isSelected(entryId: string): boolean {
      return selectedNoteId !== null && entryId === selectedNoteId;
    },
  };
}
