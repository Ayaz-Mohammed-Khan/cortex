import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { parseName } from './prefix';

// Feature: portfolio-website, Property 2: For any name formed by a leading run of digits (value in 0..999,999,999) followed by a RUN of one or more separator characters and an arbitrary remainder, parseName returns order equal to the integer value of those digits and displayName equal to the remainder with the leading digits and the separator run removed; for any name without such a prefix, parseName returns order = null and displayName equal to the trimmed original name.

/**
 * Property 2: Order_Prefix parsing extracts the integer and strips the prefix.
 *
 * Validates: Requirements 1.4, 1.5
 *
 * Two complementary generators drive this property:
 *
 *  - a "prefixed" generator that constructs `digits + separatorRun + remainder`
 *    with the digit value inside 0..999,999,999, a NON-EMPTY run of separator
 *    characters, and a remainder that is pre-trimmed AND does not start with a
 *    separator character (so the maximal-run strip is well-defined and the
 *    remainder is preserved verbatim). For these, `parseName` must return the
 *    integer digit value and the remainder verbatim.
 *
 *  - an "unprefixed" generator covering the three ways a name fails to carry a
 *    valid Order_Prefix: it does not start with a digit, it starts with digits
 *    that are immediately followed by a non-separator character (no separator
 *    run), or its leading digit run exceeds 999,999,999. For these, `parseName`
 *    must return `order = null` and the trimmed original name.
 */

const MAX_ORDER = 999_999_999;
const RUNS = { numRuns: 300 };

/** The four separator characters the parser recognizes after a digit run. */
const separatorArb: fc.Arbitrary<string> = fc.constantFrom(' ', '-', '_', '.');

/** A NON-EMPTY run (1..4 chars) of separator characters, in any mix. */
const separatorRunArb: fc.Arbitrary<string> = fc
  .array(separatorArb, { minLength: 1, maxLength: 4 })
  .map((chars) => chars.join(''));

/** Newline-free character pools (the parser's `.` does not span newlines). */
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SEPARATORS = ' -_.';
const OTHER_SYMBOLS = '!@#&()+=';

const safeCharArb: fc.Arbitrary<string> = fc.constantFrom(
  ...(LETTERS + DIGITS + SEPARATORS + OTHER_SYMBOLS).split(''),
);

/** Any newline-free text, trimmed so leading/trailing whitespace is never present. */
const trimmedTextArb: fc.Arbitrary<string> = fc
  .array(safeCharArb, { minLength: 0, maxLength: 24 })
  .map((chars) => chars.join('').trim());

/** Characters that are neither separators nor whitespace (safe as a leading char). */
const nonSeparatorCharArb: fc.Arbitrary<string> = fc.constantFrom(
  ...(LETTERS + DIGITS + OTHER_SYMBOLS).split(''),
);

/**
 * A remainder that is trimmed AND whose first character is NOT a separator, so
 * the parser's maximal separator-run strip has a well-defined boundary and the
 * remainder survives `parseName` verbatim. Always non-empty.
 */
const remainderAfterRunArb: fc.Arbitrary<string> = fc
  .tuple(nonSeparatorCharArb, trimmedTextArb)
  .map(([lead, rest]) => (lead + rest).trim());

/** A digit string whose integer value is in 0..999,999,999 (optionally zero-padded). */
const inRangeDigitsArb: fc.Arbitrary<{ digits: string; value: number }> = fc
  .tuple(fc.integer({ min: 0, max: MAX_ORDER }), fc.nat({ max: 3 }))
  .map(([value, pad]) => ({ digits: '0'.repeat(pad) + String(value), value }));

/** A valid prefixed name plus the values parseName should extract from it. */
const prefixedArb: fc.Arbitrary<{ name: string; value: number; displayName: string }> = fc
  .record({
    d: inRangeDigitsArb,
    sepRun: separatorRunArb,
    remainder: remainderAfterRunArb,
  })
  .map(({ d, sepRun, remainder }) => ({
    name: d.digits + sepRun + remainder,
    value: d.value,
    displayName: remainder,
  }));

/** Characters that break prefix matching when they immediately follow a digit run. */
const nonSeparatorNonDigitArb: fc.Arbitrary<string> = fc.constantFrom(
  ...(LETTERS + OTHER_SYMBOLS).split(''),
);

/** Names that do not begin with a digit (so `^(\d+)` cannot match). */
const noLeadingDigitArb: fc.Arbitrary<string> = fc
  .tuple(nonSeparatorNonDigitArb, trimmedTextArb)
  .map(([first, rest]) => first + rest);

/** Names that start with digits immediately followed by a non-separator (no run). */
const digitsNoSeparatorArb: fc.Arbitrary<string> = fc
  .record({
    digits: fc.array(fc.constantFrom(...DIGITS.split('')), { minLength: 1, maxLength: 12 }),
    breaker: nonSeparatorNonDigitArb,
    rest: trimmedTextArb,
  })
  .map(({ digits, breaker, rest }) => digits.join('') + breaker + rest);

/**
 * Names whose leading digit run exceeds 999,999,999 (treated as unprefixed).
 * A separator run still follows the digits, so the pattern matches but the range
 * check rejects it — `parseName` falls back to `order = null` + trimmed original.
 */
const outOfRangeDigitsArb: fc.Arbitrary<string> = fc
  .record({
    value: fc.integer({ min: MAX_ORDER + 1, max: Number.MAX_SAFE_INTEGER }),
    sepRun: separatorRunArb,
    remainder: trimmedTextArb,
  })
  .map(({ value, sepRun, remainder }) => String(value) + sepRun + remainder);

const unprefixedArb: fc.Arbitrary<string> = fc.oneof(
  noLeadingDigitArb,
  digitsNoSeparatorArb,
  outOfRangeDigitsArb,
);

describe('parseName Order_Prefix extraction (Property 2)', () => {
  it('extracts the integer order and strips the leading digits + separator run', () => {
    fc.assert(
      fc.property(prefixedArb, ({ name, value, displayName }) => {
        const parsed = parseName(name);
        expect(parsed.order).toBe(value);
        expect(parsed.displayName).toBe(displayName);
      }),
      RUNS,
    );
  });

  it('returns order = null and the trimmed original name when there is no valid prefix', () => {
    fc.assert(
      fc.property(unprefixedArb, (name) => {
        const parsed = parseName(name);
        expect(parsed.order).toBeNull();
        expect(parsed.displayName).toBe(name.trim());
      }),
      RUNS,
    );
  });
});
