// Global Vitest setup. Runs once before the test files in each worker.
//
// The jsdom environment is configured in vitest.config.ts. jsdom does not
// implement a few browser APIs that the presentation-layer islands touch, so we
// provide minimal, inert polyfills here. They are no-ops sufficient for unit
// tests to drive and observe the islands' DOM behavior without a real browser.

// `IntersectionObserver` powers the TOC scroll-spy (`toc.ts`). jsdom has no
// implementation, so provide a stub that records nothing.
if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  // @ts-expect-error assign stub onto the global for jsdom
  globalThis.IntersectionObserver = IntersectionObserverStub;
}

// `scrollIntoView` is used by the TOC island to jump to a heading. jsdom leaves
// it undefined; define a no-op so it exists (tests spy on it to assert calls).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}

export {};
