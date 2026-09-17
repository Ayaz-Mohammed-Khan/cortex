---
title: Math and Code Pipeline Fixture
---

# Math and Code Pipeline Fixture

This fixture sanity-checks the Markdown rendering pipeline (task 8.1): inline
math, block math, invalid math (graceful degradation), a highlighted code
block, and a code block with no recognized language.

## Inline math (Req 3.4)

The mass-energy equivalence is $E = mc^2$, rendered inline within this line.

## Block math (Req 3.5)

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Invalid math (Req 3.6)

This should render its source text with an error indication rather than
failing the build: $\frac{1}{$.

## Highlighted code (Req 3.2)

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`;
}
```

## Plain code, no language (Req 3.3)

```
this is plain monospaced text
with no syntax highlighting
```
