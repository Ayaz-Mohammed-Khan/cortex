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
import { recordReview, quizLock } from '@/lib/review';
import { onStoreChange } from '@/lib/store';
import { readQueue, writeQueue, reviewUrl } from '@/lib/review-session';
import {
  startAttempt,
  getAttempt,
  updateAttempt,
  clearAttempt,
  isExpired,
} from '@/lib/attempt';
import { sampleQuizOrder, shuffle } from '@/lib/quiz-sample';
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

/**
 * How many questions a single GRADED attempt draws from a note's bank.
 *
 * Banks hold 11-17 questions. A graded sitting samples a stratified SUBSET
 * (spread across concepts and difficulty, see `@/lib/quiz-sample`) rather than
 * replaying the whole bank, which keeps the test focused and, crucially, makes
 * repeat attempts genuinely different instead of near-identical.
 *
 * The count is proportional, not fixed: about half the bank, bounded to
 * [GRADED_MIN, GRADED_MAX]. Half keeps it a clear minority of every bank (so
 * two attempts overlap little); the floor stops a small bank becoming a
 * trivially short test; the ceiling stops a big bank becoming a slog. For the
 * current banks this yields 6-8 questions, a ~5-8 minute sitting that still
 * clears the two-thirds pass bar fairly. Flashcards practice is unaffected and
 * always uses the whole bank.
 */
const GRADED_MIN = 6;
const GRADED_MAX = 8;

/** The sampled question count for a graded attempt over a bank of `bankSize`. */
function gradedCount(bankSize: number): number {
  const half = Math.round(bankSize / 2);
  return Math.max(GRADED_MIN, Math.min(GRADED_MAX, Math.min(half, bankSize)));
}

/**
 * Per-question time budget (seconds) for the GRADED quiz, by question kind.
 * Tuned for a data-science prep test: an MCQ is a quick recall-and-eliminate,
 * a scenario needs reading and judgement, a self-grade card sits between. The
 * quiz's total time is the sum over its questions, so timing scales to any
 * note's mix automatically. Flashcards mode is untimed (practice).
 */
const SECONDS_PER_TYPE: Record<QuizQuestion['type'], number> = {
  mcq: 45,
  scenario: 75,
  card: 60,
};

/** Total time budget (seconds) for a set of questions, from their mix. */
function questionsSeconds(questions: QuizQuestion[]): number {
  return questions.reduce((sum, q) => sum + (SECONDS_PER_TYPE[q.type] ?? 60), 0);
}

/** Format a seconds count as M:SS for the countdown display. */
function clock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Option letters for the multiple-choice markers. */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The check-mark icon used in the modal header. */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

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

/**
 * The questions for the CURRENT run, in presentation order. For a graded quiz
 * this is the sampled, shuffled subset of the bank the attempt locked in; for
 * flashcards it is the whole bank, reshuffled. All render/answer/score code
 * reads this, never `state.quiz.questions` directly, so the run operates purely
 * on the chosen set. Rebuilt every time a run starts or resumes.
 */
let activeQuestions: QuizQuestion[] = [];

/**
 * The run mode, chosen from the banner:
 *   - 'quiz'       graded recognition: options shown, auto-graded, a pass marks
 *                  the note complete and records a spaced-repetition review.
 *   - 'flashcards' untimed recall practice: options HIDDEN, every question runs
 *                  as a flip-and-grade card, nothing is marked or scheduled.
 * Same questions, same island — only the interaction and the side effects
 * differ, so recall and recognition live on one surface (no duplicate feature).
 */
type QuizMode = 'quiz' | 'flashcards';
let mode: QuizMode = 'quiz';

/**
 * Countdown timer (graded quiz only).
 *
 * `deadline` is a cache of the LIVE ATTEMPT's deadline (epoch ms; 0 when off),
 * read from the persisted attempt rather than invented on open. It is never
 * extended: a graded run always counts down to the moment the attempt started
 * plus its budget, so closing and reopening the dialog cannot buy more time.
 * The interval only drives the on-screen display; the deadline is the source
 * of truth and survives the modal being closed or the page reloaded.
 */
let deadline = 0;
let timerId: ReturnType<typeof setInterval> | null = null;

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

