/**
 * Quiz bank validator.
 *
 * Checks every `content/**\/*.quiz.json` against the authoring standard (see
 * `.kiro/steering/Quiz authoring guide.md`) and fails the build on anything
 * that would make a quiz invalid or gameable. Run via `npm run check:quizzes`,
 * and it also runs as part of `prebuild`.
 *
 * WHY THIS EXISTS
 *   A quiz bank can be perfectly valid JSON and still be worthless. The defect
 *   this script was written to catch is the "longest option" tell: if the
 *   correct answer is consistently the wordiest option, a reader can score
 *   highly with no knowledge at all by always choosing the longest one. That is
 *   easy to introduce by accident, because the correct option naturally attracts
 *   fuller reasoning while distractors get written as terse stubs. It is also
 *   invisible on inspection and only shows up when measured, which is exactly
 *   what a checker is for.
 *
 * WHAT IT ENFORCES
 *   Per question (structural):
 *     - a non-empty `question`, and a `type` of mcq, scenario, or card
 *     - `concept` and `difficulty` metadata, needed for stratified sampling
 *     - graded questions: at least three options, an in-range `answer`, and a
 *       non-empty `explanation`
 *     - card questions: a non-empty `answer` string
 *   Per question (style, from the house rules):
 *     - no en or em dashes, no curly quotes, no caret exponent notation
 *   Per file (anti-gaming):
 *     - the correct option is the single longest in at most HARD_MAX_SHARE of
 *       graded questions, and the mean excess length of a correct option over
 *       its longest distractor stays under MAX_MEAN_MARGIN characters
 *
 * The length rules are deliberately stated as file-level aggregates rather than
 * per-question limits. An individual question may legitimately need a longer
 * correct option; what must not happen is a systematic pattern a reader can
 * exploit across a whole quiz.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Where the authored banks live. */
const CONTENT_ROOT = 'content';

/** Share of graded questions whose correct option may be the longest. */
const HARD_MAX_SHARE = 0.5;

/** Mean characters a correct option may exceed its longest distractor by. */
const MAX_MEAN_MARGIN = 12;

/** Question kinds the loader understands. */
const TYPES = new Set(['mcq', 'scenario', 'card']);

/** Characters the house style forbids, with the reason reported on failure. */
const STYLE_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /[\u2014\u2013]/, label: 'en or em dash (use a comma, colon, or rewrite)' },
  { pattern: /[\u2018\u2019\u201C\u201D]/, label: 'curly quote (use straight quotes)' },
  { pattern: /\^\d/, label: 'caret exponent (spell it out, e.g. "n squared")' },
];

/**
 * With `--details`, every graded question's length margin is listed rather than
 * just the file-level verdict. That turns "this bank is gameable" into "these
 * four questions are the reason", which is what you need while fixing one.
 * Optional trailing arguments filter to files whose path contains the text.
 */
const SHOW_DETAILS = process.argv.includes('--details');
const PATH_FILTERS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** One problem found in one file. */
interface Problem {
  file: string;
  detail: string;
}

/** Recursively collect every `.quiz.json` under a directory. */
function findQuizFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findQuizFiles(full));
    else if (entry.toLowerCase().endsWith('.quiz.json')) out.push(full);
  }
  return out;
}

