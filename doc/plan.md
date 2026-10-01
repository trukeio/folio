# Same pages, less engine

A plan for a paged-media engine that matches today's Paged.js features with a
smaller, well-tested codebase. It borrows proven ideas from Vivliostyle but none
of its code, it is built so that code can be deleted as browsers add native
support, and it treats mathematics as a fragmentation problem rather than a
plugin.

- License: MIT
- Scope: Paged.js parity, plus math
- Vivliostyle (AGPL): ideas only, clean-room
- Math: MathML Core, not MathJax
- Browser floor: Chromium 109, Firefox 115, Safari 16.4

Sources read for this plan: Paged.js 0.5.0-beta.2 and Vivliostyle.js 2.45.1
(read, not copied), MathML Core, MathJax 4 documentation.

---

## 1. What the two existing engines teach us

Paged.js made the right core decision: the browser lays out lines, fonts and
tables, and JavaScript only decides where pages break. Most of its fragility
comes from *how* it implements that decision. It clones one node at a time and
measures after each one (`layout.js:142`). It re-implements margin and padding
geometry by hand (`layout.js:863`). And it carries extracted DOM from page to
page, when a plain position would do.

Vivliostyle reached the answers we want: break positions that are plain data, a
start position stored for every page, penalty-based break selection, and a
serious regression harness. It also carries costs we do not want, above all its
own CSS cascade, about 14k lines including parser and validator.

### Keep from Paged.js

- Browser does inline layout, JS decides breaks
- Page template with 16 margin boxes around a content area
- `@page` rules become classes, and the browser cascades them
- Polyfill-style use: add a script and it runs
- Its MIT spec corpus, reused as test fixtures

### Drop from Paged.js

- Moving extracted DOM between pages (`layout.js:1716`)
- ResizeObserver restarts during layout (`chunker.js:674`)
- Editing `document.styleSheets` in place
- Rewriting `#id` as `[data-id]`
- Word-then-letter text measurement
- 30 hooks that can change any DOM at any time
- Math "support" that is one assertion: 96 formulas do not throw
  (`specs/math/math.spec.js:17`)

### Borrow from Vivliostyle

- Positions as a path plus an offset, comparable by value
- A start position stored per page, so any page can be laid out again
- Candidate breaks chosen by lowest penalty
- Text split by line boxes from `getClientRects()`
- Measurement behind an interface
- Regression diffs plus WPT reftests

### Avoid from Vivliostyle

- Its own full cascade, unless something forces it (§6)
- A custom Task/Frame scheduler instead of `async`/`await`
- 6–7k-line source files
- EPUB and XML publication scope

**Clean-room rule.** Study Vivliostyle's behaviour, docs and public issues, but
do not read its source while writing the equivalent module, and do not port its
test files, which are also AGPL. WPT tests are BSD-3 and safe to use.

---

## 2. A pipeline of five stages

Each stage takes plain data and returns plain data. The source document is never
changed; pages are generated from it, the way Vivliostyle does it and unlike
Paged.js.

| # | Stage | What it does | Output |
| --- | --- | --- | --- |
| 1 | Normalize source | Parse the HTML into a document that is never mutated. Wait for fonts and image decoding before any measuring. | `SourceDoc` |
| 2 | Extract page model | Parse only the paged-media parts of the CSS: `@page`, margin boxes, GCPM properties. Leave the rest of the author's CSS alone. | `PageModel` |
| 3 | Fragment | Lay content into the page area, collect candidate breaks, pick the lowest-penalty one that fits. | `PageRecord[]` |
| 4 | Compose pages | Build each page's DOM from its start and end positions, with split-from / split-to markers. | Page DOM |
| 5 | Resolve references | Fill in counters, `string()`, `target-counter()` and running elements. | dirty page set |

If stage 5 changes a page's size, re-run from stage 3 for that page, up to a
fixed number of passes.

Pages render inside an **iframe the engine owns**, so author CSS never collides
with the viewer UI and nothing in the host page is taken over. The viewer
(spreads, zoom, virtualized page list) is a separate package that only consumes
`PageRecord`s.

### The core data model

