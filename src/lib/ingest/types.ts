/**
 * Framework-free domain types for the Ingestion Domain (L1).
 *
 * These are pure type declarations with no runtime logic and no dependency on
 * Astro, the filesystem, or the DOM. They model the plain data flowing through
 * the deterministic ingestion pipeline (raw nodes -> parsed names -> ordering
 * keys -> tree nodes -> content entries).
 */

/** A raw file or folder discovered while walking the content source. */
export interface RawNode {
  /** Absolute source path of the file or folder. */
  absPath: string;
  /** The raw file/folder name (e.g., "01 - Statistics & Probability"). */
  rawName: string;
  /** true for a Note (.md file), false for a Category (folder). */
  isNote: boolean;
}

/** Result of parsing an optional numeric Order_Prefix from a raw name. */
export interface ParsedName {
  /** Integer ordering value (0..999,999,999) or null when no prefix. */
  order: number | null;
  /** Human-readable Display_Name after prefix removal. */
  displayName: string;
}

/** Sort key derived from a ParsedName, used to order siblings. */
export interface OrderingKey {
  /** Effective numeric order; unprefixed entries use a sentinel that sorts last. */
  order: number;
  hasPrefix: boolean;
  /** Lowercased Display_Name for tie-breaking. */
  nameKey: string;
}

/** A rendered Note as a structured content entry. */
export interface ContentEntry {
  /** stable id = full route */
  id: string;
  /** e.g., "notes" */
  sectionSlug: string;
  /** Note slug (unique within parent) */
  slug: string;
  /** "/notes/ai-ml/self-notes/statistics-probability/intro" */
  route: string;
  displayName: string;
  /** effective ordering value */
  order: number;
  /** root -> immediate parent */
  ancestors: CategoryRef[];
  /** raw Markdown */
  body: string;
  /** from Astro metadata */
  headings: Heading[];
  /** absolute path (for image resolution + error reporting) */
  sourcePath: string;
  published: boolean;
  /** frontmatter override */
  description?: string;
}

/** A lightweight reference to an ancestor Category (breadcrumbs / ancestor chain). */
export interface CategoryRef {
  displayName: string;
  slug: string;
  route: string;
}

/** A Category (folder) node within the navigation tree. */
export interface CategoryNode {
  kind: 'category';
  displayName: string;
  slug: string;
  route: string;
  order: number;
  hasPrefix: boolean;
  /** ordered per Req 1.5/1.6 */
  children: TreeNode[];
}

/** A Note (.md file) node within the navigation tree. */
export interface NoteNode {
  kind: 'note';
  /** -> ContentEntry */
  entryId: string;
  displayName: string;
  slug: string;
  route: string;
  order: number;
  hasPrefix: boolean;
  /**
   * Absolute source path of the originating `.md` file, threaded through from
   * the {@link RawNode} during tree assembly. The content ingestor
   * (`ingest.ts`) uses it to pair each Note node with the body/metadata read
   * for that file — populating {@link ContentEntry.sourcePath} and reporting
   * per-file read/parse failures (Req 1.8, 3.7). Optional because hand-built or
   * synthesized nodes (e.g. in tests) have no backing file.
   */
  sourcePath?: string;
}

/** A node in the navigation tree: either a Category or a Note. */
export type TreeNode = CategoryNode | NoteNode;

/** A heading extracted from a Note, used to build the table of contents. */
export interface Heading {
  /** 2..6 (title is depth 1) */
  depth: number;
  text: string;
  /** anchor id from rehype-slug */
  slug: string;
}
