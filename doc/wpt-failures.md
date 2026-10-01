# WPT failures, with the engine loaded

Every paginated WPT reftest the engine fails, why, and where to start. This is
the working list for M6; `native-support.md` has the summary table and how the
runner decides a pass.

**Snapshot:** WPT `60657f20`, Chromium 153 and Firefox 155, 2026-09-24,
re-run after:

- `@page` in `@layer`;
- margin-box geometry fixed in four places, and the margin boxes' fonts
  loaded before they are measured;
- the margin chain stopping at a `flow-root`;
- percentage `@page { width; height }`;
- slices of content taller than a page (`review.md` §4).

The same day it was re-run again after the UA's `body { margin: 8px }` went
back on the page (`review.md` §3.6, reversed).

Then once more after the page geometry the page model lacked: `@page {
margin: auto }`, negative page margins, and the viewport as the first page's
area. The counts held when split boxes with a set height began to share it
across their pages (`review.md` §4.7): `monolithic-overflow-031` went
from 13 pages to the right 5, and `page-background-003`'s reference now
paginates as Chromium prints it. Both still differ by pixels.

Then after absolute boxes across pages (`review.md` §4.8): monolithic
content sliced as far as its ink goes, in flow or not, and split boxes
filled to the page's foot.

Then after floats, page sides and media queries (2026-09-25): a block beside
a float is stacked, a float splits like a block, a right-to-left root makes
page 1 a left page, width queries are answered against the user agent's
page, and a break's extent leaves out absolute boxes.

Then after vertical writing (`review.md` §5).

Then after margin boxes in vertical writing.

**52 of 235 fail on Chromium, 63 on Firefox**, 66 on either. That was 54 and
63 before margin boxes in vertical writing, 68 and
77 before vertical writing, 73 and
83 before floats and page sides, 77 and
87 before absolute boxes, 82 and
92 before the page geometry, 90 and 100 before the body margin, and 120 and
121 before this batch. No test that
passed before fails now on the same engine. Every failure has a cause below:
the two the body margin left behind are a font and text rendering. Text no
element holds, in the root or loose beside a block, now breaks between its
lines. That moved no WPT count, but it took `root-margin-001` to the right
page count.

## Reproducing

```
node packages/test/wpt.mjs --folio --engine chromium --verbose --shots /tmp/wpt
node packages/test/wpt.mjs --folio --engine firefox --filter page-name
```

`--shots` writes each failing test as one image, our test's pages on the left
and our reference's on the right; `--filter` takes any substring of the path.
The full per-test reasons are in `packages/test/wpt-results-folio.json`
(not committed, host-specific). About ten minutes per engine for the lot.

## Reading a reason

| Reason | Means |
| --- | --- |
| `reference is N pages, the browser prints it on M` | Our pagination of the **reference** disagrees with Chromium's print of it. The reference is written to be easy, so this is almost always an engine bug or a missing feature — and the test's own result is not even looked at. |
| `N pages, reference has M` | Our reference is right (it matched Chromium) and our test comes to a different page count. |
| `Npx on page K` | Same page count; the pixels differ on those pages, beyond the test's `fuzzy` allowance. |
| `page 2 asked for, the test has 1` | `reftest-pages` asks for a page we did not make. |
| `page K is W×H, reference W×H` | The page sizes differ. |
| `Error: …` | The run itself failed: a timeout, or a zero-sized page. |

## By cause

Ordered by what to do next, not by size: first the bugs that break a §9
property (a page that overflows unreported, a forced break lost), then the
design questions everything else waits on, then the gaps, then the absent
features. "Verified" means a test in the group
was read and the cause checked on it; "presumed" means the group was assigned
by its name and one look, and should be checked before it is worked on.

