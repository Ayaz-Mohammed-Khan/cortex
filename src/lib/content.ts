/**
 * Build-time bridge between Astro Content Collections and the pure Ingestion
 * Domain (`src/lib/ingest/*`).
 *
 * This is the single place where the framework-free ingestion logic meets
 * Astro's `astro:content` API. It:
 *
 *   1. reads the `notes` collection (`getCollection`);
 *   2. turns each entry's on-disk path into a {@link RawNode};
 *   3. runs the pure {@link ingest} orchestration to obtain the ordered
 *      {@link ContentEntry} list and the navigation {@link CategoryNode} tree;
 *   4. assembles the {@link SiteModel} (notes is the only Section today);
 *   5. precomputes everything `getStaticPaths` and the page templates need,
 *      keyed by route.
 *
 * The result is memoized for the whole build so `getStaticPaths` and each page
 * render share one ingestion pass.
 *
 * ## Forcing the notes directory as the content root
 *
 * `buildTree` derives the content root as the deepest directory shared by every
 * Note. When *all* Notes happen to live under a single top-level folder (e.g.
 * only `AI-ML/...` exists), that folder would be absorbed as the root and drop
 * out of every route. To keep `src/content/notes` as the stable root regardless
 * of content shape, we inject a single **phantom Note** located directly in the
 * notes base directory. Its presence pins the deepest-common-ancestor to the
 * base; we then drop the phantom from the produced tree and entries so it is
 * invisible to the site. See {@link PHANTOM_SOURCE_PATH}.
 */

import { getCollection, render, type CollectionEntry } from 'astro:content';
import { posix } from 'node:path';
import { ingest, type NoteReader, type NoteSource } from './ingest/ingest';
import type {
  CategoryNode,
  CategoryRef,
  ContentEntry,
  NoteNode,
  RawNode,
  TreeNode,
} from './ingest/types';
import { collectEntries } from './ingest/tree';
import {
  buildSiteModel,
  NOTES_SECTION_SLUG,
  type SiteModel,
} from './section';
import { publishedRoutes } from './sitemap-filter';
import { buildBacklinkIndex, type BacklinkRef } from './markdown/backlink-index';

/** The `notes` collection entry type. */
export type NoteEntry = CollectionEntry<'notes'>;

/**
 * Synthetic root under which every Note's path is re-anchored. Using a fixed
 * marker makes ingestion independent of whether `filePath` is absolute or
 * project-relative and independent of the host OS.
 */
const SYNTHETIC_ROOT = '/__notes_root__';

/** Tail of {@link NOTES_TARGET_DIR}; located within each entry's `filePath`. */
const BASE_MARKER = 'src/content/notes';

/** Absolute (synthetic) path of the phantom root-pinning Note (see file docs). */
const PHANTOM_SOURCE_PATH = `${SYNTHETIC_ROOT}/__phantom_root_marker__.md`;

/** Section display name / landing label for the notes Section. */
const NOTES_DISPLAY_NAME = 'Notes';

/** Normalize a path to forward slashes for uniform POSIX handling. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Re-anchor a collection entry's `filePath` under {@link SYNTHETIC_ROOT},
 * preserving the folder structure below the notes base directory. Falls back to
 * the bare file name when the base marker is absent (unexpected).
 */
function syntheticPathFor(filePath: string): string {
  const norm = toPosix(filePath);
  const idx = norm.lastIndexOf(BASE_MARKER);
  const rel =
    idx >= 0
      ? norm.slice(idx + BASE_MARKER.length).replace(/^\/+/, '')
      : posix.basename(norm);
  return `${SYNTHETIC_ROOT}/${rel}`;
}

/** Per-route data for a rendered Note page. */
export interface NoteRoute {
  kind: 'note';
  /** Absolute route, e.g. `/notes/ai-ml/intro`. */
  route: string;
  /** The Astro collection entry, used to `render()` the Markdown body. */
  entry: NoteEntry;
  /** The structured content entry (Display_Name, ancestors, body, published…). */
  content: ContentEntry;
}

/** Per-route data for a Category listing page. */
export interface CategoryRoute {
  kind: 'category';
  /** Absolute route, e.g. `/notes/ai-ml` (or `/notes` for the section root). */
  route: string;
  /** The Category node whose children are listed. */
  node: CategoryNode;
  /** Ordered ancestor chain (section landing → … → parent), excluding self. */
  ancestors: CategoryRef[];
}

/** Union of the two page kinds served by `src/pages/notes/[...slug].astro`. */
export type RouteData = NoteRoute | CategoryRoute;

/** A single entry for `getStaticPaths`. */
export interface StaticPathEntry {
  /** Rest-parameter value: route without the `/notes` prefix; `undefined` for `/notes`. */
  slug: string | undefined;
  /** The full route this path corresponds to. */
  route: string;
}

/** Everything the routing layer needs, computed once per build. */
export interface LoadedSite {
  /** The notes Section navigation tree root. */
  tree: CategoryNode;
  /** All published Note content entries, in display order. */
  entries: ContentEntry[];
  /** The whole-site model (notes is the only Section today). */
  siteModel: SiteModel;
  /** `getStaticPaths` inputs: one per Category and per published Note. */
  paths: StaticPathEntry[];
  /** Route → page data lookup used by the page template. */
  byRoute: Map<string, RouteData>;
  /** Routes of published Notes (for reference / sitemap parity). */
  publishedNoteRoutes: string[];
  /**
   * Backlink ("Linked mentions") index: TARGET note route -> the published
   * notes that link to it via `[[wikilinks]]`. Computed once per build. See
   * `buildBacklinkIndex`.
   */
  backlinks: Map<string, BacklinkRef[]>;
}

