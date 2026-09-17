import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { resolveTheme } from './theme';
import type { ThemeMode, StoredTheme, OsPreference } from './theme';

// Feature: portfolio-website, Property 18: For any combination of stored Theme_Mode (present or absent) and OS color-scheme preference (light, dark, or undeterminable), the resolved initial Theme_Mode equals the stored value when present; otherwise it equals the OS preference; otherwise it is light. For any mode a Reader selects, persisting then re-resolving returns that same selected mode.

/**
 * Property 18: Theme resolution precedence and persistence round-trip.
 *
 * Validates: Requirements 8.1, 8.2, 8.4, 8.5, 8.6
 *
 * Part A (resolution precedence): For any stored preference (a Theme_Mode, or
 * absent as `null`/`undefined`) and any OS preference (a Theme_Mode, or
 * undeterminable as `null`/`undefined`), `resolveTheme`:
 *   - returns the stored value when it is a valid Theme_Mode (Req 8.5);
 *   - otherwise returns the OS preference when it is determinable (Req 8.1, 8.6);
 *   - otherwise returns `'light'` (Req 8.2, 8.6).
 *
 * Part B (persistence round-trip): For any mode a Reader selects, the mode is
 * persisted as the stored value; re-resolving with that stored value returns
 * the same selected mode regardless of the OS preference (Req 8.4, 8.5).
 */

const RUNS = { numRuns: 100 };

/** A valid Theme_Mode. */
const themeModeArb: fc.Arbitrary<ThemeMode> = fc.constantFrom<ThemeMode>('light', 'dark');

/** A stored preference: a Theme_Mode, or absent (`null`/`undefined`). */
const storedArb: fc.Arbitrary<StoredTheme> = fc.constantFrom<StoredTheme>(
  'light',
  'dark',
  null,
  undefined,
);

/** An OS preference: a Theme_Mode, or undeterminable (`null`/`undefined`). */
const osPrefArb: fc.Arbitrary<OsPreference> = fc.constantFrom<OsPreference>(
  'light',
  'dark',
  null,
  undefined,
);

function isMode(value: StoredTheme | OsPreference): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

describe('theme resolution precedence and persistence (Property 18)', () => {
  it('resolves stored value first, then OS preference, then light', () => {
    fc.assert(
      fc.property(storedArb, osPrefArb, (stored, osPref) => {
        const resolved = resolveTheme(stored, osPref);

        // The result is always a valid Theme_Mode.
        expect(resolved === 'light' || resolved === 'dark').toBe(true);

        if (isMode(stored)) {
          // Precedence 1: stored value wins (Req 8.5).
          expect(resolved).toBe(stored);
        } else if (isMode(osPref)) {
          // Precedence 2: OS preference when determinable (Req 8.1, 8.6).
          expect(resolved).toBe(osPref);
        } else {
          // Precedence 3: default to light (Req 8.2, 8.6).
          expect(resolved).toBe('light');
        }
      }),
      RUNS,
    );
  });

  it('re-resolves a selected mode to the same mode after persistence, for any OS preference', () => {
    fc.assert(
      fc.property(themeModeArb, osPrefArb, (selected, osPref) => {
        // A Reader selects `selected`; the System persists it as the stored value (Req 8.4).
        const stored: StoredTheme = selected;
        // On return, resolving reads the persisted value and restores it (Req 8.5),
        // independent of the OS preference.
        expect(resolveTheme(stored, osPref)).toBe(selected);
      }),
      RUNS,
    );
  });
});
