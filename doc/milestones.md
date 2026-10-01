# Milestones

An execution plan for the engine described in [plan.md](plan.md). It expands the
seven-line roadmap in §10 of that document into milestones with scope,
dependencies, exit checks and the decisions each one forces. Where the two
disagree, `plan.md` describes the design and this file describes the order of
work.

Sizes are estimates for one full-time engineer, in weeks, and are meant for
sequencing rather than for promising dates. The sequence matters more than the
sizes: every milestone ends with a check that can actually be run, and no
milestone starts before the check that guards it has passed.

**Toolchain assumptions.** Not fixed by `plan.md`, so fixed here: TypeScript, a
pnpm workspace, Vitest for unit tests, Playwright for browser tests, esbuild for
bundles. Packages: `@truke/folio` (stages 1–5), `@truke/folio-viewer` (V rows of
the feature map), `@truke/folio-temml` (optional TeX front end, M4), `@truke/folio-test`
(harness, fixtures, corpora). Change any of these before M0 ends; after that the
harness depends on them.

| # | Milestone | Size | Guarded by | Ends with |
| --- | --- | --- | --- | --- |
| M0 | Harness and spike | 5w | — | Baselines, one go/no-go, one load-bearing yes |
| M1 | Core fragmenter | 8w | M0 | Every character exactly once, whole corpus |
| M2 | Page model and references | 6w | M1 | Differential match on page-model specs |
| M3 | Footnotes and tables | 6w | M1 | Whole Paged.js corpus matched or documented |
| M4 | Math | 7w | M0 probe, M1, M2 refs | 40-page math fixture, three engines |
| M5 | Compatibility and viewer | 5w | M3 | A real Paged.js project runs unchanged |
| M6 | Beyond parity | done for now | M3 | Per feature: WPT subset + deletion condition |

M2 and M3 both depend only on M1 and touch different code, so they can run in
parallel if there are two people. M4 needs the stage 5 reference loop from M2;
everything else in it is independent of M3.

---

## M0 — Harness and spike (5w)

The harness comes before the engine. Paged.js has one unit test, and that is the
single biggest improvement available (`plan.md` §9), so it is also the thing
least safe to defer until there is code to be attached to.

**M0.0 Repository (0.5w).** Workspace, TypeScript config, lint, CI on Chromium,
Firefox and WebKit. `Measurer`, `Position`, `PageSpec` and `PageRecord` land as
types with no implementation behind them.

**M0.1 Test harness (1.5w).** Vitest with a fake measurer that returns synthetic
boxes, so break logic is testable with no browser. Playwright driving the three
engines at a fixed device pixel ratio — Vivliostyle's `pixelRatio=0` lesson, and
the reason structural snapshots can be compared at all. A WPT runner pointed at
`css-page`, `css-break` and GCPM. A JSON snapshot format recording, per page,
which element and which text offset lands where.

**M0.2 Corpus and baselines (1w).** Vendor the Paged.js spec corpus (MIT) and
convert each spec into a structural check. Run it against Paged.js itself and
store the result as the differential baseline. This is what M1–M3 are measured
against, and it is worth having before there is anything to measure.

**M0.3 Multicol spike (2w, timeboxed).** Give one column the page height and let
the browser place the breaks; compare against deciding in JS. The timebox is
hard. Test it against an `<mtable>`-composed equation inside a column as well
(`math.md` §10 Q1) — finding out in M4 that multicol and math disagree is the
expensive version of this question.

**M0.4 Math font probe (0.5w).** Await the font, then measure a stretchy
operator at two sizes. Twenty lines, and it fixes the browser floor for
everything after. Then verify that Chromium's print path embeds the MATH subset
correctly (`math.md` §10 Q5) — a "no" here invalidates the approach in §7 of the
plan, and it is cheap to ask now.

**Exit**
- The corpus runs against Paged.js and produces baseline snapshots.
- The spike ends in a written go/no-go: multicol decides breaks, or JS does.
- `hasMathTable()` passes on all three engines, in CI, as a blocking preflight.
- Chromium print embeds the MATH font subset — recorded with the test that shows it.

