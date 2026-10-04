/**
 * Roadmap graph island (landing page `/`).
 *
 * Wires the interactive behavior for the SVG learning-roadmap graph:
 * clicking (or pressing Enter/Space on) a topic node opens a modal — a native
 * `<dialog>`, the same accessible pattern as the search dialog — listing the
 * concrete concepts to learn for that topic, plus a "Read the notes" link when
 * the topic already has notes.
 *
 * It also owns the Simple/Detailed view switch. Both views are rendered
 * server-side as two panes sharing one set of node ids, so switching is a
 * `hidden` toggle with no re-render and no second data payload. The choice is
 * remembered in `localStorage`.
 *
 * The node -> { label, href, concepts } map is emitted server-side as a
 * `<script type="application/json" data-rm-data>` blob so this island stays a
 * thin, dependency-free presentation layer. Delegated listeners are bound once
 * on `document` and survive Astro View Transitions; the graph is re-scanned on
 * `astro:page-load` so it works after client-side navigation too.
 *
 * Progress: the graph also reflects which topics the reader has completed,
 * reading the shared `@/lib/progress` store so a done cell shows a corner check
 * badge, the modal's "Mark done" toggle stays in sync, and the top meter fills.
 */
import { isDone, toggleDone, resetProgress, onChange } from '@/lib/progress';

/** A syllabus bullet; `href` is set when it names a real section of the note. */
interface Concept {
  text: string;
  href?: string;
}

/** A heading within the linked note, addressable as `route#anchor`. */
interface Section {
  text: string;
  href: string;
  depth: number;
}

interface NodeInfo {
  label: string;
  href: string | null;
  /** Whether `href` is a single note page or a category listing page. */
  linkKind: 'note' | 'category' | null;
  /** 'advanced' means this topic can be deferred without blocking later ones. */
  tier: 'core' | 'advanced';
  /** Main tracks only: how many of their sub-topics are advanced. */
  advanced?: { advanced: number; total: number };
  /** Optional material difficulty; shown as a badge beside the tier pill. */
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  /** Prerequisite labels resolved to routes (href null when unresolved). */
  prerequisites?: { label: string; href: string | null }[];
  concepts: Concept[];
  sections: Section[];
}

let data: Record<string, NodeInfo> = {};

function loadData(): void {
  const el = document.querySelector<HTMLScriptElement>('[data-rm-data]');
  if (!el) {
    data = {};
    return;
  }
  try {
    data = JSON.parse(el.textContent || '{}') as Record<string, NodeInfo>;
  } catch {
    data = {};
  }
}

function dialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('[data-rm-dialog]');
}

/**
 * Reflect the progress store onto the modal's "Mark done" button for whatever
 * route it currently targets. Ghost outline = not done; solid green with a tick
 * = done. Called when the modal opens and whenever the store changes.
 */
function syncDoneButton(): void {
  const btn = dialog()?.querySelector<HTMLButtonElement>('[data-rm-done]');
  const route = btn?.dataset.route;
  if (!btn || !route) return;
  const done = isDone(route);
  const icon = btn.querySelector<HTMLElement>('[data-rm-done-icon]');
  const text = btn.querySelector<HTMLElement>('[data-rm-done-text]');
  btn.setAttribute('aria-pressed', String(done));
  // Swap the two visual states by toggling a `done` modifier class the CSS
  // keys off (defined in index.astro), keeping colour logic out of the JS.
  btn.classList.toggle('rm-done-on', done);
  if (text) text.textContent = done ? 'Completed' : 'Mark done';
  if (icon) {
    icon.innerHTML = done
      ? '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6 l2.5 2.5 L10 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '';
  }
}

/**
 * Reflect the progress store onto the graph: a node whose note route is done
 * gets `.rm-done` (which reveals its corner check badge via CSS). Runs over
 * both panes so the simple and detailed graphs agree. Cheap enough to re-run
 * wholesale on any change.
 */
