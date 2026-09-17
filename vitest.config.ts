/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// Vitest configuration layered on top of Astro's own Vite config so tests share
// the same resolver, plugins (Tailwind v4 via @tailwindcss/vite), and `@/*`
// path aliases as the site build. This keeps the pure Ingestion Domain logic
// and (later) DOM-based component tests running against the real project setup.
// Supports the test infrastructure that verifies the pure logic at build time
// (Req 9.1).
export default getViteConfig({
  test: {
    // jsdom gives later presentation-layer tests (TOC, nav drawer, theme
    // toggle, search UI) a DOM without a real browser. Pure ingestion tests
    // ignore it and run just as fast.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // The two build smoke tests (seo-sitemap, prerender) share on-disk build
    // artifacts (dist/ and src/content/notes/), so run test files sequentially
    // to prevent them from clashing on those shared outputs.
    fileParallelism: false,
    include: [
      'src/**/*.test.ts',
      'src/**/*.property.test.ts',
      'tests/**/*.test.ts',
      'tests/**/*.property.test.ts',
    ],
    exclude: ['node_modules', 'dist', '.astro'],
  },
});
