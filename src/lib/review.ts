/**
 * Spaced-repetition scheduler — the flagship of v2.
 *
 * A note becomes a *review item* the first time its quiz is completed. From
 * then on it resurfaces for review on a schedule that stretches out when you
 * keep getting it right and snaps back when you slip. This is the difference
 * between reading something once and keeping it: the site quietly brings a
 * topic back right around when you'd be about to forget it.
 *
 * MODEL — a trimmed SM-2 (the SuperMemo algorithm behind Anki & friends).
 * We don't ask the reader for a 0–5 self-rating; instead a whole *quiz session*
 * yields a single grade from how they did:
 *
 *   - `again`  — failed the quiz (below pass). Interval resets; it's due again
 *                very soon. Counts as a lapse.
 *   - `good`   — passed. Interval grows by the easiness factor.
 *   - `easy`   — aced it (all correct). Interval grows a bit more, ease nudges up.
 *
 * Intervals follow the classic ladder for the first two successful reps
 * (≈1 day, then ≈6 days) and then multiply by the easiness factor, which drifts
 * within [1.3, 2.7]. All of this is pure and deterministic given a `now`, so it
 * is unit-testable without touching storage or the clock.
 *
 * The slice accessors at the bottom are a thin facade over the shared store's
 * `review` map (see `@/lib/store`), mirroring how `progress.ts` wraps progress.
 */

import { load, update, onStoreChange, type ReviewItem } from './store';

/** One day in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Easiness bounds (SM-2 convention: never below 1.3). */
const MIN_EASE = 1.3;
const MAX_EASE = 2.7;
const DEFAULT_EASE = 2.5;

/** First two successful intervals (days) before ease-driven growth kicks in. */
const FIRST_INTERVAL = 1;
const SECOND_INTERVAL = 6;

/** Where a lapsed item lands: due again within the hour. */
const LAPSE_INTERVAL_DAYS = 1 / 24;

/** The grade a completed quiz session maps to. */
export type ReviewGrade = 'again' | 'good' | 'easy';