function syncGraphBadges(): void {
  const groups = document.querySelectorAll<SVGGElement>('[data-rm-node]');
  for (const g of groups) {
    const id = g.getAttribute('data-rm-node');
    const route = id ? data[id]?.href : null;
    const done = route != null && data[id!]?.linkKind === 'note' && isDone(route);
    g.classList.toggle('rm-done', done);
  }
}

/**
 * Update the progress meter from the store. The denominator (total completable
 * notes) is baked into the markup as `data-total`; the numerator is however
 * many of this graph's note routes are done. The meter stays hidden until the
 * first completion so a new visitor never sees an empty 0% bar.
 */
function syncMeter(): void {
  const wrap = document.querySelector<HTMLElement>('[data-rm-meter-wrap]');
  if (!wrap) return;
  const total = Number(wrap.dataset.total) || 0;

  // Count done among THIS graph's note routes only (ignore any stale routes in
  // storage that no longer exist), so the numerator can never exceed the total.
  const routes = new Set<string>();
  for (const g of document.querySelectorAll<SVGGElement>('[data-rm-node]')) {
    const id = g.getAttribute('data-rm-node');
    const info = id ? data[id] : undefined;
    if (info?.linkKind === 'note' && info.href) routes.add(info.href);
  }
  let done = 0;
  for (const r of routes) if (isDone(r)) done++;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  wrap.hidden = done === 0;

  const count = wrap.querySelector<HTMLElement>('[data-rm-meter-count]');
  if (count) count.textContent = `${done} of ${total}`;
  const pctEl = wrap.querySelector<HTMLElement>('[data-rm-meter-pct]');
  if (pctEl) pctEl.textContent = `${pct}%`;
  const fill = wrap.querySelector<HTMLElement>('[data-rm-meter-fill]');
  if (fill) fill.style.width = `${pct}%`;
  const track = wrap.querySelector<HTMLElement>('[data-rm-meter-track]');
  if (track) track.setAttribute('aria-valuenow', String(done));
}

/** Update every progress-aware surface on the roadmap page at once. */
function syncProgress(): void {
  syncGraphBadges();
  syncDoneButton();
  syncMeter();
}

