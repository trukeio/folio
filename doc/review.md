# Design reviews

The design reviews and the M0.3 spike, in the order they were made. Each
chapter is a decision: what the tests said, the model chosen, what it cost,
and what building it found. All of them are implemented. Cite a section as
`review.md` §N.M.

| § | Subject | Decided |
| --- | --- | --- |
| 1 | Can the browser decide our page breaks? (M0.3 spike) | No; breaks are chosen in JavaScript |
| 2 | Where a page may break, and what a page is | 2026-09-23 |
| 3 | The root element, and what a page area holds | 2026-09-24; §3.6's first decision reversed the same day |
| 4 | Content taller than a page | 2026-09-24 |
| 5 | Vertical writing | 2026-09-25 |
| 6 | `footnote-policy` and note splitting | 2026-09-25 |
| 7 | Page floats | 2026-09-25 |
| 8 | `::nth-fragment()` on rung P+ | 2026-09-25 |

Three things recur across chapters and are stated once here:

- **The oracle is Chromium's print of the reference** (`page.pdf`), for every
  engine. Our test matching our reference is not a pass.
- **The corpus is the check for anything that should not move.** A change
  that claims to leave horizontal, float-free or selector-free documents
  alone must leave `paginate-corpus.mjs` identical byte for byte.
- **The fragmenter's line budget** (`plan.md` §3) is counted after each
  chapter; `CLAUDE.md` has the running total.

---

## 1. Can the browser decide our page breaks?

**Verdict: no. Decide breaks in JavaScript.** `plan.md` §3 proposed a spike:
give one column the page height, let the browser place the breaks, and see
whether stage 3 can shrink to reading them back.

### 1.1 The question, made falsifiable

| # | Question | Why it matters |
| --- | --- | --- |
| 1 | Can we tell which column content landed in? | Composition needs a position. Fatal if no |
| 2 | Is `break-before` honoured? | "Every forced break is honoured" is an invariant (`plan.md` §9) |
| 3 | Is `break-inside: avoid` honoured? | Otherwise avoid-penalties stay ours |
| 4 | Are `widows`/`orphans` honoured? | Same |
| 5 | Can we recover the text offset of a break? | `Position` is a path *and an offset*. Fatal if no |
| 6 | Does an `<mtable>` equation fragment? | `math.md` §10 Q1 |

### 1.2 Method

Every constraint is tested by **A/B**: change the property and watch whether
the break moves. A block that happens to fit proves nothing about
`break-inside: avoid`. Two early readings were wrong because the constraint
did not bind, and a third because the column pitch was assumed: `column-width`
is a *minimum*, so a 400px column on a 612px container is one 612px column.

Fixture: `packages/test/fixtures/spike/`. Runner:
`packages/test/spike-multicol.mjs`. WebKit runs in CI by
`workflow_dispatch`.

### 1.3 Results

Chromium 153, Firefox 155, WebKit 26.6 (Playwright builds), same fixture and
webfont, fonts loaded before measuring.

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Columns produced | 9 | 9 | **10** |
| 1. Read back which column | yes, one rect per fragment | yes | yes |
| 2. `break-before` honoured | **yes** | **no** (+160px into the column) | **yes** |
| 3. `break-inside: avoid` honoured | yes | yes | yes |
| 4. `widows`/`orphans` honoured | **yes** | **no** | **no** |
| 5. Text offset of the break | 164 | 164 | **334** |
| 6. `<mtable>` equation fragments | **no** (666px box, 300px column) | **no** (758px) | **yes**, 3 fragments |

Firefox ignores the forced break at every spelling tried: `column`,
`always`, `page`, `left`, and `page-break-before`.

### 1.4 What it means

- **Forced breaks settle it.** Honouring them is an invariant; an approach
  that delivers it on two engines of three is not an approach.
- **Widows and orphans confirm it.** Only Chromium honours them, so the
  penalty table has to exist in JavaScript whoever places the breaks, which
  removes most of what multicol was supposed to save.
- **Math is worse than a no.** WebKit fragments an over-tall `<mtable>`;
  Chromium and Firefox overflow it. The same document would paginate
  differently by browser, silently. It confirms `math.md` §4: the inline-axis
  fragmenter turns an equation into block-level lines first.
- **The read-back half works, and is kept.** `getClientRects()` gives one
  rect per fragment everywhere, and line boxes give the break to the
  character. That is `plan.md` §3's "split text at line boxes", independent
  of who decides the break.

So for M1: stage 3 decides breaks in JavaScript behind `Measurer`; multicol
is not used at all, not even to measure; penalties are ours and unit-tested
against the fake measurer; and the remaining per-engine differences are font
metrics, not constraint support.

### 1.5 When to revisit

When **all three engines honour forced breaks and widows/orphans in a
fragmented container**. Re-running the spike is one command. Better MathML
fragmentation would *not* change the answer: equation breaking is ours by
design, and fragmentation arriving unevenly is worse than not arriving.

---

## 2. Where a page may break, and what a page is

**Approved and implemented 2026-09-23.** The budget was raised to 2,100
rather than code moved out of `paginate.ts`; §2.5's boundary rule was kept
as an argument, and taken later (§3.6). The next page is named by the break
before it (§2.3).

