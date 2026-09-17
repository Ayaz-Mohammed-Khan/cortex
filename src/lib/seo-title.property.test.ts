import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { pageTitle, TITLE_MAX_LENGTH } from './seo';

// Feature: portfolio-website, Property 19: For any Note Display_Name, the emitted page title is derived from that Display_Name and has length at most 60 characters.

/**
 * Property 19: Page title truncation.
 *
 * Validates: Requirements 10.1
 *
 * For any Note Display_Name, `pageTitle` emits a title that:
 *  - has length at most {@link TITLE_MAX_LENGTH} (60) characters, and
 *  - is derived from that Display_Name — i.e. it is a (whitespace-trimmed)
 *    prefix of the trimmed Display_Name, never introducing characters that
 *    were not present in the source.
 *
 * When the trimmed Display_Name already fits within the limit, the title is
 * exactly that trimmed Display_Name (no truncation occurs).
 */

const RUNS = { numRuns: 100 };

/**
 * A Display_Name arbitrary spanning short names, names near the 60-char
 * boundary, and long names that must be truncated. Includes surrounding
 * whitespace and unicode to exercise trimming and length handling.
 */
const displayNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ minLength: 0, maxLength: 200 }),
  fc.string({ minLength: 0, maxLength: 200 }).map((s) => `  ${s}  `),
  // Whitespace-separated words to exercise word-boundary truncation.
  fc
    .array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 30 })
    .map((words) => words.join(' ')),
);

describe('pageTitle truncation and derivation (Property 19)', () => {
  it('emits a title of length at most 60 that is derived from the Display_Name', () => {
    fc.assert(
      fc.property(displayNameArb, (displayName) => {
        const title = pageTitle(displayName);
        const trimmed = displayName.trim();

        // Hard length guarantee (Req 10.1).
        expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);

        // Derived from the Display_Name: the title is a prefix of the trimmed
        // source (possibly with trailing whitespace removed), so it never
        // contains characters absent from the source.
        expect(trimmed.startsWith(title)).toBe(true);

        // When the trimmed name already fits, no truncation occurs.
        if (trimmed.length <= TITLE_MAX_LENGTH) {
          expect(title).toBe(trimmed);
        }
      }),
      RUNS,
    );
  });
});
