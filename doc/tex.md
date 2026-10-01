# TeX input: the `@truke/folio-temml` front end

Status: **done** (2026-09-24). Where the work departed from the plan, the
sections it changed say so, and §6 collects the departures. This was the
implementation plan for `math.md` §8, which decided the shape: an optional
package, outside the core, that turns TeX into MathML before stage 1 and
leaves the core's contract, "MathML in, pages out", untouched. This document
is the how. The package is M6 work with no line budget, because it neither
chooses a break nor lives in `src/math/`. Its one core change, `\tag`
(§4), is counted in the math budget like any other.

The goal in one line: **a document written for MathJax, with `\( … \)` inline
and `\[ … \]` display, paginates with the script tag added and nothing else
changed.** The delimiters are configurable. The defaults are chosen to fit
templating systems like OGDL's (Truke KF), where `$` is part of the template
language and cannot also mean math.

---

## 1. What the package does, and what it does not

It finds TeX in the text of the element about to be paginated, converts each
formula with Temml, and puts the MathML in place of the delimited source. The
TeX is kept as `<annotation encoding="application/x-tex">` (`math.md` §7).
It also sets up everything the core already knows how to do: equation
numbers, labels and references.

What it does **not** do is number equations, lay out a numbered display or
resolve a reference. The core has done all three since M4 (`math/number.ts`,
`references.ts`), and it does them against the page. Temml's own numbering
does not know the page, and it would fight the core's. §4 is about keeping
Temml out of those jobs.

| Job | Owner | Why |
| --- | --- | --- |
| Finding delimited TeX in text | package | MathJax's `FindTeX`, behaviourally |
| TeX → MathML | Temml | `math.md` §8: MIT, MathML Core output, ~168 KB min |
| `\label`, `\tag`, `\notag`, `equation`/`align` numbering | package → core markers | Temml's numbering is CSS counters in a 100%-wide `mtable` (§4) |
| Counting, placing the number | core, `math/number.ts` | Already page-aware |
| `\ref`, `\eqref` | package → `<a href>`; core resolves | `target-counter()` through stage 5 |
| Breaking a long display | core, `math/compose.ts` | Unchanged |

---

## 2. Where it runs

**In the browser, before stage 1, as a `beforeParsed` handler.** That is the
MathJax-shaped use: the page arrives with TeX in it and the reader's browser
converts it. `Previewer.preview` awaits `beforeParsed` before `normalize`
(`preview.ts`), so the conversion finishes before anything is measured, which
`math.md` §8 requires. The source element is changed in place. That is not
stage 1 mutating the source. It is a preprocessor the author asked for, done
in the open before stage 1 exists, as `math.md` §8 says.

Three ways to load it, matching the three ways into the core
(`doc/using.md`):

| Load | Gives | Runs when |
| --- | --- | --- |
| `<script src="folio-tex.js">` next to `folio.polyfill.js` | Registers a handler with `window.Paged`, reads `window.FolioTeX` for options | Automatically, before the polyfill paginates |
| `import { createTeXHandler } from "@truke/folio-temml"` | `createTeXHandler(options)`, a handler class for `Previewer({ handlers })` | Before that previewer's stage 1 |
| `import { renderTeX } from "@truke/folio-temml"` | `renderTeX(root, options): TeXReport` | When the application calls it |

`renderTeX` is synchronous, not the promise the plan had. Temml is, and so is
everything around it, and a handler's `beforeParsed` may return either.

**Script order.** The polyfill paginates on `DOMContentLoaded`, and handlers
are module-global (`registerHandlers`), so a classic script placed after the
polyfill registers in time. Placed before it, there is no `window.Paged` yet.
The TeX script then queues itself on `window.folioHandlers`, which
`install()` drains. That costs the core one line and no knowledge of TeX.
Both orders get a spec. The one order that fails is both scripts `defer`red:
a deferred script runs while the document is already `interactive`, so the
polyfill starts at once, before the TeX script has run. `using.md` says to
put the TeX script first.

**Its own file.** `scripts/build.mjs` gains a `folio-tex` bundle (IIFE,
minified, ESM). Temml is about 168 KB minified, which is more than the
engine. An application that writes MathML, or converts at build time, must
not pay for it.

**Build-time conversion** is the better choice for a book (`math.md` §8), and
it is deferred rather than dropped. `renderTeX` works on any DOM, so a Node
build can run it under `linkedom` or `jsdom`. A CLI, and a pure string API
for a server-side templating pipeline, wait until someone needs them. Truke KF
does not yet (§8).

---

## 3. Finding the TeX

### Delimiters

