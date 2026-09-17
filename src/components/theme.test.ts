import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveTheme } from '@/lib/theme';
import type { OsPreference, StoredTheme } from '@/lib/theme';
// Importing the island binds its delegated document listeners once.
import './theme';

/** A minimal Map-backed Storage; jsdom's localStorage is not reliable here. */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/**
 * Stub `window.matchMedia` to model the OS color-scheme preference the no-flash
 * script consults. Passing `null` models `matchMedia` being unavailable (the
 * preference is undeterminable), matching jsdom's default.
 */
function stubMatchMedia(prefersDark: boolean | null): void {
  if (prefersDark === null) {
    vi.stubGlobal('matchMedia', undefined);
    return;
  }
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/**
 * Read the OS preference exactly as the inline no-flash script does: consult
 * `window.matchMedia('(prefers-color-scheme: dark)')`, treating an unavailable
 * `matchMedia` as undeterminable (`null`).
 */
function readOsPreference(): OsPreference {
  if (typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Faithful reproduction of the inline no-flash `<head>` script in
 * `Layout.astro`: read the stored preference from `localStorage.theme`, fall
 * back to the OS preference, else light — then apply the resolved mode to
 * `document.documentElement.dataset.theme` before paint. The precedence rule is
 * delegated to the shared, exported `resolveTheme` the script mirrors.
 */
function applyNoFlashTheme(): void {
  let stored: StoredTheme = null;
  try {
    const raw = localStorage.getItem('theme');
    stored = raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    stored = null;
  }
  document.documentElement.dataset.theme = resolveTheme(stored, readOsPreference());
}

/**
 * Theme toggle unit test (task 15.3; Req 8.1, 8.2, 8.3, 8.4, 8.6).
 *
 * Exercises the client island: activating the control flips `data-theme`,
 * persists the choice, and reflects it on the control — all synchronously
 * (no reload). A companion block reproduces the inline no-flash script and
 * asserts it applies the resolved `data-theme` before paint across every
 * stored/OS-preference combination.
 */

function clickToggle(): void {
  const btn = document.querySelector('[data-theme-toggle]');
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage());
  document.documentElement.dataset.theme = 'light';
  document.body.innerHTML =
    '<button data-theme-toggle aria-pressed="false" aria-label="Switch to dark theme"></button>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme toggle island (task 15.3)', () => {
  it('flips data-theme light -> dark -> light on activation', () => {
    clickToggle();
    expect(document.documentElement.dataset.theme).toBe('dark');
    clickToggle();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('persists the selected theme so it survives across sessions', () => {
    clickToggle();
    expect(localStorage.getItem('theme')).toBe('dark');
    clickToggle();
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('reflects the active theme on the control via aria-pressed', () => {
    const btn = document.querySelector('[data-theme-toggle]')!;
    clickToggle();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Switch to light theme');
    clickToggle();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark theme');
  });
});

/**
 * No-flash script (task 15.3; Req 8.1, 8.2, 8.6).
 *
 * Drives the reproduced inline-script logic against stubbed `localStorage` and
 * `window.matchMedia`, then asserts the resolved mode is applied to
 * `document.documentElement.dataset.theme` before paint for every combination
 * of stored preference and OS preference.
 */
describe('no-flash script applies the resolved theme before paint (task 15.3)', () => {
  function resolvedDataTheme(): string | undefined {
    // Force a non-resolved starting value so the assertion proves the script set it.
    delete document.documentElement.dataset.theme;
    applyNoFlashTheme();
    return document.documentElement.dataset.theme;
  }

  it('applies the stored preference when present (stored wins over OS)', () => {
    localStorage.setItem('theme', 'dark');
    stubMatchMedia(false); // OS prefers light, but stored dark must win.
    expect(resolvedDataTheme()).toBe('dark');

    localStorage.setItem('theme', 'light');
    stubMatchMedia(true); // OS prefers dark, but stored light must win.
    expect(resolvedDataTheme()).toBe('light');
  });

  it('falls back to the OS preference when nothing is stored', () => {
    stubMatchMedia(true);
    expect(resolvedDataTheme()).toBe('dark');

    stubMatchMedia(false);
    expect(resolvedDataTheme()).toBe('light');
  });

  it('defaults to light when nothing is stored and the OS preference is undeterminable', () => {
    stubMatchMedia(null); // matchMedia unavailable.
    expect(resolvedDataTheme()).toBe('light');
  });

  it('ignores an invalid stored value and uses the OS preference', () => {
    localStorage.setItem('theme', 'purple');
    stubMatchMedia(true);
    expect(resolvedDataTheme()).toBe('dark');
  });

  it('mirrors the shared resolveTheme precedence: stored, else OS, else light', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark'); // stored wins
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme(null, 'dark')).toBe('dark'); // else OS
    expect(resolveTheme(undefined, undefined)).toBe('light'); // else light
  });
});