| Cause | Tests | Kind | Diagnosis |
| --- | --- | --- | --- |
| [WPT against WPT](#conflicts) | 2 | Tests that contradict other tests | Verified |
| [Structural selectors see the fragment](#structural) | 5 | Deferred by decision | Verified |
| [Page painting: what is left](#page-paint) | 3 | Engine gap | Verified |
| [Floats across pages](#floats) | 4 | Engine gap | Verified |
| [Content taller than a page: what is left](#monolithic) | 27 | Engine gap | Examined |
| [`position: fixed`](#fixed) | 13 | Deferred by decision | Presumed from the family |
| [Vertical writing: what is left](#vertical) | 4 | Engine gap | Examined |
| [Multicol inside pages](#multicol) | 1 | Deferred by decision | Verified |
| [Framesets and iframes](#frames) | 2 | Out of scope for now | Verified |
| [A pixel or so, and a font](#subpixel) | 5 | Rendering | Examined |
| **Total** | **66** | | |

What moved in this run:

- **Vertical writing** went from 18 to 4 on both engines, and then to 2 on
  Chromium with margin boxes.

- Three groups dissolved.
  - **The root on the page, what is left.** Its margin-box tests were
    geometry, fixed, or the UA body margin, now a group of its own. The rest
    went to vertical writing and content taller than a page.
  - **`@page` inside `@layer`** passes.
  - **Not yet looked at** was triaged into the groups where its tests now
    are. `page-size-014` and `page-margin-007`'s reference were bugs, and
    are fixed.
- **Page geometry the page model does not have** came and went. All five
  of its tests pass on both engines: auto margins share what `width` and
  `height` leave of `size`, a negative margin is page area past the page's
  edge, and the viewport is the first page's area, named or not.
- **Floats and absolute boxes across pages** is floats alone now:
  `page-margin-004` passes, and `monolithic-overflow-026`–`028` left the
  monolithic group.
- **The UA's body margin, off by decision** was a group of nine for a day. The
  margin is back on the page, as CSS says, and seven of them pass on both
  engines. The other two are a font and text rendering, in "a pixel or so,
  and a font".

<a id="conflicts"></a>

### WPT against WPT

**Tests that contradict other tests.** Verified, with Chromium's own print of
each case (`page.pdf`), which fails the passing half of each pair itself.

Two rules in `review.md` §2 make one test pass and another fail, and no
rule the review could find passes both. In each, the rule is kept because it
is a rule, and the test it fails is written down here:

- **Named pages inside an absolutely positioned box.** `page-name-abspos-002`
  wants no break between `page: a` and `page: b` children of an abspos box;
  `page-name-003` wants one, and differs only in giving the box no offsets.
  Chromium breaks in both. The engine follows `abspos-002` and CSS Paged
  Media 3, where only in-flow boxes are separated by the class A break points
  a page name forces.
- **An empty box is a page; a zero-height box with text is not.**
  `zero-height-page-break-001` and `page-name-display-none-child` each give an
  empty box a page of its own; `page-name-zero-height-001` puts four
  zero-height named boxes, each with a line of text overflowing it, on one
  page with the box after them. Chromium prints six pages for the last, against
  its reference's three. The engine follows the first two: "a page exists if a
  box starts on it" is a rule, and "a box counts unless it has text that
  overflows a zero height" is not one.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/page-name-003-print.html` | 1 pages, reference has 2 | same |
| `css-page/page-name-zero-height-001-print.html` | 6 pages, reference has 3 | same |

<a id="structural"></a>

### Structural selectors see the fragment

**Deferred by decision** (2026-09-25): the owner chose to keep the
limitation, which Paged.js shares, over placeholders or a rung-P+ rewrite.
Verified.

`page-orientation-on-*-001` style the second page's block with
`div:nth-of-type(2)`. On page 2 the composed clone is the *first* `div` in its
page, so the rule misses it: no height, no border, no page name — and the page,
now painting nothing, is dropped. Every structural selector (`:first-child`,
`:nth-child`, `:nth-of-type`, `+`, `~`, `:last-child`) is matched against the
page's clones, not the source. Paged.js has the same limitation. Candidates:
compose inert placeholders for the siblings a page leaves out, or rewrite
structural selectors to source-index attributes (rung P+). The orientation
itself (`page-orientation`) is also unimplemented. `page-left-right-001`
joined when the canvas was painted: its test pages are right, and its
reference places its boxes with `div:nth-child(even)`, which the second
`div`, first on its page, does not match.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/page-left-right-001-print.html` | 19264px on page 2, 19264px on page 4 | 19015px on page 2, 19015px on page 4 |
| `css-page/page-left-right-002-print.html` | 3px on page 1, 19130px on page 2, 3px on page 3, 19130px on page 4 | 18761px on page 2, 18761px on page 4 |
| `css-page/page-orientation-on-landscape-001-print.html` | page 1 is 480×288, reference 288×480 | same |
| `css-page/page-orientation-on-portrait-001-print.html` | page 1 is 288×480, reference 480×288 | same |
| `css-page/page-orientation-on-square-001-print.html` | 5760px on page 1 | same |

<a id="page-paint"></a>

### Page painting: what is left

**Engine gap.** Verified.

- **`html, body { height: 100% }` does not reach the page**
  (`review.md` §3.7). `page-box-000` is `html { display: grid;
  place-items: center; height: 100% }`. The two ways to give the root chain
  a height each cost corpus pages before.
- **An absolute box fragmented beside the flow** (`page-background-002`,
  `-003`). The reference paints the background as an absolutely positioned
  box of images taller than a page. Chromium fragments that box on its own,
  at the page's end, while the text breaks where it breaks. A page holds one
  break position, so the two cannot both end the page. A break's extent no
  longer counts an absolute box (it made `-003`'s forced break look 500px
  deep), but the page then measures too tall, and the retry takes an
  earlier break. A page carrying more than one break position is a
  documented limit by decision (see "content taller than a page").

`media-queries-001` passes. Width and height queries are answered against the
user agent's page area, as Chromium does and the test's comment says every
engine does. `page-left-right-002` moved to structural selectors: its sides
are right now (see there).

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/page-background-002-print.html` | 961px on page 2 | reference is 4 pages, the browser prints it on 3 |
| `css-page/page-background-003-print.html` | reference is 3 pages, the browser prints it on 2 | same |
| `css-page/page-box-000-print.html` | 18480px on page 1 | 18320px on page 1 |

<a id="floats"></a>

### Floats across pages

**Engine gap, partly done** (2026-09-25). Verified.

Two rules came in: a block beside a float is still after its predecessor,
and a float splits like a block. The stacking test reads in-flow ink only,
where a float's ink had made the next block look "beside" and lost a forced
break (`page-name-float-002`). A float takes extent slices
(`break-nested-float-in-table-001`). Both pass. What is left:

- **A float's margin across a page** (`float-with-large-margin-*`). Chromium
  keeps a float that ends at the page's foot there, and carries its bottom
  margin to the next page as clearance. With `break-inside: avoid`, the
  margin makes the float unbreakable and moves it. That is a second
  position a page would have to carry, which is a documented limit by
  decision (see "content taller than a page").
- **`page-size-007`, `-008`** have the right page count now, 6, and differ
  in how a float continued onto a named page of another size is laid out
  beside the text.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-break/float-with-large-margin-bottom-cross-page-001-print.html` | 9216px on page 1, 12416px on page 2 | 3200px on page 2 |
| `css-break/float-with-large-margin-bottom-cross-page-002-print.html` | 1 pages, reference has 2 | same |
| `css-page/page-size-007-print.html` | 28551px on page 2, 13280px on page 4, 244601px on page 6 | 15847px on page 2, 7864px on page 4, 127906px on page 6 |
| `css-page/page-size-008-print.html` | 244631px on page 2, 28560px on page 4, 13241px on page 6 | 127847px on page 2, 15864px on page 4, 7906px on page 6 |

<a id="monolithic"></a>

### Content taller than a page: what is left

**Engine gap, partly done** (`review.md` §4). Examined.

**More than one break position per page is a documented limit, by
decision** (2026-09-25). A line sliced across pages, an absolute box
fragmented beside the text, a float's margin carried as clearance, and
overflow past a smaller parent each need a page to end in two places at
once. The owner chose to keep the page model at `(spec, start)`, with one
break position, over extending it. Those tests stay failing, each with its
cause below. The other causes here are ordinary gaps.

The page can now end inside a box: monolithic content that starts a page is
sliced, and so is a box whose own extent is all that crosses the page. 16 of
the family's 32 tests pass on Chromium, up from 1, and `transform-022` and
`page-box-004` with them. What is left, by cause (`review.md` §4.5):

- **A split box with a set height** shares it across its pages now
  (`extents.ts`, `review.md` §4.7). Monolithic content is atomic to the
  walk, where it was broken between the lines inside it. `-031` has the
  right page count and differs by pixels. `-028` no longer runs away, but its
  tall box is absolutely positioned, and adds nothing to the page's measured
  height. That was fixed next (`review.md` §4.8), and `-032` is not
  examined.
- **Monolithic content is sliced as far as its ink goes**, and out of flow
  too: `-026`, `-027` and `-028` pass. `-029` is two absolute boxes, the
  second at `top: 2in`. It needs absolute boxes placed in the unfragmented
  document's coordinates, and comes to 3 pages of 4. `-030` is fixed
  positioning.
- **A slice inside a line** (`-014`, `-015`), an `inline-block`.
- **Tables with repeated headers or footers around a slice** (`-016`,
  `-017`, `-023`). `-016`'s reference places its headers with absolute
  boxes in document coordinates (one break position, by decision). `-023`
  prints on 2 pages in Chromium without slicing its monolithic row, but
  Chromium does slice monolithic content in other tables (`-009`–`-011`).
  A "no slices in tables" rule broke those and a float in a cell, and was
  reverted.
- **Overflow past a smaller parent** (`-019`) and floats beside the slice
  (`-020`).
- **Line-level content** (`-024`, `-025`), fixed positioning (`-030`),
  `css-break` references built from overflow (`overflowing-block*`,
  `transform-024`, `underflow-from-next-page`). Not examined.
- **On Firefox only**, `-003`–`-011` come to five pages where Chromium's
  print has four. The test and the reference agree with each other. Firefox's
  default serif sets the last paragraph taller than Chromium's, and it no
  longer fits on page 4. The paragraph is loose text beside a block, which
  now breaks between its lines like any other, so part of it goes to page 5
  and not all of it. That is a font measured against a Chromium oracle, not
  a slicing bug, probed with the same markup on both engines.
- **`root-margin-001`** has the right page count since loose text breaks
  between lines, and differs by pixels on page 2.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-break/overflowing-block-002-print.html` | reference is 3 pages, the browser prints it on 2 | same |
| `css-break/overflowing-block-print.html` | reference is 1 pages, the browser prints it on 3 | same |
| `css-break/root-margin-001-print.html` | 1174px on page 2 | 1154px on page 2 |
| `css-break/transform-024-print.html` | 6 pages, reference has 5 | same |
| `css-break/underflow-from-next-page-print.html` | 1 pages, reference has 2 | same |
| `css-page/monolithic-overflow-003-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-004-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-005-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-006-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-007-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-008-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-009-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-010-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-011-print.html` | pass | reference is 5 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-014-print.html` | 2 pages, reference has 4 | same |
| `css-page/monolithic-overflow-015-print.html` | 1 pages, reference has 4 | 2 pages, reference has 4 |
| `css-page/monolithic-overflow-016-print.html` | reference is 5 pages, the browser prints it on 4 | same |
| `css-page/monolithic-overflow-017-print.html` | 15043px on page 1, 49px on page 3, 8665px on page 4 | 14917px on page 1, 50px on page 3, 8568px on page 4 |
| `css-page/monolithic-overflow-019-print.html` | reference is 1 pages, the browser prints it on 4 | same |
| `css-page/monolithic-overflow-020-print.html` | reference is 6 pages, the browser prints it on 4 | reference is 7 pages, the browser prints it on 4 |
| `css-page/monolithic-overflow-023-print.html` | 3 pages, reference has 2 | same |
| `css-page/monolithic-overflow-024-print.html` | 2 pages, reference has 6 | 3 pages, reference has 6 |
| `css-page/monolithic-overflow-025-print.html` | 2 pages, reference has 8 | 4 pages, reference has 8 |
| `css-page/monolithic-overflow-029-print.html` | 2 pages, reference has 4 | same |
| `css-page/monolithic-overflow-030-print.html` | 3 pages, reference has 4 | same |
| `css-page/monolithic-overflow-031-print.html` | 55009px on page 1, 20000px on page 2, 20000px on page 3, 20000px on page 4, 20000px on page 5 | 52897px on page 1, 20000px on page 2, 20000px on page 3, 20000px on page 4, 20000px on page 5 |
| `css-page/monolithic-overflow-032-print.tentative.html` | 10 pages, reference has 7 | same |

<a id="fixed"></a>

### `position: fixed`

**Deferred by decision** (2026-09-25): not urgent, and not taken up until
the owner says so. Presumed from the family.

A fixed box repeats on every page in print. It is not in the feature map
(CLAUDE.md, "still owed"). `page-margin-005`'s reference is one of them: a
fixed square in the corner of every page. `page-name-fixed-pos-001` has
passed since slices.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/fixedpos-001-print.html` | 2 pages, reference has 3 | same |
| `css-page/fixedpos-002-print.html` | 2 pages, reference has 3 | same |
| `css-page/fixedpos-003-print.html` | 730px on page 1, 730px on page 3 | 717px on page 1, 717px on page 3 |
| `css-page/fixedpos-004-print.html` | reference is 4 pages, the browser prints it on 3 | same |
| `css-page/fixedpos-005-print.html` | reference is 6 pages, the browser prints it on 5 | same |
| `css-page/fixedpos-006-print.html` | reference is 4 pages, the browser prints it on 5 | same |
| `css-page/fixedpos-007-print.html` | reference is 5 pages, the browser prints it on 3 | same |
| `css-page/fixedpos-008-print.html` | reference is 8 pages, the browser prints it on 6 | same |
| `css-page/fixedpos-009-print.html` | 138px on page 1, 69px on page 2 | same |
| `css-page/fixedpos-010-print.html` | reference is 3 pages, the browser prints it on 4 | same |
| `css-page/fixedpos-011-print.html` | 14592px on page 1, 10000px on page 2, 10000px on page 3 | same |
| `css-page/fixedpos-with-abspos-with-link-print.html` | 2 pages, reference has 3 | same |
| `css-page/fixedpos-with-link-with-inline-child-print.html` | 666px on page 2 | 619px on page 2 |

<a id="vertical"></a>

### Vertical writing: what is left

**Built** (`review.md` §5, 2026-09-25). 14 of the 18 pass on both
engines. The content area and the measuring box take the root's flow, so the
measurer's rectangles are logical and pages are cut along x. The page box
stays physical. Page sides, logical page margins (in `@page`'s own writing
mode where it sets one), `vi` and `vb`, the canvas's pieces, and orthogonal
flows (one box to the page) all follow. What is left:

- **Margin boxes in vertical writing** (`dimensions-013`, `-014`) pass on
  Chromium. A margin box inherits the root's flow, and its logical
  declarations are read as the physical ones they mean in its writing mode
  (`authoredOf`). On Firefox they differ by about 1,250px, which is its
  vertical text metrics.
- **`sideways-rl`** (`body-background-srl`) differs by 8,000px on page 2,
  where the other three writing modes of the same test pass.
- **`page-size-012` on Firefox** differs by pixels on both pages; it passes
  on Chromium.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/body-background-srl-print.html` | 8000px on page 2 | same |
| `css-page/margin-boxes/dimensions-013-print.html` | pass | 1251px on page 1 |
| `css-page/margin-boxes/dimensions-014-print.html` | pass | 1204px on page 1 |
| `css-page/page-size-012-print.html` | pass | 30738px on page 1, 13201px on page 2 |

<a id="multicol"></a>

### Multicol inside pages

**Deferred by decision** (2026-09-25): the owner chose to leave it, rather
than re-run the M0.3 spike (`review.md` §1) or build column
fragmentation. Verified.

`break-inside-avoid-multicol-001`: columns inside a page. An M6 item, and
the hardest F-tier one (`plan.md` §4).

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-break/break-inside-avoid-multicol-001-print.html` | 3 pages, reference has 2 | same |

<a id="frames"></a>

### Framesets and iframes

**Out of scope for now.** Verified.

`media-queries-003` is a `<frameset>` document, which has no `body` to
paginate; `remote-origin-iframe` is 49px off around a cross-origin iframe.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/media-queries-003-print.html` | Error: page.screenshot: Expected options.clip.width to be greater than 0. | same |
| `css-page/remote-origin-iframe-print.html` | 49px on page 1 | 50px on page 1 |

<a id="subpixel"></a>

### A pixel or so, and a font

**Rendering and fonts, not layout.** Examined.

`margin-boxes/alignment-001` lays out identically to its reference on
Chromium, every margin box and the text included, and differs by 63px of
text rendering. It passes on Firefox. `margin-boxes/auto-margins-001`'s
reference is a `body { display: grid; height: 100vh }` holding a paragraph.
Firefox's default serif makes the paragraph taller than its row, so the
reference comes to two pages on Firefox where Chromium's print has one. It
passes on Chromium. Before, the test's own page also overflowed, because
text directly in the source root had no line breaks. It has them now
(`appendRunCandidates`, `candidates.ts`).

`margin-boxes/content-002` is not ours to fix. It is 11px at `t]` in
`deklamert]`, where the reference's generated content is shaped as separate
runs at each quote mark and our margin box is one run of text. It passes on
Firefox. `page-margin-007` lays out identically to its reference on
Chromium since the margin chain stops at a `flow-root` (`fragments.ts`,
`seals`), and differs by 9px of text on three pages. It passes on Firefox.
`margin-boxes/dimensions-004` on Firefox differs by 32px at one box's edge.

| Test | Chromium | Firefox |
| --- | --- | --- |
| `css-page/margin-boxes/alignment-001-print.html` | 63px on page 1 | pass |
| `css-page/margin-boxes/auto-margins-001-print.html` | pass | reference is 2 pages, the browser prints it on 1 |
| `css-page/margin-boxes/content-002-print.html` | 11px on page 1 | pass |
| `css-page/margin-boxes/dimensions-004-print.html` | pass | 32px on page 1 |
| `css-page/page-margin-007-print.html` | 9px on page 2, 9px on page 4, 9px on page 6 | pass |