```js
window.FolioTeX = {
  inline:  [["\\(", "\\)"]],          // default
  display: [["\\[", "\\]"]],          // default
  environments: true,                 // bare \begin{equation}…\end{equation}
  ignore: "script, style, textarea, pre, code, math, svg, .tex-ignore",
  process: null,                      // selector: re-enter an ignored subtree
  tags: "ams",                        // "ams" | "all" | "none" (§4)
  macros: {},                         // "\\RR": "\\mathbb{R}"
  annotate: true,
  onError: "show",                    // "show" | "throw"
};
```

The defaults are MathJax 3's defaults with `$$ … $$` removed. MathJax's
inline default is already `\( … \)` alone, and its display defaults are
`$$ … $$` and `\[ … \]`. So a MathJax document that uses `\(`/`\[` needs no
configuration. One that uses dollars adds them: `inline: [["$", "$"],
["\\(", "\\)"]]`. Delimiter pairs are plain strings, not regular
expressions. That is all MathJax allows, and a pair is easy to check.

### The scan

The scan follows MathJax's `FindTeX` and its `HTMLDomStrings` behaviour. It
needs no MathJax source, since the behaviour is documented and MathJax is
Apache-2.0 anyway:

- Walk the text nodes under the root in document order and skip `ignore`
  subtrees. A text node's *data* is scanned, so the HTML parser has already
  decoded entities. A literal `<` in a formula must be written `&lt;` or
  `\lt` in the HTML source, exactly as with MathJax. `doc/using.md` has to
  say so, because it is the first thing anyone hits.
- A formula may span adjacent text nodes, and `<br>` and comments between
  them. It may not span any other element. `\( a <em>b</em> \)` is left
  alone and reported, as MathJax leaves it.
- An opening delimiter with no close in the same span is text and is
  reported.
- `\\(` (an escaped backslash) does not open. `\$` becomes `$` only when a
  dollar delimiter is configured, which is MathJax's `processEscapes`.
- Replace the whole span with one node: `<math>` for inline, `<math
  display="block">` for display. The text on either side stays where it was.
  A display inside a `<p>` stays inside the `<p>`, as MathJax leaves it. The
  core has never been tested on that, so §6 adds a test for it.

### Environments without delimiters

With `environments: true`, `\begin{name} … \end{name}` in text is a display
formula when `name` is a known display environment. That covers `equation`,
`align`, `gather`, `multline` and their starred forms. This is MathJax's
`processEnvironments`, and LaTeX-first authors write it that way.

---

## 4. Numbering, labels and references

Before Temml sees a formula, the package takes these commands out itself.
The probe below is why, run against Temml 0.13.5:

| TeX | Temml emits | Problem for us |
| --- | --- | --- |
| `\[ E=mc^2 \label{e} \]` | `<mrow class="tml-label">`, no id | Label lost |
| `\begin{equation} … \label{eq:ab}` | `<mtable style="width:100%">`, three columns, `<mtr id="eqab">`, `<span class="tml-eqn">` | A second numbering grid inside ours, counted by Temml's CSS, and the id is mangled (`:` dropped) |
| `\eqref{eq:ab}` | `<a href='#eqab' class="tml-eqref"></a>` inside `<math>`, empty | Text filled by `temmlPostProcess.js`, which knows no pages |
| `\newcommand{\QQ}{…}` with `globalGroup: true` | Macro not kept for the next formula | MathJax keeps it document-wide |

The rules:

1. **Numbered or not.** Under `tags: "ams"` (the default), the numbered
   displays are `equation`, `align`, `gather` and `multline`. `\[ … \]` and
   the starred forms are not. Under `"all"`, every display is numbered, and
   under `"none"` none is. `\notag`/`\nonumber` and a starred environment
   switch numbering off. A numbered formula gets class `tex-numbered`. The
   package's stylesheet maps that class to the core's marker, `:where(math.
   tex-numbered) { math-number: yes }`. Zero specificity, so an author rule
   wins. The sheet is a `<style id="tex-front-end">` inserted *first* in the
   head, so an author rule with the same selector as one of the package's
   (`a.tex-eqref::after`, as in `examples/tex/`) comes later and wins. It is
   there before stage 1 collects the document's `<style>` elements
   (`source.ts`), so the carrier rewrite sees it. It is deliberately not a
   `folio-` id. That prefix marks the engine's own sheets, which
   `preview.ts` copies from the frame to the host, and this sheet is author
   input.
2. **The environment is unwrapped before Temml runs.** `equation` renders
   its body as-is. `align` and `flalign` become `aligned`, `alignat` becomes
   `alignedat`, and `gather` becomes `gathered`. Temml has no `multlined`,
   which the plan assumed it had, so `multline` becomes `multline*`. That
   has no tag column either, but comes back as a 100%-wide `mtable`, and
   `render.ts` takes the width off. Temml therefore never emits a tag
   column, and the core's `.x-eq` grid is the only numbering layout.
