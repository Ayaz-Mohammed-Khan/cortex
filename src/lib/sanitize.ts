// HTML sanitization schema + wrapper for the Markdown rendering pipeline.
//
// Requirement 3.9: when the Renderer renders raw Markdown-authored content, it
// SHALL sanitize embedded HTML so that (a) no embedded script executes,
// (b) script-invoking attributes (`on*` event handlers) are removed, and
// (c) script-invoking link targets (`javascript:` URLs) are neutralized — all
// WHILE preserving non-script HTML formatting.
//
// We build on `rehype-sanitize`'s `defaultSchema` (a battle-tested allow-list)
// and widen it just enough to keep the markup produced by the rest of our
// pipeline intact:
//   - KaTeX (rehype-katex): MathML elements + `<span class style>` +
//     `aria-hidden`, and the `<svg>` glyphs KaTeX uses for stretchy delimiters
//     and radicals.
//   - Shiki (syntax highlighting): `<pre>/<code>/<span>` carrying `class` and
//     inline `style` (the dual-theme CSS variables / token colors).
//   - rehype-slug + rehype-autolink-headings: heading `id`s and anchor links.
//
// The allow-list model means anything we do NOT list is dropped, so `<script>`
// (never added to `tagNames`) and `on*` handlers (never added to `attributes`)
// are stripped automatically, and only the safe URL protocols below are kept
// for `href`/`src` — which is what neutralizes `javascript:` targets.

import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Schema } from 'hast-util-sanitize';

/** MathML element names emitted by KaTeX's MathML fallback tree. */
const MATHML_TAGS = [
  'math',
  'semantics',
  'annotation',
  'annotation-xml',
  'mrow',
  'mi',
  'mn',
  'mo',
  'ms',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'mroot',
  'msqrt',
  'mstyle',
  'mmultiscripts',
  'mover',
  'munder',
  'munderover',
  'mtable',
  'mtr',
  'mtd',
  'mlabeledtr',
  'mpadded',
  'mphantom',
  'menclose',
  'mfenced',
  'merror',
  'mglyph',
  'mprescripts',
  'none',
];

/** SVG element names KaTeX uses for stretchy delimiters / radicals. */
const SVG_TAGS = ['svg', 'path', 'line', 'g', 'defs', 'use', 'rect', 'polyline'];

const baseGlobalAttributes = defaultSchema.attributes?.['*'] ?? [];

/**
 * The sanitize schema shared by the build pipeline (astro.config.mjs) and the
 * unit/property tests (task 8.4). Deliberately additive over `defaultSchema`.
 */
export const sanitizeSchema: Schema = {
  ...defaultSchema,

  // `defaultSchema` rewrites `id`/`name` with a `user-content-` prefix to guard
  // against DOM clobbering. That would desync heading `id`s from the in-page
  // TOC/deep-link anchors (`#heading`), so we disable the prefix to keep them
  // stable (Req 4.1).
  clobberPrefix: '',

  // Only these protocols survive on link/media targets. `javascript:` is absent,
  // so `javascript:`-invoking targets are neutralized (Req 3.9).
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'irc', 'ircs', 'mailto', 'xmpp', 'tel'],
    src: ['http', 'https', 'mailto', 'data'],
  },

  tagNames: [...(defaultSchema.tagNames ?? []), ...MATHML_TAGS, ...SVG_TAGS],

  attributes: {
    ...defaultSchema.attributes,

    // Applied to every element: `class` and inline `style` carry KaTeX layout
    // and Shiki token colors; `aria-hidden` hides KaTeX's visual copy from AT;
    // `aria-disabled` marks unresolved wikilinks (`<a class="wikilink-missing"
    // aria-disabled="true">`) — an ARIA state, never a script vector;
    // `aria-label` names the appended heading-anchor permalinks
    // (rehype-autolink-headings) so they announce as "Permalink to this
    // section" without injecting visible/extractable heading text.
    // Note: `on*` handlers are NOT listed here, so they are always stripped.
    '*': [...baseGlobalAttributes, 'className', 'style', 'ariaHidden', 'ariaDisabled', 'ariaLabel'],

    // Anchors: `defaultSchema` restricts `<a>` `className` to a single GitHub
    // value via the tuple `['className', 'data-footnote-backref']`, which would
    // silently strip our `wikilink` / `wikilink-missing` classes (and the
    // `heading-anchor` autolink class) down to `class=""`. Drop that value
    // restriction so a bare `className` (any value) is allowed on links, while
    // keeping every other safe `a` attribute (href, aria-*). No `on*` handler is
    // introduced, and only safe URL protocols still pass (see `protocols`).
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter(
        (attr) => !(Array.isArray(attr) && attr[0] === 'className'),
      ),
      'className',
    ],

    // Syntax-highlight containers (Shiki) may carry a language marker + tabindex.
    pre: [...(defaultSchema.attributes?.pre ?? []), 'className', 'style', 'tabIndex', 'dataLanguage'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className', 'style'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className', 'style'],

    // KaTeX MathML attributes.
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    'annotation-xml': ['encoding'],
    mi: ['mathvariant'],
    mo: [
      'accent',
      'fence',
      'largeop',
      'lspace',
      'maxsize',
      'minsize',
      'movablelimits',
      'rspace',
      'separator',
      'stretchy',
      'symmetric',
    ],
    mspace: ['width', 'height', 'depth', 'linebreak'],
    mpadded: ['width', 'height', 'depth', 'lspace', 'voffset'],
    mstyle: ['displaystyle', 'scriptlevel', 'mathcolor', 'mathbackground'],
    menclose: ['notation'],

    // KaTeX SVG glyph attributes.
    svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style', 'className'],
    path: ['d'],
    line: ['x1', 'y1', 'x2', 'y2', 'strokeWidth'],
    use: ['xlinkHref', 'href'],
  },
};

// Reuse a single processor instance (schema is immutable) for the string helper.
const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify);

/**
 * Sanitize an HTML fragment string using {@link sanitizeSchema}. This runs the
 * exact same rehype-sanitize configuration the Astro build applies, so it is a
 * faithful target for unit/property tests (task 8.4).
 */
export function sanitizeHtml(html: string): string {
  return String(processor.processSync(html));
}
