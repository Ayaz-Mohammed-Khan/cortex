/**
 * Quiz island (note pages).
 *
 * Reads the quiz serialized by `NoteContent.astro` (`<script data-quiz>`) and
 * runs a guided, one-question-at-a-time stepper inside a native `<dialog>`,
 * opened from the "Test yourself" banner's Start button. The dialog gives the
 * quiz the full screen with a dimmed backdrop, so the reader focuses on one
 * question at a time; it reuses the accessible modal behaviour of a native
 * `<dialog>` (Escape closes, backdrop click closes, focus is trapped).
 *
 * Three question kinds are supported (see `@/lib/quiz`): `mcq` and `scenario`
 * are auto-graded multiple choice; `card` is a self-grade recall card the
 * reader rates. After the last question a score card is shown. Passing the quiz
 * (two thirds correct) marks the note complete through the shared progress
 * store, so the roadmap badge and meter update too.
 *
 * Island pattern: bound once on `document`, re-synced on `astro:page-load` so it
 * survives View Transitions. No dependencies beyond the progress store.
 */
import { markDone } from '@/lib/progress';
import { recordReview } from '@/lib/review';
import { readQueue, writeQueue, reviewUrl } from '@/lib/review-session';
import type { Quiz, QuizQuestion } from '@/lib/quiz';

/** Is the current page open as part of a review session (`?review=1`)? */
function inReviewMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('review') === '1';
  } catch {
    return false;
  }
}

/** Fraction correct (of auto-graded questions) needed to count as a pass. */
const PASS_RATIO = 2 / 3;

/** Option letters for the multiple-choice markers. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The check-mark icon used in the modal header. */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

/** The small tick drawn inside an option marker / score, as inline SVG. */
const TICK =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6 l2.5 2.5 L10 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Parsed quiz + the note route it belongs to, read from the page once. */
interface QuizState {
  quiz: Quiz;
  route: string;
}

let state: QuizState | null = null;
/** Index of the question being shown. */
let index = 0;
/** Per-question outcome: true = correct (or self-graded "got it"). */
let outcomes: boolean[] = [];

function dialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('[data-quiz-dialog]');
}
function modal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-quiz-modal]');
}

/** Read the serialized quiz for this page, or null when there is none. */
function loadState(): QuizState | null {
  const dataEl = document.querySelector<HTMLScriptElement>('[data-quiz]');
  const routeEl = document.querySelector<HTMLScriptElement>('[data-quiz-route]');
  if (!dataEl || !routeEl) return null;
  try {
    const quiz = JSON.parse(dataEl.textContent || 'null') as Quiz | null;
    const route = JSON.parse(routeEl.textContent || 'null') as string | null;
    if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length === 0 || !route) {
      return null;
    }
    return { quiz, route };
  } catch {
    return null;
  }
}

