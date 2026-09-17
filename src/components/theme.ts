/**
 * Client-side theme-toggle island logic (task 15.2).
 *
 * Loaded by {@link file://./ThemeToggle.astro} via a bundled `<script>`. It
 * flips the active {@link ThemeMode} between light and dark, applies it by
 * setting `document.documentElement.dataset.theme` (which drives every
 * `dark:` utility — see the `@custom-variant dark` rule in
 * `src/styles/global.css`), and persists the choice to `localStorage` so it is
 * restored on the next visit (Req 8.3, 8.4).
 *
 * The no-flash inline script in `Layout.astro` sets the initial `data-theme`
 * before paint; this module only handles user toggles and keeps the control's
 * pressed state in sync.
 *
 * Interaction model: a single delegated `click` listener is attached to
 * `document`. Because the document survives Astro View Transitions, the handler
 * keeps working after client-side navigation without rebinding — avoiding
 * double-binding bugs. Applying a toggle is synchronous, so the new scheme takes
 * effect well within the 1-second budget and without a page reload (Req 8.3).
 */

import type { ThemeMode } from '@/lib/theme';

/**
 * `localStorage` key holding the persisted {@link ThemeMode}. Kept in sync with
 * the literal used by the inline no-flash script in `Layout.astro`.
 */
const STORAGE_KEY = 'theme';

/** Read the currently applied theme from the document element. */
function currentTheme(): ThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Reflect the active theme onto every toggle control's pressed state + label. */
function syncControls(theme: ThemeMode): void {
  const controls = document.querySelectorAll<HTMLElement>('[data-theme-toggle]');
  controls.forEach((control) => {
    const isDark = theme === 'dark';
    control.setAttribute('aria-pressed', String(isDark));
    // Announce the action the control will perform when activated.
    const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    control.setAttribute('aria-label', label);
    control.setAttribute('title', label);
    control.dataset.themeState = theme;
  });
}

/** Apply, persist, and reflect a theme selection. */
function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the in-page toggle still works.
  }
  syncControls(theme);
}

/** Delegated click handler: toggle when a theme control (or its child) is clicked. */
function onDocumentClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  const control = target?.closest('[data-theme-toggle]');
  if (!control) return;
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

// Bind once. The document persists across View Transitions, so this handler and
// the page-load sync keep functioning after client-side navigation.
document.addEventListener('click', onDocumentClick);
document.addEventListener('astro:page-load', () => syncControls(currentTheme()));

// Initial sync for the first paint of this island.
syncControls(currentTheme());
