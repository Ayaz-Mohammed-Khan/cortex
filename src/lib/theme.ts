/**
 * Pure, framework-free theming module.
 *
 * This module contains NO DOM, filesystem, or Astro dependencies so it can be
 * exercised by unit and property tests in isolation. It provides:
 *
 *  - `resolveTheme`: the deterministic rule for choosing the initial Theme_Mode
 *    from a stored preference and the OS color-scheme preference (Req 8.1, 8.2,
 *    8.4, 8.5, 8.6).
 *  - Color token pairs (as raw hex data) for light and dark modes, so their
 *    WCAG contrast can be verified later (Req 7.6, verified by Property 17).
 *  - A pure WCAG 2.x contrast-ratio helper used by those verifications.
 */

/** The active color scheme. */
export type ThemeMode = 'light' | 'dark';

/**
 * A stored theme preference read from persistent storage. `null`/`undefined`
 * mean no preference has been persisted yet.
 */
export type StoredTheme = ThemeMode | null | undefined;

/**
 * The operating system color-scheme preference. `null`/`undefined` mean the
 * preference is undeterminable (e.g. `matchMedia` unavailable).
 */
export type OsPreference = ThemeMode | null | undefined;

/**
 * Resolve the initial Theme_Mode.
 *
 * Precedence:
 *   1. the stored Theme_Mode when present;
 *   2. otherwise `dark` — dark is the site default for first-time visitors,
 *      independent of the OS preference.
 *
 * Because a selected mode is persisted as `stored`, re-resolving after a
 * selection returns that same mode (a visitor who toggles to light keeps it).
 *
 * `osPref` is accepted for signature/backwards compatibility but no longer
 * influences the default (the site is dark-by-default, not OS-driven).
 *
 * This function is pure: same inputs always yield the same output.
 */
export function resolveTheme(stored: StoredTheme, _osPref?: OsPreference): ThemeMode {
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'dark';
}

// ---------------------------------------------------------------------------
// Color tokens
// ---------------------------------------------------------------------------

/**
 * The contrast requirement class for a token pair (WCAG 2.x):
 *  - `normal` body text / interactive controls require >= 4.5:1 (Req 7.6);
 *  - `large` large-scale text requires >= 3:1 (Req 7.6).
 */
export type ContrastScale = 'normal' | 'large';

/** Minimum WCAG contrast ratio required per scale. */
export const CONTRAST_THRESHOLDS: Record<ContrastScale, number> = {
  normal: 4.5,
  large: 3,
};

/** A foreground/background color pairing expressed as data (hex values). */
export interface ColorTokenPair {
  /** Stable identifier for the semantic role of this pair. */
  name: string;
  /** Foreground color as a `#rrggbb` hex string. */
  foreground: string;
  /** Background color as a `#rrggbb` hex string. */
  background: string;
  /** Which WCAG contrast threshold this pair must satisfy. */
  scale: ContrastScale;
}

/** All token pairs for a single Theme_Mode. */
export interface ThemeTokens {
  mode: ThemeMode;
  /** Base surface (page background) for the mode. */
  surface: string;
  /** Foreground/background pairs whose contrast must meet WCAG thresholds. */
  pairs: ColorTokenPair[];
}

/**
 * Light-mode tokens: near-black text/controls on a near-white surface.
 * Values are chosen to comfortably exceed the WCAG thresholds.
 */
const LIGHT_TOKENS: ThemeTokens = {
  mode: 'light',
  surface: '#ffffff',
  pairs: [
    // Body text: near-black on white (~17:1).
    { name: 'body-text', foreground: '#1a1a1a', background: '#ffffff', scale: 'normal' },
    // Secondary/muted body text (~9:1).
    { name: 'muted-text', foreground: '#44474f', background: '#ffffff', scale: 'normal' },
    // Interactive control label / link on surface (~6.7:1).
    { name: 'interactive', foreground: '#1d4ed8', background: '#ffffff', scale: 'normal' },
    // Text on a filled interactive control (~6.7:1).
    { name: 'on-interactive', foreground: '#ffffff', background: '#1d4ed8', scale: 'normal' },
    // Large-scale headings (~18:1).
    { name: 'heading-large', foreground: '#111827', background: '#ffffff', scale: 'large' },
  ],
};

/**
 * Dark-mode tokens: near-white text/controls on a near-black surface.
 * Values are chosen to comfortably exceed the WCAG thresholds.
 */
const DARK_TOKENS: ThemeTokens = {
  mode: 'dark',
  surface: '#121212',
  pairs: [
    // Body text: near-white on near-black (~15:1).
    { name: 'body-text', foreground: '#e6e6e6', background: '#121212', scale: 'normal' },
    // Secondary/muted body text (~8:1).
    { name: 'muted-text', foreground: '#a1a1aa', background: '#121212', scale: 'normal' },
    // Interactive control label / link on surface (~10:1).
    { name: 'interactive', foreground: '#93c5fd', background: '#121212', scale: 'normal' },
    // Text on a filled interactive control (~10:1).
    { name: 'on-interactive', foreground: '#121212', background: '#93c5fd', scale: 'normal' },
    // Large-scale headings (~16:1).
    { name: 'heading-large', foreground: '#f5f5f5', background: '#121212', scale: 'large' },
  ],
};

/** Color token pairs keyed by Theme_Mode. */
export const themeTokens: Record<ThemeMode, ThemeTokens> = {
  light: LIGHT_TOKENS,
  dark: DARK_TOKENS,
};

// ---------------------------------------------------------------------------
// WCAG contrast helper (pure)
// ---------------------------------------------------------------------------

/** An 8-bit-per-channel RGB color with components in 0..255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a `#rgb` or `#rrggbb` hex string into an {@link Rgb} triple.
 * Throws on malformed input so bad token data is caught early.
 */
export function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  let body = match[1]!;
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/**
 * Relative luminance of an sRGB color per the WCAG 2.x definition.
 * Returns a value in [0, 1].
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two colors (hex strings), a value in [1, 21].
 * The ratio is symmetric with respect to foreground/background.
 */
export function contrastRatio(colorA: string, colorB: string): number {
  const lumA = relativeLuminance(hexToRgb(colorA));
  const lumB = relativeLuminance(hexToRgb(colorB));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether a token pair meets its required WCAG contrast threshold.
 * Convenience predicate for verification code and property tests.
 */
export function meetsContrast(pair: ColorTokenPair): boolean {
  return contrastRatio(pair.foreground, pair.background) >= CONTRAST_THRESHOLDS[pair.scale];
}
