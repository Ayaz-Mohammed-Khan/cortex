/**
 * Sitemap route filtering for the Ingestion Domain (L1).
 *
 * Pure, framework-free logic: no dependency on Astro, the filesystem, or the
 * DOM. Given a set of Notes with arbitrary published flags, returns exactly the
 * routes of the published Notes and excludes every unpublished Note's route.
 *
 * This is the pure core consumed by the @astrojs/sitemap integration so the
 * generated sitemap contains only published Note routes.
 *
 * See design "Property 20: Sitemap contains exactly the published Note routes"
 * (Req 10.2).
 */

/** Minimal shape needed to decide sitemap inclusion. */
export interface SitemapNote {
  /** The Note's absolute route (e.g., "/notes/ai-ml/intro"). */
  route: string;
  /** Whether the Note is published; unpublished Notes are excluded. */
  published: boolean;
}

/**
 * Returns the routes of exactly the published Notes.
 *
 * Every published Note's route is included and no unpublished Note's route is
 * included. Input order is preserved.
 *
 * @param notes - Notes with `route` and `published` fields (e.g., ContentEntry[]).
 * @returns The routes of the published Notes, in input order.
 */
export function publishedRoutes(
  notes: readonly SitemapNote[],
): string[] {
  return notes.filter((note) => note.published).map((note) => note.route);
}
