import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Importing the islands binds their delegated document listeners once, exactly
// as they run on the live site. The behavioral tests below drive these *real*
// handlers via keyboard-initiated events rather than re-implementing them.
import './nav-drawer';
import './theme';
import './toc';
import './search';

/**
 * Keyboard-navigation & focus tests (task 20.2; Req 7.7, 7.8).
 *
 * Req 7.7 — every interactive control is reachable and operable by keyboard,
 *           and keyboard focus is never trapped.
 * Req 7.8 — a focused control shows a visible focus indicator.
 *
 * Approach (see task 20.2 constraints): this runs entirely in the Vitest +
 * jsdom harness — no `astro build`, no dev/preview server, no real browser.
 * Two complementary techniques are used:
 *
 *  1. **Structural / focus-indicator assertions** read the *real* component
 *     source files. This is where Req 7.8 is verified: jsdom does not render or
 *     compute styles, so a pixel-level outline cannot be observed. Instead we
 *     assert the *mechanism* — controls are native, focusable elements and
 *     never suppress the native focus outline without substituting a visible
 *     focus ring, and the global stylesheet installs no blanket outline reset.
 *
 *  2. **Behavioral assertions** build representative interactive markup (the
 *     same semantic elements and `data-*` hooks the components render) and
 *     drive the *real* island handlers (`nav-drawer`, `theme`, `toc`, `search`)
 *     with keyboard-initiated events to prove reachability, operability, and
 *     the absence of a focus trap.
 *
 * jsdom limitations that shape the tests:
 *  - jsdom does not perform the user-agent's "activation behavior" (pressing
 *    Enter/Space on a focused native control synthesizes a `click`). We model
 *    that step in {@link activateByKeyboard}, and *only* for genuine semantic
 *    controls, so a non-semantic element would fail to activate — keeping the
 *    assertions honest.
 *  - jsdom 29 does not implement `<dialog>.showModal()`/`.close()` (it does
 *    reflect `open`); we install a minimal local polyfill, mirroring the
 *    IntersectionObserver/scrollIntoView stubs already in `tests/setup.ts`.
 */

// --- Real component sources (authoritative for structure + focus styles) ----

// Resolve from the project root (Vitest's cwd) rather than import.meta.url,
// which the Vite/jsdom transform rewrites to a root-relative path.
const COMPONENTS_DIR = resolve(process.cwd(), 'src/components');
const readComponent = (name: string): string =>
  readFileSync(resolve(COMPONENTS_DIR, name), 'utf8');

const SOURCES: Record<string, string> = {
  layout: readComponent('Layout.astro'),
  themeToggle: readComponent('ThemeToggle.astro'),
  navTree: readComponent('NavTree.astro'),
  toc: readComponent('TableOfContents.astro'),
  search: readComponent('Search.astro'),
  sectionNav: readComponent('SectionNav.astro'),
  breadcrumbs: readComponent('Breadcrumbs.astro'),
};

const globalCss = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');

/** Extract the quoted string literals (", ', `) authored in a component. */
function quotedLiterals(src: string): string[] {
  const matches = src.match(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

/** Class literals that turn the native focus outline off (`*:outline-none`). */
function literalsSuppressingOutline(src: string): string[] {
  return quotedLiterals(src).filter((l) => /(?:focus(?:-visible)?:)?outline-none/.test(l));
}

// --- Behavioral helpers ------------------------------------------------------

/** A control is reachable when it is neither disabled nor removed from tab order. */
function isFocusable(el: Element): boolean {
  if (el.hasAttribute('disabled')) return false;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) return false;
  return true;
}

/** True for elements the user agent natively activates from the keyboard. */
function isActivatableControl(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'BUTTON') return true;
  if (tag === 'A' && el.hasAttribute('href')) return true;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return false;
}

/**
 * Activate a focused control from the keyboard and return whether the user
 * agent would have activated it.
 *
 * Step 1 dispatches the real `keydown` a keyboard user produces. Step 2 models
 * the user-agent activation jsdom omits: a focused native control fires a
 * `click` on Enter (buttons/links) or Space (buttons). The synthetic click is
 * emitted ONLY for genuine semantic controls, so pressing a key on a
 * non-semantic element does nothing here — which is exactly what a keyboard
 * user would experience, and makes these assertions meaningful.
 */
