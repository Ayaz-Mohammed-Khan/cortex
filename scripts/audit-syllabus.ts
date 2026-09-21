/**
 * Syllabus mapping audit.
 *
 *     npm run audit:syllabus            full report
 *     npm run audit:syllabus -- --gaps  only what needs writing
 *     npm run audit:syllabus -- --json  machine-readable, for CI
 *
 * Answers the questions you actually have when maintaining a roadmap that links
 * into a growing pile of notes:
 *
 *   1. COVERAGE      which roadmap bullets reached a note section, by which
 *                    match tier, and how confidently.
 *   2. UNPLACED      which bullets on a topic that HAS notes found nothing.
 *                    These are the candidates for a new heading in that note,
 *                    or for an `at:` override in `src/data/roadmap.ts`.
 *   3. ORPHANS       which note headings no roadmap bullet points at. Either
 *                    the roadmap is missing a topic, or the heading is internal.
 *   4. GAPS          which roadmap topics have no note at all, in study order.
 *                    This is the "what should I write next" list.
 *
 * It reads the SAME data the site renders (`src/data/roadmap.ts`) and the SAME
 * headings the note pages publish (markdown parsed with `github-slugger`, the
 * slugger `rehype-slug` uses), so the report cannot drift from the built site.
 *
 * Exit code is 1 when `--strict` is passed and any `at:` override is stale, so
 * this can gate a build; otherwise always 0, since unplaced bullets and gaps are
 * information, not failure.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import GithubSlugger from 'github-slugger';

import { spine, conceptLabel, type Concept, type Step, type Topic } from '../src/data/roadmap.ts';
import { matchTopicPrepared, preparePool, type Candidate, type Match } from '../src/lib/syllabus/match.ts';
import { normalize } from '../src/lib/syllabus/normalize.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTENT_DIR = join(ROOT, 'content');

// ---------------------------------------------------------------------------
// Content discovery
// ---------------------------------------------------------------------------

interface NoteFile {
  /** Display name: filename minus extension and any `NN - ` ordering prefix. */
  displayName: string;
  /** Owning folder's display name, or null at the content root. */
  category: string | null;
  /** Path relative to `content/`, for reporting. */
  relPath: string;
  headings: { text: string; slug: string; depth: number }[];
}

