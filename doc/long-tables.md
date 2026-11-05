# Long tables paginated in quadratic time

Reported from Truke KFG1 (`../kfg1/PLAN.md`, step 5, finding P10), 2026-11-05.
Measured with `dist/folio.polyfill.js` and `.min.js` of 2026-10-01 in Chromium (Playwright),
with a `@page` rule, `thead { display: table-header-group }` and
`tr { break-inside: avoid }`.

## What happens

One table whose rows run over many pages takes time that grows with the
square of its rows. The same rows as short tables take time that grows with
the pages.

`examples/long-table/` (4 columns, 3 lines a cell, A4 landscape,
`dist/folio.polyfill.js`), time from the script to `afterRendered`:

| URL | Pages | Time |
|---|---|---|
| `?rows=100` | 10 | 0.33 s |
| `?rows=200` | 19 | 1.12 s |
| `?rows=300` (the default) | 28 | 2.35 s |
| `?split` (300 rows as 30 tables of 10) | 30 | 0.49 s |

Three times the rows cost seven times the time. The output is right in every
case: the header repeats on each page and no row is split.

KFG1's print page made it worse: the same 300 rows with larger cells, on a
named landscape page (`page: wide`) after six portrait pages of text, with
margin boxes and `folio-tex`, took 13 to 18 s for 34 pages, and 6.5 s once the
whole document was landscape. As 30 tables of 10 they took 3.3 s.

## To reproduce

`pnpm examples`, then open `examples/long-table/` with the options above;
`?page=wide` puts the table on a named page. The time is logged to the
console and shown in the title.

## A guess at the cause

Each page re-measures the whole remaining table, or the rows before the
break, instead of starting from the last row placed: a table is one block
whose break candidates are its rows, so each page's break selection may be
linear in the rows left (`candidates.ts`, `compose.ts`, the table path of M3.2).
Not checked against the source.

## What KFG1 does meanwhile

Its FMEA prints one table per item (the item as a band, as KF's own print
does), and its plan one table per top task, so no table runs over many pages.

## The cause, and the fix

The guess was close. The measuring box holds a *chunk* of the document, not
all that remains (`chunk.ts`), and a chunk never ended inside a table: a
table's columns come from all its rows, so the chunk took the whole table.
One table of 300 rows was measured whole on each of its 28 pages. Splitting it
into tables of 10 was the workaround, and `table-layout: fixed` was another.

But the page never holds the whole table either. It holds the rows that fit,
and its columns come from those. So a chunk now ends after the row it landed
in, never inside one (a table with a cell spanning rows is still taken whole).
Measured the same way, in Chromium on this host:

| URL | Pages | Before | After |
|---|---|---|---|
| `?rows=100` | 10 | 0.38 s | 0.24 s |
| `?rows=200` | 19 | 1.14 s | 0.47 s |
| `?rows=300` | 28 | 2.45 s | 0.66 s |
| `?page=wide` | 29 | 2.40 s | 0.66 s |
| `?split` | 30 | 0.55 s | 0.56 s |

Each page holds the same rows as before, on Chromium and Firefox, and the
122 corpus fixtures paginate to the same page counts. The browser test is
"a chunk ends after a table's row" in `paginate.spec.ts`.

## Printing twice (KFG1's P14)

Reported at the same time: Chromium drawing the document's `@page` margin
boxes around each of Folio's pages. Not reproduced with this build: once the
pages are built, `insertPrintCss` (`preview.ts`) gives the browser's page
each sheet's size, no margins and `content: none` for every margin box, all
`!important`. A page with KFG1's furniture (margin boxes on all edges, a
named landscape page, the bar put back after rendering, `folio-tex` first)
prints one number per sheet, at the sheets' sizes, with no bar. The README's
advice to add `@media print { @page { margin: 0 } }` was out of date and
did the harm described; it now says not to.

**Found after all**, the same day: KFG1's PDF was made with screen media
emulated. The author's `@page` rules apply to a PDF then, and the overrides
were inside `@media print`, so they did not. The `@page` and `page:` rules now
sit outside it, in `insertPrintCss` and in the viewer's copy, as they mean
nothing on a screen; hiding what is not a page stays print-only. Checked on
KFG1's demo in Chrome 156 with its workaround removed: seven sheets, one set
of margin boxes each, in print media and in emulated screen media alike
(`print.spec.ts`, "printed with screen media emulated").