**Decisions taken here:** toolchain; break-decider (multicol vs JS); whether math
stays in scope in its current form.

---

## M1 — Core fragmenter (8w)

The only part that makes break decisions, and the one with a line budget: under
2,100 lines (`plan.md` §3; 2,000 until `review.md` §2). Everything else in the engine is downstream of the
data it produces.

**M1.1 Stages 1–2 (1.5w).** `SourceDoc` that is never mutated; a page-model
extractor that parses `@page`, margin boxes and GCPM properties and passes all
other author CSS through untouched. The engine's own iframe.

**M1.2 Positions and composition (2w).** `Position` as path plus offset,
comparable by value. Compose a page's DOM from `(start, end)` with split-from /
split-to markers. Laying out page *n* again is a function call — which is what
removes the bug class behind Paged.js's `specs/infinite-loop` test.

**M1.3 Break selection (2.5w).** Candidates with penalties; forced breaks;
`break-inside: avoid`. Estimate content from characters per page, render a chunk,
then binary-search the block children — never append and measure one node at a
time. Logical directions (block-start/end) from the first line of geometry code;
this is the retrofit that is not worth doing later.

**M1.4 Text splitting (1w).** Group `Range.getClientRects()` into line boxes and
break after the last line that fits.

**M1.5 Page template and minimal viewer (1w).** `@page` size and margins into
`PageSpec`, the 16 margin boxes as a plain CSS grid, page counters, and enough
viewer to look at the output.

**Axis parameter (included, not deferred).** The break selector takes an axis
from the start. Rotating it is what M4's display-equation breaking is; adding the
parameter later means rewriting the selector with math depending on it.

**Exit**
- Every source character appears exactly once across all pages, on the whole corpus.
- No page overflows its area; every forced break is honoured.
- The same input produces the same positions on repeated runs.
- Unit tests for penalties, widows, orphans and forced breaks pass with the fake
  measurer and no browser.
- A forced-layout budget is recorded for a 300-page book fixture, and CI fails on
  regression against it.

---

## M2 — Parity A: page model and references (6w)

**M2.1 Page selection (1.5w).** Named pages, `:first`, `:left`, `:right`,
`:blank`, `:nth(An+B)`, bleed, crop and cross marks. Mostly page-template CSS
once `PageSpec` exists.

**M2.2 Cascade by proxy (1.5w).** The rewrite table of `plan.md` §5: rename
unknown properties to `--x-*` carriers registered with
`@property { inherits: false }`, rewrite unknown pseudo-elements into generated
elements with classes, read values back with one batched `getComputedStyle` per
element that has them. Tested one rule at a time. This is rung P, and it is the
rung the engine is meant to stay on.

**M2.3 Counters and strings (1.5w).** Custom counters across pages, `string-set`
and `string()`, `position: running()`.

**M2.4 Stage 5 loop (1.5w).** `refs` and `provides` per page; `target-counter()`
and `target-text()`; re-run stage 3 for pages whose size changed, up to a fixed
pass limit. The `pages` counter is known only after the last page, so it costs
one extra pass by construction.

**Exit**
- Differential results match Paged.js on the page-model and generated-content specs.
- Stage 5 settles within N passes on every corpus document, and the pass limit is
  exercised by a test that deliberately oscillates: when it trips, the layout
  with the longer text is kept, so the result cannot flip-flop.

---

## M3 — Parity B: footnotes and tables (6w)

**M3.1 Footnotes (2.5w).** `float: footnote` through a carrier property; call and
marker pseudo-elements as generated elements; the note area reducing available
height, which feeds back into break selection. `footnote-display` and
`footnote-policy`, with policy expressed as a penalty rather than a rule.

**M3.2 Tables (2w).** Split across pages from positions, with repeated `thead`
and `tfoot` — cheap once composition works from positions, which is the payoff
for M1.2. No rebuilding rows and copying column widths.

**M3.3 Widows and orphans (1.5w).** Counting line boxes, which M1.4 already
produces. Paged.js has no JS logic here and relies on a column trick; this is a
place to expect documented differences rather than matches.