**Verdict.** Four WPT groups (named pages, `break-after` inside an inline,
empty pages, trailing loose text) are two missing ideas, each smaller than
the patches it replaces:

1. **Edge values.** A box has a *start* and an *end*: the page name and the
   forced break it presents to its siblings. A block container takes both
   from its first and last in-flow children.
2. **A page is a page if it places a box,** not if it paints.

Trailing loose text is the first idea's plumbing: text beside blocks is an
anonymous block, and must be an *item* in the walk with its own edges,
including after the last element.

### 2.1 What the tests say

Firefox fails the same tests the same way in every row.

| Test | Content, reduced | Chromium | Ours | What it shows |
| --- | --- | --- | --- | --- |
| `page-name-002` | text inside `page:a` after a `page:b` child | 8 | 4 | Loose text is a box with its container's page |
| `page-name-propagated-001` | `a` / `b > c > a` | 1 | 2 | A container starts on its first child's page |
| `page-name-propagated-003` | `a` / `b > c > (abspos, a)` | 1 | 2 | Out-of-flow children are skipped for "first" |
| `page-name-propagated-005` | `b > c > (a, abspos)` / `a` | 1 | 2 | … and for "last" |
| `page-name-siblings-002` | `a` / `b > (a, auto)` | 2 | 3 | The break is *inside* `b`, between its children |
| `page-name-siblings-004` | `div` / `page:auto` / `b` | 2 | 3 | `auto` is the parent's page, not the string `auto` |
| `page-name-flex-001` | `a` / column flex `(b, c)` / `d` | 1 | 4 | No propagation out of a flex container, no break between flex items |
| `page-name-flex-004` | the same, `(b, c)` two blocks deep in the item | 2 | 4 | … but a break between blocks *inside* an item |
| `page-name-inline-block-001` | inline-block `(a, b)` | 1 | 2 | Nothing inside an inline-block |
| `page-name-abspos-002` | abspos `(a, b)` | 1 | 2 | Nothing inside an abspos box |
| `page-name-img-001` | `body:a > (img:b, div:b)` | 2 | 1 | An inline `img` has no page of its own |
| `page-name-display-none-child` | `a` / `c > (display:none)` / `b` | 3 | — | An empty box on a named page is a page |
| `block-in-inline-015` | `break-after` on a block inside `display:inline` | 4 | 1 | A last child's `break-after` reaches its container's gap |
| `zero-height-page-break-001` | `break-after`, then an empty `<div>` | 2 | 1 | The empty div is a page |
| `subpixel-page-size-002` | a page-high block, then bare text | 2 | 1 | Text after the last element is content |

### 2.2 Why the old walk could not express it

