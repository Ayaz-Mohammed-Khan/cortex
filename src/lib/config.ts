/**
 * Build-time configuration for the content pipeline.
 *
 * The Site_Owner's notes live outside the repository (for example
 * `D:\Learnings\Notes\...`). The build defines a *configurable content root*
 * so the pipeline stays host-agnostic and reproducible on CI where the
 * external drive is not present (CI points `CONTENT_ROOT` at a checked-in or
 * fetched copy). See design "Content sync step".
 */

/** Default content root used when `CONTENT_ROOT` is not set. */
export const DEFAULT_CONTENT_ROOT = './content';

/**
 * The directory (relative to `src/content/`) that the sync step mirrors the
 * content root into, and that Astro Content Collections later glob.
 */
export const NOTES_TARGET_DIR = 'src/content/notes';

/**
 * Resolve the configured content root.
 *
 * Reads the `CONTENT_ROOT` environment variable and falls back to
 * {@link DEFAULT_CONTENT_ROOT} when it is unset or blank. The returned value
 * may be an absolute path (e.g. an external drive) or a path relative to the
 * project root; callers resolve it against the working directory as needed.
 */
export function getContentRoot(): string {
  const value = process.env.CONTENT_ROOT;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return DEFAULT_CONTENT_ROOT;
}

/** The effective content root at module-load time. */
export const CONTENT_ROOT = getContentRoot();

/**
 * Theme palette configuration.
 *
 * The site's theme is switched from ONE place: set `SITE_PALETTE` below to any
 * name in {@link PALETTES}. The value is applied as `data-palette` on `<html>`
 * (see `Layout.astro`), and `styles/palette.css` defines each theme's token
 * scales under a matching `[data-palette="…"]` selector.
 *
 * The slate and semantic status colours are shared and defined once in
 * `palette.css`; a theme sets its accent (and optionally a secondary hue and a
 * tinted neutral scale). Only `violet` ships today; the system supports more.
 */

/**
 * Every theme shipped in `styles/palette.css`.
 *
 * Only `violet` ships today. To add a palette: add its name here, add a
 * matching `[data-palette="name"]` block in `styles/palette.css`, and point
 * `SITE_PALETTE` at it. The token system (accent / secondary / gray) and the
 * Tailwind `@theme` wiring already support any number of palettes with no
 * component changes.
 */
export const PALETTES = ['violet'] as const;

/** A valid palette name. */
export type Palette = (typeof PALETTES)[number];

/**
 * The active accent palette. Change this single value to re-theme the site.
 * Must be one of {@link PALETTES}.
 */
export const SITE_PALETTE: Palette = 'violet';
