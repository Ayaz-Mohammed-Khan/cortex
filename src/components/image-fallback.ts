/**
 * Broken-image fallback island (task 17.3; Req 3.8).
 *
 * When a content image fails to load, it is replaced in place with its
 * alternative text (when present) or, failing that, a neutral "image
 * unavailable" placeholder — while the surrounding content keeps rendering.
 *
 * `error` events do not bubble, so the listener is registered in the capture
 * phase on `document` (bound once; the document survives View Transitions).
 * Only images inside the rendered note body (`[data-pagefind-body]`) are
 * handled, leaving UI/icon images alone.
 */

function onError(event: Event): void {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (!img.closest('[data-pagefind-body]')) return;
  if (img.dataset.fallbackApplied === 'true') return;
  img.dataset.fallbackApplied = 'true';

  const alt = (img.getAttribute('alt') ?? '').trim();
  const placeholder = document.createElement('span');
  placeholder.className =
    'my-2 inline-flex items-center gap-2 rounded border border-dashed border-gray-400 px-3 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400';
  placeholder.setAttribute('role', 'img');
  if (alt) placeholder.setAttribute('aria-label', alt);
  placeholder.textContent = alt !== '' ? alt : 'Image unavailable';
  img.replaceWith(placeholder);
}

document.addEventListener('error', onError, true);
