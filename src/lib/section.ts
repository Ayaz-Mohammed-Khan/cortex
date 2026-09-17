/**
 * Pure, framework-free Section / SiteModel model and helpers (extensibility).
 *
 * The notes section is one instance of a generic {@link Section} model; new
 * sections drop in without touching existing routes. This module models the
 * design's "Section (extensibility)" data types and the pure helpers that
 * assemble and query a {@link SiteModel}.
 *
 * It has NO dependency on Astro, the DOM, or the filesystem: it operates purely
 * on the plain data produced by the Ingestion Domain (each section's
 * {@link CategoryNode} root), so the following guarantees are directly unit- and
 * property-testable:
 *
 *  - Sections are *isolated*: the content/routes produced for one Section depend
 *    ONLY on that Section's own input; assembling a {@link SiteModel} never
 *    mutates or reads another Section's data (Design Property 23, Req 11.1/11.4).
 *  - Site-level navigation lists every Section by Display_Name with the notes
 *    Section FIRST, then the remaining Sections in their configured `order`
 *    (Design Property 24, Req 11.2).
 *  - The default landing content is always the notes Section, regardless of how
 *    many Sections exist (Design Property 25, Req 11.3/11.7).
 */

import type { CategoryNode } from './ingest/types';

/** Slug of the notes section — the site-wide default landing section. */
export const NOTES_SECTION_SLUG = 'notes';

/**
 * A Section of the site (e.g. notes, and future sections). Each Section is a
 * self-contained unit whose routes are all prefixed by its {@link Section.slug}.
 */
export interface Section {
  /** Unique slug; prefixes every route in the section (Req 11.6). */
  slug: string;
  /** Human-readable name shown in site-level navigation. */
  displayName: string;
  /** Ordering value for site navigation; notes sorts first (Req 11.2). */
  order: number;
  /** Absolute route of the section's landing content (Req 11.5, 11.3, 11.7). */
  landingRoute: string;
  /** Root of the section's navigation tree (its own isolated content). */
  rootNode: CategoryNode;
}

/** The whole site: an ordered set of isolated Sections plus the default slug. */
export interface SiteModel {
  /** Independently built, isolated Sections (Req 11.1). */
  sections: Section[];
  /** Slug of the section resolved at the site root — always `notes` (Req 11.3, 11.7). */
  defaultSectionSlug: string;
}

/**
 * Input describing a single Section, before assembly into a {@link SiteModel}.
 *
 * `landingRoute` is optional: when omitted it is derived deterministically from
 * this input alone (the section's own `rootNode.route`, falling back to
 * `"/" + slug`), keeping each Section's derivation dependent only on its own
 * data.
 */
export interface SectionInput {
  slug: string;
  displayName: string;
  order: number;
  rootNode: CategoryNode;
  landingRoute?: string;
}

/** A lightweight site-navigation item: just the slug and Display_Name. */
export interface SectionNavItem {
  slug: string;
  displayName: string;
}

/**
 * Derive a Section's landing route from its own input only.
 *
 * Prefers the section's root node route (already section-prefixed by the
 * Ingestion Domain); falls back to `"/" + slug` when no explicit landing route
 * is supplied and the root has no route.
 */
function deriveLandingRoute(input: SectionInput): string {
  if (typeof input.landingRoute === 'string' && input.landingRoute.length > 0) {
    return input.landingRoute;
  }
  if (input.rootNode && typeof input.rootNode.route === 'string' && input.rootNode.route.length > 0) {
    return input.rootNode.route;
  }
  return '/' + input.slug;
}

/**
 * Build a single {@link Section} from its input in isolation.
 *
 * The result is a fresh object whose every field is derived ONLY from `input`.
 * This function neither reads nor mutates any other Section, which is the core
 * of the isolation guarantee (Property 23).
 */
export function buildSection(input: SectionInput): Section {
  return {
    slug: input.slug,
    displayName: input.displayName,
    order: input.order,
    landingRoute: deriveLandingRoute(input),
    rootNode: input.rootNode,
  };
}

/**
 * Assemble a {@link SiteModel} from a set of Section inputs.
 *
 * Each Section is built independently via {@link buildSection}, so one Section's
 * content and routes depend only on that Section's own input; adding, changing,
 * or removing any other Section leaves every unaffected Section unchanged
 * (Property 23, Req 11.1/11.4).
 *
 * Section slugs must be pairwise unique across the site (Req 11.6); a duplicate
 * slug is a programming error and throws.
 *
 * @param inputs the section inputs, in any order
 * @param defaultSectionSlug the slug resolved at the site root (default `notes`)
 * @throws Error when two inputs share a slug
 */
export function buildSiteModel(
  inputs: readonly SectionInput[],
  defaultSectionSlug: string = NOTES_SECTION_SLUG,
): SiteModel {
  const seen = new Set<string>();
  const sections: Section[] = [];

  for (const input of inputs) {
    if (seen.has(input.slug)) {
      throw new Error(`Duplicate section slug: "${input.slug}" (section slugs must be unique).`);
    }
    seen.add(input.slug);
    // Built from `input` alone — no cross-section reads or mutation.
    sections.push(buildSection(input));
  }

  return { sections, defaultSectionSlug };
}

/**
 * Return the site-level navigation ordering.
 *
 * Lists every Section by Display_Name with the notes Section FIRST, followed by
 * the remaining Sections in ascending configured `order` (ties broken by
 * case-insensitive Display_Name then slug for determinism). Satisfies
 * Property 24 (Req 11.2).
 *
 * The input model is not mutated; a new array is returned.
 */
export function sectionNavItems(model: SiteModel): SectionNavItem[] {
  const notes = model.sections.filter((s) => s.slug === NOTES_SECTION_SLUG);
  const rest = model.sections.filter((s) => s.slug !== NOTES_SECTION_SLUG);

  rest.sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    const an = a.displayName.toLowerCase();
    const bn = b.displayName.toLowerCase();
    if (an !== bn) {
      return an < bn ? -1 : 1;
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  return [...notes, ...rest].map((s) => ({ slug: s.slug, displayName: s.displayName }));
}

/**
 * Resolve the default landing content: always the notes Section.
 *
 * Returns the Section whose slug equals `model.defaultSectionSlug` (which is
 * `notes` by construction), regardless of how many Sections exist. Satisfies
 * Property 25 (Req 11.3, 11.7).
 *
 * @returns the default (notes) Section, or `null` when no Section matches the
 *          configured default slug.
 */
export function defaultLanding(model: SiteModel): Section | null {
  return model.sections.find((s) => s.slug === model.defaultSectionSlug) ?? null;
}
