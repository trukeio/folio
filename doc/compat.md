# Paged.js compatibility

M5.1's exit check is "a real Paged.js project runs unchanged, with its script
tag swapped". This file is the rest of that sentence: what runs, what runs
differently, and what does not run — because a compatibility layer whose gaps
are undocumented is a compatibility layer that fails at the worst moment.

The measurement behind it: all 122 fixtures of the Paged.js spec corpus load
with `paged.polyfill.js` intercepted and ours served instead, and every one
paginates to the same page count our own library API produces
(`packages/test/browser/polyfill.spec.ts`). Nothing in the corpus was edited
to make that true.

Paged.js is MIT, and this was written with its source open — the clean-room
rule in `plan.md` §1 is Vivliostyle's alone.

## What a project keeps

| | |
| --- | --- |
| `<script src="folio.polyfill.js">` | Auto-paginates on DOM ready. `paged.polyfill.js` in `dist/` is the same file, for a project that vendors Paged.js and would rather copy a file over it than edit markup. |
| `window.PagedConfig` | `auto`, `before`, `after`, `content`, `stylesheets`, `renderTo`, `settings`. |
| `window.Paged.Previewer` | `new Previewer(settings)`, `previewer.preview(content, stylesheets, renderTo)`. |
| `window.Paged.Handler` | A base class to extend, constructed per preview. |
| `window.Paged.registerHandlers(...)` | Registers handler classes, module-global as it is upstream. |
| The page DOM | `.pagedjs_page`, `.pagedjs_sheet`, `.pagedjs_pagebox`, `.pagedjs_area`, `.pagedjs_page_content`, `.pagedjs_margin`, `.pagedjs_margin-<name>`, `.pagedjs_margin-content`, the edge and corner holders `.pagedjs_margin-top` (`-right`, `-bottom`, `-left`) and `.pagedjs_margin-<corner>-holder`, `.pagedjs_pages`. |
| Page classes | `pagedjs_first_page`, `pagedjs_left_page`, `pagedjs_right_page`, `pagedjs_blank_page`, `pagedjs_<name>_page`. |
| `id="page-N"`, `data-page-number` | On each page, 1-based. |
| `<template data-ref="pagedjs-content">` | The original body content is parked there, as upstream parks it. |

`preview()` resolves to Paged.js's "flow" shape — `total`, `pages`,
`performance`, `size` — plus `records`, which is ours and is what makes
re-laying-out one page a function call.

## What is different, and why

**The DOM under the class names is ours.** Paged.js builds four
`.pagedjs_bleed` elements and eight `.pagedjs_marks-*` on every page whether or
not the document bleeds; ours has none unless `@page` asks for bleed or marks,
and draws marks as positioned hairlines rather than as a fixed skeleton. CSS
that *styles* the named boxes works. CSS that assumes the skeleton — a rule on
`.pagedjs_bleed-top .pagedjs_marks-crop`, say — has nothing to match.

**A page with no bleed is one element.** It carries `pagedjs_page`,
`pagedjs_sheet` and `pagedjs_pagebox` at once, because with no bleed the media
box, the sheet and the page box are the same rectangle. A rule that positions
`.pagedjs_pagebox` *inside* `.pagedjs_sheet` will find nothing to move.

**Margin boxes are placed by css-page-3 §5.3, not by a grid.** Their holders
carry Paged.js's names, but each box is absolutely positioned at the size §5.3
computes from its content and its neighbours', with that size written inline.
A rule that sizes a box with `width` or `margin` works; one that sets
`grid-template-columns` on `.pagedjs_margin-top` to share the edge its own way
is overruled. Layout properties that do not apply to a margin box —
`display`, `position`, `float`, `columns`, `flex` and the like — are ignored,
as the spec says, and a box no longer clips what overflows it unless the author
asks with `overflow`.

**The page counter works as in Paged.js.** `counter-reset: page N` on an
element makes the page it starts on page N, and `target-counter(…, page)`
prints the same number the footer does. `@page { counter-increment: page 2 }`
and page-context counters follow css-page-3 §6.1 as WPT tests it
(`page-counters.ts`). A counter declaration in a margin box counts for that box
alone; it never reaches the document's counters.

**The page area holds the document's root, as css-page-3 §3 says.** Each
page's content sits in clones of `<html>`, `<body>` and whatever lies between
`body` and the element being paginated — `.pagedjs_area > html > body > …` —
where Paged.js puts the content straight into the area (`review.md` §3).
So the root's own box, attributes and rules reach the page: `<body
class="book">` and `body.book p` match, `<body style="page: cover">` names
the first page, `body { display: grid }` and `body { padding: 1em }` lay out
on every page (sliced at the breaks like any split element), and a paginated
`#doc`'s own `font-size` reaches its text. Three things follow that a Paged.js
project can see:

- **A percentage height below the root is a share of the root**, which is
  `auto` unless the author says otherwise, so `#cover { height: 100% }` is its
  content's height; Paged.js made it the page's. Chromium makes it the page's
  only when the author asks with `html, body { height: 100% }`, and that does
  not reach the page here yet either (`review.md` §3.7).
- **The UA's `body { margin: 8px }` is on the page**, as CSS says and Chromium
  prints it: 8px on each side of every page and at the top of the first.
  Paged.js never had it, because its content is not inside a `body`, and a
  project that relied on that sets `body { margin: 0 }`. It costs pages: 26
  of the 122 corpus fixtures, none of which sets a body margin, gained pages,
  and 88 now agree with Paged.js where 111 did. In 19 of the 26 the new
  count is Chromium's own print of the fixture (`review.md` §3.6).
