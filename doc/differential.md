# The differential, fixture by fixture

M3's exit check is not a number: *"the whole Paged.js corpus matches, or each
difference is documented as a bug in one engine or a deliberate improvement in
ours"* (`milestones.md` §M3). This file is that documentation. It is written
against the 122 fixtures of the vendored Paged.js spec corpus, both engines
measured on the same machine in the same session, because a page count is a
function of the fonts a host happens to have (M0.2).

```
node packages/test/serve.mjs &
node packages/test/baseline.mjs         # Paged.js
node packages/test/paginate-corpus.mjs  # ours
node packages/test/differential.mjs     # the table
```

## What is measured, and why a page count is not enough

Four numbers per page, the same four on both sides.

| Number | What it says |
| --- | --- |
| Page count | How many pages the document came to. |
| Moved elements | How many source elements start on a different page than on the other engine. |
| Lost lines | Line boxes of text laid out **outside** the area the page prints. |
| Fill | How far down the area the ink reaches — how full the page is. |

The third is the one that settles most arguments, and it was not there when
this check began. An engine that drops content needs fewer pages for it, so
"fewer pages" reads as an improvement when it is the opposite. Paged.js
implements widows and orphans with a column trick, so what it cannot fit goes
*sideways*: on `widows-orphans` the text runs 5505px past the right edge of a
302px page, where nothing will ever print it. Measuring only the block axis
reports that page as fitting.

Line boxes of text nodes, not element boxes. Paged.js's own page wrapper is a
multi-column box several pages wide by construction; measuring element boxes
calls 93 of 122 fixtures broken, and measuring the lines calls 5.

**Across the whole corpus, Paged.js lays text outside the printed page on 5
fixtures and we do on 1** — `infinite-loop`, where a 172px paragraph is put on
a 76px page with no candidate inside it, and where both engines lose the same
line by the same 141px. Everywhere else our pages hold what they claim to.

## What the check found in us

Walking the differences found eleven bugs in this engine. They account for 27
of the 41 fixtures that disagreed when the walk started — which is the useful
part of this exercise: most of what looked like a difference of opinion about
typography was us getting the fragmentation model wrong.

1. **A trailing margin had to fit.** Break candidates measured to the *next*
   box's start, which is past the previous box's bottom margin — so a page
   reserved room for a margin that is never drawn. CSS Break 3 truncates
   margins adjoining a fragmentation break, and both browsers agree: in a
   column exactly two lines tall, the second line stays put whether the
   trailing margin is 0, 18 or 40px. Candidates now measure to where the ink
   stops. This alone was the eight `breaks/break-{before,after}-*` fixtures,
   which ran 3 to 6 pages long apiece.
2. **The same margin at the top of a page.** The rule that truncates the start
   margin of a continued page only reached the content area's first child, and
   margins collapse: a continued `<section>` with a `<p>` inside it had the
   paragraph's 18px reappear above the section. The rule now covers the chain
   of first children, as deep as the fragmenter walks.
3. **The last-page test measured the box, not the ink.** "Does everything left
   fit" asked the measuring box for its height, and an absolutely positioned
   box includes the last paragraph's bottom margin because nothing collapses
   through a formatting context. A document whose ink ended at 402px in a 408px
   area measured 420 and was split in two (`page-rules/size/landscape`).
4. **`@import` was never followed.** Stage 1 read `<style>` and `<link>` and
   stopped there, so `issues/imports` — which keeps its `@page { size: A5 }`
   and its forced breaks in an imported file — paginated at the default page
   size, six pages becoming two. Imports are now followed, with their media
   condition honoured and a depth limit so a cycle cannot hang stage 1.
5. **A named page changing on a first child was invisible.** The check compared
   *siblings*, and `page` is inherited, so `div.content > div.preamble { page:
   preamble }` had nothing to compare against. The walk now carries the current
   name in document order and breaks wherever it changes, at any depth.
6. **A first child's `break-before` did not propagate to its parent.** CSS
   Break 3 §4.2 says it does; without it a `<section>` asking for a page shared
   one with whatever preceded its `<main>`.
7. **A forced break at the start of a page made a blank page.** Breaks are
   ignored at the edges of a fragmentation context; ours was honoured, so a
   document whose named page began at its first element opened with a blank
   sheet. The fallback that resurrected such breaks now applies only when the
   page must break at all.
8. **A trailing page that paints nothing.** `break-after: page` on the last
   visible block, with only `display: none` siblings and a `<script>` after it,
   is a forced break the fragmenter must honour and a page nobody wants.

Three more were ours as well, and were fixed the same way — by changing what we
do rather than by arguing about it:

9. **Paper sizes outside the ten CSS requires.** `size: A6` is not in CSS Paged
   Media 3 §3.1, and an unknown name silently became the default page — a
   booklet laid out on US Letter. The table now carries the rest of the ISO
   series, as Paged.js does.
