# Authoring notes

A practical guide to writing notes for this site. You write plain Markdown in
`content/`; the build mirrors it into the site. No CMS, no database.

## Where notes live

- Notes live under `content/`. **Each top-level folder is a category**, named
  after a roadmap track (e.g. `content/03 - Inferential Statistics/`).
- You edit files in `content/` only. A sync step mirrors `content/` into the
  generated `src/content/notes/` that Astro reads — that folder is generated,
  never edit it by hand.
- Point the build at a different location with the `CONTENT_ROOT` env var
  (default `./content`).

## File naming and numbering

Name files `NN - Name.md`, e.g. `03 - The Normal Distribution.md`.

- The leading `NN` is a numeric **order prefix** that controls ordering in the
  nav (lower numbers first). Any run of digits works; two digits keeps things
  tidy.
- The separator can be space/hyphen/underscore/dot in any mix; it's stripped.
- The **display name** is the clean part after the prefix (`The Normal
  Distribution`) — that's what shows in headings, links, and titles. The number
  never appears in the display name.
- Files without a numeric prefix sort alphabetically after the numbered ones.

## Images

- Put images in an `ASSETS/` folder next to the note.
- Reference them with a relative path: `![Alt text](./ASSETS/diagram.png)`.
- Supported: `.png .jpg .jpeg .gif .svg .webp .avif`. Images are staged next to
  the note at build time so relative references resolve.

## Wikilinks and backlinks

- Link to another note by its display name: `[[The Normal Distribution]]`.
- Use an alias for custom link text: `[[The Normal Distribution|the normal]]`.
- **Backlinks are automatic** — every note shows which other notes link to it,
  no manual bookkeeping.

## Drafts

- Add `published: false` to a note's frontmatter to keep it out of the built
  site while you work on it. Remove it (or set `true`) to publish.

## Callouts

Use blockquote callouts:

```markdown
> [!note] Optional title
> Body text.
```

Types: `note`, `info`, `tip`, `warning`, `example`.

## Math

- Inline: `$x + 5 = 10$`
- Block:

  ```markdown
  $$
  \bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i
  $$
  ```

## Frontmatter

Common keys used across notes:

```yaml
---
tags: [statistics, probability]
created: 2026-07-08
# optional:
# published: false
# description: One-line summary for SEO/listings.
# title: Override the display name.
# date: Display/sort date.
---
```

## Workflow

### Scaffold a new note

```powershell
npm run new -- "Central Limit Theorem"
npm run new -- "Central Limit Theorem" --category "03 - Inferential Statistics"
npm run new -- "Central Limit Theorem" --order 07
```

This creates `NN - Title.md` in the category (auto-numbered to the next order),
seeds frontmatter + a starter body, and auto-links a "Continues from" callout to
the previous note in that category so the chain stays connected. It never
overwrites an existing file.

### Live preview

```powershell
npm run dev
```

Runs the dev server **and** a content watcher together. Add, rename, or edit a
note in `content/` and it's mirrored into the site live — new notes and their
wikilinks show up without restarting. Ctrl+C stops both cleanly.

### Deploy

Push to git. Cloudflare Pages rebuilds on push: it runs the content sync,
builds the site, and indexes search. No manual deploy step. See `DEPLOY.md`.
