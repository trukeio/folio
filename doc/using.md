# Using Folio in a web app

Two ways in, and the choice is not about taste. Use the **drop-in** when the
pages *are* the page — a document that prints itself. Use the **library** when
the pages are part of something else — a preview pane, an editor, a reader.

Everything below assumes `pnpm build`, which writes `dist/`. There is nothing
to configure: the engine reads CSS Paged Media out of the document's own
stylesheets and has no options of its own.

```
pnpm install
pnpm build          # -> dist/
pnpm examples       # -> http://127.0.0.1:5180/examples/
```

## What is in `dist/`

| File | Load it as | Gives you |
| --- | --- | --- |
| `folio.polyfill.js` | `<script src>` | Paginates the page on load. |
| `paged.polyfill.js` | `<script src>` | The same file under Paged.js's name. |
| `folio.js` | `<script src>` | `window.folio` — the library. |
| `folio.mjs` | `import` | The same, as a module. |
| `folio-viewer.js` | `<script src>` | `window.folioViewer`. |
| `folio-viewer.mjs` | `import` | The same, as a module. |
| `folio-tex.js` | `<script src>` | TeX in, MathML out, before pagination. `window.folioTeX`. |
| `folio-math.js` | `<script src>` | The math with no pages: numbers, breaks, references (§5). |
| `folio-math-tex.js` | `<script src>` | The same, TeX converted first. |

`.min.js` sits beside each. The unminified file is the one to develop against:
a paged-media engine is something you debug in the browser's inspector, and a
stack trace through minified output helps nobody.

## 1. The drop-in

One script tag. Nothing to call.

```html
<script src="/dist/folio.polyfill.js"></script>
<style>
  @page {
    size: 148mm 210mm;              /* A5 */
    margin: 18mm 16mm 20mm;
    @bottom-center { content: counter(page) }
  }
  h2 { string-set: chapter content(); break-after: avoid }
  p  { orphans: 2; widows: 2 }
</style>
```

When the DOM is ready the script paginates the document it is in, replaces the
body with the pages, and parks the original content in
`<template data-ref="pagedjs-content">`. It is a Paged.js drop-in: if a project
already loads `paged.polyfill.js`, pointing the `src` at `folio.polyfill.js` is
the whole migration. A project that vendors Paged.js can copy
`dist/paged.polyfill.js` over its own instead and touch no markup: it is the
same file under the old name. `doc/compat.md` says what carries over and what
does not.

Control it with `window.PagedConfig`, set **before** the script tag:

```html
<script>
  window.PagedConfig = {
    auto: false,                 // do not paginate on load
    content: "#book",            // what to paginate (default: <body>)
    renderTo: "#preview",        // where the pages go (default: <body>)
    stylesheets: ["/print.css"], // extra CSS, after the document's own
    before: async () => {},
    after: async (flow) => console.log(flow.total, "pages"),
  };
</script>
<script src="/dist/folio.polyfill.js"></script>
```

With `auto: false`, paginate when you like:

```js
const flow = await window.Paged.previewer.preview();
```

**Example:** `examples/drop-in/` — an A5 booklet with a running head, a
footnote, a figure and a cross-reference that resolves to a page number.

## 2. The `Previewer`

The drop-in's engine, without the takeover: paginate one element into
another, when the application decides to.

```js
import { Previewer } from "/dist/folio.mjs";

const previewer = new Previewer({
  maxPages: 500,
  pageDefaults: "size: A4; margin: 20mm",   // optional; any @page overrides it
});
const flow = await previewer.preview("#manuscript", [], "#preview");
// flow: { total, pages, records, performance, size, overflowed }
```

The arguments are Paged.js's: what to paginate (an element or a selector;
default `<body>`), extra stylesheet URLs to add after the document's own, and
where the pages go (default `<body>`). The source is left in place, parked in
a `<template>` inside it. `pageDefaults` is the user agent's page — what a
document with no `size` gets, and what `size: landscape` alone rotates — so
any `@page` rule in the document still wins over it.

**Example:** `examples/previewer/` — a manuscript paginated into a preview
pane when a button is pressed, with a table of contents that uses `leader()`
and `target-counter()`, a footnote and a cross-reference.

