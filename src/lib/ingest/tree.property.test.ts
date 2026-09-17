import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { ingest } from './ingest';
import { collectEntries } from './tree';
import { parseName } from './prefix';
import type { RawNode } from './types';

// Feature: portfolio-website, Property 4: For any generated Category/Note hierarchy (to at least six levels deep), each produced ContentEntry contains a Body, a Display_Name, a Slug, and an ancestor list whose elements equal, in order, the Categories from the content root down to the Note's immediate parent. The breadcrumb trail derived for that Note equals the same ancestor chain (landing → … → parent) with matching routes.

// Validates: Requirements 1.2, 1.7, 5.5

/**
 * Property 4: Content entries carry the correct ordered ancestor chain.
 *
 * Validates: Requirements 1.2, 1.7, 5.5
 *
 * Strategy — we generate an abstract Category/Note hierarchy, flatten it into
 * the flat {@link RawNode} list a filesystem walk would yield (a folder node
 * per Category and a file node per Note, all rooted under `/content`), and run
 * it through the real {@link ingest} orchestrator with a reader that always
 * succeeds. Every generated tree is forced to contain a spine of at least six
 * nested Categories (Req 1.7), so the ancestor chain is exercised well beyond
 * the required depth on every run.
 *
 * The oracle is derived from the *generated input*, independently of the tree
 * builder's internals: while flattening we record, for each Note, the ordered
 * list of Category Display_Names on its path (computed with {@link parseName},
 * the same rule the design mandates). For each produced ContentEntry we then
 * assert it:
 *   - carries a non-empty Body equal to what the reader returned,
 *   - carries the expected Display_Name and a well-formed, non-empty Slug,
 *   - has an ancestor list beginning with the section landing (`Notes` /
 *     `/notes`) followed, in order, by exactly the Categories from the content
 *     root down to its immediate parent, and
 *   - has a breadcrumb trail (from {@link collectEntries}) equal to that same
 *     ancestor chain, with routes that chain consistently (each ancestor route
 *     extends its parent by `"/" + slug`, and the Note route extends its
 *     immediate parent likewise) — i.e. "matching routes".
 *
 * Emitting an explicit folder node for every Category pins the ingestor's
 * content root at `/content` (a top-level folder's parent directory is exactly
 * `[content]`), so the full Category path is preserved regardless of how the
 * random branches are shaped.
 */

/** An abstract, pre-ingestion tree node used only to drive generation. */
type AbsNode =
  | { kind: 'cat'; name: string; children: AbsNode[] }
  | { kind: 'note'; name: string };

/** Display_Name a raw name resolves to — the design's parsing rule (Req 1.4). */
const dn = (rawName: string): string => parseName(rawName).displayName;

// --- Name generation --------------------------------------------------------

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letterArb = fc.constantFrom(...LETTERS.split(''));

/**
 * "Rich" trailing characters: a deliberate mix of spaces, prefix separators,
 * punctuation, digits, and non-ASCII letters so slug normalization, diacritic
 * stripping, and Order_Prefix parsing are all exercised.
 */
const richArb = fc.constantFrom(...' -_.&()!éüñ0123456789xYz'.split(''));

/**
 * A raw name whose Display_Name is guaranteed non-empty: it always starts with
 * an ASCII letter (so the Order_Prefix parser can never consume it entirely and
 * its Slug never collapses to the `untitled` fallback), optionally prefixed by
 * a numeric Order_Prefix + separator to exercise prefix stripping.
 */
const nameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.option(
      fc.tuple(fc.integer({ min: 0, max: 999_999_999 }), fc.constantFrom(' ', '-', '_', '.')),
      { nil: undefined },
    ),
    fc.tuple(letterArb, fc.array(richArb, { maxLength: 6 })).map(([lead, rest]) => lead + rest.join('')),
  )
  .map(([prefix, core]) => (prefix === undefined ? core : `${prefix[0]}${prefix[1]}${core}`));

