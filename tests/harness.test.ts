import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Placeholder sanity check confirming the Vitest + fast-check + jsdom harness
// is wired up correctly. Real tests replace/extend this as the Ingestion Domain
// and presentation helpers land.
describe('test harness', () => {
  it('runs Vitest', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs fast-check property checks', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 100 },
    );
  });

  it('exposes a jsdom document', () => {
    expect(typeof document).toBe('object');
    const el = document.createElement('div');
    el.textContent = 'ok';
    expect(el.textContent).toBe('ok');
  });
});