## 3. The library

Five stages, and only one of them does any work.

```js
import * as folio from "/dist/folio.mjs";
import { renderViewer } from "/dist/folio-viewer.mjs";

const source = document.getElementById("book");

// 1. Read the document: wait for fonts and images, collect the CSS, pull the
//    `@page` rules out of it. The document is never modified.
const doc = await folio.normalize(document);

// 2. Pages are measured somewhere that is not your application's layout.
const frame = folio.createEngineFrame(document);
const target = frame.contentDocument;
const style = target.createElement("style");
style.textContent = `body{margin:0}\n${doc.authorCss}`;
target.head.append(style);
await target.fonts.ready;

// 3-5. Fragment, compose, resolve references.
const result = folio.paginate({
  source,
  pageRules: doc.pageRules,
  target,
  references: doc.references,   // target-counter(), target-text()
  maxPages: 2000,
});

// Show it.
const view = renderViewer({
  host: document.getElementById("preview"),
  sheets: result.sheets,
  records: result.records,
  spreads: false,
  onPage: (n) => console.log("page", n),
});
```

`result` carries `records` (`(spec, start, end)` per page — plain data, no
nodes), `sheets` (the pages), `overflowed` (pages whose content did not fit:
a bug, reported rather than hidden), `running`, `footnotes` and `counters`.

The viewer takes `goTo(n)`, `next()`, `previous()`, `setZoom(z)`,
`setSpreads(on)`, `current`, `total` and `destroy()`. It renders only the
pages near the viewport, so a 300-page book costs a screenful.

**Example:** `examples/viewer/` — 46 pages with spreads, zoom and navigation.

## 4. Mathematics written in LaTeX

The engine takes MathML (`math.md` §8). A document written for MathJax, with
`\( … \)` inline and `\[ … \]` display, needs one more script tag, which
turns the TeX into MathML before anything is measured (`tex.md`):

```html
<script>
  window.FolioTeX = {};   // the defaults; every option is below
</script>
<script src="/dist/folio-tex.js"></script>
<script src="/dist/folio.polyfill.js"></script>
```

Put it before the polyfill. After it works too, unless the scripts are
`defer`red: then the polyfill starts before the TeX script has run.

| Option | Default | What it does |
| --- | --- | --- |
| `inline` | `[["\\(", "\\)"]]` | Inline delimiters: pairs of plain strings |
| `display` | `[["\\[", "\\]"]]` | Display delimiters |
| `environments` | `true` | Bare `\begin{equation}`, `align`, `gather`, `multline`, `alignat`, `flalign` and starred forms, with no delimiters |
| `refs` | `true` | `\ref{…}` and `\eqref{…}` in running text become links |
| `tags` | `"ams"` | Which displays are numbered: `"ams"` (unstarred environments), `"all"`, `"none"` |
| `macros` | `{}` | `{ "\\RR": "\\mathbb{R}" }`, in force in every formula |
| `ignore` | `script, style, textarea, pre, code, math, svg, .tex-ignore` | Not searched |
| `process` | `null` | A selector searched even inside an ignored subtree |
| `annotate` | `true` | Keep the TeX as `<annotation encoding="application/x-tex">` |
| `onError` | `"show"` | A formula that does not parse is shown as its source; `"throw"` stops |
| `onReport` | console | Called with what the run found; unset, problems are logged |

Dollars are not delimiters by default, because `$` is ordinary text on a
page about prices and a templating language's sigil on many others. Add
them if the document uses them: `inline: [["$", "$"], ["\\(", "\\)"]]`,
`display: [["$$", "$$"], ["\\[", "\\]"]]`. `\$` is then a dollar.

What becomes what:

- `\label{key}` is the `<math>`'s id, verbatim, so `href="#key"` reaches it.
- A numbered display gets class `tex-numbered`, which the package's
  stylesheet maps to `math-number: yes`. The engine counts it, restarting
  wherever your CSS says `counter-reset: equation`.
