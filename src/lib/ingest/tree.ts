/**
 * Navigation tree assembly for the Ingestion Domain (L1).
 *
 * Pure, framework-free logic: no dependency on Astro, the filesystem, or the
 * DOM. Given a flat list of {@link RawNode}s (files and folders discovered while
 * walking the content source), `buildTree` reconstructs the Category/Note
 * hierarchy — supporting arbitrary nesting depth (well beyond the required six
 * levels, Req 1.7) — and returns the section's root {@link CategoryNode}.
 *
 * The assembly composes the existing pure helpers so all deterministic rules
 * live in one place each:
 *   - {@link parseName}      — strips the Order_Prefix, derives the Display_Name.
 *   - {@link orderingKey} + {@link compareSiblings} — order siblings
 *     "prefixed-first, then ascending order value, then alphabetical" (Req 1.5, 1.6, 5.1).
 *   - {@link slugify} + {@link dedupeSlug} — URL-safe Slugs, deduped per parent
 *     scope (Req 1.3, 2.1, 2.3).
 *   - {@link buildRoute}     — canonical absolute route per entry (Req 2.2).
 *
 * `collectEntries` walks the built tree and attaches each Note's ordered
 * ancestor chain (content root → … → immediate parent), which doubles as the
 * breadcrumb trail (Req 1.2, 5.5).
 *
 * Because every step depends only on the input list and the deterministic
 * helpers (a stable sort preserves input order for exact ties), ingesting the
 * same hierarchy twice yields identical Slugs and routes (Design Property 8).
 */

import type {
  CategoryNode,
  CategoryRef,
  NoteNode,
  RawNode,
  TreeNode,
} from './types';
import { parseName } from './prefix';
import { orderingKey, compareSiblings } from './order';
import { slugify, dedupeSlug } from './slug';
import { buildRoute } from './route';

/** Options controlling how the section root node is labelled and routed. */
export interface BuildTreeOptions {
  /**
   * The section Slug that prefixes every route in the tree (Req 11.6).
   * Defaults to `'notes'` — the only section in the initial release.
   */
  sectionSlug?: string;
  /** Human-readable label for the section root (breadcrumb landing). Defaults to `'Notes'`. */
  rootDisplayName?: string;
}

/**
 * A Note paired with its ordered ancestor chain.
 *
 * `ancestors` runs from the section landing (the root Category) down to the
 * Note's immediate parent Category, so it is exactly the breadcrumb trail and
 * the source of a ContentEntry's `ancestors` list (Req 1.2, 5.5).
 */
export interface TreeEntry {
  note: NoteNode;
  ancestors: CategoryRef[];
}

const DEFAULT_SECTION_SLUG = 'notes';
const DEFAULT_ROOT_DISPLAY_NAME = 'Notes';

/**
 * Mutable intermediate node used while reconstructing the hierarchy from paths.
 * Converted to the immutable {@link CategoryNode}/{@link NoteNode} shapes once
 * the full structure is known.
 */
interface BuilderNode {
  /** Authoritative raw name (from the explicit RawNode, else the path segment). */
  rawName: string;
  /** true once an explicit RawNode marks this path as a Note (.md file). */
  isNote: boolean;
  /**
   * Absolute source path recorded from the explicit RawNode at this path, so a
   * Note's provenance can be carried onto its {@link NoteNode} (Req 1.8, 3.7).
   * Undefined for synthesized intermediate Categories that have no own RawNode.
   */
  absPath?: string;
  /** Children keyed by their path segment, preserving first-seen insertion order. */
  children: Map<string, BuilderNode>;
}