function headHtml(sub: string, showTimer = false): string {
  const title = mode === 'flashcards' ? 'Flashcards' : 'Test yourself';
  const timer = showTimer
    ? `<span class="quiz-timer" data-quiz-timer title="Time remaining" aria-label="Time remaining">${clock(secondsLeft())}</span>`
    : '';
  return (
    '<div class="quiz-head">' +
    `<span class="quiz-head-ic">${ICON}</span>` +
    `<div class="quiz-head-text"><b>${title}</b><span>${esc(sub)}</span></div>` +
    timer +
    '<button type="button" class="quiz-close" data-quiz-close>Esc <span aria-hidden="true">✕</span></button>' +
    '</div>'
  );
}

function progressHtml(): string {
  if (!state) return '';
  const total = activeQuestions.length;
  const pct = total > 0 ? Math.round((index / total) * 100) : 0;
  const pills = activeQuestions
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
  if (index >= activeQuestions.length) {
    renderScore(m);
    return;
  }
  const q = activeQuestions[index]!;
  const total = activeQuestions.length;
  const last = index === total - 1;

  const scenario =
    'scenario' in q && q.scenario
      ? `<p class="quiz-scenario"><b>Scenario.</b> ${fmt(q.scenario)}</p>`
      : '';
  const unitLabel = mode === 'flashcards' ? 'Card' : 'Q';
  const stem = `<p class="quiz-q"><span class="quiz-qnum">${unitLabel}${index + 1}.</span>${fmt(q.question)}</p>`;

  // Flashcards mode: EVERY question is a flip-and-grade recall card. For a
  // multiple-choice question the options are hidden (recall, not recognition)
  // and its correct option becomes the model answer.
  const asCard = mode === 'flashcards' || q.type === 'card';

  let bodyInner = scenario + stem;
  let footInner = '';

  if (asCard) {
    const answerText =
      q.type === 'card' ? q.answer : (q.options[q.answer] ?? '');
    const note =
      q.type === 'card'
        ? q.explanation
        : [q.explanation, q.misconception ? `Watch out: ${q.misconception}` : '']
            .filter(Boolean)
            .join(' ');
    bodyInner +=
      (mode === 'flashcards' ? '<p class="fc-hint">Recall the answer, then flip.</p>' : '') +
      '<div class="quiz-card-answer" data-quiz-card-answer hidden>' +
      `<b>${mode === 'flashcards' ? 'Answer.' : 'Model answer.'}</b> ${fmt(answerText)}` +
      (note ? `<span class="quiz-card-note">${fmt(note)}</span>` : '') +
      '</div>';
    footInner =
      `<span class="quiz-count">${index + 1} / ${total}</span>` +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-quiz-flip>Flip card</button>' +
      '<span class="quiz-grade" data-quiz-grade hidden>' +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-quiz-grade-val="0">Missed it</button>' +
      `<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-grade-val="1">Got it${last ? '' : ' →'}</button>` +
      '</span>';
  } else {
    // Graded quiz: options only. No explanation, no right/wrong reveal mid-test
    // (that is for flashcards practice and the end-of-quiz review). Picking an
    // option locks it and advances immediately — test conditions.
    const opts = q.options
      .map(
        (o, k) =>
          `<button type="button" class="quiz-opt" data-quiz-opt="${k}">` +
          `<span class="quiz-mk">${LETTERS[k]}</span><span>${fmt(o)}</span></button>`,
      )
      .join('');
    bodyInner += `<div class="quiz-opts">${opts}</div>`;
    footInner = `<span class="quiz-count">${index + 1} / ${total}</span>`;
  }

  const headSub =
    mode === 'flashcards'
      ? `Flashcards · card ${index + 1} of ${total}`
      : `Question ${index + 1} of ${total}`;

  m.innerHTML =
    headHtml(headSub, mode === 'quiz') +
    `<div class="quiz-prog-wrap">${progressHtml()}</div>` +
    `<div class="quiz-body">${bodyInner}</div>` +
    `<div class="quiz-foot">${footInner}</div>`;
}

