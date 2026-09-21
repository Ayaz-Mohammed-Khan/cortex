/**
 * Text normalization for syllabus-to-note matching.
 *
 * Turns free-form prose — a roadmap bullet, a note heading, a line from the
 * curriculum document — into a canonical token list that can be compared for
 * equality and overlap. Pure and deterministic: no DOM, filesystem or Astro
 * dependency, so it is exercised directly by unit tests.
 *
 * The pipeline, in order (order matters and is load-bearing):
 *
 *   1. lowercase
 *   2. strip inline maths (`$...$`) and markdown emphasis, which carry no topic
 *      signal but would otherwise fragment tokens
 *   3. fold `&` to "and", then reduce every non-alphanumeric run to a space
 *   4. singularize tokens, BEFORE phrase folding, so "Z-tables" and "z-table"
 *      both reach the `z table` phrase
 *   5. fold multi-word aliases to their canonical token, LONGEST PHRASE FIRST so
 *      "probability density function" wins over a bare "function"
 *   6. drop stopwords, fold single-word aliases, de-duplicate
 *
 * Step 4 before step 5 is why `ALIAS_GROUPS` may spell phrases in the singular
 * only; adding plural variants there is unnecessary.
 */

import { ALIAS_GROUPS, SINGULAR_EXCEPTIONS, STOPWORDS } from './vocabulary.ts';

/** A normalized phrase: canonical tokens plus a joined key for equality. */
export interface Normalized {
  /** Canonical tokens, de-duplicated, in first-seen order. */
  tokens: string[];
  /** `tokens.join(' ')`, for cheap exact comparison. */
  key: string;
}

/**
 * Canonical form for every alias, keyed by the alias itself. Built once at
 * module load. Phrase entries (containing a space) are applied as string
 * replacements; single-word entries are applied per token.
 */
const PHRASE_ALIASES: readonly { phrase: string; canonical: string }[] = ALIAS_GROUPS.flatMap(
  (group) => {
    const canonical = group[0];
    if (canonical === undefined) return [];
    return group
      .slice(1)
      .filter((member) => member.includes(' '))
      .map((phrase) => ({ phrase, canonical }));
  },
)
  // Longest first: a phrase must not be consumed by a shorter sub-phrase.
  .sort((a, b) => b.phrase.length - a.phrase.length);

const WORD_ALIASES: ReadonlyMap<string, string> = new Map(
  ALIAS_GROUPS.flatMap((group) => {
    const canonical = group[0];
    if (canonical === undefined) return [];
    return group
      .slice(1)
      .filter((member) => !member.includes(' '))
      .map((word) => [word, canonical] as const);
  }),
);

/**
 * Strip a trailing plural `s`. Applied to both sides of every comparison, so a
 * crude result is harmless as long as it is CONSISTENT.
 *
 * The exclusions are not cosmetic: "analysis" must not become "analysi" and
 * "bias" must not become "bia", because those are load-bearing subject words
 * whose singular form also appears in headings. Endings that are never a plural
 * marker (`ss`, `sis`, `us`, `is`) are therefore left alone.
 */
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (/(?:ss|sis|us|is)$/.test(word)) return word;
  if (SINGULAR_EXCEPTIONS.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Words to canonical tokens, WITHOUT alias folding: flatten, drop stopwords,
 * singularize.
 *
 * Stopwords are dropped BEFORE singularization, which is load-bearing: strip the
 * `s` first and "does" becomes "doe", which is no longer in the stopword list and
 * survives as a phantom token that ruins subset comparisons. ("this" -> "thi"
 * leaks the same way.)
 *
 * Phrase needles are built with this same function, so an alias containing a
 * stopword ("coefficient of variation") still matches text that has had its
 * stopwords removed.
 */
function basicTokens(text: string): string[] {
  const flat = flatten(text);
  if (flat.length === 0) return [];
  const out: string[] = [];
  for (const raw of flat.split(' ')) {
    if (raw.length === 0) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(singularize(raw));
  }
  return out;
}

/** Reduce text to lowercase alphanumeric words separated by single spaces. */
function flatten(text: string): string {
  return text
    .toLowerCase()
    // Inline and display maths: `$\alpha$` contributes nothing but noise.
    .replace(/\$[^$]*\$/g, ' ')
    // Markdown emphasis / code ticks.
    .replace(/[*_`]+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Phrase needles, pre-tokenized once, longest first. */
const PHRASE_NEEDLES: readonly { needle: string; canonical: string }[] = PHRASE_ALIASES.map(
  ({ phrase, canonical }) => ({ needle: ` ${basicTokens(phrase).join(' ')} `, canonical }),
)
  .filter(({ needle }) => needle.trim().length > 0)
  .sort((a, b) => b.needle.length - a.needle.length);

/** Normalize free-form text to canonical tokens. */
export function normalize(text: string): Normalized {
  const base = basicTokens(text);
  if (base.length === 0) return { tokens: [], key: '' };

  // Fold multi-word aliases. Padding with spaces keeps matches on word
  // boundaries, so "pdf" inside "pdfs" is never rewritten.
  let folded = ` ${base.join(' ')} `;
  for (const { needle, canonical } of PHRASE_NEEDLES) {
    while (folded.includes(needle)) folded = folded.replace(needle, ` ${canonical} `);
  }

  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of folded.trim().split(' ')) {
    if (raw.length === 0) continue;
    const token = WORD_ALIASES.get(raw) ?? raw;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  return { tokens, key: tokens.join(' ') };
}
