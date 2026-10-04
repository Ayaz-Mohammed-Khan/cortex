/**
 * Navigation completion ticks.
 *
 * Reveals a green tick beside every note in the sidebar whose route is marked
 * complete in the shared {@link module:lib/progress progress store}. The tick
 * markup is rendered hidden by `NavTree.astro`; this island shows or hides each
 * one from the store, and stays in sync as the reader completes notes (by
 * passing a quiz, marking done on the note page, or on the roadmap) while the
 * sidebar is on screen.
 *
 * Island pattern: a single store subscription, re-synced on `astro:page-load`
 * so it survives View Transitions. Pure read side; it never writes progress.
 */
import { isDone, onChange } from '@/lib/progress';

/** Reflect the store onto every note row's tick in the nav tree. */
function sync(): void {
  const links = document.querySelectorAll<HTMLElement>('[data-nav-route]');
  for (const link of links) {
    const route = link.dataset.navRoute;
    const tick = link.querySelector<SVGElement>('[data-nav-done]');
    if (!route || !tick) continue;
    tick.classList.toggle('nav-done-hidden', !isDone(route));
  }
}

let unsubscribe: (() => void) | null = null;

function bind(): void {
  sync();
  unsubscribe?.();
  unsubscribe = onChange(sync);
}

document.addEventListener('astro:page-load', bind);
bind();

export {};