- `\tag{7a}` prints `(7a)` and is not counted; `\tag*{A}` prints `A`.
- `\eqref{key}` is `<a class="tex-eqref" href="#key">`, printing `(n)`, and
  `\ref{key}` is `<a class="tex-ref">`, printing `n`. Their `::after` is
  yours to restyle. The package's rules come first in the document, so a
  rule of your own with the same selector wins:

  ```css
  a.tex-eqref::after {
    content: "(" target-counter(attr(href url), equation) ") on page "
             target-counter(attr(href url), page);
  }
  ```

- `\newcommand`, `\renewcommand`, `\def` and `\DeclareMathOperator` hold for
  the rest of the document, as in MathJax.

With the library instead of the drop-in, pass the handler to the previewer, or
convert first and paginate after:

```js
import { createTeXHandler, renderTeX } from "@truke/folio-temml";

await new Previewer({ handlers: [createTeXHandler({ tags: "all" })] }).preview("#book");
// or, by hand, before stage 1:
const report = renderTeX(document.querySelector("#book"), { tags: "all" });
```

A formula cannot cross an element: `\( a <em>b</em> \)` is two pieces of
text, and is reported as an unclosed `\(`. And a `<` inside a formula must be
written `&lt;` or `\lt`. The HTML parser reads the page before the TeX
script does, and `\(a<b\)` is the start of a tag named `b`.

**Example:** `examples/tex/` — `examples/math/` written in LaTeX. The two
paginate alike, page for page and number for number
(`packages/test/browser/tex.spec.ts`).

## 5. The same mathematics on a screen

A page that shows mathematics and needs no pages loads the math drop-in in
place of the polyfill (`math-drop-in.md`). The equations are numbered, the
wide ones broken to the width they have, and references filled, as in the
book, with no pages made. The source and `window.FolioTeX` stay exactly as
they are:

```html
<script>
  window.FolioTeX = {};                         // as for the book
  window.FolioMath = { content: "#book", mathFont: "STIX Two Math" };
</script>
<script src="/dist/folio-math-tex.js"></script> <!-- or folio-math.js for MathML -->
```

| Option | Default | What it does |
| --- | --- | --- |
| `content` | `body` | The element, or a selector for it |
| `mathFont` | none | Check this family has a `MATH` table first, and throw if not |
| `reflow` | `true` | Break displays again when their container changes width |
| `auto` | `true` | Run on load; `false` leaves it to `folioMath.folioMath(root, options)` |
| `after` | none | Called with `{ equations, broken, overflowed, disconnect }` |

`folioMath.ready` is a promise of the same result. A reference to a page
prints no number on a screen, since there is no page: put such rules in
`@media print`, which the book reads and the screen does not. Loaded beside
`folio.polyfill.js`, the drop-in does nothing.

## Three things that will catch you

**Style the content, not its container.** A page is composed from the *children*
of the element you hand to `paginate`, so that element is never an ancestor of
anything on a page. `#book p { … }` matches in your document and nothing at all
on a page. Use `p`, or a class on the paragraphs. Paginating `<body>` hides
this, because a bare selector has no container to reach through.

**`@media print` is honoured; `@media screen` is dropped.** The pages are built
for print even though you are looking at them on a screen. Print rules are
unwrapped and applied, screen rules are removed. Screen-only chrome around the
pages — a grey backdrop, a drop shadow — still works, because the document's
own stylesheets stay where they are and the engine's rewritten copy is added
after them.

**Fonts decide where pages break.** `normalize` waits for fonts and images
before anything is measured, which is why it is `await`ed. Paginating against
a fallback font gives page breaks for a document nobody will see.

## Writing the CSS

Ordinary CSS Paged Media and GCPM. The parts that work are in `plan.md` §4;
the parts that do not are in `compat.md` and in the status block of
`CLAUDE.md`. A short tour:

```css
@page {
  size: 6in 9in;              /* or A4, letter, "A4 landscape" */
  margin: 20mm 18mm;
  bleed: 3mm;                 /* painting area past the trim edge */
  marks: crop cross;          /* printer's marks, outside the bleed */

  @top-center    { content: string(chapter) }
  @bottom-center { content: counter(page) " of " counter(pages) }
}
@page :first { @top-center { content: none } }
@page :left  { margin-inline: 16mm 24mm }
@page chapter { size: A5 }         /* named, selected by `page: chapter` */

h1 { page: chapter; break-before: right }
h2 { string-set: chapter content(); break-after: avoid }
p  { orphans: 3; widows: 3 }
table { break-inside: auto }        /* thead and tfoot repeat on their own */
.note { float: footnote }           /* moves to the foot of its own page */
a.ref::after { content: " (p. " target-counter(attr(href), page) ")" }
figure { break-inside: avoid }
```

