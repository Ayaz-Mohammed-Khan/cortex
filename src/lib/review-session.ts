/**
 * Shared helpers for a spaced-repetition review *session* — a run through
 * several due notes in one go.
 *
 * The landing-page card (`review-due.ts`) builds a QUEUE of due routes in
 * sessionStorage and sends the reader to the first note's quiz. The global
 * session driver (`review-session-driver.ts`) advances that queue after each
 * review-mode quiz, so finishing one review hands off to the next without a
 * trip back to the roadmap.
 *
 * These two tiny pieces are shared so the queue key and the review-URL shape
 * are defined in exactly one place.
 */

/** sessionStorage key holding the remaining review queue (a JSON string[]). */
export const REVIEW_QUEUE_KEY = 'cortex:review-queue';

/** The URL that opens a note in review mode (auto-starts its quiz). */
export function reviewUrl(route: string): string {
  return `${route}?review=1`;
}

/** Read and parse the remaining review queue (empty array on any failure). */
export function readQueue(): string[] {
  try {
    const raw = sessionStorage.getItem(REVIEW_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

/** Persist the remaining queue, clearing the key when empty. */
export function writeQueue(queue: string[]): void {
  try {
    if (queue.length === 0) sessionStorage.removeItem(REVIEW_QUEUE_KEY);
    else sessionStorage.setItem(REVIEW_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // sessionStorage unavailable: non-fatal, the session just stops advancing.
  }
}
