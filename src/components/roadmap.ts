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
 */

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

/** Populate and open the modal for a given node id. */
function openModal(id: string): void {
  const info = data[id];
  const dlg = dialog();
  if (!info || !dlg) return;

  const title = dlg.querySelector<HTMLElement>('[data-rm-title]');
  if (title) title.textContent = info.label;

  /*
   * Tier line. A sub-topic states its own tier; a main track states how much of
   * it is deferrable, because a track is never wholly optional. Both say it in
   * words, so the graph's amber notch has a text counterpart here.
   */
  const tierEl = dlg.querySelector<HTMLElement>('[data-rm-tier]');
  if (tierEl) {
    let text = '';
    let advanced = false;
    if (info.tier === 'advanced') {
      text = 'Advanced, safe to defer';
      advanced = true;
    } else if (info.advanced && info.advanced.total > 0) {
      const { advanced: n, total } = info.advanced;
      text =
        n === 0
          ? `Core track, all ${total} sub-topics essential`
          : `Core track, ${n} of ${total} sub-topics can wait`;
    } else if (info.tier === 'core') {
      text = 'Core, later topics build on this';
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
        const a = document.createElement('a');
        a.href = p.href;
        a.textContent = p.label;
        a.className =
          'font-medium text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-800 dark:text-violet-300 dark:decoration-violet-500 dark:hover:text-violet-200';
        prereqEl.append(a);
      } else {
        prereqEl.append(p.label);
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
      dot.className = 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500';
      // A concept that maps to a real heading becomes a link straight to it;
      // the rest stay plain text so nothing pretends to be navigable.
      const text = document.createElement(concept.href ? 'a' : 'span');
      text.className = 'min-w-0 break-words';
      if (concept.href && text instanceof HTMLAnchorElement) {
        text.href = concept.href;
        text.className +=
          ' font-medium text-violet-700 underline decoration-violet-300 underline-offset-2' +
          ' hover:decoration-violet-600 dark:text-violet-300 dark:decoration-violet-500';
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
    // Only main tracks carry this list, and its contents differ by link kind:
    // a whole area lists its notes, a single note lists its own sections.
    if (sectionsLabel) {
      sectionsLabel.textContent =
        info.linkKind === 'category' ? 'Notes in this track:' : 'Jump to a section:';
    }
    sections.innerHTML = '';
    for (const section of info.sections) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = section.href;
      a.textContent = section.text;
      a.className =
        'block rounded-md px-2 py-1 text-sm text-gray-600 transition-colors' +
        ' hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none' +
        ' focus-visible:ring-2 focus-visible:ring-violet-600' +
        ' dark:text-gray-300 dark:hover:bg-violet-500/10 dark:hover:text-violet-300';
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
      footer.classList.remove('hidden');
    } else {
      link.removeAttribute('href');
      footer.classList.add('hidden');
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

function bind(): void {
  loadData();
  restoreView();
  const dlg = dialog();
  dlg?.addEventListener('click', onDialogClick);
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
