import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { resultMeta, type SearchRecordMeta } from './search';

// Feature: portfolio-website, Property 16: For any search result record, the rendered result output contains that Note's Display_Name and its Category path.

/**
 * Property 16: Search result rendering fields.
 *
 * Validates: Requirements 6.7
 *
 * For any indexed search record, `resultMeta` projects the record onto the
 * fields the result UI renders. The property asserts that the rendered output
 * always carries both the Note's Display_Name and its Category path (plus the
 * route used for linking), regardless of the record's other contents. Extra
 * fields on the record are ignored, and the projection is a pure, faithful
 * copy of the relevant values.
 */

const RUNS = { numRuns: 100 };

/** A record structurally satisfying SearchRecordMeta, with arbitrary strings. */
const recordArb: fc.Arbitrary<SearchRecordMeta> = fc.record({
  displayName: fc.string({ maxLength: 80 }),
  categoryPath: fc.string({ maxLength: 120 }),
  route: fc.string({ minLength: 1, maxLength: 120 }),
});

/**
 * A wider record: the SearchRecordMeta fields plus arbitrary extra keys, to
 * confirm the projection ignores anything beyond the rendered fields.
 */
const wideRecordArb = fc.record({
  displayName: fc.string({ maxLength: 80 }),
  categoryPath: fc.string({ maxLength: 120 }),
  route: fc.string({ minLength: 1, maxLength: 120 }),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
  excerpt: fc.string({ maxLength: 200 }),
  url: fc.string({ maxLength: 120 }),
});

describe('resultMeta rendered fields (Property 16)', () => {
  it("exposes the record's Display_Name and Category path for every record", () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const view = resultMeta(record);
        // The rendered output carries the Display_Name and the Category path...
        expect(view.displayName).toBe(record.displayName);
        expect(view.categoryPath).toBe(record.categoryPath);
        // ...plus the route used to link the result.
        expect(view.route).toBe(record.route);
      }),
      RUNS,
    );
  });

  it('ignores fields beyond the rendered projection', () => {
    fc.assert(
      fc.property(wideRecordArb, (record) => {
        const view = resultMeta(record);
        // Only the three rendered fields are exposed, drawn from the record.
        expect(view).toEqual({
          displayName: record.displayName,
          categoryPath: record.categoryPath,
          route: record.route,
        });
        expect(Object.keys(view).sort()).toEqual(['categoryPath', 'displayName', 'route']);
      }),
      RUNS,
    );
  });

  it('is pure: same input yields an equal, independent projection', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const a = resultMeta(record);
        const b = resultMeta(record);
        expect(a).toEqual(b);
        // A fresh object each call, not the input record itself.
        expect(a).not.toBe(b);
        expect(a).not.toBe(record);
      }),
      RUNS,
    );
  });
});