/** Render the final score card. */
function renderScore(m: HTMLElement): void {
  if (!state) return;
  stopTimer(); // the clock never runs on the results screen
  // Reaching the results resolves any live graded attempt. Clearing it here
  // (idempotent with the timeout path) means a finished quiz leaves no attempt
  // to resume, so reopening the dialog starts a new run under the lock rules.
  if (mode === 'quiz') clearAttempt(state.route);
  const total = activeQuestions.length;
  const correct = outcomes.filter(Boolean).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Flashcards mode: practice only. No pass/fail, no completion, no review
  // scheduling — just a recall tally and the option to go again.
  if (mode === 'flashcards') {
    const missed = total - correct;
    const fcMsg =
      missed === 0
        ? 'Every card recalled from memory. Nicely done.'
        : `${correct} recalled, ${missed} to firm up. Run it again while it is fresh.`;
    m.innerHTML =
      headHtml('Flashcards complete') +
      '<div class="quiz-body"><div class="quiz-score">' +
      `<div class="quiz-ring" style="--p:${pct}"><span>${correct}/${total}</span></div>` +
      `<div class="quiz-score-pct">${pct}%</div>` +
      `<div class="quiz-score-msg">${esc(fcMsg)}</div>` +
      '</div></div>' +
      '<div class="quiz-foot">' +
      '<span class="quiz-count">Practice only, not graded</span>' +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-quiz-retry>Shuffle &amp; restart</button>' +
      '<button type="button" class="quiz-btn quiz-btn-primary" data-quiz-close>Done</button>' +
      '</div>';
    return;
  }

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

  // On a FAIL there is no instant retry: the note is scheduled for review and
  // the quiz stays locked until that review is due (the banner enforces this).
  // So the message tells the reader when they can try again, and points them to
  // flashcards for practice in the meantime.
  const msg = passed
    ? `Strong recall. The note is marked complete. ${nextMsg}`
    : `You scored ${correct} of ${total} (need ${passMark}). This topic is scheduled for review, so your next attempt opens ${formatDue(nextItem.due)}. Use Flashcards to practise until then.`;

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
      : 'Last one, nice work'
    : passed
      ? 'Quiz complete'
      : 'Locked until review';

  m.innerHTML =
    headHtml(review ? 'Review' : 'Results') +
    '<div class="quiz-body"><div class="quiz-score">' +
    `<div class="quiz-ring" style="--p:${pct}"><span>${correct}/${total}</span></div>` +
    `<div class="quiz-score-pct">${pct}%</div>` +
    `<div class="quiz-score-msg">${esc(msg)}</div>` +
    '</div></div>' +
    '<div class="quiz-foot">' +
    `<span class="quiz-count">${esc(countLabel)}</span>` +
    primary +
    '</div>';
}

/** Seconds remaining on the current quiz clock (0 when no timer is running). */
function secondsLeft(): number {
  return deadline > 0 ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : 0;
}

/** Update the on-screen countdown; when it hits zero, auto-submit the quiz. */
function tick(): void {
  const el = modal()?.querySelector<HTMLElement>('[data-quiz-timer]');
  const left = secondsLeft();
  if (el) {
    el.textContent = clock(left);
    el.classList.toggle('is-low', left <= 15); // visual urgency near the end
  }
  if (left <= 0) timeUp();
}

/**
 * Begin ticking the on-screen clock against the already-fixed `deadline`. The
 * interval is display only; it does not own the deadline, so starting it does
 * not reset or extend the countdown. Called whenever a graded run is shown
 * (fresh start, or resuming a live attempt after the dialog was reopened).
 */
function runTimer(): void {
  if (timerId) clearInterval(timerId);
  timerId = deadline > 0 ? setInterval(tick, 1000) : null;
}

/**
 * Stop the on-screen ticking WITHOUT touching the deadline. Used when the
 * dialog closes mid-attempt: the display stops, but the attempt and its
 * deadline live on in the store, so the clock is still running conceptually and
 * reopening resumes against the same deadline (or resolves as a timeout).
 */
