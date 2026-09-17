/**
 * remark plugin: Obsidian wikilinks (Task 3).
 *
 * Converts `[[Target]]` and `[[Target|Alias]]` into internal links:
 *   - resolved:   <a class="wikilink" href="/notes/…">Alias-or-Target</a>
 *   - unresolved: <a class="wikilink wikilink-missing" href="#"
 *                    aria-disabled="true">Alias-or-Target</a>
 *
 * Resolution is driven by a `name -> route` map supplied by the caller
 * (`buildWikilinkIndex` in `wikilink-index.ts`), keyed by BOTH the note's
 * Display_Name and its file basename, each normalized (lowercased, whitespace
 * collapsed). Unresolved targets are collected and reported once as a build
 * warning.
 *
 * ## Why `mdast-util-find-and-replace`
 *
 * find-and-replace searches only `Text` nodes for COMPLETE matches. remark-math
 * has already turned `$…$` into `inlineMath`/`math` nodes (whose value is not a
 * child text node) and inline/blocks of code are `inlineCode`/`code` nodes — so
 * none of those are visited, and `[[…]]` inside math or code is never rewritten.
 * (Verified against the real parser: `[[Target|Alias]]` stays a single text
 * node, so a per-text-node regex reliably matches it.)
 */

import { findAndReplace } from 'mdast-util-find-and-replace';
import type { Root, Link, Text } from 'mdast';

/** A resolved-name index: normalized note name/basename -> absolute route. */
export type WikilinkIndex = ReadonlyMap<string, string>;

/**
 * A live resolver: given an ALREADY-normalized name, return its route (or
 * `undefined` if unresolved). Supplied instead of a frozen `index` so callers
 * can back resolution with a cache that refreshes when the notes change (see
 * `createWikilinkResolver`), letting `astro dev` pick up newly added/renamed
 * notes without a server restart.
 */
export type WikilinkResolve = (normalizedName: string) => string | undefined;

export interface RemarkWikilinksOptions {
  /**
   * Normalized `name -> route` lookup (see `buildWikilinkIndex`). A FROZEN
   * snapshot: resolution never changes for the life of the plugin instance.
   * Kept for backward compatibility with existing callers/tests. Ignored when
   * `resolve` is provided.
   */
  index?: WikilinkIndex;
  /**
   * Live resolver used in preference to `index` when present. Receives a name
   * ALREADY normalized via {@link normalizeName} and returns its route (or
   * `undefined`). Lets resolution stay fresh across a running dev server.
   */
  resolve?: WikilinkResolve;
  /**
   * Optional sink for unresolved targets (defaults to `console.warn`). Injected
   * in tests so resolution can be asserted without touching the console.
   */
  onUnresolved?: (targets: string[]) => void;
}

/**
 * `[[Target]]` / `[[Target|Alias]]`.
 *   group 1: target (everything up to `|` or `]]`)
 *   group 2: optional alias (after `|`)
 * Newlines are excluded so a stray `[[` never swallows across lines.
 */
const WIKILINK = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g;

/** Normalize a name for lookup: trim, lowercase, collapse inner whitespace. */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * remark plugin factory. Registered in `astro.config.mjs` `remarkPlugins` with
 * a prebuilt index option.
 */
export default function remarkWikilinks(options: RemarkWikilinksOptions) {
  const warn = options.onUnresolved ?? defaultWarn;
  // Precedence: a live `resolve` function wins; otherwise fall back to the
  // frozen `index.get(...)`, keeping every existing `{ index }` caller working.
  const resolve: WikilinkResolve = options.resolve
    ? options.resolve
    : (name) => options.index?.get(name);

  return (tree: Root): void => {
    const unresolved: string[] = [];

    findAndReplace(tree, [
      [
        WIKILINK,
        (_full: string, rawTarget: string, rawAlias?: string): Link => {
          // A target may carry an in-note anchor (`Target#Heading` or
          // `Target#^blockid`); only the note part participates in resolution.
          const target = rawTarget.trim();
          const namePart = target.split('#')[0]!.trim();
          const label = (rawAlias?.trim() || target).trim();

          const route = resolve(normalizeName(namePart));

          if (route) {
            return {
              type: 'link',
              url: route,
              data: { hProperties: { className: ['wikilink'] } },
              children: [{ type: 'text', value: label } as Text],
            };
          }

          unresolved.push(namePart);
          return {
            type: 'link',
            url: '#',
            data: {
              hProperties: {
                className: ['wikilink', 'wikilink-missing'],
                ariaDisabled: 'true',
              },
            },
            children: [{ type: 'text', value: label } as Text],
          };
        },
      ],
    ]);

    if (unresolved.length > 0) {
      // De-duplicate while preserving first-seen order for a tidy report.
      warn([...new Set(unresolved)]);
    }
  };
}

function defaultWarn(targets: string[]): void {
  console.warn(
    `[wikilinks] ${targets.length} unresolved wikilink target(s): ` +
      targets.map((t) => `"${t}"`).join(', '),
  );
}
