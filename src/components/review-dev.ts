/**
 * Dev-only spaced-repetition test panel.
 *
 * Guarded by `import.meta.env.DEV`, so this module's body only runs on the dev
 * server and is tree-shaken out of the production build — nothing here ships to
 * the live site. It renders a small floating panel (bottom-left) with shortcuts
 * to exercise Phase 2 without waiting real days:
 *
 *   - "Enrol all due"   — put every known note into review, due now.
 *   - "Make all due"     — force every already-scheduled review due now.
 *   - "Log schedule"     — dump the review slice to the console.
 *   - "Reset reviews"    — clear the schedule.
 *
 * It also exposes the same actions on `window.__cortexReview` for console use.
 * The panel re-mounts on `astro:page-load` so it survives navigation.
 */

import {
  devMakeAllDue,
  devEnrolDue,
  devSnapshot,
  resetAllReviews,
  dueCount,
} from '@/lib/review';

if (import.meta.env.DEV && typeof document !== 'undefined') {
  const PANEL_ID = 'cortex-review-dev';

  /** All note routes known on this page: the landing map, or the current note. */
  function knownRoutes(): string[] {
    const el = document.querySelector<HTMLScriptElement>('[data-rm-review-labels]');
    if (el) {
      try {
        const parsed = JSON.parse(el.textContent || '{}') as Record<string, unknown>;
        return Object.keys(parsed);
      } catch {
        /* fall through */
      }
    }
    // On a note page, enrol just this note (its route is on the progress wrap).
    const wrap = document.querySelector<HTMLElement>('[data-note-progress]');
    const r = wrap?.dataset.route;
    return r ? [r] : [];
  }

  function enrolAll(): void {
    for (const r of knownRoutes()) devEnrolDue(r);
    toast(`Enrolled ${knownRoutes().length} note(s), all due now.`);
  }

  function makeAllDue(): void {
    const n = devMakeAllDue();
    toast(`Made ${n} scheduled review(s) due now.`);
  }

  function logSchedule(): void {
    // eslint-disable-next-line no-console
    console.log('[cortex review] schedule:', devSnapshot(), '· due now:', dueCount());
    toast('Schedule logged to console.');
  }

  function reset(): void {
    resetAllReviews();
    toast('Review schedule cleared.');
  }

  /** A brief status line inside the panel. */
  function toast(msg: string): void {
    const status = document.getElementById(PANEL_ID)?.querySelector('[data-dev-status]');
    if (status) {
      status.textContent = msg;
      window.setTimeout(() => {
        if (status.textContent === msg) status.textContent = '';
      }, 2500);
    }
  }

  // Console API for power use.
  (window as unknown as Record<string, unknown>).__cortexReview = {
    enrolAll,
    makeAllDue,
    logSchedule,
    reset,
    snapshot: devSnapshot,
  };

  function mount(): void {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <button type="button" data-dev-toggle title="Spaced-repetition dev tools" aria-label="Spaced-repetition dev tools">🧪 SR</button>
      <div data-dev-body hidden>
        <p data-dev-title>SR dev tools <span>(dev only)</span></p>
        <button type="button" data-dev-act="enrol">Enrol all · due now</button>
        <button type="button" data-dev-act="due">Make all due now</button>
        <button type="button" data-dev-act="log">Log schedule</button>
        <button type="button" data-dev-act="reset">Reset reviews</button>
        <p data-dev-status></p>
      </div>`;
    Object.assign(panel.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: '60',
      font: '12px/1.4 ui-sans-serif, system-ui, sans-serif',
    });
    document.body.appendChild(panel);
    injectStyles();

    panel.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-dev-toggle]')) {
        const body = panel.querySelector<HTMLElement>('[data-dev-body]');
        if (body) body.hidden = !body.hidden;
        return;
      }
      const act = t.closest<HTMLElement>('[data-dev-act]')?.dataset.devAct;
      if (act === 'enrol') enrolAll();
      else if (act === 'due') makeAllDue();
      else if (act === 'log') logSchedule();
      else if (act === 'reset') reset();
    });
  }

  function injectStyles(): void {
    if (document.getElementById(PANEL_ID + '-style')) return;
    const s = document.createElement('style');
    s.id = PANEL_ID + '-style';
    s.textContent = `
      #${PANEL_ID} [data-dev-toggle]{background:#7c3aed;color:#fff;border:none;border-radius:9px;
        padding:6px 10px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px -6px rgba(124,58,237,.7);}
      #${PANEL_ID} [data-dev-body]{margin-top:8px;background:#11131f;color:#e5e7eb;border:1px solid #2a2d44;
        border-radius:12px;padding:10px;width:190px;box-shadow:0 14px 40px -12px rgba(0,0,0,.6);}
      #${PANEL_ID} [data-dev-title]{font-weight:700;margin-bottom:8px;}
      #${PANEL_ID} [data-dev-title] span{color:#6b7280;font-weight:500;}
      #${PANEL_ID} [data-dev-act]{display:block;width:100%;text-align:left;background:#1a1c2e;color:#c4b5fd;
        border:1px solid #2a2d44;border-radius:8px;padding:6px 9px;margin-bottom:6px;cursor:pointer;}
      #${PANEL_ID} [data-dev-act]:hover{background:#232641;}
      #${PANEL_ID} [data-dev-act="reset"]{color:#fca5a5;}
      #${PANEL_ID} [data-dev-status]{min-height:14px;color:#5eead4;font-size:11px;margin-top:2px;}
    `;
    document.head.appendChild(s);
  }

  document.addEventListener('astro:page-load', mount);
  mount();
}
