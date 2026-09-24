/**
 * Build-time BACKLINK ("Referenced by") index (Tier 3).
 *
 * Produces a reverse index of the site's `[[wikilinks]]`: for each TARGET note
 * route, the OTHER published notes that link TO it. Rendered at the bottom of
 * each note page so readers can see what references the note they're on.
 *
 * ## How resolution stays consistent with rendered links
 *
 * Resolution reuses the SAME machinery as the render pipeline:
 *   - `buildWikilinkIndex()` gives the normalized `name -> route` map — the very
 *     map `remark-wikilinks` uses — so a backlink is recorded only when the link
 *     would actually resolve to a live page (identical route + identical
 *     normalization/`#anchor` handling).
 *   - `buildNoteRecords()` gives every SOURCE note its site-accurate
 *     `{ route, displayName, realPath }` from the same ingestion pass, so we
 *     never re-derive routes here.
 *
 * Only PUBLISHED notes are scanned as sources (buildNoteRecords already filters
 * unpublished notes out). Unpublished TARGETS never get a page, so they simply
 * never render backlinks — no special handling needed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { normalizeName } from './remark-wikilinks';
import { buildNoteRecords, buildWikilinkIndex } from './wikilink-index';

/** Default on-disk location of the synced notes collection. */
const NOTES_DIR = join(process.cwd(), 'src', 'content', 'notes');

/** A single backlink: a source note that links to the target. */
export interface BacklinkRef {
  /** Absolute route of the source note, e.g. `/notes/ai-ml/foo`. */
  route: string;
  /** Source note Display_Name (link label). */
  displayName: string;
}

/**
 * `[[Target]]` / `[[Target|Alias]]` — SAME semantics as the `WIKILINK` regex in
 * `remark-wikilinks.ts`: target is everything up to `|` or `]]`, newlines
 * excluded so a stray `[[` never swallows across lines. We only need the target
 * (group 1) here; the alias is irrelevant for backlink resolution.
 */
const WIKILINK = /\[\[([^\]|\n]+?)(?:\|[^\]\n]+?)?\]\]/g;

/**
 * Strip spans where `[[…]]` must NOT be treated as a wikilink, mirroring why the
 * remark plugin is safe: it only ever sees plain-text nodes, never code/math.
 * remark-math + the markdown parser turn code fences, inline code, and `$…$`
 * math into non-text nodes, so wikilinks inside them are never rewritten. We
 * have only the raw string here, so we approximate that by removing those spans
 * before scanning. This is a heuristic (not a full parser) but matches the
 * rendered behavior for ordinary notes.
 *
 * Order matters: fenced blocks first (they can contain backticks/`$`), then
 * inline code, then math.
 */
function stripNonProse(body: string): string {
  return (
    body
      // Fenced code blocks: ```lang … ``` and ~~~ … ~~~ (multiline).
      .replace(/^[ \t]*```[\s\S]*?```/gm, '')
      .replace(/^[ \t]*~~~[\s\S]*?~~~/gm, '')
      // Block math: $$ … $$ (multiline) before inline `$…$`.
      .replace(/\$\$[\s\S]*?\$\$/g, '')
      // Inline code: `…` (single-line).
      .replace(/`[^`\n]*`/g, '')
      // Inline math: $…$ (single-line).
      .replace(/\$[^$\n]*\$/g, '')
  );
}

/** Read a note body with frontmatter removed; empty string on read failure. */
function readBody(realPath: string): string {
  try {
    // `frontmatter: 'remove'` strips the YAML block so its contents (aliases,
    // tags, …) can never be mistaken for note body wikilinks.
    const { content } = parseFrontmatter(readFileSync(realPath, 'utf8'), {
      frontmatter: 'remove',
    });
    return content;
  } catch {
    return '';
  }
}

/**
 * Build the reverse (backlink) index: TARGET route -> source notes linking to
 * it. Returns an empty map when the notes directory does not exist yet.
 *
 * Self-links are ignored (a note linking to itself is not a "linked mention").
 * A source is listed at most once per target even if it links multiple times,
 * and each target's refs are sorted by display name (case-insensitive) for
 * deterministic, reproducible output.
 */
export function buildBacklinkIndex(
  notesDir: string = NOTES_DIR,
): Map<string, BacklinkRef[]> {
  const result = new Map<string, BacklinkRef[]>();

  const nameToRoute = buildWikilinkIndex(notesDir);
  const records = buildNoteRecords(notesDir);

  // Accumulate source routes per target, de-duplicated, before materializing.
  const sourcesByTarget = new Map<string, Set<string>>();
  // route -> displayName for source label lookup when materializing.
  const displayNameByRoute = new Map<string, string>();
  for (const record of records) displayNameByRoute.set(record.route, record.displayName);

  for (const record of records) {
    const body = stripNonProse(readBody(record.realPath));

    WIKILINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK.exec(body)) !== null) {
      const rawTarget = match[1]!.trim();
      // A target may carry an in-note anchor (`Target#Heading` / `Target#^id`);
      // only the note part participates in resolution — same as remark-wikilinks.
      const namePart = rawTarget.split('#')[0]!.trim();
      const targetRoute = nameToRoute.get(normalizeName(namePart));
      if (!targetRoute) continue; // unresolved link -> no live target page
      if (targetRoute === record.route) continue; // ignore self-links

      let set = sourcesByTarget.get(targetRoute);
      if (!set) {
        set = new Set<string>();
        sourcesByTarget.set(targetRoute, set);
      }
      set.add(record.route);
    }
  }

  for (const [targetRoute, sourceRoutes] of sourcesByTarget) {
    const refs: BacklinkRef[] = [...sourceRoutes].map((route) => ({
      route,
      displayName: displayNameByRoute.get(route) ?? route,
    }));
    // Stable, case-insensitive ordering for reproducible builds.
    refs.sort((a, b) =>
      a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
    );
    result.set(targetRoute, refs);
  }

  return result;
}