/**
 * Reconstructs the Category/Note hierarchy from a flat list of discovered
 * nodes and returns the section's root {@link CategoryNode}.
 *
 * Structure is derived from each node's `absPath`: the shallowest directory
 * shared by every node is treated as the content root, and the remaining path
 * segments position each entry within the tree. Both `/` and `\\` separators
 * are accepted. Intermediate Categories are synthesized when a Note's path
 * implies a folder that has no explicit RawNode of its own.
 *
 * The returned root carries the section Slug/route (`'/' + sectionSlug`); its
 * children and their descendants are ordered and slugged per the design rules.
 *
 * @param nodes The discovered files and folders (order is irrelevant; ties are
 *   resolved deterministically). An empty list yields an empty root.
 * @param options Optional section Slug / root label overrides.
 */
export function buildTree(
  nodes: RawNode[],
  options: BuildTreeOptions = {},
): CategoryNode {
  const sectionSlug = options.sectionSlug ?? DEFAULT_SECTION_SLUG;
  const rootDisplayName = options.rootDisplayName ?? DEFAULT_ROOT_DISPLAY_NAME;

  const root: BuilderNode = {
    rawName: rootDisplayName,
    isNote: false,
    children: new Map(),
  };

  if (nodes.length > 0) {
    // The content root is the deepest directory that is an ancestor of every
    // node — i.e. the common prefix of all node *parent* directories.
    const parentSegments = nodes.map((node) => toSegments(node.absPath).slice(0, -1));
    const rootDepth = commonPrefixLength(parentSegments);

    for (const node of nodes) {
      const relative = toSegments(node.absPath).slice(rootDepth);
      insertNode(root, relative, node);
    }
  }

  return {
    kind: 'category',
    displayName: rootDisplayName,
    slug: sectionSlug,
    route: '/' + sectionSlug,
    order: 0,
    hasPrefix: false,
    children: buildChildren(root, sectionSlug, []),
  };
}

/**
 * Walks a built tree and returns every Note together with its ordered ancestor
 * chain (section landing → … → immediate parent).
 *
 * The `ancestors` list is exactly the breadcrumb trail for the Note and the
 * `ancestors` field of the Note's ContentEntry, so both derive from a single
 * traversal (Req 1.2, 5.5).
 */
export function collectEntries(root: CategoryNode): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const rootRef = toCategoryRef(root);

  const walk = (node: TreeNode, ancestors: CategoryRef[]): void => {
    if (node.kind === 'note') {
      entries.push({ note: node, ancestors });
      return;
    }
    const childAncestors = [...ancestors, toCategoryRef(node)];
    for (const child of node.children) {
      walk(child, childAncestors);
    }
  };

  for (const child of root.children) {
    walk(child, [rootRef]);
  }

  return entries;
}

/**
 * Inserts one discovered node at its relative segment path, synthesizing any
 * missing intermediate Category builders along the way.
 */
function insertNode(root: BuilderNode, relative: string[], node: RawNode): void {
  if (relative.length === 0) {
    // The node resolves to the content root itself; nothing to attach.
    return;
  }

  let current = root;
  for (let i = 0; i < relative.length; i++) {
    const segment = relative[i]!;
    const isLast = i === relative.length - 1;

    let child = current.children.get(segment);
    if (!child) {
      // Intermediate segments are Categories until proven otherwise; the raw
      // name defaults to the segment and is upgraded if an explicit node arrives.
      child = { rawName: segment, isNote: false, children: new Map() };
      current.children.set(segment, child);
    }

    if (isLast) {
      // The final segment is the node itself: record its authoritative raw name,
      // whether it is a Note (.md file) or a Category (folder), and its absolute
      // source path (used to carry Note provenance downstream, Req 1.8/3.7).
      child.rawName = node.rawName;
      child.isNote = node.isNote;
      child.absPath = node.absPath;
    }

    current = child;
  }
}

/**
 * Converts a builder's children into ordered, slugged, routed {@link TreeNode}s.
 *
 * Siblings are ordered with {@link compareSiblings} (stable sort keeps input
 * order for exact ties, preserving determinism), then Slugs are deduped within
 * this parent scope, and each route is built from the accumulated ancestor
 * Slugs.
 *
 * @param parent The builder whose children are converted.
 * @param sectionSlug The section Slug prefixing every route.
 * @param ancestorSlugs Slugs from the top-level Category down to `parent`
 *   (empty for the root's own children).
 */
