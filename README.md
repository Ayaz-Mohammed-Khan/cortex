<div align="center">

# 🧠 Cortex

**A visual, syllabus-grade data-science learning roadmap, backed by real notes.**

Follow an interactive map from Python foundations to deployment. Click any topic
to see exactly what to learn, then jump straight into the notes.

[**Visit the site →**](https://cortex-5om.pages.dev)

[![Built with Astro](https://img.shields.io/badge/built%20with-Astro-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
![Node 22](https://img.shields.io/badge/node-22%20LTS-339933?logo=node.js&logoColor=white)

</div>

---

## About

Cortex is a personal, open-source project. It is how I share my data-science
learning and notes with the community in a structured, navigable way rather than
as a scattered pile of files.

Under the hood it turns a plain folder of Markdown notes into a browsable
knowledge site with an **interactive roadmap** on the front. The guiding idea is
simple: **you write Markdown, and the site does the rest.** No CMS, no database,
no build step to babysit.

The roadmap graph and the notes stay in sync automatically. A matching engine
maps each roadmap topic to the right note heading, so a topic like *ANOVA*
deep-links to the ANOVA notes without any manual wiring.

## Highlights

- 🗺️ **Interactive roadmap.** A **Simple** view shows the phases at a glance, and
  a **Detailed** view lays out every sub-topic on a spine. Click a node for its
  concept list and links.
- 🔗 **Automatic deep-linking.** A subject-agnostic matcher connects syllabus
  bullets to real note headings. Run `npm run audit:syllabus` for a coverage and
  gap report.
- 🎯 **Core vs. advanced tiers.** The map marks which topics are essential and
  which are safe to defer.
- 📝 **Markdown-first notes.** Wikilinks (`[[Note]]`), callouts, KaTeX math, and
  auto-linked headings, all resolved at build time.
- 🔍 **Instant search** over the built site via Pagefind.
- 🌗 **Light and dark themes**, responsive from phone to desktop, and
  accessibility-minded (keyboard navigation, ARIA, axe-tested).

## Tech stack

| Concern | Tool |
| :--- | :--- |
| Framework | [Astro](https://astro.build) (static output) |
| Styling | [Tailwind CSS](https://tailwindcss.com) |
| Markdown | remark / rehype (math, callouts, wikilinks, slugs) |
| Math | [KaTeX](https://katex.org) |
| Search | [Pagefind](https://pagefind.app) |
| Tests | [Vitest](https://vitest.dev) + [fast-check](https://fast-check.dev) + axe |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) (auto-deploy on push) |

## Quick start

Requires **Node 22 LTS**.

```bash
npm install
npm run dev        # dev server + live content sync, at http://localhost:4321
```

Common scripts:

```bash
npm run build            # static build into dist/ (plus the Pagefind search index)
npm run preview          # serve the production build locally
npm run typecheck        # astro check
npm test                 # unit + property tests
npm run audit:syllabus   # roadmap-to-notes mapping coverage report
```

## Writing notes

Notes live in `content/`, one folder per roadmap track, numbered for order:

```
content/
├─ 01 - Descriptive Statistics/
│  ├─ 01 - Foundations and Central Tendency.md
│  ├─ 02 - Quantiles and Box Plots.md
│  └─ ASSETS/…                       # images, referenced relatively
├─ 02 - Probability Distributions/
└─ 03 - Inferential Statistics/
```

Scaffold a new note (auto-numbered, with starter frontmatter):

```bash
npm run new -- "Central Limit Theorem" --category "03 - Inferential Statistics"
```

Then just **commit and push**. See [`AUTHORING.md`](./AUTHORING.md) for the full
authoring guide and [`DEPLOY.md`](./DEPLOY.md) for the publishing flow.

> The generated `src/content/notes/` and `dist/` are never committed. The build
> regenerates them from `content/`.

## How it deploys

```
write note  →  commit  →  push to main  →  Cloudflare Pages rebuilds  →  live in ~1-2 min
```

On push, Cloudflare runs `npm ci && npm run build`, which mirrors `content/` into
the site, renders the static pages, and builds the search index. There is no
manual deploy step.

## Project layout

```
content/            the Markdown notes (the source of truth)
src/
├─ pages/           routes, including the roadmap landing page
├─ components/      layout, navigation, and the roadmap graph island
├─ data/roadmap.ts  the roadmap syllabus (auditable data)
├─ lib/syllabus/    the topic-to-heading matching engine
└─ styles/
scripts/            content sync, note scaffolder, syllabus audit
```

## Contributing

Suggestions, corrections, and issues are welcome. If you spot an error in a note
or want to propose a topic, please open an issue or a pull request.

## License

Released under the [MIT License](./LICENSE). The notes and content are shared
freely for learning; please credit the source if you reuse them. Content is
derived from the CampusX DSMP 2.0 curriculum.

---

<div align="center">
<sub>Built and maintained as a personal learning project, shared openly with the community.</sub>
</div>
