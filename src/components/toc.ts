/**
 * Table-of-contents island logic (task 17.1; Req 4.3, 4.4).
 *
 * Enhances the server-rendered {@link file://./TableOfContents.astro} list:
 *
 *  - **Scroll-to (Req 4.3)** — clicking an entry smooth-scrolls its heading to
 *    the top of the reading area and updates the URL hash.
 *  - **Missing target (Req 4.4)** — if the heading a clicked entry points at is
 *    no longer in the document, the scroll position is left unchanged and a
 *    polite "section unavailable" indication is shown.
 *  - **Scroll-spy** — the entry for the heading currently in view is marked
 *    `aria-current`, so the reader can see where they are.
 *
 * The click handler is delegated on `document` (bound once, survives View
 * Transitions). The scroll-spy observer is (re)built on every `astro:page-load`
 * because it must observe the current page's heading elements.
 */

const STATUS_TIMEOUT_MS = 4000;
let observer: IntersectionObserver | null = null;
let statusTimer: number | undefined;

function showStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('[data-toc-status]');
  if (!status) return;
  status.textContent = message;
  status.classList.remove('hidden');
  if (statusTimer) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    status.textContent = '';
    status.classList.add('hidden');
  }, STATUS_TIMEOUT_MS);
}

function clearStatus(): void {
  const status = document.querySelector<HTMLElement>('[data-toc-status]');
  if (status) {
    status.textContent = '';
    status.classList.add('hidden');
  }
}

/**
 * Keep the active TOC entry visible inside the TOC's OWN scroll container as the
 * reader moves through a long page. We scroll only that container (never the
 * main page): if the active link sits above or below the visible slice of the
 * TOC, nudge the container so the link comes back into view with a small margin.
 * Using manual math on the container's scrollTop (rather than
 * `link.scrollIntoView`) avoids scrolling the whole document.
 */
function scrollActiveIntoView(link: HTMLElement): void {
  // The TOC list scrolls inside the `.app-scroll` wrapper (see Layout.astro).
  const container = link.closest<HTMLElement>('.app-scroll');
  if (!container) return;
  // Only act when the container actually scrolls.
  if (container.scrollHeight <= container.clientHeight) return;

  const linkTop = link.offsetTop; // relative to the scroll container's content
  const linkBottom = linkTop + link.offsetHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  const margin = 24; // keep a little breathing room above/below

  if (linkTop < viewTop + margin) {
    container.scrollTo({ top: Math.max(0, linkTop - margin), behavior: 'smooth' });
  } else if (linkBottom > viewBottom - margin) {
    container.scrollTo({
      top: linkBottom - container.clientHeight + margin,
      behavior: 'smooth',
    });
  }
}

function setActive(id: string): void {
  let activeLink: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>('[data-toc-link]').forEach((link) => {
    const isActive = link.getAttribute('data-target') === id;
    link.classList.toggle('toc-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'true');
      activeLink = link;
    } else {
      link.removeAttribute('aria-current');
    }
  });
  // Auto-scroll the TOC so the current section's entry stays visible as the
  // reader progresses down a long page.
  if (activeLink) scrollActiveIntoView(activeLink);
}

function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  const link = target?.closest<HTMLElement>('[data-toc-link]');
  if (!link) return;

  const id = link.getAttribute('data-target');
  const heading = id ? document.getElementById(id) : null;

  event.preventDefault();
  if (!heading) {
    // Target heading gone: leave scroll unchanged, announce unavailability.
    showStatus('That section is no longer available.');
    return;
  }
  clearStatus();
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
  if (id) history.replaceState(null, '', `#${id}`);
  setActive(id!);
}

function buildScrollSpy(): void {
  observer?.disconnect();

  const links = Array.from(document.querySelectorAll<HTMLElement>('[data-toc-link]'));
  if (links.length === 0) return;

  const headings = links
    .map((link) => {
      const id = link.getAttribute('data-target');
      return id ? document.getElementById(id) : null;
    })
    .filter((el): el is HTMLElement => el !== null);
  if (headings.length === 0) return;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.target.id) {
          setActive(entry.target.id);
        }
      }
    },
    { rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );
  headings.forEach((heading) => observer!.observe(heading));
}

document.addEventListener('click', onClick);
document.addEventListener('astro:page-load', buildScrollSpy);
buildScrollSpy();
