/**
 * Code-block enhancement island — copy button + language label (Tier 2 polish).
 *
 * Progressive enhancement for Shiki-rendered code fences. The build emits
 * `<pre data-language="…"><code>…</code></pre>`; this island wraps each such
 * block (inside the rendered note body) in a `.code-block` container and adds:
 *   - a friendly language label (top-left), hidden for unlabeled/unknown fences;
 *   - an accessible "copy to clipboard" button (top-right) with transient
 *     "Copied!" / "Copy failed" feedback.
 *
 * The base markup stays fully readable without JavaScript — this only decorates
 * it. Enhancement runs on `astro:page-load` (fires on the initial load AND
 * after every View Transition swap; module scripts are not re-executed on
 * client navigations) and is idempotent (guarded by `pre.dataset.enhanced`), so
 * re-runs after a swap never double-wrap a block.
 *
 * The injected chrome carries `data-pagefind-ignore` so Pagefind does not index
 * the button/label text.
 */

/** Map common Shiki language ids to human-friendly display names. */
const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  jsx: 'JSX',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  json: 'JSON',
  md: 'Markdown',
  markdown: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  yaml: 'YAML',
  yml: 'YAML',
  sql: 'SQL',
  rs: 'Rust',
  go: 'Go',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  rb: 'Ruby',
  php: 'PHP',
  diff: 'Diff',
};

/** Fence "languages" that carry no useful label (Shiki's default for unknowns). */
const UNLABELED = new Set(['', 'plaintext', 'plain', 'text', 'txt', 'ansi']);

const DEFAULT_LABEL = 'Copy';
const DEFAULT_ARIA = 'Copy code to clipboard';
const REVERT_MS = 2000;

/** Per-button revert timers, so rapid clicks reset (not stack) the feedback. */
const timers = new WeakMap<HTMLButtonElement, number>();

/**
 * Friendly label for a fence language, or `null` when it should be hidden.
 * Unknown-but-present languages fall back to their raw id (still informative).
 */
function friendlyLanguage(raw: string | undefined): string | null {
  const id = (raw ?? '').trim();
  if (UNLABELED.has(id.toLowerCase())) return null;
  return LANGUAGE_LABELS[id.toLowerCase()] ?? id;
}

/** Clipboard SVG icon (decorative; the button carries the accessible name). */
function copyIconSvg(): string {
  return (
    '<svg class="code-block__icon" viewBox="0 0 20 20" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<rect x="7" y="7" width="9" height="9" rx="1.6"></rect>' +
    '<path d="M4 13V5a1 1 0 0 1 1-1h8"></path></svg>'
  );
}

/** Check-mark SVG icon shown on a successful copy. */
function checkIconSvg(): string {
  return (
    '<svg class="code-block__icon" viewBox="0 0 20 20" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M4 10.5l4 4 8-9"></path></svg>'
  );
}

/** Restore the button to its idle "Copy" state. */
function resetButton(button: HTMLButtonElement): void {
  button.classList.remove('is-copied', 'is-error');
  button.setAttribute('aria-label', DEFAULT_ARIA);
  button.innerHTML = copyIconSvg() + `<span class="code-block__copy-text">${DEFAULT_LABEL}</span>`;
}

/** Show transient feedback ("Copied!" or "Copy failed") then revert. */
function showFeedback(button: HTMLButtonElement, ok: boolean): void {
  const existing = timers.get(button);
  if (existing !== undefined) window.clearTimeout(existing);

  if (ok) {
    button.classList.remove('is-error');
    button.classList.add('is-copied');
    button.setAttribute('aria-label', 'Copied');
    button.innerHTML =
      checkIconSvg() + '<span class="code-block__copy-text">Copied!</span>';
  } else {
    button.classList.remove('is-copied');
    button.classList.add('is-error');
    button.setAttribute('aria-label', 'Copy failed');
    button.innerHTML =
      copyIconSvg() + '<span class="code-block__copy-text">Copy failed</span>';
  }

  const id = window.setTimeout(() => {
    resetButton(button);
    timers.delete(button);
  }, REVERT_MS);
  timers.set(button, id);
}

/** Copy the code text of a block, then reflect success/failure on the button. */
async function copyCode(pre: HTMLPreElement, button: HTMLButtonElement): Promise<void> {
  const text = pre.querySelector('code')?.textContent ?? '';
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    showFeedback(button, true);
  } catch {
    // Never throw: rejection or a missing Clipboard API just shows brief feedback.
    showFeedback(button, false);
  }
}

/** Wrap one `<pre>` with the copy button + optional language label. */
function enhance(pre: HTMLPreElement): void {
  if (pre.dataset.enhanced === 'true') return;
  pre.dataset.enhanced = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'code-block';

  // Insert the wrapper before the pre, then move the pre inside it.
  pre.parentNode?.insertBefore(wrapper, pre);
  wrapper.appendChild(pre);

  // Language label (skipped for unlabeled/unknown fences).
  const label = friendlyLanguage(pre.dataset.language);
  if (label) {
    const tag = document.createElement('span');
    tag.className = 'code-block__lang';
    tag.setAttribute('data-pagefind-ignore', '');
    tag.setAttribute('aria-hidden', 'true');
    tag.textContent = label;
    wrapper.appendChild(tag);
  }

  // Copy button.
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-block__copy';
  button.setAttribute('data-pagefind-ignore', '');
  resetButton(button);
  button.addEventListener('click', () => {
    void copyCode(pre, button);
  });
  wrapper.appendChild(button);
}

/** Enhance every not-yet-enhanced code block inside the rendered note body. */
function enhanceAll(): void {
  const blocks = document.querySelectorAll<HTMLPreElement>(
    '.note-body pre[data-language]',
  );
  blocks.forEach(enhance);
}

// Run on first load AND after every View Transition swap (module scripts are
// imported once and do not re-run on client navigations).
document.addEventListener('astro:page-load', enhanceAll);
