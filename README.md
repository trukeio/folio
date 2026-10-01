# Truke Folio

A client-side paged-media engine. Give it an HTML document styled with CSS
Paged Media and it lays the document out as pages, in the browser, with no
server and no PDF step: page sizes and margins, running heads and page
numbers, named pages, footnotes, tables that split and repeat their headers,
cross-references that know which page they point to, tables of contents with
dot leaders — and mathematics, laid out and broken across lines and pages as
part of the same problem.

It is an alternative to [Paged.js](https://pagedjs.org) with the same feature
surface and a drop-in replacement for its script tag, built on a different
design (below). All 122 fixtures of the Paged.js spec corpus paginate with
nothing changed but the script tag.

```html
<script src="/dist/folio.polyfill.js"></script>
<style>
  @page { size: A5; margin: 18mm 16mm; @bottom-center { content: counter(page) } }
  h1 { break-before: page }
</style>
```

That is a complete integration: the document paginates itself when it loads.

**Coming from Paged.js.** Point the script tag at `folio.polyfill.js` where it
named `paged.polyfill.js`. `window.PagedConfig`, `Paged.registerHandlers` and
the `pagedjs_*` classes carry over; [`doc/compat.md`](doc/compat.md) lists
what differs. A project that vendors Paged.js can instead copy
`dist/paged.polyfill.js` over its own: it is the same file under the old name.

**Status.** See [What works and what does not](#what-works-and-what-does-not).

**Browsers.** Chromium 109, Firefox 115 and Safari 16.4 or later. The floor is
set by MathML Core, which the math layout relies on.

**Do not rush to replace Paged.js with it.** This engine is new; Paged.js is
battle-tested, with years of real books and real users behind it. Passing the
corpus and a share of WPT is not the same as having been through that. If
Paged.js does what your project needs, keep it.

---

## Contents

- [Quick start](#quick-start)
- [Deploying it in a web app](#deploying-it-in-a-web-app)
- [Writing the CSS](#writing-the-css)
- [Why it is built this way](#why-it-is-built-this-way)
- [What works and what does not](#what-works-and-what-does-not)
- [Developing](#developing)
- [Documentation](#documentation)

---

## Quick start

```sh
pnpm install
pnpm build        # writes dist/
pnpm examples     # serves the repository at http://127.0.0.1:5180/examples/
```

The engine is not published to npm; `pnpm build` produces the files you host
(see [Deploying](#deploying-it-in-a-web-app)). Five runnable examples ship
with it: one for each way in, below, `examples/math/` for mathematics, and
`examples/report/` for text, mathematics and tables together in a sans family.

### 1. A document that paginates itself — the drop-in

`examples/drop-in/`. One script tag and ordinary CSS. When the DOM is ready,
the script paginates the document it is in, replaces the body with the pages,
and keeps the original content in a `<template>`.

```html
<!doctype html>
<script src="/dist/folio.polyfill.js"></script>
<style>
  @page {
    size: 148mm 210mm;                                  /* A5 */
    margin: 18mm 16mm 20mm;
    @top-center    { content: string(chapter) }        /* running head */
    @bottom-center { content: counter(page) }
  }
  @page :first { @top-center { content: none } }

  h2 { string-set: chapter content(); break-after: avoid }
  p  { orphans: 2; widows: 2 }
  section { break-before: page }
  .note { float: footnote }                             /* to the foot of its page */
  a.xref::after { content: " (p. " target-counter(attr(href), page) ")" }

  @media screen {                                       /* chrome around the pages */
    body { background: #f4f4f6 }
    .pagedjs_page { background: #fff; margin: 1rem auto; box-shadow: 0 1px 6px #0003 }
  }
</style>

<section>
  <h2>First chapter</h2>
  <p>Text…<span class="note">A footnote.</span> See <a class="xref" href="#two">the next chapter</a>.</p>
</section>
<section id="two">
  <h2>Second chapter</h2>
  <p>More text…</p>
</section>
```

If a project already loads Paged.js, changing the `src` is the whole migration.
`window.PagedConfig` works as it does there (`auto`, `content`, `renderTo`,
`stylesheets`, `before`, `after`), and so do `window.Paged.Previewer`,
`Paged.Handler` and `Paged.registerHandlers`. What carries over and what does
not is in [doc/compat.md](doc/compat.md).

### 2. Pages inside an application — the `Previewer`

`examples/previewer/`. When the pages are part of something else — a preview
pane, an editor, a reader — paginate one element, into another, when you
decide to:

```html
<article id="manuscript" hidden>
  <h1>A Short Book</h1>
  <ol class="toc">
    <li><a href="#one">The first chapter</a></li>
    <li><a href="#two">The second chapter</a></li>
  </ol>
  <section class="chapter" id="one"> … </section>
  <section class="chapter" id="two"> … </section>
</article>
<button id="go">Paginate</button>
<div id="preview"></div>

<style>
  @page { size: A5; margin: 18mm 16mm }
  .chapter { break-before: page }
  /* A table of contents: dots to the end of the line, then the page number. */
  .toc a::after { content: leader(dotted) " " target-counter(attr(href), page) }
</style>

<script type="module">
  import { Previewer } from "/dist/folio.mjs";

  document.getElementById("go").addEventListener("click", async () => {
    const previewer = new Previewer({ maxPages: 500 });
    // What to paginate, extra stylesheets (the document's own are always
    // read), and where the pages go — Paged.js's argument order.
    const flow = await previewer.preview("#manuscript", [], "#preview");
    console.log(`${flow.total} pages`, flow.overflowed);
  });
</script>
```

`preview()` resolves to `{ total, pages, records, performance, size,
overflowed }`. `overflowed` lists pages whose content did not fit — a bug,
reported rather than hidden. `records` are plain data, one per page, which is
what lets a single page be laid out again later.

`Previewer` settings: `maxPages` (a hard stop), `pageDefaults` (the default
page when the document names none, as `@page` declarations such as
`"size: A4; margin: 20mm"` — it is the *user agent's* page, so any `@page` in
the document overrides it), `mathFont` (a font family that must have an
OpenType `MATH` table, checked before anything is measured) and `handlers`.

### 3. A reader with navigation — the library and the viewer

`examples/viewer/`. Run the stages yourself and hand the result to the viewer,
which adds spreads, zoom and page navigation and keeps only the pages near the
viewport in the DOM — a 300-page book costs a screenful:

```js
import * as folio from "/dist/folio.mjs";
import { renderViewer } from "/dist/folio-viewer.mjs";

const doc = await folio.normalize(document);        // fonts, images, CSS, @page
const frame = folio.createEngineFrame(document);    // where pages are measured
const style = frame.contentDocument.createElement("style");
style.textContent = `body{margin:0}\n${doc.authorCss}`;
frame.contentDocument.head.append(style);
await frame.contentDocument.fonts.ready;

const result = folio.paginate({
  source: document.getElementById("book"),
  pageRules: doc.pageRules,
  target: frame.contentDocument,
  references: doc.references,
});

const view = renderViewer({
  host: document.getElementById("pages"),
  sheets: result.sheets,
  records: result.records,
  spreads: true,
  onPage: (n) => console.log("page", n, "of", view.total),
});
view.goTo(12);   // also next(), previous(), setZoom(z), setSpreads(on), destroy()
```

Each stage is described in [doc/using.md](doc/using.md).

---

## Deploying it in a web app

`pnpm build` writes everything to `dist/`. Copy the files you need next to
your application's static assets and load them like any other script; there
is no runtime dependency and nothing to configure on a server.

| File | Load it as | Gives you |
| --- | --- | --- |
| `folio.polyfill.js` | `<script src>` | The drop-in: paginates the page on load. |
| `paged.polyfill.js` | `<script src>` | The same file under Paged.js's name. |
| `folio.js` | `<script src>` | `window.folio`, the library. |
| `folio.mjs` | `import` | The library as an ES module. |
| `folio-viewer.js` | `<script src>` | `window.folioViewer`. |
| `folio-viewer.mjs` | `import` | The viewer as an ES module. |

Each has a `.min.js` beside it (about 65 kB for the engine). Develop against
the unminified file: a paged-media engine is debugged in the browser's
inspector.

**Choosing the way in.** Use the drop-in when the pages *are* the page — a
document that prints itself. Use the `Previewer` or the library when the pages
are part of something else. The drop-in takes over the body; the library
touches only the element you give it and the one you render into.

**Things that will catch you:**

- **Style the content, not its container.** A page is composed from the
  *children* of the element you paginate, so `#manuscript p { … }` matches in
  your document and nothing on a page. Use `p`, or classes on the content.
- **`@media print` is honoured and `@media screen` is dropped** while
  measuring, because the pages are built for print. Screen-only chrome around
  the pages (a grey backdrop, shadows) still works, as in the examples.
- **Fonts decide where pages break.** Pagination waits for fonts and images;
  a web font that loads *after* pagination has moved every break. Load it
  before you paginate.
- **The engine adds its own elements** (`folio-page`, `folio-content`, …,
  carrying Paged.js's `.pagedjs_*` class names) and a hidden `<iframe>` hung
  off `<html>`, which is where pages are measured. Neither is ever a `div`, so
  your `div { … }` rules do not reach them.

**Printing.** The pages are ordinary DOM at their real size, so the browser's
print dialogue prints them. Give the browser's own page no margin, or it adds
a second set around the ones the engine drew:

```css
@media print {
  @page { margin: 0 }
  .pagedjs_pages { padding: 0 }
}
```

**Content Security Policy.** The engine writes `<style>` elements and inline
`style` attributes into the page and into its measuring frame, so a policy
needs `style-src 'unsafe-inline'` (or equivalent) for the pages to render.

---

## Writing the CSS

Ordinary CSS Paged Media 3, CSS Fragmentation 3/4 and GCPM 3. A tour:

```css
@page {
  size: 6in 9in;                 /* or A4, A5, letter, "A4 landscape" */
  margin: 20mm 18mm;
  bleed: 3mm;
  marks: crop cross;
  @top-center    { content: string(chapter) }
  @bottom-center { content: counter(page) " of " counter(pages) }
}
@page :first { @top-center { content: none } }
@page :left  { margin-inline: 16mm 24mm }
@page chapter { size: A5 }                 /* a named page… */
h1 { page: chapter; break-before: right }  /* …and what starts one */

h2 { string-set: chapter content(); break-after: avoid }
p  { orphans: 3; widows: 3 }
figure { break-inside: avoid }
table { break-inside: auto }               /* thead and tfoot repeat */
.box { box-decoration-break: clone }       /* borders on every fragment */
.note { float: footnote; footnote-policy: line }
a.ref::after { content: " (p. " target-counter(attr(href), page) ")" }
.toc a::after { content: leader(dotted) " " target-counter(attr(href), page) }
```

**Mathematics is MathML.** Put `<math display="block">` in the document: it is
laid out by the browser's MathML Core implementation, broken across lines when
it is wider than the measure, split across pages like any other block,
numbered, and referable with `target-counter(#eq, equation)`. Quality comes
from the font — use one with an OpenType `MATH` table (STIX Two Math, Latin
Modern Math) and name it in `mathFont` to have it checked.

```css
math[display="block"] { math-number: yes }          /* which equations get "(n)" */
.chapter { counter-reset: equation }                 /* numbering restarts here */
h2 { string-set: chapter content(element) }          /* a formula in a running head */
a.eq::after { content: "(" target-counter(attr(href), equation) ")" }
a.eqpage::after { content: " on page " target-counter(attr(href), page) }
```

`examples/math/` shows all of it; `examples/report/` does the same with a sans
math font, Noto Sans Math beside IBM Plex Sans. [doc/math.md](doc/math.md) is
the detail.

---

## Why it is built this way

Paged.js showed that paged media in the browser is worth having, and where it
hurts. These are the decisions that differ, and why. The full argument is in
[doc/plan.md](doc/plan.md); what they bought in code size, download size and
speed, against Paged.js and MathJax, is measured in
[doc/rationale.md](doc/rationale.md).

**The browser lays out; JavaScript only decides where to break.** Every line,
glyph and box is placed by the browser's own layout engine. The engine's job
is the one thing browsers do not do on screen: choose where each page ends.
It does not use CSS multi-column to find breaks, which is Paged.js's trick:
a spike measured that approach across engines and found Firefox ignoring
forced breaks and two engines ignoring `widows` — so breaks are chosen in
JavaScript, from measured candidates with costs (`break-*`, widows and
orphans, keeping headings with what follows), cheapest that fits.
([doc/review.md](doc/review.md) §1)

**Pages are generated from a source that never changes.** Paged.js moves the
document into pages as it goes, so each page depends on every page before it.
Here the source is read-only, and a page is `(spec, start)` — a page
description and a position in the source, plain data. Composing page 40 does
not require pages 1–39; laying one page out again is a function call; and a
whole class of bugs (content lost or duplicated when a page is rebuilt) cannot
happen. The invariant is checked on every fixture: every source character
appears exactly once across the pages.

**No CSS cascade of its own.** Browsers throw away properties they do not
know — `string-set`, `float: footnote`, `footnote-policy` — which is why paged
engines usually write their own cascade. This one renames them to custom
properties (`--x-string-set`), which every browser *does* cascade, with
specificity, layers, nesting and `!important`, and reads the answer back.
Author CSS keeps meaning what it means as browsers gain features.

**Built to shrink.** Every polyfill module names the condition under which it
can be deleted — usually "when browsers pass these WPT tests" — and the WPT
suite is run both against bare browsers and with the engine loaded
([doc/native-support.md](doc/native-support.md)). The engine should get
smaller as browsers improve, not larger.

**Every read of layout goes through one interface.** The break logic never
touches the DOM directly; it asks a `Measurer`. That is what lets it be unit
tested against synthetic boxes, with no browser, and it is why the fragmenter
has a line budget (under 2,100) that it is held to.

**Mathematics is a layout problem, not a plugin.** Breaking an equation that
is too wide for the line is the page-breaking algorithm turned ninety degrees,
so the same fragmenter does both. Glyph placement is the browser's MathML
Core implementation driven by the font's OpenType `MATH` table; the engine
never positions a glyph. That is how "equation (3.4) on page 128" costs almost
nothing extra.

**Linear in the length of the book.** Each page measures a chunk of what
remains, not the whole remainder, so doubling a book doubles the work: a
278-page book paginates in about five seconds, and CI holds the engine to a
budget counted in composed DOM nodes rather than seconds, because node counts
are identical on every machine.

**The engine's furniture is not the author's.** Pages are measured in a hidden
frame outside the paginated element, and every element the engine creates has
a name of its own. Both rules came from bugs where the engine measured its own
apparatus as if it were content.

**Clean-room.** Vivliostyle is AGPL: its behaviour, documentation and issues
are studied, its source is not read. Paged.js (MIT) and WPT (BSD-3) are used
directly — the Paged.js spec corpus is the differential baseline.

---

## What works and what does not

Works: `@page` sizes, margins, `:first`/`:left`/`:right`/`:blank`/`:nth()`,
named pages, the sixteen margin boxes, `counter(page)`/`counter(pages)` and
custom counters across pages, `bleed` and crop/cross marks, `@media print`,
`break-before/after/inside`, widows and orphans, split tables with repeated
headers and footers, `box-decoration-break`, `margin-break`, running heads
(`string-set`, `position: running()`, `content(element)`), footnotes with
`footnote-display` and `footnote-policy`, `target-counter()`, `target-text()`,
`leader()`, and MathML with line breaking, numbering and references. Also:
footnotes split across pages, page floats (`float: top | bottom | snap-block`
with `float-reference: page`), `::nth-fragment()`, content taller than a page
(sliced across pages), vertical writing, margin-box sizing as css-page-3 §5.3
has it, `@page` inside `@layer`, and TeX input.

Not done, by decision: `position: fixed` repeating on every page, structural
selectors (`:nth-child`, `+`, `~`) that know which page a clone is on,
multi-column layout inside pages, and a table row taller than a page. A page
also carries one break position, which limits how content taller than a page
can be sliced ([doc/review.md](doc/review.md) §4). The full, test-by-test list of what WPT says is wrong is
[doc/wpt-failures.md](doc/wpt-failures.md); the milestones, M6's table
included, are in [doc/milestones.md](doc/milestones.md).

---

## Developing

```sh
pnpm install
pnpm exec playwright install chromium firefox   # a large download; once
pnpm typecheck
pnpm test                                       # unit tests, no browser
pnpm exec playwright test --project=chromium    # browser tests
node packages/test/wpt.mjs --folio            # WPT with the engine loaded
```

The workspace is `@truke/folio` (the engine), `@truke/folio-viewer`,
`@truke/folio-temml` (optional TeX input for math) and `@truke/folio-test` (harness,
fixtures and the Paged.js corpus). The full list of test and measurement
commands, and what each one is for, is in [CLAUDE.md](CLAUDE.md).

---

## Documentation

| Document | For |
| --- | --- |
| [doc/using.md](doc/using.md) | Loading the engine in a web app, stage by stage. |
| [doc/compat.md](doc/compat.md) | Migrating from Paged.js: what carries over, what differs. |
| [doc/plan.md](doc/plan.md) | The design: pipeline, fragmenter, feature map, CSS strategy, math. |
| [doc/rationale.md](doc/rationale.md) | What replacing Paged.js and MathJax gained and cost: lines, bytes, speed. |
| [doc/math.md](doc/math.md) | The math subsystem in detail. |
| [doc/milestones.md](doc/milestones.md) | Milestones M0–M6, exit checks and what is next. |
| [doc/native-support.md](doc/native-support.md) | What browsers do natively, and WPT with the engine loaded. |
| [doc/wpt-failures.md](doc/wpt-failures.md) | Every WPT failure, by cause. |
| [doc/differential.md](doc/differential.md) | Where this engine and Paged.js disagree on the corpus, and why. |
| [doc/README.md](doc/README.md) | Ground rules and scope. |

## Contributing

The project is open source, but maintained with little time to spare, so pull
requests will be accepted rarely — mainly for bugs. A bug report with a small
document that reproduces it is the most useful contribution, and the one most
likely to be acted on. Please open an issue before starting on a feature: it
will probably not be merged, however good it is.

## License

MIT, © 2026 Rolf Veen. See [LICENSE](LICENSE). The TeX bundles include
Temml (MIT), and the test fixtures and examples include Paged.js (MIT) and
fonts under the SIL OFL: see [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
