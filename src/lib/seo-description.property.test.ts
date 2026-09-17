import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { metaDescription, DESCRIPTION_MAX_LENGTH } from './seo';

// Feature: portfolio-website, Property 22: For any Note, the emitted meta description has length at most 160 characters; when the Note has body content the description is derived from that content, and when the Note has no content the description equals the (≤160-character) Display_Name.

/**
 * Property 22: Meta description truncation and fallback.
 *
 * Validates: Requirements 10.5, 10.6
 *
 * For any Note, `metaDescription(body, displayName)`:
 *  - emits a description with length at most {@link DESCRIPTION_MAX_LENGTH}
 *    (160) characters (Req 10.5);
 *  - derives the description from the body content when the Note has usable
 *    content (Req 10.5); and
 *  - falls back to the (≤160-character) Display_Name when the Note has no
 *    content (Req 10.6).
 */

const RUNS = { numRuns: 100 };

/**
 * A Display_Name arbitrary spanning short names, names near the 160-char
 * boundary, and long names that must be truncated for the fallback path.
 */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 1, maxLength: 300 }),
  fc
    .array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 40 })
    .map((words) => words.join(' ')),
);

/**
 * Plain-prose body content: whitespace-separated words made of alphanumeric
 * characters only. Avoiding Markdown markers keeps the normalized form equal to
 * `words.join(' ')`, so the derived description is a clean word-boundary prefix
 * of that text. Arrays are long enough to exercise both the sub-160 and
 * truncation paths.
 */
const proseBodyArb: fc.Arbitrary<{ body: string; normalized: string }> = fc
  .array(
    fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 1,
        maxLength: 12,
      })
      .map((chars) => chars.join('')),
    { minLength: 1, maxLength: 60 },
  )
  .map((words) => {
    const normalized = words.join(' ');
    return { body: normalized, normalized };
  });

/** "No content" bodies: undefined, null, empty, or whitespace/newlines only. */
const emptyBodyArb: fc.Arbitrary<string | undefined | null> = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(''),
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 })
    .map((chars) => chars.join('')),
);

describe('metaDescription truncation and fallback (Property 22)', () => {
  it('emits a description of length at most 160 for any body/Display_Name', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 0, maxLength: 400 }), { nil: undefined }),
        fc.string({ minLength: 1, maxLength: 300 }),
        (body, displayName) => {
          const description = metaDescription(body, displayName);
          expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
        },
      ),
      RUNS,
    );
  });

  it('derives the description from body content when the Note has content', () => {
    fc.assert(
      fc.property(proseBodyArb, displayNameArb, ({ body, normalized }, displayName) => {
        const description = metaDescription(body, displayName);

        // Length bound (Req 10.5).
        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);

        // Derived from the body: non-empty and a (word-boundary) prefix of the
        // normalized body content, never introducing characters absent from it.
        expect(description.length).toBeGreaterThan(0);
        expect(normalized.startsWith(description)).toBe(true);

        // When the normalized body already fits, it is used verbatim.
        if (normalized.length <= DESCRIPTION_MAX_LENGTH) {
          expect(description).toBe(normalized);
        }
      }),
      RUNS,
    );
  });

  it('falls back to the (≤160-char) Display_Name when the Note has no content', () => {
    fc.assert(
      fc.property(emptyBodyArb, displayNameArb, (body, displayName) => {
        const description = metaDescription(body, displayName);
        const trimmed = displayName.trim();

        // Fallback is bounded to the same limit (Req 10.6).
        expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);

        // Derived from the Display_Name (a trimmed prefix of it).
        expect(trimmed.startsWith(description)).toBe(true);

        // When the trimmed Display_Name already fits, it is used verbatim.
        if (trimmed.length <= DESCRIPTION_MAX_LENGTH) {
          expect(description).toBe(trimmed);
        }
      }),
      RUNS,
    );
  });
});
