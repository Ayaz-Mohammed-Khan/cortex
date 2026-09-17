/**
 * remark plugin: promote single-line `$$…$$` to display math (math correctness).
 *
 * ## Why this exists
 *
 * Obsidian treats ANY `$$…$$` as DISPLAY (block, centered, display-style) math,
 * including the single-line form `$$a=b$$`. `micromark-extension-math` (used by
 * remark-math) only treats `$$` as block/display when it is FENCED across its
 * own lines:
 *
 *     $$
 *     a = b
 *     $$
 *
 * A single-line `$$a=b$$` is parsed as an INLINE math node, so KaTeX renders it
 * in cramped text-style (small, squashed fractions) rather than roomy
 * display-style — which is the real cause of the "squashed math" in the user's
 * notes (the CSS line-height fix helps, but text-style math still looks wrong).
 *
 * This transformer restores Obsidian semantics: a paragraph whose only content
 * is one or more `$$…$$` equations (optionally several on consecutive lines,
 * which the parser groups into one paragraph) is replaced by the equivalent
 * block `math` node(s), which mdast-util-math renders as `math-display` and
 * rehype-katex renders in display mode.
 *
 * ## Safety / scope
 *
 * - Only `inlineMath` nodes whose ORIGINAL source (looked up via position
 *   offsets in the raw file) starts with `$$` are promoted. Genuine inline
 *   `$…$` math is never touched.
 * - A paragraph is only rewritten when EVERY non-whitespace child is such a
 *   `$$` equation. Mixed prose + `$$` on one line is left inline (rare, and
 *   safer to leave untouched).
 * - Multi-line fenced `$$` is already a `math` node upstream, so it is ignored.
 */

import { visit } from 'unist-util-visit';
import type { Root, Paragraph, Math as MathNode, InlineMath, RootContent } from 'mdast';
import type { VFile } from 'vfile';

/**
 * Build a block `math` mdast node whose `data.hName`/`hChildren` mirror EXACTLY
 * what `mdast-util-math` emits for a fenced (multi-line) `$$` block:
 *
 *   <pre><code class="language-math math-display">…TeX…</code></pre>
 *
 * rehype-katex keys display mode off the `math-display` class, so a promoted
 * single-line equation renders identically to a native block equation. The
 * baked-in `hChildren` are required — a bare `{ type:'math', value }` node has
 * no hast handler here and would fall back to emitting the raw TeX as text.
 */
function makeDisplayMathNode(value: string): MathNode {
  return {
    type: 'math',
    value,
    meta: null,
    data: {
      hName: 'pre',
      hChildren: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: ['language-math', 'math-display'] },
          children: [{ type: 'text', value }],
        },
      ],
    },
  } as MathNode;
}

/** True when this inline-math node was authored with `$$…$$` delimiters. */
function isDisplaySource(node: InlineMath, source: string): boolean {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start == null || end == null) return false;
  return source.slice(start, end).startsWith('$$');
}

/** True for a text node that is only whitespace (paragraph line breaks). */
function isWhitespace(node: RootContent): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

export default function remarkDisplayMath() {
  return (tree: Root, file: VFile): void => {
    const source = String(file.value ?? '');

    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || index === undefined) return;

      const displayMaths: InlineMath[] = [];
      for (const child of node.children) {
        if (isWhitespace(child)) continue;
        if (child.type === 'inlineMath' && isDisplaySource(child, source)) {
          displayMaths.push(child);
        } else {
          // Any other real content -> this is not a pure display-math paragraph.
          return;
        }
      }

      if (displayMaths.length === 0) return;

      // Replace the paragraph with one block `math` node per `$$` equation.
      const mathNodes: MathNode[] = displayMaths.map((m) => makeDisplayMathNode(m.value));

      parent.children.splice(index, 1, ...(mathNodes as unknown as RootContent[]));
      // Continue after the inserted nodes (they have no children to visit).
      return index + mathNodes.length;
    });
  };
}