/** Populate and open the modal for a given node id. */
function openModal(id: string): void {
  const info = data[id];
  const dlg = dialog();
  if (!info || !dlg) return;

  const title = dlg.querySelector<HTMLElement>('[data-rm-title]');
  if (title) title.textContent = info.label;

  /*
   * Tier line. A sub-topic states its own tier; a main track states how many of
   * its sub-topics are optional, because a track is never wholly optional. Both
   * say it in words, so the graph's optional (dashed) cue has a text counterpart
   * here. The data value is 'advanced' but readers see "Optional".
   */
  const tierEl = dlg.querySelector<HTMLElement>('[data-rm-tier]');
  if (tierEl) {
    let text = '';
    let advanced = false;
    if (info.tier === 'advanced') {
      text = 'Optional, safe to skip';
      advanced = true;
    } else if (info.advanced && info.advanced.total > 0) {
      const { advanced: n, total } = info.advanced;
      text =
        n === 0
          ? `Core track, all ${total} sub-topics essential`
          : `Core track, ${n} of ${total} sub-topics optional`;
    } else if (info.tier === 'core') {
      text = 'Core, a fundamental you should know';
    }
    tierEl.textContent = text;
    tierEl.hidden = text === '';
    tierEl.classList.toggle('rm-tier-adv', advanced);
    tierEl.classList.toggle('rm-tier-core', !advanced);
  }

  // Difficulty badge (own axis from tier): green/blue/pink dot + label.
  const diffEl = dlg.querySelector<HTMLElement>('[data-rm-difficulty]');
  if (diffEl) {
    const d = info.difficulty;
    diffEl.hidden = !d;
    diffEl.className = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold';
    if (d) {
      const label = d.charAt(0).toUpperCase() + d.slice(1);
      diffEl.textContent = label;
      diffEl.classList.add(`rm-diff-badge`, `rm-diff-${d}`);
    }
  }

  // Prerequisites callout: "Learn first: <linked labels>".
  const prereqWrap = dlg.querySelector<HTMLElement>('[data-rm-prereq-wrap]');
  const prereqEl = dlg.querySelector<HTMLElement>('[data-rm-prereq]');
  const prereqs = info.prerequisites ?? [];
  if (prereqWrap && prereqEl) {
    prereqWrap.hidden = prereqs.length === 0;
    prereqEl.innerHTML = '';
    prereqs.forEach((p, i) => {
      if (i > 0) prereqEl.append(', ');
      if (p.href) {
        // Resolved to real content: a live link, styled like every other.
        const a = document.createElement('a');
        a.href = p.href;
        a.textContent = p.label;
        a.className =
          'font-medium text-accent-700 underline decoration-accent-300 underline-offset-2 hover:text-accent-800 dark:text-accent-300 dark:decoration-accent-500 dark:hover:text-accent-200';
        prereqEl.append(a);
      } else {
        // No note or category yet: a dull "coming soon" link, matching the
        // roadmap's own rm-soon nodes (dashed, muted, not navigable). It lights
        // up automatically once a matching note/folder is published.
        const span = document.createElement('span');
        span.textContent = p.label;
        span.title = `${p.label} - coming soon`;
        span.className =
          'font-medium text-gray-400 underline decoration-dashed decoration-gray-300 underline-offset-2 dark:text-gray-500 dark:decoration-gray-600';
        const soon = document.createElement('span');
        soon.textContent = ' (soon)';
        soon.className = 'text-xs text-gray-400 dark:text-gray-500';
        span.append(soon);
        prereqEl.append(span);
      }
    });
  }

  const list = dlg.querySelector<HTMLElement>('[data-rm-concepts]');
  if (list) {
    list.innerHTML = '';
    for (const concept of info.concepts) {
      const li = document.createElement('li');
      // `break-inside-avoid` keeps a wrapped bullet whole instead of splitting it
      // across the column boundary; `mb-2` supplies the vertical rhythm that
      // `gap` cannot in a multi-column container.
      li.className =
        'mb-2 flex break-inside-avoid items-start gap-2 text-sm text-gray-700 dark:text-gray-200';
      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.className = 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500';
      // A concept that maps to a real heading becomes a link straight to it;
      // the rest stay plain text so nothing pretends to be navigable.
      const text = document.createElement(concept.href ? 'a' : 'span');
      text.className = 'min-w-0 break-words';
      if (concept.href && text instanceof HTMLAnchorElement) {
        text.href = concept.href;
        text.className +=
          ' font-medium text-accent-700 underline decoration-accent-300 underline-offset-2' +
          ' hover:decoration-accent-600 dark:text-accent-300 dark:decoration-accent-500';
      }
      text.textContent = concept.text;
      li.append(dot, text);
      list.appendChild(li);
    }
  }

  const sectionsWrap = dlg.querySelector<HTMLElement>('[data-rm-sections-wrap]');
  const sections = dlg.querySelector<HTMLElement>('[data-rm-sections]');
  const sectionsLabel = dlg.querySelector<HTMLElement>('[data-rm-sections-label]');
  if (sectionsWrap && sections) {
    // Only a main track carries this list now: it names the notes the track
    // covers. Note-level nodes leave `sections` empty, since their concept
    // bullets already deep-link into the note's own sections.
    if (sectionsLabel) {
      sectionsLabel.textContent = 'Notes in this track:';
    }
    sections.innerHTML = '';
    for (const section of info.sections) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = section.href;
      a.textContent = section.text;
      a.className =
        'block rounded-md px-2 py-1 text-sm text-gray-600 transition-colors' +
        ' hover:bg-accent-50 hover:text-accent-700 focus-visible:outline-none' +
        ' focus-visible:ring-2 focus-visible:ring-accent-600' +
        ' dark:text-gray-300 dark:hover:bg-accent-500/10 dark:hover:text-accent-300';
      // Indent nested headings so the note's structure is legible at a glance.
      if (section.depth > 2) a.style.paddingLeft = `${(section.depth - 2) * 0.75 + 0.5}rem`;
      li.appendChild(a);
      sections.appendChild(li);
    }
    sectionsWrap.classList.toggle('hidden', info.sections.length === 0);
  }

  const footer = dlg.querySelector<HTMLElement>('[data-rm-footer]');
  const link = dlg.querySelector<HTMLAnchorElement>('[data-rm-link]');
  const linkText = dlg.querySelector<HTMLElement>('[data-rm-link-text]');
  if (footer && link) {
    if (info.href) {
      link.href = info.href;
      // Individual concepts and sections already deep-link, so this button is
      // specifically the whole-document escape hatch. Say so, rather than
      // repeating the topic name as if it were the only way in.
      if (linkText) {
        linkText.textContent =
          info.linkKind === 'category' ? 'Browse all notes' : 'Read the full note';
      }
      // `hidden` wins over the footer's flex utilities, so swap the two.
      footer.classList.remove('hidden');
      footer.classList.add('flex');
    } else {
      link.removeAttribute('href');
      footer.classList.add('hidden');
      footer.classList.remove('flex');
    }
  }

  // Progress toggle (B1): only a topic WITH a note can be completed. Point it at
  // this node's route and reflect the stored state; the click handler and the
  // store subscription keep it live.
  const doneBtn = dlg.querySelector<HTMLButtonElement>('[data-rm-done]');
  if (doneBtn) {
    if (info.href && info.linkKind === 'note') {
      doneBtn.hidden = false;
      doneBtn.dataset.route = info.href;
      syncDoneButton();
    } else {
      // A main-track category or a note-less topic: nothing to mark complete.
      doneBtn.hidden = true;
      delete doneBtn.dataset.route;
    }
  }

  if (!dlg.open) dlg.showModal();
}