/** True for a non-empty trimmed string. */
function isText(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Validate one file, returning every problem found. Structural failures are
 * reported per question; the length checks are aggregated over the file.
 */
function checkFile(path: string): Problem[] {
  const rel = relative(process.cwd(), path);
  const problems: Problem[] = [];
  const add = (detail: string): void => problems.push({ file: rel, detail });

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    add(`invalid JSON: ${(err as Error).message}`);
    return problems;
  }

  const questions = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    add('no questions array, or it is empty');
    return problems;
  }

  // Margins of correct option length over the longest distractor, per graded
  // question. Positive means the correct option is the longest.
  const margins: number[] = [];
  let graded = 0;
  let longest = 0;
  const seenStems = new Set<string>();

  // Only populated under `--details`; one line per graded question.
  const details: string[] = [];

  questions.forEach((raw, i) => {
    const q = raw as Record<string, unknown>;
    const at = `question ${i + 1}`;

    if (!isText(q.question)) {
      add(`${at}: missing question text`);
      return;
    }
    if (!isText(q.type) || !TYPES.has(q.type)) {
      add(`${at}: type must be one of mcq, scenario, card`);
      return;
    }
    if (!isText(q.concept)) add(`${at}: missing concept tag (needed for sampling)`);
    if (!isText(q.difficulty)) add(`${at}: missing difficulty (needed for sampling)`);

    // Duplicate stems mean the same thing is being asked twice in one bank.
    const stem = q.question.toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (seenStems.has(stem)) add(`${at}: duplicate question stem`);
    seenStems.add(stem);

    // Style rules apply to every piece of reader-facing text in the question.
    const texts = [q.question, q.scenario, q.explanation, q.misconception]
      .filter(isText)
      .concat(Array.isArray(q.options) ? (q.options.filter(isText) as string[]) : [])
      .concat(typeof q.answer === 'string' ? [q.answer] : []);
    for (const rule of STYLE_RULES) {
      if (texts.some((t) => rule.pattern.test(t))) add(`${at}: ${rule.label}`);
    }

    if (q.type === 'card') {
      if (!isText(q.answer)) add(`${at}: card needs a model answer string`);
      return;
    }

    // Graded question: options, answer index, explanation, and length balance.
    const options = q.options;
    if (!Array.isArray(options) || options.length < 3 || !options.every(isText)) {
      add(`${at}: needs at least three non-empty options`);
      return;
    }
    if (typeof q.answer !== 'number' || !Number.isInteger(q.answer)) {
      add(`${at}: answer must be a zero-based index`);
      return;
    }
    if (q.answer < 0 || q.answer >= options.length) {
      add(`${at}: answer index ${q.answer} is outside the options`);
      return;
    }
    if (!isText(q.explanation)) add(`${at}: graded question needs an explanation`);

    graded += 1;
    const correctLen = (options[q.answer] as string).length;
    const distractorLens = (options as string[])
      .filter((_, k) => k !== q.answer)
      .map((o) => o.length);
    const maxDistractor = Math.max(...distractorLens);
    margins.push(correctLen - maxDistractor);
    if (correctLen > maxDistractor) longest += 1;

    if (SHOW_DETAILS) {
      const margin = correctLen - maxDistractor;
      const flag = margin > 15 ? '  <-- rewrite' : '';
      const lens = (options as string[]).map((o, k) => (k === q.answer ? `[${o.length}]` : `${o.length}`));
      details.push(
        `${String(i + 1).padStart(3)}  margin ${String(margin).padStart(4)}  ` +
          `lengths ${lens.join(' ')}${flag}`,
      );
    }
  });

  if (SHOW_DETAILS && details.length > 0) {
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    console.log(`\n${rel}`);
    console.log(`  correct-is-longest ${longest}/${graded}, mean margin ${mean.toFixed(1)}`);
    for (const d of details) console.log(`  ${d}`);
  }

  if (graded > 0) {
    const share = longest / graded;
    if (share > HARD_MAX_SHARE) {
      add(
        `the correct option is the longest in ${longest} of ${graded} graded questions ` +
          `(${Math.round(share * 100)}%, limit ${Math.round(HARD_MAX_SHARE * 100)}%): ` +
          `expand the distractors so length does not reveal the answer`,
      );
    }
    const meanMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
    if (meanMargin > MAX_MEAN_MARGIN) {
      add(
        `correct options average ${Math.round(meanMargin)} characters longer than their ` +
          `longest distractor (limit ${MAX_MEAN_MARGIN}): give the distractors comparable substance`,
      );
    }
  }

  return problems;
}

const files = findQuizFiles(CONTENT_ROOT)
  .filter((f) => PATH_FILTERS.length === 0 || PATH_FILTERS.some((t) => f.includes(t)))
  .sort();
const problems = files.flatMap(checkFile);

if (problems.length === 0) {
  console.log(
    `check:quizzes OK, ${files.length} quiz file(s) validated, ` +
      'schema, house style, and answer-length balance all pass.',
  );
  process.exit(0);
}

// Group the report by file so a failure is easy to act on.
const byFile = new Map<string, string[]>();
for (const p of problems) {
  const list = byFile.get(p.file) ?? [];
  list.push(p.detail);
  byFile.set(p.file, list);
}

console.error(`check:quizzes FAILED, ${problems.length} problem(s) in ${byFile.size} file(s):\n`);
for (const [file, details] of [...byFile.entries()].sort()) {
  console.error(`  ${file}`);
  for (const d of details) console.error(`    - ${d}`);
}
process.exit(1);