```ts
// A position in the unchanging source tree: child indices from the root.
type Position = { path: number[]; offset: number; after: boolean };

type PageSpec = {
  index: number; name: string | null;         // named page
  side: "left" | "right"; blank: boolean;
  size: [number, number]; margins: Box;       // resolved from @page rules
};

type PageRecord = {
  spec: PageSpec;
  start: Position; end: Position;             // replaces Paged.js BreakToken + DOM
  refs: Set<string>;                          // ids this page reads (target-counter…)
  provides: Set<string>;                      // ids whose page number it defines
};

// Every read of layout goes through this, so break logic can be unit-tested
// with fake boxes.
interface Measurer {
  box(el: Element): Rect;
  boxes(els: Element[]): Rect[];              // one batched read; math candidates (§7)
  lineBoxes(range: Range): Rect[];            // getClientRects, grouped into lines
  styleOf(el: Element, props: string[]): Record<string, string>;
}
```

Because a page is fully described by `(spec, start)`, laying out page *n* again
is just a function call, with no stopping and restarting. That removes the class
of bug that needed Paged.js's `specs/infinite-loop` test.

---

## 3. Fragmenter: measure less, decide once

Aim to keep this under 2,300 lines. It was 2,000 until `review.md` §2
raised it rather than move code out to make room, and 2,100 until the owner
raised it again for split boxes' heights (`review.md` §4.7). It is the only part that makes break
decisions, and where it ends is a rule, not a negotiation (`review.md`
§2.5, taken by `review.md` §3.6): **the fragmenter is the code that decides,
given a measured box, where the page ends. Code that produces the box —
composing it, taking things out of its flow, placing notes and equations on
it — belongs to the feature that does the producing, even when the decision
reads its result.** The pages either side of a break (`pages.ts`) and the
stage 5 loop that runs the fragmenter again (`settle.ts`) are outside it.

- **Render a chunk, then search.** Estimate how much content fits from
  characters per page (Paged.js already tracks this), render that much, then
  binary-search the block children. Do not append and measure one node at a
  time.
- **Candidate breaks with penalties.** Record every allowed break with a cost:
  `avoid` rules, widows and orphans, a heading kept with its next block. On
  overflow, take the cheapest candidate that fits, and allow costlier ones only
  if nothing else works.
- **Split text at line boxes.** Group `Range.getClientRects()` into lines and
  break after the last line that fits. Widows and orphans then reduce to
  counting lines.
- **Try browser multicol as the decider (two-week spike).** Give one column the
  page height and let the browser place the breaks. Vivliostyle uses multicol
  only to measure, so expect a fallback to deciding in JS on some engines.
- **Logical directions from day one.** Use block-start/end, not top/bottom.
  Vertical writing costs almost nothing now and a great deal to retrofit.
- **One machine, two axes.** Breaking a display equation wider than the measure
  is the same algorithm turned 90°: candidates, penalties, cheapest that fits.
  Parameterize the selector by axis and §7 costs almost nothing extra.

---

## 4. Feature map

Tiers say *which part of the engine* handles each feature, which is where the
complexity shows:

| Tier | Meaning |
| --- | --- |
| **N** | Native. The browser does it. Check support at runtime; no engine code if supported. |
| **F** | Fragmenter / composer. Core engine logic. No cascade needed. |
| **P** | Cascade by proxy. Custom properties or rewritten selectors, cascaded by the browser (§5). |
| **C** | Own cascade. Styles depend on the page or fragment an element lands on (§6). |
| **V** | Viewer package, or out of scope for the core. |

### Page model — CSS Paged Media 3

| Feature | Paged.js | Vivliostyle | New | Notes |
| --- | --- | --- | --- | --- |
| `@page` size, margins, orientation | Yes | Yes | F | Resolved into `PageSpec`; mm/in/pt and named sizes. |
| `:first :left :right :blank` | Yes | Yes | F | Classes on the page, cascaded by the browser. |
| `:nth(An+B)` | Yes | Yes | F | Vivliostyle also has `of <page-name>`. |
| Named pages (`page:`) | Yes | Yes | F + N | Native in Chromium/Firefox print; preview still needs F. |
| 16 page-margin boxes | Yes | Yes | F + N | css-page-3 §5.3's sizing, measured and computed (`margin-boxes.ts`); a grid could not do it. |
| `page` / `pages` counters | Yes | Yes | F | `pages` known only after the last page: one extra pass. |
| `bleed`, crop and cross `marks` | Yes | Yes | F | Pure page-template CSS. |

