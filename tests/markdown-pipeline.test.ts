import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error - JS config module has no type declarations
import astroConfig from '../astro.config.mjs';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import '@/components/image-fallback';

/**
 * Markdown pipeline integration tests (task 8.7; Req 3.1–3.6, 3.8).
 *
 * These render the committed fixture Notes in `tests/fixtures/` through the
 * REAL configured Astro Markdown processor from `astro.config.mjs`
 * (remark-math → rehype-katex with `throwOnError:false`, Shiki dual theme,
 * rehype-slug + rehype-autolink-headings, rehype-sanitize). They validate the
 * engine/plugin wiring — not our own pure logic — so they are examples rather
 * than properties, per the design's Testing Strategy.
 *
 * `renderMarkdown` invokes Astro's own markdown processor exactly as the site
 * build does (`processor.createRenderer` from `astro.config.mjs`), so the
 * plugin list and Shiki themes under test are the real ones — the pipeline is
 * not re-implemented here. Each fixture is rendered once as a whole Note; a few
 * minimal inline snippets are used only where a *negative* assertion needs an
 * isolated single-block document.
 *
 * The final block covers the client-side broken-image fallback (Req 3.8), which
 * is runtime behavior in the `image-fallback` island rather than pipeline
 * output: the pipeline only preserves the `alt` text the fallback consumes.
 */

let renderMarkdown: (src: string) => Promise<string>;

/**
 * Read a committed fixture Note from `tests/fixtures/`. Vitest runs with the
 * project root as its working directory (see the run banner), so resolving from
 * `process.cwd()` reliably locates the fixtures.
 */
function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'tests', 'fixtures', name), 'utf8');
}

// Rendered HTML of each committed fixture Note, produced once through the real
// pipeline in `beforeAll` and shared by the assertions below.
let standardElementsHtml: string;
let mathCodeHtml: string;
let imagesHtml: string;

beforeAll(async () => {
  const md = astroConfig.markdown;
  const renderer = await md.processor.createRenderer({ shikiConfig: md.shikiConfig });
  renderMarkdown = async (src: string) => {
    const { content } = parseFrontmatter(src);
    const { code } = await renderer.render(content);
    return code as string;
  };

  // Render the three committed fixtures end-to-end so the suite exercises the
  // exact files checked into `tests/fixtures/`, not paraphrased copies.
  standardElementsHtml = await renderMarkdown(readFixture('standard-elements.md'));
  mathCodeHtml = await renderMarkdown(readFixture('math-code.md'));
  imagesHtml = await renderMarkdown(readFixture('images.md'));
});

describe('standard Markdown elements (Req 3.1)', () => {
  it('renders headings, paragraphs, links, lists, tables, and blockquotes', () => {
    // Headings get stable ids (rehype-slug) used by the TOC / deep links.
    expect(standardElementsHtml).toMatch(/<h1 id="standard-markdown-elements"/);
    expect(standardElementsHtml).toMatch(/<h2 id="section-one"/);
    expect(standardElementsHtml).toContain(
      '<a href="https://example.com/docs">link to the example domain</a>',
    );
    expect(standardElementsHtml).toContain('<ul>');
    expect(standardElementsHtml).toContain('<ol>');
    expect(standardElementsHtml).toContain('<li>First unordered item</li>');
    expect(standardElementsHtml).toContain('<table>');
    expect(standardElementsHtml).toContain('<th>Language</th>');
    expect(standardElementsHtml).toContain('<td>TypeScript</td>');
    expect(standardElementsHtml).toContain('<blockquote>');
  });
});

