/**
 * Content ingestor orchestration for the Ingestion Domain (L1).
 *
 * This is the composition root of the pure ingestion pipeline. It takes the
 * flat list of discovered {@link RawNode}s (files + folders, already restricted
 * to `.md` Notes upstream by the sync step and Astro's glob loader) together
 * with an injected {@link NoteReader}, and produces the three artifacts the
 * Astro integration layer consumes: the ordered {@link ContentEntry} list, the
 * navigation {@link CategoryNode} tree, and a structured {@link IngestReport}.
 *
 * It stays framework-free and filesystem-free — exactly like the rest of the
 * Ingestion Domain — by DEPENDENCY-INJECTING the read step: the caller passes a
 * `readNote` function that turns a Note node into its {@link NoteSource} (body +
 * frontmatter-derived fields). The real build wires a filesystem/Astro reader;
 * tests wire a reader that fails for an arbitrary subset of Notes. This is what
 * makes the partial-failure behaviour (Design Property 6) directly
 * property-testable without touching disk.
 *
 * Partial-failure handling (Req 1.8): when `readNote` throws (or yields no
 * content) for a Note, the orchestrator records a structured {@link IngestError}
 * that identifies the Note's absolute file path, EXCLUDES that Note from both
 * the produced entries and the tree, and CONTINUES with the remaining Notes —
 * the run never throws because of a single bad Note.
 *
 * Empty content root (Req 1.9): an empty node list (or one with no readable
 * Notes) completes cleanly, returning an empty entry list, an empty tree root,
 * and an empty error report.
 *
 * Composition (no ordering/slug/route logic is reimplemented here):
 *   - {@link buildTree}      assembles + orders + slugs + routes the hierarchy.
 *   - {@link collectEntries} walks the tree, attaching each Note's ordered
 *     ancestor chain (Req 1.2, 5.5).
 * The orchestrator only decides WHICH Notes survive and pairs each surviving
 * Note with the body/metadata the reader returned (keyed by absolute path).
 */

import type { CategoryNode, ContentEntry, Heading, RawNode } from './types';
import { buildTree, collectEntries, type BuildTreeOptions } from './tree';

/**
 * The content of a single Note, as returned by an injected {@link NoteReader}.
 *
 * The reader is responsible for reading the file and separating frontmatter
 * from the Markdown body; only the fields the pure pipeline needs are surfaced
 * here. The Display_Name, Slug, route, order, and ancestor chain are derived
 * from the file/folder NAMES by the tree builder — never from frontmatter — so
 * they are intentionally absent from this shape.
 */
export interface NoteSource {
  /** Raw Markdown body with frontmatter removed. */
  body: string;
  /**
   * Publication flag. Defaults to `true` when omitted; unpublished Notes are
   * filtered out of routes and the sitemap downstream (Req 10.2).
   */
  published?: boolean;
  /** Optional frontmatter meta-description override (Req 10.5). */
  description?: string;
  /**
   * Headings extracted from the rendered Note (Astro Markdown metadata), used
   * to build the table of contents (Req 4). Defaults to an empty list when the
   * reader does not supply them.
   */
  headings?: Heading[];
}

/**
 * Reads one Note's {@link NoteSource}.
 *
 * MUST signal an unreadable/unparseable Note by THROWING (any thrown value is
 * accepted) or by returning a nullish value; either causes the orchestrator to
 * record a structured error against the Note's absolute path and exclude it,
 * without aborting the run (Req 1.8).
 *
 * @param node The Note {@link RawNode} to read (its `absPath` locates the file).
 */
export type NoteReader = (node: RawNode) => NoteSource | null | undefined;

/**
 * A structured, per-Note ingestion failure. One is recorded for every Note that
 * could not be read or parsed; `sourcePath` is the Note's absolute file path so
 * the Site_Owner can locate the offending file (Req 1.8).
 */
export interface IngestError {
  /** Absolute source path of the Note that failed (Req 1.8). */
  sourcePath: string;
  /** Human-readable description of the failure. */
  message: string;
  /**
   * The original thrown value, preserved for diagnostics. Undefined when the
   * reader signalled failure by returning a nullish value rather than throwing.
   */
  cause?: unknown;
}