/** Strip a `NN - ` / `NN. ` ordering prefix, mirroring `src/lib/ingest/prefix.ts`. */
function stripPrefix(name: string): string {
  const m = /^(\d+)[\s.\-_]+(.*)$/.exec(name.trim());
  return (m?.[2] ?? name).trim();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // ASSETS folders hold images, not notes.
      if (entry.toUpperCase() === 'ASSETS') continue;
      walk(full, out);
    } else if (entry.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse ATX headings from markdown, skipping fenced code blocks so a `#` comment
 * inside a Python sample is never mistaken for a heading. Slugs are produced by
 * the same slugger the site uses, and its state is per-file, so duplicate
 * headings get the same `-1` suffixes the real pages get.
 */
function parseHeadings(markdown: string): { text: string; slug: string; depth: number }[] {
  const slugger = new GithubSlugger();
  const out: { text: string; slug: string; depth: number }[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length;
    // Strip inline markdown that rehype would render away before slugging.
    const text = m[2]!.replace(/`([^`]*)`/g, '$1').replace(/\*\*?([^*]*)\*\*?/g, '$1').trim();
    out.push({ text, slug: slugger.slug(text), depth });
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
    const parts = rel.split(sep);
    const base = parts[parts.length - 1]!.replace(/\.md$/i, '');
    const folder = parts.length > 1 ? parts[parts.length - 2]! : null;
    return {
      displayName: stripPrefix(base),
      category: folder === null ? null : stripPrefix(folder),
      relPath: rel,
      // Heading depth 1 is the note title, not a section.
      headings: parseHeadings(readFileSync(full, 'utf8')).filter((h) => h.depth >= 2),
    };
  });
}

// ---------------------------------------------------------------------------
// Roadmap traversal
// ---------------------------------------------------------------------------

interface RoadmapNode {
  label: string;
  match: string;
  kind: 'track' | 'topic';
  concepts: Concept[];
  /** Index in study order, for the gap list. */
  order: number;
}

function flattenRoadmap(): RoadmapNode[] {
  const out: RoadmapNode[] = [];
  let order = 0;
  const push = (n: Step | Topic, kind: 'track' | 'topic') => {
    out.push({
      label: n.label,
      match: (n.match ?? n.label).trim(),
      kind,
      concepts: n.concepts,
      order: order++,
    });
  };
  for (const step of spine) {
    push(step, 'track');
    for (const t of [...(step.left ?? []), ...(step.right ?? [])]) push(t, 'topic');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

interface BulletReport {
  node: string;
  bullet: string;
  declared: string | null;
  match: Match<string> | null;
}

interface Report {
  notes: number;
  headings: number;
  nodes: number;
  linkedNodes: number;
  bullets: number;
  linkableBullets: number;
  placed: number;
  byTier: Record<string, number>;
  unplaced: BulletReport[];
  staleOverrides: BulletReport[];
  lowConfidence: BulletReport[];
  orphanHeadings: { note: string; heading: string }[];
  gaps: { order: number; kind: string; label: string; match: string }[];
}

function audit(): Report {
  const notes = loadNotes();
  const nodes = flattenRoadmap();

  const byNoteName = new Map<string, NoteFile>();
  const byCategoryName = new Map<string, NoteFile[]>();
  for (const note of notes) {
    const key = note.displayName.toLowerCase();
    if (!byNoteName.has(key)) byNoteName.set(key, note);
    if (note.category) {
      const ck = note.category.toLowerCase();
      byCategoryName.set(ck, [...(byCategoryName.get(ck) ?? []), note]);
    }
  }

  const candidatesFor = (note: NoteFile): Candidate<string>[] =>
    note.headings.map((h) => ({
      text: h.text,
      ref: `${note.relPath}#${h.slug}`,
      group: note.relPath,
      groupTitle: note.displayName,
      depth: h.depth,
    }));

  const report: Report = {
    notes: notes.length,
    headings: notes.reduce((s, n) => s + n.headings.length, 0),
    nodes: nodes.length,
    linkedNodes: 0,
    bullets: 0,
    linkableBullets: 0,
    placed: 0,
    byTier: {},
    unplaced: [],
    staleOverrides: [],
    lowConfidence: [],
    orphanHeadings: [],
    gaps: [],
  };

  const referenced = new Set<string>();

  for (const node of nodes) {
    const key = node.match.toLowerCase();
    const asNote = byNoteName.get(key) ?? null;
    const asCategory = byCategoryName.get(key) ?? null;
    report.bullets += node.concepts.length;

    // Must mirror `targetFor(..., preferCategory)` in `src/pages/index.astro`:
    // the content folders are named after the tracks, so a folder and a note can
    // share a name. A track searches the whole folder; a branch searches its note.
    // Diverging here would make the report describe a site that is not built.
    const resolved =
      node.kind === 'track'
        ? (asCategory ?? (asNote ? [asNote] : null))
        : (asNote ? [asNote] : asCategory);
    const isCategoryPool = node.kind === 'track' ? asCategory !== null : asNote === null;

    if (resolved === null) {
      report.gaps.push({
        order: node.order,
        kind: node.kind,
        label: node.label,
        match: node.match,
      });
      continue;
    }
    report.linkedNodes++;

    const pool = preparePool(resolved.flatMap(candidatesFor));
    const requireUnique = isCategoryPool;

    for (const c of node.concepts) {
      report.linkableBullets++;
      const declared = typeof c === 'string' ? null : c.at;
      const query = declared ?? conceptLabel(c);
      const hit = matchTopicPrepared(query, pool, { requireUnique });
      const entry: BulletReport = {
        node: node.label,
        bullet: conceptLabel(c),
        declared,
        match: hit,
      };

      if (!hit) {
        if (declared) report.staleOverrides.push(entry);
        else report.unplaced.push(entry);
        continue;
      }
      report.placed++;
      report.byTier[hit.tier] = (report.byTier[hit.tier] ?? 0) + 1;
      referenced.add(hit.ref);
      if (hit.score < 0.7) report.lowConfidence.push(entry);
    }
  }

  // Headings nothing points at. Structural sections are expected to be orphans,
  // so they are filtered out to keep the signal high.
  for (const note of notes) {
    for (const h of note.headings) {
      const ref = `${note.relPath}#${h.slug}`;
      if (referenced.has(ref)) continue;
      if (normalize(h.text).tokens.length === 0) continue;
      report.orphanHeadings.push({ note: note.displayName, heading: h.text });
    }
  }

  report.gaps.sort((a, b) => a.order - b.order);
  return report;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const BAR_WIDTH = 28;
