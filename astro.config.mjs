// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSanitize from 'rehype-sanitize';
import { sanitizeSchema } from './src/lib/sanitize.ts';
import remarkDisplayMath from './src/lib/markdown/remark-display-math.ts';
import remarkCallouts from './src/lib/markdown/remark-callouts.ts';
import remarkWikilinks from './src/lib/markdown/remark-wikilinks.ts';
import remarkStripBlockrefs from './src/lib/markdown/remark-strip-blockrefs.ts';
import { createWikilinkResolver } from './src/lib/markdown/wikilink-index.ts';

// LIVE `[[wikilink]]` resolution. Instead of freezing a single index snapshot
// at config load, we use a resolver that lazily builds + caches the
// `name -> route` map and cheaply re-checks the notes directory (a `stat`-only
// signature over each `.md` file's path + mtime) before each lookup, rebuilding
// only when the notes actually change. Under `astro dev` — where this config
// module is evaluated ONCE at server start — this means links to notes ADDED or
// RENAMED during a running session resolve LIVE, without a server restart
// (previously they rendered `wikilink-missing` until the server was restarted).
// Under `astro build` the `prebuild` content sync has already populated
// `src/content/notes`, and resolution effectively builds once (the signature is
// computed a single time), so build output is unchanged. The resolver returns
// an empty index (every wikilink then reported unresolved) if the directory is
// not present yet.
//
// NOTE (dev auto-refresh): a fresh INDEX is not a fresh RENDER, and this is worth
// being precise about, because an earlier version of this comment claimed a
// manual browser refresh was enough. It is not. Astro's content layer caches
// rendered html in `.astro/data-store.json` keyed on each note's content DIGEST.
// Wikilinks are resolved during render against the whole notes directory, so if
// page A is rendered while note B is missing from the mirror, A's cached html
// keeps its `wikilink-missing` anchor forever: A's body never changes, so the
// digest still matches and A is never re-rendered, no matter how current the
// resolver's index is. Refreshing the browser re-serves the SAME cached html.
//
// Editing a note is fine (its digest changes, so it re-renders). The broken case
// is a note ADDED or REMOVED while the mirror is being rewritten, which is what
// `syncContent` does on every sync. `scripts/dev.mjs` is what makes this safe:
// it completes the initial sync BEFORE starting the server and clears the store
// once per session, so a poisoned render cannot outlive a restart.
const wikilinkResolver = createWikilinkResolver();

