/**
 * Cumulative-recall island (roadmap landing page).
 *
 * Where the "Review due today" card (see `review-due.ts`) resurfaces single
 * notes you got shaky on, this card runs the complementary habit: at the end of
 * a study WINDOW it pulls a small, interleaved set drawn from ALL the topics you
 * covered in that window and asks you to recall across them at once. Weekly
 * cycles keep the last few days coherent; a rolling monthly sweep knits the
 * whole last month back together. The scheduling is decided entirely by the
 * pure, read-only module `@/lib/recall`; the stratified cross-note question set
 * is built by `@/lib/recall-sample`. This island is only the surface.
 *
 * It owns the card rendered by `index.astro` (`[data-recall-card]`):
 *
 *   - hides the card entirely when nothing (weekly or monthly) is pending,
 *   - otherwise shows a weekly section (topic count + question estimate +
 *     "Start" button) and/or a monthly section, and
 *   - when two or more weeklies have stacked up (`isLagging()`) it flips the
 *     card into an amber PRIORITY state with a "you're N weeks behind" nudge.
 *
 * Starting a recall opens an UNTIMED cross-note stepper in a native `<dialog>`
 * (`[data-recall-dialog]`), reusing the GLOBAL `.quiz-*` stepper classes and the
 * exact one-question-at-a-time pick-and-advance UX from `quiz.ts` — but with no
 * timer, no deadline, and NO attempt/review/progress persistence. Each question
 * carries a "From: Topic" source label so the reader knows which note it tests.
 * The session ends with a score card plus a per-topic breakdown; completing a
 * cycle marks ONLY that recall cycle done (weekly `cycleEnd` appended to
 * `recallWeeklyDone`, or `recallMonthlyDone` timestamped) — recall never touches
 * progress, spaced-repetition review, or graded attempts.
 *
 * Island pattern: delegated click handling bound once on `document`, re-synced
 * on `astro:page-load` so it survives View Transitions, kept live via the
 * store's change events (`onRecallChange`). All DOM/storage access is
 * SSR-guarded by the `typeof document !== 'undefined'` block at the foot.
 */

import {
  pendingWeeklies,
  isLagging,
  pendingMonthly,
  onRecallChange,
  type WeeklyCycle,
} from '@/lib/recall';
import {
  sampleRecall,
  WEEKLY_SAMPLE,
  MONTHLY_SAMPLE,
  type SampledQuestion,
  type SampleOptions,
} from '@/lib/recall-sample';
import { update } from '@/lib/store';
import type { Quiz } from '@/lib/quiz';

const WRAP = '[data-recall-card]';

/** Route -> Quiz, read once from the page's emitted `data-recall-banks` blob. */
let banks = new Map<string, Quiz>();
/** Route -> display label, read from the shared review-labels map. */
let labels: Record<string, string> = {};

/** Option letters for the multiple-choice markers (mirrors `quiz.ts`). */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** The check-mark icon used in the modal header (mirrors `quiz.ts`). */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