`enumerateCandidates` walked top-down and decided each gap on reaching it,
carrying one value, `currentPage`. But the gap before a box depends on its
**first** in-flow child, not yet visited, and the gap after it on its
**last**, by which time `currentPage` held whatever was deepest-last, so a
name change inside a flex item or an inline-block leaked out. A first
child's `break-before` was a special case that broke *inside* the parent
(the wrong place: CSS Break 3 §4.2 moves it to the parent's gap); a last
child's `break-after` had none. Loose text existed only in front of an
element, with no page value, and `auto` was compared as a string. One rule
applied top-down that has to be applied bottom-up.

### 2.3 Edge values

For every element, the walk returns its **edges**:

```ts
type Edges = {
  startPage: string;  // the page the box starts on
  endPage: string;    // the page it ends on
  before: string | null; // a forcing break-before, own or propagated
  after: string | null;  // a forcing break-after, own or propagated
  blocks: boolean;    // does it put block-level boxes into its parent's flow?
};
```

- **Used page.** An element's own `page`, or its parent's used page when that
  is `auto` or empty.
- **Items.** A container's children are its element children plus one
  **anonymous item** per maximal run of non-blank text and inline-level
  elements between block-level children, the run after the last one
  included. An anonymous item has the container's used page and no forced
  breaks.
- **In flow.** Only items in normal flow (not `display: none`, absolutely
  positioned or floated) count as "first" and "last".
- **Propagation.** A block container in normal flow, or an inline box that
  contains blocks (CSS 2 §9.2.1.1), takes `startPage` and `before` from its
  first in-flow item and `endPage` and `after` from its last, its own
  forcing value winning. Flex and grid containers, inline-blocks and
  out-of-flow boxes present their own values.
- **Gaps.** Between consecutive in-flow items of a container in the page
  flow, a break is forced when `prev.after` or `next.before` forces it, or
  `prev.endPage !== next.startPage`. Flex and grid items have no class A gaps
  between them, but their contents are in the page flow again; an
  inline-block's or out-of-flow box's are not. Unforced candidates are
  unchanged.
- **Page one.** The root's `startPage` names the first page. A forced break
  before the root's first item is ignored.

The walk is post-order: the gap before item *i* is emitted once *i* has been
visited. **The next page's name comes from the chosen candidate**: every
candidate carries `page` (`next.startPage` for a forced one), which deleted
`pageNameOf`, a second copy of the heuristic that was wrong in the same
cases.

### 2.4 What a page is

> **A page exists if at least one box starts on it. The document has at
> least one page.**

This replaced two "a page that paints nothing is not a page" rules in
`paginate.ts`. Documents that end in `display: none` siblings and a
`<script>` still end; an empty trailing `<div>` is a page. A forced break
before the first box on a page is ignored, by comparing *positions*, not
extents, so a first box that paints nothing no longer discards every break
that fits. The loop cannot stall: every allowed candidate is strictly after
the first box.

### 2.5 The budget, and the fragmenter's boundary

The change did not fit the 2,000-line budget. Rather than write tighter, the
review proposed stating what the fragmenter is:

> **The fragmenter is the code that decides, given a measured box, where the
> page ends. Code that *produces* the box — composing it, taking things out
> of its flow, placing notes and equations on it — belongs to the feature
> that does the producing, even when the decision reads its result.**

Applied to `paginate.ts`, it moved about 235 lines that never chose a break:
the stage 5 settling loop, blank pages and sides, page records, margin boxes
filled at the end and `placeMath` (to `pages.ts` and `settle.ts`),
`placeFootnotes` (to `footnotes.ts`) and the running-element pair (to
`strings.ts`). `layoutOnce` stays: the measuring box, chunk growth, the
candidate filter, the footnote rounds, the recompose loop, the last-page
proof and `toSourcePosition` all choose or verify a break. This review chose
to raise the budget instead; §3.6 took the move a day later, and the rule is
in `plan.md` §3.

### 2.6 Outcome

**WPT, engine loaded:** 51 → **74/235** on Chromium, 53 → **75/235** on
Firefox. Two tests joined `wpt-failures.md` as contradictions:
`page-name-zero-height-001` against `zero-height-page-break-001`, and
`page-name-003` against `page-name-abspos-002`; Chromium's own print fails
one half of each. **Corpus:** unchanged. **Budget:** 2,093 of 2,100 against
an estimate of 2,025. The walk carried more than §2.3 listed, and a break
before text beside blocks names a text node, which composition does not
stamp, so `toSourcePosition` gained `textInSource`.

Settled by asking Chromium:

- **Propagation goes through formatting-context roots.** A named first child
  inside `flow-root` or `overflow: hidden` takes the container's top border
  onto its page.
- **An empty box at the very start is a page.** A leading `<div
  style="break-after: page">` prints as a blank first page.
- **Chromium breaks named pages inside absolutely positioned boxes**, which
  is why it fails `page-name-abspos-002` natively.

Left open: anonymous runs of bare text beside blocks had no candidates
between their lines (fixed later by `appendRunCandidates`), and `display:
contents` is treated as inline.

---

## 3. The root element, and what a page area holds

**Approved and implemented 2026-09-24**, both decisions as recommended
(§3.6). The first, taking the UA's body margin away, was reversed the same
day. The review covered WPT's root-box group (22 tests) and page-painting
group (28).

**Verdict.** The engine flowed the source root's *children* into each page
area, never the root. css-page-3 §3 flows the root: "the page area acts as a
container for all the boxes generated by the root element and its
descendants". That one difference showed in four places:

1. **The root's own box was on no page.** `body { display: grid; height:
   100vh }` laid out nothing, so 19 margin-box references stacked their grid
   cells as blocks.
2. **The root's attributes reached nothing.** `<body style="page: a">`,
   `<body class>` and `<html lang>` were never composed.
3. **The frame's `html` and `body` stood in for the root.** They matched the
   author's rules, so `html { display: none }` hid the pages themselves.
4. **Nothing painted the canvas.** The root background showed in the host by
   accident, margins included.

The fix composes the chain from `<html>` down to the source root onto every
page, and paints the canvas and page background in css-page-3 §3.1's order.

### 3.1 What the tests say

| Tests | Content, reduced | What it shows |
| --- | --- | --- |
| `dimensions-003`–`008`, `-010`–`015`, `alignment-001`, `auto-margins-001`–`003`, `overconstrained-001`, `paint-order-001`/`002` (19) | `body { display: grid; height: 100vh }`, cells as body's children | The root's box is laid out in the page area |
| `page-name-siblings-005` | `<body style="page:a">` / `a` / `auto` / `b` | The root's `page` names page one and is what `auto` means below it |
| `root-element-display-none` | `html { display: none }`, decorated `@page` | No root box: one blank, undecorated page |
| `root-margin-001` | `html { margin-top: 10in }` | The root's margin is on page 1. Not claimed (§3.7) |
| `basic-pagination-003`, `page-left-right-001`/`002`, `page-size-016`/`017`, `paint-order-003` | `body { background: yellow }` with page margins | The root background fills the page box's border box, not its margins |
| `page-background-001`–`005`, `page-background-image` | positioned and repeated root backgrounds across forced breaks | One background, positioned against the whole root and cut across pages |
| `page-box-000`–`011` | `@page { background }`, `@page :first { … }`, border, padding | The page background covers the whole page box |
| `page-margin-auto*` (3) | `@page { margin: auto }`, `body { background }` | Canvas plus `auto` page margins |

css-page-3 §3.1, which the tests follow to the pixel:

> The document canvas background is drawn as the page box's background: by
> default its background painting area covers the page box's border box […].
> It remains, however, positioned with respect to the root element or page
> area as usual.

### 3.2 What the engine did

`composePage` cloned the source root's children into `folio-content` or the
measuring box, inside the frame's bare `<html><body>`. Type selectors and
inheritance worked (`body { font }`, `html { font-size: 62.5% }`, `:root {
--x }`); everything else was lost: classes, `style` and `lang` on the root,
its box (`display`, `margin`, `padding`, `border`), and with a source root
like `#doc`, every rule on `#doc` itself. `html { display: none }` removed
everything, and `body { background }` painted the host everywhere.