/** Which of the two roadmap views is showing. */
type View = 'simple' | 'detailed';

const VIEW_KEY = 'cortex:roadmap-view';

const HINTS: Record<View, string> = {
  simple: 'Core topics at a glance. Switch to detailed for every sub-topic.',
  detailed: 'Every topic and sub-topic. Switch to simple for the overview.',
};

/**
 * The server renders the simple hint with the topic COUNT baked in ("18 core
 * topics at a glance."). Reusing that exact text on restore avoids a visible
 * text swap on load; the generic copy is only needed once the reader switches.
 */
let initialHint: string | null = null;

/**
 * Show one view and hide the other.
 *
 * Both panes carry the SAME `data-rm-node` ids, so whichever is visible opens
 * the same modal. The hidden pane uses the `hidden` attribute rather than
 * `display: none` on a wrapper, which also takes its nodes out of the tab order.
 */
function setView(view: View, persist = true): void {
  const panes = document.querySelectorAll<HTMLElement>('[data-rm-pane]');
  if (panes.length === 0) return;
  for (const pane of panes) pane.hidden = pane.dataset.rmPane !== view;
  for (const btn of document.querySelectorAll<HTMLElement>('[data-rm-view]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.rmView === view));
  }
  // Legend items that belong to only one view: the advanced-tier notch is
  // detailed-only, and the "notes available" swatch differs per view (phase
  // gradient in simple, violet in detailed). Toggle both sets to the view.
  for (const item of document.querySelectorAll<HTMLElement>('[data-rm-detailed-only]')) {
    item.hidden = view !== 'detailed';
  }
  for (const item of document.querySelectorAll<HTMLElement>('[data-rm-simple-only]')) {
    item.hidden = view !== 'simple';
  }
  const hint = document.querySelector<HTMLElement>('[data-rm-view-hint]');
  if (hint) {
    if (initialHint === null) initialHint = hint.textContent;
    hint.textContent = view === 'simple' && initialHint ? initialHint : HINTS[view];
  }
  // Switching to the detailed view (re)arms the scroll reveal so on-screen
  // tracks animate in. `persist` is only false during initial restore, where
  // `bind()` arms right after, so skip the double-arm then.
  if (persist && view === 'detailed') {
    requestAnimationFrame(() => armReveal());
  }
  if (!persist) return;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode or a full quota: the choice just does not outlive the visit.
  }
}