10. **A split table row lost its columns.** A page that begins inside a row
    begins inside one of its cells, and the row arrived a cell short; the
    browser then laid the table out from what it could see, turning columns of
    5.7% and 94.2% into 575px and 69px and making every row 336px tall instead
    of 125. The missing leading cells are put back empty, which lets the
    author's own widths resolve — the answer Paged.js gets by copying resolved
    widths, without carrying pixels from page to page.
11. **`break-inside: avoid` on something that cannot fit.** A table 610px tall
    in a 567px area is going to be split whatever anyone wants; charging for
    breaks inside it bought 240px of white space on the page before and a split
    on the page after. An `avoid` the element is too tall to honour is no
    longer charged for.

The corpus went from 81 of 122 fixtures agreeing on page count to 108 of 122
— and to **110** after M5 found a twelfth bug of the same kind, below — and
from two fixtures whose pages overflowed to one: `infinite-loop`, which is a
172px paragraph on a 76px page with nothing to split, and which Paged.js loses
the same line on.

## What remains

Re-measured after M5, and again after the line-grouping fix below. Ten
fixtures since the body margin took `footnotes-padding` off this list, and
eleven before, down from the fourteen this file first recorded:
`issues/duplicate-headers` was a bug and is fixed (below), `position-fixed` and
`tables/rebuild` now agree on page count without agreeing on everything, and
`notes/footnotes` agrees since the engine stopped miscounting lines. None of
the eleven is an accident of measurement — each is a decision one engine makes
and the other does not.

| Fixture | Theirs | Ours | Verdict |
| --- | --- | --- | --- |
| `widows-orphans` | 5 | 9 | Theirs loses 62 lines off the page |
| `hyphens/awesome` | 2 | 5 | Theirs loses 6 lines off the page; one more page of ours is the body margin (below) |
| `breaks/break-inside/break-inside-avoid-table-cell` | 2 | 1 | Theirs splits what fits |
| `issues/stops-rendering-early` | 3 | 2 | Theirs splits what fits |
| `math/math` | 3 | 2 | Theirs splits what fits |
| `splits/tables/rowspan-table` | 2 | 1 | Theirs splits what fits |
| `splits/tables/exceeding-rowspan-table` | 2 | 1 | Theirs splits what fits |
| `notes/footnote-display` | 6 | 4 | Ours fits more text beside the same notes |
| `notes/footnote-policy` | 6 | 4 | Ours fits more text beside the same notes |
| `notes/footnotes-lastpage` | 5 | 6 | Ours: the 70% default note-area cap |

**Before the UA's body margin went on the page, 111 of 122 fixtures agreed
on page count**; now 88 do. The 24 differences it made are the next section.
`notes/footnotes-padding` left this table with it: the margin took it from 5
pages to Paged.js's 6. It was 110, up from 108 when this file was
first written and 81 before M3's walk. One fixture still overflows —
`infinite-loop`, a 172px paragraph on a 76px page with nothing to split, which
Paged.js loses the same line on.

### The UA's body margin (24)

`body { margin: 8px }` is on the page, as CSS says (`review.md` §3.6,
reversed 2026-09-24). Paged.js never had it, because its content is not in a
`body`, and no fixture sets a body margin. Every fixture paginated from
`body` has 16px less measure and 8px less on its first page, and these 24
have more pages for it. The arbiter is Chromium's own print of each fixture
(`page.pdf`, with Paged.js blocked):

| Fixture | Theirs | Ours before | Ours | Chromium |
| --- | --- | --- | --- | --- |
| `breaks/break-after/break-after-page` | 31 | 31 | 34 | 34 |
| `breaks/break-before/break-before-page` | 28 | 28 | 31 | 31 |
| `breaks/break-after/break-after-left` | 38 | 38 | 44 | 34 |
| `breaks/break-after/break-after-right` | 39 | 39 | 45 | 34 |
| `breaks/break-after/break-after-recto` | 39 | 39 | 45 | 34 |
| `breaks/break-after/break-after-verso` | 38 | 38 | 44 | 34 |
| `breaks/break-before/break-before-left` | 36 | 36 | 42 | 31 |
| `breaks/break-before/break-before-right` | 37 | 37 | 43 | 31 |
| `counters/counter-page` | 6 | 6 | 7 | 7 |
| `counters/counter-pages` | 6 | 6 | 7 | 7 |
| `custom-bleeds` | 14 | 14 | 16 | 16 |
| `following-selector` | 14 | 14 | 16 | 16 |
| `nth-of-type-selector` | 14 | 14 | 16 | 16 |
| `issues/duplicate-headers` | 6 | 6 | 8 | 8 |
| `issues/template` | 6 | 6 | 8 | 8 |
| `margin-boxes/dimension` | 6 | 6 | 8 | 8 |
| `named-page/named-page` | 8 | 8 | 10 | 10 |
| `page-selector/first-page` | 6 | 6 | 7 | 7 |
| `page-selector/page-group/first-page-of-page-group` | 8 | 8 | 9 | 9 |
| `page-selector/page-group/spread-of-page-group` | 8 | 8 | 10 | 10 |
| `page-selector/page-nth` | 6 | 6 | 8 | 8 |
| `page-selector/page-spread` | 6 | 6 | 8 | 8 |
| `target/target-counter` | 8 | 8 | 9 | 9 |
| `notes/footnotes` | 13 | 13 | 14 | 13 |

