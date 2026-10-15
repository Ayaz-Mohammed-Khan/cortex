<div align="center">

# 🧠 Cortex

**Structured to learn. Engineered to remember.**

A free, open data-science learning site: a curated roadmap from Python
foundations to deployment, backed by rich interlinked notes, plus a full
active-recall layer (quizzes, flashcards, and spaced repetition) that makes what
you learn actually stick.

[**Visit the site →**](https://cortex-5om.pages.dev)

[![Built with Astro](https://img.shields.io/badge/built%20with-Astro-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/deploy-Cloudflare%20Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)
![Node 22](https://img.shields.io/badge/node-22%20LTS-339933?logo=node.js&logoColor=white)

</div>

---

## About

Cortex is a personal, open-source project. It is how I share my data-science
learning in a structured, navigable way rather than as a scattered pile of files.

Under the hood it turns a plain folder of Markdown notes into a browsable
knowledge site. The guiding idea is simple: **you write Markdown, and the site
does the rest.** No CMS, no database, no build step to babysit.

But reading is only half of learning. Cortex also tracks your progress, quizzes
you on each topic, and schedules spaced-repetition reviews, all stored locally
in your browser, with no account and no tracking. The roadmap, the notes, and
your recall all stay in sync automatically.

## Highlights

### The learning path

- 🗺️ **Interactive roadmap** (`/roadmap`). A **Simple** view shows the phases at
  a glance; a **Detailed** view lays out every sub-topic on a dependency spine.
  Click any node for its concept list, prerequisites, and links.
- 🔗 **Automatic deep-linking.** A subject-agnostic matcher connects syllabus
  bullets to real note headings, so a topic deep-links to the right section with
  no manual wiring. Run `npm run audit:syllabus` for a coverage and gap report.
- 🎯 **Tiers and prerequisites.** The map marks core vs. optional topics and
  reads one shared prerequisite source, so the order never contradicts itself.

### The notes

- 📝 **Markdown-first, richly presented.** Wikilinks (`[[Note]]`) with automatic
  backlinks, callouts, KaTeX math, syntax-highlighted code, tables, images, and
  auto-linked headings, all resolved at build time.
- 🔍 **Instant full-text search** over the built site via Pagefind, with results
  linked to the matching section and the phrase highlighted on the page.

### Learn it, then keep it

- ✅ **Per-note quizzes with completion gating.** Each note carries a question
  bank; a graded attempt samples a fresh, timed, stratified subset every sitting
  (strict wall-clock timer). Pass and the topic is marked done: you earn
  completion, you don't just tick a box. Green ticks propagate to the roadmap and
  the nav.
- 🔁 **Flashcards mode.** The same banks, framed for pure recall: flip to the
  worked answer and the reasoning, then grade yourself.
- 🧠 **Spaced-repetition reviews.** Passing a topic enrols it on a schedule that
  stretches as you keep getting it right and snaps back when you slip, surfacing
  each topic right before you'd forget it.
- 📚 **Cumulative recall.** Weekly and monthly sessions interleave everything
  you've covered across notes, not one topic at a time.
- 📈 **Progress tracking** across the roadmap and notes, with a filling meter.
- 🗒️ **Per-note scratchpad.** A private notepad on every page; writing a topic in
  your own words is a small act of recall. Autosaves locally.

### Yours, and polished

- 🔒 **Local-first and private.** Progress, reviews, recall, and scratchpads live
  only in your browser (a versioned local store). No account, no tracking. A
  **Your data** bar lets you back up, restore, or reset anytime.
- 🌗 **Light and dark themes**, dark by default, with a token-driven palette.
- ♿ **Accessibility-minded** throughout: keyboard navigation, ARIA, visible
  focus, and axe-tested markup, responsive from phone to desktop.

## Tech stack

| Concern | Tool |
| :--- | :--- |
| Framework | [Astro](https://astro.build) (static output) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) (first-party Vite plugin) |
| Markdown | remark / rehype (math, callouts, wikilinks, slugs, sanitize) |
| Math | [KaTeX](https://katex.org) |
| Search | [Pagefind](https://pagefind.app) |
| State | versioned local store in the browser (progress, reviews, recall, scratchpad) |
| Tests | [Vitest](https://vitest.dev) + [fast-check](https://fast-check.dev) (property tests) + axe |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com) (auto-deploy on push) |
| Runtime | Node 22 LTS (pinned) |

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
npm test                 # unit + property tests (vitest run)
npm run audit:syllabus   # roadmap-to-notes mapping coverage report
npm run check:prereqs    # validate prerequisite links across notes
npm run check:quizzes    # validate every per-note quiz bank
```

The `prebuild` step runs the content sync and the prerequisite/quiz validators
automatically, so a bad link or malformed quiz bank fails the build early.

## Writing notes

Notes live in `content/`, one folder per roadmap track, numbered for order. Each
note can carry a sibling `*.quiz.json` bank:

```
content/
├─ 01 - Python Foundations/
│  ├─ 01 - Python Fundamentals.md
│  ├─ 01 - Python Fundamentals.quiz.json   # the note's question bank
│  └─ ASSETS/…                             # images, referenced relatively
├─ 02 - OOP & Advanced Python/
├─ 06 - Descriptive Statistics/
├─ 07 - Probability Distributions/
└─ 08 - Inferential Statistics/
```

Scaffold a new note (auto-numbered, with starter frontmatter):

```bash
npm run new -- "Central Limit Theorem" --category "08 - Inferential Statistics"
```

Then just **commit and push**. See [`AUTHORING.md`](./AUTHORING.md) for the full
authoring guide (frontmatter, callouts, math, images, and quiz-bank format) and
[`DEPLOY.md`](./DEPLOY.md) for the publishing flow.

> The generated `src/content/notes/` and `dist/` are never committed. The build
> regenerates them from `content/`.

## How it deploys

```
write note  →  commit  →  push to main  →  Cloudflare Pages rebuilds  →  live in ~1-2 min
```

On push, Cloudflare runs `npm ci && npm run build`, which mirrors `content/` into
the site, validates it, renders the static pages, and builds the search index.
There is no manual deploy step.

## Project layout

```
content/            the Markdown notes + per-note quiz banks (the source of truth)
src/
├─ pages/           routes: index.astro (landing page), /roadmap, note pages
├─ components/      layout, nav, the roadmap graph island, quiz/recall/theme islands
├─ data/roadmap.ts  the roadmap syllabus (auditable data)
├─ lib/
│  ├─ ingest/       turns the content folder into an ordered nav tree
│  ├─ markdown/     remark/rehype plugins: callouts, wikilinks, math, blockrefs
│  ├─ syllabus/     the topic-to-heading matching engine
│  ├─ store.ts      versioned local-state store (progress, reviews, recall, …)
│  ├─ quiz*.ts      quiz loading, sampling, and grading
│  ├─ recall*.ts    cumulative-recall scheduler and sampler
│  ├─ review.ts     spaced-repetition scheduling over quizzes
│  └─ *.ts          progress, scratchpad, search, toc, seo, theme, section
└─ styles/
scripts/            content sync, note scaffolder, syllabus/prereq/quiz validators
```

## Contributing

Suggestions, corrections, and issues are welcome. If you spot an error in a note
or want to propose a topic, please open an issue or a pull request.

## License

Released under the [MIT License](./LICENSE). The notes and content are original
work written for Cortex.

---

<div align="center">
<sub>Built and maintained as a personal learning project, shared openly with the community.</sub>
</div>
