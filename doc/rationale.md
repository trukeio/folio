# Rationale: what replacing Paged.js and MathJax bought

Folio does what a project used to need two libraries for: Paged.js to
paginate and MathJax to typeset mathematics. This document measures what
that replacement gained in code size, download size and speed, and what it
cost. `plan.md` gives the design argument; this document gives the numbers
that the design produced.

All figures were measured on 2026-10-01 on the development host, against:

| Project | Checkout | Version |
| --- | --- | --- |
| Folio | this repository at `8846ddc` | — |
| Paged.js | `../../pagedjs/pagedjs` at `6b0ff80` (2026-03-20) | `dist/` as built |
| MathJax, source | `../../MathJax/MathJax-src` at `fb987178c` (2026-07-03) | 4.1.3 |
| MathJax, components | `../../MathJax/MathJax` at `0bfa58068` | 4.1.3 |

Reproducing them is in [How the numbers were taken](#how-the-numbers-were-taken).

## Lines of source

Tests are excluded throughout. "Code only" also excludes blank lines and
comment lines, because the projects comment at different rates: Folio's
source is about 40% comments and Paged.js's about 33%.

| | All lines | Code only |
| --- | ---: | ---: |
| Paged.js `src/` | 13,356 | 8,966 |
| MathJax `ts/` | 105,756 | 60,556 |
| **Paged.js + MathJax** | **~119,100** | **~69,500** |
| Folio, all packages | 14,022 | 8,459 |
| — `packages/core/src` | 11,983 | 7,300 |
| — `packages/core/src/math` | 1,008 | 586 |

Counting code only, Folio is slightly smaller than Paged.js alone, and it
does the mathematics as well. Against the pair it is about eight times
smaller. MathJax's count leaves out its runtime dependencies, which are
packages of their own: `speech-rule-engine`, `@mathjax/mathjax-newcm-font`,
`mj-context-menu` and `mhchemparser`.

### Where MathJax's lines go

| MathJax part | Lines | What Folio uses instead |
| --- | ---: | --- |
| `output/` (CHTML 9.6k, SVG 8.6k, shared 15.6k) | 35,907 | The browser's MathML Core layout: none |
| `input/tex` | 26,822 | Temml (14,755 lines, a dependency) and `@truke/folio-temml` (1,239) |
| `core/` (the MathML tree, visitors) | 13,177 | The DOM: none |
| `a11y/` | 9,954 | The browser's native MathML accessibility |
| `ui/` (menu, explorer) | 6,195 | Nothing |
| `util/`, `adaptors/`, `handlers/`, `components/` | 11,388 | Mostly nothing |
| `input/mathml` | 1,475 | The browser's parser |
| `input/asciimath` | 189 | Not supported |

The fairest like-for-like comparison is MathML in and HTML out. In MathJax
that path is `core`, the MathML input, the CHTML and shared output,
`handlers`, `adaptors` and `util`: 28,530 code lines. Folio's whole math
subsystem is 586. This is not the same work done more tightly. Glyph
placement, script shifts and stretchy operators are left to the browser,
which implements the font's OpenType `MATH` table under MathML Core
(`plan.md` §7). Folio writes only what MathML Core leaves out:

- breaking a display equation across lines,
- numbering equations,
- references that know which page they point to.

MathJax does none of these across pages, because it never sees a page.

With TeX input the ratio is smaller. Temml is about half the size of
MathJax's TeX input, so including Temml Folio is about four times smaller
than the pair instead of eight.

### Where Folio's lines are held to a budget

Two parts of the engine have hard line budgets (`plan.md` §3), so the size
advantage is checked rather than merely hoped for:

- **The fragmenter**, the code that chooses where a page ends, is 2,166
  lines of its 2,300.
- **The math subsystem** is 1,008 lines of its 1,000. The owner accepted the
  overrun on 2026-09-25.

Every polyfill module also states when it can be deleted, and
`deletion.mjs` checks that against WPT. As browsers implement more of paged
media natively, the engine is meant to get smaller.

## Download size

Minified, and compressed with `gzip -9`:

| Use case | Before | Folio | Ratio |
| --- | --- | --- | ---: |
| Pagination, drop-in | `paged.polyfill.min.js`: 499 KB, **96 KB gz** | `folio.polyfill.min.js`: 117 KB, **40 KB gz** | 2.4× |
| Pages and MathML | Paged.js and `mml-chtml.js`: **333 KB gz**, plus fonts | `folio.min.js`: **45 KB gz** | 7× |
| Pages and TeX | Paged.js and `tex-chtml.js`: **377 KB gz**, plus fonts | the polyfill and `folio-tex.min.js`: 40 + 56, **96 KB gz** | 3.9× |
| Math, no pages, MathML | `mml-chtml.js`: **237 KB gz** | `folio-math.min.js`: **10 KB gz** | 23× |
| Math, no pages, TeX | `tex-chtml.js`: **281 KB gz** | `folio-math-tex.min.js`: **66 KB gz** | 4.3× |
| Viewer | — | `folio-viewer.min.js`: 2.5 KB gz | — |

The MathJax figures do not include the font data that `chtml` output loads
separately, so they understate what MathJax costs. The `-nofont` builds save
only 20–25 KB gz.

`folio-tex.js` is not a whole engine. It is the TeX front end, which loads
beside the polyfill or the library, so the TeX row counts both. A first
version of this document counted it alone and claimed 5.7×. Both TeX builds
leave out Temml's mhchem (`\ce`, `\pu`), which nothing here uses and which
was 10 KB gz of them (`tex.md` §5).

Without TeX, the mathematics adds almost nothing to the download, for the
same reason it adds almost nothing to the source. With TeX, most of the
TeX bundle is Temml: 170 KB of its 188 KB minified. Paged.js's bundle is
larger partly because it carries `@babel/polyfill` and `css-tree`. Folio has no runtime dependency except
Temml, and only the TeX builds include that.

## Speed

- **Pagination is linear in the document's length.** Each page's measuring
  box holds a chunk of the document, not the whole remainder (`plan.md` §3,
  `src/chunk.ts`). On `fixtures/book.html`, 278 pages, a page composes 57–59
  nodes however long the document is, and doubling the book doubles the
  work: 2.01×. `perf.spec.ts` asserts this. It counts composed nodes
  rather than seconds, because wall-clock time on this host varies by a
  factor of two between runs of the same document.
- **The book paginates in 1.7 s on Chromium and 2.3 s on Firefox.**
- **The math book takes 6.6 s on Chromium and 7.8 s on Firefox**, all pages
  included. Folio computes no glyph positions and runs no font pipeline;
  it reads the layout the browser has already done.

**Not measured:** Paged.js and MathJax have not been timed on the same
fixtures, so there is no speed ratio here yet. `baseline.mjs` already
drives Paged.js over the corpus, and is where such timing would go.

## What it costs

The 100,000 lines Folio does not maintain are paid for in these ways:

- **Math quality depends on the browser and the font.** Stretchy fences
  differ by 40% between engines: the same two-row matrix is 53px tall in
  Chromium and 64px in Firefox. So equation heights, and the page breaks
  that follow from them, are per-engine. MathJax renders identically
  everywhere, because it brings its own fonts and its own layout.
- **The browser floor is higher**: Chromium 109, Firefox 115, Safari 16.4,
  set by MathML Core. MathJax supports older browsers, and Paged.js does
  not depend on MathML at all.
- **MathJax features with no equivalent here**: SVG output, AsciiMath input,
  and the speech, explorer and context-menu tools built on
  `speech-rule-engine`. Folio relies on the browser's native MathML
  accessibility, which is thinner.
- **Results differ from Paged.js.** Page counts agree on 88 of the 122
  corpus fixtures. Most differences are deliberate. The largest group is the
  UA's `body` margin, on which Chromium's print agrees with Folio in 17 of
  24 cases (`differential.md`). A Paged.js project can still paginate
  differently after the swap, and not all thirty of Paged.js's hooks are
  available (`compat.md`).
- **Gaps left by the owner's decision** (`milestones.md` M6):
  - `position: fixed`,
  - multicol inside pages,
  - structural selectors (`:nth-child`) that know the page,
  - a table row taller than a page,
  - more than one break position per page, so no line slices.
- **Page counts follow the engine.** A line is measured by its ink, and ink
  is a per-engine fact, so the same document can paginate differently on
  Chromium and Firefox. Paged.js has the same exposure but makes it less
  visible.
- **The budgets are nearly spent.** The fragmenter has 134 lines left and
  the math is over. Every new feature has to be paid for, which keeps the
  engine small but slows its growth.

## Verdict

For less code than Paged.js alone, a project gets pagination and typeset
mathematics. The download shrinks from roughly 330–380 KB gzipped, plus
MathJax's fonts, to 45–96 KB. The source to maintain shrinks from about
119,000 lines to about 14,000, and pagination scales linearly on both main
engines.

What is given up is mathematics that looks the same in every browser, older
browsers, and MathJax's SVG output, AsciiMath input and speech tools. That
trade follows from `plan.md`'s design rule that the browser does layout and
JavaScript only decides where things break. It gets better as browsers do:
MathML Core implementations converge, the per-engine differences narrow, and
the deletion conditions let modules go.

## How the numbers were taken

Line counts, from the repository root, with siblings checked out beside it:

```sh
code() { find "$@" -name '*.ts' ! -name '*.d.ts' ! -name '*.test.ts' \
  ! -name '*.spec.ts' | xargs cat | grep -vE '^\s*$|^\s*(//|/?\*)' | wc -l; }
code packages/core/src packages/viewer/src packages/temml/src   # folio
code packages/core/src/math                                     # math
code ../../MathJax/MathJax-src/ts                               # MathJax
find ../../pagedjs/pagedjs/src -name '*.js' | xargs cat \
  | grep -vE '^\s*$|^\s*(//|/?\*)' | wc -l                      # Paged.js
```

Drop the `grep` for all lines. The comment filter is a heuristic: it removes
whole-line comments, not trailing ones, and it treats every project alike.

Bundle sizes, after `pnpm build`:

```sh
for f in dist/*.min.js ../../pagedjs/pagedjs/dist/paged.polyfill.min.js \
         ../../MathJax/MathJax/{mml,tex}-chtml.js; do
  printf '%-60s %8d %8d\n' "$f" $(stat -c%s "$f") $(gzip -9c "$f" | wc -c)
done
```

Speed: `pnpm exec playwright test packages/test/browser/perf.spec.ts` and
`math-long.spec.ts`.
