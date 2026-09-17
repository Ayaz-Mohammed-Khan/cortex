import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
// Importing the island binds its delegated input/click/keydown listeners once.
import './search';

/**
 * Search UI messages unit test (task 18.2; Req 6.3, 6.4, 6.5, 6.7).
 *
 * A fake Pagefind instance is injected on the global so the island's real
 * query flow runs without the built runtime: a query shorter than two
 * characters shows the min-length message and never searches (Req 6.4); a query
 * with no matches shows the no-results message (Req 6.5); and matching results
 * render each Note's Display_Name and Category path (Req 6.7).
 */

function makeResult(index: number) {
  return {
    data: async () => ({
      url: `/notes/n${index}`,
      excerpt: `Excerpt ${index}`,
      meta: { displayName: `Note ${index}`, categoryPath: 'AI-ML / SelfNotes' },
    }),
  };
}

// Records every call the island makes into the (fake) Pagefind engine so a test
// can assert that a sub-min-length query is never actually searched (Req 6.4).
let searchCalls = 0;

beforeAll(() => {
  (globalThis as unknown as { pagefind: unknown }).pagefind = {
    async search(query: string) {
      searchCalls += 1;
      if (query === 'zzz') return { results: [] };
      return { results: [makeResult(0), makeResult(1), makeResult(2)] };
    },
  };
});

beforeEach(() => {
  searchCalls = 0;
  document.body.innerHTML = `
    <input data-search-input />
    <p data-search-status></p>
    <ul data-search-results></ul>`;
});

const statusText = () => document.querySelector('[data-search-status]')!.textContent ?? '';
const results = () => document.querySelector('[data-search-results]')!;

function type(query: string): void {
  const input = document.querySelector('[data-search-input]') as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitFor(predicate: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('search UI messages (task 18.2)', () => {
  it('shows the min-length message and does not execute the search for < 2 characters', async () => {
    type('a');
    await waitFor(() => statusText().toLowerCase().includes('at least 2'));
    expect(results().children.length).toBe(0);
    // Req 6.4: a query shorter than two characters must NOT run the search.
    expect(searchCalls).toBe(0);
  });

  it('shows the min-length message and does not execute the search for an empty query', async () => {
    type('');
    await waitFor(() => statusText().toLowerCase().includes('at least 2'));
    expect(results().children.length).toBe(0);
    expect(searchCalls).toBe(0);
  });

  it('shows the no-results message when nothing matches', async () => {
    type('zzz');
    await waitFor(() => statusText().toLowerCase().includes('no results found'));
    expect(results().children.length).toBe(0);
  });

  it('renders each result with its Display_Name and Category path', async () => {
    type('note');
    await waitFor(() => results().children.length === 3);
    const html = results().innerHTML;
    expect(html).toContain('Note 0');
    expect(html).toContain('AI-ML / SelfNotes');
    expect(html).toContain('href="/notes/n0"');
    expect(statusText().toLowerCase()).toContain('result');
  });
});