### 3.3 The model: the page area holds the root

Every page and every measuring box composes the **root chain**: a shallow
clone of each element from `document.documentElement` to the source root,
nested, with the page's slice inside the innermost.

```
folio-content
└── folio-root       ← a plain block; font-size: medium
    └── html'          ← <html lang class style>, data-folio-root
        └── body'      ← <body class style>
            └── main'  ← any elements between body and the source root
                └── #doc'  ← data-folio-source-root; the walk starts here
                    └── … the page's slice
```

- **They are clones like any other**, marked `data-folio-chain`, so
  `SPLIT_FROM`/`SPLIT_TO` and `fragments.ts` slice their borders, truncate
  their margins and suppress their pseudo-elements as for any split element.
  Nothing in the chain is stamped with a source path; `Position` is still
  relative to the source root.
- **Real `html` and `body` elements**, so `body.book`, `html[lang=de]`,
  `html > body` and `#doc p` match with no rewriting.
- **The frame's own `html` and `body` stay**, matching the author's rules,
  because `rem` and `:root`'s custom properties need them. Their box
  properties are pinned inline and `!important` (`createEngineFrame`).
- **Relative font sizes apply once.** `folio-root` resets `font-size` to
  `medium`; without it, `html { font-size: 62.5% }` and `body { font-size:
  1.1em }` gave 7.5625px where a real document gives 11px.
- **`:root`** is rewritten in stage 1 to `:is(:root, [data-folio-root])`,
  so its box properties reach `html'` too.
- **Paginating an element, not `body`**, what is above it is the
  application's layout (an offscreen holder, a grid shell with a sidebar).
  It passes on only what it inherits (`BOX_PINS`, `furniture.ts`); the
  source root keeps its own box. Paginating `body`, the chain is honoured in
  full.

### 3.4 Painting

Three layers in §3.1's order — page background, canvas, page border — then
contents and margin boxes. None can move a break; they run after
pagination, on the pages only (`page-paint.ts`).

#### 3.4.1 The page background

`@page { background }` goes on the page box, margins included, cascaded like
the rest of the page. It is a layer whose border and padding stand for the
page's margins, border and padding, so `background-origin` works.

#### 3.4.2 The canvas

The root's background, propagated (css-backgrounds-3 §2.11.2): `html'`'s,
or `body'`'s if that is `none` and transparent. The source element's own
background is made transparent so it does not paint twice.

"Positioned with respect to the root element" means against the root's
*whole* box, as if never cut. Building it corrected the design three times:

- **A root fragment that continues fills its page.** Page *n*'s image is
  shifted up by the page areas before it, not by the text's height on them.
  With the text height, `page-background-001`'s `no-repeat` cat was cut after
  one line.
- **Positioning and painting are two boxes.** The layer's *padding box* is
  the root's whole box, and a transparent *border* reaches the rest of the
  page: `background-origin: padding-box` positions, `background-clip:
  border-box` paints.
- **The canvas is the page box's last child** at `z-index: -1`, not inside
  the content area, so a margin box at `z-index: -1` paints beneath it
  (`paint-order-003`), and it does not head the first-child margin chain.

The page box is white paper where nothing paints it (`:where(folio-page)`).
The root is measured as CSS has it (`rootBox`): its margins do not collapse,
but `html'`'s would.

#### 3.4.3 The page box's border and padding

`@page { border; padding }` make the area smaller and so can move a break.
`css/page-box.ts` resolves margins, border and padding to numbers,
percentages of the page box on their own axis, and `contentArea` takes all
three out. The content area has the border and padding as its margins in the
grid cell; the border is a layer drawn at the widths the area took. Set
`background-clip` after anything built through `cssText`: Chromium
serializes `background: … padding-box`, and that keyword is the clip too.

### 3.5 What it cost

Almost nothing in the fragmenter: **4 lines**, to 1,859, for where the walk
starts, the first box, the source mapping, and a grid or flex source root
with no gaps between its children. The rest is composition, stage 1 and
`page-paint.ts`.

### 3.6 Decisions

