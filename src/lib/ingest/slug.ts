/**
 * Slug generation and sibling-scoped collision handling for the Ingestion
 * Domain (L1).
 *
 * These functions are pure and framework-free: they have no dependency on
 * Astro, the filesystem, or the DOM, and given the same inputs they always
 * produce the same outputs (Design Property 8 — determinism).
 *
 * Implements the design's "Slug generation" and "Collision handling"
 * algorithms (Requirements 1.3, 2.1, 2.3, 2.4, 2.6).
 */

/** Substitute Slug used when a name normalizes to no alphanumeric content. */
export const DEFAULT_SLUG = 'untitled';

/** Maximum Slug length in characters (Requirement 2.1). */
export const MAX_SLUG_LENGTH = 100;

/**
 * A recorded Slug collision produced by {@link dedupeSlug}. Callers (e.g. the
 * content ingestor) collect these into the build/ingestion report so the
 * Site_Owner can see which sibling names were disambiguated (Requirement 2.3).
 */
export interface SlugCollision {
  /** The base Slug that was already taken. */
  base: string;
  /** The suffixed Slug that was assigned instead. */
  assigned: string;
}

/**
 * Convert a Display_Name into a URL-safe Slug.
 *
 * Algorithm (per design "Slug generation"):
 *   1. NFKD-normalize and strip diacritics (combining marks).
 *   2. Lowercase.
 *   3. Replace every run of characters outside `[a-z0-9]` with a single `-`.
 *   4. Trim leading/trailing `-`.
 *   5. If empty, substitute the default Slug (`untitled`).
 *   6. Truncate to {@link MAX_SLUG_LENGTH} characters, then re-trim any trailing `-`.
 *
 * The result always matches `^[a-z0-9]+(-[a-z0-9]+)*$`, has length between 1
 * and 100, and is never empty (Design Property 1; Requirements 1.3, 2.1, 2.6).
 */
export function slugify(displayName: string): string {
  const normalized = displayName
    .normalize('NFKD')
    // Strip combining diacritical marks left behind by NFKD decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Collapse every run of non-alphanumeric characters into a single hyphen.
    .replace(/[^a-z0-9]+/g, '-')
    // Trim leading/trailing hyphens.
    .replace(/^-+|-+$/g, '');

  // Substitute the default Slug before truncation when nothing usable remains.
  const base = normalized.length === 0 ? DEFAULT_SLUG : normalized;

  // Truncate to the length cap, then re-trim any trailing hyphen the cut left.
  return base.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
}

/**
 * Ensure a Slug is unique within a sibling scope, applying deterministic
 * numeric suffixing on collision (per design "Collision handling").
 *
 * If `slug` is not already in `taken`, it is added and returned unchanged. When
 * it collides, the smallest `n` starting at 2 for which `${slug}-${n}` is not
 * in `taken` is chosen; that candidate is added to `taken` and returned, and
 * the collision is appended to the optional `collisions` log (Requirement 2.3).
 *
 * The `taken` set is mutated so it accumulates every assigned Slug across a
 * sibling scope; sequential calls therefore stay pairwise unique. Because the
 * outcome depends only on `slug` and the current `taken` contents, the function
 * is deterministic (Design Properties 7, 8; Requirements 2.3, 2.4).
 *
 * Note on the length cap: this follows the design's collision algorithm exactly
 * (`${slug}-${n}`) to preserve deterministic, reproducible collision semantics.
 * The 100-char cap is enforced by {@link slugify} on the base Slug; suffixing
 * does not re-truncate, since doing so could alter which candidate maps to
 * which name and break determinism. In practice sibling Slugs are far shorter
 * than the cap, so the suffixed form stays well within 100 characters.
 *
 * @param slug The base Slug to insert (typically from {@link slugify}).
 * @param taken The set of Slugs already used within the sibling scope; mutated.
 * @param collisions Optional log that collisions are appended to when they occur.
 * @returns The unique Slug that was added to `taken`.
 */
export function dedupeSlug(
  slug: string,
  taken: Set<string>,
  collisions?: SlugCollision[],
): string {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }

  let n = 2;
  while (taken.has(`${slug}-${n}`)) {
    n += 1;
  }

  const candidate = `${slug}-${n}`;
  taken.add(candidate);
  collisions?.push({ base: slug, assigned: candidate });
  return candidate;
}