### Fragmentation — CSS Break 3 / 4

| Feature | Paged.js | Vivliostyle | New | Notes |
| --- | --- | --- | --- | --- |
| `break-before/after/inside` | Yes | Yes | F | Become penalties on candidates. |
| Text split with a hyphen at the break | Yes | Yes | F | Line boxes, not per-letter measuring. |
| `widows` / `orphans` | Partial | Yes | F | Paged.js has no JS logic; it relies on its column trick. |
| Tables split across pages | Partial | Yes | F | Paged.js rebuilds rows and copies column widths. |
| Repeated `thead`/`tfoot` | No | Yes | F | Cheap once composition works from positions. |
| `box-decoration-break` | No | Yes | F + P | Whether borders/padding clone onto fragments. Rules on marked fragments, read through a carrier (`fragments.ts`, M6). |
| `margin-break` | No | Yes | F + P | Paged.js hard-codes margin removal on splits. `auto` keeps the margin after a *forced* break (`fragments.ts`, M6). |
| Multicol inside pages, `column-span` | Partial | Yes | F | Nested fragmentation: hardest F item, so late. |
| Vertical writing (CJK) | No | Yes | F | Free if geometry is logical from the start. |
| Page floats (`float: top/bottom`) | No | Yes | P + F | Browsers drop the values, so custom properties carry them. |

### Generated content — GCPM 3, CSS Content 3

| Feature | Paged.js | Vivliostyle | New | Notes |
| --- | --- | --- | --- | --- |
| Custom counters across pages | Yes | Yes | P | Paged.js precomputes values (`counters.js:323`). |
| `target-counter()` | Yes | Yes | F | `refs`/`provides` plus the stage 5 loop. |
| `target-text()` | Yes | Yes | F | Same mechanism. |
| `string-set` / `string()` | Yes | Yes | P | Paged.js already uses `--pagedjs-string-*`. |
| `position: running()` / `element()` | Yes | Yes | P | Element cloned into margin boxes. |
| Footnotes | Yes | Yes | P + F | Pseudo-elements become real elements; the note area reduces available height. |
| `footnote-display`, `footnote-policy` | Partial | Yes | F | Policy becomes a penalty. |
| `content()` | No | Yes | P | Small addition next to `string()`. |
| `leader()` | No | Yes | P + F | Rewritten to `attr()` like `target-counter()`, filled in stage 5 by a batched search that never changes a height (`leaders.ts`, M6). |
| `@counter-style` | Browser | Own code | N | Native; keeping the browser cascade gives it free. |

### Mathematics — MathML Core + OpenType MATH (see §7 and [math.md](math.md))

Vivliostyle's math answer is to run MathJax (`data-math-typeset="true"`), so its
column below mostly reads "MathJax" — real typesetting, with MathJax's
page-blindness inherited along with it.

| Feature | Paged.js | Vivliostyle | New | Notes |
| --- | --- | --- | --- | --- |
| Glyph-level math layout | Browser\* | MathJax | N | MathML Core §5 implements the OpenType `MATH` table. \*Paged.js never checks a MATH font loaded. |
| MATH-font loading and verification | No | n/a | F | Await the font, then probe a stretchy operator. Moot for Vivliostyle, which ships MathJax's fonts. |
| Display-equation line breaking | No | MathJax | F | Core makes `white-space` behave as `nowrap` on all MathML. |
| Equation numbers `(1)`, `(3.4)` | No | MathJax | P | `mlabeledtr` is not in Core. Grid plus counter. |
| `\ref` to an equation, **with its page** | No | No | F | `target-counter()` plus the stage 5 loop. MathJax cross-references but never learns a page number. |
| Broken equation splits across pages | No | No | F | MathJax breaks the equation before the page engine sees it. Here its lines are block children. |
| `break-inside: avoid` on display math | No | Yes | F | A penalty, not a rule. |
| Math in running heads and TOCs | No | No | P | `content(element)` clones; `textContent` destroys a formula. |
| `math-depth` in footnotes, margin boxes | Browser | MathJax | N | Verify with a reftest; write no code. |
| TeX / LaTeX input | No\* | Yes | V | Vivliostyle takes TeX and AsciiMath. \*Paged.js only paginates MathJax output already present (`specs/math/mathjax.html`). Ours: an optional Temml package; the core sees MathML only. |
| `menclose`, `mstack`, `mlongdiv`, alignment groups | No | MathJax | — | Dropped from Core; out of scope. |

