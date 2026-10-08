/**
 * Quiz sampling primitives — the shared, pure core behind every sampled run.
 *
 * Two surfaces draw a stratified subset of questions:
 *   - the GRADED quiz (`@/components/quiz`), which samples one note's bank so a
 *     timed attempt varies between sittings instead of marching the whole bank
 *     in authored order, and
 *   - CUMULATIVE RECALL (`@/lib/recall-sample`), which samples across many
 *     notes and interleaves them.
 *
 * Both want the same per-topic behaviour: take up to a budget of questions,
 * spread across distinct `concept` tags, mix `difficulty` bands, and break ties
 * fairly. That logic lives here, once, as `pickIndices` (and its convenience
 * wrapper `pickFromQuiz`), so there is a single implementation to reason about
 * and test. Everything here is PURE and deterministic given its `rng` — no DOM,
 * no storage, no clock.
 *
 * WHY INDICES
 *   `pickIndices` returns POSITIONS into the quiz's `questions`, not the
 *   questions themselves. The graded attempt persists that index list so a
 *   closed-and-reopened attempt replays the exact same sampled set against the
 *   same deadline; the recall sampler just maps the indices back to questions.
 *   Indices are the smallest stable identity a sampled run needs.
 */

import type { Quiz, QuizQuestion } from './quiz';

/** Shuffle a copy of `arr` with a Fisher–Yates pass driven by `rng`. Pure. */
export function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

/**
 * Choose up to `budget` question POSITIONS from `questions`, preferring a
 * spread of distinct `concept` tags and a mix of `difficulty` bands.
 *
 * Strategy (deterministic given `rng`):
 *   1. shuffle the positions once so ties are broken fairly;
 *   2. pass one — take a position only if its concept has not been used yet,
 *      so the pick spreads across concepts (untagged questions defer);
 *   3. pass two — fill remaining budget, preferring difficulty bands not yet
 *      represented (untagged difficulty counts as "new" so it is not starved);
 *   4. pass three — top up from whatever positions remain, in shuffled order.
 *
 * The returned indices are in PICK order (the order the passes chose them), not
 * sorted; callers that want presentation order shuffle the result themselves.
 */
export function pickIndices(
  questions: readonly QuizQuestion[],
  budget: number,
  rng: () => number,
): number[] {
  const order = shuffle(
    questions.map((_, i) => i),
    rng,
  );
  const cap = Math.min(Math.max(0, Math.floor(budget)), questions.length);
  const chosen: number[] = [];
  const taken = new Set<number>();
  const seenConcepts = new Set<string>();
  const seenDifficulties = new Set<string>();

  const take = (idx: number): void => {
    const q = questions[idx]!;
    chosen.push(idx);
    taken.add(idx);
    if (q.concept) seenConcepts.add(q.concept);
    if (q.difficulty) seenDifficulties.add(q.difficulty);
  };

  // Pass 1 — one per distinct concept.
  for (const idx of order) {
    if (chosen.length >= cap) break;
    if (taken.has(idx)) continue;
    const c = questions[idx]!.concept;
    if (c && !seenConcepts.has(c)) take(idx);
  }
  // Pass 2 — prefer difficulty bands not yet represented.
  for (const idx of order) {
    if (chosen.length >= cap) break;
    if (taken.has(idx)) continue;
    const d = questions[idx]!.difficulty;
    if (!d || !seenDifficulties.has(d)) take(idx);
  }
  // Pass 3 — top up from the remainder.
  for (const idx of order) {
    if (chosen.length >= cap) break;
    if (!taken.has(idx)) take(idx);
  }

  return chosen;
}

/**
 * Convenience wrapper over {@link pickIndices} that returns the chosen
 * questions themselves rather than their positions. Used by the recall sampler.
 */
export function pickFromQuiz(quiz: Quiz, budget: number, rng: () => number): QuizQuestion[] {
  return pickIndices(quiz.questions, budget, rng).map((i) => quiz.questions[i]!);
}

/**
 * Sample a GRADED attempt's question order for one note: the stratified subset
 * of positions, shuffled into presentation order. `max` caps the attempt
 * length; `0` or a negative value means "no cap" (use the whole bank). The
 * result is the `order` the attempt persists and replays on resume.
 */
export function sampleQuizOrder(quiz: Quiz, max: number, rng: () => number = Math.random): number[] {
  const total = quiz.questions.length;
  const budget = max > 0 ? Math.min(max, total) : total;
  const picked = pickIndices(quiz.questions, budget, rng);
  // `pickIndices` returns pick order (concept pass, then difficulty, then
  // top-up), which would surface all distinct-concept questions first. Shuffle
  // once more so the attempt's running order is not a predictable gradient.
  return shuffle(picked, rng);
}
