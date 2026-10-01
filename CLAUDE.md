# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

`folio` — a client-side paged-media engine: a Paged.js successor with the
same feature surface, a smaller codebase, and mathematics treated as a layout
problem rather than a plugin. The design documents came first and are still the
source of truth; there is now a working engine under them.

**Status: M0–M5 complete.** The engine paginates with margin boxes, page
counters, named and blank pages, running heads, cross-page references,
footnotes and split tables, and it breaks display equations on the inline axis
by the same selector that breaks pages, numbers them, and resolves
`target-counter(#eq, equation)` against those numbers. M3's exit check — the
judgement, not a number — was walked fixture by fixture and is written up in
`doc/differential.md`. M1's last exit item — the recorded performance budget —
and M2's three unfinished rows — custom counters across pages, `@media print`,
bleed and crop marks — are paid. M5 ships the Paged.js compatibility layer and
the viewer; its exit check is that **all 122 corpus fixtures paginate with
nothing changed but the script tag, to the same page counts the library API
produces** (`node packages/test/polyfill-corpus.mjs`). **M6, beyond parity,
is a list of independent items** rather than a block of work, and
`doc/milestones.md` has the table. As of 2026-09-25 every item on it is done,
deferred by the owner's decision, or a documented limit, and on 2026-10-01
the owner closed M6 for now. The last three
built were `footnote-policy` with note splitting, page floats and
`::nth-fragment`; the math drop-in, math with no pages, was added after.

**M6 so far: `box-decoration-break`, `margin-break` and `leader()`**, none of
which cost the fragmenter a line. The first two live in `src/fragments.ts`,
which now owns every rule about what a *fragment* of an element looks like —
the first-child margin chain moved there from `page-template.ts` — and
`finishFragments(box, source)` is what `paginate.ts` calls after every
`composePage`, on the measuring box and on the page alike. Call that, never
`repeatTableParts` alone: a rule applied to one and not the other is a break
chosen against a page that will not exist. `leader()` is `src/leaders.ts`,
rewritten to `attr()` beside `target-counter()` and filled at the end of
`applyReferences`. Three things from that work worth carrying:

- **A composed fragment is a whole clone to the browser**, with both borders,
  both paddings, its `::before` *and* `::after`, its marker and its first-line
  indent. Six things were wrong because of it, including a split `<ol>` that
  restarted at 1 on both engines; `doc/milestones.md` M6 lists them.
- **The first-child margin chain stops where margins stop collapsing.**
  Below a `flow-root`, a flex or grid box, a clip, or a top border or padding
  on this page, a first child's margin does not adjoin the break. So
  `stampMarginBreak` stamps the rest of the chain `keep` (`seals`,
  `fragments.ts`). WPT `page-margin-007`'s reference lost its 50px margins
  without this.
- **An engine rule the author cannot see must be `!important`.** The margin
  chain was specificity (0,3,0), so `#chapter p { margin-top }` beat it and the
  margin at the top of every continued page came back — since M1.5.
- **`list-item` is not a counter `counters.ts` can carry.** No engine reports
  its implicit increments, and Chromium does not report the list's implicit
  reset either. A continued list is numbered by its `start` attribute.

**Footnotes split across pages** (`doc/review.md` §6). An `auto`
note that does not fit is cut after its last fitting line (`fillArea`,
`splitAt`, `footnotes.ts`). Its tail and the notes after it are carried to
the top of the next page's area, and notes-only pages end the document if
the text runs out first (`addNotePages`). `@page { @footnote {} }` styles
the area, and its `max-height` is the cap; without one the cap is 70%. Two
things came with it, easy to undo:

- **A page's break is bisected, not iterated.** Text and the notes called
  above the break both grow as it moves down, so the breaks that fit are a
  prefix of the candidates. The old fixed point reserved room for a note,
  moved the break above its call, and kept the room. `footnote-policy:
  block` counts a note from its block's top (`footnotesBefore`).
- **A break's offset is counted outside notes.** The measuring box has a
  call, a number, where the source has the note's text. Counted as text,
  every note before a break moved it earlier, into a note, which was then
  numbered twice: `notes/footnotes` placed 25 of 22. The call names its note
  (`OUT_OF_FLOW`). The corpus runner now checks that each fixture places the
  notes its source has; its content check leaves note areas out.

**Page floats are a note area at the other end** (`doc/review.md` §7).
`float: top | bottom | snap-block` with `float-reference: page` leaves an
anchor in the flow and goes to an edge block of its anchor's page, or waits
whole for a later one (`page-floats.ts`). With the initial `float-reference:
inline`, the engine leaves `float: top` to the browser, which ignores it.
The bisection's `reserve` adds the planned floats anchored above the break,
so nothing about the break changes but its sum. An anchor carries both the
float's source stamp and `OUT_OF_FLOW`, so breaks before it and line offsets
past it both map to the source.

**`::nth-fragment()` is rung P+ with no second pass** (`doc/review.md` §8).
Stage 1 rewrites `X::nth-fragment(an+b)` to
`X:where([data-folio-nth~="an+b"]):is(*, folio-nth)`, which weighs as a
pseudo-element does. The engine reads the formulas back out of the frame's
sheets, and `finishFragments` stamps each clone with those its fragment
index satisfies (`nth-fragment.ts`). The index is known before a page is
measured, because a page begins inside exactly the elements marked
`SPLIT_FROM`. So the measuring box carries the stamps too. Stamping the page
alone passes every test where a fragment grows, since the recompose loop
catches a page that is too tall. It fails the one where a fragment shrinks,
because nothing catches a page that is too short.

**The page area holds the root** (`doc/review.md` §3). Every page, and
every measuring box, is `folio-root > html' > body' > … > source'`, clones
marked `data-folio-chain`, continued and sliced like any split element;
the walk starts at the source root's clone (`sourceRootIn`). The frame's own
`html` and `body` still match the author's rules — `rem` and `:root`'s
custom properties need them to — but their box properties are pinned
(`createEngineFrame`), and `:root` is rewritten to match `html'` too. Four
things about it are easy to undo:

- **`folio-root` must be a plain block.** It resets `font-size` to
  `medium`, or `html { font-size: 62.5% }` applies twice (7.56px for 11px).
  Give it the page's height and a top margin collapses up through it and off
  the page (78 corpus overflows); make it `flow-root` and the last block's
  bottom margin counts as used (up to seven extra pages). So `html, body {
  height: 100% }` does not reach the page yet.