### Styling that depends on page context

| Feature | Paged.js | Vivliostyle | New | Notes |
| --- | --- | --- | --- | --- |
| `::nth-fragment()` | No | Yes | P + C | Try `[data-frag="n"]` first; see §6. |
| Content styled by the page it lands on | No | Yes | C | A style change forces a re-layout of the page. |
| `@layer`, nesting, `:has()` in author CSS | Browser\* | Own code | N | \*As long as our parser only extracts and passes the rest through. |
| Typed `attr()`, `env(doc-title)` | No | Yes | P | Typed `attr()` is arriving natively in Chromium. |
| `device-cmyk()` | No | Yes | P | Real CMYK needs PDF post-processing; out of scope. |
| `initial-letter`, `text-autospace`, `text-spacing-trim` | No | Yes | N | Leave to browsers; do not polyfill. |

### Preview and integration

| Feature | Paged.js | Vivliostyle | New | Notes |
| --- | --- | --- | --- | --- |
| In-page preview (polyfill mode) | Yes | Yes | V | Keep a Paged.js-compatible `Previewer` and polyfill. |
| Spreads, zoom, page navigation | CSS only | Yes | V | Separate viewer package. |
| Re-lay-out a single page; virtualized list | No | Yes | F | Follows from storing `(spec, start)`. |
| Extension hooks | ~30 hooks | Plugins | F | A few typed hooks at stage boundaries, on data not live DOM. |
| EPUB and multi-document | No | Yes | V | Out of scope. |

**Reading the table:** everything Paged.js supports today fits in N, F and P —
and so does all of math. Only page-context styling needs C.

---

## 5. Let the browser cascade our properties

A browser drops properties it does not know: `string-set`, `float: footnote`,
`footnote-policy`. That is the usual reason engines build their own cascade. But
*custom properties accept any value* and go through the browser's own cascade —
specificity, `@layer`, nesting, `!important`, media queries, all of it. So
rename the property in the extracted CSS and read the result back:

```
/* author CSS */                       /* what the browser receives */
h1 { string-set: title content(); }    h1  { --x-string-set: title content(); }
.fn { float: footnote; }               .fn { --x-float: footnote; }
a::footnote-call { color: red }        a[data-x-call] > .x-call { color: red }
```

```js
// engine: one batched read per element that has the property
getComputedStyle(el).getPropertyValue("--x-string-set")
```

Register the carriers with `@property { inherits: false }` so they do not
inherit where the spec says they should not. Rewrite unknown pseudo-elements
into real elements the engine generates, each with a class.

The cost is a small, testable rewrite table instead of a cascade engine — and
author CSS keeps working as the browser adds new CSS features.

---

## 6. The cascade step, and when it becomes necessary

Some features need an element's style to depend on *where it lands*: its page,
its page type, or which fragment of a split element it is. The browser cascade
cannot see pages. There are three rungs; climb one only when a feature you
actually need demands it.

**Rung P — cascade by proxy.** Custom-property carriers and rewritten
pseudo-elements (§5). Covers everything Paged.js supports today, plus page
floats, `content()` and typed `attr()`. *Cost:* a rewrite table of a few hundred
lines, tested one rule at a time.

**Rung P+ — fragment and page classes.** Once a fragment is placed, stamp it
(`data-frag="2"`, `data-page-type="chapter"`, `data-page-first`). Rewrite
`::nth-fragment(2)` and page-context selectors to match those stamps. The
browser still cascades. If a stamp changes the element's size, re-lay-out that
page, which stored positions make cheap. *Cost:* a selector rewriter and a
"style changed size" check, with a pass limit.

**Rung C — own cascade.** Parse all author CSS, match selectors against source
elements, sort by origin, layer, specificity and order, handle inheritance,
`var()` and `revert`, and write computed values as inline styles. Vivliostyle
took this route (`css-cascade.ts`, `vgen.ts:3290`). *Only* needed if page
context must affect styles before the element exists, or if P+ accumulates too
many exceptions.

### What rung C would cost

Rung C works against the main goal. Today the engine gets slimmer as browsers
improve; with its own cascade, every new CSS feature becomes engine code, or
author stylesheets quietly stop working.

