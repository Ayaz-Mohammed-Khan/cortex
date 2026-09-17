import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isMarkdownFile, filterMarkdownFiles } from './filter';

// Feature: portfolio-website, Property 5: For any set of file names with arbitrary extensions and letter casings, the ingestion file filter selects exactly those whose extension is .md compared case-insensitively, and excludes every other file.

// Validates: Requirements 1.1

/**
 * Independent oracle for "the file's extension is `.md`, case-insensitively".
 *
 * A file matches when it has a final dot that is not the first character (so a
 * bare dotfile such as ".md" is excluded because it has no base name) and the
 * text after that final dot is "md" ignoring case. This is derived directly
 * from Requirement 1.1's wording and is written independently of the
 * implementation so the property is a genuine cross-check rather than a
 * restatement of the code.
 */
function extensionIsMd(name: string): boolean {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return false; // no extension, or a leading-dot dotfile
  return name.slice(lastDot + 1).toLowerCase() === 'md';
}

/** An arbitrary "md" spelled with per-character random casing (md, MD, mD, Md). */
const mdCasedArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('m', 'M'), fc.constantFrom('d', 'D'))
  .map(([m, d]) => m + d);

/**
 * Non-empty base-name segment: alphanumerics plus characters that create
 * interesting extension-boundary cases (dots and spaces). Guaranteed to contain
 * at least one alphanumeric so the base is never empty/whitespace-only.
 */
const baseArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-zA-Z0-9.\- ]*$/)
  .chain((rest) =>
    fc.constantFrom('a', 'Z', '0', '9', 'x').map((lead) => lead + rest),
  );

/** Extensions that are explicitly NOT `.md` (including near-misses). */
const nonMdExtArb: fc.Arbitrary<string> = fc.constantFrom(
  'mdx',
  'markdown',
  'txt',
  'MD.txt',
  'md ',
  ' md',
  'mmd',
  'mdd',
  'png',
  'MDX',
  'html',
  'json',
  'ts',
);

/**
 * A single arbitrary file name spanning the interesting shapes:
 * - a genuine `.md` file with randomly-cased extension and possibly dotted base
 * - a file with a decidedly non-`.md` extension
 * - a fully arbitrary unicode string (covers no-extension names, dotfiles, etc.)
 */
const fileNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(baseArb, mdCasedArb).map(([base, ext]) => `${base}.${ext}`),
  fc.tuple(baseArb, nonMdExtArb).map(([base, ext]) => `${base}.${ext}`),
  fc.string(),
  // Edge shapes: bare extension, dotfile, no extension.
  fc.constantFrom('.md', '.MD', 'md', 'MD', 'readme', 'archive.tar.md', 'a..md'),
);

describe('Markdown file filter (Property 5: only .md files are ingested)', () => {
  it('isMarkdownFile agrees with a case-insensitive .md-extension oracle for any name', () => {
    fc.assert(
      fc.property(fileNameArb, (name) => {
        expect(isMarkdownFile(name)).toBe(extensionIsMd(name));
      }),
      { numRuns: 300 },
    );
  });

  it('any base name with a randomly-cased .md extension is always selected', () => {
    fc.assert(
      fc.property(baseArb, mdCasedArb, (base, ext) => {
        expect(isMarkdownFile(`${base}.${ext}`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('selects exactly the .md files from a set, preserving order and excluding all others', () => {
    fc.assert(
      fc.property(fc.array(fileNameArb, { maxLength: 40 }), (names) => {
        const selected = filterMarkdownFiles(names);
        const expected = names.filter(extensionIsMd);

        // Exactly the .md files, in their original relative order.
        expect(selected).toEqual(expected);

        // Everything selected is a Markdown file...
        for (const name of selected) {
          expect(isMarkdownFile(name)).toBe(true);
        }
        // ...and every excluded name is not a Markdown file.
        const excluded = names.filter((n) => !selected.includes(n));
        for (const name of excluded) {
          expect(isMarkdownFile(name)).toBe(false);
        }

        // Partition is complete: selected + excluded count back to the input.
        expect(selected.length + excluded.length).toBe(names.length);
      }),
      { numRuns: 200 },
    );
  });
});