**1. The UA's `body { margin: 8px }`.** With `body'` on the page, the UA
margin is back, as CSS says. Paged.js has none, and no corpus fixture sets a
body margin.

| Option | WPT | Corpus against Paged.js |
| --- | --- | --- |
| (a) Keep it: CSS as written | Right | Counts move |
| (b) An engine `:where(body) { margin: 0 }` at UA strength | As before | Unchanged |

(b) was recommended and built, then **reversed the same day to (a)**: the
margin is on the page. The corpus runner had injected its own `body { margin:
0 }`, which hid the change entirely; a harness never styles the author's
`body`. What moved:

- **WPT:** +8 on each engine, to 153/235 and 143/235.
- **Corpus:** 26 fixtures gained pages. Chromium's print agrees with the new
  count in 19; five are side breaks, where Chromium prints no blank pages;
  two are footnotes, which Chromium cannot print.
- **Same page count as Paged.js** fell from 111/122 to 88/122. That is the
  price of (a).
- **M5's exit check still holds**: polyfill and library agree on all 122.

**2. The budget.** Take §2.5's move rather than raise the budget twice in two
days. Taken, as a commit with no behaviour change: the fragmenter went to
1,855 of 2,100, the corpus identical page for page on both engines.

### 3.7 Left out, and risks

- **`root-margin-001`**: Chromium breaks *inside* the root's 10in margin.
  That is content taller than a page (§4).
- **`html, body { height: 100% }` does not reach the page.** `folio-root`
  must be a plain block: given the page's height, a top margin collapses up
  through it and off the page (78 corpus overflows); made `flow-root`, the
  last block's bottom margin counts as used (up to seven extra pages). A
  percentage height below the root resolves against its `auto` height.
- **Counters.** The chain is on every page as continuations, so a
  continued `body'` carries its reset back as the carried value, and the
  root's ancestors are no longer pre-counted before page 1. The frame's
  `html` and `body` have their counter properties pinned too. Equation
  numbering skips a continuation's `counter-reset` the same way.
- **No `::first-line`/`::first-letter` on continued elements**, chain
  included: the pseudo box moved the first line's glyphs a pixel. An
  author's `body::first-letter` would show on each page's first letter.
- **`querySelectorAll("body")` finds one per page** (a row in `compat.md`).
- **The page context** inherits from the frame's root, so `:root`'s custom
  properties reach margin boxes, but `html`'s class-selected rules do not.

### 3.8 Outcome

**WPT, engine loaded:** 94 → 109/235 on Chromium, 96 → 108/235 on Firefox,
nothing that passed failing; after §3.4.3, **115 and 114**. The root-box
group is closed as a design question. **Corpus:** page counts and content
identical on both engines, polyfill 122/122. Seven fixtures fill their pages
differently, all CSS as written: a percentage height below `body`, or `body
{ padding }` now on every page.

`html { display: none }` leaves the page undecorated and empty, as Chromium
prints it. Firefox found two bugs in the host guard: the frame hangs off the
host's `<html>`, and Firefox gives a hidden frame no layout, so the guard
runs *before* the frame exists; and as an inline style it was copied onto
`html'`. It is a rule, `:root, :root > body { display: block !important }`.

---

## 4. Content taller than a page

**Implemented 2026-09-24.** No new decision: the break is a new kind of
candidate, the rest is composition. WPT's largest failing group, 37 tests.

**Verdict.** The engine could end a page only *between* things. A box taller
than the space left with nothing inside to break between overflowed, and
what followed came pages too early. Chromium ends the page *inside* it, in
two cases:

1. **Its own extent crosses the page**, a `height: 400vh` block whose text
   ended near its top: CSS Break 3 §4.4's class C break.
2. **It is monolithic** (an image, `contain: size`). Chromium moves it to the
   next page if anything precedes it; if not, it lays it out whole, lets it
   run on across the pages below, and places what follows where its height
   puts it.

### 4.1 What the tests say

Most of the group failed on the *reference*, which is case 1; the test is
case 2.

| Tests | Content, reduced | Needs |
| --- | --- | --- |
| `monolithic-overflow-002`–`013`, `-018`, `-021`, `-022` | A 250–350vh `contain: size` box in a block, flex, grid, table, float or abspos box | Both cases. Claimed |
| `-014`, `-015` | The same box as an `inline-block` | A slice inside a line. Not claimed |
| `-016`, `-017`, `-023` | Tall content in a table with repeated parts | Not claimed |
| `-019` | A 50vh parent with a 350vh child | Overflow past the parent. Not claimed |
| `-026`–`-029`, `-031`, `-032` | A fixed-height box continued around the slice | §4.7, §4.8 |
| `-024`, `-025`, `-030`, `-020` | Line-level, fixed-position and float content | Other features |

### 4.2 The model: a position inside a box

`Position` gains `slice`: pixels into the border box of the element at
`path`. A slice sorts after the box's start and content and before its
`after` position. `chunk.ts` needs nothing: a chunk that starts at a slice
starts at the box.

### 4.3 Where the page ends inside a box

`enumerateCandidates` takes the page's `limit` and offers a `slice`
candidate at exactly the limit, for a child crossing it, when:

- **it is monolithic** (replaced, `contain: size`/`strict`, or a continued
  slice), at `PENALTIES.sliceMonolithic`, more than a page's worth of waste,
  so a break before the box always wins and the slice is taken only when
  the box starts the page; or
- **its content has ended and it is taller than what it holds** by more than
  half a line. Glyph boxes end a few pixels above the line box; without
  that margin a paragraph was sliced and printed twice.

Only stacked boxes are sliced for their extent: a table cell or flex item
stretched beside a taller one shares its row (`tables/rebuild` gained a page
otherwise). Nothing is sliced below an ancestor that clips, nor across an
orthogonal flow. Monolithic content is atomic to the walk, as MathML is.

### 4.4 Composing a slice

The box is cloned **whole** on every page it crosses (`showSlice`), marked
`data-folio-sliced`:

- **A page that starts inside it** gives it a negative `margin-block-start`.
  It collapses up through the continued boxes around it, and the content
  area clips above its top. The clone is also `data-folio-repeated`, so
  the content check and counters treat it as a repeated table header.
