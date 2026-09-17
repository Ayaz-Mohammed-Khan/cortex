/**
 * Relative image path resolution for the Ingestion Domain (L1).
 *
 * Pure, framework-free logic: no dependency on Astro, the DOM, or the process
 * working directory. Given a Note's source path and a relative image reference
 * taken from that Note's Markdown, it resolves the reference against the Note's
 * source *directory* and returns a normalized, forward-slash path.
 *
 * The resolution is deliberately independent of `process.cwd()` so results are
 * deterministic and identical on every OS and in every environment (a build
 * machine, CI, or a developer's laptop). This is achieved by:
 *   1. Converting any backslash separators to forward slashes up front.
 *   2. Resolving purely with POSIX path semantics (`node:path`'s `posix`),
 *      which never consults the current working directory, rather than the
 *      platform-dependent `path.resolve`, which would anchor relative inputs
 *      at `process.cwd()`.
 *
 * Satisfies Design Property 10; Requirement 3.7.
 */

import { posix } from 'node:path';

/**
 * Matches an absolute reference that must be left untouched:
 *   - a URI scheme such as `http:`, `https:`, `data:`, `mailto:` (RFC 3986),
 *   - a protocol-relative URL beginning with `//`, or
 *   - a root-absolute path beginning with a single `/` (e.g. `/images/a.png`),
 *     which already denotes a fixed location and must not be re-anchored at the
 *     Note's directory.
 *
 * These are out of scope for source-relative resolution (the design resolves
 * *relative* image references), so they are returned verbatim.
 */
const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

/**
 * Replace Windows-style backslash separators with forward slashes so the
 * reference and source path can be resolved with uniform POSIX semantics
 * regardless of the authoring OS.
 */
function toPosixSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Resolve a relative image reference against the directory of a Note's source
 * file, returning the normalized (`.`/`..` segments collapsed) forward-slash
 * path.
 *
 * Behavior:
 *   - The Note's directory is derived from `noteSourcePath` by dropping its
 *     final path segment (the file name).
 *   - `imageRef` is joined onto that directory and normalized, collapsing `.`
 *     and `..` segments (e.g. `../assets/a.png` climbs one level).
 *   - Resolution uses POSIX semantics only and never reads `process.cwd()`, so
 *     the same inputs always yield the same output on any platform
 *     (Design Property 10).
 *   - Absolute references — URLs with a scheme (`https://…`, `data:…`),
 *     protocol-relative (`//cdn/…`), or root-absolute paths (`/images/a.png`) —
 *     are considered out of scope and returned unchanged.
 *
 * @param noteSourcePath - The Note's source file path (absolute or relative;
 *   backslashes are accepted and normalized to forward slashes).
 * @param imageRef - The image reference as written in the Note's Markdown.
 * @returns The normalized, forward-slash-separated resolved path, or `imageRef`
 *   unchanged when it is an absolute URL, protocol-relative, or root-absolute
 *   reference.
 */
export function resolveImagePath(noteSourcePath: string, imageRef: string): string {
  // Absolute URLs, protocol-relative, and root-absolute refs are out of scope:
  // return them as-is rather than re-anchoring at the Note's directory.
  if (ABSOLUTE_REF.test(imageRef)) {
    return imageRef;
  }

  const normalizedSource = toPosixSeparators(noteSourcePath);
  const normalizedRef = toPosixSeparators(imageRef);

  // The Note's directory: everything up to (but not including) the file name.
  const noteDir = posix.dirname(normalizedSource);

  // Join resolves the reference against the directory and normalizes `.`/`..`.
  // `posix.join` never consults process.cwd(), unlike `path.resolve`.
  return posix.join(noteDir, normalizedRef);
}
