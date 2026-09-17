import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Importing the island binds its delegated click listener once.
import './toc';

/**
 * Table-of-contents interaction unit test (task 17.2; Req 4.3, 4.4).
 *
 * Selecting an entry whose heading exists scrolls to it (Req 4.3). Selecting an
 * entry whose heading is gone leaves the scroll position unchanged and shows a
 * polite "section unavailable" indication (Req 4.4).
 */

let scrollSpy: ReturnType<typeof vi.spyOn>;

function setupDom(): void {
  document.body.innerHTML = `
    <div data-toc-status class="hidden"></div>
    <nav>
      <a data-toc-link data-target="sec1" href="#sec1">Section 1</a>
      <a data-toc-link data-target="gone" href="#gone">Gone</a>
    </nav>
    <h2 id="sec1">Section 1</h2>`;
}

const status = () => document.querySelector('[data-toc-status]')!;
const link = (target: string) =>
  document.querySelector(`[data-toc-link][data-target="${target}"]`)!;
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(() => {
  setupDom();
  scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
});

afterEach(() => {
  scrollSpy.mockRestore();
});

describe('TOC interactions (task 17.2)', () => {
  it('scrolls to the heading when the target exists and marks it active', () => {
    click(link('sec1'));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(link('sec1').getAttribute('aria-current')).toBe('true');
    // No unavailable indication is shown.
    expect(status().classList.contains('hidden')).toBe(true);
    expect(status().textContent).toBe('');
  });

  it('leaves scroll unchanged and shows an indication when the target is missing', () => {
    click(link('gone'));
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(status().classList.contains('hidden')).toBe(false);
    expect(status().textContent?.toLowerCase()).toContain('no longer available');
  });
});
