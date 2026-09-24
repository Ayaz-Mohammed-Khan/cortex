/**
 * rehype plugin: keep KaTeX's redundant math layers out of the search index.
 *
 * KaTeX renders every expression as a `<span class="katex">` containing THREE
 * representations of the same math:
 *
 *   1. `.katex-html`   — the visible, styled glyphs a reader actually sees.
 *   2. `.katex-mathml` — a visually-hidden MathML tree for assistive tech,
 *                        which INCLUDES an `<annotation encoding=
 *                        "application/x-tex">` node holding the RAW LaTeX
 *                        source (e.g. `\text{SSB}`).
 *
 * Pagefind crawls DOM text and cannot tell these are duplicates of one formula,
 * so it indexes the visible math AND the MathML AND the raw LaTeX. The result
 * is garbled search excerpts like `SST=SSB+SSW\text{SST} = \text{SSB} + …`.
 *
 * This plugin marks the `.katex-mathml` subtree with `data-pagefind-ignore` so
 * Pagefind skips it, indexing only the clean visible `.katex-html` text. The
 * attribute affects the build-time SEARCH CRAWL only; the MathML stays in the
 * live DOM, so screen-reader access to math is completely unchanged.
 *
 * It must run AFTER `rehype-katex` (so the `.katex-mathml` nodes exist) and its
 * emitted attribute must be permitted by the sanitize schema (see
 * `src/lib/sanitize.ts`), which runs last.
 */

import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';

/** True when a HAST element carries the given class name. */
function hasClass(node: Element, className: string): boolean {
  // Widen to `unknown` first: hast's Properties value union otherwise narrows
  // the string branch to `never` under strict settings.
  const cls: unknown = node.properties?.className;
  // hast normally stores class names as an array, but a raw string can occur
  // (e.g. hand-authored HTML). Coerce both shapes to a token list.
  if (Array.isArray(cls)) return cls.map(String).includes(className);
  if (typeof cls === 'string') return cls.split(/\s+/).includes(className);
  return false;
}

export default function rehypeKatexSearch() {
  return (tree: Root): void => {
    visit(tree, 'element', (node: Element) => {
      if (hasClass(node, 'katex-mathml')) {
        // Use the hast PROPERTY form (`dataPagefindIgnore`), not the raw
        // attribute name. hast-stringify serializes it to `data-pagefind-ignore`
        // in the HTML, and hast-util-sanitize matches its allow-list by this
        // same property name (see `src/lib/sanitize.ts`), so the two agree and
        // the attribute survives sanitize. `true` serializes to the bare
        // boolean attribute, which is exactly what Pagefind looks for.
        node.properties = { ...node.properties, dataPagefindIgnore: true };
      }
    });
  };
}
