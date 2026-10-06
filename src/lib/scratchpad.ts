/**
 * Scratchpad store — the reader's own freeform notes, per note page.
 *
 * A thin facade over the `scratchpad` slice of the single versioned store in
 * `@/lib/store`, mirroring how `progress.ts` wraps the `progress` slice. Text
 * is keyed by a note's ROUTE, so each note has its own pad and it survives
 * navigation and reloads. Writing something you remember in your own words is
 * itself a small act of recall — that is the point of the feature.
 *
 * SSR-safe and change-notifying through the underlying store. Private to the
 * browser; nothing leaves the device.
 */

import { load, update, onStoreChange } from './store';

/** Normalize a route key the same way the progress store does. */
function normalizeRoute(route: string): string {
  let r = route.trim();
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** The scratchpad text for a route (empty string if none). */
export function getScratch(route: string): string {
  return load().scratchpad[normalizeRoute(route)] ?? '';
}

/**
 * Set the scratchpad text for a route. An empty / whitespace-only value clears
 * the entry (pruned on save), so an emptied pad does not linger in storage.
 */
export function setScratch(route: string, text: string): void {
  const key = normalizeRoute(route);
  update((doc) => {
    const next = { ...doc.scratchpad };
    if (text.trim() === '') delete next[key];
    else next[key] = text;
    return { ...doc, scratchpad: next };
  });
}

/** Does this route have any saved scratchpad text? */
export function hasScratch(route: string): boolean {
  return getScratch(route).trim() !== '';
}

/** Subscribe to store changes (e.g. a cross-tab edit). Returns unsubscribe. */
export function onScratchChange(listener: () => void): () => void {
  return onStoreChange(listener);
}
