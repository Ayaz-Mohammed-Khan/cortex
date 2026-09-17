/**
 * Navigation island logic (task 16.1; Req 5.3, 7.2, 7.3).
 *
 * Two independent, keyboard-accessible behaviors, both wired with delegated
 * listeners on `document` so they survive Astro View Transitions without
 * rebinding:
 *
 *  1. **Category expand/collapse** — clicking a `[data-nav-toggle]` control
 *     flips its `aria-expanded` state and shows/hides the paired child list
 *     (`[data-nav-children]`). The server renders the initial open state along
 *     the active path (via `nav-state.ts`), so ancestors of the current Note
 *     start expanded (Req 5.4).
 *
 *  2. **Mobile drawer** — below 1024px the Navigation_Tree is a drawer that
 *     defaults closed (Req 7.2). A `[data-nav-drawer-toggle]` control toggles
 *     it open/closed (Req 7.3); a backdrop click or the Escape key closes it.
 *     At ≥1024px the sidebar is persistent (CSS), so drawer state is irrelevant.
 */

const DRAWER_OPEN_CLASS = 'translate-x-0';
const DRAWER_CLOSED_CLASS = '-translate-x-full';

function drawer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-nav-drawer]');
}

function backdrop(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-nav-backdrop]');
}

function isDrawerOpen(el: HTMLElement): boolean {
  return el.classList.contains(DRAWER_OPEN_CLASS);
}

function setDrawer(open: boolean): void {
  const el = drawer();
  const bd = backdrop();
  if (!el) return;
  el.classList.toggle(DRAWER_OPEN_CLASS, open);
  el.classList.toggle(DRAWER_CLOSED_CLASS, !open);
  el.setAttribute('aria-hidden', String(!open));
  if (bd) bd.classList.toggle('hidden', !open);
  document
    .querySelectorAll('[data-nav-drawer-toggle]')
    .forEach((btn) => btn.setAttribute('aria-expanded', String(open)));
}

/** Expand/collapse a single Category branch. */
function toggleBranch(control: Element): void {
  const expanded = control.getAttribute('aria-expanded') === 'true';
  control.setAttribute('aria-expanded', String(!expanded));
  const li = control.closest('li');
  const children = li?.querySelector<HTMLElement>(':scope > [data-nav-children]');
  if (children) children.hidden = expanded; // hidden when we just collapsed
}

function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target) return;

  const branch = target.closest('[data-nav-toggle]');
  if (branch) {
    event.preventDefault();
    toggleBranch(branch);
    return;
  }

  if (target.closest('[data-nav-drawer-toggle]')) {
    const el = drawer();
    setDrawer(el ? !isDrawerOpen(el) : true);
    return;
  }

  if (target.closest('[data-nav-backdrop]')) {
    setDrawer(false);
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const el = drawer();
  if (el && isDrawerOpen(el)) setDrawer(false);
}

document.addEventListener('click', onClick);
document.addEventListener('keydown', onKeydown);
// Close the drawer after a client-side navigation so it never lingers open.
document.addEventListener('astro:page-load', () => setDrawer(false));
