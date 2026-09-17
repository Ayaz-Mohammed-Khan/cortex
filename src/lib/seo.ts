/**
 * Pure, framework-free SEO metadata helpers.
 *
 * These functions derive the title, meta description, canonical URL, and
 * structured (JSON-LD) metadata for a Note page from plain data. They have no
 * dependency on Astro, the DOM, or the filesystem so the deterministic
 * truncation and derivation rules can be unit- and property-tested in
 * isolation.
 *
 * Requirements: 10.1, 10.3, 10.4, 10.5, 10.6
 * Design Properties: 19, 21, 22
 */

import type { ContentEntry } from './ingest/types';

/** Maximum length, in characters, of an emitted page title (Req 10.1). */
export const TITLE_MAX_LENGTH = 60;

/** Maximum length, in characters, of an emitted meta description (Req 10.5, 10.6). */
export const DESCRIPTION_MAX_LENGTH = 160;

/**
 * Truncate `text` to at most `limit` characters.
 *
 * The hard guarantee is `result.length <= limit`. When truncation is required
 * we prefer to cut at the last word boundary that falls within the limit so we
 * avoid slicing a word in half; if there is no usable boundary (e.g. a single
 * very long token) we fall back to a hard character cut. Any trailing
 * whitespace produced by the cut is trimmed. The function is deterministic:
 * the same input always yields the same output.
 */
function truncate(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;

  // Hard cut to the limit first, then try to retreat to a word boundary.
  const hardCut = text.slice(0, limit);
  const lastSpace = hardCut.lastIndexOf(' ');

  // Only retreat to the word boundary when it keeps a reasonable amount of
  // text (avoids returning almost nothing when the first word is very long).
  if (lastSpace > 0 && lastSpace >= Math.floor(limit / 2)) {
    return hardCut.slice(0, lastSpace).trimEnd();
  }
  return hardCut.trimEnd();
}

/**
 * Collapse Markdown/whitespace noise in `body` into clean, single-spaced prose
 * suitable for a meta description.
 *
 * This is a lightweight, deterministic strip — not a full Markdown parser. It
 * removes the most common syntactic markers (fences, headings, emphasis, link
 * and image wrappers, blockquote/list markers) and also normalizes common
 * Obsidian syntax (callout markers like `[!info]`, `[[wikilinks]]`,
 * `==highlights==`, and trailing ` ^block-id` references). It then collapses
 * all runs of whitespace (including newlines) to a single space. Math spans
 * (`$...$` / `$$...$$`) are intentionally left untouched.
 */
function stripMarkdown(body: string): string {
  return body
    // Remove fenced code blocks entirely (```...``` and ~~~...~~~).
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    // Inline code: keep the code text, drop the backticks.
    .replace(/`([^`]*)`/g, '$1')
    // Images: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links: [text](url) -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Obsidian wikilinks: [[Target|Alias]] -> Alias, [[Target]] -> Target.
    // Done before emphasis/marker strips so the resolved text is preserved.
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias ?? target)
    // ATX heading markers at line start.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // Blockquote markers at line start.
    .replace(/^\s{0,3}>\s?/gm, '')
    // Obsidian callout markers, e.g. [!info], [!note], [!warning] with an
    // optional trailing collapse marker (+/-). The leading `>` is removed by
    // the blockquote rule above; this drops the leftover [!type] token and
    // leaves any callout title text intact.
    .replace(/\[!\w+\][+-]?/g, '')
    // Unordered/ordered list markers at line start.
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
    // Obsidian highlights: ==text== -> text.
    .replace(/==([^=\n]+)==/g, '$1')
    // Emphasis / strikethrough markers.
    .replace(/[*_~]{1,3}/g, '')
    // Trailing Obsidian block-reference ids, e.g. ` ^block-id` at end of line.
    // Anchored to end-of-line so inline math superscripts like `$x^2$` (which
    // sit mid-line with no leading space before `^`) are left untouched.
    .replace(/[ \t]+\^[A-Za-z0-9_-]+[ \t]*$/gm, '')
    // Collapse all whitespace (incl. newlines) to single spaces.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive a page title from a Note's Display_Name, truncated to at most
 * {@link TITLE_MAX_LENGTH} characters.
 *
 * Requirements: 10.1 — Design Property 19.
 */
export function pageTitle(displayName: string): string {
  return truncate(displayName.trim(), TITLE_MAX_LENGTH);
}

/**
 * Derive a meta description for a Note.
 *
 * When the Note has usable body content, the description is derived from that
 * content (with Markdown/whitespace stripped) and truncated to at most
 * {@link DESCRIPTION_MAX_LENGTH} characters. When the Note has no content
 * (undefined, null, empty, or whitespace/markdown-only), the description falls
 * back to the Display_Name, itself truncated to <=160 characters.
 *
 * Requirements: 10.5, 10.6 — Design Property 22.
 */
export function metaDescription(
  body: string | undefined | null,
  displayName: string,
): string {
  const cleaned = body != null ? stripMarkdown(body) : '';
  if (cleaned.length > 0) {
    return truncate(cleaned, DESCRIPTION_MAX_LENGTH);
  }
  // Fallback to Display_Name (bounded to the same limit).
  return truncate(displayName.trim(), DESCRIPTION_MAX_LENGTH);
}

/**
 * Build the canonical URL for a page from an absolute base URL and a route.
 *
 * Normalization choice: any trailing slash on `base` is removed before
 * concatenation. This keeps the result a well-formed absolute URL (no `//`
 * between origin and route) regardless of whether the configured base was
 * written as `https://example.com` or `https://example.com/`. Routes are
 * expected to begin with `/` (as produced by `buildRoute`), so the result is
 * `normalizedBase + route`.
 *
 * For well-formed inputs — a `base` without a trailing slash and a `route`
 * beginning with `/` — normalization is a no-op and the result equals exactly
 * `base + route`, matching Design Property 21.
 *
 * Requirements: 10.3 — Design Property 21.
 */
export function canonicalUrl(base: string, route: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  return normalizedBase + route;
}

/** A schema.org Article JSON-LD object. */
export interface ArticleJsonLd {
  '@context': 'https://schema.org';
  '@type': 'Article';
  headline: string;
  name: string;
  url: string;
  mainEntityOfPage: {
    '@type': 'WebPage';
    '@id': string;
  };
}

/**
 * Build a schema.org Article JSON-LD object for a Note.
 *
 * The emitted object identifies the page type as an `Article` and includes the
 * Note's Display_Name as both `headline` and `name`. The `url` /
 * `mainEntityOfPage` fields use the supplied absolute `canonical` URL when
 * provided (see {@link canonicalUrl}); otherwise they fall back to the entry's
 * own route so `articleJsonLd(entry)` remains valid on its own.
 *
 * Requirements: 10.4 — Design Property 21.
 */
export function articleJsonLd(
  entry: ContentEntry,
  canonical?: string,
): ArticleJsonLd {
  const url = canonical ?? entry.route;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: entry.displayName,
    name: entry.displayName,
    url,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
  };
}