// https://astro.build/config
export default defineConfig({
  // Fully pre-rendered static output: `astro build` emits a static `dist/`
  // deployable to any CDN/static host (Req 9.1).
  output: 'static',

  // Built-in link prefetching for near-instant note-to-note navigation.
  // `prefetchAll` opts every internal `<a>` into prefetching; `defaultStrategy:
  // 'hover'` fetches the target page the moment the pointer hovers (or the link
  // is focused), so by the time the reader clicks, the HTML/assets are already
  // warm in the browser cache. This pairs with the `<ClientRouter />` View
  // Transitions in `Layout.astro`: prefetch warms the cache, View Transitions
  // swap it in without a full reload. Astro injects the prefetch behavior at
  // runtime (there are no static `<link rel="prefetch">` tags in the built
  // HTML) and only prefetches on fast connections that are not data-saver /
  // are not honoring Save-Data, so it is safe and low-cost for a static CDN.
  // Config shape verified against the installed astro@7.1.6 schema
  // (prefetch.prefetchAll: boolean, prefetch.defaultStrategy: 'hover').
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },

  // Absolute base URL of the deployed site. Used for canonical URLs (Req 10.3)
  // and the generated sitemap (Req 10.2). This is the live Cloudflare Pages
  // origin; update it here (then commit + push) if the site ever moves to a
  // custom domain.
  site: 'https://cortex-5om.pages.dev',

  // The site root `/` is a dedicated landing page (src/pages/index.astro) that
  // presents the learning roadmap and links into the notes. (Previously `/`
  // redirected to `/notes`; the landing page now lives at the root instead.)

  // @astrojs/sitemap lists every generated page in `sitemap-index.xml` (Req
  // 10.2). Unpublished Notes are excluded upstream — the ingestion bridge
  // (`src/lib/content.ts`) generates routes only for published Notes via the
  // `sitemap-filter.ts` `publishedRoutes` helper — so no unpublished Note route
  // ever reaches the sitemap.
  integrations: [sitemap()],

  // Markdown rendering pipeline (Req 3).
  //
  // NOTE (task 8.1 scope): this block intentionally configures ONLY math
  // (remark-math -> rehype-katex) and syntax highlighting (Shiki dual theme).
  // Heading slugs/autolinks (task 8.2) and HTML sanitization (task 8.3) append
  // further plugins to the SAME `remarkPlugins`/`rehypePlugins` arrays below.
  markdown: {
    // Astro 7 (`@astrojs/markdown-remark` v7) DEPRECATES the bare
    // `markdown.remarkPlugins` / `markdown.rehypePlugins` fields and requires
    // remark/rehype plugins to be passed to `unified({...})` — Astro's built-in
    // markdown processor — instead. (Configuring them the old way emits a
    // deprecation warning at build.) Later tasks append to these same arrays:
    //   - task 8.2: rehype-slug + rehype-autolink-headings (heading anchors)
    //   - task 8.3: rehype-sanitize (must run LAST so it validates the markup
    //               produced by the plugins above)
    processor: unified({
      // Math: remark-math parses `$...$` (inline) and `$$...$$` (block) syntax;
      // rehype-katex renders it to KaTeX markup at build time (Req 3.4, 3.5).
      //
      // Obsidian-compatibility transformers (custom, dependency-free) run as
      // tree transformers AFTER parsing. Because remark-math extends the PARSER,
      // `$...$` is already `inlineMath`/`math` nodes before these run, so none of
      // them ever touch math (or code) — they operate only on plain text nodes:
      //   - remarkDisplayMath    — promote single-line `$$…$$` (which the parser
      //                            treats as INLINE) to true display math so it
      //                            renders in roomy display-style, matching
      //                            Obsidian (fixes cramped/"squashed" equations).
      //   - remarkCallouts       — `> [!type] …` blockquotes -> callout markup.
      //   - remarkWikilinks      — `[[Target|Alias]]` -> internal <a> links.
      //   - remarkStripBlockrefs — drop trailing Obsidian ` ^block-id` markers.
      // Order: display-math first (it may restructure blockquote paragraphs the
      // callout pass then wraps), then callouts, wikilinks, block-ref stripping.
      // All emit markup the sanitize schema below already permits.
      remarkPlugins: [
        remarkMath,
        remarkDisplayMath,
        remarkCallouts,
        [remarkWikilinks, { resolve: wikilinkResolver.resolve }],
        remarkStripBlockrefs,
      ],

      // rehype plugins run in array order against the HAST produced from the
      // Markdown. Order matters and is deliberate:
      //   1. rehypeKatex — render math first (see below).
      //   2. rehypeSlug — assign a stable `id` to every heading, derived from
      //      its text content. These IDs are what the Table_Of_Contents links
      //      to and what deep links (`/note#some-heading`) resolve against, so
      //      they must be present and stable across builds (Req 4.1). Running
      //      AFTER rehypeKatex means IDs are derived from the final heading
      //      text (math already rendered), keeping anchors consistent.
      //   3. rehypeAutolinkHeadings — turn each slugged heading into an anchor
      //      the reader can click/share. It depends on the `id` set by
      //      rehypeSlug, hence it MUST run after it.
      //
      // `throwOnError: false` => invalid/malformed math is emitted as its
      // original source text with a KaTeX error indication (red) instead of
      // failing the build, so one bad expression never blanks a page or breaks
      // the build (Req 3.6). The paired KaTeX stylesheet (imported in
      // `src/styles/global.css`) styles this output.
      //
      // NOTE (task 8.3 scope): `rehype-sanitize` will be appended to the END of
      // this array so it runs LAST and validates the markup produced by every
      // plugin above (KaTeX output, heading IDs, and autolink anchors). Keep it
      // last when added.
      rehypePlugins: [
        [rehypeKatex, { throwOnError: false }],
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            // `append` keeps the heading's own text intact and adds the anchor
            // link after it (a `wrap` behavior would nest the heading text in
            // the link, which is noisier for screen readers).
            //
            // CRITICAL: the appended anchor must inject NO extractable text.
            // Astro derives both the in-page Table_Of_Contents entries and each
            // heading's accessible name from the heading's text content, so any
            // text inside the anchor (e.g. an old visually-hidden "(permalink)"
            // label) leaks into every TOC entry and heading. The anchor is
            // therefore a real, labeled permalink whose visible affordance is a
            // "#" supplied entirely by CSS (`.heading-anchor::after`), and whose
            // only child is an EMPTY, aria-hidden span — no text node at all.
            // `aria-label` gives the link an accessible name without contributing
            // to the heading text; `tabindex="-1"` keeps it out of the tab order
            // (mouse/hover affordance only) while the heading text remains the
            // heading's accessible name.
            behavior: 'append',
            properties: {
              className: ['heading-anchor'],
              ariaLabel: 'Permalink to this section',
              tabIndex: -1,
            },
            content: {
              type: 'element',
              tagName: 'span',
              properties: { className: ['heading-anchor-icon'], ariaHidden: 'true' },
              children: [],
            },
          },
        ],

        // 4. rehypeSanitize — MUST run LAST so it validates the final HAST
        //    produced by every plugin above (KaTeX/MathML output, Shiki token
        //    markup, heading IDs, and autolink anchors). Its allow-list schema
        //    (see `src/lib/sanitize.ts`) permits that safe markup while
        //    stripping `<script>` elements, `on*` event-handler attributes, and
        //    `javascript:` link targets (Req 3.9).
        [rehypeSanitize, sanitizeSchema],
      ],
    }),

    // Syntax highlighting via Shiki (Astro's built-in highlighter), done at
    // build time with TextMate-grade accuracy. This remains a cross-cutting
    // `markdown.*` option (NOT part of the processor and NOT deprecated). Dual
    // themes render each token once and emit CSS-variable-based markup
    // (`--shiki-light` / `--shiki-dark`) so a single render supports both color
    // schemes (Req 3.2). Our dark mode is driven by the `[data-theme="dark"]`
    // attribute (set by the no-flash theme script) rather than the OS media
    // query; `src/styles/global.css` maps the `--shiki-dark` variables to that
    // selector so code blocks match the site theme (Req 8.7). Languages Shiki
    // does not recognize fall back to plain, unhighlighted monospaced
    // `<pre><code>` automatically (Req 3.3).
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },

  vite: {
    // Tailwind CSS v4 via the first-party Vite plugin (the current
    // community-standard setup; the legacy `@astrojs/tailwind` integration
    // is deprecated). Utilities are pulled from `src/styles/global.css`.
    plugins: [tailwindcss()],
  },
});
