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

## Runnable code

Python code blocks can become runnable, editable cells in the browser, powered
by Pyodide. This is a progressive enhancement: the authored code and its static
output always render, and only turn interactive after the reader clicks Run.

- Opt a note in by adding `runnable: true` to its frontmatter. Every `python`
  and `py` code fence in that note then gets a Run button.
- Opt a single block out by making its first code line exactly `# cortex:norun`.
  Use this for illustrative or broken snippets that should not run. The marker
  is a normal Python comment, so it is harmless if the reader never runs the
  block.
- The first Run loads Python once per browser session from the jsDelivr CDN
  (the status pill reads "Warming up Python... this happens once."); later runs
  are instant and reuse the same runtime, even after navigating to another note.
- Keep the authored static output fence (the ```` ```text ```` block) next to a
  runnable block. Readers with no JavaScript, and everyone before clicking Run,
  still see a correct result.
- Packages are loaded on demand from what the code imports (numpy, pandas,
  matplotlib, scipy, scikit-learn, and more from the Pyodide distribution).
  seaborn, openpyxl, and textblob are not in Pyodide, and nltk corpora need a
  third-party download, so cells that use them must be `# cortex:norun`.
- Code cannot read files from your disk. To work with data, build it inline in
  the block or load a bundled dataset with `cortex_data(...)` (below). A
  `pd.read_csv("some/path.csv")` or `pd.read_excel(...)` example is fine to
  teach, but mark it `# cortex:norun`.

```yaml
---
runnable: true
---
```

### Datasets

Runnable cells can load the datasets shipped in `public/datasets/` (served at
`/datasets/`). The list, with sources and licenses, is in
`public/datasets/manifest.json` and `public/datasets/LICENSES.md`.

- Call `cortex_data("name")` to get a fresh pandas DataFrame. Any `read_csv`
  keyword passes through, e.g. `cortex_data("kohli_ipl", index_col="match_no")`
  or `cortex_data("logins", header=None)`. For a Series, add
  `.squeeze("columns")`. `cortex_data` needs no import, and pandas is loaded
  for it automatically.
- Write the name as a literal string (`"films"` or `'films'`). The runner scans
  the code for literal names and downloads those files before the code starts,
  so `cortex_data(choice)` or an f-string name cannot work and raises a clear
  error. An unknown name raises a `ValueError` listing every available dataset.
- The first run that uses a dataset shows "Loading dataset..." in the status
  pill while pandas and the file download. Later runs, and other cells on any
  note in the same session, reuse the cached copy. Download time never counts
  against the run time limit.
- Keep each block self-contained: load its own data at the top, and never rely
  on a variable from another fence.
- Static output fences must come from running the exact code against the
  shipped files with the pandas version the browser runs (Pyodide 0.29.3:
  pandas 2.3.3, numpy 2.2.5, matplotlib 3.8.4). Use a Python 3.12 venv with
  those versions and a shim
  `cortex_data = lambda name, **kw: pd.read_csv(f"public/datasets/{name}.csv", **kw)`.
  Never paste notebook outputs, and avoid deprecated aliases that print
  warnings (use `"ME"`, `"YE"`, `"h"`, `.ffill()`, `numeric_only=True`).

Commercial-safe data only. Ship a third-party dataset only when its publisher's
page confirms a license that allows commercial use and modified
redistribution: CC0, CC BY 4.0, ODbL 1.0, or MIT (the build script refuses
anything else). Never ship NonCommercial, NoDerivatives, or unknown-license
data. Otherwise add a seeded synthetic dataset instead.

Adding a dataset, end to end:

1. Edit `scripts/build-datasets.py`. For publisher data, add a `RAW_SOURCES`
   entry (page URL, download URL that needs no login, zip member if any, byte
   count, and SHA-256 of the CSV itself), then a `DATASETS` entry with its
   build function, source, license, and a one-line `changes` rule. For
   synthetic data, write a generator seeded with `random.Random(<seed>)` that
   uses only `random()` and the script's helpers, asserts its invariants, and
   register it with `_synthetic(...)`.
2. Run `python scripts/build-datasets.py --fetch` (downloads into the
   gitignored `.agents/dataset-cache`, verifies the hash, writes the CSVs,
   `manifest.json`, `LICENSES.md`, and `.gitattributes`). If a download needs
   a login, save the file by hand from the page into the cache under the name
   the error prints. Never use or commit credentials.
3. Run `python scripts/build-datasets.py --check` (must report identical
   files) and `npm test` (checks hashes, sizes, budgets of 2 MB per file and
   6 MB total, and licenses).
4. Commit the script and everything in `public/datasets/` together. Never edit
   those generated files by hand.

Credit the data in every note that loads it with one callout directly after
the opening paragraph, listing each dataset in order of first use:

```markdown
> [!info] Dataset
> - **<title>** (`cortex_data("<name>")`) from [<source name>](<source url>). License: [<license short name>](<license url>). <Trimmed: rule. | Derived: rule. | Shipped whole.>
> - **<title>** (`cortex_data("<name>")`): synthetic data generated for Cortex, not real records. License: [MIT](https://github.com/Ayaz-Mohammed-Khan/cortex/blob/main/LICENSE).
>
> Full credits and license terms: [dataset licenses (Markdown file)](/datasets/LICENSES.md).
```

The title comes from the manifest `title`. License short names are `CC BY 4.0`,
`ODbL 1.0`, `CC0 1.0`, and `MIT`. Where a note first uses synthetic data, say
in the prose that it is generated and fictional, and never present results
from it as real findings.

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
