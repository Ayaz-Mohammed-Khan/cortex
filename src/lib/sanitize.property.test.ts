import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeHtml, sanitizeSchema } from './sanitize';

// Feature: portfolio-website, Property 11: For any HTML fragment mixing safe formatting tags with script vectors, the sanitized output contains no <script> elements, no event-handler (on*) attributes, and no javascript: link targets, while retaining the safe (non-script) formatting elements and their allowed attributes, including KaTeX and syntax-highlight markup.

// Validates: Requirements 3.9

/**
 * An alphanumeric token embedded as text / class fragments in the generated
 * markup. Kept strictly `[A-Za-z0-9]` so it can never introduce the substrings
 * the removal assertions look for (`<`, `:`, `=`) — a token therefore survives
 * verbatim into the sanitized output and is a reliable retention marker.
 */
const tokenArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
    ),
    { minLength: 4, maxLength: 10 },
  )
  .map((chars) => chars.join(''));

/** Script payloads for the vectors. None contain `<`, `:`, `=`, or quotes. */
const payloadArb: fc.Arbitrary<string> = fc.constantFrom(
  'alert(1)',
  'alert(document.cookie)',
  'void(0)',
  'doEvil(2)',
  'runXss(3)',
);

/**
 * A fragment of markup tagged with its intent. `markers` lists substrings that
 * MUST survive sanitization when `kind === 'safe'` (element tags plus their
 * allowed attributes / text), and is empty for `kind === 'vector'` since a
 * vector must leave no assertable trace of its script content.
 */
type Part = { kind: 'safe' | 'vector'; html: string; markers: string[] };

/**
 * Safe formatting building blocks: plain formatting (`p/strong/em/code/a`),
 * a Shiki-style highlighted token (`span`/`pre` carrying `class` + inline
 * `style`), and a KaTeX inline-math tree (nested `span`s + MathML with
 * `aria-hidden`). Each keeps a `${t}` marker so retention can be verified.
 */
function safeParts(t: string): Part[] {
  return [
    { kind: 'safe', html: `<p>${t}</p>`, markers: ['<p>', t] },
    { kind: 'safe', html: `<strong>${t}</strong>`, markers: ['<strong>', t] },
    { kind: 'safe', html: `<em>${t}</em>`, markers: ['<em>', t] },
    { kind: 'safe', html: `<code>${t}</code>`, markers: ['<code>', t] },
    {
      kind: 'safe',
      html: `<a href="https://example.com/${t}">${t}</a>`,
      markers: [`href="https://example.com/${t}"`, t],
    },
    {
      kind: 'safe',
      html: `<span class="tok-${t}" style="color:#0a0">${t}</span>`,
      markers: [`class="tok-${t}"`, 'color:#0a0', t],
    },
    {
      kind: 'safe',
      html: `<pre class="shiki"><code><span style="color:#79b8ff">${t}</span></code></pre>`,
      markers: ['<pre class="shiki">', 'color:#79b8ff', t],
    },
    {
      kind: 'safe',
      html:
        `<span class="katex"><span class="katex-mathml">` +
        `<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow>` +
        `<mi>${t}</mi><mo>+</mo><mn>1</mn></mrow></semantics></math></span>` +
        `<span class="katex-html" aria-hidden="true"><span class="mord mathnormal">${t}</span></span></span>`,
      markers: ['class="katex"', '<math', 'aria-hidden="true"', t],
    },
  ];
}

/**
 * Script vectors across the three categories in Property 11: `<script>`
 * elements (with and without `src`), `on*` event handlers on both dropped and
 * retained elements, and `javascript:` targets on `href`/`src` (incl. a
 * mixed-case scheme, which the exact-match protocol allow-list also rejects).
 */
function vectorParts(t: string, payload: string): Part[] {
  return [
    { kind: 'vector', html: `<script>${payload}</script>`, markers: [] },
    { kind: 'vector', html: `<script src="https://cdn.example/${t}.js"></script>`, markers: [] },
    { kind: 'vector', html: `<img src="pic-${t}.png" onerror="${payload}">`, markers: [] },
    { kind: 'vector', html: `<div onclick="${payload}">${t}</div>`, markers: [] },
    { kind: 'vector', html: `<p onmouseover="${payload}">${t}</p>`, markers: [] },
    { kind: 'vector', html: `<a href="javascript:${payload}">${t}</a>`, markers: [] },
    { kind: 'vector', html: `<a href="JavaScript:${payload}">${t}</a>`, markers: [] },
    { kind: 'vector', html: `<img src="javascript:${payload}">`, markers: [] },
    { kind: 'vector', html: `<svg onload="${payload}"></svg>`, markers: [] },
  ];
}

