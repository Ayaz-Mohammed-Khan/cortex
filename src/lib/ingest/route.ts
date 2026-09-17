/**
 * Route construction for the Ingestion Domain (L1).
 *
 * Pure, framework-free logic: no dependency on Astro, the filesystem, or the
 * DOM. Given a section slug, the ordered ancestor slugs (root -> immediate
 * parent), and the entry's own slug, produces the canonical absolute route.
 *
 * See design "Route construction" (Req 2.2, supports 11.6 section prefixing).
 */

/**
 * Builds the absolute route for a Note or Category.
 *
 * The route is `"/" + [sectionSlug, ...ancestorSlugs, selfSlug].join("/")`, so
 * its path segments equal that sequence in order and the route always begins
 * with `"/" + sectionSlug`.
 *
 * @param sectionSlug - The section's slug, which prefixes every route in the section.
 * @param ancestorSlugs - Ordered ancestor slugs from the content root down to the immediate parent.
 * @param selfSlug - The entry's own slug.
 * @returns The absolute route string (e.g., "/notes/ai-ml/self-notes/intro").
 */
export function buildRoute(
  sectionSlug: string,
  ancestorSlugs: string[],
  selfSlug: string,
): string {
  return '/' + [sectionSlug, ...ancestorSlugs, selfSlug].join('/');
}
