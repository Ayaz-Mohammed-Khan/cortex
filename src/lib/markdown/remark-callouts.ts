/**
 * remark plugin: Obsidian callouts (Task 2).
 *
 * Transforms Obsidian's callout blockquotes into class-only markup that renders
 * as a titled, colored admonition box. Obsidian authors callouts as a
 * blockquote whose first line is a type marker:
 *
 *   > [!TYPE] Optional title on the same line
 *   > body line(s)…
 *
 * It also supports the collapsible markers `[!type]+` / `[!type]-` (the fold
 * state is irrelevant for a static site, so the marker is parsed and dropped),
 * and the single-line form where only a title/marker is present with no body.
 *
 * ## Emitted markup (class-only — no `data-*`, no inline event attributes)
 *
 *   <blockquote class="callout callout-<type>">
 *     <div class="callout-title"><span class="callout-title-text">Title</span></div>
 *     <div class="callout-body"> …rendered children… </div>   <!-- omitted if empty -->
 *   </blockquote>
 *
 * Because the wrapper elements are plain `<blockquote>`/`<div>`/`<span>` carrying
 * only `class`, they pass the existing sanitize allow-list unchanged (those tags
 * are already allowed and `className` is globally permitted). The body keeps its
 * original mdast children, so Markdown inside a callout (lists, math, code,
 * bold, wikilinks, …) still renders normally.
 *
 * ## How it works
 *
 * remark-math parses `$…$` into `inlineMath`/`math` nodes at PARSE time, before
 * this tree transformer runs, so callout bodies containing math are preserved as
 * math nodes. We only rewrite the FIRST text node of a callout's first paragraph
 * (the one carrying the `[!type]` marker); every other child is moved verbatim
 * into the body wrapper.
 */

import { visit } from 'unist-util-visit';
import type { Root, Blockquote, Paragraph, Text, RootContent } from 'mdast';

/** Canonical callout types we style. Unknown types fall back to "note". */
const KNOWN_TYPES = new Set(['note', 'info', 'tip', 'warning', 'example']);

/**
 * Marker at the very start of a callout's first paragraph text node:
 *   group 1: type (letters, e.g. "info")
 *   group 2: optional collapse marker `+` / `-` (parsed, then discarded)
 *   group 3: the rest of the marker LINE = the title (may be empty)
 *   group 4: everything from the first newline onward = body carried in the
 *            same text node (may be undefined when the marker line is the whole
 *            text node value)
 */
const CALLOUT_MARKER =
  /^\s*\[!([^\]\n]+)\]([+-]?)[ \t]*([^\n]*)(\n[\s\S]*)?$/;

/** Capitalize the first character (e.g. "example" -> "Example"). */
function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** Build a `<div class="…">` container node wrapping the given children. */
function divNode(className: string, children: RootContent[]): RootContent {
  return {
    // The node `type` is arbitrary for a container that carries `hName`;
    // mdast-util-to-hast renders it using `data.hName` + `data.hProperties`.
    type: 'calloutContainer',
    data: { hName: 'div', hProperties: { className: [className] } },
    children,
  } as unknown as RootContent;
}

/** Build the `<div class="callout-title"><span …>Title</span></div>` node. */
function titleNode(title: string): RootContent {
  const span = {
    type: 'calloutTitleText',
    data: { hName: 'span', hProperties: { className: ['callout-title-text'] } },
    children: [{ type: 'text', value: title } as Text],
  } as unknown as RootContent;
  return divNode('callout-title', [span]);
}

/**
 * remark plugin factory. Registered in `astro.config.mjs` `remarkPlugins`.
 */
export default function remarkCallouts() {
  return (tree: Root): void => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== 'paragraph') return;

      const paragraph = firstChild as Paragraph;
      const firstInline = paragraph.children[0];
      if (!firstInline || firstInline.type !== 'text') return;

      const match = CALLOUT_MARKER.exec((firstInline as Text).value);
      if (!match) return;

      const rawType = match[1]!.trim();
      const inlineTitle = match[3]!.trim();
      // `match[4]` includes the leading newline when a body shares the marker
      // text node; strip that single newline to recover the body's first line.
      const carriedBody = match[4] ? match[4].replace(/^\n/, '') : '';

      const cssType = KNOWN_TYPES.has(rawType.toLowerCase())
        ? rawType.toLowerCase()
        : 'note';
      const title = inlineTitle.length > 0 ? inlineTitle : capitalize(rawType);

      // Rewrite the marker text node so it only holds the body remainder.
      if (carriedBody.length > 0) {
        (firstInline as Text).value = carriedBody;
      } else {
        // No body text carried in this node — drop the marker text node so the
        // paragraph starts with whatever inline content followed it (e.g. a
        // `strong` node) or becomes empty.
        paragraph.children.shift();
      }

      // If the first paragraph is now empty, remove it entirely.
      if (paragraph.children.length === 0) {
        node.children.shift();
      }

      // Whatever remains in the blockquote is the callout body.
      const bodyChildren = [...node.children];
      const hasBody = bodyChildren.length > 0;

      const newChildren: RootContent[] = [titleNode(title)];
      if (hasBody) {
        newChildren.push(divNode('callout-body', bodyChildren));
      }
      node.children = newChildren as Blockquote['children'];

      // Tag the blockquote itself so it renders as the callout container.
      node.data = node.data || {};
      const props = ((node.data as { hProperties?: Record<string, unknown> })
        .hProperties ??= {});
      props.className = ['callout', `callout-${cssType}`];
    });
  };
}
