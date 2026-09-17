/**
 * Pure, framework-free table-of-contents builder.
 *
 * This module has NO DOM, filesystem, or Astro dependencies so it can be
 * exercised by unit and property tests in isolation. It turns the heading
 * metadata extracted from a Note (see {@link Heading}) into an ordered list of
 * {@link TocEntry} values ready for rendering.
 *
 * The rules it encodes (Req 4.1, 4.2, 4.5; Design Properties 12 and 13):
 *
 *  - Only headings below the Note title level participate. The title is
 *    `depth === 1`, so qualifying headings have `depth >= 2`.
 *  - Entries are emitted in document order (the order headings appear in the
 *    source), never reordered.
 *  - At most {@link MAX_TOC_ENTRIES} (500) entries are produced; a longer run
 *    of headings is truncated to the first 500 in document order.
 *  - When fewer than {@link MIN_TOC_HEADINGS} (2) qualifying headings exist the
 *    Table_Of_Contents is OMITTED. `buildToc` signals omission by returning an
 *    empty array `[]` — callers MUST treat `[]` as "render no TOC", not as "an
 *    empty TOC widget".
 *  - Each entry carries a numeric `indent` computed as
 *    `(depth - minDepth) * INDENT_STEP`, where `minDepth` is the shallowest
 *    qualifying heading depth present. Because `INDENT_STEP` is a positive
 *    constant and `indent` is a strictly increasing function of `depth`, a
 *    deeper heading always has strictly greater indentation than a shallower
 *    one, and the per-level increment is constant.
 */

import type { Heading } from './ingest/types';

/**
 * The Note title occupies heading depth 1. Only headings strictly below the
 * title — i.e. `depth >= MIN_HEADING_DEPTH` — are eligible for the TOC.
 */
export const MIN_HEADING_DEPTH = 2;

/**
 * The minimum number of qualifying headings required to produce a TOC. With
 * fewer than this the TOC is omitted (Req 4.5).
 */
export const MIN_TOC_HEADINGS = 2;

/**
 * The maximum number of entries a TOC may contain. Longer heading runs are
 * truncated to the first {@link MAX_TOC_ENTRIES} in document order (Req 4.1).
 */
export const MAX_TOC_ENTRIES = 500;

/**
 * The constant indentation increment (in `rem`) applied per successive heading
 * level. Being a single positive constant is what guarantees the indentation
 * increment is uniform across levels (Design Property 13).
 */
export const INDENT_STEP = 1;

/** A single rendered table-of-contents entry. */
export interface TocEntry {
  /** Original heading depth (>= {@link MIN_HEADING_DEPTH}). */
  depth: number;
  /** Visible heading text. */
  text: string;
  /** Anchor id used as the link target (from rehype-slug). */
  slug: string;
  /**
   * Numeric start-margin indentation for this entry, in `rem`. Computed as
   * `(depth - minDepth) * INDENT_STEP`, so the shallowest present level has
   * indent `0` and each deeper level adds a constant {@link INDENT_STEP}.
   */
  indent: number;
}

/**
 * Build the table of contents for a Note from its heading metadata.
 *
 * Only headings with `depth >= MIN_HEADING_DEPTH` (i.e. below the title level)
 * qualify. Qualifying headings are kept in document order and capped at
 * {@link MAX_TOC_ENTRIES}.
 *
 * Returns `[]` to signal that the TOC should be OMITTED — this happens when
 * fewer than {@link MIN_TOC_HEADINGS} qualifying headings exist. A non-empty
 * result always contains at least two entries.
 *
 * The `indent` of each entry is `(depth - minDepth) * INDENT_STEP`, where
 * `minDepth` is the shallowest qualifying depth among the (capped) entries.
 * This is a strictly increasing function of `depth` with a constant increment,
 * so deeper headings are always indented strictly more than shallower ones.
 *
 * Pure: the same `headings` input always yields the same result.
 */
export function buildToc(headings: readonly Heading[]): TocEntry[] {
  // Keep only headings below the title level, preserving document order.
  const qualifying = headings.filter((h) => h.depth >= MIN_HEADING_DEPTH);

  // Omit the TOC when there are fewer than two qualifying headings.
  if (qualifying.length < MIN_TOC_HEADINGS) {
    return [];
  }

  // Cap at the maximum number of entries, keeping the first ones in order.
  const capped = qualifying.slice(0, MAX_TOC_ENTRIES);

  // The shallowest present depth anchors indentation at 0.
  const minDepth = capped.reduce((min, h) => Math.min(min, h.depth), capped[0]!.depth);

  return capped.map((h) => ({
    depth: h.depth,
    text: h.text,
    slug: h.slug,
    indent: (h.depth - minDepth) * INDENT_STEP,
  }));
}
