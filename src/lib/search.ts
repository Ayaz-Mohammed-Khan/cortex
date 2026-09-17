/**
 * Pure, framework-free search helpers.
 *
 * These functions encode the two pieces of search behavior that are our own
 * logic rather than the Pagefind engine's: capping the ranked result set and
 * shaping each record into the fields the UI renders. They have NO dependency
 * on the DOM, the Pagefind runtime, Astro, or the filesystem, so the
 * deterministic rules can be unit- and property-tested in isolation.
 *
 * Requirements: 6.3, 6.7
 * Design Properties: 15, 16
 *
 * See design Data Models "Search Index (Pagefind)" — `SearchRecordMeta`
 * carries `{ displayName, categoryPath, route }`.
 */

/**
 * The maximum number of search results that may be displayed. A longer ranked
 * list is capped to the first {@link MAX_SEARCH_RESULTS} entries, preserving
 * ranking order (Req 6.3, Design Property 15).
 */
export const MAX_SEARCH_RESULTS = 50;

/**
 * Metadata associated with a single indexed Note, as extracted from the search
 * index (Pagefind `data-pagefind-meta` attributes).
 *
 * Mirrors the design's `SearchRecordMeta` model:
 *  - `displayName` — the Note's Display_Name, shown in results (Req 6.7).
 *  - `categoryPath` — the human-readable Category path, e.g.
 *    `"AI-ML / SelfNotes / Statistics & Probability"`, shown in results
 *    (Req 6.7).
 *  - `route` — the Note's absolute route, used as the result link (Req 6.6).
 */
export interface SearchRecordMeta {
  /** The Note's Display_Name, shown in results. */
  displayName: string;
  /** The human-readable Category path, shown in results. */
  categoryPath: string;
  /** The Note's absolute route, used as the result link. */
  route: string;
}

/**
 * The fields exposed for rendering a single search result. Structurally the
 * same shape as {@link SearchRecordMeta}: `resultMeta` selects exactly the
 * Display_Name, Category path, and route from a (possibly wider) record and
 * exposes them for the UI (Req 6.7, Design Property 16).
 */
export interface SearchResultView {
  /** The Note's Display_Name to render. */
  displayName: string;
  /** The Note's Category path to render. */
  categoryPath: string;
  /** The Note's absolute route to link to. */
  route: string;
}

/**
 * Cap a ranked result list to the {@link MAX_SEARCH_RESULTS} highest-ranked
 * entries.
 *
 * The input is assumed to already be in ranking order (best match first). The
 * result is the first `min(ranked.length, MAX_SEARCH_RESULTS)` entries, with
 * their relative ranking order preserved. A shorter list is returned
 * unchanged (as a fresh array). The input array is never mutated.
 *
 * Pure: the same `ranked` input always yields an equal result.
 *
 * Requirements: 6.3 — Design Property 15.
 */
export function capResults<T>(ranked: readonly T[]): T[] {
  return ranked.slice(0, MAX_SEARCH_RESULTS);
}

/**
 * Project a search record onto the fields the result UI renders.
 *
 * Exposes the Note's Display_Name and Category path (plus its route for
 * linking) so that every rendered result shows both the Display_Name and the
 * Category path. Accepts any record that structurally satisfies
 * {@link SearchRecordMeta}; extra fields are ignored.
 *
 * Pure: depends only on its input and returns a fresh object.
 *
 * Requirements: 6.7 — Design Property 16.
 */
export function resultMeta(record: SearchRecordMeta): SearchResultView {
  return {
    displayName: record.displayName,
    categoryPath: record.categoryPath,
    route: record.route,
  };
}
