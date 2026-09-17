import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { slugify, DEFAULT_SLUG, MAX_SLUG_LENGTH } from './slug';

// The canonical shape every Slug must satisfy: one or more runs of lowercase
// alphanumerics joined by single, non-leading, non-trailing hyphens.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Mirror of slugify's normalization up to (but not including) the empty->default
 * substitution. Used to decide, independently of the implementation's control
 * flow, whether an input carries any usable alphanumeric content. If this yields
 * an empty string, slugify must fall back to DEFAULT_SLUG.
 */
function normalizedAlnum(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

describe('Property 1: slug format and length invariant', () => {
  // Feature: portfolio-website, Property 1: For any input string, slugify produces a Slug that matches ^[a-z0-9]+(-[a-z0-9]+)*$, has length between 1 and 100 characters, and is never empty — falling back to the default Slug when the normalized name contains no alphanumeric characters.
  // Validates: Requirements 1.3, 2.1, 2.6
  it('slugify always yields a well-formed, length-bounded, non-empty Slug', () => {
    fc.assert(
      fc.property(
        // Broad coverage: arbitrary strings, plus mixed unicode/diacritic and
        // pure-symbol/empty inputs surfaced through a oneof of tuned generators.
        fc.oneof(
          fc.string(),
          fc.string({ unit: 'grapheme' }),
          // Diacritic-heavy names (e.g. "Café", "naïve résumé").
          fc.constantFrom(
            'Café',
            'naïve résumé',
            'Ångström',
            'Crème brûlée',
            'Málaga—Sevilla',
            'ﬁle ﬂow', // ligatures that NFKD decomposes to ASCII
          ),
          // All-symbol / whitespace / empty inputs -> must hit DEFAULT_SLUG.
          fc.constantFrom('', '   ', '!!!', '---', '@#$%^&*()', '\t\n', '…•·'),
          // Symbol-only strings generated from a punctuation alphabet.
          fc
            .array(fc.constantFrom(...'!@#$%^&*()-_=+[]{};:\'",.<>/?\\| \t\n'))
            .map((chars) => chars.join('')),
        ),
        (input) => {
          const slug = slugify(input);

          // Format: only lowercase alphanumerics with single interior hyphens.
          expect(slug).toMatch(SLUG_PATTERN);

          // Length: between 1 and MAX_SLUG_LENGTH (100) inclusive.
          expect(slug.length).toBeGreaterThanOrEqual(1);
          expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);

          // Never empty.
          expect(slug).not.toBe('');

          // Default fallback when normalization leaves no alphanumeric content.
          if (normalizedAlnum(input) === '') {
            expect(slug).toBe(DEFAULT_SLUG);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