function bar(fraction: number): string {
  const filled = Math.round(fraction * BAR_WIDTH);
  return `${'#'.repeat(filled)}${'.'.repeat(BAR_WIDTH - filled)}`;
}

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log('-'.repeat(text.length));
}

function printReport(r: Report, opts: { gapsOnly: boolean }): void {
  const pct = r.linkableBullets > 0 ? r.placed / r.linkableBullets : 0;

  if (!opts.gapsOnly) {
    heading('Coverage');
    console.log(`notes                ${r.notes}`);
    console.log(`note sections        ${r.headings}`);
    console.log(`roadmap nodes        ${r.nodes}  (${r.linkedNodes} have notes)`);
    console.log(`roadmap bullets      ${r.bullets}`);
    console.log(`  on noted topics    ${r.linkableBullets}`);
    console.log(
      `  placed in a section ${r.placed}  [${bar(pct)}] ${Math.round(pct * 100)}%`,
    );
    for (const tier of ['exact', 'alias', 'subset', 'overlap']) {
      const n = r.byTier[tier] ?? 0;
      if (n > 0) console.log(`      ${tier.padEnd(8)} ${n}`);
    }

    if (r.staleOverrides.length > 0) {
      heading(`Stale overrides (${r.staleOverrides.length})`);
      console.log('An `at:` in src/data/roadmap.ts no longer matches any heading.');
      for (const e of r.staleOverrides) {
        console.log(`  ${e.node} / "${e.bullet}"  at: "${e.declared}"`);
      }
    }

    if (r.unplaced.length > 0) {
      heading(`Unplaced bullets (${r.unplaced.length})`);
      console.log('These topics have notes, but no section matched. Either the note is');
      console.log('missing a heading for them, or they need an `at:` override.');
      let last = '';
      for (const e of r.unplaced) {
        if (e.node !== last) {
          console.log(`  ${e.node}`);
          last = e.node;
        }
        console.log(`    - ${e.bullet}`);
      }
    }

    if (r.lowConfidence.length > 0) {
      heading(`Low-confidence matches (${r.lowConfidence.length})`);
      console.log('Worth an eyeball: correct often, but the weakest links in the set.');
      for (const e of r.lowConfidence) {
        console.log(
          `  ${e.node} / "${e.bullet}"\n      -> ${e.match!.text}  (${e.match!.tier}, ${e.match!.score.toFixed(2)}: ${e.match!.reason})`,
        );
      }
    }

    if (r.orphanHeadings.length > 0) {
      heading(`Unreferenced sections (${r.orphanHeadings.length})`);
      console.log('Written up, but no roadmap bullet points here. Consider adding one.');
      let last = '';
      for (const e of r.orphanHeadings) {
        if (e.note !== last) {
          console.log(`  ${e.note}`);
          last = e.note;
        }
        console.log(`    - ${e.heading}`);
      }
    }
  }

  heading(`Notes to write next (${r.gaps.length} topics have none)`);
  console.log('In study order, so the first entries unblock the most.');
  const tracks = r.gaps.filter((g) => g.kind === 'track');
  console.log(`\n  Main tracks (${tracks.length}):`);
  for (const g of tracks) console.log(`    ${String(g.order).padStart(3)}. ${g.label}`);
  const topics = r.gaps.filter((g) => g.kind === 'topic');
  console.log(`\n  Sub-topics (${topics.length}):`);
  for (const g of topics) console.log(`    ${String(g.order).padStart(3)}. ${g.label}`);
}

// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const report = audit();

if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report, { gapsOnly: args.has('--gaps') });
}

if (args.has('--strict') && report.staleOverrides.length > 0) {
  console.error(`\nFAIL: ${report.staleOverrides.length} stale override(s).`);
  process.exit(1);
}