/** A fresh review item for a note that has just been learned (never reviewed). */
export function newItem(now: number): ReviewItem {
  return {
    due: now,
    intervalDays: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
    lastReviewed: 0,
  };
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Advance an item by one review. Pure: given the current item, a grade, and the
 * current time, return the next item. Does not read or write storage.
 *
 *   again → reps 0, lapse +1, ease −0.20, due in ~1 hour
 *   good  → reps +1; interval 1d → 6d → ×ease; ease unchanged
 *   easy  → reps +1; like good but a touch longer, ease +0.15
 */
export function schedule(item: ReviewItem, grade: ReviewGrade, now: number): ReviewItem {
  if (grade === 'again') {
    return {
      due: now + LAPSE_INTERVAL_DAYS * DAY_MS,
      intervalDays: LAPSE_INTERVAL_DAYS,
      ease: clamp(item.ease - 0.2, MIN_EASE, MAX_EASE),
      reps: 0,
      lapses: item.lapses + 1,
      lastReviewed: now,
    };
  }

  const reps = item.reps + 1;
  const ease =
    grade === 'easy' ? clamp(item.ease + 0.15, MIN_EASE, MAX_EASE) : item.ease;

  let intervalDays: number;
  if (reps === 1) {
    intervalDays = FIRST_INTERVAL;
  } else if (reps === 2) {
    intervalDays = SECOND_INTERVAL;
  } else {
    const base = item.intervalDays > 0 ? item.intervalDays : SECOND_INTERVAL;
    intervalDays = base * ease;
  }
  if (grade === 'easy') intervalDays *= 1.3;

  // Round to whole days once past the fixed ladder, so due dates land cleanly.
  if (reps >= 2) intervalDays = Math.round(intervalDays);

  return {
    due: now + intervalDays * DAY_MS,
    intervalDays,
    ease,
    reps,
    lapses: item.lapses,
    lastReviewed: now,
  };
}

/**
 * Map a finished quiz session to a grade: a fail is `again`, a perfect score is
 * `easy`, and any other pass is `good`.
 */
export function gradeFromQuiz(correct: number, total: number, passed: boolean): ReviewGrade {
  if (!passed) return 'again';
  if (total > 0 && correct >= total) return 'easy';
  return 'good';
}

/* ===========================================================================
 * Store facade — the `review` slice.
 * =========================================================================== */

/** Normalize a route key the same way progress/scratchpad do. */
function normalizeRoute(route: string): string {
  let r = route.trim();
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** Current time; indirected so tests can inject a fixed clock if needed. */
function nowMs(): number {
  return Date.now();
}

/** The review item for a route, or `undefined` if the note isn't scheduled. */
export function getReview(route: string): ReviewItem | undefined {
  return load().review[normalizeRoute(route)];
}

/**
 * Whether the GRADED quiz for a note is currently locked, and until when.
 *
 * A failed attempt resets `reps` to 0 and sets a near-future `due` (the SM-2
 * `again` cooldown). So the quiz is locked while an item exists, is not yet
 * due, and sits in a failed state (`reps === 0`). A passed attempt has
 * `reps >= 1`, so completing a note never locks it. A never-attempted note has
 * no item and is unlocked. Flashcards practice is never gated by this.
 */
export function quizLock(
  route: string,
  now: number = nowMs(),
): { locked: boolean; unlockAt: number } {
  const item = getReview(route);
  if (!item) return { locked: false, unlockAt: 0 };
  const locked = item.reps === 0 && item.due > now;
  return { locked, unlockAt: item.due };
}

/**
 * Record a completed quiz session for a note and (re)schedule it.
 *
 * If the note has no review item yet, one is created, so finishing a quiz for
 * the first time enrolls the note into spaced repetition. The grade is derived
 * from the session via {@link gradeFromQuiz}. Returns the stored next item.
 */
export function recordReview(
  route: string,
  correct: number,
  total: number,
  passed: boolean,
): ReviewItem {
  const key = normalizeRoute(route);
  const now = nowMs();
  const grade = gradeFromQuiz(correct, total, passed);
  let nextItem!: ReviewItem;
  update((doc) => {
    const current = doc.review[key] ?? newItem(now);
    nextItem = schedule(current, grade, now);
    return { ...doc, review: { ...doc.review, [key]: nextItem } };
  });
  return nextItem;
}

/** Remove a note's review item (e.g. when its progress is cleared). */
export function clearReview(route: string): void {
  const key = normalizeRoute(route);
  update((doc) => {
    if (!(key in doc.review)) return doc;
    const next = { ...doc.review };
    delete next[key];
    return { ...doc, review: next };
  });
}

/** Routes whose review is due at or before `now` (default: the current time). */
export function dueRoutes(now: number = nowMs()): string[] {
  const review = load().review;
  return Object.keys(review).filter((r) => review[r]!.due <= now);
}

/** How many reviews are due now. */
export function dueCount(now: number = nowMs()): number {
  return dueRoutes(now).length;
}

/** Total number of notes enrolled in spaced repetition. */
export function scheduledCount(): number {
  return Object.keys(load().review).length;
}

/** Clear the entire review schedule (used when progress is reset). */
export function resetAllReviews(): void {
  update((doc) => ({ ...doc, review: {} }));
}

/* ===========================================================================
 * Dev/test helpers. These are only wired up behind `import.meta.env.DEV` (see
 * `review-dev.ts`), so they never ship in the production build.
 * =========================================================================== */

/**
 * Force every scheduled review's due date to the past, so the "Review due"
 * card and a review session can be exercised immediately in dev. Returns how
 * many items were made due.
 */
export function devMakeAllDue(): number {
  const past = nowMs() - DAY_MS;
  let n = 0;
  update((doc) => {
    const review: Record<string, ReviewItem> = {};
    for (const [k, item] of Object.entries(doc.review)) {
      review[k] = { ...item, due: past };
      n += 1;
    }
    return { ...doc, review };
  });
  return n;
}

/**
 * Enroll a note into review with an already-past due date, without taking its
 * quiz — a dev shortcut to populate the schedule for testing the card/session.
 */
export function devEnrolDue(route: string): void {
  const key = normalizeRoute(route);
  const past = nowMs() - DAY_MS;
  update((doc) => ({
    ...doc,
    review: { ...doc.review, [key]: { ...newItem(past), due: past } },
  }));
}

/** A snapshot of the current schedule, for logging in dev tools. */
export function devSnapshot(): Record<string, ReviewItem> {
  return load().review;
}

/** Subscribe to review changes (same- and cross-tab). Returns unsubscribe. */
export function onReviewChange(listener: () => void): () => void {
  return onStoreChange(listener);
}
