/**
 * Cumulative-recall scheduler — the "remember what you learned" layer.
 *
 * Spaced repetition (see `@/lib/review`) resurfaces individual notes you got
 * wrong or shaky. Cumulative recall is the complementary habit: at the end of a
 * study WINDOW it pulls a small, mixed set of the topics you covered in that
 * window and asks you to recall across them at once. Weekly windows keep the
 * last few days fresh; a rolling monthly sweep knits the whole last month back
 * together. The difference matters — review tests one idea in isolation, recall
 * tests whether the ideas still cohere after time and interleaving.
 *
 * This module is PURE and READ-ONLY. It never writes the store and never
 * touches the DOM; it reads `completedAt` (and `progress` for undated legacy
 * completions) and reports which recall sessions are now pending. The island in
 * `@/components/recall` turns those reports into cards and sessions and is the
 * only thing that records a cycle as done.
 *
 * WEEKLY WINDOW MODEL
 *   The timeline is anchored at the reader's EARLIEST dated completion. From
 *   that anchor we lay down fixed, non-overlapping 7-day cycles:
 *       cycle k = [anchor + k*7d, anchor + (k+1)*7d)
 *   A cycle becomes a candidate once its end boundary has passed (`cycleEnd <=
 *   now`). We then count how many DATED topics were completed inside it.
 *
 *   CARRY-FORWARD RULE — a lone topic or two is not worth a recall session, so
 *   a window with fewer than three in-window topics does not stand alone: its
 *   topics are carried forward and added to the next window's tally. Windows
 *   keep merging until a boundary accumulates at least three topics; that
 *   boundary becomes ONE pending weekly cycle, keyed by its own `cycleEnd`, and
 *   carrying all the topics that rolled into it. The accumulator then resets and
 *   the next windows build up again. This guarantees every pending weekly holds
 *   >= 3 topics while still pinning each to a real 7-day boundary.
 *
 *   Cycles whose `cycleEnd` is already recorded in `recallWeeklyDone` are
 *   dropped. Results come back oldest-first.
 *
 * MONTHLY WINDOW MODEL
 *   A single rolling 30-day sweep: every topic with a `completedAt` inside
 *   [now - 30d, now], PLUS undated legacy completions (routes in `progress`
 *   that have no `completedAt` key — see the store's note). It is offered only
 *   when the combined set has >= 3 topics and the reader has either never done
 *   a monthly sweep or finished the last one at least 30 days ago.
 */

import { load, onStoreChange } from './store';
import { DAY_MS } from './review';

/** A week in milliseconds — the fixed length of a weekly recall cycle. */
const WEEK_MS = 7 * DAY_MS;

/** A rolling month, in milliseconds, for the monthly sweep window. */
const MONTH_MS = 30 * DAY_MS;

/** Minimum topics a recall session must cover to be worth surfacing. */
const MIN_TOPICS = 3;

/** Current time; indirected so callers/tests can inject a fixed clock. */
function nowMs(): number {
  return Date.now();
}

/** Normalize a route key the same way the progress/review facades do. */
function normalizeRoute(route: string): string {
  let r = route.trim();
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** One pending weekly recall cycle: its end boundary and the topics it covers. */
export interface WeeklyCycle {
  /** Epoch ms of the cycle's end boundary; its stable identity for done-tracking. */
  cycleEnd: number;
  /** Normalized routes to recall in this cycle (>= 3 after carry-forward). */
  routes: string[];
}

/** The rolling monthly recall sweep: the topics it would cover. */
export interface MonthlyWindow {
  /** Normalized routes completed in the last 30 days, plus undated legacy ones. */
  routes: string[];
}

/**
 * The weekly recall cycles that are now pending, oldest-first.
 *
 * Lays fixed 7-day cycles from the earliest dated completion, counts dated
 * topics per cycle, and applies the carry-forward rule so every returned cycle
 * covers at least three topics. Cycles already in `recallWeeklyDone` are
 * excluded. Returns an empty array when there is no dated history yet.
 */
export function pendingWeeklies(now: number = nowMs()): WeeklyCycle[] {
  const doc = load();
  const completedAt = doc.completedAt;

  // Collect dated completions as (route, time) pairs, ignoring non-positive
  // timestamps. The anchor is the earliest such time.
  const dated: { route: string; at: number }[] = [];
  for (const [route, at] of Object.entries(completedAt)) {
    if (at > 0) dated.push({ route: normalizeRoute(route), at });
  }
  if (dated.length === 0) return [];

  let anchor = Infinity;
  for (const d of dated) if (d.at < anchor) anchor = d.at;

  const done = new Set(doc.recallWeeklyDone);
  const cycles: WeeklyCycle[] = [];

  // Walk fixed cycles from the anchor up to the last cycle whose end has passed.
  // `carried` accumulates routes from sub-threshold windows until a boundary
  // reaches the minimum, at which point one pending cycle is emitted.
  let carried: string[] = [];
  for (let k = 0; ; k += 1) {
    const start = anchor + k * WEEK_MS;
    const end = start + WEEK_MS;
    if (end > now) break; // this cycle has not closed yet

    const inWindow = dated.filter((d) => d.at >= start && d.at < end).map((d) => d.route);
    const combined = carried.concat(inWindow);

    if (combined.length >= MIN_TOPICS) {
      // Dedupe while preserving first-seen order; key the cycle by this boundary.
      if (!done.has(end)) {
        cycles.push({ cycleEnd: end, routes: Array.from(new Set(combined)) });
      }
      carried = [];
    } else {
      carried = combined; // still too small — roll into the next window
    }
  }

  return cycles;
}

/**
 * Whether the reader is lagging on weekly recall — two or more weekly cycles
 * are pending at once. The island uses this to nudge with a "you are lagging"
 * reminder and prioritise the oldest cycle.
 */
export function isLagging(now: number = nowMs()): boolean {
  return pendingWeeklies(now).length >= 2;
}

/**
 * The rolling monthly recall sweep, or `null` when one is not due.
 *
 * Combines dated completions inside [now - 30d, now] with undated legacy
 * completions (routes in `progress` with no `completedAt` key). Returns `null`
 * unless the combined set has at least three topics AND the reader has never
 * done a monthly sweep (`recallMonthlyDone === 0`) or finished the last one at
 * least 30 days ago.
 */
export function pendingMonthly(now: number = nowMs()): MonthlyWindow | null {
  const doc = load();
  const since = now - MONTH_MS;

  const routes = new Set<string>();

  // Dated completions inside the rolling 30-day window.
  for (const [route, at] of Object.entries(doc.completedAt)) {
    if (at > 0 && at >= since && at <= now) routes.add(normalizeRoute(route));
  }

  // Undated legacy completions: in `progress` but never stamped in completedAt.
  const datedKeys = new Set(Object.keys(doc.completedAt).map(normalizeRoute));
  for (const route of doc.progress) {
    const key = normalizeRoute(route);
    if (!datedKeys.has(key)) routes.add(key);
  }

  if (routes.size < MIN_TOPICS) return null;

  const last = doc.recallMonthlyDone;
  const dueForMonthly = last === 0 || now - last >= MONTH_MS;
  if (!dueForMonthly) return null;

  return { routes: Array.from(routes) };
}

/**
 * Subscribe to recall-relevant changes (completions and recall-done writes).
 * A thin wrapper over the store's change notifications; returns unsubscribe.
 */
export function onRecallChange(listener: () => void): () => void {
  return onStoreChange(listener);
}