- **The root's background paints the page area**, from `html` or from
  `body` when `html` has none, as one background cut across the pages;
  `@page { background }` paints the whole page, margins included; and a
  page is white where nothing paints it. Until now a `body { background }`
  painted only the host behind transparent pages; an unconditional one — not
  one in `@media screen`, which never reaches the pages — now prints, as it
  does in Chromium.
- **Paginating an element rather than `body`**, what is above it is taken
  to be the application's layout: it passes on inherited values (fonts,
  colour, custom properties) and nothing about its box, so an offscreen
  holder or a sidebar grid on `body` does not reach the pages. The element
  itself keeps its own box.
- **There is a `<body>` on every page.** `document.body` and `querySelector`
  still find the real one, which comes first; `querySelectorAll("body")`
  finds one per page as well.

**The footnote area is inside the content area**, not a sibling of it. We have
no `.pagedjs_footnote_area`; notes land in the engine's own area at the foot of
the page.

**`--pagedjs-*` custom properties are not published.** The geometry is in the
`@page` rules the author wrote and in inline sizes on the page elements. A
project reading `var(--pagedjs-width)` gets nothing.

## Hooks

`milestones.md` §M5.1 decided this: "not 30 hooks that can change any DOM at
any time: a few typed hooks at stage boundaries, operating on data rather than
live DOM". The reason is `plan.md` §2 — the source document is never mutated
and pages are generated from it, so a hook that rewrites live DOM mid-layout
has nothing stable to rewrite.

| Hook | Here |
| --- | --- |
| `beforeParsed(content)` | Yes, before stage 1. |
| `afterParsed(source)` | Yes, with the `SourceDoc`: page rules and rewritten CSS, not a live tree. |
| `afterPageLayout(pageElement, page, breakToken, previewer)` | Yes. `page` is a `PageRecord`, not a Paged.js `Page`; `breakToken` is always `undefined` (see below). |
| `afterRendered(pages)` | Yes, once every page is in the document. |
| `beforePageLayout`, `onPageLayout` | No. A page's geometry is settled before it is composed; there is no moment between. |
| `onOverflow`, `onBreakToken`, `afterOverflowRemoved` | No. These are Paged.js's layout loop. Ours decides breaks from candidates and penalties (`plan.md` §3) and has no overflow to hand back. |
| `layout`, `renderNode`, `layoutNode` | No. Nothing lays out node by node here. |
| `beforeTreeParse`, `beforeTreeWrite` | No. |
| `onDeclaration`, `onContent`, `onAtPage`, `onAtMedia`, `onImport`, `onUrl`, `onSelector`, `onPseudoSelector`, `onRule` | No. The engine owns no CSS cascade (`plan.md` §6); the browser does. Unknown properties are renamed to `--x-*` carriers and cascaded by the browser, so there is no rule object to hand a hook. |
| `onSpread`, `onSpreadElement` | No. Spreads are the viewer's, not the engine's. |

**`breakToken` is always `undefined`, deliberately.** A break here is a
`Position` — a path and an offset into the unchanging source — decided before
the page is composed. Paged.js's break token is a live cursor into a layout
still in progress, and there is no honest way to synthesise one. The parameter
keeps its *position* in the signature because the most widely copied Paged.js
handler in existence, the repeating-table-headers recipe, opens with
`if (breakToken)`; moving our own argument into that slot made the test truthy
and the recipe throw. With `undefined` there it takes the other branch and does
nothing, which is correct — split tables already carry their headers
(`tables.ts`), so the recipe has nothing left to do.

**Register handlers synchronously, or on `document`.** The polyfill starts
when the DOM is ready, as upstream does — upstream on
`readystatechange` → interactive, here on `DOMContentLoaded`. Either way a
project that registers its handlers from a `window` listener is too late:
`DOMContentLoaded` fires *at* the document and only then bubbles to the
window, so the polyfill's own listener has already run. An inline `<script>`,
which is where every Paged.js project puts `registerHandlers`, is always in
time.

**A handler that throws does not take the document with it.** The error is
reported to the console and the render continues. Paged.js's hooks *are* its
layout, so a throw there is fatal by construction; ours run at stage boundaries
on pages that are already correct.

## A MathJax document

Paged.js paginates whatever MathJax has already rendered, `mjx-*` markup and
all (`specs/math/mathjax.html`), and never learns where an equation landed.
Here MathJax is replaced rather than paginated: `folio-tex.js`
(`using.md` §4, `tex.md`) turns the TeX into MathML before stage 1, and the
engine numbers the equations and resolves `\eqref` against the pages. What
a MathJax author notices:

| MathJax | Here | Why |
| --- | --- | --- |
| `$$ … $$` display by default | Not a delimiter unless configured | `$` is a templating sigil in OGDL and elsewhere |
| `tags: "none"` by default | `"ams"` | A book numbers its equations |
| One number per row of a numbered `align` | One number per display, on the last row | The core numbers a `<math>` (`tex.md` §4) |
| `\eqref` prints the number | Prints the number, and the page if your CSS asks | `target-counter()` runs after pagination |
| CHTML or SVG output | MathML Core, drawn by the browser from the font's MATH table | `math.md` §1 |
| `\newcommand` with an optional argument is global | Local to its formula | Temml keeps only `\gdef` across formulas |

## Known not to work

- `position: fixed` content repeated on every page (`differential.md`).
- `counters(name, sep)` with more than one level. It prints the innermost
  value, which is all a margin box can see (css-page-3 §6.1), and in the
  document's own content the counters are counted flat (`counters.ts`).
- Anything depending on the hooks marked "No" above.