- **Size.** Vivliostyle's CSS stack is ~14.5k lines (cascade 7.1k, parser 3.3k,
  validator 2.8k, styler 1.3k) — more than all of Paged.js (13.4k).
- **Keeping up forever.** Nesting, `@layer`, `@scope`, `:has()`, `if()`,
  container queries: each must be implemented again.
- **Correctness surface.** You now need WPT `css-cascade` and `selectors`
  conformance, not just fragmentation tests.
- **Performance.** Styles computed in JS for every element on every page, on top
  of the browser's own style pass.
- **Debugging.** DevTools show generated inline styles, not the author's rules.
- **Architecture.** Styling becomes part of composition, coupling stages 2 and 4.

Vivliostyle's cascade dates from 2013, before custom properties were widely
available. A 2026 engine can probably stay on rung P+ indefinitely. Treat any
feature that needs rung C as a separate, optional module that can be switched
off.

---

## 7. Math is a fragmentation problem

The full treatment is in [math.md](math.md). The argument in brief:

Paged.js's entire math story is one assertion: that 96 `<math>` elements do not
throw (`specs/math/math.spec.js:17`). MathJax's is the opposite — beautiful
formulas from a library with no idea what a page is. Vivliostyle's answer is to
run MathJax (`data-math-typeset="true"`), which buys real typesetting and
inherits the page-blindness with it: the formula is broken, numbered and
finished before the page engine is told it exists. None of the three addresses
what actually goes wrong in a printed book, which is what happens when a formula
meets the edge of a page.

**MathML Core §5 implements the OpenType `MATH` table**: layout constants,
italic correction, size variants, and `GlyphAssembly` for stretchy delimiters.
That is the same font data TeX reads. Point a browser at a MATH-table font and
fraction rules, script shifts, the math axis, radicals and stretchy fences are
already at TeX quality, in C++, for free. **The quality argument is won on the
font, not on a rendering library.**

What Core omits is not glyph layout. It is line breaking (`white-space` behaves
as `nowrap` on all MathML), `mlabeledtr` and most table alignment attributes,
`menclose`, elementary math, and alignment groups. MathJax 4 ships no
native-MathML output and names the first two as the reason. Every omission that
matters for books is a *layout decision* — which is to say, ours:

| Native, given a MATH font | Ours, because we are paged |
| --- | --- |
| Fraction rules, radicals, script shifts, math axis | Breaking a display equation to the measure |
| Stretchy delimiters via `GlyphAssembly` | Numbering it, and referring to it by page |
| Operator spacing from the `<mo>` dictionary | Splitting a broken equation across a page |
| `math-depth`, `math-style`, `math-shift`, `font-size: math` | Keeping it with the sentence that introduces it |
| `display: block math` / `inline math` | Carrying it into a running head or a TOC |

Not ours: TeX parsing (an optional package), glyph positioning (the browser's,
given a real font), speech generation (the MathML *is* the accessible form),
elementary-math notation.

Four consequences for the rest of the plan:

1. **The font pipeline is mandatory and must fail loudly.** A missing `MATH`
   table degrades silently — flat fractions, un-stretched delimiters, nothing
   thrown. Ship a webfont and probe it at startup.
2. **The fragmenter takes an axis parameter.** A display equation wider than the
   measure is the vertical problem rotated; candidates are top-level `<mo>`
   children, penalties come from TeX's relation/binary ordering, measurement is
   one batched `boxes()` read.
3. **An equation number is a counter, not an element.** A generated
   three-column grid beside the math, an ordinary `counter-increment`, and
   `target-counter()` for `\ref` — so "equation (3.4) on page 128" costs nothing
   new. This is the capability MathJax cannot have at any price.
4. **MathML Core sets the browser floor** — Chromium 109, Firefox 115, Safari
   16.4 — and it is the strictest requirement in the plan, so every other module
   may assume it.

**What "MathJax quality" means here.** MathJax's quality comes from three
things: TeX's spacing rules, a MATH-table font, and line breaking. Browsers now
give the first two outright. The third is fragmentation, which is what this
engine already is. Matching MathJax is not a matter of out-typesetting it; it is
a matter of not discarding what the browser has, then adding the part a
page-unaware library cannot add.

---

## 8. Build it so code can be deleted

- Each polyfill module exports `nativeSupport(): boolean` and a **deletion
  condition**: "delete when every target browser passes these WPT tests".