- **A page that ends inside it** cuts it by its own `block-size`, with the
  block axis's overflow clipped and no end border, padding or margin. An
  image keeps its scale and shows its top. A negative bottom margin would
  collapse through the split ancestors and leave them full height.

All inline and `!important`, to beat the fragment rules. A `flow-root`
wrapper was rejected: it changes `parent > child` selectors, and the
measuring box would not have it.

### 4.5 What was left out

- **A continued ancestor with a fixed height** — taken in §4.7.
- **A slice inside a line**: an `inline-block` taller than the page.
- **Overflow past a box's end**, into pages its box never reaches (`-019`).
- **A slice at a reduced limit**: with footnotes, the slice stays at the
  original limit and no longer fits, so the page falls back to an earlier
  break.

Each is within the owner's 2026-09-25 decision that a page carries one break
position: documented limits, not bugs.

### 4.6 Outcome

The fragmenter grew from 1,859 to 1,950, mostly in `candidates.ts`. The
corpus is identical page for page. WPT's monolithic family went from 1 of 32
to 16 on Chromium and 7 on Firefox (a font). Slices are not offered in
vertical writing (§5 later made them follow the flow). `page-content.spec.ts`
had a 100vh block staying whole on the next page; Chromium splits it.

### 4.7 Split boxes with a set height

**Approved 2026-09-24**, the budget raised from 2,100 to 2,300 rather than
code moved. CSS Break 3 gives a box's fragments one block size between them.

- **Carried:** `Position.consumed`, per split box by source path, what its
  border box used on the pages so far. It is in the start, so a page is
  still `(spec, start)`; `comparePositions` ignores it.
- **Applied:** `sizeFragments` (`extents.ts`), after `finishFragments`, on
  the measuring box and the page. A split box whose height is not its
  content's gets the rest of its height and, on a page it continues past, is
  cut at the page's end. "Not its content's" is measured (whole against
  `block-size: auto`); a computed height cannot say.
- **A slice's shift** puts part of a box above the page. That part is the
  earlier pages', not used here; counting it lost `-004` a page.

The fragmenter took 12 lines. `-031` has the right page count; the family
stays at 16 of 32.

### 4.8 Absolute boxes, ink, and the page's foot

- **Monolithic content is sliced as far as its ink goes.** A `contain: size`
  box whose child overflows it is sliced while the ink crosses the page
  (`inkEnd`), unless the box clips. `usedHeight` counts a sliced clone's
  overflowing ink, or a page of only ink "fits" and ends the document.
- **An out-of-flow monolithic box is sliced like an in-flow one**, its static
  position the page's top. One placed by `top` against the initial
  containing block is not: that needs unfragmented coordinates on every
  page (`-029`).
- **Stacking reads in-flow ink; a break's extent leaves out absolute boxes**,
  which are sliced on their own.
- **A split box reaches the page's foot** (`fillFragments`), as Chromium
  prints it. It runs after the page is kept and moves no break.
- **The note area sits at the page's foot** (`lowerFootnoteArea`), as GCPM
  and Paged.js have it. Both stay after the overflow checks; run earlier, a
  stretched fragment looks too tall.

---

## 5. Vertical writing

**Approved and built 2026-09-25.** WPT's group of 18 tests.

**Verdict.** The engine was built for this and had not finished it. The
measurer already mapped physical rectangles to logical ones (`mappingFor`,
`dom-measurer.ts`), and the fragmenter asks only for block-start and
inline-end. What was missing was everything around the measurer that read or
set physical geometry. No fragmenter decision changes.

### 5.1 What the tests say

| Tests | Content, reduced | Needs |
| --- | --- | --- |
| `css-break/block-00{1,2}-wm-v{rl,lr}` (4) | A vertical root, a block 210vw long | Pages cut along x, right to left in `vertical-rl` |
| `body-background-{s,v}{lr,rl}` (4) | A vertical root, a body gradient | The canvas cut in the block axis |
| `page-size-012`, `page-box-008`/`009` | Logical `@page` margins and padding, `100vb` | Logical sides in the right writing mode |
| `margin-boxes/dimensions-013`/`014` | Margin boxes in a vertical root | The page box sized physically |
| `page-name-orthogonal-writing-*` (3) | Named pages on orthogonal children | An orthogonal flow is one box. Not claimed |
| `page-margin-002`/`003` | Full-viewport blocks in a vertical root | Pages cut along x |

### 5.2 The model

The page box stays physical: its size, its margin tracks, its margin boxes.
What holds the flow — the content area and the measuring box — takes the
root's `writing-mode` and `direction` (`flow.ts`), so every `Rect` from
`domMeasurer` is logical and candidates, `select.ts`, slices and extents are
unchanged. The area's two sizes are swapped once, where `paginate.ts` reads
them.

### 5.3 What became logical

