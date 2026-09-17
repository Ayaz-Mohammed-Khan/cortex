/**
 * Image caption + click-to-zoom island (Tier 2 polish).
 *
 * Progressive enhancement for content images inside the rendered note body:
 *   - CAPTIONS: an image with non-empty `alt` is wrapped in a
 *     `<figure class="note-figure">` and given a `<figcaption>` echoing the alt
 *     text. Decorative images (empty/whitespace alt) get no caption.
 *   - ZOOM: every eligible content image becomes keyboard-focusable
 *     (`role="button"`, `tabindex="0"`, `cursor: zoom-in`) and opens a single
 *     reusable accessible lightbox dialog on click or Enter/Space.
 *
 * The lightbox is a `role="dialog" aria-modal="true"` overlay with a dimmed
 * backdrop, the enlarged image, and a visible close button. It traps focus
 * (Tab/Shift+Tab cycle between the close button and the image), closes on
 * Escape / backdrop click / close-button click, locks body scroll while open,
 * and restores focus to the triggering image on close. The open transition is
 * suppressed under `prefers-reduced-motion` (handled in CSS).
 *
 * Enhancement runs on `astro:page-load` (initial load + every View Transition
 * swap) and is idempotent (guarded by `img.dataset.zoomable`). It coexists with
 * the broken-image fallback island: failed images are replaced with `<span>`
 * placeholders, so querying `img` naturally skips them.
 *
 * The overlay is marked `data-pagefind-ignore` so Pagefind ignores it.
 */

/** Cached overlay parts, rebuilt if a View Transition swaps them out of the DOM. */
interface Lightbox {
  overlay: HTMLDivElement;
  dialog: HTMLDivElement;
  image: HTMLImageElement;
  closeButton: HTMLButtonElement;
}

let lightbox: Lightbox | null = null;
/** The image that opened the lightbox; focus returns here on close. */
let lastTrigger: HTMLElement | null = null;
/** Body `overflow` value captured before locking scroll, restored on close. */
let previousBodyOverflow = '';

/** Build (once) and return the reusable lightbox, re-creating it if detached. */
function getLightbox(): Lightbox {
  if (lightbox && lightbox.overlay.isConnected) return lightbox;

  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.hidden = true;
  overlay.setAttribute('data-pagefind-ignore', '');

  const dialog = document.createElement('div');
  dialog.className = 'lightbox__dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Image preview');

  const image = document.createElement('img');
  image.className = 'lightbox__image';
  image.alt = '';
  image.tabIndex = 0;
  image.setAttribute('draggable', 'false');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'lightbox__close';
  closeButton.setAttribute('aria-label', 'Close image preview');
  closeButton.innerHTML =
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" aria-hidden="true" ' +
    'focusable="false"><path d="M5 5l10 10M15 5L5 15"></path></svg>';

  dialog.appendChild(image);
  // The close button lives INSIDE the dialog so it anchors to the ZOOMED
  // IMAGE's top-right corner (the dialog sizes to the image via CSS
  // `width: max-content`), moving/staying with the image regardless of its
  // aspect ratio rather than the viewport corner. Both interactive stops (the
  // image and the close button) are children of the dialog, so the focus trap
  // below cycles between exactly those two.
  dialog.appendChild(closeButton);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Backdrop click (outside the dialog) closes; clicks on the image/close do not.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeLightbox();
  });
  closeButton.addEventListener('click', closeLightbox);
  overlay.addEventListener('keydown', onOverlayKeydown);

  lightbox = { overlay, dialog, image, closeButton };
  return lightbox;
}

/** Keyboard handling while the lightbox is open: Escape closes, Tab is trapped. */
function onOverlayKeydown(event: KeyboardEvent): void {
  if (!lightbox) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLightbox();
    return;
  }
  if (event.key !== 'Tab') return;

  // Only two stops in the dialog: the close button and the image. Both are now
  // children of `dialog`, so the trap cycles between them by containment.
  const { closeButton, image, dialog } = lightbox;
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === closeButton || !dialog.contains(active)) {
      event.preventDefault();
      image.focus();
    }
  } else if (active === image || !dialog.contains(active)) {
    event.preventDefault();
    closeButton.focus();
  }
}

/** Open the lightbox for a given content image. */
function openLightbox(trigger: HTMLImageElement): void {
  const lb = getLightbox();
  const alt = (trigger.getAttribute('alt') ?? '').trim();

  lb.image.src = trigger.currentSrc || trigger.src;
  lb.image.alt = alt;
  lb.dialog.setAttribute('aria-label', alt || 'Image preview');

  lastTrigger = trigger;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  lb.overlay.hidden = false;
  // Next frame: add the open class so the CSS entrance transition can run.
  requestAnimationFrame(() => {
    lb.overlay.classList.add('is-open');
  });
  lb.closeButton.focus();
}

/** Close the lightbox, restore body scroll, and return focus to the trigger. */
function closeLightbox(): void {
  if (!lightbox || lightbox.overlay.hidden) return;
  const { overlay, image } = lightbox;

  overlay.classList.remove('is-open');
  overlay.hidden = true;
  image.removeAttribute('src');

  document.body.style.overflow = previousBodyOverflow;
  previousBodyOverflow = '';

  if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus();
  lastTrigger = null;
}

/** True when the element is an eligible, not-yet-processed content image. */
function isEligible(img: HTMLImageElement): boolean {
  if (img.dataset.zoomable === 'true') return false;
  if (img.dataset.fallbackApplied === 'true') return false;
  if (img.closest('a')) return false; // linked images keep their link behavior
  if (img.closest('.note-figure')) return false; // already wrapped
  return true;
}

/** Wrap an image with a caption (when it has alt text) and make it zoomable. */
function enhance(img: HTMLImageElement): void {
  if (!isEligible(img)) return;
  img.dataset.zoomable = 'true';

  const alt = (img.getAttribute('alt') ?? '').trim();

  // Caption: only for images with meaningful alt text.
  if (alt) {
    const figure = document.createElement('figure');
    figure.className = 'note-figure';
    img.parentNode?.insertBefore(figure, img);
    figure.appendChild(img);

    const caption = document.createElement('figcaption');
    caption.textContent = alt;
    figure.appendChild(caption);
  }

  // Zoom affordance: focusable, activatable control semantics.
  img.classList.add('is-zoomable');
  img.setAttribute('role', 'button');
  img.tabIndex = 0;
  img.setAttribute('aria-label', alt ? `View larger image: ${alt}` : 'View larger image');

  img.addEventListener('click', () => openLightbox(img));
  img.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      openLightbox(img);
    }
  });
}

/** Enhance every eligible content image inside the search-indexed body region. */
function enhanceAll(): void {
  const images = document.querySelectorAll<HTMLImageElement>(
    '[data-pagefind-body] img',
  );
  images.forEach(enhance);
}

// Close any open lightbox before a client navigation swaps the DOM, then
// re-enhance the freshly rendered page. Runs on first load and each swap.
document.addEventListener('astro:page-load', () => {
  closeLightbox();
  enhanceAll();
});