function activateByKeyboard(el: Element, key: 'Enter' | ' '): boolean {
  const keydown = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  const notConsumed = el.dispatchEvent(keydown);
  if (!notConsumed) return false; // a handler already consumed the key

  const tag = el.tagName;
  const isButton =
    tag === 'BUTTON' ||
    (tag === 'INPUT' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type));
  const isLink = tag === 'A' && el.hasAttribute('href');
  const willActivate = (isButton && (key === 'Enter' || key === ' ')) || (isLink && key === 'Enter');
  if (willActivate) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  return willActivate;
}

/** A minimal Map-backed Storage; theme.ts persists here without touching jsdom. */
function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Test setup: element not found for "${selector}"`);
  return el;
};

/**
 * Representative page mirroring the real components: the header controls (skip
 * link, drawer toggle, home + section links, search + theme buttons), the
 * off-canvas navigation drawer (branch toggle + tree links), the in-page TOC,
 * and the search dialog. Semantic elements, `data-*` hooks, and focus classes
 * match what the components render, so the real islands drive it unchanged.
 */
function buildPage(): void {
  document.body.innerHTML = `
    <a href="#main-content" data-skip-link
       class="sr-only focus:not-sr-only focus:ring-2 focus:ring-blue-600">Skip to content</a>

    <header>
      <button type="button" data-nav-drawer-toggle aria-expanded="false" aria-controls="nav-drawer"
              aria-label="Toggle navigation"
              class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"></button>
      <a href="/notes" data-home-link
         class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Portfolio</a>
      <nav aria-label="Sections">
        <a href="/notes" data-section-link aria-current="page"
           class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Notes</a>
        <a href="/projects" data-section-link
           class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Projects</a>
      </nav>
      <button type="button" data-search-open aria-label="Search notes"
              class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"></button>
      <button type="button" data-theme-toggle aria-pressed="false" aria-label="Switch to dark theme"
              class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"></button>
    </header>

    <aside id="nav-drawer" data-nav-drawer aria-hidden="true" class="-translate-x-full">
      <ul role="tree">
        <li role="treeitem" aria-expanded="true">
          <div>
            <button type="button" data-nav-toggle aria-expanded="true" aria-label="Toggle AI-ML"
                    class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"></button>
            <a href="/notes/ai-ml" data-tree-link
               class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">AI-ML</a>
          </div>
          <div data-nav-children>
            <ul role="group">
              <li role="treeitem">
                <a href="/notes/ai-ml/intro" data-tree-link
                   class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Intro</a>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </aside>
    <div data-nav-backdrop aria-hidden="true" class="hidden"></div>

    <main id="main-content">
      <nav aria-label="Table of contents">
        <div data-toc-status role="status" aria-live="polite" class="hidden"></div>
        <ul>
          <li><a href="#sec1" data-toc-link data-target="sec1"
                 class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Section 1</a></li>
          <li><a href="#gone" data-toc-link data-target="gone"
                 class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Gone</a></li>
        </ul>
      </nav>
      <h2 id="sec1">Section 1</h2>
    </main>

    <dialog data-search-dialog aria-label="Search notes">
      <input type="search" data-search-input aria-label="Search query"
             class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" />
      <button type="button" data-search-close aria-label="Close search"
              class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Esc</button>
      <p data-search-status role="status" aria-live="polite"></p>
      <ul data-search-results></ul>
    </dialog>`;
}

// All the controls a keyboard user must be able to reach, by stable hook.
const CONTROL_SELECTORS = [
  '[data-skip-link]',
  '[data-nav-drawer-toggle]',
  '[data-home-link]',
  '[data-section-link]',
  '[data-search-open]',
  '[data-theme-toggle]',
  '[data-nav-toggle]',
  '[data-tree-link]',
  '[data-toc-link][data-target="sec1"]',
  '[data-search-input]',
  '[data-search-close]',
];

let scrollSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  // jsdom 29 lacks <dialog> methods (it reflects `open`). Polyfill the minimum
  // the search island toggles, matching the stub approach in tests/setup.ts.
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof proto.close !== 'function') {
    proto.close = function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
  }
  // Provide an inert Pagefind so the search island never attempts to load the
  // real (build-only) runtime when the dialog opens/warms.
  (globalThis as unknown as { pagefind: unknown }).pagefind = {
    search: async () => ({ results: [] }),
  };
});

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage());
  document.documentElement.dataset.theme = 'light';
  buildPage();
  scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
});

afterEach(() => {
  scrollSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe('interactive controls are reachable, keyboard-operable semantic elements (Req 7.7)', () => {
  it('renders the theme, nav-drawer, branch, and search toggles as native <button>s', () => {
    expect(SOURCES.themeToggle).toMatch(/<button[\s\S]*?data-theme-toggle/);
    expect(SOURCES.layout).toMatch(/<button[\s\S]*?data-nav-drawer-toggle/);
    expect(SOURCES.navTree).toMatch(/<button[\s\S]*?data-nav-toggle/);
    expect(SOURCES.search).toMatch(/<button[\s\S]*?data-search-open/);
    expect(SOURCES.search).toMatch(/<button[\s\S]*?data-search-close/);
  });

  it('renders a native <input> for the query and <a href> for every navigation entry', () => {
    expect(SOURCES.search).toMatch(/<input[\s\S]*?data-search-input/);
    expect(SOURCES.navTree).toMatch(/<a[\s\S]*?href=\{node\.route\}/);
    expect(SOURCES.toc).toMatch(/<a[\s\S]*?data-toc-link/);
    expect(SOURCES.sectionNav).toMatch(/<a[\s\S]*?href=/);
    expect(SOURCES.breadcrumbs).toMatch(/<a[\s\S]*?href=\{ancestor\.route\}/);
  });

  it('never removes a control from the tab order and never statically disables one', () => {
    for (const [name, src] of Object.entries(SOURCES)) {
      expect(src, `${name} pulls a control out of the tab order`).not.toMatch(/tabindex=["']?-1/);
      expect(src, `${name} statically disables a control`).not.toMatch(/\sdisabled[\s=>/]/);
    }
  });

  it('places keyboard focus on every interactive control (activeElement follows focus)', () => {
    // Open the dialog so its controls are exercised in their reachable state.
    activateByKeyboard($('[data-search-open]'), 'Enter');

    for (const selector of CONTROL_SELECTORS) {
      const el = $<HTMLElement>(selector);
      expect(isActivatableControl(el), `${selector} is not a semantic control`).toBe(true);
      expect(isFocusable(el), `${selector} is not reachable`).toBe(true);
      el.focus();
      expect(document.activeElement, `${selector} could not receive focus`).toBe(el);
    }
  });

  it('flips the theme when the toggle is activated with Enter or Space', () => {
    const toggle = $('[data-theme-toggle]');
    toggle.focus();
    expect(activateByKeyboard(toggle, 'Enter')).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');

    // Space activates a button too.
    activateByKeyboard(toggle, ' ');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('opens and closes the nav drawer via keyboard activation of the toggle (Req 7.3)', () => {
    const toggle = $('[data-nav-drawer-toggle]');
    const drawer = $('[data-nav-drawer]');

    activateByKeyboard(toggle, 'Enter');
    expect(drawer.classList.contains('translate-x-0')).toBe(true);
    expect(drawer.getAttribute('aria-hidden')).toBe('false');

    activateByKeyboard(toggle, 'Enter');
    expect(drawer.classList.contains('-translate-x-full')).toBe(true);
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
  });

  it('expands and collapses a navigation branch via keyboard activation', () => {
    const branch = $('[data-nav-toggle]');
    const children = $<HTMLElement>('[data-nav-children]');
    expect(branch.getAttribute('aria-expanded')).toBe('true');

    activateByKeyboard(branch, ' ');
    expect(branch.getAttribute('aria-expanded')).toBe('false');
    expect(children.hidden).toBe(true);

    activateByKeyboard(branch, 'Enter');
    expect(branch.getAttribute('aria-expanded')).toBe('true');
    expect(children.hidden).toBe(false);
  });

  it('activates a table-of-contents entry with Enter and scrolls to its heading', () => {
    const link = $('[data-toc-link][data-target="sec1"]');
    link.focus();
    expect(activateByKeyboard(link, 'Enter')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(link.getAttribute('aria-current')).toBe('true');
  });

  it('opens search with Enter and moves focus into the query input', () => {
    const open = $('[data-search-open]');
    const dialog = $<HTMLDialogElement>('[data-search-dialog]');
    open.focus();

    activateByKeyboard(open, 'Enter');
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe($('[data-search-input]'));
  });

  it('exposes navigation links as genuine keyboard-operable controls', () => {
    for (const selector of ['[data-skip-link]', '[data-home-link]', '[data-section-link]', '[data-tree-link]']) {
      expect(isActivatableControl($(selector)), `${selector} is not keyboard-activatable`).toBe(true);
    }
  });
});

describe('keyboard focus is never trapped (Req 7.7)', () => {
  it('closes the nav drawer with the Escape key (keyboard exit from the overlay)', () => {
    const toggle = $('[data-nav-drawer-toggle]');
    const drawer = $('[data-nav-drawer]');

    activateByKeyboard(toggle, 'Enter');
    expect(drawer.classList.contains('translate-x-0')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer.classList.contains('-translate-x-full')).toBe(true);
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
  });

  it('never intercepts Tab / Shift+Tab (no island installs a focus trap)', () => {
    // A focus trap works by preventing the default Tab behavior to cycle focus.
    // None of the islands touch Tab, so default tab movement is always allowed
    // and focus can leave any control. Verify Tab is never canceled.
    activateByKeyboard($('[data-nav-drawer-toggle]'), 'Enter'); // open the drawer
    activateByKeyboard($('[data-search-open]'), 'Enter'); // open the search dialog

    for (const selector of CONTROL_SELECTORS) {
      const el = $<HTMLElement>(selector);
      el.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      expect(el.dispatchEvent(tab), `${selector} blocked Tab`).toBe(true);
      expect(el.dispatchEvent(shiftTab), `${selector} blocked Shift+Tab`).toBe(true);
    }
  });

  it('lets focus move from inside the open drawer to a control outside it', () => {
    activateByKeyboard($('[data-nav-drawer-toggle]'), 'Enter'); // open drawer

    const insideDrawer = $('[data-tree-link]');
    insideDrawer.focus();
    expect(document.activeElement).toBe(insideDrawer);

    // Nothing re-captures focus: it moves freely to a header control.
    const outsideDrawer = $('[data-theme-toggle]');
    outsideDrawer.focus();
    expect(document.activeElement).toBe(outsideDrawer);
  });

  it('provides a keyboard-operable exit from the search dialog via its close button', () => {
    // The search dialog is a native <dialog>; the browser also closes it with
    // Escape and restores focus (a user-agent behavior jsdom does not model).
    // Here we verify the explicit, always-available keyboard exit control.
    const dialog = $<HTMLDialogElement>('[data-search-dialog]');
    activateByKeyboard($('[data-search-open]'), 'Enter');
    expect(dialog.open).toBe(true);

    const close = $('[data-search-close]');
    close.focus();
    activateByKeyboard(close, 'Enter');
    expect(dialog.open).toBe(false);
  });
});

describe('focused controls expose a visible focus indicator (Req 7.8)', () => {
  // jsdom does not render or compute styles, so a pixel-level focus outline
  // cannot be observed. We instead assert the *mechanism* the requirement
  // depends on: the components rely on `:focus-visible` focus styles and never
  // strip the native outline without providing a visible ring, and the global
  // stylesheet installs no blanket outline reset. The ring's contrast ratio is
  // covered by the theme-contrast property test and the axe-core pass (20.1).
  it('never suppresses the focus outline without substituting a focus ring', () => {
    for (const [name, src] of Object.entries(SOURCES)) {
      for (const literal of literalsSuppressingOutline(src)) {
        expect(literal, `${name}: "${literal}" turns off the outline but defines no ring`).toMatch(/ring-/);
      }
    }
  });

  it('defines a real focus-ring utility on the interactive components', () => {
    // Every component that owns interactive controls provides a focus ring.
    for (const name of ['layout', 'themeToggle', 'navTree', 'toc', 'search', 'sectionNav', 'breadcrumbs']) {
      expect(SOURCES[name], `${name} defines no focus ring`).toMatch(/focus(?:-visible)?:ring-2/);
    }
  });

  it('keeps the skip link visible on focus (focus:not-sr-only + ring)', () => {
    // The skip link is the first keyboard stop; it must surface on focus.
    expect(SOURCES.layout).toMatch(/focus:not-sr-only/);
    expect(SOURCES.layout).toMatch(/focus:ring-2/);
  });

  it('installs no blanket outline reset in the global stylesheet', () => {
    expect(globalCss).not.toMatch(/outline\s*:\s*(?:none|0)\b/i);
  });
});
