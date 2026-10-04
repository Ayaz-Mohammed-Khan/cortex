/**
 * Quiz model and build-time loader.
 *
 * Each note may carry a companion quiz authored as a sibling JSON file next to
 * the note: `NN - Name.md` pairs with `NN - Name.quiz.json`. The sync step
 * mirrors those files into `src/content/notes/` alongside the notes, so at
 * build time a note's quiz sits right beside its Markdown. This module reads
 * and validates that file and keys the result by the note's ROUTE, so both the
 * note page and the quiz island can look a quiz up the same way.
 *
 * JSON (not YAML) is deliberate: Node parses it natively, so the feature adds
 * no dependency and the loader stays strippable TypeScript like the other
 * scripts. Authoring is still comfortable because the schema is small.
 *
 * The loader is defensive: a malformed or partial quiz file is dropped with a
 * build warning rather than failing the build, so a bad quiz can never take the
 * site down. A note with no quiz file simply has no quiz.
 */

import { readFileSync } from 'node:fs';

/**
 * A single quiz question. Three kinds, chosen by the concept being tested:
 *
 *   - `mcq`      a crisp multiple-choice question for a fact with a consequence.
 *   - `scenario` a multiple-choice question wrapped in a realistic situation,
 *                for judgement calls (the `scenario` text frames the stem).
 *   - `card`     a self-grade recall card: no options, the reader articulates
 *                the answer, reveals the model answer, and grades themselves.
 *
 * `mcq` and `scenario` are auto-graded against `answer` (a zero-based index into
 * `options`). `card` is self-graded, so it has `answer` text instead of options.
 */
export type QuizQuestion =
  | {
      type: 'mcq' | 'scenario';
      /** For `scenario`: the situation that frames the stem. */
      scenario?: string;
      /** The question stem. May contain inline `code` and KaTeX `$math$`. */
      question: string;
      /** Two or more answer choices. */
      options: string[];
      /** Zero-based index of the correct option. */
      answer: number;
      /** Worked explanation shown after answering (why right, why wrong). */
      explanation: string;
      /** Optional one-line misconception to drop, highlighted in the UI. */
      misconception?: string;
    }
  | {
      type: 'card';
      /** The situation that frames the prompt, if any. */
      scenario?: string;
      /** The recall prompt. */
      question: string;
      /** The model answer revealed when the reader flips the card. */
      answer: string;
      /** Optional extra note shown with the model answer. */
      explanation?: string;
    };

/** A note's quiz: an ordered list of questions, plus optional metadata. */
export interface Quiz {
  /** Questions in presentation order. */
  questions: QuizQuestion[];
}

/** True when `value` is a non-null object (not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate one raw question object, returning a typed question or `null` with a
 * reason pushed to `errors`. Keeps the whole quiz loadable even if one question
 * is malformed (that question is dropped).
 */
function parseQuestion(raw: unknown, index: number, errors: string[]): QuizQuestion | null {
  if (!isObject(raw)) {
    errors.push(`question ${index} is not an object`);
    return null;
  }
  const type = raw.type;
  const question = raw.question;
  if (typeof question !== 'string' || question.trim() === '') {
    errors.push(`question ${index} is missing a "question" string`);
    return null;
  }
  const scenario = typeof raw.scenario === 'string' ? raw.scenario : undefined;

  if (type === 'card') {
    if (typeof raw.answer !== 'string' || raw.answer.trim() === '') {
      errors.push(`card question ${index} is missing an "answer" string`);
      return null;
    }
    return {
      type: 'card',
      question,
      answer: raw.answer,
      ...(scenario !== undefined ? { scenario } : {}),
      ...(typeof raw.explanation === 'string' ? { explanation: raw.explanation } : {}),
    };
  }

  if (type === 'mcq' || type === 'scenario') {
    const options = raw.options;
    if (!Array.isArray(options) || options.length < 2 || !options.every((o) => typeof o === 'string')) {
      errors.push(`question ${index} needs an "options" array of at least two strings`);
      return null;
    }
    const answer = raw.answer;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      errors.push(`question ${index} has an "answer" index outside its options`);
      return null;
    }
    if (typeof raw.explanation !== 'string' || raw.explanation.trim() === '') {
      errors.push(`question ${index} is missing an "explanation" string`);
      return null;
    }
    return {
      type,
      question,
      options: options as string[],
      answer,
      explanation: raw.explanation,
      ...(scenario !== undefined ? { scenario } : {}),
      ...(typeof raw.misconception === 'string' ? { misconception: raw.misconception } : {}),
    };
  }

  errors.push(`question ${index} has an unknown type "${String(type)}"`);
  return null;
}

/**
 * Parse a raw quiz object (already JSON-parsed) into a validated {@link Quiz},
 * or `null` when it has no usable questions. Reasons are pushed to `errors`.
 */
export function parseQuiz(raw: unknown, errors: string[]): Quiz | null {
  if (!isObject(raw) || !Array.isArray(raw.questions)) {
    errors.push('quiz is missing a "questions" array');
    return null;
  }
  const questions: QuizQuestion[] = [];
  raw.questions.forEach((q, i) => {
    const parsed = parseQuestion(q, i, errors);
    if (parsed) questions.push(parsed);
  });
  if (questions.length === 0) {
    errors.push('quiz has no valid questions');
    return null;
  }
  return { questions };
}

/** Derive a note's quiz file path from its Markdown `filePath`. */
export function quizPathForNote(noteFilePath: string): string {
  return noteFilePath.replace(/\.md$/i, '.quiz.json');
}

/**
 * Read and validate the quiz sitting next to a note's Markdown file. Returns
 * `null` when there is no quiz file, or when the file is unreadable or invalid
 * (a warning is logged in the invalid case so the author can fix it).
 */
export function readQuizForNote(noteFilePath: string): Quiz | null {
  const quizPath = quizPathForNote(noteFilePath);
  let text: string;
  try {
    text = readFileSync(quizPath, 'utf8');
  } catch {
    return null; // no quiz file for this note; that is fine
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.warn(`[quiz] ${quizPath}: invalid JSON, skipping (${(err as Error).message})`);
    return null;
  }
  const errors: string[] = [];
  const quiz = parseQuiz(raw, errors);
  if (!quiz) {
    console.warn(`[quiz] ${quizPath}: ${errors.join('; ')}`);
    return null;
  }
  if (errors.length > 0) {
    // Some questions dropped but the quiz is still usable; surface why.
    console.warn(`[quiz] ${quizPath}: dropped ${errors.length} question(s): ${errors.join('; ')}`);
  }
  return quiz;
}
