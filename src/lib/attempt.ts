/**
 * Graded quiz attempt — the "strict timer" facade.
 *
 * A graded attempt is a durable record of one in-progress quiz: when it
 * started, the wall-clock DEADLINE it must finish by, the per-question answers
 * so far, and the question the reader is on. It lives in the shared store's
 * `attempts` slice (see `@/lib/store`), keyed by note route, mirroring how
 * `progress.ts` and `review.ts` wrap their own slices.
 *
 * WHY PERSIST IT
 *   The point of the timer is that it is a real deadline, not a UI countdown
 *   that pauses when the modal closes. By storing the deadline the instant the
 *   attempt starts, the clock keeps running whether or not the dialog is open:
 *   closing and reopening resumes the SAME attempt against the SAME deadline,
 *   and reopening after the deadline has passed resolves as a timeout. The
 *   timer cannot be paused, reset, or dodged by closing the quiz. The attempt
 *   also survives a reload or a tab switch, so the reader cannot gain time by
 *   navigating away and back.
 *
 * An entry exists ONLY while an attempt is live. Resolving it — submitting,
 * timing out, or abandoning — clears the entry, so a note has at most one live
 * attempt and a resolved attempt leaves no residue.
 *
 * Flashcards practice is untimed and never creates an attempt.
 */

import { load, update, type QuizAttempt } from './store';

/** Normalize a route key the same way the other slices do. */
function normalizeRoute(route: string): string {
  let r = route.trim();
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r.toLowerCase();
}

/** Current time; indirected so tests can reason about a fixed clock. */
function nowMs(): number {
  return Date.now();
}

/**
 * Start a fresh attempt for a note and persist it. The deadline is fixed here,
 * `now + durationSec`, and never moved afterwards. `order` is the sampled,
 * shuffled bank positions this attempt will run (see `@/lib/quiz-sample`); it
 * is stored so a reopened attempt replays the exact same questions, and its
 * length determines the attempt's question count. Any previous attempt for the
 * route is overwritten. Returns the stored attempt.
 */
export function startAttempt(route: string, order: number[], durationSec: number): QuizAttempt {
  const key = normalizeRoute(route);
  const now = nowMs();
  const attempt: QuizAttempt = {
    startedAt: now,
    deadline: now + durationSec * 1000,
    order: [...order],
    answers: new Array<boolean | null>(order.length).fill(null),
    index: 0,
  };
  update((doc) => ({ ...doc, attempts: { ...doc.attempts, [key]: attempt } }));
  return attempt;
}

/** The live attempt for a route, or `undefined` when there is none. */
export function getAttempt(route: string): QuizAttempt | undefined {
  return load().attempts[normalizeRoute(route)];
}

/**
 * Persist a change to the live attempt. `fn` receives the current attempt and
 * returns the next one. A no-op when there is no live attempt for the route.
 */
export function updateAttempt(route: string, fn: (a: QuizAttempt) => QuizAttempt): void {
  const key = normalizeRoute(route);
  update((doc) => {
    const current = doc.attempts[key];
    if (!current) return doc;
    return { ...doc, attempts: { ...doc.attempts, [key]: fn(current) } };
  });
}

/** Clear a note's live attempt (on submit, timeout, or abandon). */
export function clearAttempt(route: string): void {
  const key = normalizeRoute(route);
  update((doc) => {
    if (!(key in doc.attempts)) return doc;
    const next = { ...doc.attempts };
    delete next[key];
    return { ...doc, attempts: next };
  });
}

/**
 * Seconds remaining on an attempt's deadline, floored at zero. A convenience
 * for the island so the clock math lives in one place.
 */
export function secondsLeft(attempt: QuizAttempt, now: number = nowMs()): number {
  return Math.max(0, Math.round((attempt.deadline - now) / 1000));
}

/** Whether an attempt's deadline has already passed. */
export function isExpired(attempt: QuizAttempt, now: number = nowMs()): boolean {
  return now >= attempt.deadline;
}