3. **`\label{key}`** is removed and becomes `id="key"` on the `<math>`,
   verbatim, colons included. `references.ts` looks ids up with
   `CSS.escape`, so `eq:ab` works, and a spec pins that. A duplicate key is
   reported and keeps its first owner.
4. **`\tag{7a}`** needs something the core did not have: a number the
   author gives rather than one the engine counts. It is one core change,
   `math-number: "(7a)"`, a string as well as `yes` (`math.md` §5). The
   string is printed whole, so the package passes `"(7a)"` for `\tag{7a}`
   and `"A"` for `\tag*{A}`. No attribute is needed for the bare form. The
   equation does not advance the counter. It is not TeX-specific: an author
   writing MathML gets hand numbering too. The change is five lines net in
   `math/number.ts`, taking the math budget from 967 to 972 of 1,000.
   `target-counter()` resolves counters, and a tag is not one, so it
   resolves to nothing. The package fills references to tagged equations
   itself instead: it knows every tag before stage 1, and writes it on the
   link as `data-tex-label`, which its sheet prints.
5. **`\ref{key}` and `\eqref{key}`** become `<a class="tex-ref" href="#key">`
   and `<a class="tex-eqref" href="#key">`. When they sit in running text,
   the anchor goes in the text, outside any `<math>`. That is MathJax's
   `processRefs`: `\eqref` works in prose, and prose is where it usually is.
   Inside a formula, the reference is replaced by a placeholder Temml cannot
   mangle, `\ref{texref0}`. Temml's MathML `<a>` for it is then swapped for
   an HTML anchor in an `<mtext>`, where MathML Core allows HTML. The
   package's sheet fills both through the engine:

   ```css
   a.tex-eqref::after { content: "(" target-counter(attr(href url), equation) ")" }
   a.tex-ref::after   { content: target-counter(attr(href url), equation) }
   ```

   So "(3) on page 12" costs the author one more rule, with `page` in place
   of `equation`. That is the capability `math.md` §5 says MathJax cannot
   have. Writing these two rules found a core bug: the engine read
   `attr(href)` but not `attr(href url)`, which is css-gcpm's own spelling,
   so a rule written that way printed nothing. `references.ts` reads both
   now.
6. **Macros are document-wide**, as in MathJax. One `macros` object is shared
   by every call, seeded from the options. `\newcommand`, `\renewcommand` and
   `\def` are rewritten to `\gdef` before Temml runs, because `\gdef` is the
   form Temml keeps across calls (probed: `\gdef\RR{\mathbb R}` persists,
   `\newcommand` does not). A formula that holds only definitions renders as
   nothing, as MathJax renders it.

**Per-row numbers in `align` are not in this plan.** AMS numbers every row of
an `align`. The core numbers a `<math>`, one number per display, placed on
the last row (`math.md` §5). There are two ways to close the gap, and both
are core design questions rather than front-end ones:

- Split the environment into one `<math>` per row. Each row gets its own
  number, but the column alignment across rows is lost.
- Teach `math/number.ts` a number per `mtr`. Alignment stays, but that is
  `mlabeledtr` by another name.

Until one of them is chosen, a numbered `align` gets one number, and every
`\label` after the first in the environment is reported.

---

## 5. Output hygiene

- **Temml's classes and inline styles.** Temml emits `class="tml-*"`
  and a `style="display:block math"` on displays. The display style is
  harmless. The classes need a small part of Temml's CSS: the `tml-jot` row
  gap, the `tml-*-pad` spacings, `\cancel`/`\fbox`/accents. That part is
  vendored into the package's sheet. Temml's font rules are not: the math
  font is the author's (`math.md` §3), and `mathFont` still checks it.
- **Errors.** With `onError: "show"`, a formula that fails to parse becomes
  `<math><merror><mtext>source</mtext></merror></math>`. The page shows the
  TeX where the formula was and keeps paginating. Temml's own error is an
  HTML `<span>`, which would be a block of red prose. With `"throw"`,
  `renderTeX` throws Temml's `ParseError` instead. Otherwise it returns a
  `TeXReport` of `{ formulas, errors, unclosed, duplicateLabels, dropped,
  unresolved }`. The handler logs one console line per kind of problem, or
  hands the report to `onReport`.
- **Accessibility.** `annotate: true` wraps each formula in `<semantics>`
  with the TeX annotation. `carry.ts`, `math/candidates.ts` and
  `math/compose.ts` already treat the first child of a `<semantics>` as the
  formula, so running heads and breaking are unaffected. `tex.spec.ts` holds
  that for the running heads. The annotation holds the author's TeX, not the
  prepared string Temml was given, which has the labels taken out and
  placeholders put in.
  `alttext` is not set. Screen readers read MathML.