- **The UA's `body { margin: 8px }` is on the page**, as CSS says: the
  decision in `review.md` §3.6 to take it away was reversed. Chromium's
  print agrees with the new count in 17 of the 24 fixtures it moved from
  Paged.js's. Two traps came with it:
  - The corpus runner injected its own `body{margin:0}`, which hid the change
    completely. A harness never styles the author's `body`.
  - The root's margins do not collapse in CSS, but `html'`'s do. `flow-root`
    on it counted a bottom margin at every break (four corpus pages Chromium
    does not print), so `page-paint.ts` measures the root as CSS has it
    (`rootBox`) instead.
- **A continuation carries its reset**, in the counter walk and now in
  equation numbering: `body'` is continued on every page after the first.
- **No `::first-line`/`::first-letter` on the chain** (`fragments.ts`): the
  pseudo box moved the first line's glyphs a pixel on every continued page.
- **Paginating an element, not `body`, what is above it is the
  application's** and passes on only what it inherits (`BOX_PINS`).

The canvas (`page-paint.ts`) paints the root's background, propagated from
`html` or `body`, on each page area after the last page: a layer that is
the page box's last child at `z-index: -1`, holding a box whose padding box
is the root's *whole* box and whose transparent border reaches the rest of
the page, so positioning and tiling resolve as on the uncut root. A root
fragment that continues fills its page; the page box is white paper. The
host guard for `html { display: none }` is a `:root` rule set *before* the
frame exists: the frame hangs off the host's `<html>`, Firefox gives a
hidden frame no layout, and an inline style would be copied onto `html'`.

**The page box has a border and padding** (`css/page-box.ts`), resolved to
numbers in the page model and taken out of `contentArea`, so they move
breaks; percentage margins and padding are of the page box on their own
axis. The content area takes them as its margins inside the grid cell. The
page background is a layer whose border and padding stand for the page's
margins, border and padding, so `background-origin` works; the page's
border is a layer drawn at the widths the area took. Set
`background-clip` explicitly on anything built through `cssText`: Chromium
serializes `background: … padding-box`, and one box keyword there is the
clip as well as the origin.

**Margin-box geometry is css-page-3 §5.3 now, not a grid** (`src/margin-boxes.ts`).
The five-by-five grid gave each box on an edge a third of it; §5.3 gives a box
alone on its edge the whole edge, shares two boxes' space by their content and
keeps a middle box centred. `resolveEdge` and `resolveFixed` are the
arithmetic, pure and unit-tested with WPT's own worked numbers;
`layoutMarginBoxes` measures min- and max-content sizes for **every page at
once** in six passes, after `renderMarginBoxes` has filled them all, and
writes absolute geometry. Each edge and corner is an area that *is* the
boxes' containing block, so `20%` and `em` are the browser's to resolve. It
cannot move a break. Four things came with it, easy to undo:

- **Page-context lengths were silently dropped.** `@page { margin: 4em }` was
  not a length to `toPx` and became the default margin; `em`/`rem` are now
  resolved in stage 1 against the root's font size (`resolvePageFontUnits`),
  and `vw`/`vh` in `@page` *and in margin boxes* against the default page.
  `@page { width; height }` is the page area, margins outside it.
- **Margin boxes inherit from the page context**, not from the `body` the
  pages sit in: `marginBoxesFor` writes `@page`'s inherited properties onto
  each box, beneath its own.
- **Only the pages print.** `insertPrintCss` hides everything outside their
  ancestors, as the viewer does: a document paginated from an element left
  the emptied source in front of the pages, and Chromium printed it as a
  blank first sheet (`examples/report/`).
