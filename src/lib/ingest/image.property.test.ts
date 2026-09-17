import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import os from 'node:os';
import { posix } from 'node:path';
import { resolveImagePath } from './image';

// Feature: portfolio-website, Property 10: For any Note source path and relative image reference, the resolver returns the normalized path obtained by resolving the reference against the Note's source directory (equivalent to a normalized directory join), independent of the current working directory.

// Validates: Requirements 3.7

/**
 * A single path segment: URL/path-safe characters, non-empty, and never a
 * relative-navigation token (`.`/`..`) so segments only contribute real
 * directory/file names. `.`/`..` navigation is generated explicitly below.
 */
const segmentArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9_-]+$/)
  .filter((s) => s.length > 0 && s !== '.' && s !== '..');

/**
 * A Note source path such as `notes/topic/index.md` or `/abs/dir/note.md`.
 * Composed of an optional POSIX root, zero or more directory segments, and a
 * trailing file name, so `posix.dirname` yields a meaningful directory.
 */
const noteSourcePathArb: fc.Arbitrary<string> = fc
  .record({
    absolute: fc.boolean(),
    dirs: fc.array(segmentArb, { maxLength: 6 }),
    file: segmentArb,
    ext: fc.constantFrom('.md', '.mdx', ''),
  })
  .map(({ absolute, dirs, file, ext }) => {
    const body = [...dirs, `${file}${ext}`].join('/');
    return absolute ? `/${body}` : body;
  });

/**
 * A relative image reference as written in Markdown: a sequence of `.`, `..`,
 * or normal segments joined by `/` (e.g. `../assets/a.png`, `./img/b.svg`).
 * Constrained to be genuinely relative — it never begins with `/` and never
 * contains a URI scheme — matching the "relative image reference" input space
 * of Property 10 (absolute/scheme/root refs are out of scope for the property).
 */
const relativeImageRefArb: fc.Arbitrary<string> = fc
  .array(fc.oneof(segmentArb, fc.constant('.'), fc.constant('..')), {
    minLength: 1,
    maxLength: 6,
  })
  .map((parts) => parts.join('/'));

describe('resolveImagePath (Property 10: relative image paths resolve against the Note source location)', () => {
  const originalCwd = process.cwd();
  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('returns the normalized directory join of the Note source directory and the reference', () => {
    fc.assert(
      fc.property(noteSourcePathArb, relativeImageRefArb, (noteSourcePath, imageRef) => {
        // Oracle: resolve the reference against the Note's *directory* using
        // POSIX semantics (which collapse `.`/`..` and never read cwd).
        const expected = posix.join(posix.dirname(noteSourcePath), imageRef);
        expect(resolveImagePath(noteSourcePath, imageRef)).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('produces the same result regardless of the current working directory', () => {
    const otherDirs = [os.tmpdir(), os.homedir(), originalCwd];
    fc.assert(
      fc.property(noteSourcePathArb, relativeImageRefArb, (noteSourcePath, imageRef) => {
        const baseline = resolveImagePath(noteSourcePath, imageRef);
        for (const dir of otherDirs) {
          try {
            process.chdir(dir);
          } catch {
            // Skip directories that are not accessible in this environment.
            continue;
          }
          expect(resolveImagePath(noteSourcePath, imageRef)).toBe(baseline);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('yields a normalized path (no redundant "." or resolvable ".." segments) for in-directory references', () => {
    fc.assert(
      fc.property(noteSourcePathArb, relativeImageRefArb, (noteSourcePath, imageRef) => {
        const resolved = resolveImagePath(noteSourcePath, imageRef);
        // The output is already normalized: re-normalizing is a no-op.
        expect(resolved).toBe(posix.normalize(resolved));
      }),
      { numRuns: 200 },
    );
  });
});
