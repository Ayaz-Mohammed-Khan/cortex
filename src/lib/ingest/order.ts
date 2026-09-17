/**
 * Sibling ordering for the Ingestion Domain (L1).
 *
 * Pure, framework-free logic: no dependency on Astro, the filesystem, or the
 * DOM. Derives a sort key from a ParsedName and compares two keys so that
 * siblings order "prefixed-first, then ascending order value, then
 * alphabetical".
 *
 * See design "Ordering" algorithm and Property 3 (Req 1.5, 1.6).
 */

import type { OrderingKey, ParsedName } from './types';

/**
 * Sentinel order assigned to unprefixed entries. It is larger than the maximum
 * valid Order_Prefix (999,999,999), so unprefixed entries all share the same
 * effective order and sort after every prefixed entry; the comparator then
 * falls through to the alphabetical tie-break.
 */
export const SENTINEL_LAST = Number.MAX_SAFE_INTEGER;

/**
 * Builds the sort key for a parsed name.
 *
 * Unprefixed entries (`parsed.order === null`) receive the sentinel order so
 * they sort after all prefixed entries; `hasPrefix` records whether a prefix
 * was present; `nameKey` is the lowercased Display_Name used for tie-breaking.
 */
export function orderingKey(parsed: ParsedName): OrderingKey {
  return {
    order: parsed.order ?? SENTINEL_LAST,
    hasPrefix: parsed.order != null,
    nameKey: parsed.displayName.toLowerCase(),
  };
}

/**
 * Compares two ordering keys to sort siblings.
 *
 * Ordering rules (design Property 3):
 * 1. Prefixed entries sort before unprefixed entries.
 * 2. Otherwise, ascending by numeric order value.
 * 3. Otherwise (equal order, or both unprefixed via the sentinel), ascending
 *    by case-insensitive Display_Name.
 *
 * @returns a negative number if `a` sorts before `b`, positive if after, 0 if equal.
 */
export function compareSiblings(a: OrderingKey, b: OrderingKey): number {
  if (a.hasPrefix !== b.hasPrefix) {
    // Prefixed entries first: the one with a prefix comes before the one without.
    return a.hasPrefix ? -1 : 1;
  }

  if (a.order !== b.order) {
    return a.order - b.order;
  }

  if (a.nameKey < b.nameKey) return -1;
  if (a.nameKey > b.nameKey) return 1;
  return 0;
}
