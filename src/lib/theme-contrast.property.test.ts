import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  themeTokens,
  CONTRAST_THRESHOLDS,
  hexToRgb,
  type ThemeMode,
  type ColorTokenPair,
} from './theme';

// Feature: portfolio-website, Property 17: For any Theme_Mode and for any defined foreground/background token pair used for body text or interactive controls, the computed WCAG contrast ratio is at least 4.5:1; and for any large-scale-text token pair, the ratio is at least 3:1.

/**
 * Property 17: Theme color token pairs meet WCAG contrast thresholds.
 *
 * Validates: Requirements 7.6
 *
 * For every Theme_Mode ('light' | 'dark') and every defined foreground/
 * background token pair, the WCAG contrast ratio must meet the threshold for
 * its scale: `normal` (body text / interactive controls) requires >= 4.5:1 and
 * `large` (large-scale text) requires >= 3:1.
 *
 * The contrast-ratio computation is implemented locally here (rather than
 * reusing `contrastRatio` from the implementation) so the test independently
 * verifies the token data against the WCAG 2.x definition.
 */

const RUNS = { numRuns: 100 };

const THEME_MODES: ThemeMode[] = ['light', 'dark'];

/** Relative luminance of a `#rrggbb`/`#rgb` color per WCAG 2.x, in [0, 1]. */
function luminanceOf(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colors, in [1, 21]. */
function wcagContrast(foreground: string, background: string): number {
  const lumFg = luminanceOf(foreground);
  const lumBg = luminanceOf(background);
  const lighter = Math.max(lumFg, lumBg);
  const darker = Math.min(lumFg, lumBg);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Flatten every (mode, pair) into a single sample space for the generator. */
const tokenPairSamples: Array<{ mode: ThemeMode; pair: ColorTokenPair }> = THEME_MODES.flatMap(
  (mode) => themeTokens[mode].pairs.map((pair) => ({ mode, pair })),
);

describe('theme token contrast thresholds (Property 17)', () => {
  it('every token pair (any Theme_Mode) meets its WCAG contrast threshold', () => {
    fc.assert(
      fc.property(fc.constantFrom(...tokenPairSamples), ({ pair }) => {
        const ratio = wcagContrast(pair.foreground, pair.background);
        const required = CONTRAST_THRESHOLDS[pair.scale];
        expect(ratio).toBeGreaterThanOrEqual(required);
      }),
      RUNS,
    );
  });

  it('normal-scale pairs meet 4.5:1 and large-scale pairs meet 3:1 for each mode', () => {
    fc.assert(
      fc.property(fc.constantFrom(...THEME_MODES), (mode) => {
        for (const pair of themeTokens[mode].pairs) {
          const ratio = wcagContrast(pair.foreground, pair.background);
          const required = pair.scale === 'normal' ? 4.5 : 3;
          expect(ratio).toBeGreaterThanOrEqual(required);
        }
      }),
      RUNS,
    );
  });
});
