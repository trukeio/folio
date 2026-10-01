# Truke Folio — design documents

A client-side paged-media engine: a Paged.js successor with the same feature
surface, a smaller and well-tested codebase, and mathematics treated as a
first-class part of the layout problem rather than a plugin.

| Document | What is in it |
| --- | --- |
| [plan.md](plan.md) | The engine plan: lessons from the existing engines, the five-stage pipeline, the fragmenter, the feature map, the CSS strategy, math, sunsetting, validation, roadmap, risks. |
| [rationale.md](rationale.md) | What replacing Paged.js and MathJax bought, measured: lines of source, download size and speed against both, and what it cost. |
| [math.md](math.md) | The math subsystem in implementation detail: font pipeline, the inline-axis fragmenter, numbering and references, module layout, test plan, open questions. |
| [tex.md](tex.md) | The TeX front end (`@truke/folio-temml`): MathJax-style `\\( … \\)` and `\\[ … \\]` delimiters, configurable; how `\\label`, `\\tag` and `\\eqref` reach the core's own numbering. Done. |
| [math-drop-in.md](math-drop-in.md) | The math drop-in: the book's numbering, breaking and references on a screen with no pages, from the same source. Done. |
| [native-support.md](native-support.md) | What the three browsers support natively, by WPT reftest: the baseline the §8 deletion conditions are asked against. And the same suite's paginated half, with the engine loaded. |
| [wpt-failures.md](wpt-failures.md) | Every paginated WPT test the engine fails, grouped by cause, with where to start: M6's working list. |
| [review.md](review.md) | The design reviews, in order: the M0.3 multicol spike (the browser cannot decide our breaks), edge values and what a page is, the root element on every page, content taller than a page, vertical writing, footnote splitting, page floats, `::nth-fragment`. All implemented. |
| [milestones.md](milestones.md) | The execution plan: M0–M6 with scope, sizes, dependencies, exit checks, the decisions each milestone forces, and the standing gates. |
| [differential.md](differential.md) | M3's exit check: every corpus fixture where we and Paged.js disagree, what was measured, the eleven bugs the walk found in us, and the verdict on each difference that remains. |
| [compat.md](compat.md) | M5.1's exit check: what a Paged.js project keeps when it swaps its script tag, what runs differently, and which hooks are not there and why. |
| [using.md](using.md) | How to load the distribution in a web application: the drop-in, the library and the viewer, the CSS, and the three things that catch people. |

The same plan is also published as a designed page:
<https://claude.ai/artifact/12NaZMJTqsMKme2ivoKjjY> (Rev. 3, with the milestones
as built). When the two
disagree, this directory is the source of truth.

## Ground rules

**License.** MIT. Vivliostyle is AGPL: study its behaviour, documentation and
public issues, but do not read its source while writing the equivalent module
and do not port its test files. WPT tests are BSD-3 and safe to use. Paged.js is
MIT, so its spec corpus can be reused directly as fixtures.

**Browser floor.** Chromium 109 (Jan 2023), Firefox 115, Safari 16.4. This floor
is set by MathML Core, which is the strictest requirement in the plan; every
other module may assume it. Nothing older is supported and no effort goes into
feature-detecting around it.

**Design rule.** The browser does layout; JavaScript only decides where things
break. Every polyfill module declares the condition under which it can be
deleted. The engine is meant to get smaller as browsers improve, which is why it
does not own a CSS cascade.

## Scope

In scope: CSS Paged Media 3, CSS Break 3/4, GCPM 3 generated content, footnotes,
table splitting, MathML Core mathematics with paged extensions, and a viewer
package.

Out of scope for the core: TeX parsing (a separate optional package), EPUB and
multi-document publications, elementary-math notation (`mstack`, `mlongdiv`,
`menclose`), real CMYK output, and a CSS cascade of our own.
