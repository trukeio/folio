# What the browsers do natively

The evidence base for the deletion conditions of [plan.md](plan.md) §8: a
polyfill module may be deleted when every target browser passes the tests it
stands in for. This is the first measurement, so it is also the baseline the
"can we delete it yet?" question is asked against.

Source: 63 WPT fragmentation reftests pinned at commit `60657f20`, run against
bare browsers with no engine loaded. Runner: `packages/test/wpt.mjs`;
workflow: `.github/workflows/wpt.yml` (manual). Re-run it rather than trusting
these numbers — they change on the browsers' schedule, not on ours.

## Results

Chromium 153, Firefox 155, WebKit 26.6, 2026-09-19.

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| **Total** | **60/61** | **33/61** | **22/61** |
| `box-decoration-break` | 35/36 | 25/36 | 6/36 |
| `widows` / `orphans` | 22/22 | 5/22 | 15/22 |
| `break-inside` | 2/2 | 2/2 | 0/2 |

27 tests pass in Chromium and fail in Firefox; 38 pass in Chromium and fail in
WebKit.

Two tests are excluded from every column: one has no `<link rel=match>`, and
`break-inside-avoid-multicol-001-print` is a paginated reftest (see below).

## What it means

**Nothing here is deletable.** §8 asks for every target browser to pass, and no
row is green across all three. `box-decoration-break` and `widows`/`orphans`
are F-tier rows in the feature map (§4) and they stay F-tier: we implement
them, as penalties and as fragment decoration, on every engine.

**It corroborates §11's first risk with numbers.** "Firefox and WebKit
fragmentation lags Chromium" is no longer a hedge — it is 33 and 22 against 60.
Per-engine expected results are not a concession; they are the normal case.

**It independently supports the M0.3 no-go.** The spike found Firefox ignoring
forced breaks and two engines ignoring widows by A/B test. These tests reach
the same conclusion from the other direction: 5/22 on widows in Firefox is that
same gap, measured by someone else's suite.

**The interesting tests are the ones a bare browser cannot be scored on.** A
`-print` reftest asserts what lands on each page under an `@page` size, and
viewport screenshots cannot evaluate that. They are what the next section runs.

## The paginated tests, printed natively

`wpt.mjs --native-print` prints each `-print` test and its reference with
Chromium alone (`page.pdf`, WPT's 5in × 3in default page), rasterises both
with `pdftoppm` at 96dpi, and compares them page by page with the test's own
fuzz. It is the native evidence for the deletion conditions' `-print` tests
(`plan.md` §8). It is Chromium's alone: Firefox and WebKit cannot print to a
file from Playwright.

**Chromium 153, 2026-09-25: 183/235.**

It is stricter than WPT's own harness, which renders print reftests without
going through a PDF. Most of the monolithic-overflow family fails it by
exactly one raster row per continued page: in Chromium's PDF, a sliced
monolithic box's continuation paints one pixel row above the page area (y=47
where the area starts at 48), and the reference's plain tall block does not.
For deletion that errs the safe way. A stricter check can only delay a
deletion, never make a wrong one, so it is left strict.

## May a module go? (`deletion.mjs`)

The deletion report reads every polyfill module's tests (`deletion.ts`)
against the native runs above. As of this run, no module is deletable:

| Module | Tests | Chromium | Firefox | WebKit | Verdict |
| --- | --- | --- | --- | --- | --- |
| fragments | 36 | 35 | unknown | unknown | not yet |
| extents | 38 | 12 | unknown | unknown | not yet |
| print media | 4 | 4 | unknown | unknown | unknown |
| viewport units | 4 | 4 | unknown | unknown | unknown |
| page painting | 10 | 5 | unknown | unknown | not yet |
| `leader()` | 3 | manual | manual | manual | unknown |
| margin boxes | 38 | 26 | unknown | unknown | not yet |
| page counters | 6 | 6 | unknown | unknown | unknown |
| page model | 120 | 109 (4 unscored) | unknown | unknown | not yet |
| named strings | 17 | manual | manual | manual | unknown |

The Firefox and WebKit columns show what "unknown, never a pass" means. Their
continuous-media results cover only `fragments`, since the other modules'
tests are all `-print`. Seven more modules name no test, because the pinned
set has none, and a person decides them: counters, `content(element)`,
cross-references, footnotes, table headers, math line breaking and equation
numbers.

## With Folio loaded (M6)

`node packages/test/wpt.mjs --folio` runs the other half of the manifest:
the 235 paginated reftests under `css-break`, `css-page` and
`css-page/margin-boxes`, at the same pinned commit. The test and its reference
are both paginated by the `Previewer` and compared page by page — the same
number of pages, the same pixels on each, with the test's `fuzzy` allowance per
page. Three things make a pass mean something:

- **The WPT page.** A print reftest's default page is 5in by 3in with
  half-inch margins (`docs/writing-tests/print-reftests.md`). It is given as
  `pageDefaults` — the user agent's page, which `size: landscape` alone
  rotates — not as an author rule, which the test's own `@page` would replace.
- **`reftest-pages`.** Each file's own; a reference without one compares all
  its pages.
- **An oracle that owes us nothing.** Our test agreeing with our reference
  proves only that we are consistent, and two things we get wrong alike agree
  perfectly: with vertical writing unimplemented, vertical-writing tests
  passed. So the reference is also printed by Chromium (`page.pdf`, the one
  engine Playwright can print with), and our reference must come to the same
  number of pages. Chromium is the oracle for every engine under test —
  without it Firefox scored 86/235 where Chromium, which had it, scored 51.

Chromium 153, Firefox 155, 2026-09-24. This run follows the root element
onto the page (`review.md` §3) and the page box's border and padding.
It adds:

- `@page` in `@layer`;
- four margin-box geometry fixes, and the margin boxes' fonts loaded
  before they are measured;
- slices of content taller than a page (`review.md` §4);
- the UA's `body { margin: 8px }` back on the page, as CSS says
  (`review.md` §3.6, reversed);
- `@page { margin: auto }`, negative page margins, and the viewport as the
  first page's area;
- split boxes sharing a set height, monolithic content sliced to its ink in
  flow or not, and split boxes filled to the page's foot.

WebKit does not launch on this host.

| Family | Chromium | Firefox |
| --- | --- | --- |
| Named pages | 47/49 | 47/49 |
| Margin boxes | 36/38 | 34/38 |
| Monolithic overflow | 19/32 | 10/32 |
| Page size | 17/19 | 16/19 |
| Other `css-break` | 8/16 | 8/16 |
| `position: fixed` | 1/14 | 1/14 |
| Vertical writing | 11/12 | 11/12 |
| Page box | 11/12 | 11/12 |
| Page margins | 10/11 | 11/11 |
| Page selectors | 8/10 | 8/10 |
| Page background | 5/7 | 5/7 |
| `@layer` | 4/4 | 4/4 |
| Basic pagination | 3/3 | 3/3 |
| Media queries | 2/3 | 2/3 |
| `page-orientation` | 0/3 | 0/3 |
| Other `css-page` | 1/2 | 1/2 |
| **Total** | **183/235** | **172/235** |

The two engines differ on sixteen tests.

Chromium alone passes thirteen:

- `monolithic-overflow-003`–`011`. Firefox's default serif sets the last
  paragraph too tall for page 4 (`wpt-failures.md`).
- `margin-boxes/auto-margins-001`. The same font makes its reference's grid
  row taller than the page on Firefox.
- `margin-boxes/dimensions-004`, 32px at one box's edge on Firefox.
- `page-margin-002` and `page-background-001`, as before.

Firefox alone passes three:

- `margin-boxes/content-002`, a shaping difference at a quote mark;
- `page-margin-007`, 9px of text on Chromium;
- `margin-boxes/alignment-001`, 63px on Chromium.

The history:

| Run | Chromium | Firefox | What moved |
| --- | --- | --- | --- |
| This one | 183 | 172 | Margin boxes in vertical writing (+2 Chromium) |
| Vertical writing | 181 | 172 | Vertical writing (+14 each) |
| Floats | 167 | 158 | Floats, page sides in rtl, width queries against the UA page (+5, +6) |
| Absolute boxes | 162 | 152 | Absolute boxes and ink across pages, fragments to the foot (+4 each) |
| Page geometry | 158 | 148 | Auto and negative page margins, the first page's viewport (+5 each) |
| Body margin | 153 | 143 | The UA's body margin on the page (+8 each) |
| Slices | 145 | 135 | Margin boxes (+8), slices (+15 monolithic, `transform-022`, `page-box-004`), `@layer` (+3) |
| After `review.md` §3 | 115 | 114 | The root on the page, the canvas, the page box |
| Page counters | 93 | 95 | Page counter and page-context counters |
| Margin-box geometry | 74 | 75 | §5.3, and the page model's `em`, `vw` and `@page { width; height }` |
| After `review.md` §2 | 51 | 53 | 25 fixed, 2 lost |

`review.md` §2 fixed 25 tests with edge values and "a page exists if a
box starts on it", and lost 2 on both engines:

- `page-name-zero-height-001`, which contradicts two tests that now pass
  (`wpt-failures.md`, "WPT against WPT");
- `monolithic-overflow-020`, whose last page had been right by accident.

Firefox also lost `page-name-003`, the other contradiction.

**This is a baseline, not a verdict.** Many failures are features the engine
does not have and says it does not have:

- `position: fixed` is not in the feature map;
- vertical writing is built (`review.md` §5);
- content taller than a page is sliced only where no ancestor with a fixed
  height continues around it;
- `page-orientation` is unimplemented.

Two groups that used to be listed here as ours are answered:

- **Margin boxes.** The geometry is css-page-3 §5.3, with four fixes from
  this run's triage. Of the 4 margin-box tests still failing on Chromium:
  - two are orthogonal and vertical writing (`dimensions-013`, `-014`);
  - one is a shaping difference (`content-002`);
  - `alignment-001` is 63px of text rendering: the layout is identical.

  Seven more passed on both engines once the UA's body margin was back on
  the page.
- **The root's own box.** It is on every page (`review.md` §3), and `body
  { display: grid }` lays out as a grid there.

Every failure, test by test and grouped by cause, is in
[wpt-failures.md](wpt-failures.md). Each one has a cause now.

**It found six bugs on its first day**, and each now has a browser test of its
own (`furniture.spec.ts`, `page-content.spec.ts`) so it stays found:

- The engine's own elements were `<div>`s, so an author's `div { … }` styled
  the page box, the content area, the margin boxes, the measuring box and the
  equation grid — a reference's `div { height: 283px }` sized every content
  area. They have names of their own now (`src/furniture.ts`).
- `100vh` was the height of a 0×0 frame while measuring and of the reader's
  window when shown. Viewport units are rewritten to the first page's page
  area, in the frame and on the page alike (`css/viewport.ts`).
- A `style` attribute got neither carriers nor that rewrite, so
  `<div style="page: a">` was not a named page (`rewriteInlineStyle`).
- Text directly in a container beside blocks was not content to the
  fragmenter, so the forced break after a body's opening sentence was dropped
  as a break at the top of an empty page.
- A margin box with no `content`, or `none`, or `normal`, was generated anyway,
  background and all.
- `size: landscape` alone rotated A4 while a page with no size was Letter: two
  defaults, now one.
