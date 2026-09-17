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
