# The math drop-in: formulas without pages

Status: **done** (2026-09-25). A page that has mathematics and no need of
pages should not pay for a paginator. This is the engine's math on its own:
the same MathML, numbered, broken and referred to exactly as the book does
it, in the live document, with no frame and no pages.

The goal in one line: **one source and one configuration give the same
formulas on a screen as in the paged output.** A project renders its
documents to screen with the drop-in and to print with the polyfill, and
changes nothing but the script tag.

It is not a MathJax replacement, and has no MathJax API. The source is
written for this engine — `window.FolioTeX` and the core's CSS
(`math-number`, `target-counter()`) — and it is read the same way in both
places. That is the whole contract.

---

## 1. Two files

| File | Min | Gzip | For |
| --- | --- | --- | --- |
| `folio-math.js` | 26 KB | 10 KB | MathML written by hand or converted at build time |
| `folio-math-tex.js` | 251 KB | 74 KB | `\( … \)` and `\[ … \]`, converted as `folio-tex.js` converts them |
| *for comparison:* `folio.min.js` + `folio-tex.min.js` | 353 KB | 109 KB | The book |

Temml is most of the second file (`tex.md` §6). What the split buys is less
the bytes than the work: no iframe, no copy of the document, no measuring
box, no composition. One walk numbers the equations, one read per display
breaks it.

The split cost no refactoring. `src/math/` already depended on the paginator
for nothing but `chooseBreak`, `resolve` and two attribute names, so the
drop-in is one module beside it, `src/math-screen.ts`, and two script
entries: `src/math-global.ts` in the core and `math-global.ts` in
`@truke/folio-temml`. The core exports it as `@truke/folio/math`, so the TeX
entry does not bundle the paginator by importing the index.

## 2. What it does

`folioMath(root, { mathFont, reflow })`, in order:

1. **Fonts and images**, as stage 1 waits for them (`settle`); `mathFont`
   checks for a `MATH` table and throws without one (`math.md` §3).
2. **The author's CSS, rewritten, after the original** (§3).
3. **Numbers**, by `numberEquations` over the whole root: the author's
   `counter-reset: equation` read through the cascade, the same walk that
   numbers a page, run once over a document that is one page long.
4. **References**, by `applyReferences`: the equation numbers from step 3,
   every other counter from one `countPage` walk of the root and its
   ancestors, paid only when a `target-counter()` asks for one.
5. **Breaking**, by `breakEquations` against each display's own container,
   as a page's area bounds it (`math.md` §6).

The TeX file converts first, with `renderTeX(root, window.FolioTeX)`,
which is what the TeX handler does before stage 1.

**What a screen cannot have** is a page. `target-counter(…, page)` resolves
to nothing, so "on page " is printed with no number after it. A rule that
refers to pages belongs in `@media print`, where the drop-in does not read it
and the book does.

## 3. The CSS is copied, not moved

The engine's CSS is rung P (`plan.md` §5): `math-number: yes` is carried as
`--x-math-number`, and `target-counter()` is rewritten to an `attr()` the
engine fills. Both exist only in rewritten text. The paginator puts that text
in its frame, and a copy on the host (`insertRewrittenCss`); the drop-in has
no frame, so the copy on the host is all there is: `<style
id="folio-math-css">` after the author's sheets, holding them rewritten.
Rules repeated in the same order cascade as they did, so the copy changes
nothing but what it adds.

It is made only when there is something to rewrite, a `math-number` or a
reference. A page of plain MathML gets no copy.

Two details came with it:

- **Screen media.** `collectCss` takes which `media` apply. The book reads
  print; the screen reads what `matchMedia` says.
- **`url()` in a linked sheet is made absolute** against the sheet
  (`rebaseUrls`, `source.ts`). In a `<style>`, `../fonts/x.woff2` resolves
  against the document, so the copy's `@font-face` pointed at nothing and could
  shadow the original, and a copied `background` lost its image. The
  paginator's host copy had the same fault. No corpus stylesheet has a
  `url()`, so no page count moved.

## 4. A window changes width

A page has one width; a window has as many as the reader gives it. Each
display keeps the MathML it had before it was broken — after the references
are filled, so a `\eqref` inside a formula survives — and one
`ResizeObserver` watches each display's container. When a container's inline
size changes, its displays are put back and broken again, once per animation
frame. Breaking changes a container's width only when the container is sized
by its content, and then the same input breaks the same way, so it settles.

`reflow: false` turns it off. Calling `folioMath` again starts over: the
copy is replaced, the numbers counted from the top, each display broken from
its original.

## 5. Not beside the paginator

The drop-in and the polyfill are alternatives. Both would number the same
formulas, and the second count is wrong, not merely wasted. If `window.Paged`
exists when the drop-in would run, it logs a warning and does nothing; the
paginator has done the work.

## 6. The exit check, and the bug it found

`math-drop-in.spec.ts` loads `examples/math/` and `examples/tex/` twice: as
books, and with the paginating script swapped for the drop-in and the article
set to the page area's width. The screen must show the book's equation
numbers by id, its reference text with the page numbers taken out, and the
same rows for every display. It passes on Chromium and Firefox. The spec also
checks the MathML file on its own, breaking again as the window narrows and
widens, and doing nothing beside the polyfill.

The narrowing test found a bug in the core, not in the drop-in.
`splitIntoRows` (`math/compose.ts`) resolved each break's `Position` — child
indices — after the cuts before it had taken children out of the row. So every
break after the first named an operator further on, and a display that needed
three or more rows got one row too few, the middle one overflowing. The book
had it too. `examples/math/` breaks its long equation once, which is why no
test saw it. Every position is now resolved before the first cut, and the
test asserts four rows that fit where there had been three that did not. The
fix is two lines of comment and one of code, so the math budget stands at
1,008 of 1,000.

## 7. Deletion condition

As with `tex.md` §7, this is not a polyfill. It stands in for no browser
feature. It gathers the core's polyfills for use without pages, and goes when
they do: `math/number.ts` when an `mlabeledtr` replacement ships,
`math/candidates.ts` when browsers break display math, `references.ts` when
`target-counter()` is native. It is listed with the engine in `deletion.ts`
because it has no feature of its own to wait for.

## 8. Limits

- **Page references** print without a number (§2). Put them in `@media print`.
- **Printing the screen document** does not break again at the paper's width.
  To print, paginate.
- **Dynamic content** is typeset by calling `folioMath` again on the root.
  Every call counts from the top of the element it is given.
