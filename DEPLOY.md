# Deploy & Publish Workflow

This site is a fully static Astro build (`output: 'static'`, emitted to `dist/`)
hosted on **Cloudflare Pages**, connected to this Git repo and **auto-deploying
on every push** to the `main` branch. The whole publishing loop is:

> **Write a note → commit → push. Cloudflare Pages rebuilds and the live site shows it in ~1–2 min.**

No manual deploy step, no build script to run locally, no server to restart.

---

## Ongoing workflow (the day-to-day answer)

1. Add a note under `content/` — either create the `.md` by hand following the
   `NN - Title.md` convention, or scaffold one:
   ```powershell
   npm run new -- "Central Limit Theorem"
   # or target a category / order:
   npm run new -- "Central Limit Theorem" --category "Statistics & Probability" --order 07
   ```
2. Commit and push the note (and any images it references):
   ```powershell
   git add content/
   git commit -m "add note: Central Limit Theorem"
   git push
   ```
3. That's it. On push, Cloudflare Pages runs `npm ci && npm run build`, which:
   - `prebuild` → `node --experimental-strip-types scripts/sync-content.ts`
     mirrors `content/` into the generated `src/content/notes/`,
   - `astro build` → renders the static site into `dist/`,
   - `postbuild` → `pagefind --site dist` builds the search index.

   The live site reflects the new content automatically. You never commit the
   generated `src/content/notes/` or `dist/` — Cloudflare regenerates them on the
   build server.

### Content rules to remember
- **Images must be committed.** Put them in an `ASSETS/` folder next to the note
  and reference them relatively (e.g. `![](./ASSETS/diagram.png)`). The sync step
  stages `.png .jpg .jpeg .gif .svg .webp .avif` so relative refs resolve at build.
- **Drafts stay unpublished.** Set `published: false` in a note's frontmatter to
  keep it out of the build/sitemap until it's ready.

### Trigger a deploy without a push (optional)
In the Cloudflare Pages dashboard you can open the project → **Deployments** and
click **Retry deployment**, or create a **Deploy Hook** (project → Settings →
Builds & deployments → Deploy hooks) and `curl` its URL to kick off a fresh
build without committing.

---

## First-time setup

1. **Initialize and push the repo** (from the project root):
   ```powershell
   git init            # if not already a repo
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/Ayaz-Mohammed-Khan/cortex.git
   git push -u origin main
   ```
   The `.gitignore` already tracks `content/` (your notes + their `ASSETS/`
   images) and ignores generated output (`src/content/notes/`, `dist/`,
   `node_modules/`).

2. **Create the Cloudflare Pages project.** In the Cloudflare dashboard
   (dash.cloudflare.com):
   **Workers & Pages → Create → Pages → Connect to Git → pick this GitHub repo.**

   Then set the build configuration:
   - **Framework preset:** `Astro` (or "None" — the commands below are what matter)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Production branch:** `main`
   - **Environment variable:** add `NODE_VERSION` = `22`
     (Cloudflare also reads the committed `.nvmrc` / `.node-version`, both `22`,
     but setting the variable makes it explicit.)

   The committed `wrangler.toml` records the project name (`cortex-notes`) and
   the build output dir (`dist`) as code.

   Click **Save and Deploy**. Cloudflare runs the build and publishes to a URL
   like `https://cortex-notes.pages.dev`.

3. **Auto-deploy is on by default.** Cloudflare Pages watches the connected repo
   and rebuilds on every push to `main`. Pushes to other branches produce
   *preview* deployments at their own URLs — handy for reviewing a draft before
   merging to `main`.

4. **Set the canonical site URL.** After the first deploy Cloudflare assigns the
   `*.pages.dev` URL (or your custom domain if you add one).

   > **TODO:** update `site:` in `astro.config.mjs` from the placeholder
   > `https://example.com` to your real Pages origin (e.g.
   > `https://cortex-notes.pages.dev`), then commit + push. This is required for
   > correct canonical URLs and the generated sitemap. Do this once the URL is
   > known.

---

## Node version pinning (why it matters)

The build runs `.ts` scripts directly with Node's native TypeScript support
(`node scripts/sync-content.ts`, and `.ts` imports in `astro.config.mjs`). To
keep prod builds reproducible the Node version is pinned to **22 LTS**:
`package.json` `engines` (`>=22 <23`), `.nvmrc` (`22`), `.node-version` (`22`),
and the `NODE_VERSION=22` environment variable set in the Cloudflare Pages
project.

The `node scripts/*.ts` invocations pass `--experimental-strip-types`. The
scripts use only strippable type annotations (no enums/namespaces/decorators),
so this flag is **required** on Node 22.6–22.17 (where type-stripping is opt-in)
and a **harmless no-op** on Node 22.18+ where stripping is already the default.
This guarantees the scripts run regardless of which 22.x minor Cloudflare selects.

---

## Caching (`public/_headers`)

`public/_headers` ships verbatim into `dist/` and Cloudflare Pages honors this
Netlify-style format. It long-caches the content-hashed, immutable build assets
(`/_astro/*`, `/pagefind/*`, `*.woff2`) while leaving HTML on short caching so
content edits appear promptly.