/** Restore the visitor's last choice, defaulting to the gentler simple view. */
function restoreView(): void {
  if (!document.querySelector('[data-rm-pane]')) return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(VIEW_KEY);
  } catch {
    stored = null;
  }
  setView(stored === 'detailed' ? 'detailed' : 'simple', false);
}

function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target) return;

  const viewBtn = target.closest<HTMLElement>('[data-rm-view]');
  if (viewBtn) {
    const view = viewBtn.dataset.rmView;
    if (view === 'simple' || view === 'detailed') setView(view);
    return;
  }

  // Close button inside the dialog.
  if (target.closest('[data-rm-close]')) {
    dialog()?.close();
    return;
  }

  // "Mark done" toggle in the modal footer: flip the store, keep the modal open.
  const doneBtn = target.closest<HTMLButtonElement>('[data-rm-done]');
  if (doneBtn) {
    const route = doneBtn.dataset.route;
    if (route) toggleDone(route); // store change -> onChange -> all surfaces sync
    return;
  }

  // Reset progress (meter): clear all completion after a confirm.
  if (target.closest('[data-rm-meter-reset]')) {
    if (window.confirm('Reset your progress? This clears every topic you have marked done.')) {
      resetProgress(); // -> onChange -> graph, meter, any open modal all clear
    }
    return;
  }

  // Following any link in the modal (a concept anchor, a section anchor, or the
  // CTA) should dismiss it, so a same-page hash jump is not left behind a modal.
  // Navigation itself is left to the browser.
  if (target.closest('[data-rm-dialog] a[href]')) {
    dialog()?.close();
    return;
  }

  const node = target.closest<SVGGElement>('[data-rm-node]');
  if (node) {
    const id = node.getAttribute('data-rm-node');
    if (id) openModal(id);
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target as Element | null;
  const node = target?.closest<SVGGElement>('[data-rm-node]');
  if (!node) return;
  event.preventDefault();
  const id = node.getAttribute('data-rm-node');
  if (id) openModal(id);
}

// Dismiss when the backdrop (the dialog element itself, outside its content) is
// clicked — native <dialog> reports clicks on the backdrop as target === dialog.
function onDialogClick(event: MouseEvent): void {
  const dlg = dialog();
  if (dlg && event.target === dlg) dlg.close();
}

/* ---------------------------------------------------------------------------
 * Scroll reveal for the detailed graph.
 *
 * As each track scrolls into view its nodes/edges (class `.rm-reveal`) get
 * `.rm-shown`, which the CSS fades + rises in - main cell first, sub-topics
 * cascading by their `--ri` index, so it reads as the axon signal branching
 * into the dendrites. Arming adds `.rm-anim-ready` to the SVG, which is what
 * flips the elements to their hidden start state; without it (JS off, or before
 * the detailed view is shown) everything stays visible, so the graph is never
 * stuck blank. Idempotent and re-armed on view switch + page-load.
 * --------------------------------------------------------------------------- */