**Exit**
- The whole Paged.js corpus matches, or each difference is documented as a bug in
  one engine or a deliberate improvement in ours.
- Footnote and table cases hold the M1 properties: no overflow, every character
  once.

---

## M4 — Math (7w)

Budget: under 1,000 lines across the six modules in `math.md` §2. If
`compose.ts` starts growing a layout algorithm, the work has gone wrong and
belongs back in the shared fragmenter.

**M4.1 Font pipeline (0.5w).** Promote the M0 probe into `font.ts`: bundled
webfont, load, probe, fail loudly. A missing MATH table degrades silently —
flat fractions, unstretched delimiters, nothing thrown — so the probe is a
blocking preflight in CI, not a startup nicety. Every math result in a run where
it failed is meaningless.

**M4.2 Candidates and penalties (1.5w).** Walk a `<math>` tree and emit break
candidates at top-level `<mo>`; never inside scripts, fractions, radicals or
fences. Penalties ordered relation before binary operator before comma. Descend
one level only when the top level yields nothing that fits. These feed the M1
fragmenter through its axis parameter; they do not contain a fragmenter.

**M4.3 Composition (1.5w).** Rewrite an equation into broken lines: two-column
alignment when a relation exists, indent when not. Its lines are block children,
so a broken equation splitting across a page is the M1 machine doing its
ordinary job.

**M4.4 Numbering and references (1.5w).** The generated three-column grid, an
ordinary `counter-increment`, and `target-counter()` through the M2 stage 5 loop
— which is what makes "equation (3.4) on page 128" cost nothing new. Decide and
document the counter-reset default (`math.md` §10 Q4): the reset point comes
from the author's stylesheet, not from an engine assumption.

**M4.5 Carrying math out of the flow (0.5w).** `content(element)` cloning into
running heads and TOCs, because `textContent` destroys a formula.

**M4.6 Golden images (1w).** ~30 fixed formulas per engine: nested fractions,
large operators with limits, stretched fences over matrices, multiscripts, long
radicals, accents. These catch "it changed", which is the only math-rendering
regression we can own — positioning is the browser's. Measure whether the three
engines agree on `GlyphAssembly` results (`math.md` §10 Q2) and, if not, accept
per-engine expectations here as elsewhere.

**Not in M4.** TeX parsing ships as `@truke/folio-temml`, separately and optionally;
the core accepts MathML only and says so.

**Exit**
- A 40-page math-heavy fixture paginates with no overflow on three engines.
- Equation numbers are consecutive from 1 across all pages, no gaps, no repeats.
- Every equation's structural snapshot is stable between runs.
- A 3-line equation is never split 1 + 2 against the widow penalty.
- Golden images established per engine, with a diff threshold that fails CI.

---

## M5 — Compatibility and viewer (5w)

**M5.1 Paged.js compatibility (2.5w).** A `Previewer`, the polyfill entry point
and a `Handler` layer. Not 30 hooks that can change any DOM at any time: a few
typed hooks at stage boundaries, operating on data rather than live DOM. Where a
Paged.js hook cannot be expressed that way, document the gap instead of
reopening the DOM.

**M5.2 Viewer (2.5w).** Spreads, zoom, page navigation, a virtualized page list
— all consuming `PageRecord`s only. Re-laying-out a single page follows from
storing `(spec, start)`.

**Exit**
- A real Paged.js project runs unchanged, with its script tag swapped.
- The viewer renders a 300-page book within the M1 performance budget.

---

## M6 — Beyond parity (done for now)

**Closed for now on 2026-10-01**, by the owner's decision: every item below is
done, deferred by decision, or a documented limit. Nothing is in progress. A
new item reopens it on the same terms.

Not a block of work with an end date. Each item is taken on its own and ships
with its WPT subset and its deletion condition: `leader()`, `content()`,
`margin-break`, `box-decoration-break`, page floats via carrier properties,
`::nth-fragment` via rung P+, multicol inside pages, vertical writing.

Rung P+ — stamping placed fragments with `data-frag`, `data-page-type` and
friends, and rewriting page-context selectors to match them — is the first thing
here that changes the architecture, because a stamp that changes an element's
size forces that page to be laid out again. In the end it did not, because a
fragment's index is known before its page is measured
(`review.md` §8). Rung C (our own cascade) is not on
this list. It gets its own decision, with `plan.md` §6 as the argument against.

