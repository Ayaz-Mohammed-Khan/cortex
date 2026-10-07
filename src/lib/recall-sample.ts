/**
 * Cross-note recall sampler — builds one mixed question set from many topics.
 *
 * A recall session (see `@/lib/recall`) is handed a list of topic ROUTES — the
 * notes covered in a weekly or monthly window — and must turn them into a
 * single, interleaved quiz that spreads attention across all of them rather
 * than marching note-by-note. This module does exactly that, and nothing else:
 * it is PURE (no DOM, no storage, no clock) and deterministic given its `rng`.
 *
 * PER-TOPIC PICK
 *   From each topic's quiz we take up to `perTopic` questions, preferring a
 *   spread of distinct `concept` tags and a mix of `difficulty` bands so a
 *   topic contributes variety, not three near-duplicates. There is no per-
 *   question recall history yet, so within those preferences the choice is
 *   uniform (concept-spread first, then difficulty mix, then order).
 *
 * COMBINE → INTERLEAVE → SHUFFLE → CAP
 *   Picks are tagged with their source and then INTERLEAVED round-robin across
 *   topics (topic A, topic B, topic C, A, B, …) so the session never clusters a
 *   single note. The interleaved list is shuffled with the injected `rng`, then
 *   trimmed to `max`. We NEVER pad with duplicates to reach `min`: a thin window
 *   simply yields a shorter session. `topicCount` reports how many topics
 *   actually contributed a question.
 */

import type { Quiz, QuizQuestion } from './quiz';

/**
 * A sampled question, tagged with where it came from so the session UI can
 * label each item with its source note.
 */
export type SampledQuestion = QuizQuestion & {
  /** The normalized route of the note this question was drawn from. */
  sourceRoute: string;
  /** A human-readable label for that note (from the caller's `labelFor`). */
  sourceLabel: string;
};

/** The outcome of a sampling run. */
export interface SampleResult {
  /** The interleaved, shuffled, capped question set. */
  questions: SampledQuestion[];
  /** How many distinct topics contributed at least one question. */
  topicCount: number;
}

/** Tunables for one sampling run. */
export interface SampleOptions {
  /** Max questions drawn from any single topic. */
  perTopic: number;
  /** Soft floor — informational; sampling never pads to reach it. */
  min: number;
  /** Hard cap on the final question count. */
  max: number;
}

/** Weekly recall: tight and frequent — a few per topic, 6–15 total. */
export const WEEKLY_SAMPLE: SampleOptions = { perTopic: 3, min: 6, max: 15 };

/** Monthly sweep: broader coverage — fewer per topic, up to 24 total. */
export const MONTHLY_SAMPLE: SampleOptions = { perTopic: 2, min: 6, max: 24 };

/** Shuffle a copy of `arr` in place with a Fisher–Yates pass driven by `rng`. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
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
 * Pick up to `perTopic` questions from one quiz, preferring distinct concept
 * tags and a mix of difficulty bands. Pure given `rng`.
 *
 * Strategy: shuffle the questions once (so ties are broken fairly), then make a
 * first pass that takes a question only if its concept has not been used yet —
 * spreading across concepts. If that leaves budget, a second pass fills from the
 * remainder, this time preferring difficulty bands not yet represented. A final
 * pass tops up from whatever is left.
 */
function pickFromQuiz(quiz: Quiz, perTopic: number, rng: () => number): QuizQuestion[] {
  const pool = shuffle(quiz.questions, rng);
  const budget = Math.min(perTopic, pool.length);
  const chosen: QuizQuestion[] = [];
  const taken = new Set<number>();
  const seenConcepts = new Set<string>();
  const seenDifficulties = new Set<string>();

  const take = (i: number): void => {
    const q = pool[i]!;
    chosen.push(q);
    taken.add(i);
    if (q.concept) seenConcepts.add(q.concept);
    if (q.difficulty) seenDifficulties.add(q.difficulty);
  };

  // Pass 1 — one per distinct concept (questions without a concept tag defer).
  for (let i = 0; i < pool.length && chosen.length < budget; i += 1) {
    if (taken.has(i)) continue;
    const c = pool[i]!.concept;
    if (c && !seenConcepts.has(c)) take(i);
  }
  // Pass 2 — fill, preferring difficulty bands not yet represented.
  for (let i = 0; i < pool.length && chosen.length < budget; i += 1) {
    if (taken.has(i)) continue;
    const d = pool[i]!.difficulty;
    if (!d || !seenDifficulties.has(d)) take(i);
  }
  // Pass 3 — top up from whatever remains, in shuffled order.
  for (let i = 0; i < pool.length && chosen.length < budget; i += 1) {
    if (!taken.has(i)) take(i);
  }

  return chosen;
}

/**
 * Round-robin interleave a list of per-topic question lists: take index 0 from
 * each list, then index 1, and so on, so no topic clusters together.
 */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = lists.reduce((m, l) => Math.max(m, l.length), 0);
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i]!);
    }
  }
  return out;
}

/**
 * Sample a mixed recall set across `routes`. Only routes that have a quiz in
 * `quizzes` contribute; the rest are skipped. See the module header for the
 * pick → interleave → shuffle → cap pipeline. Deterministic given `rng`.
 */
export function sampleRecall(
  routes: string[],
  quizzes: Map<string, Quiz>,
  labelFor: (route: string) => string,
  opts: SampleOptions,
  rng: () => number = Math.random,
): SampleResult {
  // Per-topic picks, tagged with their source, in input route order.
  const perTopicLists: SampledQuestion[][] = [];
  for (const route of routes) {
    const quiz = quizzes.get(route);
    if (!quiz) continue;
    const picks = pickFromQuiz(quiz, opts.perTopic, rng);
    if (picks.length === 0) continue;
    const label = labelFor(route);
    perTopicLists.push(
      picks.map((q) => ({ ...q, sourceRoute: route, sourceLabel: label })),
    );
  }

  const topicCount = perTopicLists.length;
  if (topicCount === 0) return { questions: [], topicCount: 0 };

  // Interleave across topics, shuffle the whole set, then enforce the hard cap.
  // No padding to `min`: a short pool stays short.
  const interleaved = interleave(perTopicLists);
  const shuffled = shuffle(interleaved, rng);
  const questions = shuffled.slice(0, opts.max);

  return { questions, topicCount };
}