- CI runs every browser twice, once with each module on and once off where
  native support exists. When the "off" runs pass everywhere, delete the module.

**How this is built** (2026-09-25):

- **The registry.** Every polyfill module exports `deletion`: its feature,
  its condition in words, and its WPT tests as patterns over the pinned
  manifest. It also exports `nativeSupport()`. `deletion.ts` gathers them.
- **What `nativeSupport()` can answer.** It is a parse check (`CSS.supports`)
  where the feature has syntax of its own, such as `leader()`, `string-set`
  or `float: footnote`. It is `false` where it has none a script can probe,
  such as a browser's own print fragmentation. It is necessary, never
  sufficient.
- **"Off" is the browser alone.** Most modules cannot be switched off one at
  a time, since `strings.ts` without the fragmenter is not a configuration.
  So the "off" run is WPT with no engine loaded:
  - `wpt.mjs` for the continuous-media tests, on every engine;
  - `wpt.mjs --native-print` for the `-print` tests, printed by Chromium and
    rasterised.

  Firefox and WebKit cannot print from Playwright. A `-print` test is
  *unknown* on them, never a pass, so no module decided by print tests can
  be shown deletable on them by CI. The report says so rather than guessing.
  The printed comparison is stricter than WPT's own harness, which does not
  print to a PDF. A sliced monolithic box differs by one raster row per
  continued page even in Chromium alone. It errs toward keeping a module,
  never toward deleting one (`native-support.md`).
- **The report.** `packages/test/deletion.mjs` reads the registry against
  those runs and fails when a module is deletable. The WPT workflow runs it
  after every engine.
- **Modules WPT cannot decide.** Some modules name no test, because the
  pinned set has none: `target-counter()`, footnotes, `content(element)`,
  repeated table headers, MathML line breaking. They say why and what
  decides them instead (`untested`), and a person makes the call.
- **The engine is exempt.** The fragmenter, composition, measurement,
  stages 1 and 5, the furniture and the application layers stand in for
  nothing a browser could ship. They go only with "the big one" below, and
  then as a whole. `deletion.ts` lists them.
- **The registry test.** `deletion.test.ts` fails if a pattern matches no
  pinned test, or if a file in core is neither a polyfill's nor the
  engine's. A new module cannot slip past the gate.
- Current candidates: named pages and margin boxes in print output;
  `@counter-style` and `initial-letter` (already native — never build them).
  Margin-box sizing was meant to be plain CSS grid and is not: §5.3 shares an
  edge by content and keeps a middle box centred, which no grid expresses.
- On the math side: the inline-axis fragmenter goes when browsers implement
  MathML line breaking (`w3c/mathml-core#127`); the numbering grid goes if an
  `mlabeledtr` replacement is ever specified and shipped. Neither looks close,
  so build both — but build them detachable.
- The big one: if browsers ever let scripts read their own print fragmentation
  (for example through `::nth-fragment`), stage 3 mostly goes away. Keep the
  fragmenter behind its interface so it can be swapped out.

---

## 9. Validation

Paged.js has one unit test. This is the biggest single improvement available.
Set the harness up *before* the engine.

1. **Unit tests with a fake measurer.** Break selection, penalties, widows and
   orphans, forced breaks, the reference loop — all against synthetic boxes.
   Fast, deterministic, no browser.
2. **Structural browser tests** with Playwright on Chromium, Firefox and WebKit.
   Which element and text offset lands on which page, stored as JSON snapshots.
   Screenshots only for margin boxes and marks.
