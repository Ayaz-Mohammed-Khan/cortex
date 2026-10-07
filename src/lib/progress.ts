/**
 * Progress store — which notes the reader has marked complete.
 *
 * As of v2 this is a THIN FACADE over the single versioned store in
 * `@/lib/store`: the `progress` slice of that document is the source of truth.
 * The public API here is unchanged, so every surface that already imports it —
 * the roadmap graph, the topic modal, the note "Mark as complete" button, the
 * sidebar ticks, and the progress meter — keeps working untouched.
 *
 * Completion is keyed by a note's ROUTE (e.g. `/notes/oop-advanced-python/
 * classes-objects`), the same string the roadmap resolves a node to and the
 * note page is served at, so a topic marked in one place lights up everywhere.
 *
 * Everything is SSR-safe and change-notifying by virtue of the underlying
 * store; state never leaves the browser.
 */

import { load, update, onStoreChange } from './store';

/** Normalize a route so trailing-slash / casing differences never split a key. */
function normalizeRoute(route: string): string {
  let r = route.trim();
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** The current completion set (a fresh Set each call; safe to mutate locally). */
function readSet(): Set<string> {
  return new Set(load().progress);
}

/** Is this note route marked complete? */
export function isDone(route: string): boolean {
  return readSet().has(normalizeRoute(route));
}

/** Mark a route complete (idempotent). */
export function markDone(route: string): void {
  const key = normalizeRoute(route);
  update((doc) => {
    if (doc.progress.includes(key)) return doc;
    // Stamp the first-completion time once. The early return above guarantees
    // this branch runs only when the route is new, so an existing timestamp is
    // never overwritten — the anchor for weekly recall cycles stays stable.
    return {
      ...doc,
      progress: [...doc.progress, key],
      completedAt: { ...doc.completedAt, [key]: Date.now() },
    };
  });
}

/** Clear a route's completion (idempotent). */
export function markUndone(route: string): void {
  const key = normalizeRoute(route);
  update((doc) => ({ ...doc, progress: doc.progress.filter((r) => r !== key) }));
}

/** Flip a route's completion; returns the new state (`true` = now done). */
export function toggleDone(route: string): boolean {
  const key = normalizeRoute(route);
  const next = !readSet().has(key);
  update((doc) => {
    const has = doc.progress.includes(key);
    if (next && !has) return { ...doc, progress: [...doc.progress, key] };
    if (!next && has) return { ...doc, progress: doc.progress.filter((r) => r !== key) };
    return doc;
  });
  return next;
}

/** How many routes are marked complete. */
export function doneCount(): number {
  return readSet().size;
}

/** The full set of completed routes (a copy; mutating it does nothing). */
export function doneRoutes(): Set<string> {
  return readSet();
}

/** Remove all completion state (leaves other store slices intact). */
export function resetProgress(): void {
  update((doc) => ({ ...doc, progress: [] }));
}

/**
 * Subscribe to changes from any surface, in this tab or another one. Returns an
 * unsubscribe function. Backed by the shared store's change notifications.
 */
export function onChange(listener: () => void): () => void {
  return onStoreChange(listener);
}
