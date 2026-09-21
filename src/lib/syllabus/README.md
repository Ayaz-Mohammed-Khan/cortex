# Syllabus linking

How roadmap topics find their way to the right section of the right note, and
keep doing so as notes are added.

## The problem

The roadmap (`src/data/roadmap.ts`) is written from the CampusX DSMP curriculum.
The notes (`content/**/*.md`) are written independently. The two describe the same
subjects in different words:

| Roadmap bullet | Note heading |
| --- | --- |
| `F-distribution` | `The F-distribution` |
| `Type 1 & Type 2 errors` | `Type I and Type II errors` |
| `z-table` | `Using Z-tables to find probabilities` |
| `Coefficient of variation` | `Coefficient of variation (CV)` |

Hand-maintaining that mapping does not survive contact with a growing notes
folder: rename a heading and the link silently rots. So the mapping is derived.

## Layout

```
src/lib/syllabus/
  vocabulary.ts   data-science synonyms, stopwords, structural words
  normalize.ts    text -> canonical tokens (pure)
  match.ts        scoring engine (pure)
scripts/
  audit-syllabus.ts   coverage + gap report
```

`vocabulary.ts` is the only file that knows any data science. It is plain data, so
teaching the system a term is a one-line edit, not a code change. `match.ts` is
deliberately subject-agnostic.

## How a bullet is placed

1. Both the bullet and every candidate heading are normalized: lowercased, maths
   and punctuation stripped, stopwords dropped, plurals folded, then multi-word
   terms collapsed to a canonical token (`probability mass function` -> `pmf`).
2. Each candidate is scored in one of four tiers:

   | Tier | Meaning | Score |
   | --- | --- | --- |
   | `exact` | identical canonical keys | 1.00 |
   | `alias` | same terms, different wording | 0.95 |
   | `subset` | one side's terms contained in the other's | 0.58 – 0.90 |
   | `overlap` | high Dice coefficient | 0.54 – 0.90 |

3. The winner is chosen by score, then **document-title affinity**, then
   shallower heading, then document order.
4. A near-tie is REFUSED when the rival is in a different note and is no less
   well-named for the topic.

Two rules do most of the work in practice:

- **Title affinity.** A topic belongs to the note named after it. Searching a
  whole category for `Confidence intervals` also finds a plausible section in the
  CLT note; only the note title breaks that tie correctly. Affinity is kept out
  of the score and used purely as a tie-breaker, so it can never manufacture the
  near-ties it exists to settle.
- **Structural words.** A bullet reducing to nothing but words like `summary`,
  `steps` or `code` may only ever match exactly. Those describe a document's
  furniture, not its subject, and would otherwise attach to anything.

The engine is conservative on purpose: a link to the wrong section costs more
than no link, because a reader who lands in the wrong place stops trusting every
other link on the page.

## Adding a note

Nothing to do. Name the note (or its headings) after the topic and it is picked
up on the next build. A roadmap node links itself when its label matches a note
or category Display_Name.

Verified end to end: dropping in a `Decision Trees` note wired the existing
`Decision Trees` node to it and deep-linked 12 of its 13 bullets, with no edit to
any source file.

## Overriding

When the matcher is wrong or cannot place a bullet, name the heading:

```ts
{ label: 'Steps in hypothesis testing', at: 'The rejection-region approach' }
```

`at` is matched with the same engine, so it need only be specific enough to win.
A stale `at` is reported during the build and by `--strict`.

Overrides are a last resort, not the norm: 12 of 195 bullets need one. Prefer
teaching `vocabulary.ts` a term, since that fixes every future note at once.

## The audit

```
npm run audit:syllabus            full report
npm run audit:syllabus -- --gaps  only what needs writing
npm run audit:syllabus -- --json  machine-readable
npm run audit:syllabus -- --strict  exit 1 on a stale override
```

It answers four questions:

1. **Coverage** — what reached a section, by tier.
2. **Unplaced** — bullets on a topic that HAS notes but matched nothing. Either
   the note is missing that heading, or the bullet needs an override.
3. **Unreferenced sections** — headings no bullet points at. Either the roadmap
   is missing a topic, or the section is internal detail.
4. **Notes to write next** — roadmap topics with no note, in study order.

It reads the same data the site renders and slugs headings with the same
`github-slugger` the pages use, so the report cannot drift from the built site.

## Current state

```
195/195 bullets on noted topics placed   (115 exact, 80 subset)
12 overrides
0 low-confidence matches
377 anchor links, 0 broken
```

## Content layout

Notes live in `content/<NN - Track>/<NN - Note>.md`, one folder per roadmap
track, numbered per folder, with a sibling `ASSETS/` holding only that track's
images. Wikilinks use the bare note name (`[[ANOVA]]`), so renumbering a folder
never breaks a link. Three folders exist today:

```
content/01 - Descriptive Statistics/     3 notes
content/02 - Probability Distributions/  5 notes
content/03 - Inferential Statistics/     6 notes
```

A roadmap track resolves to its folder; a sub-topic resolves to its note. Since
the folder and the track share a name, `targetFor(topic, preferCategory)` picks
which one, so adding a folder named after a track is all it takes to wire up a
new area.