| Item | State | Where | Tests |
| --- | --- | --- | --- |
| `box-decoration-break` | Done | `fragments.ts` | `fragments.spec.ts` |
| `margin-break` | Done | `fragments.ts` | `fragments.spec.ts` |
| `leader()` | Done | `leaders.ts` | `leaders.spec.ts`, `leaders.test.ts` |
| WPT with the engine loaded | Done | `wpt.mjs --folio` | 183/235 Chromium, 172/235 Firefox (`native-support.md`) |
| Named pages, propagated breaks, empty pages | Done | `candidates.ts`, `paginate.ts` | `review.md` §2; `candidates.test.ts`, WPT `page-name-*` |
| Margin-box geometry (css-page-3 §5.3) | Done | `margin-boxes.ts` | `margin-boxes.test.ts`, WPT `margin-boxes/*` |
| The root on the page; page background and canvas (css-page-3 §3, §3.1) | Done | `compose.ts`, `page-paint.ts` | `review.md` §3; `root.spec.ts`, WPT `page-box-*`, `page-background-*` |
| The UA's `body { margin: 8px }` on the page, as CSS says (`review.md` §3.6, reversed) | Done | `furniture.ts`, `page-paint.ts` | `root.spec.ts`; `differential.md`, WPT +8 |
| `@page { margin: auto }`, negative page margins, the viewport as the first page's area | Done | `page-model.ts`, `page-template.ts`, `preview.ts` | `page-model.test.ts`, `page-content.spec.ts`, WPT `page-margin-auto*`, `-negative`, `page-size-009` |
| The page box's border and padding; percentage page margins | Done | `css/page-box.ts`, `page-template.ts` | `page-box.test.ts`, `page-box.spec.ts`, WPT `page-box-*` |
| Page counter and page-context counters (§6.1) | Done | `page-counters.ts` | `page-counters.test.ts`, `page-numbers.spec.ts`, WPT `margin-boxes/content-008`–`013` |
| `content()` | Done | `strings.ts`, `counters.ts` | `strings.test.ts`, `content-before.spec.ts` |
| `@page` in `@layer`; margin boxes cascaded by specificity | Done | `css/page-rules.ts`, `page-model.ts` | `page-model.test.ts`, WPT `layers-*` |
| Content taller than a page: slices of monolithic boxes and of a box's own extent; split boxes' set heights; absolute boxes and ink across pages; fragments to the page's foot | Done, with limits | `candidates.ts`, `compose.ts` | `review.md` §4; `candidates.test.ts`, `tall.spec.ts`, WPT `monolithic-overflow-*` |
| `footnote-policy` with note splitting; `@footnote` rules | Done | `footnotes.ts`, `paginate.ts`, `pages.ts` | `review.md` §6; `footnote-split.spec.ts`, corpus notes counted against the source |
| Page floats: `float: top`, `bottom`, `snap-block` with `float-reference: page`; `float-defer` | Done | `page-floats.ts`, `paginate.ts` | `review.md` §7; `page-floats.spec.ts` |
| `position: fixed` (not in the feature map) | Deferred by decision, 2026-09-25 | — | 15 WPT tests (`wpt-failures.md`) |
| `::nth-fragment` (rung P+) | Done | `nth-fragment.ts`, `fragments.ts` | `review.md` §8; `nth-fragment.test.ts`, `nth-fragment.spec.ts` |
| Structural selectors across fragments | Deferred by decision, 2026-09-25 | — | 5 WPT tests (`wpt-failures.md`) |
| More than one break position per page | Documented limit by decision, 2026-09-25 | — | `wpt-failures.md`, content taller than a page |
| Multicol inside pages | Deferred by decision, 2026-09-25 | — | 1 WPT test; M0.3 stands (`review.md` §1) |
| A table row taller than a page | Deferred by decision, 2026-10-01 | — | Slices skip table-internal boxes (`review.md` §4) |
| Vertical writing | Done | `flow.ts`, `dom-measurer.ts`, `page-box.ts`, `page-paint.ts` | `review.md` §5; `vertical.spec.ts`, WPT 14 of 18 |
| TeX input, MathJax delimiters (`@truke/folio-temml`) | Done | `packages/temml`, `tex.md`; `math-number: "<label>"` in `math/number.ts` | `find.test.ts`, `tex.test.ts`, `render.test.ts`, `tex.spec.ts` (exit: `examples/tex/` equals `examples/math/` page for page) |
| Math without pages: `folio-math.js`, `folio-math-tex.js` | Done | `math-screen.ts`, `math-global.ts` in core and `@truke/folio-temml`; `math-drop-in.md` | `math-drop-in.spec.ts` (exit: `examples/math/` and `examples/tex/` show the book's numbers, references and rows on a screen) |

**Content taller than a page is sliced** (`review.md` §4). The page can
now end *inside* a box: a monolithic one (an image, `contain: size`), when it
starts the page, and a box whose own extent is all that crosses the page, like
a `height: 400vh` block whose text has ended. The rest of the box is shown on
the pages below it, and what follows it is where its height puts it. A
`Position` carries the offset (`slice`). The box is cloned whole on each page
it crosses, shifted up and cut by its own height, so nothing inside it is laid
out again. What is left is a continued *ancestor* with a fixed height, which
is still composed at full height on every page.

**Three small items and a triage came with it.** `@page` rules inside
`@layer` are found and ranked by layer, and margin boxes are cascaded by the
same order as the page (origin, layer, specificity, source order), where
before it was source order alone. `content(before)` and `content(after)` are
the pseudo-elements' generated text, and their `counter()` values come from
the engine's own walk, because the browser reports `counter(chapter)` rather
than `3`. The triage of the root-box leftovers found four more margin-box
geometry bugs:

- three empty boxes on an edge took a half and two quarters;
- the imaginary pair was not what the wider side box is;
- vertical side boxes had no content sizes;
- percentage margins were resolved against the width on both axes.

It also found that a family only the margin boxes use was measured before it
had loaded. And margins were truncated through a `flow-root` at the top of a
page. `wpt-failures.md` has the rest, including seven margin-box tests that
fail only because the UA's body margin is off by decision (`review.md`
§3.6).

