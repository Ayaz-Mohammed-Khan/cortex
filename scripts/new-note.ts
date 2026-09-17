/**
 * `new-note` scaffolding script.
 *
 * Creates a new note file in the content root, ready to edit, following the
 * repo's `NN - Title.md` naming convention (numeric Order_Prefix + separator +
 * clean Display_Name — see `src/lib/ingest/prefix.ts`).
 *
 * Usage:
 *   npm run new -- "Central Limit Theorem"
 *   npm run new -- "Central Limit Theorem" --category "Statistics & Probability"
 *   npm run new -- "Central Limit Theorem" --order 07
 *
 * Behaviour:
 *  - Resolves the content root (honours `CONTENT_ROOT`, default `./content`).
 *  - `--category` picks the folder under the content root. Default: the first
 *    existing top-level folder, or `AI-ML` if the content root has none.
 *  - `--order NN` sets the 2-digit order prefix. Default: (highest existing
 *    order in that category) + 1, zero-padded to 2 digits (`01` for an empty
 *    category).
 *  - Writes `NN - <Title>.md`. Never overwrites an existing file — errors out.
 *  - Auto-links the "Continues from" callout to the current highest-order note
 *    in the category so the chain stays connected; omits it for the first note.
 *
 * Run via `node scripts/new-note.ts` (Node's native TypeScript execution),
 * matching `scripts/sync-content.ts`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentRoot } from '../src/lib/config.ts';
import { parseName } from '../src/lib/ingest/prefix.ts';

const DEFAULT_CATEGORY = 'AI-ML';

interface ParsedArgs {
  title: string | null;
  category: string | null;
  order: string | null;
}

/** Parse CLI args: first non-flag token is the title; `--category`/`--order`. */
function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { title: null, category: null, order: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--category') {
      result.category = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === '--order') {
      result.order = argv[i + 1] ?? null;
      i += 1;
    } else if (!arg.startsWith('--') && result.title === null) {
      result.title = arg;
    }
  }
  return result;
}

function usage(): string {
  return [
    'Usage: npm run new -- "<Title>" [--category "<Folder>"] [--order NN]',
    '',
    'Examples:',
    '  npm run new -- "Central Limit Theorem"',
    '  npm run new -- "Central Limit Theorem" --category "Statistics & Probability"',
    '  npm run new -- "Central Limit Theorem" --order 07',
  ].join('\n');
}

/** List immediate subdirectories of `dir` (empty when dir is absent). */
function listSubdirectories(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

interface NoteEntry {
  order: number;
  displayName: string;
}

/** Parse `.md` files in a category folder into their order + display name. */
function listNotes(categoryDir: string): NoteEntry[] {
  if (!existsSync(categoryDir)) {
    return [];
  }
  return readdirSync(categoryDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
    .map((d) => {
      const base = d.name.slice(0, -'.md'.length);
      const { order, displayName } = parseName(base);
      return { order: order ?? -1, displayName };
    });
}

/** Two-digit zero-padded order string. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Build the seed markdown for a new note. */
function buildTemplate(title: string, previousDisplayName: string | null): string {
  const frontmatter = ['---', 'tags: []', `created: ${today()}`, '---'].join('\n');

  const continuesFrom = previousDisplayName
    ? [
        '> [!info] Where this fits',
        `> Continues from [[${previousDisplayName}|${previousDisplayName}]].`,
        '',
        '',
      ].join('\n')
    : '';

  const body = [
    `# ${title}`,
    '',
    '## Overview',
    '',
    'Start writing here.',
    '',
    '> [!info] Continues to',
    '> Next: [[Next note placeholder]].',
    '',
  ].join('\n');

  // frontmatter, blank line, optional "Continues from" block, then the body.
  return `${frontmatter}\n\n${continuesFrom}${body}`;
}

export interface NewNoteResult {
  filePath: string;
  fileName: string;
  order: string;
  category: string;
  previousDisplayName: string | null;
}

/** Core logic (exported for testing): resolve category/order and write file. */
export function createNote(
  args: ParsedArgs,
  cwd: string = process.cwd(),
  contentRoot: string = getContentRoot(),
): NewNoteResult {
  const title = args.title?.trim();
  if (!title) {
    throw new Error(`No title provided.\n\n${usage()}`);
  }

  const rootDir = resolve(cwd, contentRoot);

  // Resolve category: explicit flag, else first existing top-level folder,
  // else the default.
  let category = args.category?.trim() || '';
  if (!category) {
    const existing = listSubdirectories(rootDir);
    category = existing[0] ?? DEFAULT_CATEGORY;
  }

  const categoryDir = join(rootDir, category);
  if (!existsSync(categoryDir)) {
    mkdirSync(categoryDir, { recursive: true });
  }

  const notes = listNotes(categoryDir);

  // Resolve order: explicit flag (padded), else highest existing + 1.
  let orderNum: number;
  if (args.order?.trim()) {
    const parsed = Number.parseInt(args.order.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid --order value: "${args.order}". Expected a non-negative integer.`);
    }
    orderNum = parsed;
  } else {
    const maxOrder = notes.reduce((max, n) => Math.max(max, n.order), 0);
    orderNum = notes.length === 0 ? 1 : maxOrder + 1;
  }
  const order = pad2(orderNum);

  // Previous note = current highest-order note in the category (for the chain).
  const withOrder = notes.filter((n) => n.order >= 0);
  const previous =
    withOrder.length > 0
      ? withOrder.reduce((best, n) => (n.order > best.order ? n : best))
      : null;
  const previousDisplayName = previous ? previous.displayName : null;

  const fileName = `${order} - ${title}.md`;
  const filePath = join(categoryDir, fileName);

  if (existsSync(filePath)) {
    throw new Error(`File already exists, refusing to overwrite: ${filePath}`);
  }

  writeFileSync(filePath, buildTemplate(title, previousDisplayName), 'utf8');

  return { filePath, fileName, order, category, previousDisplayName };
}

/** True when this module was executed directly (not imported). */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = createNote(args);
    console.log(`[new-note] Created ${result.filePath}`);
    if (result.previousDisplayName) {
      console.log(`[new-note] Linked "Continues from" → "${result.previousDisplayName}".`);
    }
    console.log('[new-note] Run "npm run dev" and it will be picked up live (auto-sync).');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[new-note] ${message}`);
    process.exit(1);
  }
}