describe('code blocks (Req 3.2, 3.3)', () => {
  it('applies Shiki syntax highlighting for a recognized language', () => {
    // The fixture's ```ts block gets a language marker...
    expect(mathCodeHtml).toContain('data-language="ts"');
    // ...per-token colors, plus the dual light/dark theme CSS variables.
    expect(mathCodeHtml).toMatch(/style="color:#[0-9A-Fa-f]{6}/);
    expect(mathCodeHtml).toContain('--shiki-dark:');
  });

  it('falls back to plain monospaced text for an unrecognized language', async () => {
    // Isolated single-block document: `math-code.md` also contains a highlighted
    // block, so the "no colored tokens" assertion needs the plain block alone.
    const html = await renderMarkdown('```\njust plain text\n```');
    expect(html).toContain('data-language="plaintext"');
    // The code text is preserved verbatim...
    expect(html).toContain('just plain text');
    // ...and no per-token syntax coloring is applied (unlike the ts block).
    expect(html).not.toMatch(/<span style="color:#[0-9A-Fa-f]{6}/);
  });
});

describe('mathematical notation (Req 3.4, 3.5, 3.6)', () => {
  it('renders inline and block math as KaTeX markup', () => {
    // Inline `$E = mc^2$` and block `$$…$$` both come from the fixture.
    expect(mathCodeHtml).toContain('class="katex"');
    // Block math is wrapped in the centered display container.
    expect(mathCodeHtml).toContain('class="katex-display"');
    expect(mathCodeHtml).toContain('display="block"');
    // The original TeX is preserved in the MathML annotation.
    expect(mathCodeHtml).toContain('E = mc^2');
  });

  it('renders inline math without the block/display wrapper', async () => {
    // Isolated: prove inline math is NOT emitted as a display (block) equation.
    const html = await renderMarkdown('Energy is $E = mc^2$ inline.');
    expect(html).toContain('class="katex"');
    expect(html).toContain('<math');
    expect(html).not.toContain('class="katex-display"');
  });

  it('preserves invalid math as source with an error indication (throwOnError:false)', () => {
    // The fixture's `$\frac{1}{$` is malformed. KaTeX emits a colored error
    // span rather than failing the render.
    expect(mathCodeHtml).toContain('class="katex-error"');
    expect(mathCodeHtml).toContain('color:#cc0000');
    // The original notation source is shown unchanged...
    expect(mathCodeHtml).toContain('\\frac{1}{');
    // ...and the sections AFTER the bad math still render (the code blocks
    // follow it in the fixture), so one bad expression never blanks the Note.
    expect(mathCodeHtml).toContain('data-language="ts"');
    expect(mathCodeHtml).toContain('data-language="plaintext"');
  });
});

describe('images (Req 3.7, 3.8 pipeline side)', () => {
  it('preserves alt text and the relative src for a referenced image', () => {
    expect(imagesHtml).toContain('<img');
    expect(imagesHtml).toContain('alt="A labelled architecture diagram"');
    expect(imagesHtml).toContain('src="./assets/missing-diagram.png"');
  });

  it('keeps an empty alt for an image authored without alt text', () => {
    expect(imagesHtml).toContain('alt=""');
  });

  it('keeps rendering content around the (broken) images', () => {
    // Surrounding prose survives so an unresolvable image never blanks the page.
    expect(imagesHtml).toContain('Some text after the last image.');
  });
});

describe('broken-image fallback island (Req 3.8, client)', () => {
  it('replaces a failed image with its alt text', () => {
    document.body.innerHTML =
      '<div data-pagefind-body><img id="a" src="/missing.png" alt="A chart" /></div>';
    const img = document.getElementById('a')!;
    img.dispatchEvent(new Event('error'));

    const fallback = document.querySelector('[role="img"]');
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toBe('A chart');
    expect(fallback!.getAttribute('aria-label')).toBe('A chart');
    expect(document.getElementById('a')).toBeNull();
  });

  it('shows an "image unavailable" placeholder when there is no alt text', () => {
    document.body.innerHTML =
      '<div data-pagefind-body><img id="b" src="/missing.png" alt="" /></div>';
    const img = document.getElementById('b')!;
    img.dispatchEvent(new Event('error'));

    const fallback = document.querySelector('[role="img"]');
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toBe('Image unavailable');
  });

  it('ignores images outside the rendered note body', () => {
    document.body.innerHTML = '<header><img id="c" src="/logo.png" alt="Logo" /></header>';
    const img = document.getElementById('c')!;
    img.dispatchEvent(new Event('error'));
    // Untouched: still an <img>, no placeholder created.
    expect(document.getElementById('c')).not.toBeNull();
    expect(document.querySelector('[role="img"]')).toBeNull();
  });
});