const safePartArb: fc.Arbitrary<Part> = fc
  .record({ t: tokenArb, i: fc.nat() })
  .map(({ t, i }) => {
    const parts = safeParts(t);
    return parts[i % parts.length];
  });

const vectorPartArb: fc.Arbitrary<Part> = fc
  .record({ t: tokenArb, payload: payloadArb, i: fc.nat() })
  .map(({ t, payload, i }) => {
    const parts = vectorParts(t, payload);
    return parts[i % parts.length];
  });

/**
 * A fragment that always mixes safe formatting with script vectors: at least
 * one of each, interleaved (safe, vector, safe, vector, ...) so vectors sit
 * adjacent to the formatting they must not damage.
 */
const mixedFragmentArb: fc.Arbitrary<Part[]> = fc
  .record({
    safe: fc.array(safePartArb, { minLength: 1, maxLength: 6 }),
    vectors: fc.array(vectorPartArb, { minLength: 1, maxLength: 6 }),
  })
  .map(({ safe, vectors }) => {
    const merged: Part[] = [];
    const n = Math.max(safe.length, vectors.length);
    for (let k = 0; k < n; k++) {
      if (k < safe.length) merged.push(safe[k]);
      if (k < vectors.length) merged.push(vectors[k]);
    }
    return merged;
  });

describe('sanitizeHtml (Property 11: sanitization removes script vectors while preserving safe formatting)', () => {
  it('drops every script vector yet keeps safe formatting (incl. KaTeX & Shiki) for any mixed fragment', () => {
    fc.assert(
      fc.property(mixedFragmentArb, (parts) => {
        const fragment = parts.map((p) => p.html).join('\n');
        const out = sanitizeHtml(fragment);

        // (a) No <script> element survives (element + contents are stripped).
        expect(out).not.toMatch(/<script/i);

        // (b) No event-handler (on*) attribute survives. Tokens/payloads never
        // contain `=`, so this can only match a genuinely leaked handler.
        expect(out).not.toMatch(/\son[a-z]+\s*=/i);

        // (c) No javascript: link target survives on any href/src.
        expect(out.toLowerCase()).not.toContain('javascript:');

        // Safe formatting is retained: every safe element, its allowed
        // attributes, and its text (incl. KaTeX/MathML and Shiki markup).
        for (const part of parts) {
          if (part.kind !== 'safe') continue;
          for (const marker of part.markers) {
            expect(out).toContain(marker);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('sanitizes a representative fragment: strips scripts/handlers/js-urls, keeps KaTeX & Shiki', () => {
    const fragment = [
      '<p>Intro <strong>bold</strong> <em>italic</em> <code>inline()</code> <a href="https://example.com/page">link</a></p>',
      '<span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="mord mathnormal">x</span></span></span>',
      '<pre class="shiki" style="background-color:#0d1117" tabindex="0"><code><span class="line"><span style="color:#79b8ff">const</span></span></code></pre>',
      "<script>alert('xss')</script>",
      '<img src="p.png" onerror="alert(1)">',
      '<a href="javascript:alert(2)">x</a>',
      '<a href="JavaScript:alert(3)">y</a>',
      '<p onmouseover="alert(4)">z</p>',
      '<svg onload="alert(5)"></svg>',
    ].join('\n');

    const out = sanitizeHtml(fragment);

    // Script vectors removed.
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onmouseover');
    expect(out).not.toContain('onload');
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
    expect(out.toLowerCase()).not.toContain('javascript:');

    // Safe formatting retained.
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<code>inline()</code>');
    expect(out).toContain('href="https://example.com/page"');

    // KaTeX / MathML markup retained.
    expect(out).toContain('class="katex"');
    expect(out).toContain('<math');
    expect(out).toContain('aria-hidden="true"');

    // Shiki syntax-highlight markup retained.
    expect(out).toContain('class="shiki"');
    expect(out).toContain('color:#79b8ff');
  });

  it('exposes a schema that forbids scripts, on* handlers, and javascript: targets', () => {
    // <script> is never an allowed element.
    expect(sanitizeSchema.tagNames ?? []).not.toContain('script');

    // No attribute allow-list (global or per-tag) permits an on* handler.
    const attributeNames = Object.values(sanitizeSchema.attributes ?? {})
      .flat()
      .map((def) => (Array.isArray(def) ? def[0] : def))
      .filter((name): name is string => typeof name === 'string');
    expect(attributeNames.some((name) => /^on/i.test(name))).toBe(false);

    // javascript: is not an allowed protocol for link/media targets.
    expect(sanitizeSchema.protocols?.href ?? []).not.toContain('javascript');
    expect(sanitizeSchema.protocols?.src ?? []).not.toContain('javascript');
  });
});