- **`counter(page)` is a counter** (`src/page-counters.ts`), not the page's
  index: `@page { counter-increment: page 2 }`, page-context counters that
  carry from page to page while a page-context *reset* lasts one page (WPT
  `content-012` settles that), and Paged.js's `main { counter-reset: page 1
  }`, which the walk reports as `pageReset` when the element *starts* on a
  page. `target-counter(…, page)` prints the same number: the fixed-point
  loop maps ids to `PageRecord.number` (`byNumber`), while `provides` stays
  an index because the viewer navigates by it. A margin box's `counter-*`
  are kept as data and counted by the engine — on the element, the browser
  would count them into the document's counters for every later page. The
  walk also counts the source root and its ancestors first: `html {
  counter-reset }` is on no page and every page is in its scope.
- **Page rules cascade by origin, layer, specificity, source order**, in
  one function (`matchingRules`, `page-model.ts`) that both `cascadeFor` and
  `marginBoxesFor` use. Margin boxes used to go by source order alone, so a
  later `@page { @top-left }` beat an earlier `@page :first { @top-left }`.
  `@page` inside `@layer` is found by `extractPageRules`, which opens
  `@layer` blocks and nothing else, and ranked by `compareLayers`: unlayered
  last, a layer's own rules after its sublayers.
- **Margin-box geometry needs the margin boxes' fonts before it measures.**
  `fonts.ready` resolves at once for a face nothing has used yet, and
  margin-box text is written after the last page. So `loadPageFonts`
  (`preview.ts`) asks for every family `@page` names before pagination. Also
  in `resolveEdge` and `layoutMarginBoxes`:
  - the middle box is sized against each doubled side and keeps the wider
    result;
  - an empty edge is shared in thirds;
  - a vertical side box has content sizes;
  - a percentage margin is of the area on its own axis.

  Each of these is a WPT `dimensions-*` test.

**WPT now runs with the engine loaded** (`wpt.mjs --folio`): 183/235
paginated reftests on Chromium, 172/235 on Firefox. The history is 181 and
172 before margin boxes in vertical writing; 167 and
158 before vertical writing; 162 and
152 before floats, page sides and media queries; 158 and
148 before absolute boxes across pages; 153 and 143 before auto and
negative page margins and the first page's viewport;
145 and 135 before the UA's body margin went on the page; 115 and 114 before slices,
margin-box fixes and `@layer`; 74 and 75 before margin-box
geometry and page counters; 51 and 53 before `doc/review.md` §2. Family
by family it is in `doc/native-support.md`, which also lists the six bugs the
first run found.
**`doc/wpt-failures.md` is the working list**: all 66 tests that fail on
either engine, grouped by cause, each group marked verified or presumed, with
where to start. Every one has a cause. Update
it when a run changes — a fix is not done until its tests move out of it.
Four things about it are easy to get wrong:

- **Our test matching our reference is not a pass.** Both can be wrong alike,
  and vertical-writing tests passed that way. Chromium's print of the reference
  (`page.pdf`) is the page-count oracle for every engine; keep it.
- **WPT's default page is 5in × 3in with 0.5in margins**, and it is the *user
  agent's* page: `Previewer({ pageDefaults })`, a `ua` page rule, which
  `size: landscape` alone rotates. As an author rule it is simply replaced.
- **The engine's elements are never `div` or `span`.** An author's `div { }`
  reached the page boxes and the measuring box. New furniture gets a
  `folio-*` name and an entry in `FURNITURE` (`src/furniture.ts`).
- **WPT contradicts itself in places.** `page-name-003` against
  `page-name-abspos-002`, and `page-name-zero-height-001` against
  `zero-height-page-break-001`: no rule passes both halves, and Chromium fails
  one of each natively. They are listed, not chased. Probe Chromium with
  `page.pdf` before deciding which half a rule should follow.

Where the corpus stands on Chromium, after that walk:

| Measure | Value |
| --- | --- |
| Fixtures paginated without error | 122/122 |
| §9 content property holds | 122/122 |
| Pages that overflow their area | 1 fixture (was 2) |
| Same page count as Paged.js | 88/122 since the UA's body margin (was 111, 110, 108, 81) |
| Fixtures where text is laid out off the page | ours 1, theirs 5 |

**The exit check found eleven bugs in this engine**, which is the useful part:
most of what looked like a difference of typographic opinion was us getting the
fragmentation model wrong. Three of them are worth carrying in your head
because they are easy to reintroduce:

- **A margin adjoining a break does not have to fit.** Candidates measure to
  where the ink stops, not to where the next box starts, and the "does the rest
  fit" test measures the ink too. Checked on both engines: in a column exactly
  two lines tall the second line stays put whether the trailing margin is 0, 18
  or 40px.
- **Margins at the top of a continued page are truncated down the whole chain
  of first children**, not just the outermost box, because they collapse.
- **A named page or a `break-before` can change on a *first child*.** Sibling
  comparison cannot see either; the walk carries the current page name in
  document order, and CSS Break 3 §4.2 propagates a first child's break to its
  parent.

The 34 differences that remain are classified in `doc/differential.md`:

- 24 are the UA's body margin. Paged.js has none, and Chromium's print
  agrees with us in 17 of them. Six are side breaks, where Chromium prints
  no blank pages, and one is footnotes.
- Two are Paged.js laying text outside the page.
- Seven are the two engines disagreeing about how full a page should be
  (nothing lost on either side, ours fuller).
- One is ours: the 70% default cap on the footnote area, which Paged.js
  does not have.

**Five bugs about inline content, three found by `examples/report/`**, each easy to
reintroduce:

- **A line is grouped by its middle, not its top** (`groupIntoLines`). A
  superscript, a subscript or a `<math>` box starts 4–8px from the text
  around it, so grouping by top edge counted a two-line paragraph with a
  formula as three or four lines, and widows and orphans were judged by that.
- **Inline `<math>` computes to `display: math` in Chromium and `inline` in
  Firefox; MathML children to `block math` or `inline`.** Read by display,
  inline math made its paragraph "blocks and loose text", with free breaks
  between them and none of the line candidates. Anything that must recognise
  MathML goes by namespace (`MATHML_NS`), never by `display`.
- **Text no element holds has lines too** (`appendRunCandidates`,
  `candidates.ts`): text directly in the source root, and loose text beside
  blocks. Each line break is a position *in the text node*, not an offset
  into an element. `textInSource` maps it back to the source with the page's
  start, because the first text node of a continued page is a suffix of the
  source's. Before, such text was one unbreakable item, and a page of nothing
  but text overflowed.
- **A page after a `<br>` starts at the next line's text** (`textNodeAt`).
  The offset of a line ended by `<br>` is also the end of the text before
  it. Taken literally, the next page began with the `<br>`, an empty line,
  and every continued page held one line fewer than fits. Only `<br>` and
  `<wbr>` are skipped: an image that begins the line is the line's.
- **MathML is one box to the page** (`atomicMath` in `candidates.ts`), bar the
  rows of an equation `math/compose.ts` broke. The walk offered a free break
  between a fraction's numerator and denominator. And a chunk never ends
  inside a formula (`chunk.ts`), or the measuring box holds half a fraction —
  which Firefox reports as "Incorrect number of children for <mfrac/>".

`issues/duplicate-headers` was the third of those and was a real bug: the
measuring box has running elements taken out before candidates are enumerated,
and the *composed page* did not, so `paginate` measured a page with the running
head still in it, found it too tall, and took a tighter break to make room for
something that would not be there. A break at 630px of a 643px area fell back
to 547 and every chapter ended with a 65px page of its own. The last-page path
had always removed them before measuring; the ordinary path had not.

The remaining overflow is `infinite-loop`: a 172px paragraph on a 76px page
with one candidate, which nothing can split, and where Paged.js loses the same
line by the same 141px.

Still owed:

- `position: fixed`, which is not in the feature map, and is **deferred by the
  owner's decision** (2026-09-25): not urgent, so leave it and its 15 WPT
  tests alone until asked;
- a table row taller than a page. Slices skip table-internal boxes. Also
  **deferred by the owner's decision** (2026-10-01).

Owner decisions (2026-09-25) keep work out of scope; don't take it up
unasked:

- **A page carries one break position**, `(spec, start)`. Line slices, an
  absolute box fragmented beside the text, a float's margin carried as
  clearance, and overflow past a smaller parent are documented limits, not
  bugs to chase.
- **Structural selectors** (`:nth-child`, `+`, `~`) match a page's clones,
  as in Paged.js. Deferred, like `position: fixed`.
- **Multicol inside pages** is deferred too. M0.3 stands, and the spike is
  not re-run unasked.
- **Lines are measured by their ink, not their line box, and that stays.**
  Firefox makes a 16px serif glyph box 22px tall on a 20px line, so a line
  that fits a page exactly by its line box ends 1px past it and goes to the
  next page. Chromium's glyph box fits inside the line. This is a
  per-engine fact, and not a bug to fix (owner, 2026-09-25).

**Vertical writing is built** (`doc/review.md` §5). Four things about
it are easy to undo:

- **The flow is the root's, on the boxes that hold it.** The content area
  and the measuring box take the root's `writing-mode` and `direction`
  (`flow.ts`), and `domMeasurer` then returns logical rectangles. The page
  box, the sheet and the viewer's holders stay physical: `width` and
  `height`, `writing-mode: horizontal-tb`. In a vertical host,
  `inline-size` turned the page. Anything that reads a page's size reads
  `style.width` and `style.height`.
- **Nothing outside the measurer reads top or height for the flow.**
  `usedHeight`, `pageEnd`, `extents.ts`, the slice clip (`clipBefore`) and
  `showSlice` (`overflow-block`) are all logical. The frame and the
  viewport variables are physical, since `vw` is a width. `vi` and `vb`
  have variables of their own, set from the flow, because a `style`
  attribute is rewritten where the flow is not known.
- **Logical page sides follow `@page`'s own `writing-mode`** where it sets
  one, and the root's otherwise. Pages progress along the block direction
  in vertical writing, so page 1 of `vertical-rl` is a left page.
- **An orthogonal flow is one box to the page**: no candidates inside it,
  forced or not, and no page names from it, as in Chromium.
- **Margin boxes inherit the root's flow** (`renderPageTemplate`'s `flow`),
  since the page box they sit in is `horizontal-tb`. `authoredOf` reads a
  box's logical declarations (`block-size`, `margin-block-*`) as the
  physical ones they mean in its writing mode. CSSOM keeps them apart, and
  the geometry reads only physical names.

**A chunk has a floor** (`MIN_CHUNK`). A page measured absurdly long for its
text, such as one character and a 999in margin, set the characters-per-page
estimate near zero. The budget rounded to 0, and doubling 0 hung pagination.

**Content taller than a page is sliced** (`doc/review.md` §4). The page
can end *inside* a box, at `Position.slice` pixels, in two cases: a
monolithic box that starts the page, and a box whose own extent is all that
crosses it. Seven things about it are easy to undo:

- **The box is cloned whole on every page it crosses** (`showSlice`,
  `compose.ts`). It is shifted up by a negative `margin-block-start`, which
  collapses up through the continued boxes around it, so the content area
  clips above its top (`paginate.ts`). It is cut by its own `block-size`, not
  by a negative bottom margin: that collapses through the split ancestors
  and leaves them at full height.
- **"Taller than what it holds" means more than half a line of empty
  extent.** Text is measured by its glyph boxes, which end a few pixels
  above the line box. A paragraph that looked 3px taller than its text was
  sliced and printed twice (`paginate.spec.ts`).
- **Only stacked boxes are sliced for their extent.** A table cell or flex
  item stretched beside a taller one shares its row. Slicing one gave
  `tables/rebuild` an extra page.
- **A split box with a set height shares it across its pages**
  (`extents.ts`). `Position.consumed` carries what earlier pages used.
  `sizeFragments` gives the box the rest on the measuring box and on the page,
  cut at the page's end. It counts what a slice's shift puts above the page
  as the pages before's, not as used. A box its content sizes is not touched:
  that is measured (whole against `block-size: auto`), since a computed
  height cannot say.
- **Monolithic content is atomic to the candidate walk**, as MathML is. The
  walk broke a `contain: size` box between the lines inside it.
- **Monolithic content is sliced as far as its ink goes, in flow or not**
  (`inkEnd`). `usedHeight` counts a sliced clone's overflowing ink, or a
  page of nothing but that ink "fits" and ends the document.
- **Stacking reads in-flow ink; a break's extent leaves out absolute boxes**
  (`candidates.ts`). A block beside a float starts level with it and is
  still after its predecessor. A float splits like a block. An absolute
  box is sliced on its own, so it is not where the content before a break
  ends.
- **Page sides follow the root's direction** (`sideOf(index, rtl)`): with
  `direction: rtl`, page 1 is a left page and recto is left. The page box's
  grid is `direction: ltr` whatever the host's. An inherited `rtl` mirrored
  its margin tracks in Chromium.
- **Width and height queries are the UA page's** (`preview.ts`). They are
  settled once, against a frame sized to the user agent's page area, and
  the result goes to the frame and the host alike. It is not the author's
  `@page` area, as Chromium prints and WPT `media-queries-001` says.
- **A split box reaches the page's foot, and so does the note area**
  (`fillFragments`, `lowerFootnoteArea`). Both run after a page is kept. They
  paint and move no break, so they must stay after the overflow checks: run
  earlier, a stretched fragment is a page that looks too tall.

**M2's three debts are paid**, and the first was not the job it looked like:

- **Custom counters across pages.** Half of it already worked, by accident:
  every page is built in the same document, in order, so the browser's own
  counting carries `counter(chapter)` from page 1 to page 40 — the increments
  are all still above it. What composition breaks is a counter *reset* on an
  element that spans a break, because the continuation clones it and brings
  the reset along; `splits/numbering` numbered its paragraphs 1, 2 and then 1,
  2, 3 overleaf. Suppressing the reset does **not** fix that — the instance
  page 1 created belongs to page 1's clone and is not in scope on page 2, so
  the count starts again from the implicit zero. `src/counters.ts` walks each
  page carrying the values and writes the carried value back as an inline
  `counter-reset` on the continuation, which is the only thing that continues
  it. The same walk answers `target-counter(#id, chapter)` and
  `counter(chapter)` in a margin box, neither of which can be read off a
  rendered page: `getComputedStyle(el, "::before").content` gives back
  `counter(chapter)`, not `3`, and a pseudo-element's text is not in the DOM.
  Scoping is flat, as it is in `math/number.ts`; `counters(name, sep)`, whose
  whole meaning is the nesting, is left unimplemented rather than implemented
  wrongly.
- **`@media print`.** `src/css/media.ts` resolves the queries in stage 1 —
  print blocks unwrapped, screen blocks dropped, feature conditions kept with
  their media type stripped — before `@page` is extracted, so an `@page` rule
  written inside `@media print` is now found rather than buried. The frame is
  still a screen and there is still no web API to say otherwise;
  `emulateMedia` is a devtools protocol.
- **Bleed and crop marks.** `PageSpec` gains `bleed` and `marks`. A page with
  neither is still the single element it always was; one with either gets a
  sheet around it, sized to hold the bleed and 18px of mark. `contentArea`
  never sees either, so neither can move a break — which is what
  `page-sheet.spec.ts` asserts rather than assumes. `bleed`'s initial value is
  `auto`, which is 6pt once crop marks are asked for and 0 otherwise.

**The viewer now carries the engine's own stylesheets** into the host document
— the sheets it gave a `folio-` id, not the author's, which would restyle
the application around it. It did not before, and a page imported without them
renders as something that was never measured. Reading `splits/numbering`
through the viewer said its paragraphs were numbered 3, 4, 5 when the engine
had numbered them 2, 3, 4; the bug was in the looking glass, and it cost
real time. Screenshot the pages *with* the frame's `<style>` elements, or from
inside the frame, or not at all.

**Math is M4, and three things about it are not obvious from the code.** The
engine counts the equations itself rather than letting `counter(equation)` do
it: a formula carried into a running head is a clone, and a clone carrying
`counter-increment` advances the counter in the document the pages are built
in. It counts by reading the author's own `counter-reset` and
`counter-increment` back out of the browser's cascade, and writes the answer
into `data-x-counter-equation`, which is what both the printed number and a
reference read (`math.md` §5). The math pass runs twice per page, as footnotes
do — on the measuring box before candidates are enumerated, bounded to the
equations that could affect this page's break, and again on the page that will
be kept. And stretched fences are engine-dependent by 40% (the same two-row
matrix: 53px in Chromium, 64px in Firefox), so equation heights, and the breaks
that follow from them, are per-engine facts rather than bugs.

The **2,300-line budget of §3 is for the fragmenter** — "the part that makes
break decisions": `candidates`, `select`, `penalties`, `paginate`, `text`,
`position`, and now `chunk`, which is §3's "measure less" and is counted with
them rather than argued out of the budget.
**That is 2,166 of the 2,300**: a page after a `<br>` took 5. It was
2,161 before; `::nth-fragment` took 4 from 2,157, the state that carries
each element's fragment index from page to page; page floats took 19 from 2,138, as a second term in the
bisection's reserve (`review.md` §7);
footnote splitting, the bisected break and the offset counted outside notes
took 27 from 2,111; vertical
writing, orthogonal flows and the chunk floor took 49 from 2,062; floats, page sides and break
extents took 14 from 2,048; absolute boxes and ink across pages took 24
(`review.md` §4.8) from 2,024. The budget was 2,100 until 2026-09-24, when
the owner raised it rather than move code out, ahead of split boxes'
heights (`extents.ts`). That took 9 fragmenter lines and keeping
monolithic content atomic took 3; the rest of the work is outside it. It was
2,012 before. It was 1,950 before line breaks in text no
element holds (`runRanges`), which took 62 once folded into
`appendLineCandidates`: written apart it took 94, the same loop twice. It was
1,859 before slices (`review.md` §4), which took 91, most of them in
`candidates.ts`. Before that it was 1,855
after the move below, and four for the root chain's walk root. `doc/review.md` §3.6 took the move
`review.md` §2.5 had argued for: the stage 5 loop went to `settle.ts`,
the pages either side of a break (blank pages, sides, records, margin boxes
filled at the end, `placeMath`) to `pages.ts`, `placeFootnotes` to
`footnotes.ts` and the running-element pair to `strings.ts` — 244 lines that
never chose a break, with the corpus identical page for page on both engines.
The boundary is a rule now, in `plan.md` §3: the fragmenter decides, given a
measured box, where the page ends; what produces the box belongs to its
feature. Before the move it was 2,099. It was 2,000 until `doc/review.md` §2,
which needed about 94 lines for edge values (page names and propagated breaks,
bottom-up) and for "a page exists if a box starts on it", and chose raising
the budget over moving ~235 lines of stage 4/5 code out of `paginate.ts`; §5
of that review has the boundary rule it argued for, if the move is wanted
later. Before that it had been at the ceiling three times, paid for by moving
`applyReferences` to `references.ts`, `notesWithinCap` to `footnotes.ts` and
the counter walk's state to `counters.ts`. The three inline-content fixes took
it from 2,093 to 2,099, paid for in part by joining a line the edge-value
change had split. Margin-box geometry gave three back: the per-box content
loop in `paginate.ts` became one `renderMarginBoxes` call, less the import of
`scratchRange` in `candidates` and `text`; the page counter took them again
(its numbers live on `PageRecord.number`, in `types.ts`, because a field on
`PaginateResult` would have crossed the line). **The math budget
is 1,000 and `src/math/` is 1,008**: two lines for the `splitIntoRows` fix
the math drop-in found, on 1,006, which was over by the 34 lines of the
deletion gate's `deletion` and `nativeSupport()` exports, which the owner
accepted (2026-09-25). It was 972 before them, and 967 until `\tag`'s
`math-number: "<label>"`. Recount before assuming there is room in
either:

```
wc -l packages/core/src/{candidates,select,penalties,paginate,text,position,chunk}.ts
wc -l packages/core/src/math/{font,candidates,penalties,compose,number}.ts
```

**Math without pages is `folio-math.js` and `folio-math-tex.js`**
(`doc/math-drop-in.md`, done): the book's numbering, breaking and references
in the live document, no frame and no pages, from the same source and
`window.FolioTeX`. `src/math-screen.ts` is the pass, `@truke/folio/math`
its export; its exit check is `math-drop-in.spec.ts`, both examples showing
the book's numbers, references and rows on a screen. Three things easy to
undo:

- **The author's CSS is copied onto the page rewritten**, as the host copy
  is, only when it has a `math-number` or a reference. So `collectCss` makes a
  linked sheet's `url()`s absolute: in a `<style>` they resolved against the
  document, and the copy's `@font-face` could shadow the working original.
- **A display keeps its MathML from before breaking**, taken after the
  references are filled, and is broken again from it when its container's
  width changes (`ResizeObserver`).
- **It found a book bug.** `splitIntoRows` resolved each break's position
  after earlier cuts had renumbered the row, so an equation needing three or
  more rows got one too few. Resolve every position before the first cut.

**TeX input is `@truke/folio-temml`** (`doc/tex.md`, done): `\( … \)` and
`\[ … \]` by default, configurable, turned into MathML by Temml in a
`beforeParsed` handler, `dist/folio-tex.js`. Temml numbers nothing here:
`tex.ts` takes `\label`, `\tag`, `\notag` and the numbered environments out
first and hands them to the core (`tex-numbered` → `math-number: yes`, a
tag → `math-number: "(7a)"`), because Temml's numbering is CSS counters in
its own tag column and knows no page. Its exit check is `examples/tex/`
paginating exactly as `examples/math/` does (`tex.spec.ts`). Two things
easy to get wrong: Temml keeps only `\gdef` across formulas, so
`\newcommand` is rewritten to it; and the package's stylesheet goes *first*
in the head, or an author cannot restyle `a.tex-eqref::after`. The package
has no line budget; it neither breaks nor lives in `src/math/`.

`src/carry.ts` (`content(element)`) is deliberately outside `src/math/`: it is
a GCPM carrier like `string-set`, not mathematics, and so is outside the math
budget too. The rest of core is ~2,300 lines of source plus ~1,000 of unit
tests (CSS extraction, page model, composition, measurement, template). It has
no budget attached and should not be counted against either of those.

**Pagination is linear now, and the budget that says so counts composed nodes.**
Every page used to compose everything that remained; `src/chunk.ts` gives the
measuring box an end, estimated from the characters per page the last box
measured and grown until the box overflows the page with clearance to spare
(§3's first bullet). On `fixtures/book.html` — 150 chapters, 278 pages on this
host — a page composes 57–59 nodes whatever the document's length, and doubling
the book doubles the work: 2,150 nodes at 38 pages, 4,352 at 75, 8,475 at 148,
16,379 at 278. Unchunked those first two points were 7,824 and 34,910, which is
4.5× for 2× the book, and the whole fixture did not finish in fifteen minutes.
It now paginates in under two seconds (1.7s Chromium, 2.3s Firefox — see
below for why that is not the five it was). The math book came down with it:
Chromium 6.6s where it was about 25, Firefox 7.8s where it was about 90, so
`math-long.spec.ts` keeps its ten-minute timeout as slack rather than need.

`packages/test/browser/perf.spec.ts` is the recorded budget, and it is in
composed nodes rather than seconds deliberately: on this host wall-clock varies
by a factor of two between runs of the *same* document, while the node count is
identical to the digit. It asserts a page costs under 150 nodes, and that the
whole book costs under 2.6× what half of it costs — linear is 2, quadratic is
4, and it measures 2.01. Firefox is the check that the budget travels: it makes
332 pages of the same fixture rather than 278, at 52 nodes a page rather than
59, and scales 2.00×. A page count follows the host's fonts; the shape does
not.

**Time per page used to grow with the page count** even though composition
did not — about 9.5ms/page at 40 pages against 30 at 240 — and the cause was
the engine's discarded `Range`s. A range is live: the document updates every
one on every mutation until the garbage collector frees it, and the engine
made a new one for every line count. Tens of thousands waited at a time; in
Firefox one `style.setProperty` on anything in the frame took 1.5ms instead of
0.005ms. `scratchRange` (`dom-measurer.ts`) is one range per document, reused.
The book went from 23.9s to 1.7s on Chromium and 25.5s to 2.3s on Firefox on
this host, with node counts identical to the digit, and time now doubles with
the book (2.1×) rather than growing 8.5×. Found because the margin-box layout,
which writes styles after every page is built, took Firefox 160 seconds. **Do
not call `createRange()` in anything that runs per page**; take the scratch
range, set both ends, read, and do not hold it across a call.

**M5 is the way in for an application**, and there are two of them.
`src/preview.ts` is the `Previewer`: normalize, make the frame, inject the
CSS, await fonts, paginate — the nine lines every spec and both corpus runners
used to hand-roll. `src/polyfill.ts` wraps it as the drop-in a project's script
tag points at. `doc/compat.md` is the other half of the exit check: what a
Paged.js project keeps, what differs, and which of its thirty hooks are not
here and why. `doc/using.md` is how to load the built files in a web app, and
`examples/` has one of each kind, runnable with `pnpm build && pnpm examples`.

Three bugs came out of writing those examples, and all three were the engine
showing a page that had never been measured:

- **The pages were displayed under the author's raw CSS.** They are built in
  the frame against *rewritten* CSS — `@media print` unwrapped,
  `target-counter()` turned into the `attr()` the engine fills in — and the
  host document had only the originals, where `target-counter()` is a function
  no browser implements. A cross-reference the engine resolved correctly, and
  wrote onto the element as `data-x-ref-0="2"`, rendered as nothing at all.
  The `Previewer` now appends the rewritten CSS to the host, after the
  author's own so the screen chrome survives.
- **A comment before a declaration killed its carrier.** `rewriteCarriers`
  copies comments through without ending a declaration, which is right, and
  then parsed the comment as part of the next property's *name*. So
  `/* why */ string-set: title content()` was not a `string-set` at all, and
  the running head it fed came out empty. Most declarations in most real
  stylesheets have a comment somewhere above them.
- **Margin-box content overflowed its box backwards.** A running head wider
  than a right-aligned box lost its beginning and kept its end, which is the
  wrong half, and `text-overflow` never applied because it is not inherited
  and the text is in an inner element.

**Printing the host is a second layout, and Chromium does it.** The host keeps
the author's original sheets, `@page` included, and Chromium (131+) applies
`@page` margin boxes natively when printing — so "Print to PDF" drew every
page number twice and shrank each sheet into the author's margins.
`insertPrintCss` (`preview.ts`) makes the browser's page exactly our sheet in
print media, with `!important` so `@page :first` and named pages cannot
outrank it. `print.spec.ts` checks the PDF itself with pdf.js — screen
screenshots cannot see this bug at all. The viewer (`renderViewer`) has its
own copy of the same rules, because it depends on nothing, plus two of its
own: it mounts every page on `beforeprint` (a virtualized list printed blank
placeholders) and in print hides everything outside its ancestor chain (an
application's toolbar pushed page 1 down and every page across two sheets).
`viewer.spec.ts` prints it. Both events fire for `page.pdf` too. The
`Previewer`'s print CSS now hides everything outside the pages' ancestors too
(see M6 above). Firefox
never drew the second number (it does not draw `@page` margin boxes itself)
but did shrink each page into the author's margins; `print-firefox.spec.ts`
prints through `window.print()` with silent-print preferences, which always
uses Letter paper whatever `@page` says, so it cannot check sheet size.

**M0.3 decided that stage 3 decides breaks in JavaScript** — the browser
cannot be trusted to place them, and multicol is not used at all, not even to
measure. The evidence is in `doc/review.md` §1; do not reopen it without
re-running `packages/test/spike-multicol.mjs`, which is one command.

The repo pins `pnpm@10.33.0` (`packageManager`), and the `pnpm` on this host's
PATH is 8.12, which refuses to add a dependency (`ERR_PNPM_UNEXPECTED_STORE`:
it wants a v3 store, `node_modules` is linked from v10). Use `npx -y
pnpm@10.33.0 …` for anything that changes the lockfile; the plain scripts
below run under either.

```
pnpm install
pnpm build         # -> dist/: the polyfill, the library, the viewer
pnpm examples      # -> http://127.0.0.1:5180/examples/
pnpm pdf book.html # -> book.pdf, headless Chromium (doc/using.md)
pnpm typecheck     # tsc --build over the project references
pnpm test          # vitest, layer 1 of plan.md §9: no browser
pnpm vitest run packages/test/src/fake-measurer.test.ts   # one file
pnpm vitest run -t "counts a batch"                        # one test

pnpm exec playwright test                    # browser layers, three engines
pnpm exec playwright test --project=chromium # one engine

node packages/test/serve.mjs &                     # fixtures on :5177
node packages/test/baseline.mjs                    # re-measure Paged.js
node packages/test/baseline.mjs --filter tables    # a subset
node packages/test/vendor-corpus.mjs               # re-vendor the corpus

node packages/test/wpt.mjs --engine chromium       # WPT reftests, bare browser
node packages/test/wpt.mjs --folio --engine chromium --shots /tmp/wpt
                                                   # the -print half, engine loaded
node packages/test/wpt.mjs --native-print          # -print tests, Chromium alone
node packages/test/deletion.mjs                    # plan.md §8: may a module go?
node packages/test/wpt-manifest.mjs                # re-pin the WPT commit
node packages/test/spike-multicol.mjs --engine all # re-run the M0.3 spike

node packages/test/paginate-corpus.mjs             # our engine on the corpus
node packages/test/paginate-corpus.mjs --filter breaks
node packages/test/differential.mjs                # ours vs Paged.js (layer 4)
                                                   # verdicts: doc/differential.md
node packages/test/polyfill-corpus.mjs             # M5.1 exit: script tag swapped

pnpm exec playwright test packages/test/browser/perf.spec.ts       # M1's budget
pnpm exec playwright test packages/test/browser/polyfill.spec.ts   # M5.1
pnpm exec playwright test packages/test/browser/viewer.spec.ts     # M5.2
pnpm exec playwright test packages/test/browser/counters.spec.ts   # M2.3
pnpm exec playwright test packages/test/browser/page-numbers.spec.ts # M6
pnpm exec playwright test packages/test/browser/fragments.spec.ts  # M6
pnpm exec playwright test packages/test/browser/print.spec.ts      # Print to PDF
pnpm exec playwright test packages/test/browser/shown.spec.ts      # shown = measured
pnpm exec playwright test packages/test/browser/root.spec.ts       # root on the page
pnpm exec playwright test packages/test/browser/page-box.spec.ts   # page border, padding
pnpm exec playwright test packages/test/browser/print-firefox.spec.ts --project=firefox
pnpm exec playwright test packages/test/browser/leaders.spec.ts    # M6
pnpm exec playwright test packages/test/browser/footnote-split.spec.ts # M6
pnpm exec playwright test packages/test/browser/page-floats.spec.ts # M6
pnpm exec playwright test packages/test/browser/nth-fragment.spec.ts # M6
pnpm exec playwright test packages/test/browser/tall.spec.ts       # M6, slices
pnpm exec playwright test packages/test/browser/content-before.spec.ts
pnpm exec playwright test packages/test/browser/furniture.spec.ts  # M6, WPT finds
pnpm exec playwright test packages/test/browser/page-content.spec.ts
pnpm exec playwright test packages/test/browser/page-sheet.spec.ts # M2.1, media
pnpm exec playwright test packages/test/browser/math.spec.ts       # M4, seconds
pnpm exec playwright test packages/test/browser/math-long.spec.ts  # M4 exit, minutes
pnpm exec playwright test packages/test/browser/tex.spec.ts      # TeX front end
pnpm exec playwright test packages/test/browser/math-drop-in.spec.ts # math, no pages
pnpm exec playwright test packages/test/browser/math-golden.spec.ts
pnpm exec playwright test packages/test/browser/math-golden.spec.ts --update-snapshots
```

**Golden images are host-specific**, like the page-count baselines. The PNGs in
`packages/test/browser/math-golden.spec.ts-snapshots/` were recorded on this
machine; `updateSnapshots: "missing"` means a platform without a baseline
records its own instead of failing, and one that has a baseline and disagrees
fails. Re-record only after looking at the diff — a golden image updated
unseen proves nothing. Its README says all of this too.

The corpus runner needs the fixture server; Playwright starts one itself
(`webServer` in `playwright.config.ts`), the node scripts do not.

**Do not wait on a job with `until ! pgrep -f "thing.mjs"`.** The waiting
shell's own command line contains that string, so `pgrep` matches itself and
the loop never ends — fourteen such shells spun for six hours here. The trap
is easy to walk back into: two more were started while chasing the
`content-none` overflow, one of them by the same hand that wrote this
paragraph.

`pkill -f` has the same trap: it matches, and kills, the shell running it.
Take the pid with `pgrep -f "wpt[.]mjs"` (the brackets stop the pattern
matching itself) and `kill` that pid. The brackets do not stop it matching
*another* shell whose command line names the script. A loop that waited
"while `pgrep -f "paginate-corpus[.]mjs"` finds something" found the idle
shell that had once launched the corpus, and spun on it overnight. Wait on
the pid a background job reports, or on `run_in_background` itself.

Wait one of these two ways instead:

- `run_in_background` on the job itself, which notifies on exit. This is the
  first choice — it needs no waiter at all.
- `tail --pid=<pid> -f /dev/null` to block on a process already running. It
  takes the pid rather than a pattern, so there is nothing for it to match
  itself against.

Piping a background job through `tail -20` hides its output until it exits,
which looks exactly like a hung run. Redirect to a file and read that. And
`rm` may be an alias for `rm -i` in the shell a job runs in: a chained
background command that removes a file sits on the prompt forever. Use
`\rm -f`.

Browser tests inject a bundle of the engine (`packages/test/bundle.mjs`, built
by Playwright's `globalSetup`) and call `window.folio`. Do not pass engine
functions to `page.evaluate` as strings: that works only while a function is
entirely self-contained, and fails in the page with a `ReferenceError` the
moment it calls a module-scope helper.

**WPT's two halves run in two modes.** The bare-browser run skips the `-print`
reftests, because viewport screenshots cannot evaluate a paginated test; the
`--folio` run takes only those, and skips the continuous-media half, which
paginated would measure the browser twice. The Folio run serves the WPT tree
over HTTP (tests ask for `/fonts/Ahem.ttf`), mirroring each file into
`.wpt-cache/` the first time it is asked for, and takes about ten minutes per
engine.

**The deletion-condition gate (`plan.md` §8) is built.**

- **The registry.** Every polyfill module exports `deletion` (its feature,
  its condition and its WPT tests) and `nativeSupport()`. `deletion.ts`
  gathers them and lists the rest of core as the exempt engine.
  `deletion.test.ts` fails if a pattern matches no pinned test, or if a file
  in core is claimed by neither. **A new file in core must be added to one or
  the other.**
- **The report.** `deletion.mjs` reads the registry against the native runs:
  the bare run, and `--native-print`, which is Chromium's alone. A `-print`
  test is "unknown" on Firefox and WebKit, never a pass.
- **The result.** No module is deletable now (`native-support.md`). The
  WPT workflow's `deletion` job fails the day one is.
- **Imports.** The `Deletion` type and `supports` live in `native.ts`, a
  leaf. Importing them from `deletion.ts` made an import cycle, and the
  registry came out full of `undefined`.

**Baselines are not portable.** `packages/test/baselines/*.json` record page
counts from one machine: no corpus fixture loads a webfont and 41 name a
font-family, so the numbers follow the host's installed fonts. Each file says
so in its `environment`. The differential layer has to run both engines in one
session rather than compare against a committed file.

**WebKit runs on this host only with host validation off.** The host is
Fedora 44, which Playwright does not list as supported, so every WebKit run
needs `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` (not set in
`playwright.config.ts`, so CI still checks its dependencies). With it, the
whole browser suite passed on WebKit (build 2359) on 2026-09-25: 169 passed,
5 skipped, the skips being `page.pdf` and Firefox's silent print. Fedora 39
could not launch it at all: its ICU was older than the build's. CI
(ubuntu-latest, `playwright install --with-deps`) still runs WebKit too.

```
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 pnpm exec playwright test --project=webkit
```

**WebKit's print path cannot be checked by Playwright anywhere**: it has no
`page.pdf` and no print-to-file. The "every engine" tests in `print.spec.ts`
and `viewer.spec.ts` emulate print media and read back what the print
stylesheets did, which runs on WebKit in CI; they record `@page` `size` or the
`page` property as an `unsupported` annotation rather than failing, because
without them the pages still print. How Safari splits the result into sheets
is a manual check: print both examples to PDF from Safari.

ESLint and Playwright are both installed here, with chromium and firefox
pulled. The browsers are a large download, so on a fresh clone `playwright
install` is a deliberate step, not a side effect of `pnpm install`.

The workspace is `@folio/{core,viewer,temml,test}`. `core` holds stages 1-5;
`test` holds the harness, and its fake measurer is what the break logic is
unit-tested against, with no browser.

## The documents

| File | Read it for |
| --- | --- |
| `doc/README.md` | Ground rules, scope, the index. Shortest path in. |
| `doc/plan.md` | The design: pipeline, fragmenter, feature map, CSS strategy, math, validation, risks. |
| `doc/math.md` | The math subsystem in implementation detail. |
| `doc/milestones.md` | Execution order: M0–M6, dependencies, exit checks, standing gates. |

`doc/` is the source of truth. The plan is also published as a designed page
(`doc/README.md` links it, Rev. 3 of 2026-09-25, which added the milestones
as built); when the two disagree the directory wins. An update needs an
Artifact `read` of that URL before the publish; it once timed out here over
IPv6 while the same host answered over IPv4.

## Architecture worth knowing before editing the docs

These are the load-bearing decisions. A change that contradicts one of them is a
design change, not an edit.

- **Five stages, plain data in and out** (`plan.md` §2): normalize → extract
  page model → fragment → compose → resolve references. The source document is
  never mutated; pages are generated from it. If stage 5 changes a page's size,
  re-run stage 3 for that page under a pass limit.
- **A page is `(spec, start)`** — `Position` is a path of child indices plus an
  offset, comparable by value. That is what makes re-laying-out one page a
  function call, and it is why table splitting and the viewer's virtualized list
  are cheap later.
- **Every read of layout goes through `Measurer`**, so break logic unit-tests
  against synthetic boxes with no browser.
- **The engine's own furniture is never in the source tree.**
  `createEngineFrame` hangs its iframe off `documentElement`, because `body`
  is usually the root being paginated — a frame appended there is a child of
  the source, and the fragmenter reasons about it as content. It cost a forced
  break at the top of a page and a 1702px section in a 680px area (`79958f3`).
  An iframe outside `body` measures identically, checked on both engines.
- **The measuring box holds a chunk, not the rest of the document**
  (`src/chunk.ts`). It is safe because block flow is one-directional: a
  candidate at or above the page limit has the same geometry in a truncated box
  as in a whole one. Two things would break that and are handled — a chunk
  never ends inside a width-coupled container (a table resolves its columns
  from *all* its rows, so half a table has different row heights above the cut,
  and `repeatTableParts` would hand it a footer the real page will not have),
  and a box that fits is never read as "the document ended" unless the chunk
  reached the end. Grow the chunk rather than trusting a box that fits.
- **The browser does layout; JS only decides where things break.** The engine
  owns no CSS cascade. Unknown properties are renamed to `--x-*` carriers and
  cascaded by the browser (rung P, §5); fragment and page stamps are rung P+;
  our own cascade is rung C and is argued against at length in §6. Treat any
  proposal that needs C as a separate decision, not an increment.
- **One fragmenter, two axes.** Breaking a display equation wider than the
  measure is the vertical algorithm rotated, so the break selector takes an axis
  parameter from the start. This is why math costs so little extra.
- **Math quality comes from the font, not a library.** MathML Core implements
  the OpenType `MATH` table; what it omits (line breaking, `mlabeledtr`) is
  layout, which is ours. Never propose computing glyph positions or script
  shifts.
- **Feature tiers N/F/P/C/V** (§4) say which part of the engine owns a feature.
  The feature map is the scope.

## Constraints that outrank convenience

- **Clean-room.** Vivliostyle is AGPL. Study its behaviour, docs and public
  issues; do not read its source while writing the equivalent module, and do not
  port its test files. Paged.js (MIT) and WPT (BSD-3) can be used directly, and
  the Paged.js spec corpus is the differential baseline. This project is MIT.
- **Browser floor: Chromium 109, Firefox 115, Safari 16.4**, set by MathML Core.
  No feature-detection below it.
- **Deletion conditions.** Every polyfill module names the condition under which
  it is deleted. The engine is meant to shrink as browsers improve.
- **Line budgets.** Fragmenter under 2,300 lines, math under 1,000. A budget
  crossed is a design review.
- **Invariants** that any implementation work must preserve: every source
  character appears exactly once across all pages; no page overflows; forced
  breaks are honoured; identical input gives identical positions; stage 5
  settles; equation numbers are consecutive with no gaps or repeats.

## Writing conventions in `doc/`

Prose wrapped at 80 columns, sentence case headings, tables for anything
comparative, and cross-references as `plan.md` §N or `math.md` §N. Claims about
the existing engines cite a file and line (`layout.js:142`). The documents argue
for their decisions rather than listing them — match that when adding to them.
