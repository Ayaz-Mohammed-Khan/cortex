/**
 * The syllabus-to-note matching engine.
 *
 * Given a syllabus topic ("Type 1 & Type 2 errors") and a pool of candidate note
 * headings ("Type I and Type II errors", "The trade-off", ...), decide which
 * heading the topic belongs to — or decide, deliberately, that none of them do.
 *
 * Two properties matter more than raw hit rate:
 *
 *   - EXPLAINABLE. Every result names the tier that produced it and a
 *     human-readable reason, so `npm run audit:syllabus` can show its working
 *     and a wrong link can be diagnosed rather than guessed at.
 *   - CONSERVATIVE. A link to the wrong section is worse than no link, because a
 *     reader who lands in the wrong place loses trust in every other link. The
 *     engine therefore refuses a match when the best candidate is not clearly
 *     better than the runner-up, and refuses loose tiers outright for topics too
 *     generic to place (see {@link GENERIC_TOKENS}).
 *
 * Tiers, strongest first:
 *
 *   `exact`   identical canonical keys
 *   `alias`   same token SET, different order or spelling
 *   `subset`  one side's tokens are wholly contained in the other's
 *   `overlap` high Dice coefficient on the token sets
 *
 * Pure: no IO, no globals. `vocabulary.ts` holds the domain knowledge.
 */

import { normalize, type Normalized } from './normalize.ts';
import { GENERIC_TOKENS } from './vocabulary.ts';

/** How a match was arrived at, strongest first. */
export type MatchTier = 'exact' | 'alias' | 'subset' | 'overlap';

/** A candidate the matcher may choose, carrying caller data in `ref`. */
export interface Candidate<T> {
  /** Text to match against, e.g. a note heading. */
  text: string;
  /** Opaque payload returned on a hit (a route, an anchor, a note id). */
  ref: T;
  /**
   * Which document this candidate belongs to. Ties WITHIN a group are harmless
   * (two sections of one note both describing the bullet) and are broken by
   * depth then document order; ties ACROSS groups are refused, because landing
   * in the wrong note is the failure mode worth protecting against.
   */
  group?: string;
  /**
   * Heading depth, if known. Used only to break ties: a bullet naming a subject
   * should prefer that subject's top-level section over a nested aside.
   */
  depth?: number;
  /**
   * Title of the document this candidate belongs to. A topic overwhelmingly
   * belongs to the note NAMED after it, which is the one piece of context the
   * heading text alone cannot supply: searching a whole category for
   * "Confidence intervals" finds a plausible section in the CLT note too, and
   * only the note title breaks that tie the right way.
   */
  groupTitle?: string;
}

/** A scored candidate. */
export interface Match<T> {
  ref: T;
  /** The candidate's original text, for reporting. */
  text: string;
  tier: MatchTier;
  /** 0..1. Compare only within a run; tiers are separated by wide bands. */
  score: number;
  /** Human-readable justification, surfaced by the audit report. */
  reason: string;
  /** The candidate's group, when it declared one. */
  group?: string;
}

export interface MatchOptions {
  /**
   * Minimum score to accept. Default 0.55, which admits `overlap` matches of
   * roughly two thirds token agreement.
   */
  threshold?: number;
  /**
   * How far ahead of the runner-up the winner must be. Guards against a topic
   * that describes several sections equally well being pinned to an arbitrary
   * one. Default 0.05.
   */
  margin?: number;
  /**
   * Require the winner to be unique across the whole pool. Set when the pool
   * spans MULTIPLE notes, where a loose win could land on the wrong document;
   * leave off for a single note, whose repeated headings are the same subject.
   */
  requireUnique?: boolean;
}

const DEFAULTS = { threshold: 0.55, margin: 0.05, requireUnique: false } as const;

/** Dice coefficient over two token sets: 2|A n B| / (|A| + |B|). */
function dice(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const token of a) if (setB.has(token)) shared++;
  return (2 * shared) / (a.length + b.length);
}

function isSubset(inner: readonly string[], outer: readonly string[]): boolean {
  if (inner.length === 0) return false;
  const set = new Set(outer);
  return inner.every((token) => set.has(token));
}

/** True when a topic carries no token specific enough to place it on its own. */
function tooGenericToPlace(tokens: readonly string[]): boolean {
  return tokens.every((token) => GENERIC_TOKENS.has(token));
}

