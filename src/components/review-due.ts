/**
 * "Review due today" island (roadmap landing page).
 *
 * Reads the spaced-repetition schedule from the shared store (`@/lib/review`)
 * and surfaces the notes whose review is due now. It owns the card rendered by
 * `index.astro` (`[data-rm-review]`):
 *
 *   - hides the card entirely when nothing is due,
 *   - otherwise shows the count, a short list of due topic chips (linking to
 *     each note), and a "Start review" button,
 *   - starting a review builds an ordered QUEUE of the due routes in
 *     sessionStorage and navigates to the first note's quiz with `?review=1`.
 *
 * The queue is what turns individual quizzes into one review *session*: see
 * `review-session.ts`, imported on every page, which advances the queue after
 * each review-mode quiz. This island only lives on the landing page; the
 * session driver is global.
 *
 * Island pattern: delegated click handling bound once on `document`, re-synced
 * on `astro:page-load`, kept live via the store's change events.
 */

import { dueRoutes, onReviewChange } from '@/lib/review';
import { REVIEW_QUEUE_KEY, reviewUrl } from '@/lib/review-session';

const WRAP = '[data-rm-review]';
/** How many due chips to show before collapsing into "+N more". */
const MAX_CHIPS = 6;

/** Route -> display label, read once from the page's emitted JSON. */
let labels: Record<string, string> = {};

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

/** Render the card from the current due set, or hide it when nothing is due. */
function sync(): void {
  const wrap = document.querySelector<HTMLElement>(WRAP);
  if (!wrap) return;

  // Only count notes we can actually open (present in the label map). This
  // avoids surfacing a stale review item whose note was renamed or removed.
  const due = dueRoutes().filter((r) => r in labels);

  if (due.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const countEl = wrap.querySelector<HTMLElement>('[data-rm-review-count]');
  const nounEl = wrap.querySelector<HTMLElement>('[data-rm-review-noun]');
  if (countEl) countEl.textContent = String(due.length);
  if (nounEl) nounEl.textContent = due.length === 1 ? 'topic' : 'topics';

  const list = wrap.querySelector<HTMLElement>('[data-rm-review-list]');
  if (list) {
    const shown = due.slice(0, MAX_CHIPS);
    const rest = due.length - shown.length;
    list.innerHTML =
      shown
        .map(
          (r) =>
            `<li><a class="rm-review-chip" href="${reviewUrl(r)}">${escapeHtml(labelFor(r))}</a></li>`,
        )
        .join('') + (rest > 0 ? `<li class="rm-review-more">+${rest} more</li>` : '');
  }

  const start = wrap.querySelector<HTMLAnchorElement>('[data-rm-review-start]');
  if (start) start.dataset.queue = JSON.stringify(due);
}

/** Escape text for safe insertion into innerHTML. */
function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Begin a review session: store the queue and go to the first due note. */
function startReview(queueJson: string): void {
  let queue: string[] = [];
  try {
    const parsed = JSON.parse(queueJson) as unknown;
    if (Array.isArray(parsed)) queue = parsed.filter((r): r is string => typeof r === 'string');
  } catch {
    queue = [];
  }
  if (queue.length === 0) return;
  const [first, ...rest] = queue;
  try {
    sessionStorage.setItem(REVIEW_QUEUE_KEY, JSON.stringify(rest));
  } catch {
    // sessionStorage unavailable: the session just won't auto-advance.
  }
  window.location.href = reviewUrl(first!);
}

/** Delegated clicks for the Start button (chips are plain links). */
function onClick(event: MouseEvent): void {
  const start = (event.target as Element | null)?.closest<HTMLAnchorElement>(
    '[data-rm-review-start]',
  );
  if (!start) return;
  event.preventDefault();
  startReview(start.dataset.queue ?? '[]');
}

if (typeof document !== 'undefined') {
  const init = (): void => {
    labels = readLabels();
    sync();
  };
  document.addEventListener('click', onClick);
  document.addEventListener('astro:page-load', init);
  onReviewChange(sync);
  init();
}
