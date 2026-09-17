import { describe, it, expect } from 'vitest';

import { metaDescription } from './seo';

// Feature: portfolio-website — verifies that metaDescription normalizes common
// Obsidian syntax (callout markers, wikilinks, highlights, block refs) so raw
// tokens never leak into the emitted <meta name="description">.
describe('metaDescription normalizes Obsidian syntax', () => {
  const body =
    '> [!info] Naming clarity\n' +
    '> Some people call the umbrella term "PDF" too.\n' +
    'See [[02 - Probability Distributions|distributions]] and ==key idea==. ^ref1';

  const description = metaDescription(body, 'Fallback Name');

  it('keeps the meaningful prose from the callout, wikilink, and highlight', () => {
    expect(description).toContain('Naming clarity');
    expect(description).toContain('Some people call');
    expect(description).toContain('distributions');
    expect(description).toContain('key idea');
  });

  it('drops the raw Obsidian tokens', () => {
    expect(description).not.toContain('[!info]');
    expect(description).not.toContain('[[');
    expect(description).not.toContain(']]');
    expect(description).not.toContain('==');
    expect(description).not.toContain('^ref1');
  });

  it('leaves inline math superscripts intact (no false block-ref strip)', () => {
    const math = metaDescription('The identity $x^2 + y^2 = z^2$ holds.', 'Fallback');
    expect(math).toContain('x^2');
    expect(math).toContain('y^2');
  });
});
