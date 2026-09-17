/**
 * Order_Prefix parsing for the Ingestion Domain (L1).
 *
 * Pure, framework-free logic that extracts an optional leading numeric
 * Order_Prefix from a raw file/folder name and derives the human-readable
 * Display_Name. See the design "Prefix parsing" algorithm and Property 2.
 */

import type { ParsedName } from './types';

/** Maximum valid Order_Prefix value; larger digit runs are treated as unprefixed. */
const MAX_ORDER = 999_999_999;

/**
 * Matches a leading run of digits, then a run of ONE OR MORE separator
 * characters (space, hyphen, underscore, or dot, in any mix), then the
 * remainder. The maximal separator run is consumed as the prefix boundary, so
 * `01 - Name`, `01-Name`, `01. Name`, and `01_-_ Name` all collapse to the same
 * Display_Name.
 */
const PREFIX_PATTERN = /^(\d+)[ \-_.]+(.*)$/;

/**
 * Parses an optional numeric Order_Prefix from a raw name.
 *
 * When the name begins with a run of digits (value in 0..999,999,999)
 * IMMEDIATELY followed by a run of one or more separator characters, returns the
 * parsed integer order and the trimmed remainder (with the digits and the entire
 * separator run removed) as the Display_Name. Otherwise (no separator run after
 * the digits, no leading digits, or digits out of range) returns `order: null`
 * and the trimmed original name, so the entry sorts into the alphabetical tail
 * (Req 1.4, 1.5).
 */
export function parseName(rawName: string): ParsedName {
  const match = PREFIX_PATTERN.exec(rawName);

  if (match) {
    const digits = match[1] ?? '';
    const remainder = match[2] ?? '';
    const order = Number.parseInt(digits, 10);

    if (Number.isFinite(order) && order >= 0 && order <= MAX_ORDER) {
      return { order, displayName: remainder.trim() };
    }
  }

  return { order: null, displayName: rawName.trim() };
}