| Where | Was | Became |
| --- | --- | --- |
| Measuring box, content area | no writing mode | the root's |
| Page box and sheet (`page-template.ts`) | `inline-size`, `block-size` | `width`, `height`, `horizontal-tb` |
| `usedHeight`, `extents.ts`, `fillFragments` | heights and tops | block sizes and block-starts |
| Clip of a page starting in a slice; `showSlice` | the top; `overflow-y` | the block-start side; the block axis |
| `page-box.ts` | horizontal sides | `@page`'s own writing mode, else the root's |
| `css/viewport.ts` | `vi`, `vb` horizontal | variables of their own, set from the flow |
| `sideOf` | the root's direction | the block direction: page 1 of `vertical-rl` is a left page |
| `candidates.ts` | no slices in vertical writing | no slices across an orthogonal flow |

Anything that reads a page's size reads `style.width` and `style.height`.

### 5.4 Not claimed

Orthogonal flows inside the document are one box to the page: no candidates
inside, forced or not, and no page names from them, as in Chromium. The
canvas is claimed only as far as its pieces follow the block axis.

### 5.5 Outcome

The group went from 18 failing tests to 4 on both engines (181/235 and
172/235). The corpus, all horizontal, is identical byte for byte. The
fragmenter took 49 lines, to 2,111. Building it found:

- **`@page` has a writing mode of its own** (`page-box-009`).
- **A `style` attribute is rewritten where the flow is not known**, so `vi`
  and `vb` are variables, not a rewrite parameter.
- **The canvas's pieces lie along x**, side by side.
- **A slice charged its ancestors' `break-inside: avoid` and not its own**,
  in horizontal writing too.
- **Pagination hung** on a page measured absurdly long for its text: the
  chunk has a floor (`MIN_CHUNK`).

The test runner clipped shots at the document's left edge, wrong in a
vertical host, and now shoots in a horizontal one. Margin boxes were taken
the same day: they inherit the root's flow, and `authoredOf` reads their
logical declarations as the physical ones they mean. `dimensions-013`/`014`
pass on Chromium. The rest is in `wpt-failures.md`.

---

## 6. `footnote-policy` and note splitting

**Implemented 2026-09-25.**

**Verdict.** `line` and `block` were right: a note that does not fit moves
the break above its call's line or block. `auto` did the same, with a 70%
cap. GCPM 3 lets `auto` keep the call in place and split the note's body
across pages, as Paged.js does. And `@page { @footnote { … } }` was parsed
and dropped.

### 6.1 The rules

- **`auto`** (initial). Notes fill the area to its maximum height in call
  order. The note that does not fit is split after its last fitting line;
  its tail and every later note go to the top of the next page's area,
  before that page's own. Continuations have no marker.
- **`line`, `block`.** The break moves above the call's line or block, the
  note whole with it.
- **`@footnote`** declarations apply to the note area of the pages the rule
  matches, cascaded like a margin box's. `max-height` is the cap, a
  percentage of the page area's block size; it is not applied as a style,
  because the area is split, not clipped. Without it the cap is 70%, or a
  page could be all notes and the text never advance.
- **The document's end.** Notes still carried when the text runs out get
  pages of their own, split again if needed, their area uncapped unless
  `@footnote` says otherwise.

### 6.2 Splitting a note

A note is laid out in a holder shaped like the area and split after line
*k*, the last for which the area fits (`offsetAtLine`). `splitAt` cuts its
DOM at a character offset: the head keeps the marker and everything before,
the tail the rest, so nothing is repeated or lost. A note whose first line
does not fit goes whole to the next page.

### 6.3 Where it lives, and the bisected break

`footnotes.ts`: `fillArea` fills one area, `splitToFit` finds the line,
`splitAt` cuts. `paginate.ts` carries the note list from page to page;
`pages.ts` adds notes-only pages (`addNotePages`).

**A page's break is bisected, not iterated.** The old fixed point reserved
room for a note, moved the break above its call, and kept the room. Now a
page is its text plus the notes called in it, both growing as the break
moves down, so the breaks that fit are a prefix of the candidates and the
last is found by bisection: about ten note measurements a page. The policy
enters through "the notes called in it": for `auto`, a note that does not
fit whole costs the area its cap; `line` makes every break after its call's
line infeasible; `block` counts a note from its block's top
(`footnotesBefore`). `ceilingForNotes` is gone.

### 6.4 Outcome

The corpus pages as before; no corpus note is long enough to split, and
`@footnote` rules now apply as Paged.js applies them. `footnote-split.spec.ts`
splits, caps and ends with notes-only pages on both engines.

**A bug older than this work:** a line break's offset was counted in the
measuring box, where each note is its call, and looked up in the source,
where the note is text. Every earlier note moved the break earlier,
sometimes into a note, which was then cut and numbered twice:
`notes/footnotes` placed 25 of 22. The offset is counted outside notes on
both sides: the call names its note (`OUT_OF_FLOW`), and `textNodeAt` skips
it. The corpus runner now checks each fixture places the notes its source
has.

---

## 7. Page floats

**Built 2026-09-25.**