/** Convert an absolute route to the `[...slug]` rest parameter value. */
function routeToSlug(route: string): string | undefined {
  const prefix = `/${NOTES_SECTION_SLUG}`;
  if (route === prefix) return undefined;
  return route.slice(prefix.length + 1); // drop "/notes/"
}

/** Project a Category node to the lightweight ancestor reference shape. */
function toRef(node: CategoryNode): CategoryRef {
  return { displayName: node.displayName, slug: node.slug, route: node.route };
}

let cached: Promise<LoadedSite> | null = null;

/**
 * Load, ingest, and index the notes Section. Memoized for the whole build.
 */
export function loadSite(): Promise<LoadedSite> {
  return (cached ??= buildSite());
}

async function buildSite(): Promise<LoadedSite> {
  const collection = await getCollection('notes');

  // Map each entry to a synthetic source path and index it for the reader.
  const entryByPath = new Map<string, NoteEntry>();
  const rawNodes: RawNode[] = [];
  for (const entry of collection) {
    if (!entry.filePath) continue;
    const absPath = syntheticPathFor(entry.filePath);
    entryByPath.set(absPath, entry);
    rawNodes.push({
      absPath,
      rawName: posix.basename(absPath),
      isNote: true,
    });
  }

  // Phantom Note pins the content root to the notes base directory (see docs).
  rawNodes.push({
    absPath: PHANTOM_SOURCE_PATH,
    rawName: posix.basename(PHANTOM_SOURCE_PATH),
    isNote: true,
  });

  const readNote: NoteReader = (node): NoteSource | null => {
    if (node.absPath === PHANTOM_SOURCE_PATH) {
      // Survive ingestion so it influences root inference; filtered out below.
      return { body: '', published: false };
    }
    const entry = entryByPath.get(node.absPath);
    if (!entry) return null;
    return {
      body: entry.body ?? '',
      published: entry.data.published,
      ...(entry.data.description !== undefined
        ? { description: entry.data.description }
        : {}),
    };
  };

  const { tree } = ingest(rawNodes, readNote, {
    sectionSlug: NOTES_SECTION_SLUG,
    rootDisplayName: NOTES_DISPLAY_NAME,
  });

  // Prune the tree so it reflects only publishable content: drop the phantom
  // root marker and every unpublished Note node at every level, so they never
  // appear in the navigation tree or category listings (and never produce a
  // dead link to a route that was excluded, Req 10.2). Categories are kept even
  // when they become empty, so a Category with no published content still gets
  // a listing page that shows the "no content" message (Req 5.7).
  const isPublishedNote = (child: TreeNode): boolean => {
    if (child.kind !== 'note') return true;
    const entry = child.sourcePath ? entryByPath.get(child.sourcePath) : undefined;
    return entry !== undefined && entry.data.published !== false;
  };
  const pruneTree = (node: CategoryNode): void => {
    node.children = node.children.filter(isPublishedNote);
    for (const child of node.children) {
      if (child.kind === 'category') pruneTree(child);
    }
  };
  pruneTree(tree);

  // Re-derive entries from the cleaned tree, keeping only published Notes.
  const treeEntries = collectEntries(tree);
  const entries: ContentEntry[] = [];
  const byRoute = new Map<string, RouteData>();

  for (const { note, ancestors } of treeEntries) {
    const entry = note.sourcePath ? entryByPath.get(note.sourcePath) : undefined;
    if (!entry) continue; // phantom or provenance-less node
    const published = entry.data.published;
    if (!published) continue; // unpublished Notes get no route (Req 10.2)

    const content: ContentEntry = {
      id: note.entryId,
      sectionSlug: tree.slug,
      slug: note.slug,
      route: note.route,
      displayName: note.displayName,
      order: note.order,
      ancestors,
      body: entry.body ?? '',
      headings: [],
      sourcePath: note.sourcePath!,
      published,
      ...(entry.data.description !== undefined
        ? { description: entry.data.description }
        : {}),
    };
    entries.push(content);
    byRoute.set(note.route, { kind: 'note', route: note.route, entry, content });
  }

  // Category listing routes: the section root plus every Category node.
  const walkCategories = (node: CategoryNode, ancestors: CategoryRef[]): void => {
    byRoute.set(node.route, { kind: 'category', route: node.route, node, ancestors });
    for (const child of node.children) {
      if (child.kind === 'category') {
        walkCategories(child, [...ancestors, toRef(node)]);
      }
    }
  };
  walkCategories(tree, []);

  const siteModel = buildSiteModel([
    {
      slug: NOTES_SECTION_SLUG,
      displayName: NOTES_DISPLAY_NAME,
      order: 0,
      rootNode: tree,
    },
  ]);

  const publishedNoteRoutes = publishedRoutes(
    entries.map((e) => ({ route: e.route, published: e.published })),
  );

  const paths: StaticPathEntry[] = [...byRoute.keys()].map((route) => ({
    slug: routeToSlug(route),
    route,
  }));

  // Backlink ("Linked mentions") index, computed once here and shared by every
  // note page render via the memoized `loadSite()`.
  const backlinks = buildBacklinkIndex();

  return { tree, entries, siteModel, paths, byRoute, publishedNoteRoutes, backlinks };
}

/** Render a Note entry's Markdown to its `Content` component and headings. */
export async function renderNote(entry: NoteEntry) {
  return render(entry);
}

export type { CategoryNode, CategoryRef, ContentEntry, NoteNode, TreeNode };
export type { BacklinkRef };