- **No chemistry.** Temml's module builds include mhchem (`\ce`, `\pu`); its
  script build, `temml.js`, does not. Nothing here uses chemistry, and it was
  10 kB of the TeX bundle's 66 gzipped. So both builds bundle `temml.js`,
  with the default export it lacks added (`scripts/temml-without-mhchem.mjs`,
  used by `build.mjs` and the test bundle). The MathML is otherwise the same.
  `\ce` is a parse error ("Unsupported function name"), shown as its source
  with `onError: "show"` and reported, like any unknown command. The plugin
  throws if a Temml upgrade drops `temml.js`. Vitest imports Temml directly
  and still has mhchem; no test uses it.
- **Idempotence.** A second run finds no delimiters. The conversion replaced
  them, and `math` is in `ignore`. `render.test.ts` runs it twice.

---

## 6. Work, as done

| Step | What | Where | Test |
| --- | --- | --- | --- |
| 1 | `temml` pinned at 0.13.5, whose behaviour §4 probed; `linkedom` for the DOM tests | `packages/temml/package.json` | — |
| 2 | The delimiter scan | `find.ts` | `find.test.ts` |
| 3 | Numbering, labels, tags, references and definitions taken out | `tex.ts` | `tex.test.ts` |
| 4 | `renderTeX`, the report, errors, the stylesheet; Temml's CSS vendored | `render.ts`, `temml-css.ts` | `render.test.ts` |
| 5 | `math-number: "<label>"` | core, `math/number.ts` | `tex.spec.ts`: printed whole, not counted, referenced |
| 6 | `createTeXHandler`, the queue in `install()`, `window.FolioTeX` | `handler.ts`, `global.ts`, core `polyfill.ts` | `tex.spec.ts`: both script orders, and the library path |
| 7 | `dist/folio-tex.js` (390 kB; 188 kB minified, 170 of them Temml's, without mhchem since 2026-10-01: §5) | `scripts/build.mjs`, `packages/test/bundle.mjs` | `pnpm build` |
| 8 | `examples/tex/` | `examples/tex/index.html` | `tex.spec.ts`: same pages, equations, numbers, printed references and carried formulas as `examples/math/` |
| 9 | Display math inside a `<p>` | — | `tex.spec.ts`: twelve of them, no overflow, on both engines. No core change was needed |
| 10 | Documentation | `using.md` §4, `compat.md`, `math.md` §5, `milestones.md` | — |

Step 8 is the exit check. The same document written two ways must give the
same pages. It catches anything the front end does differently from
hand-written MathML, whether in numbering, ids or spacing, and it needs no
opinion about typography. It passes on Chromium and Firefox.

**What the work found that the plan did not know:**

- The engine did not read `attr(href url)` in `target-counter()` or
  `target-text()` (§4, item 5). That was a core bug, found here and fixed in
  `references.ts`.
- Temml has no `multlined` (§4, item 2).
- `\tag*` needed no attribute of its own once the label is printed whole
  (§4, item 4).
- The package's sheet has to come *first* in the head, or the author cannot
  restyle a reference with a rule of the same selector (§4, item 1).
- `linkedom` has no `Text.splitText`. The replacement slices `data`
  instead, which also keeps each prefix in its original node, where the
  boundaries of the formulas before it still point.

A Temml corpus run can follow (`math.md` §9 lists Temml's test suite). The
assertion is that nothing throws and every formula paginates, not that the
pixels match.

---

## 7. Deletion condition

`plan.md` §8 asks every polyfill module for one. This is not a polyfill. No
browser is going to parse TeX, so the package has no native feature to wait
for. It is swappable instead, which `math.md` §8 argued. It goes when a
better converter replaces Temml, or when a project converts at build time
with Pandoc or LaTeXML. In either case the core notices nothing.

---

## 8. Open questions

1. **Build-time conversion for Truke KF.** Answered for now (2026-09-24):
   browser-side is enough, so the CLI and the string API stay deferred.
   Converting once where the OGDL templates render would be faster for
   readers and reproducible across them. It comes back when a project needs
   that, and it would need a JavaScript runtime at build time (`renderTeX` on
   `linkedom`) or a converter written in Go.
2. **Per-row `align` numbers** (§4). One `<math>` per row, or `number.ts`
   learning rows?
3. **`$` delimiters.** They are off by default because of OGDL. Should the
   drop-in turn them on when it detects no template use? No: detection is
   guessing, and a stray `$5` in prose becomes a formula. Recorded so the
   question is not asked again.
