/**
 * Astro Content Collections configuration.
 *
 * In Astro 7 all content collections are declared in a single, top-level
 * `src/content.config.ts` file (the legacy `src/content/config.ts` location is
 * no longer used). See design "Astro Integration Layer".
 *
 * The `notes` collection globs the directory that the content sync step
 * (task 7.1) mirrors the external content root into — `src/content/notes/`,
 * exposed as {@link NOTES_TARGET_DIR}. The glob loader tolerates an empty or
 * missing directory: when the content root has no `.md` files the collection is
 * simply empty and the build still succeeds (Req 1.9). Downstream route and
 * sitemap generation exclude unpublished notes (Req 10.2).
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const notes = defineCollection({
  // Glob every Markdown file under the synced notes directory. `base` is the
  // directory the loader walks; an empty/absent directory yields no entries.
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),

  // Frontmatter schema. Every field is optional so a bare note (no frontmatter)
  // is valid — ingestion derives display names, slugs, and ordering from the
  // file/folder names, not frontmatter.
  schema: z.object({
    // Optional override for the note's display title.
    title: z.string().optional(),
    // Optional meta description; ingestion falls back to body/display name.
    description: z.string().optional(),
    // Publication flag. Notes are published by default (`true`) unless a note
    // explicitly opts out with `published: false`; unpublished notes are
    // excluded from routes and the sitemap downstream (Req 10.2).
    published: z.boolean().optional().default(true),
    // Optional date; coerced so string frontmatter (e.g. "2025-01-01") parses.
    date: z.coerce.date().optional(),
    // Optional difficulty of the material (a separate axis from the roadmap's
    // core/advanced "tier", which is about employability). Shown as a badge.
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    // Optional prerequisites: display names of notes/topics to learn first.
    // Rendered as links under the title (resolved by display name downstream).
    prerequisites: z.array(z.string()).optional(),
  }),
});

export const collections = { notes };
