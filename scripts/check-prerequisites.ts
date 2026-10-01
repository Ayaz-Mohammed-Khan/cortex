/**
 * Prerequisite integrity check.
 *
 *     npm run check:prereqs
 *
 * Guards the single source of truth for "learn first" edges
 * (`src/data/prerequisites.ts`) against the three ways it can rot:
 *
 *   1. DANGLING NAMES   a key or a value that names no real note or track. A
 *                       typo here silently drops an edge from the site, so it is
 *                       an error.
 *   2. CYCLES           a prerequisite chain that loops back on itself (A needs
 *                       B needs A). The roadmap is a DAG; a cycle is a bug.
 *   3. FRONTMATTER DRIFT a note whose `prerequisites:` frontmatter disagrees
 *                       with the map. The site renders from the map, so a stale
 *                       frontmatter list misleads anyone reading the raw note
 *                       (and Obsidian). Both must agree.
 *
 * Resolves names against the SAME things the site resolves against: note
 * Display_Names (filename minus the `NN - ` prefix) and track names from
 * `spine`. Exit code is 1 on any problem so this can gate the build.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spine, type Step, type Topic } from '../src/data/roadmap.ts';
import {
  TOPIC_PREREQUISITES,
  TRACK_PREREQUISITES,
  prerequisitesFor,
} from '../src/data/prerequisites.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = join(ROOT, 'content');

// ---------------------------------------------------------------------------
// Content + roadmap discovery (mirrors audit-syllabus.ts)
// ---------------------------------------------------------------------------

/** Strip a `NN - ` / `NN. ` ordering prefix, mirroring `src/lib/ingest/prefix.ts`. */
function stripPrefix(name: string): string {
  const m = /^(\d+)[\s.\-_]+(.*)$/.exec(name.trim());
  return (m?.[2] ?? name).trim();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.toUpperCase() === 'ASSETS') continue;
      walk(full, out);
    } else if (entry.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

interface NoteFile {
  displayName: string;
  relPath: string;
  /** Prerequisites declared in the note's frontmatter (empty when absent). */
  frontmatterPrereqs: string[];
}

/**
 * Pull the `prerequisites:` block-list out of a note's YAML frontmatter. Only
 * the leading `--- ... ---` block is inspected; a `prerequisites:` key followed
 * by `  - value` lines is collected until the indentation ends. This is a
 * narrow parser on purpose: it only needs this one key.
 */
function parseFrontmatterPrereqs(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return [];
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return [];

  const out: string[] = [];
  for (let i = 1; i < end; i++) {
    if (/^prerequisites:\s*$/.test(lines[i]!.trim()) || /^prerequisites:\s*\[/.test(lines[i]!.trim())) {
      // Inline array form: prerequisites: [A, B]
      const inline = /^prerequisites:\s*\[(.*)\]\s*$/.exec(lines[i]!.trim());
      if (inline) {
        return inline[1]!
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
      // Block list form: subsequent `  - value` lines.
      for (let j = i + 1; j < end; j++) {
        const m = /^\s+-\s*(.+?)\s*$/.exec(lines[j]!);
        if (!m) break;
        out.push(m[1]!.replace(/^['"]|['"]$/g, ''));
      }
      break;
    }
  }
  return out;
}

function loadNotes(): NoteFile[] {
  let files: string[];
  try {
    files = walk(CONTENT_DIR);
  } catch {
    console.error(`No content directory at ${CONTENT_DIR}`);
    return [];
  }
  return files.sort().map((full) => {
    const rel = relative(CONTENT_DIR, full);
    const base = rel.split(sep).pop()!.replace(/\.md$/i, '');
    return {
      displayName: stripPrefix(base),
      relPath: rel,
      frontmatterPrereqs: parseFrontmatterPrereqs(readFileSync(full, 'utf8')),
    };
  });
}

/** Every valid Display_Name: note names + track names (lowercased for lookup). */
function validNames(notes: NoteFile[]): Set<string> {
  const names = new Set<string>();
  for (const n of notes) names.add(n.displayName.trim().toLowerCase());
  const visit = (n: Step | Topic) => names.add((n.match ?? n.label).trim().toLowerCase());
  for (const step of spine) {
    names.add(step.label.trim().toLowerCase());
    visit(step);
    for (const t of [...(step.left ?? []), ...(step.right ?? [])]) visit(t);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const errors: string[] = [];
const notes = loadNotes();
const valid = validNames(notes);
const has = (name: string) => valid.has(name.trim().toLowerCase());

// 1. Dangling names: every key and value must resolve.
for (const [map, mapName] of [
  [TOPIC_PREREQUISITES, 'TOPIC_PREREQUISITES'],
  [TRACK_PREREQUISITES, 'TRACK_PREREQUISITES'],
] as const) {
  for (const [key, values] of Object.entries(map)) {
    if (!has(key)) {
      errors.push(`${mapName}: key "${key}" matches no note or track.`);
    }
    for (const v of values) {
      if (!has(v)) {
        errors.push(`${mapName}: "${key}" lists prerequisite "${v}", which matches no note or track.`);
      }
    }
  }
}

// 2. Cycles: walk each map as a graph and look for a back edge.
function detectCycles(map: Record<string, string[]>, mapName: string): void {
  // DFS node colours: unvisited nodes are simply absent from `color`.
  const GREY = 1; // on the current DFS stack
  const BLACK = 2; // fully explored
  const color = new Map<string, number>();
  const keyFor = (name: string) =>
    Object.keys(map).find((k) => k.trim().toLowerCase() === name.trim().toLowerCase());

  const dfs = (node: string, path: string[]): void => {
    const canonical = keyFor(node) ?? node;
    if (color.get(canonical) === GREY) {
      const cycle = [...path.slice(path.indexOf(canonical)), canonical].join(' -> ');
      errors.push(`${mapName}: prerequisite cycle: ${cycle}`);
      return;
    }
    if (color.get(canonical) === BLACK) return;
    color.set(canonical, GREY);
    for (const next of map[canonical] ?? []) {
      dfs(next, [...path, canonical]);
    }
    color.set(canonical, BLACK);
  };

  for (const key of Object.keys(map)) dfs(key, []);
}
detectCycles(TOPIC_PREREQUISITES, 'TOPIC_PREREQUISITES');
detectCycles(TRACK_PREREQUISITES, 'TRACK_PREREQUISITES');

// 3. Frontmatter drift: a note's frontmatter prerequisites must equal the map.
const norm = (arr: string[]) => arr.map((s) => s.trim().toLowerCase()).sort();
const sameSet = (a: string[], b: string[]) => {
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
for (const note of notes) {
  const canonical = prerequisitesFor(note.displayName); // TOPIC map (note view)
  if (!sameSet(note.frontmatterPrereqs, canonical)) {
    errors.push(
      `Frontmatter drift in ${note.relPath}: ` +
        `frontmatter [${note.frontmatterPrereqs.join(', ')}] ` +
        `!= prerequisites.ts [${canonical.join(', ')}].`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length === 0) {
  const edges =
    Object.keys(TOPIC_PREREQUISITES).length + Object.keys(TRACK_PREREQUISITES).length;
  console.log(
    `check:prereqs OK — ${edges} prerequisite edges, ` +
      `${notes.length} notes, no dangling names, no cycles, frontmatter in sync.`,
  );
  process.exit(0);
}

console.error(`check:prereqs FAILED with ${errors.length} problem(s):\n`);
for (const e of errors) console.error(`  - ${e}`);
process.exit(1);