/** Friendly relative phrasing for a due timestamp ("tomorrow", "in 6 days"). */
function formatDue(due: number): string {
  const days = Math.round((due - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  if (days < 14) return 'in about a week';
  if (days < 45) return `in about ${Math.round(days / 7)} weeks`;
  return `in about ${Math.round(days / 30)} months`;
}

/** Escape a string for safe insertion as HTML text. */
function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Allow a small, safe subset of inline formatting authors use in questions:
 * `code` spans (backticks) become <code>. Everything else is escaped first, so
 * no raw HTML from the quiz file can execute. Math is left as-is for KaTeX-free
 * plain rendering (quizzes avoid heavy math in the stem by convention).
 */
function fmt(s: string): string {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function headHtml(sub: string): string {
  return (
    '<div class="quiz-head">' +
    `<span class="quiz-head-ic">${ICON}</span>` +
    `<div class="quiz-head-text"><b>Test yourself</b><span>${esc(sub)}</span></div>` +
    '<button type="button" class="quiz-close" data-quiz-close>Esc <span aria-hidden="true">✕</span></button>' +
    '</div>'
  );
}

function progressHtml(): string {
  if (!state) return '';
  const total = state.quiz.questions.length;
  const pct = Math.round((index / total) * 100);
  const pills = state.quiz.questions
    .map((_, k) => {
      const cls = k < index ? (outcomes[k] ? 'ok' : 'no') : '';
      return `<span class="quiz-pill ${cls}"></span>`;
    })
    .join('');
  return (
    '<div class="quiz-prog-row">' +
    `<div class="quiz-prog"><div style="width:${pct}%"></div></div>` +
    `<div class="quiz-pills">${pills}</div>` +
    '</div>'
  );
}

/** Render the current question (or the score card when past the end). */
function render(): void {
  const m = modal();
  if (!state || !m) return;
  if (index >= state.quiz.questions.length) {
    renderScore(m);
    return;
  }
  const q = state.quiz.questions[index]!;
  const total = state.quiz.questions.length;
  const last = index === total - 1;

  const scenario =
    'scenario' in q && q.scenario
      ? `<p class="quiz-scenario"><b>Scenario.</b> ${fmt(q.scenario)}</p>`
      : '';
  const stem = `<p class="quiz-q"><span class="quiz-qnum">Q${index + 1}.</span>${fmt(q.question)}</p>`;

  let bodyInner = scenario + stem;
  let footInner = '';

  if (q.type === 'card') {
    bodyInner +=
      '<div class="quiz-card-answer" data-quiz-card-answer hidden>' +
      `<b>Model answer.</b> ${fmt(q.answer)}` +
      (q.explanation ? `<span class="quiz-card-note">${fmt(q.explanation)}</span>` : '') +
      '</div>';
    footInner =
      `<span class="quiz-count">${index + 1} / ${total}</span>` +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-quiz-flip>Reveal answer</button>' +
      '<span class="quiz-grade" data-quiz-grade hidden>' +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-quiz-grade-val="0">Missed it</button>' +
      `<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-grade-val="1">Got it${last ? '' : ' →'}</button>` +
      '</span>';
  } else {
    const opts = q.options
      .map(
        (o, k) =>
          `<button type="button" class="quiz-opt" data-quiz-opt="${k}">` +
          `<span class="quiz-mk">${LETTERS[k]}</span><span>${fmt(o)}</span></button>`,
      )
      .join('');
    bodyInner +=
      `<div class="quiz-opts">${opts}</div>` +
      '<div class="quiz-explain" data-quiz-explain>' +
      `<b>Why.</b> ${fmt(q.explanation)}` +
      (q.misconception ? `<span class="quiz-mis">Watch out: ${fmt(q.misconception)}</span>` : '') +
      '</div>';
    footInner =
      `<span class="quiz-count">${index + 1} / ${total}</span>` +
      `<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-next disabled>${last ? 'See results' : 'Next'} →</button>`;
  }

  m.innerHTML =
    headHtml(`Question ${index + 1} of ${total}`) +
    `<div class="quiz-prog-wrap">${progressHtml()}</div>` +
    `<div class="quiz-body">${bodyInner}</div>` +
    `<div class="quiz-foot">${footInner}</div>`;
}

/** Render the final score card. */
function renderScore(m: HTMLElement): void {
  if (!state) return;
  const total = state.quiz.questions.length;
  const correct = outcomes.filter(Boolean).length;
  const pct = Math.round((correct / total) * 100);
  const passMark = Math.ceil(total * PASS_RATIO);
  const passed = correct >= passMark;

  // A pass marks the note complete, feeding the shared progress store.
  if (passed) markDone(state.route);

  // Record the session for spaced repetition and schedule the next review.
  // Enrolls the note on its first completion; re-grades it on every revisit.
  const nextItem = recordReview(state.route, correct, total, passed);
  const dueDate = new Date(nextItem.due);
  const nextMsg = passed
    ? `Next review ${formatDue(nextItem.due)} (${dueDate.toLocaleDateString()}).`
    : 'This topic will come back for review shortly.';

  const msg = passed
    ? `Strong recall. The note is marked complete. ${nextMsg}`
    : `You need ${passMark} of ${total} to complete the note. Reread the misses and try again.`;

  // In a review session, the primary action continues to the next due note
  // (or finishes the session) rather than just closing the dialog.
  const review = inReviewMode();
  const remaining = review ? readQueue() : [];
  const primary = review
    ? remaining.length > 0
      ? '<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-review-next>Next review →</button>'
      : '<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-review-done>Finish review ✓</button>'
    : '<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-close>Done</button>';
  const countLabel = review
    ? remaining.length > 0
      ? `${remaining.length} more to review`
      : 'Last one — nice work'
    : 'Quiz complete';

  m.innerHTML =
    headHtml(review ? 'Review' : 'Results') +
    '<div class="quiz-body"><div class="quiz-score">' +
    `<div class="quiz-ring" style="--p:${pct}"><span>${correct}/${total}</span></div>` +
    `<div class="quiz-score-pct">${pct}%</div>` +
    `<div class="quiz-score-msg">${esc(msg)}</div>` +
    '</div></div>' +
    '<div class="quiz-foot">' +
    `<span class="quiz-count">${esc(countLabel)}</span>` +
    '<button type="button" class="quiz-btn quiz-btn-ghost" data-quiz-retry>Try again</button>' +
    primary +
    '</div>';
}

/** Start (or restart) the quiz and open the dialog. */
function open(): void {
  if (!state) return;
  index = 0;
  outcomes = [];
  render();
  dialog()?.showModal();
}

/** Answer an MCQ/scenario option: lock in, grade, reveal the explanation. */
function answerOption(optBtn: HTMLElement): void {
  const m = modal();
  if (!state || !m) return;
  const q = state.quiz.questions[index]!;
  if (q.type === 'card') return;
  if (outcomes[index] !== undefined) return; // already answered

  const picked = Number(optBtn.dataset.quizOpt);
  outcomes[index] = picked === q.answer;

  m.querySelectorAll<HTMLElement>('[data-quiz-opt]').forEach((btn) => {
    (btn as HTMLButtonElement).disabled = true;
    const k = Number(btn.dataset.quizOpt);
    if (k === q.answer) btn.classList.add('is-correct');
    else if (k === picked) btn.classList.add('is-wrong');
  });
  m.querySelector('[data-quiz-explain]')?.classList.add('show');
  const next = m.querySelector<HTMLButtonElement>('[data-quiz-next]');
  if (next) next.disabled = false;
}

/** Flip a self-grade card to reveal the model answer and the grade buttons. */
function flipCard(): void {
  const m = modal();
  if (!m) return;
  m.querySelector('[data-quiz-card-answer]')?.removeAttribute('hidden');
  m.querySelector('[data-quiz-flip]')?.remove();
  m.querySelector('[data-quiz-grade]')?.removeAttribute('hidden');
}

/** Record a self-grade outcome and advance. */
function gradeCard(got: boolean): void {
  outcomes[index] = got;
  index += 1;
  render();
}

/** Advance to the next question. */
function next(): void {
  index += 1;
  render();
}

/** Delegated click handling for every quiz control. */
function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target) return;

  if (target.closest('[data-quiz-start]')) {
    open();
    return;
  }
  if (target.closest('[data-quiz-close]')) {
    dialog()?.close();
    return;
  }
  const opt = target.closest<HTMLElement>('[data-quiz-opt]');
  if (opt) {
    answerOption(opt);
    return;
  }
  if (target.closest('[data-quiz-next]')) {
    next();
    return;
  }
  if (target.closest('[data-quiz-flip]')) {
    flipCard();
    return;
  }
  const grade = target.closest<HTMLElement>('[data-quiz-grade-val]');
  if (grade) {
    gradeCard(grade.dataset.quizGradeVal === '1');
    return;
  }
  if (target.closest('[data-quiz-retry]')) {
    index = 0;
    outcomes = [];
    render();
    return;
  }
  if (target.closest('[data-quiz-review-next]')) {
    advanceReview();
    return;
  }
  if (target.closest('[data-quiz-review-done]')) {
    finishReview();
    return;
  }
}

/** Pop the next due route off the queue and navigate to its quiz. */
function advanceReview(): void {
  const queue = readQueue();
  const next = queue.shift();
  writeQueue(queue);
  if (next) window.location.href = reviewUrl(next);
  else finishReview();
}

/** End the review session: clear any queue and return to the roadmap. */
function finishReview(): void {
  writeQueue([]);
  window.location.href = '/';
}

/** Close on a backdrop click (native dialog reports target === dialog). */
function onDialogClick(event: MouseEvent): void {
  const dlg = dialog();
  if (dlg && event.target === dlg) dlg.close();
}

function bind(): void {
  state = loadState();
  const dlg = dialog();
  dlg?.addEventListener('click', onDialogClick);
  // Review mode: when a note is opened via the "Review due today" flow it
  // carries `?review=1`, so start its quiz immediately rather than making the
  // reader hunt for the Start button.
  if (state && new URLSearchParams(window.location.search).get('review') === '1') {
    open();
  }
}

document.addEventListener('click', onClick);
document.addEventListener('astro:page-load', bind);
bind();

export {};