function buildChildren(
  parent: BuilderNode,
  sectionSlug: string,
  ancestorSlugs: string[],
): TreeNode[] {
  const prepared = [...parent.children.values()].map((builder) => {
    // A Note's raw name is its file name, so drop the `.md` extension before
    // deriving the Display_Name — the extension is not part of the label or
    // Slug (e.g. "01 - intro.md" -> Display_Name "intro", Slug "intro").
    const rawName = builder.isNote ? stripMarkdownExtension(builder.rawName) : builder.rawName;
    const parsed = parseName(rawName);
    return { builder, parsed, key: orderingKey(parsed) };
  });

  prepared.sort((a, b) => {
    const primary = compareSiblings(a.key, b.key);
    if (primary !== 0) return primary;
    // `compareSiblings` leaves entries whose names are equal case-insensitively
    // as an exact tie. Break it deterministically by the case-sensitive
    // Display_Name, then the raw name, so the assembled tree (and therefore the
    // per-parent Slug dedup order) is independent of the input list order —
    // strengthening reproducibility (Design Property 8).
    if (a.parsed.displayName !== b.parsed.displayName) {
      return a.parsed.displayName < b.parsed.displayName ? -1 : 1;
    }
    if (a.builder.rawName !== b.builder.rawName) {
      return a.builder.rawName < b.builder.rawName ? -1 : 1;
    }
    return 0;
  });

  const taken = new Set<string>();
  const result: TreeNode[] = [];

  for (const { builder, parsed, key } of prepared) {
    const slug = dedupeSlug(slugify(parsed.displayName), taken);
    const route = buildRoute(sectionSlug, ancestorSlugs, slug);
    const hasPrefix = parsed.order != null;

    if (builder.isNote) {
      result.push({
        kind: 'note',
        entryId: route,
        displayName: parsed.displayName,
        slug,
        route,
        order: key.order,
        hasPrefix,
        // Carry the file's absolute path so the ingestor can attach body/meta
        // and report per-file failures (Req 1.8, 3.7). Always defined for a
        // real Note (set in insertNode); guarded for robustness.
        ...(builder.absPath !== undefined ? { sourcePath: builder.absPath } : {}),
      });
    } else {
      result.push({
        kind: 'category',
        displayName: parsed.displayName,
        slug,
        route,
        order: key.order,
        hasPrefix,
        children: buildChildren(builder, sectionSlug, [...ancestorSlugs, slug]),
      });
    }
  }

  return result;
}

/** Removes a trailing `.md` extension (case-insensitive) from a Note file name. */
function stripMarkdownExtension(name: string): string {
  return /\.md$/i.test(name) ? name.slice(0, -'.md'.length) : name;
}

/** Projects a Category node to the lightweight reference used in ancestor chains. */
function toCategoryRef(node: CategoryNode): CategoryRef {
  return { displayName: node.displayName, slug: node.slug, route: node.route };
}

/**
 * Splits an absolute path into non-empty segments, accepting both `/` and `\\`
 * separators so Windows and POSIX paths reconstruct identically.
 */
function toSegments(absPath: string): string[] {
  return absPath.replace(/\\/g, '/').split('/').filter((segment) => segment.length > 0);
}

/** Returns the number of leading segments shared by every array in `lists`. */
function commonPrefixLength(lists: string[][]): number {
  if (lists.length === 0) return 0;

  const maxLength = Math.min(...lists.map((list) => list.length));
  for (let i = 0; i < maxLength; i++) {
    const segment = lists[0]![i];
    for (const list of lists) {
      if (list[i] !== segment) return i;
    }
  }
  return maxLength;
}