let revealCleanup: (() => void) | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function armReveal(): void {
  // Tear down any previous wiring first (view switches re-arm).
  revealCleanup?.();
  revealCleanup = null;

  const pane = document.querySelector<HTMLElement>('[data-rm-pane="detailed"]');
  const svg = pane?.querySelector<SVGSVGElement>('svg');
  if (!pane || !svg) return;

  // Reveal targets: the fade+rise cells/edges/boutons AND the gated signal
  // sparks (which fade in with their track so they never fire before it shows).
  const revealEls = Array.from(svg.querySelectorAll<SVGElement>('.rm-reveal, .rm-signal-gated'));
  if (revealEls.length === 0) return;

  // Reduced motion (or a hidden pane): show everything, do not animate.
  if (prefersReducedMotion()) {
    for (const el of revealEls) el.classList.add('rm-shown');
    return;
  }

  // Group reveal elements by their track index.
  const byTrack = new Map<string, SVGElement[]>();
  for (const el of revealEls) {
    const t = el.getAttribute('data-rm-track') ?? '0';
    (byTrack.get(t) ?? byTrack.set(t, []).get(t)!).push(el);
  }

  // Arm: switch the SVG into its hidden start state.
  svg.classList.add('rm-anim-ready');

  const REVEAL_MS = 500; // matches the CSS fade+rise duration
  const STAGGER_MS = 90; // matches transition-delay per --ri step
  const signalTimers: number[] = [];

  const shownTracks = new Set<string>();
  const showTrack = (t: string): void => {
    if (shownTracks.has(t)) return;
    shownTracks.add(t);
    const els = byTrack.get(t) ?? [];
    // Reveal the STRUCTURE now: cells, dendrites, boutons (fade + rise).
    const signals: SVGElement[] = [];
    let maxRi = 0;
    for (const el of els) {
      if (el.classList.contains('rm-signal-gated')) {
        signals.push(el);
        continue;
      }
      el.classList.add('rm-shown');
      const ri = Number(el.style.getPropertyValue('--ri')) || 0;
      if (ri > maxRi) maxRi = ri;
    }
    // Reveal this track's SIGNALS only AFTER its structure has fully arrived
    // (base fade + the last sub-topic's stagger + a small buffer), so a spark
    // never appears before the trunk and cells it rides on.
    const delay = REVEAL_MS + maxRi * STAGGER_MS + 250;
    const timer = window.setTimeout(() => {
      for (const s of signals) s.classList.add('rm-shown');
    }, delay);
    signalTimers.push(timer);
  };

  // A track reveals when its MAIN cell crosses ~82% of the viewport height, so
  // the reveal lands just as the reader (and the travelling signal) arrive.
  const check = (): void => {
    if (pane.hidden) return;
    const vh = window.innerHeight;
    for (const [t, els] of byTrack) {
      if (shownTracks.has(t)) continue;
      const main = els.find((e) => e.classList.contains('rm-node-main')) ?? els[0];
      if (!main) continue;
      const r = main.getBoundingClientRect();
      if (r.top < vh * 0.82 && r.bottom > 0) showTrack(t);
    }
    if (shownTracks.size === byTrack.size) stopListening();
  };

  const onScroll = (): void => check();
  // Remove scroll listeners once every track is revealed (the pending signal
  // timers keep running and clear themselves after firing).
  function stopListening(): void {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  }
  // Full teardown (used when re-arming): stop listening AND cancel any pending
  // signal timers so a stale one can't fire on the rebuilt graph.
  function teardown(): void {
    stopListening();
    for (const timer of signalTimers) clearTimeout(timer);
    revealCleanup = null;
  }
  revealCleanup = teardown;

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  // Reveal whatever is already on screen (next frame so the transition runs).
  requestAnimationFrame(() => requestAnimationFrame(check));
}

let progressUnsub: (() => void) | null = null;

function bind(): void {
  loadData();
  restoreView();
  const dlg = dialog();
  dlg?.addEventListener('click', onDialogClick);
  // Arm the scroll reveal once the pane state is settled. If the detailed pane
  // is hidden now, arming still tags it; when the user switches to detailed the
  // elements are in their start state and the first `check()` reveals what fits.
  armReveal();
  // Progress: paint the stored completion onto the graph/meter, and keep them
  // live. Resubscribe fresh each page-load so listeners never stack.
  syncProgress();
  progressUnsub?.();
  progressUnsub = onChange(syncProgress);
}

document.addEventListener('click', onClick);
document.addEventListener('keydown', onKeydown);
document.addEventListener('astro:page-load', bind);
bind();

// This island has no imports, so without a module marker TypeScript would treat
// it as a global script and report its `onClick`/`onKeydown` as duplicates of
// the identically-named handlers in the other islands. Vite already bundles it
// as a module, so this only aligns the type checker with reality.
export {};