/** Read the serialized `route -> Quiz` map, or an empty map on any failure. */
function readBanks(): Map<string, Quiz> {
  const el = document.querySelector<HTMLScriptElement>('[data-recall-banks]');
  if (!el) return new Map();
  try {
    const parsed = JSON.parse(el.textContent || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return new Map();
    const out = new Map<string, Quiz>();
    for (const [route, quiz] of Object.entries(parsed as Record<string, Quiz>)) {
      if (quiz && Array.isArray(quiz.questions) && quiz.questions.length > 0) {
        out.set(route, quiz);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

/** Read the shared route -> label map emitted for the review card. */
function readLabels(): Record<string, string> {
  const el = document.querySelector<HTMLScriptElement>('[data-rm-review-labels]');
  if (!el) return {};
  try {
    const parsed = JSON.parse(el.textContent || '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A short, human label for a route (falls back to the last path segment). */
function labelFor(route: string): string {
  if (labels[route]) return labels[route]!;
  const seg = route.split('/').filter(Boolean).pop() ?? route;
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Escape text for safe insertion into innerHTML. */
function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Allow a small, safe subset of inline formatting authors use in questions:
 * `code` spans (backticks) become <code>. Everything else is escaped first, so
 * no raw HTML from the quiz file can execute. (Mirrors `quiz.ts`'s `fmt`.)
 */
function fmt(s: string): string {
  return escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Estimate how many questions a session over `routes` will hold, without
 * committing to a particular random draw: the sampler caps at `opts.max` and
 * never pads, so the count is `min(max, sum of per-topic picks)`, where a topic
 * contributes up to `perTopic` but no more than it actually has. Only routes
 * that have a quiz in the banks map count. Used for the card's "~N questions".
 */
function estimateCount(routes: string[], opts: SampleOptions): number {
  let total = 0;
  for (const route of routes) {
    const quiz = banks.get(route);
    if (!quiz) continue;
    total += Math.min(opts.perTopic, quiz.questions.length);
  }
  return Math.min(opts.max, total);
}

/** How many of `routes` actually have a quiz in the banks (contribute topics). */
function topicsWithQuiz(routes: string[]): number {
  let n = 0;
  for (const route of routes) if (banks.has(route)) n += 1;
  return n;
}

// ----------------------------------------------------------------------------
// Card sync
// ----------------------------------------------------------------------------

/** Fill the card from the current pending state, or hide it when nothing is due. */
function sync(): void {
  const wrap = document.querySelector<HTMLElement>(WRAP);
  if (!wrap) return;

  const weeklies = pendingWeeklies();
  const monthly = pendingMonthly();

  // The oldest pending weekly is the one we surface first; keep only cycles
  // whose topics actually have a quiz to recall from.
  const oldestWeekly = weeklies.find((c) => topicsWithQuiz(c.routes) > 0) ?? null;
  const monthlyRoutes = monthly ? monthly.routes.filter((r) => banks.has(r)) : [];
  const hasMonthly = monthlyRoutes.length > 0;

  if (!oldestWeekly && !hasMonthly) {
    wrap.hidden = true;
    wrap.classList.remove('recall-lagging');
    wrap.removeAttribute('data-recall-lagging');
    return;
  }
  wrap.hidden = false;

  // --- Lagging / priority state (two or more weeklies pending at once). ------
  const lagging = isLagging();
  const laggingMsg = wrap.querySelector<HTMLElement>('[data-recall-lagging-msg]');
  if (lagging) {
    wrap.classList.add('recall-lagging');
    wrap.setAttribute('data-recall-lagging', '');
    if (laggingMsg) {
      const n = weeklies.length;
      laggingMsg.hidden = false;
      laggingMsg.textContent = `Priority: you're ${n} week${n === 1 ? '' : 's'} behind on recall. Clear the oldest first.`;
    }
  } else {
    wrap.classList.remove('recall-lagging');
    wrap.removeAttribute('data-recall-lagging');
    if (laggingMsg) {
      laggingMsg.hidden = true;
      laggingMsg.textContent = '';
    }
  }

  // --- Weekly section --------------------------------------------------------
  const weeklySection = wrap.querySelector<HTMLElement>('[data-recall-weekly]');
  if (weeklySection) {
    if (oldestWeekly) {
      weeklySection.hidden = false;
      const topics = topicsWithQuiz(oldestWeekly.routes);
      const est = estimateCount(oldestWeekly.routes, WEEKLY_SAMPLE);
      const topicsEl = weeklySection.querySelector<HTMLElement>('[data-recall-weekly-topics]');
      const estEl = weeklySection.querySelector<HTMLElement>('[data-recall-weekly-est]');
      const startEl = weeklySection.querySelector<HTMLButtonElement>('[data-recall-weekly-start]');
      if (topicsEl) topicsEl.textContent = `${topics} topic${topics === 1 ? '' : 's'}`;
      if (estEl) estEl.textContent = `~${est} question${est === 1 ? '' : 's'}`;
      // Pin the exact cycle being offered onto the button so a store change
      // between render and click cannot start the wrong cycle.
      if (startEl) startEl.dataset.cycleEnd = String(oldestWeekly.cycleEnd);
    } else {
      weeklySection.hidden = true;
    }
  }

  // --- Monthly section -------------------------------------------------------
  const monthlySection = wrap.querySelector<HTMLElement>('[data-recall-monthly]');
  if (monthlySection) {
    if (hasMonthly) {
      monthlySection.hidden = false;
      const topics = monthlyRoutes.length;
      const est = estimateCount(monthlyRoutes, MONTHLY_SAMPLE);
      const topicsEl = monthlySection.querySelector<HTMLElement>('[data-recall-monthly-topics]');
      const estEl = monthlySection.querySelector<HTMLElement>('[data-recall-monthly-est]');
      if (topicsEl) topicsEl.textContent = `${topics} topic${topics === 1 ? '' : 's'}`;
      if (estEl) estEl.textContent = `~${est} question${est === 1 ? '' : 's'}`;
    } else {
      monthlySection.hidden = true;
    }
  }
}

// ----------------------------------------------------------------------------
// Session modal
// ----------------------------------------------------------------------------

/** Which kind of recall a live session is running. */
type RecallKind = 'weekly' | 'monthly';

/** The active recall session, or null when the dialog is closed/idle. */
interface Session {
  kind: RecallKind;
  /** The weekly cycle boundary to mark done on completion (weekly only). */
  cycleEnd?: number;
  /** The interleaved cross-note question set. */
  questions: SampledQuestion[];
  /** Index of the question being shown. */
  index: number;
  /** Per-question outcome: true = correct (or self-graded "got it"). */
  outcomes: boolean[];
}

let session: Session | null = null;

function dialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('[data-recall-dialog]');
}
function modal(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-recall-modal]');
}

/** The modal header (reuses the global quiz header markup/classes). */
function headHtml(sub: string): string {
  return (
    '<div class="quiz-head">' +
    `<span class="quiz-head-ic">${ICON}</span>` +
    `<div class="quiz-head-text"><b>Recall session</b><span>${escapeHtml(sub)}</span></div>` +
    '<button type="button" class="quiz-close" data-recall-close>Esc <span aria-hidden="true">✕</span></button>' +
    '</div>'
  );
}

/** The progress row (bar + per-question pills), from the session state. */
function progressHtml(): string {
  if (!session) return '';
  const total = session.questions.length;
  const pct = total > 0 ? Math.round((session.index / total) * 100) : 0;
  const pills = session.questions
    .map((_, k) => {
      const cls = k < session!.index ? (session!.outcomes[k] ? 'ok' : 'no') : '';
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
  if (!session || !m) return;
  if (session.index >= session.questions.length) {
    renderScore(m);
    return;
  }
  const q = session.questions[session.index]!;
  const total = session.questions.length;
  const last = session.index === total - 1;

  // "From: Topic" source label — the one piece unique to a cross-note session.
  const source = `<p class="recall-source">From: ${escapeHtml(q.sourceLabel)}</p>`;
  const scenario =
    'scenario' in q && q.scenario
      ? `<p class="quiz-scenario"><b>Scenario.</b> ${fmt(q.scenario)}</p>`
      : '';
  const stem = `<p class="quiz-q"><span class="quiz-qnum">Q${session.index + 1}.</span>${fmt(q.question)}</p>`;

  let bodyInner = source + scenario + stem;
  let footInner = '';

  if (q.type === 'card') {
    // Self-grade recall card: flip to reveal the model answer, then rate it.
    const note = q.explanation ?? '';
    bodyInner +=
      '<div class="quiz-card-answer" data-recall-card-answer hidden>' +
      `<b>Answer.</b> ${fmt(q.answer)}` +
      (note ? `<span class="quiz-card-note">${fmt(note)}</span>` : '') +
      '</div>';
    footInner =
      `<span class="quiz-count">${session.index + 1} / ${total}</span>` +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-recall-flip>Flip card</button>' +
      '<span class="quiz-grade" data-recall-grade hidden>' +
      '<button type="button" class="quiz-btn quiz-btn-ghost" data-recall-grade-val="0">Missed it</button>' +
      `<button type="button" class="quiz-btn quiz-btn-primary" data-recall-grade-val="1">Got it${last ? '' : ' →'}</button>` +
      '</span>';
  } else {
    // Auto-graded mcq/scenario: pick an option, lock it, advance (test flow).
    const opts = q.options
      .map(
        (o, k) =>
          `<button type="button" class="quiz-opt" data-recall-opt="${k}">` +
          `<span class="quiz-mk">${LETTERS[k]}</span><span>${fmt(o)}</span></button>`,
      )
      .join('');
    bodyInner += `<div class="quiz-opts">${opts}</div>`;
    footInner = `<span class="quiz-count">${session.index + 1} / ${total}</span>`;
  }

  m.innerHTML =
    headHtml(`Question ${session.index + 1} of ${total}`) +
    `<div class="quiz-prog-wrap">${progressHtml()}</div>` +
    `<div class="quiz-body">${bodyInner}</div>` +
    `<div class="quiz-foot">${footInner}</div>`;
}

/** Render the final score card plus the per-topic breakdown. */
function renderScore(m: HTMLElement): void {
  if (!session) return;

  // Mark the cycle done — the ONLY store write recall ever makes. No progress,
  // review, or attempt slices are touched.
  markCycleDone(session);

  const total = session.questions.length;
  const correct = session.outcomes.filter(Boolean).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const kindLabel = session.kind === 'weekly' ? 'Weekly recall' : 'Monthly sweep';
  const msg =
    correct === total
      ? 'Everything still coheres — the whole window recalled from memory.'
      : `${correct} of ${total} recalled across the window. Revisit the shaky topics while it is fresh.`;

  // Per-topic breakdown: correct / total grouped by the question's source note,
  // in first-seen order so the list reads in the order topics appeared.
  const order: string[] = [];
  const tally = new Map<string, { correct: number; total: number }>();
  session.questions.forEach((q, k) => {
    const key = q.sourceLabel;
    let row = tally.get(key);
    if (!row) {
      row = { correct: 0, total: 0 };
      tally.set(key, row);
      order.push(key);
    }
    row.total += 1;
    if (session!.outcomes[k]) row.correct += 1;
  });
  const breakdown =
    '<ul class="recall-breakdown">' +
    order
      .map((label) => {
        const row = tally.get(label)!;
        const ok = row.correct === row.total;
        return (
          `<li class="recall-breakdown-row${ok ? ' is-ok' : ''}">` +
          `<span class="recall-breakdown-topic">${escapeHtml(label)}</span>` +
          `<span class="recall-breakdown-score">${row.correct}/${row.total}</span>` +
          '</li>'
        );
      })
      .join('') +
    '</ul>';

  m.innerHTML =
    headHtml(`${kindLabel} complete`) +
    '<div class="quiz-body"><div class="quiz-score">' +
    `<div class="quiz-ring" style="--p:${pct}"><span>${correct}/${total}</span></div>` +
    `<div class="quiz-score-pct">${pct}%</div>` +
    `<div class="quiz-score-msg">${escapeHtml(msg)}</div>` +
    '</div>' +
    breakdown +
    '</div>' +
    '<div class="quiz-foot">' +
    '<span class="quiz-count">Recall only — nothing is graded</span>' +
    '<button type="button" class="quiz-btn quiz-btn-primary" data-recall-close>Done</button>' +
    '</div>';
}

/**
 * Persist the completed cycle. Weekly appends its `cycleEnd` to
 * `recallWeeklyDone` (the store dedupes on save); monthly stamps
 * `recallMonthlyDone` with the current time. Idempotent: if the dialog's score
 * card re-renders, the dedupe/overwrite keeps the slice stable.
 */
function markCycleDone(s: Session): void {
  if (s.kind === 'weekly') {
    if (typeof s.cycleEnd !== 'number') return;
    const cycleEnd = s.cycleEnd;
    update((doc) => ({
      ...doc,
      recallWeeklyDone: [...doc.recallWeeklyDone, cycleEnd],
    }));
  } else {
    update((doc) => ({ ...doc, recallMonthlyDone: Date.now() }));
  }
}

/** Build and open an untimed recall session over `routes` for `kind`. */
function startSession(kind: RecallKind, routes: string[], cycleEnd?: number): void {
  const opts = kind === 'weekly' ? WEEKLY_SAMPLE : MONTHLY_SAMPLE;
  const usable = routes.filter((r) => banks.has(r));
  const { questions } = sampleRecall(usable, banks, labelFor, opts);
  if (questions.length === 0) return; // nothing to recall — leave the card as-is

  session = {
    kind,
    ...(typeof cycleEnd === 'number' ? { cycleEnd } : {}),
    questions,
    index: 0,
    outcomes: [],
  };
  render();
  if (!dialog()?.open) dialog()?.showModal();
}

/** Start the pending WEEKLY recall for the given cycle boundary. */
function startWeekly(cycleEnd: number): void {
  const cycle: WeeklyCycle | undefined = pendingWeeklies().find((c) => c.cycleEnd === cycleEnd);
  if (!cycle) {
    // The offered cycle is gone (store changed under us) — re-sync and bail.
    sync();
    return;
  }
  startSession('weekly', cycle.routes, cycle.cycleEnd);
}

/** Start the pending MONTHLY sweep. */
function startMonthly(): void {
  const monthly = pendingMonthly();
  if (!monthly) {
    sync();
    return;
  }
  startSession('monthly', monthly.routes);
}

/** Auto-graded answer: lock the choice, record the outcome, advance. */
function answerOption(optBtn: HTMLElement): void {
  const m = modal();
  if (!session || !m) return;
  const q = session.questions[session.index]!;
  if (q.type === 'card') return;
  if (session.outcomes[session.index] !== undefined) return; // already answered

  const picked = Number(optBtn.dataset.recallOpt);
  session.outcomes[session.index] = picked === q.answer;

  // Brief tactile feedback that the click registered, then advance — no
  // right/wrong reveal mid-session (that is the end-of-session breakdown's job).
  m.querySelectorAll<HTMLElement>('[data-recall-opt]').forEach((btn) => {
    (btn as HTMLButtonElement).disabled = true;
    if (Number(btn.dataset.recallOpt) === picked) btn.classList.add('is-picked');
  });
  window.setTimeout(() => {
    if (!session) return;
    session.index += 1;
    render();
  }, 180);
}

/** Flip a self-grade card to reveal the model answer and the grade buttons. */
function flipCard(): void {
  const m = modal();
  if (!m) return;
  m.querySelector('[data-recall-card-answer]')?.removeAttribute('hidden');
  m.querySelector('[data-recall-flip]')?.remove();
  m.querySelector('[data-recall-grade]')?.removeAttribute('hidden');
}

/** Record a self-grade outcome and advance. */
function gradeCard(got: boolean): void {
  if (!session) return;
  session.outcomes[session.index] = got;
  session.index += 1;
  render();
}

// ----------------------------------------------------------------------------
// Delegated events
// ----------------------------------------------------------------------------

/** Delegated click handling for every recall control. */
function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target) return;

  const weeklyStart = target.closest<HTMLElement>('[data-recall-weekly-start]');
  if (weeklyStart) {
    event.preventDefault();
    startWeekly(Number(weeklyStart.dataset.cycleEnd));
    return;
  }
  if (target.closest('[data-recall-monthly-start]')) {
    event.preventDefault();
    startMonthly();
    return;
  }
  if (target.closest('[data-recall-close]')) {
    dialog()?.close();
    return;
  }
  const opt = target.closest<HTMLElement>('[data-recall-opt]');
  if (opt) {
    answerOption(opt);
    return;
  }
  if (target.closest('[data-recall-flip]')) {
    flipCard();
    return;
  }
  const grade = target.closest<HTMLElement>('[data-recall-grade-val]');
  if (grade) {
    gradeCard(grade.dataset.recallGradeVal === '1');
    return;
  }
}

/** Close on a backdrop click (native dialog reports target === dialog). */
function onDialogClick(event: MouseEvent): void {
  const dlg = dialog();
  if (dlg && event.target === dlg) dlg.close();
}

/**
 * The dialog closed (Esc, backdrop, close button, or Done). Drop the session
 * state so a reopen starts fresh, and re-sync the card: a just-completed cycle
 * is now done, so its section should disappear (or the whole card hide).
 */
function onDialogClose(): void {
  session = null;
  sync();
}

if (typeof document !== 'undefined') {
  const init = (): void => {
    banks = readBanks();
    labels = readLabels();
    const dlg = dialog();
    // Re-bind the dialog-scoped listeners each init: a View Transition can swap
    // the dialog element, and these are cheap/idempotent on a fresh node.
    dlg?.addEventListener('click', onDialogClick);
    dlg?.addEventListener('close', onDialogClose);
    sync();
  };
  document.addEventListener('click', onClick);
  document.addEventListener('astro:page-load', init);
  onRecallChange(sync);
  init();
}

export {};
