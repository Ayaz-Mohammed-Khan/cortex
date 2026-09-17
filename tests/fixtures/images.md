---
title: Image Fallback Fixture
---

# Image Fallback

This fixture covers broken/unresolvable images (Req 3.8). Both images point at
relative paths that do not resolve to a real asset. The pipeline must preserve
the `alt` text (so a Reader still gets a description when the image fails to
load) and must keep rendering the surrounding content.

Some text before the first image.

![A labelled architecture diagram](./assets/missing-diagram.png)

Some text between the two images.

![](./assets/no-alt-image.png)

Some text after the last image.