function pauseTimerDisplay(): void {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

/** Stop the clock and forget the local deadline cache (attempt has resolved). */
function stopTimer(): void {
  pauseTimerDisplay();
  deadline = 0;
}

/** Persist the running outcomes and position onto the live attempt. */
function persistAttempt(): void {
  if (!state || mode !== 'quiz' || deadline <= 0) return;
  updateAttempt(state.route, (a) => ({
    ...a,
    answers: activeQuestions.map((_, k) => outcomes[k] ?? null),
    index,
  }));
}

/**
 * Time ran out: resolve the attempt as a timeout and jump to the graded
 * results. Any unanswered questions stay wrong. The persisted attempt is
 * cleared so it cannot be resumed, and the results screen records the review.
 */
function timeUp(): void {
  stopTimer();
  if (!state) return;
  clearAttempt(state.route);
  index = activeQuestions.length;
  render();
}

/** Fisher–Yates shuffle in place (used to vary flashcard order). */
function shuffleQuestions(): void {
  if (!state) return;
  // Build the run's questions from a SHUFFLED COPY of the bank, never reorder
  // the shared bank in place (that would permanently scramble it for every
  // later run and for the recall sampler reading the same data).
  activeQuestions = shuffle(state.quiz.questions, Math.random);
}

/**
 * Resolve the bank positions a GRADED run should use.
 *
 *   - A resumed attempt WITH a stored order replays it, dropping any index that
 *     no longer points into the bank (in case the note was re-authored since).
 *   - A resumed attempt WITHOUT an order is one started before sampling existed
 *     and left in flight across the deploy. Its `answers` cover the first
 *     `answerCount` questions of the full bank in authored order, so rebuild
 *     exactly that identity run; this keeps the stored answers and position
 *     aligned instead of swapping in a fresh, mismatched sample.
 *   - No attempt at all: sample a fresh stratified order.
 *
 * Always returns at least one index when the bank is non-empty, so a run is
 * never empty.
 */
function resolveOrder(
  stored: number[] | undefined,
  answerCount: number | undefined,
  bankLength: number,
): number[] {
  if (!state) return [];
  if (stored && stored.length > 0) {
    const valid = stored.filter((i) => Number.isInteger(i) && i >= 0 && i < bankLength);
    if (valid.length > 0) return valid;
  }
  // Legacy in-flight attempt (answers but no order): identity over the bank,
  // trimmed to the recorded answer count so answers/index still line up.
  if (stored === undefined && answerCount !== undefined && answerCount > 0) {
    const n = Math.min(answerCount, bankLength);
    return Array.from({ length: n }, (_, i) => i);
  }
  return sampleQuizOrder(state.quiz, gradedCount(state.quiz.questions.length), Math.random);
}

/**
 * Start (or resume) a run in the given mode and open the dialog.
 *
 * Flashcards is untimed practice: it always starts fresh and shuffles for
 * variety. The graded quiz is governed by a persisted attempt (the strict
 * timer):
 *
 *   - If a live attempt exists for this note, RESUME it: restore the position
 *     and answers, and run against its original deadline. If that deadline has
 *     already passed (the reader closed the quiz and came back too late), the
 *     attempt resolves immediately as a timeout rather than handing back time.
 *   - Otherwise START a fresh attempt, fixing the deadline now.
 */
function open(runMode: QuizMode): void {
  if (!state) return;
  mode = runMode;

  if (mode === 'flashcards') {
    index = 0;
    outcomes = [];
    stopTimer();
    shuffleQuestions(); // fresh order each practice run
    render();
    if (!dialog()?.open) dialog()?.showModal();
    return;
  }

  // Graded quiz: resume a live attempt, or begin a new one.
  //
  // A fresh attempt samples a stratified subset of the bank and locks that
  // order in; a resumed attempt replays its stored order so the SAME questions
  // return against the SAME deadline. The timer budget is computed from the
  // sampled subset, not the whole bank, so it matches what the reader faces.
  const bank = state.quiz.questions;
  const existing = getAttempt(state.route);
  const order = resolveOrder(existing?.order, existing?.answers.length, bank.length);
  activeQuestions = order.map((i) => bank[i]!);

  const attempt =
    existing ?? startAttempt(state.route, order, questionsSeconds(activeQuestions));
  deadline = attempt.deadline;
  outcomes = attempt.answers.map((a) => (a === null ? undefined : a)) as boolean[];
  index = Math.min(Math.max(0, attempt.index), activeQuestions.length);

  // The deadline is authoritative: if it has already passed, this attempt is
  // over the moment it is reopened. Resolve as a timeout instead of showing a
  // question with a clock that is already at zero.
  if (isExpired(attempt)) {
    if (!dialog()?.open) dialog()?.showModal();
    timeUp();
    return;
  }

  runTimer();
  render();
  if (!dialog()?.open) dialog()?.showModal();
}

/** Answer an MCQ/scenario option: lock in, grade, reveal the explanation. */
function answerOption(optBtn: HTMLElement): void {
  const m = modal();
  if (!state || !m) return;
  const q = activeQuestions[index]!;
  if (q.type === 'card') return;
  if (outcomes[index] !== undefined) return; // already answered

  // A live attempt may have expired while this question sat on screen; honour
  // the deadline before accepting the answer.
  if (mode === 'quiz' && deadline > 0 && secondsLeft() <= 0) {
    timeUp();
    return;
  }

  const picked = Number(optBtn.dataset.quizOpt);
  outcomes[index] = picked === q.answer;
  persistAttempt();

  // Test conditions: briefly mark the chosen option as "picked" (no correct/
  // wrong colour, no explanation), then advance. The short delay gives tactile
  // feedback that the click registered without revealing the answer.
  m.querySelectorAll<HTMLElement>('[data-quiz-opt]').forEach((btn) => {
    (btn as HTMLButtonElement).disabled = true;
    if (Number(btn.dataset.quizOpt) === picked) btn.classList.add('is-picked');
  });
  window.setTimeout(() => {
    index += 1;
    persistAttempt();
    render();
  }, 180);
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
  // In graded mode, a self-grade card is still under the clock.
  if (mode === 'quiz' && deadline > 0 && secondsLeft() <= 0) {
    timeUp();
    return;
  }
  outcomes[index] = got;
  index += 1;
  persistAttempt();
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

  const startBtn = target.closest<HTMLElement>('[data-quiz-start]');
  if (startBtn) {
    const requested = startBtn.dataset.quizStart === 'flashcards' ? 'flashcards' : 'quiz';
    // Flashcards is always available. The graded quiz is blocked while locked
    // (recently failed, cooling down until its review is due).
    if (requested === 'quiz' && state && quizLock(state.route).locked) return;
    open(requested);
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
    // Flashcards "Try again" re-shuffles for fresh practice; the quiz keeps order.
    if (mode === 'flashcards') shuffleQuestions();
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

/**
 * The dialog closed (Esc, backdrop, close button, or Done). Stop the on-screen
 * ticking but DO NOT clear the attempt or its deadline: a graded run left in
 * progress keeps counting down in the store, so reopening resumes the same
 * attempt against the same deadline (and resolves as a timeout if it has since
 * passed). This is what makes the timer strict rather than pausable.
 */
function onDialogClose(): void {
  pauseTimerDisplay();
  // Reflect any lock change (e.g. a just-finished fail) back onto the banner.
  syncBanner();
}

/**
 * Reflect the quiz lock onto the banner's "Quiz me" button. When the graded
 * quiz is cooling down after a fail, the button is disabled and relabelled, and
 * a hint shows when the next attempt opens. Flashcards stay available. Runs on
 * load and whenever the store changes (e.g. a review becomes due).
 */
function syncBanner(): void {
  if (!state) return;
  const cta = document.querySelector<HTMLButtonElement>('[data-quiz-cta]');
  if (!cta) return;
  const label = cta.querySelector<HTMLElement>('[data-quiz-cta-label]');
  const arrow = cta.querySelector<HTMLElement>('[data-quiz-cta-arrow]');
  const hint = document.querySelector<HTMLElement>('[data-quiz-lock-hint]');

  const { locked, unlockAt } = quizLock(state.route);
  cta.disabled = locked;

  // A live, unexpired attempt means the strict clock is still running in the
  // background. Surface that so the reader knows reopening resumes it rather
  // than starting fresh. (An expired attempt is left to resolve as a timeout on
  // the next open, so it reads as a normal start here.)
  const live = !locked ? getAttempt(state.route) : undefined;
  const resuming = !!live && !isExpired(live);

  if (label) label.textContent = locked ? 'Locked' : resuming ? 'Resume quiz' : 'Quiz me';
  if (arrow) arrow.hidden = locked;
  if (hint) {
    if (locked) {
      const when = new Date(unlockAt);
      hint.hidden = false;
      hint.textContent = `Quiz locked after a miss. Your next attempt opens ${formatDue(unlockAt)} (${when.toLocaleString()}). Keep practising with Flashcards.`;
    } else {
      // No resume hint: the "Resume quiz" button label already conveys that a
      // run is in progress, and a running-clock countdown on the banner reads
      // as a glitch rather than a feature.
      hint.hidden = true;
      hint.textContent = '';
    }
  }
}

function bind(): void {
  state = loadState();
  const dlg = dialog();
  dlg?.addEventListener('click', onDialogClick);
  dlg?.addEventListener('close', onDialogClose);
  syncBanner();
  // Review mode: when a note is opened via the "Review due today" flow it
  // carries `?review=1`, so start its quiz immediately rather than making the
  // reader hunt for the Start button.
  if (state && new URLSearchParams(window.location.search).get('review') === '1') {
    open('quiz'); // a review session runs the graded quiz
  }
}

document.addEventListener('click', onClick);
document.addEventListener('astro:page-load', bind);
// A fail (or a review becoming due) changes the lock; refresh the banner live.
onStoreChange(syncBanner);
bind();

export {};
