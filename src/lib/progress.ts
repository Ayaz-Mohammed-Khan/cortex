/**
 * Progress store — which notes the reader has marked complete.
 *
 * A tiny, dependency-free, client-side store backed by a single `localStorage`
 * key. It is the ONE source of truth that every progress surface reads and
 * writes, so they stay in sync within a page without a backend or an account:
 *
 *   - the roadmap graph (a done cell gets the corner check badge),
 *   - the topic modal ("Mark done" ↔ "Completed"),
 *   - the note page ("Mark as complete" checkbox),
 *   - the progress meter at the top of the roadmap.
 *
 * Completion is keyed by a note's ROUTE (e.g. `/notes/oop-advanced-python/
 * classes-objects`), the same string the roadmap resolves a node to and the
 * note page is served at, so a topic marked in one place lights up everywhere.
 *
 * The store is SSR-safe (every `localStorage`/`window` access is guarded) so it
 * can be imported from any island without blowing up during the build, and it
 * publishes changes so open surfaces update live. State never leaves the
 * browser.
 */

/** The single localStorage key holding the completion set. */
const STORAGE_KEY = 'cortex:progress';

/** DOM event dispatched on `window` whenever the set changes (same tab). */
const CHANGE_EVENT = 'cortex:progress-change';

/** Guard: are we in a browser with a usable `localStorage`? */
function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    // Accessing localStorage can throw in some sandboxed/blocked contexts.
    return false;
  }
}

/** Read the raw completion set from storage (empty on any failure). */
function read(): Set<string> {
  if (!hasStorage()) return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    // Stored as an array of routes. Tolerate anything else by starting empty.
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((r): r is string => typeof r === 'string'));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/** Persist the set and notify this tab's listeners. */
function write(set: Set<string>): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Quota or private mode: the change just does not outlive the session.
  }
  // Notify same-tab surfaces. The native `storage` event only fires in OTHER
  // tabs, so we dispatch our own for the current one; `onChange` listens to both.
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // Older environments without CustomEvent: listeners simply won't fire.
  }
}

/** Normalize a route so trailing-slash / casing differences never split a key. */
function normalizeRoute(route: string): string {
  let r = route.trim();
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** Is this note route marked complete? */
export function isDone(route: string): boolean {
  return read().has(normalizeRoute(route));
}

/** Mark a route complete (idempotent). */
export function markDone(route: string): void {
  const set = read();
  set.add(normalizeRoute(route));
  write(set);
}

/** Clear a route's completion (idempotent). */
export function markUndone(route: string): void {
  const set = read();
  set.delete(normalizeRoute(route));
  write(set);
}

/** Flip a route's completion; returns the new state (`true` = now done). */
export function toggleDone(route: string): boolean {
  const key = normalizeRoute(route);
  const set = read();
  const next = !set.has(key);
  if (next) set.add(key);
  else set.delete(key);
  write(set);
  return next;
}

/** How many routes are marked complete. */
export function doneCount(): number {
  return read().size;
}

/** The full set of completed routes (a copy; mutating it does nothing). */
export function doneRoutes(): Set<string> {
  return read();
}

/** Remove all completion state. */
export function resetProgress(): void {
  write(new Set());
}

/**
 * Subscribe to changes from any surface, in this tab or another one.
 *
 * Fires on our same-tab {@link CHANGE_EVENT} and on the browser's cross-tab
 * `storage` event (filtered to our key). Returns an unsubscribe function.
 */
export function onChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const sameTab = (): void => listener();
  const crossTab = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, sameTab);
  window.addEventListener('storage', crossTab);
  return () => {
    window.removeEventListener(CHANGE_EVENT, sameTab);
    window.removeEventListener('storage', crossTab);
  };
}