Seventeen are Chromium's count exactly. Six are side breaks
(`left`/`right`/`recto`/`verso`). Chromium prints them with the plain `page`
break's count, because it does not add the blank pages a side asks for. We
do, and the `page` versions of the same fixtures agree with Chromium. The
last is `notes/footnotes`, which Chromium cannot judge: it does not implement
`float: footnote`. Verdict for all 24: **ours, by decision, and CSS's.**

### Paged.js lays text outside the page (2)

`widows-orphans` sets `widows: 3; orphans: 3` on a 302px page. Paged.js reports
five pages; its last page holds 2716 characters — 62 line boxes — of which 16
lines are inside the area and the rest are 5505px to the right of it, in
columns that no printed page will ever show. We take nine pages and lose
nothing. `hyphens/awesome` is the same failure at 80pt: six lines, 2656px out.

These are the two fixtures where "fewer pages" is worst as a measure of
quality, and they are why this file measures lost lines at all.

### Paged.js splits what fits (7)

Seven fixtures where Paged.js opens a page for content that fits on the one
before, and neither engine loses anything. The evidence is the fill: on
`splits/tables/rowspan-table` a 154px table sits in a 300px page and Paged.js
puts 76px of it on one page and the rest on another;
`break-inside-avoid-table-cell` asks for `break-inside: avoid` on the cell
Paged.js splits; `issues/stops-rendering-early` (908px against their 836) and
`math/math` (946 against 849) are simply fuller. The two footnote fixtures
are the same thing beside a note area: ours reach 591–610px of ink where theirs
reach 271–479. A third, `notes/footnotes-padding`, agrees with Paged.js since
the UA's body margin narrowed our measure.

We claim these as improvements, with the caveat that "fuller" is a choice: a
typesetter may want the looser page. The engine's own rule — *the cheapest
break that fits, and no page overflows* — is what produces them, and no fixture
here shows a break a reader would call wrong.

### Ours, and owed (1)

It is bounded and deliberate. With no `@footnote { max-height }`, a note
area may take at most 70% of a page (`review.md` §6.1). Paged.js has
no such cap. Since M6, a note that will not fit is split across pages
rather than moving its call, but the cap still limits what one page holds.
On `notes/footnotes-lastpage` that costs a page. Our pages are otherwise
the fuller ones, 607px of ink against 511, and the cap is what stopped the
fixture overflowing, which it did before M3's walk.

`notes/footnotes` was the second, 14 pages against 13, and was not the cap
after all, or not only. Its paragraphs carry their footnote calls as inline
elements, and the candidate walk treated a paragraph with an inline child on
a later line as blocks with a free break between them; it also counted a line
holding a raised call as two lines. Both are fixed (`candidates.ts`,
`dom-measurer.ts`), and it now comes to 13 pages, as Paged.js does.

### Two that were owed and no longer cost a page

**`issues/duplicate-headers` was a bug, and it is fixed.** The measuring box
has running elements taken out of it before candidates are enumerated, because
a running element is not in the flow. The *composed page* did not: `paginate`
measured it with the running head still in it, found it too tall, and took a
tighter break to make room for something that would not be there. A break at
630px of a 643px area fell back to 547, and every chapter ended with a 65px
page of its own — eight pages where six were needed. The last-page path had
always removed them before measuring; the ordinary path had not. Now both do,
and the fixture matches Paged.js page for page.

**`position-fixed` matches on page count and the feature still does not
exist.** `position: fixed` is not in the feature map of `plan.md` §4; we leave
such an element in the flow, where Paged.js takes it out and repeats it on
every page. Both engines now report ten pages, but ours fills 240px of each
page after the first where theirs fills 260 — the element is on page 1 only.
Implementing it is a scope decision, not a bug fix, and the machinery is there
if the decision is taken: `takeRunningElements` already removes elements and
keeps clones for the margin boxes.

**`tables/rebuild` matches on page count and not on balance.** A table row
whose cells are taller than the page fragments inside them, and we break at the
first candidate inside the cell rather than balancing the two fragments: four
pages either way, but ours are 876/813/900/177 against their 876/920/919/18.
Theirs wastes a near-empty last page; ours wastes the middle. Nothing is lost
on either side and no page overflows.

## Standing on this

Two of the eleven are Paged.js losing content. Eight are the two engines
disagreeing about how full a page should be, with nothing lost on either side
and our pages fuller. One is ours, and it is the M6 note-area cap.

That is the exit check: no difference is unexplained, and the ones that are
ours are written down here rather than left to be rediscovered.