/** A bounded, possibly-branching random subtree (depth budget `depth`). */
function absNodeArb(depth: number): fc.Arbitrary<AbsNode> {
  const noteArb = nameArb.map((name): AbsNode => ({ kind: 'note', name }));
  if (depth <= 1) return noteArb;

  const catArb = fc
    .tuple(nameArb, fc.array(absNodeArb(depth - 1), { maxLength: 3 }))
    .map(([name, children]): AbsNode => ({ kind: 'cat', name, children }));

  // Bias toward categories so the random branches contribute some depth/variety
  // (the mandatory deep spine below guarantees the >= 6 level requirement).
  return fc.oneof({ weight: 1, arbitrary: noteArb }, { weight: 2, arbitrary: catArb });
}

/**
 * Builds a linear spine of >= 6 nested Categories, guaranteeing the "at least
 * six levels deep" requirement (Req 1.7). The deepest Category always holds at
 * least one Note; each intermediate spine Category may hold an extra sibling
 * Note so ancestor chains of many different lengths are produced.
 */
function buildSpine(spineNames: string[], midNotes: (string | undefined)[], deepNotes: string[]): AbsNode {
  const depth = spineNames.length;

  let node: AbsNode = {
    kind: 'cat',
    name: spineNames[depth - 1]!,
    children: deepNotes.map((name): AbsNode => ({ kind: 'note', name })),
  };

  for (let i = depth - 2; i >= 0; i--) {
    const children: AbsNode[] = [node];
    const extra = midNotes[i];
    if (extra !== undefined) {
      children.push({ kind: 'note', name: extra });
    }
    node = { kind: 'cat', name: spineNames[i]!, children };
  }

  return node;
}

/**
 * Ensures every sibling in a group has a distinct *path segment* (a folder uses
 * its name; a Note uses `name + ".md"`), so no two siblings merge into one tree
 * node. Collisions are broken by appending ` <n>` to the raw name, which keeps
 * the name non-empty and letter-led, so its Display_Name stays non-empty.
 */
function ensureUniqueSegments(siblings: AbsNode[]): void {
  const used = new Set<string>();
  const segmentOf = (node: AbsNode): string => (node.kind === 'note' ? `${node.name}.md` : node.name);

  for (const node of siblings) {
    if (used.has(segmentOf(node))) {
      const original = node.name;
      let n = 2;
      node.name = `${original} ${n}`;
      while (used.has(segmentOf(node))) {
        n += 1;
        node.name = `${original} ${n}`;
      }
    }
    used.add(segmentOf(node));
    if (node.kind === 'cat') ensureUniqueSegments(node.children);
  }
}

/** A Note's expected identity + ordered Category Display_Name chain (root -> parent). */
interface ExpectedNote {
  sourcePath: string;
  noteDisplayName: string;
  ancestorDisplayNames: string[];
}

/**
 * Flattens the abstract tree into the flat node list a walk would produce and,
 * in the same pass, records each Note's oracle (its absolute path, its own
 * Display_Name, and the ordered Display_Names of its ancestor Categories).
 */
function flatten(roots: AbsNode[]): { rawNodes: RawNode[]; expected: ExpectedNote[] } {
  const rawNodes: RawNode[] = [];
  const expected: ExpectedNote[] = [];

  const walk = (node: AbsNode, parentSegments: string[], displayChain: string[]): void => {
    if (node.kind === 'note') {
      const fileName = `${node.name}.md`;
      const absPath = '/' + [...parentSegments, fileName].join('/');
      rawNodes.push({ absPath, rawName: fileName, isNote: true });
      expected.push({
        sourcePath: absPath,
        noteDisplayName: dn(node.name),
        ancestorDisplayNames: [...displayChain],
      });
      return;
    }

    const segments = [...parentSegments, node.name];
    rawNodes.push({ absPath: '/' + segments.join('/'), rawName: node.name, isNote: false });
    const childChain = [...displayChain, dn(node.name)];
    for (const child of node.children) {
      walk(child, segments, childChain);
    }
  };

  for (const root of roots) {
    walk(root, ['content'], []);
  }

  return { rawNodes, expected };
}