Mathematics is MathML: put `<math>` in the document and it is laid out, broken
across the measure if it is too wide, numbered, and referable with
`target-counter(#eq, equation)`. See `math.md`. TeX input is a separate,
optional package.

## Printing

The pages are ordinary DOM at their real size, so the browser's own print
dialogue produces them, one sheet to a sheet of paper, with nothing to add.

That takes a stylesheet of the engine's own, `folio-print-css`, which the
`Previewer` (and so the drop-in) puts in the document with the pages. The
document still carries your `@page` rules, and Chromium applies them itself
when printing: without that stylesheet every page number came out twice —
the browser's `@bottom-center` beside the engine's — and every sheet was
shrunk to fit inside your margins. In print media it makes the browser's page
exactly the engine's sheet, size included, with no margins and no margin
boxes, and it wins over any `@page` rule you wrote, `:first` and named pages
included. Nothing of yours needs to change, and an older `@media print {
@page { margin: 0 } }` of your own is harmless. Firefox does not draw your
margin boxes itself, so it never printed the number twice, but it did shrink
each page into your margins, and the same stylesheet stops that. Firefox's
automated (silent) printing uses the printer's paper rather than the page's
size; check the paper size in its print dialogue.

The viewer does the same for its own pages, and two things more, because it
lives inside an application. It mounts every page before printing — it keeps
only the pages near the viewport in the document, and the rest used to print
as blank placeholders — and lets the far ones go again afterwards. And in
print it shows nothing but its own pages: the application around them (a
toolbar, a sidebar) is hidden, zoom and spreads are undone, and each page is
one sheet at its own size.

## On a server

There is no CLI of the engine's own, because there is nothing for one to do
that headless Chromium does not: paginate in the page, then print it.
`scripts/pdf.mjs` is that, in one command, and also the recipe to copy into a
service:

```
pnpm build
pnpm pdf book.html                       # -> book.pdf
pnpm pdf book.html -o out/book.pdf --page-defaults "size: A4; margin: 20mm"
pnpm pdf site/report.html --root site    # the page asks for /dist/folio.js
pnpm pdf https://example.com/report.html -o report.pdf
```

It serves a local file over HTTP rather than opening it as `file://`, because
the engine reads the author's stylesheets through CSSOM and Chromium will not
let a `file://` page read a linked sheet's rules. Then it does one of three
things:

| The page | What the script does |
| --- | --- |
| Loads `folio.polyfill.js` (or Paged.js) | Lets it run, with the page's `PagedConfig` and handlers (the TeX front end, say), and waits for its `after`. With `auto: false` it calls `preview()` itself. |
| Loads nothing | Injects `dist/folio.js` and runs a `Previewer` on `--content` (default `<body>`). |
| Runs a `Previewer` of its own | Cannot see it begin or end. Pass `--wait` an expression that is truthy once it is done, such as `window.flow` after `window.flow = await previewer.preview(…)`. |

Then it prints with `page.pdf({ preferCSSPageSize: true, printBackground:
true })` and nothing else, because the engine's print stylesheet (above) has
already made Chromium's page exactly each sheet, and a size or margin passed
to `page.pdf` would fight it. It exits 1 if a page overflowed its area, and
writes the PDF anyway.

Three things decide whether the PDF is the one you previewed:

- **Wait for the flow, not for a page.** Pages go into the document only when
  pagination is over, but handlers run after that. Waiting for the first
  `.pagedjs_page` works on a small document and is a race on a large one.
- **Install the fonts.** A server without the document's fonts paginates
  against fallbacks and breaks every page somewhere else. Use `@font-face`,
  or put the same fonts in the container image.
- **Chromium only.** `page.pdf` is Chromium's alone; Firefox and WebKit have
  no print-to-file that Playwright can drive.