**Verdict.** A page float is a note area at the other end of the page. It
leaves the flow at its anchor, takes space from its anchor's page, and waits
when it does not fit; unlike a note, it is never split. §6.3's bisection
gains a second term in its sum and nothing else in the fragmenter changes.
`plan.md` §4 files it as P (browsers drop `float: top`, so a carrier holds
it) and F (only the fragmenter knows the anchor's page).

### 7.1 What is claimed

| Property | Claimed | Not claimed |
| --- | --- | --- |
| `float` | `top`, `bottom`, `block-start`, `block-end`, `snap-block` | `snap-inline`, `left`/`right` and `inline-*` as page floats |
| `float-reference` | `page`; `column` and `region` read as `page` | `inline` |
| `float-defer` | a positive integer | `last`, negative counts |

With the initial `float-reference: inline` the engine leaves the element to
the browser, which ignores `float: top`; authors write `float-reference:
page`. `top` and `bottom` mean the flow's block-start and block-end in every
writing mode. `snap-block` goes to the edge nearer its anchor. Start-edge
floats on a page that begins inside a slice (§4) are unchecked.

### 7.2 The rules

- **Order.** Each edge holds its floats in document order, the first
  nearest the edge. A float is never placed before an earlier deferred one.
- **Fit.** A float goes on its anchor's page if it fits beside the text up
  to its anchor, the floats already placed and the notes. If not, it and
  every later float wait for the next page, placed before that page's own.
  A float alone on an otherwise empty page is placed even if too tall.
- **`float-defer: n`** holds it back `n` pages past its anchor's.
- **The document's end.** Floats still waiting get pages of their own,
  floats first, then notes.
- **Margins** are kept and do not collapse: each edge is a block of its own.
- **Inheritance** from ancestors is lost, as a note's is; the float's own
  rules still match its clone.

### 7.3 Where it lives

`page-floats.ts`, outside the fragmenter budget. Extraction leaves an empty
`folio-float-anchor` carrying both the float's source stamp and
`OUT_OF_FLOW`, so breaks before it and line offsets past it both map to the
source. `planFloats` marks a prefix of the queue for the page, and the
bisection's `reserve(extent)` adds the marked floats anchored above
`extent`; anchors are in document order, so the sum stays monotonic.
`takeFloats` places them on the composed page as
`folio-page-floats[data-edge=start|end]`, and the recompose loop measures
the page. The slack below the text goes above the end floats and the note
area together.

### 7.4 Deletion condition

When a browser paginates with page floats natively, which none does.
`CSS.supports("float-reference", "page")` could pass without that, so the
condition is recorded as never detected.

### 7.5 Outcome

The corpus (whose `float: bottom` is in `@footnote` rules) and WPT are
identical byte for byte. `page-floats.spec.ts` tests each rule of §7.2 on
both engines. The fragmenter took 19 lines, to 2,157. One trap:
`getComputedStyle` is live, so read after the element left the document,
`float-defer` was empty and every float went on its anchor's page.

---

## 8. `::nth-fragment()` on rung P+

**Built 2026-09-25.**

**Verdict.** `plan.md` §6 puts `::nth-fragment` on rung P+: stamp fragments,
rewrite the selector to match the stamp, let the browser cascade. It warns
that a stamp changing a size forces a re-layout. That cost does not arise: a
fragment's index is known *before* its page is measured, so the measuring
box and the page carry the same stamps. No second pass.

### 8.1 What the selector means

`::nth-fragment(an+b)` selects the *n*th fragment box of an element: one on
pages 3, 4 and 5 has fragments 1, 2 and 3; one whole on a page has one. A
sliced box (§4) has one more fragment per later page. `odd`, `even` and every
*an+b* form are accepted.

```css
p::nth-fragment(1) { text-indent: 1.5em }   /* not on a continuation */
table::nth-fragment(n+2) { margin-top: 0 }  /* every continued table */
```

### 8.2 Why the index is known in advance

A page starting at `start` begins inside exactly the ancestors of `start`,
which composition marks `SPLIT_FROM` (or `data-folio-repeated` for a
slice). Everything else on it is fragment 1. A continued element's index is
one more than on the page before; `paginate.ts` keeps that map by source path.
Past the break the box shows fragment 1 of an element whose next part is
fragment 2, but nothing past the break decides anything.

### 8.3 The rewrite

Stage 1 replaces `::nth-fragment(ARG)` with
`:where([data-folio-nth~="ARG"]):is(*, folio-nth)`, `ARG` normalized
(`odd` is `2n+1`). The `:where` matches without weight and the `:is` weighs
one type selector, as a pseudo-element does; cascade, `@layer` and
`!important` stay the browser's. The engine reads the formulas back out of
the frame's sheets, so nothing new is passed to `paginate`, and
`finishFragments` stamps each clone with those its index satisfies. A
document without the selector stamps nothing.

### 8.4 Not claimed, and deletion

Inheritance into children is the element's, as with any pseudo-element.
Structural selectors, which match clones, stay deferred. `::nth-fragment`
cannot be inside `:not()` or `:has()`. Deletion: when
`CSS.supports("selector(p::nth-fragment(1))")` is true and the browser
paginates; the first half is the recorded native test.

### 8.5 Outcome

Corpus and WPT identical byte for byte. The fragmenter took 4 lines for the
index state, to 2,161. `nth-fragment.spec.ts` holds the test §8.2 rests on:
continuations set at 8px on 10px lines hold twice the lines. Stamped on the
page only, the box measures them at 16px and gives five pages instead of
three. A fragment that *grows* is no such test — a page too tall is caught by
the recompose loop — but a page too short never is. Writing it found that a
page after a `<br>` began with the `<br>` and held a line fewer than fits,
fixed separately (`line-breaks.spec.ts`).