3. **Conformance.** WPT `css-page`, `css-break` and GCPM reftests, at a fixed
   device pixel ratio for determinism (Vivliostyle's `pixelRatio=0` lesson).
4. **Differential tests.** Run Paged.js's MIT spec corpus through both engines
   and compare page counts and element-to-page maps. Every difference is either
   a bug or a documented improvement.

Properties that must hold for any input, checked on randomly generated
documents:

- Every source character appears exactly once across all pages.
- No page overflows its area.
- Every forced break is honoured.
- The same input always produces the same positions.
- Stage 5 settles within N passes.
- Equation numbers are consecutive from 1, with no gaps and no repeats.

Track a performance budget too: forced layouts per page, measured on a 300-page
book fixture.

### Math gets the same four layers, plus two

Glyph positioning is the browser's job, so the only math regression worth
catching is *"it changed"*.

- **The font probe as a test, not just a startup check.** If CI cannot prove the
  `MATH` table loaded, every other math result is meaningless and the run stops
  there.
- **Per-engine golden images for ~30 fixed formulas**, covering nested
  fractions, large operators with limits, stretched fences, matrices and
  multiscripts. Everything else stays structural: which equation line lands on
  which page, where the break fell, whether the number is on the right line.

Corpus: Paged.js `specs/math` (96 formulas whose only current assertion is that
they do not throw — a free baseline of real markup), Temml's test suite, and
arXiv HTML samples for volume. Check each one's license before vendoring.

---

## 10. Roadmap

Each milestone ends with a check you can actually run.

**M0 — Harness and spike.** Measurer interface, Playwright on three engines, WPT
runner, Paged.js corpus converted to structural checks, the two-week multicol
spike, and the math font probe (twenty lines, and it fixes the browser floor for
everything after).
*Exit:* the corpus runs against Paged.js and produces baseline snapshots; the
spike ends with a go/no-go; the probe passes on all three engines.

**M1 — Core fragmenter.** Positions, `PageRecord`, block and text breaks, forced
and avoid breaks, `@page` size and margins, margin boxes with page counters, a
basic viewer.
*Exit:* the content check (every character exactly once) passes on the whole
corpus.

**M2 — Parity A: page model and references.** Named pages, `:nth()`, bleed and
marks, counters, `string-set`, `running()`, `target-counter/text` with the stage
5 loop.
*Exit:* differential results match on the corresponding Paged.js specs.

**M3 — Parity B: footnotes and tables.** Footnotes with policy, table splitting
with repeated headers, widows and orphans.
*Exit:* the whole Paged.js corpus matches or has documented differences.

**M4 — Math.** MATH-font pipeline with the stretch probe; the inline-axis
fragmenter for display equations; the numbering grid and its counter; `\ref`
through the stage 5 loop; a broken equation splitting across pages;
`content(element)` so math reaches running heads. The Temml front end ships as a
separate optional package.
*Exit:* a 40-page math-heavy fixture paginates with no overflow on three
engines, numbers consecutive and correct across pages, and every equation's
structural snapshot stable between runs.

**M5 — Compatibility and viewer.** A Paged.js-compatible `Previewer`, polyfill
and `Handler` layer; spreads, zoom, virtualized pages.
*Exit:* a real Paged.js project runs unchanged.

**M6 — Beyond parity (optional).** `leader()`, `content()`, `margin-break`,
`box-decoration-break`, page floats via proxy, `::nth-fragment` via rung P+.
*Exit:* each feature comes with its WPT subset and a deletion condition.

---

## 11. Risks

- **Browsers break pages differently.** Firefox and WebKit fragmentation lags
  Chromium. *Mitigation:* the JS fallback path for deciding breaks, and one set
  of expected results per engine where differences are accepted.
- **The stage 5 loop may not settle.** A page number grows a line, which moves a
  break, which changes the page number. *Mitigation:* a pass limit, then keep
  the layout with the longer text so it cannot oscillate.
- **Knowledge from AGPL code.** *Mitigation:* the clean-room rule in §1. Record
  design decisions with their sources (specs, WPT, public issues).
- **Scope creep toward Vivliostyle.** *Mitigation:* the feature map is the
  scope. Adding an N/F/P row is fine; anything needing C gets its own decision.
- **The math font is not there.** A missing `MATH` table degrades silently, not
  loudly. *Mitigation:* the stretch probe at startup and in CI, plus a bundled
  webfont so the happy path never depends on the reader's machine.
- **Our equation breaking is greedy; TeX's is not.** TeX optimizes a display
  across all its lines at once. *Mitigation:* accept and document the gap, keep
  the penalties in one table so they can be tuned, and add a search pass only if
  fixtures show bad breaks in practice.
- **Math layout differs between engines.** *Mitigation:* the same one as
  fragmentation — per-engine expectations, and an inline-axis fragmenter that
  *reads* candidate positions rather than predicting them.
- **Math markup is not MathML.** Documents in the wild arrive as TeX, or as
  MathJax's `mjx-*` output. *Mitigation:* the core accepts MathML only and says
  so; conversion is a preprocessing step the optional package performs, in the
  open, before stage 1.
