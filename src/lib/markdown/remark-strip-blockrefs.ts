/**
 * remark plugin: strip Obsidian block-reference markers (Task 4).
 *
 * Obsidian lets authors tag a block with an id so it can be linked to:
 *
 *   Some paragraph of text. ^my-block-id
 *
 *   ^standalone-block-id
 *
 * That trailing ` ^id` (or a lone `^id` line) is an Obsidian-only anchor and
 * must NOT render as literal text on the site. This plugin removes it from the
 * END of text nodes that terminate a paragraph, heading, or list item.
 *
 * ## Safety
 *
 * We only ever touch `Text` nodes, and only the LAST child of a
 * paragraph/heading/listItem. Math (`inlineMath`/`math`) and code
 * (`inlineCode`/`code`) are separate node types whose value is not a child text
 * node, so exponents like `x^2` inside `$…$` and carets inside code are never
 * affected. To avoid clobbering an in-prose caret such as `n^2`, a trailing
 * marker must be preceded by whitespace (`… text ^id`); a lone `^id` text node
 * is also removed.
 */

import { visit } from 'unist-util-visit';
import type { Root, Text, Parent } from 'mdast';

/** Block containers whose final text node may carry a trailing block id. */
const TERMINAL_PARENTS = new Set(['paragraph', 'heading', 'listItem']);

/** ` ^block-id` at the very end (requires preceding whitespace). */
const TRAILING_MARKER = /\s+\^[A-Za-z0-9_-]+\s*$/;
/** A text node that is ONLY a block id (a standalone `^id` line/paragraph). */
const WHOLE_MARKER = /^\s*\^[A-Za-z0-9_-]+\s*$/;

export default function remarkStripBlockrefs() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      const p = parent as Parent;
      if (!TERMINAL_PARENTS.has(p.type)) return;
      // Only the last child of the block can hold a trailing block id.
      if (index !== p.children.length - 1) return;

      if (WHOLE_MARKER.test(node.value)) {
        // The whole node is just the id: drop the text node entirely.
        p.children.splice(index, 1);
        return;
      }
      if (TRAILING_MARKER.test(node.value)) {
        node.value = node.value.replace(TRAILING_MARKER, '');
      }
    });
  };
}