**Margin-box geometry replaced a grid that was never right.** M1 laid the
sixteen boxes out as a five-by-five CSS grid on the argument that the browser
would do `atpage.js:2079`'s arithmetic for us. It gave every box on an edge a
third of it; css-page-3 §5.3 gives a box alone on its edge the whole edge,
shares two boxes' space in proportion to their content and keeps a middle box
centred however wide its neighbours are. `margin-boxes.ts` is that arithmetic
as a pure function over measured min- and max-content sizes, each box in an
area that is its containing block so the browser still resolves `20%` and
`em`. It runs after the boxes are filled, once a page, and can move no break.
Doing it found two page-model bugs that had nothing to do with margin boxes:
`@page { margin: 4em }` was not a length at all and silently became the
default margin, and `@page { width; height }` was ignored.

**The first three cost the fragmenter nothing**, and that was the design test
for taking them first. `box-decoration-break` and `margin-break` are rules on
the fragments composition already marks, cascaded by the browser, plus stamps
for what a selector cannot see — a box's computed `display` and its
`box-decoration-break`, read through carriers. They are applied to the
measuring box by the same call that applies them to the page
(`finishFragments`), so a break is chosen against the fragment that will be
shown. The fragmenter's only change is to remember whether the break before a
page was forced, because `margin-break: auto` keeps the margin after a forced
break and truncates it after an unforced one; the line count is unchanged at
1,974, paid for by an import that collapsed. `leader()` is rewritten to
`attr()` exactly as `target-counter()` is, and filled in stage 5 with the
longest run that leaves its line as tall and as wide as it was empty — so it
never changes a height and has no business in the measuring box.

**Composing a fragment as a whole clone was wrong in five more ways**, all
found by writing the fixture for the first two items. Paged.js hard-codes the
fixes for four of them (`paged.polyfill.js:28388`–`28426`); none were here:

- A continued paragraph indented its first line on the new page, so it read as
  a new paragraph. `text-indent` is inherited, so the fix is a stamp on the
  innermost split block, and only when the page begins inside its *text* — a
  section continued at its third paragraph begins a fresh one.
- `::before` drew on every fragment and `::after` on every fragment, where
  they belong to the first and last.
- `::first-letter` and `::first-line` styled the continuation's first line: a
  drop cap on the second half of a paragraph.
- A split list item drew its marker twice.
- **A split `<ol>` restarted at 1 on the next page**, on both engines, for two
  different reasons. Chromium numbers list items by its own ordinal and does
  not report the list's implicit `counter-reset` at all; Firefox does report
  it, as `list-item 0`, and `counters.ts` — which never sees the implicit
  `list-item` increments either — carried that 0 onto the continuation. The
  continuation now gets a `start` attribute computed from the source, which is
  what both engines number from, and the counter walk leaves `list-item` alone.

**And one that had been there since M1.5.** The first-child margin truncation
was an ordinary rule of specificity (0,3,0), so an author rule with an id in it
— `#chapter p { margin-top: 30px }` — beat it, and the margin at the top of
every continued page came back. It is `!important` now, which is what a rule
the author cannot see ought to be.

On this host the corpus did not move: 122/122 paginate, the content property
holds on all of them, the one known overflow (`infinite-loop`) remains, and no
fixture's page count changed — 110/122 agree with Paged.js before and after.

**The WPT subset now runs.** `wpt.mjs --folio` paginates each of the 235
`-print` reftests and its reference with the engine and compares them page by
page, with Chromium's own print of the reference as the page-count oracle — our
test agreeing with our reference is otherwise only consistency, and
vertical-writing tests passed that way with vertical writing unimplemented.
The first measurement is 51/235 on Chromium and 53/235 on Firefox, family by
family in `native-support.md`, and every failure is written down by cause in
`wpt-failures.md`, which is M6's working list. The `box-decoration-break-*` reftests are
multicol and exercise the browser's own fragmenter, so they stay in the native
column. `css-gcpm` is searched now too: its `leader()` and `string-set` tests
are manual, with no reference, and the runner lists them without scoring them.

**It found six engine bugs on its first run**, listed in `native-support.md`;
the three that change what gets printed are worth knowing here. The engine's
own elements were `<div>`s and so were styled by the author's `div` rules — the
page boxes, the content areas and the box the fragmenter measures in
(`src/furniture.ts`). `100vh` meant a 0×0 frame while measuring and the
reader's window when shown (`css/viewport.ts`). And text directly in a
container beside blocks was not content to the fragmenter, so the forced break
after a body's opening sentence was dropped. That last fix is fragmenter code,
and it took the budget to **1,999 of 2,000**: it first came to 2,009, and was
brought back by writing it more tightly, not by moving code out. The next
piece of fragmenter work is a design review.

---

## Standing gates

These apply to every milestone, not just the one being worked on.

- **Clean-room.** No reading Vivliostyle source while writing the equivalent
  module, and no porting its test files. Design decisions are recorded with
  their sources: specs, WPT, public issues.
- **Deletion conditions.** Every polyfill module exports `nativeSupport()` and
  names the WPT tests whose passing makes it deletable. Built 2026-09-25
  (`deletion.ts`, `deletion.mjs`; `plan.md` §8 says how, and which files are
  the exempt engine). CI runs each browser
  twice where native support exists, once with the module on and once off. When
  the "off" runs pass everywhere, the module goes.
- **Line budgets.** Fragmenter under 2,300 lines (2,100 until 2026-09-24,
  raised by decision); math under 1,000. A budget
  crossed is a design review, not an edit to this file.
- **The properties hold at every milestone.** Every character exactly once; no
  page overflows; forced breaks honoured; same input, same positions; stage 5
  settles; equation numbers consecutive. A milestone that breaks one of these on
  an earlier milestone's fixtures is not done.
- **Scope.** The feature map in `plan.md` §4 is the scope. Adding an N, F or P
  row is ordinary work; anything requiring C is a separate decision.