/** The complete generated hierarchy: a mandatory deep spine plus random branches. */
const hierarchyArb = fc
  .record({
    spineNames: fc.array(nameArb, { minLength: 6, maxLength: 7 }),
    midNotes: fc.array(fc.option(nameArb, { nil: undefined }), { minLength: 6, maxLength: 7 }),
    deepNotes: fc.array(nameArb, { minLength: 1, maxLength: 2 }),
    forest: fc.array(absNodeArb(3), { maxLength: 2 }),
  })
  .map(({ spineNames, midNotes, deepNotes, forest }) => {
    const roots: AbsNode[] = [buildSpine(spineNames, midNotes, deepNotes), ...forest];
    ensureUniqueSegments(roots);
    return roots;
  });

/** Reader that always succeeds, returning a body uniquely tied to the source path. */
const readNote = (node: RawNode): { body: string } => ({ body: `BODY:${node.absPath}` });

const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('buildTree / ingest — ordered ancestor chain in content entries (Property 4)', () => {
  it('gives every entry a body, display name, slug, and the exact root->parent ancestor chain', () => {
    fc.assert(
      fc.property(hierarchyArb, (roots) => {
        const { rawNodes, expected } = flatten(roots);
        const expectedBySource = new Map(expected.map((e) => [e.sourcePath, e]));
        // Oracle sanity: source paths are unique, so the map is a faithful bijection.
        expect(expectedBySource.size).toBe(expected.length);

        const { entries, tree, report } = ingest(rawNodes, readNote);

        // Every Note is readable, so none are excluded and exactly one entry is
        // produced per Note (Req 1.2).
        expect(report.errors).toEqual([]);
        expect(entries.length).toBe(expected.length);
        expect(entries.length).toBeGreaterThan(0);

        // The breadcrumb trail for each Note, derived independently from the
        // built tree, keyed by source path (Req 5.5).
        const breadcrumbBySource = new Map(
          collectEntries(tree)
            .filter((te) => te.note.sourcePath !== undefined)
            .map((te) => [te.note.sourcePath!, te.ancestors]),
        );

        for (const entry of entries) {
          const oracle = expectedBySource.get(entry.sourcePath);
          expect(oracle).toBeDefined();
          if (!oracle) continue;

          // (Body) present and exactly what the reader returned.
          expect(entry.body).toBe(`BODY:${entry.sourcePath}`);
          expect(entry.body.length).toBeGreaterThan(0);

          // (Display_Name) present, non-empty, and the parsed name of the Note.
          expect(typeof entry.displayName).toBe('string');
          expect(entry.displayName.length).toBeGreaterThan(0);
          expect(entry.displayName).toBe(oracle.noteDisplayName);

          // (Slug) present and well-formed per the slug invariant.
          expect(entry.slug).toMatch(SLUG_FORMAT);

          // (Ancestors) begin with the section landing, then the Categories from
          // the content root down to the immediate parent, in order.
          expect(entry.ancestors.length).toBe(oracle.ancestorDisplayNames.length + 1);
          expect(entry.ancestors[0]!).toEqual({ displayName: 'Notes', slug: 'notes', route: '/notes' });
          expect(entry.ancestors.slice(1).map((a) => a.displayName)).toEqual(oracle.ancestorDisplayNames);

          // (Matching routes) each ancestor route extends its parent by "/" + slug,
          // and the Note route extends its immediate parent likewise.
          for (let i = 1; i < entry.ancestors.length; i++) {
            const prev = entry.ancestors[i - 1]!;
            const curr = entry.ancestors[i]!;
            expect(curr.route).toBe(`${prev.route}/${curr.slug}`);
          }
          const parent = entry.ancestors[entry.ancestors.length - 1]!;
          expect(entry.route).toBe(`${parent.route}/${entry.slug}`);
          expect(entry.id).toBe(entry.route);

          // (Breadcrumb == ancestor chain) the trail derived from the tree equals
          // the entry's ancestor chain element-for-element, routes included.
          expect(breadcrumbBySource.get(entry.sourcePath)).toEqual(entry.ancestors);
        }

        // The hierarchy really reached at least six Category levels below the
        // root on this run: the deepest entry has root + >= 6 ancestors (Req 1.7).
        const maxAncestors = Math.max(...entries.map((e) => e.ancestors.length));
        expect(maxAncestors).toBeGreaterThanOrEqual(7);
      }),
      { numRuns: 100 },
    );
  });
});
