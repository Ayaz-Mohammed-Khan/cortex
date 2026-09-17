import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { ingest, type IngestResult, type NoteReader } from './ingest';
import type { RawNode } from './types';

// Feature: portfolio-website, Property 6: For any batch of Notes in which an arbitrary subset is marked unreadable/unparseable, ingestion completes without throwing, produces content entries for exactly the readable Notes, and records one error per failing Note that identifies that Note's absolute file path.

// Validates: Requirements 1.8

/**
 * Property 6: Partial-failure ingestion excludes only the failing Notes.
 *
 * Validates: Requirements 1.8
 *
 * Strategy — we generate a batch of Notes as the flat {@link RawNode} list a
 * filesystem walk would yield (one `.md` file node per Note, all rooted under
 * `/content`), assign each Note a "readable" or "failing" disposition, and run
 * the batch through the real {@link ingest} orchestrator with a reader that
 * fails for exactly the chosen subset. Failure is simulated two ways so both of
 * the design's unreadable/unparseable signals are exercised: the reader THROWS
 * (an unreadable file) or returns a nullish value (an unparseable file). The
 * `'ok'` disposition is weighted so a healthy mix of survivors and failures —
 * including the all-readable and all-failing extremes — appears across runs.
 *
 * Every file name carries a unique trailing index, so each Note has a globally
 * unique absolute path and a unique path segment within its parent. That gives
 * a clean one-to-one relation between input Notes and tree leaves (no two Notes
 * merge), which is what lets us assert "exactly the readable Notes" by set
 * equality on absolute paths. Categories are only ever synthesized by the tree
 * builder from the Notes' paths and are never read, so they cannot fail and do
 * not affect the Note<->entry/error accounting.
 *
 * The oracle is derived purely from the generated dispositions — never from
 * ingest()'s output. We partition the batch into `readablePaths` and
 * `failingPaths` up front and then assert the run:
 *   - completes WITHOUT throwing, whatever subset fails;
 *   - produces content entries for EXACTLY the readable Notes (the set of entry
 *     source paths equals `readablePaths`, with no duplicates and no failing
 *     Note leaking through), each carrying the body the reader returned; and
 *   - records EXACTLY one error per failing Note, each error identifying that
 *     Note's absolute file path (the multiset of error source paths equals
 *     `failingPaths`), with no readable Note reported as an error.
 */

/** How the injected reader treats a given Note. */
type Disposition = 'ok' | 'throw' | 'null' | 'undefined';

/** Folder segments (plain words, never containing digits or a `.md` suffix, so
 * they can never collide with a Note's `base-<index>.md` leaf segment). */
const FOLDERS = ['alpha', 'beta', 'gamma', 'delta'];
/** Note base names; the real Display_Name/Slug are irrelevant to this property. */
const BASES = ['note', 'page', 'doc', 'entry', 'topic'];

/** A single generated Note before it receives its unique index. */
interface DraftNote {
  folders: string[];
  base: string;
  disposition: Disposition;
}

const draftArb: fc.Arbitrary<DraftNote> = fc.record({
  folders: fc.array(fc.constantFrom(...FOLDERS), { maxLength: 3 }),
  base: fc.constantFrom(...BASES),
  // Listing 'ok' twice biases toward a realistic mix of readable Notes and the
  // three failure signals, while still reaching the all-ok / all-failing ends.
  disposition: fc.constantFrom('ok', 'ok', 'throw', 'null', 'undefined'),
});

/** A generated Note with its final absolute path and reader disposition. */
interface NoteSpec {
  absPath: string;
  disposition: Disposition;
}

/** A batch of at least one Note, each with a globally unique absolute path. */
const batchArb: fc.Arbitrary<NoteSpec[]> = fc
  .array(draftArb, { minLength: 1, maxLength: 30 })
  .map((drafts) =>
    drafts.map((draft, index): NoteSpec => ({
      // The trailing `-${index}` makes every file name — hence every absolute
      // path and every per-parent path segment — unique, so each Note maps to a
      // distinct tree leaf and Note<->entry stays one-to-one.
      absPath: '/' + ['content', ...draft.folders, `${draft.base}-${index}.md`].join('/'),
      disposition: draft.disposition,
    })),
  );

describe('ingest — partial-failure ingestion excludes only the failing Notes (Property 6)', () => {
  it('never throws, yields entries for exactly the readable Notes, and one error per failing Note (by absolute path)', () => {
    fc.assert(
      fc.property(batchArb, (specs) => {
        const rawNodes: RawNode[] = specs.map((spec) => ({
          absPath: spec.absPath,
          rawName: spec.absPath.slice(spec.absPath.lastIndexOf('/') + 1),
          isNote: true,
        }));

        const dispositionByPath = new Map(specs.map((spec) => [spec.absPath, spec.disposition]));

        // Oracle: partition purely from the generated dispositions.
        const readablePaths = specs.filter((s) => s.disposition === 'ok').map((s) => s.absPath);
        const failingPaths = specs.filter((s) => s.disposition !== 'ok').map((s) => s.absPath);

        // A reader that fails for exactly the chosen subset: throwing simulates
        // an unreadable file; returning null/undefined an unparseable one.
        const readNote: NoteReader = (node) => {
          const disposition = dispositionByPath.get(node.absPath);
          if (disposition === 'throw') {
            throw new Error(`cannot read ${node.absPath}`);
          }
          if (disposition === 'null') return null;
          if (disposition === 'undefined') return undefined;
          return { body: `BODY:${node.absPath}` };
        };

        // (1) Ingestion completes WITHOUT throwing, whatever subset fails.
        let result: IngestResult | undefined;
        expect(() => {
          result = ingest(rawNodes, readNote);
        }).not.toThrow();
        expect(result).toBeDefined();
        if (!result) return;

        const { entries, report } = result;
        const entryPaths = entries.map((e) => e.sourcePath);
        const errorPaths = report.errors.map((e) => e.sourcePath);

        // (2) Entries are produced for EXACTLY the readable Notes: no duplicates,
        // and the set of entry source paths equals the readable set.
        expect(new Set(entryPaths).size).toBe(entryPaths.length);
        expect([...entryPaths].sort()).toEqual([...readablePaths].sort());

        // No failing Note leaked into the entries...
        for (const failing of failingPaths) {
          expect(entryPaths).not.toContain(failing);
        }
        // ...and every produced entry carries the body the reader returned for
        // its path, confirming these really are the readable Notes.
        for (const entry of entries) {
          expect(entry.body).toBe(`BODY:${entry.sourcePath}`);
        }

        // (3) EXACTLY one error per failing Note, each identifying that Note's
        // absolute file path.
        expect(report.errors.length).toBe(failingPaths.length);
        expect(new Set(errorPaths).size).toBe(errorPaths.length);
        expect([...errorPaths].sort()).toEqual([...failingPaths].sort());

        for (const error of report.errors) {
          expect(typeof error.sourcePath).toBe('string');
          expect(failingPaths).toContain(error.sourcePath);
          expect(typeof error.message).toBe('string');
          expect(error.message.length).toBeGreaterThan(0);
        }
        // No readable Note was mistakenly reported as an error.
        for (const readable of readablePaths) {
          expect(errorPaths).not.toContain(readable);
        }

        // Completeness: every Note became exactly one entry OR one error.
        expect(entries.length + report.errors.length).toBe(specs.length);
      }),
      { numRuns: 100 },
    );
  });
});