/**
 * The ingestion report: everything a run surfaced without failing on it.
 * Currently the set of excluded Notes (Req 1.8); the shape is intentionally
 * open to grow (e.g. slug substitutions/collisions) without breaking callers.
 */
export interface IngestReport {
  /** One entry per excluded Note, each identifying its absolute file path. */
  errors: IngestError[];
}

/** The complete result of an ingestion run: `{ entries, tree, report }`. */
export interface IngestResult {
  /**
   * Content entries for EXACTLY the readable Notes, in navigation (display)
   * order — the pre-order walk of the ordered tree.
   */
  entries: ContentEntry[];
  /** The navigation tree root (Categories + surviving Notes), ordered per Req 1.5/1.6. */
  tree: CategoryNode;
  /** Structured report of excluded Notes (Req 1.8). */
  report: IngestReport;
}

/** Options forwarded to {@link buildTree} (section slug / root display name). */
export type IngestOptions = BuildTreeOptions;

/**
 * Orchestrate ingestion of a discovered node list into content entries, a
 * navigation tree, and a report.
 *
 * @param nodes    Discovered files + folders. Notes are `isNote: true`; every
 *                 other node is treated as a Category. Input order is
 *                 irrelevant — {@link buildTree} orders siblings deterministically.
 * @param readNote Injected reader that returns each Note's {@link NoteSource};
 *                 throws or returns nullish to mark a Note unreadable (Req 1.8).
 * @param options  Optional section slug / root display-name overrides.
 * @returns `{ entries, tree, report }`. Never throws on a per-Note failure; an
 *          empty input completes cleanly with empty artifacts (Req 1.9).
 */
export function ingest(
  nodes: readonly RawNode[],
  readNote: NoteReader,
  options: IngestOptions = {},
): IngestResult {
  const errors: IngestError[] = [];
  // Note body/metadata keyed by absolute source path, for pairing with the
  // tree's Note nodes after assembly.
  const sourcesByPath = new Map<string, NoteSource>();
  // Categories (folders) are always retained; Notes are retained only when the
  // reader succeeds, so failing Notes are excluded from BOTH the tree and the
  // entries (Req 1.8).
  const survivors: RawNode[] = [];

  for (const node of nodes) {
    if (!node.isNote) {
      survivors.push(node);
      continue;
    }

    let source: NoteSource | null | undefined;
    try {
      source = readNote(node);
    } catch (error) {
      errors.push({
        sourcePath: node.absPath,
        message:
          error instanceof Error
            ? error.message
            : `Failed to read Note: ${String(error)}`,
        cause: error,
      });
      continue;
    }

    if (source == null) {
      errors.push({
        sourcePath: node.absPath,
        message: 'Note reader returned no content.',
      });
      continue;
    }

    sourcesByPath.set(node.absPath, source);
    survivors.push(node);
  }

  // Assemble the ordered/slugged/routed hierarchy from the survivors, then walk
  // it to obtain every Note together with its ordered ancestor chain. buildTree
  // tolerates an empty survivor list, returning an empty root (Req 1.9).
  const tree = buildTree([...survivors], options);
  const treeEntries = collectEntries(tree);

  const entries: ContentEntry[] = [];
  for (const { note, ancestors } of treeEntries) {
    // Every surviving Note originated from a RawNode whose absolute path was
    // threaded onto the tree node, so this lookup resolves for all readable
    // Notes. The guard keeps the function total if a node without provenance
    // ever reaches here (e.g. a synthesized node).
    const sourcePath = note.sourcePath;
    const source =
      sourcePath != null ? sourcesByPath.get(sourcePath) : undefined;
    if (sourcePath == null || source === undefined) {
      continue;
    }

    entries.push({
      id: note.entryId,
      sectionSlug: tree.slug,
      slug: note.slug,
      route: note.route,
      displayName: note.displayName,
      order: note.order,
      ancestors,
      body: source.body,
      headings: source.headings ?? [],
      sourcePath,
      published: source.published ?? true,
      ...(source.description !== undefined
        ? { description: source.description }
        : {}),
    });
  }

  return { entries, tree, report: { errors } };
}