/** Score one candidate against an already-normalized query. */
function scoreOne(query: Normalized, candidate: Normalized): Omit<Match<unknown>, 'ref' | 'text'> | null {
  if (query.tokens.length === 0 || candidate.tokens.length === 0) return null;

  if (query.key === candidate.key) {
    return { tier: 'exact', score: 1, reason: 'identical after normalization' };
  }

  // Same tokens, different order or spelling: "PMF" vs "Probability mass function".
  if (
    query.tokens.length === candidate.tokens.length &&
    isSubset(query.tokens, candidate.tokens)
  ) {
    return { tier: 'alias', score: 0.95, reason: 'same terms, different wording' };
  }

  // Loose tiers are unavailable to topics that are all filler.
  const generic = tooGenericToPlace(query.tokens);

  if (!generic && isSubset(query.tokens, candidate.tokens)) {
    // The heading says everything the topic says, plus more: the topic names a
    // part of that section. Confidence falls as the heading adds extra terms.
    const extra = candidate.tokens.length - query.tokens.length;
    return {
      tier: 'subset',
      score: Math.max(0.6, 0.9 - extra * 0.05),
      reason: `topic terms all appear in the heading (+${extra} extra)`,
    };
  }

  if (!generic && isSubset(candidate.tokens, query.tokens)) {
    // The heading is the shorter, more general phrase: "Parameters" for the
    // topic "Parameters & intuition". Slightly weaker than the other direction.
    const extra = query.tokens.length - candidate.tokens.length;
    return {
      tier: 'subset',
      score: Math.max(0.58, 0.85 - extra * 0.05),
      reason: `heading terms all appear in the topic (+${extra} extra)`,
    };
  }

  if (!generic) {
    const d = dice(query.tokens, candidate.tokens);
    if (d >= 0.6) {
      return {
        tier: 'overlap',
        score: d * 0.9,
        reason: `${Math.round(d * 100)}% term overlap`,
      };
    }
  }

  return null;
}

/**
 * A pool normalized once, for callers matching many topics against it. Saves
 * re-normalizing every heading for every bullet.
 */
export interface PreparedPool<T> {
  entries: readonly {
    normalized: Normalized;
    ref: T;
    text: string;
    group?: string;
    /** Tokens of the owning document's title, for the affinity bonus. */
    titleTokens: readonly string[];
    depth: number;
    /** Position in the pool, so ordering is explicit rather than sort-stability. */
    order: number;
  }[];
}

export function preparePool<T>(pool: readonly Candidate<T>[]): PreparedPool<T> {
  return {
    entries: pool.map((c, order) => ({
      normalized: normalize(c.text),
      ref: c.ref,
      text: c.text,
      ...(c.group === undefined ? {} : { group: c.group }),
      titleTokens: c.groupTitle === undefined ? [] : normalize(c.groupTitle).tokens,
      // Unknown depth sorts as a top-level section rather than last.
      depth: c.depth ?? 2,
      order,
    })),
  };
}

/**
 * Best heading for `topic`, or `null` when nothing is confident enough.
 *
 * Selection order: score, then shallower heading, then document order. That last
 * pair is what makes the result stable and explainable — a bullet spanning two
 * sections ("Covariance & correlation") lands on the first one rather than being
 * dropped, and a subject's `##` section beats a `###` aside that mentions it.
 *
 * The refusal rule is narrow by design: a near-tie is only fatal when the rival
 * is in a DIFFERENT group, since that is the case where a wrong pick sends the
 * reader to an unrelated document.
 */
export function matchTopicPrepared<T>(
  topic: string,
  prepared: PreparedPool<T>,
  options: MatchOptions = {},
): Match<T> | null {
  const { threshold, margin, requireUnique } = { ...DEFAULTS, ...options };
  const query = normalize(topic);
  if (query.tokens.length === 0) return null;

  const scored = prepared.entries.flatMap((entry) => {
    const result = scoreOne(query, entry.normalized);
    if (result === null) return [];
    // Affinity is kept OUT of the score on purpose. Folding it in would shift
    // every candidate's score and could manufacture the very near-ties it exists
    // to settle; as a separate axis it can only ever break a tie, never create one.
    return [{ entry, ...result, affinity: dice(query.tokens, entry.titleTokens) }];
  });
  if (scored.length === 0) return null;

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.affinity - a.affinity ||
      a.entry.depth - b.entry.depth ||
      a.entry.order - b.entry.order,
  );

  const best = scored[0]!;
  if (best.score < threshold) return null;

  // Only a rival from another document can veto, and only when it is at least as
  // well-named for this topic. "Confidence intervals" finds a plausible section
  // in the CLT note, but the note actually titled "Confidence Intervals" should
  // not lose to it.
  if (requireUnique) {
    const rival = scored.find(
      (m) =>
        m.entry.group !== best.entry.group &&
        best.score - m.score < margin &&
        m.affinity >= best.affinity,
    );
    if (rival !== undefined) return null;
  }

  return {
    ref: best.entry.ref,
    text: best.entry.text,
    ...(best.entry.group === undefined ? {} : { group: best.entry.group }),
    tier: best.tier,
    score: best.score,
    reason:
      best.affinity > 0
        ? `${best.reason}; in the note named for this topic`
        : best.reason,
  };
}

/** {@link matchTopicPrepared} for a one-off pool. */
export function matchTopic<T>(
  topic: string,
  pool: readonly Candidate<T>[],
  options: MatchOptions = {},
): Match<T> | null {
  return matchTopicPrepared(topic, preparePool(pool), options);
}
