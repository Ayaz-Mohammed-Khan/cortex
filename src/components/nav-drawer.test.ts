import { describe, it, expect, beforeEach } from 'vitest';
// Importing the island binds its delegated document listeners once.
import './nav-drawer';

/**
 * Navigation drawer + branch toggle unit test (task 16.2; Req 5.3, 7.2, 7.3).
 *
 * The drawer markup starts closed (`-translate-x-full`, `aria-hidden`), matching
 * the below-1024px default (Req 7.2). Activating the toggle opens it and
 * activating again closes it (Req 7.3); Escape and backdrop clicks also close.
 * Category branches expand/collapse independently (Req 5.3, 5.4).
 */

function setupDom(): void {
  document.body.innerHTML = `
    <button data-nav-drawer-toggle aria-expanded="false"></button>
    <aside data-nav-drawer class="-translate-x-full" aria-hidden="true"></aside>
    <div data-nav-backdrop class="hidden"></div>
    <ul>
      <li>
        <div><button data-nav-toggle aria-expanded="true" aria-label="Toggle AI-ML"></button></div>
        <div data-nav-children></div>
      </li>
    </ul>`;
}

const drawer = () => document.querySelector('[data-nav-drawer]')!;
const backdrop = () => document.querySelector('[data-nav-backdrop]')!;
const drawerToggle = () => document.querySelector('[data-nav-drawer-toggle]')!;
const branchToggle = () => document.querySelector('[data-nav-toggle]')!;
const children = () => document.querySelector('[data-nav-children]') as HTMLElement;

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(setupDom);

describe('mobile drawer (task 16.2)', () => {
  it('defaults closed and opens on toggle activation', () => {
    expect(drawer().classList.contains('-translate-x-full')).toBe(true);
    click(drawerToggle());
    expect(drawer().classList.contains('translate-x-0')).toBe(true);
    expect(drawer().classList.contains('-translate-x-full')).toBe(false);
    expect(drawer().getAttribute('aria-hidden')).toBe('false');
    expect(backdrop().classList.contains('hidden')).toBe(false);
    expect(drawerToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles back to closed on a second activation', () => {
    click(drawerToggle());
    click(drawerToggle());
    expect(drawer().classList.contains('-translate-x-full')).toBe(true);
    expect(drawer().classList.contains('translate-x-0')).toBe(false);
    expect(drawer().getAttribute('aria-hidden')).toBe('true');
    expect(backdrop().classList.contains('hidden')).toBe(true);
  });

  it('closes on Escape and on backdrop click', () => {
    click(drawerToggle());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer().classList.contains('-translate-x-full')).toBe(true);

    click(drawerToggle());
    click(backdrop());
    expect(drawer().classList.contains('-translate-x-full')).toBe(true);
  });
});

describe('category branch expand/collapse (task 16.2)', () => {
  it('collapses an expanded branch and re-expands it', () => {
    expect(branchToggle().getAttribute('aria-expanded')).toBe('true');
    expect(children().hidden).toBe(false);

    click(branchToggle());
    expect(branchToggle().getAttribute('aria-expanded')).toBe('false');
    expect(children().hidden).toBe(true);

    click(branchToggle());
    expect(branchToggle().getAttribute('aria-expanded')).toBe('true');
    expect(children().hidden).toBe(false);
  });
});
