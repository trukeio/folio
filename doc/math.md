# Math in a paged engine

Implementation detail for §7 of [plan.md](plan.md). Read that section first for
the argument; this document is the how.

The thesis in one line: **the browser is already a TeX-quality math renderer if
you give it a MATH-table font, and everything it cannot do is a layout decision,
which is what this engine exists to make.**

For contrast: Paged.js's math support is a test that 96 formulas do not throw
(`specs/math/math.spec.js:17`) — it paginates whatever markup arrives, including
pre-rendered MathJax output (`specs/math/mathjax.html`). Vivliostyle runs MathJax
itself, via `data-math-typeset="true"`, which buys real typesetting and inherits
MathJax's page-blindness: the equation is broken, numbered and finished before
the page engine is told it exists. The approach here is the third option — keep
the equation as live MathML all the way through fragmentation, so break
decisions and page numbers can still reach it.

---

## 1. What we are standing on

MathML Core defines 30 elements and, in §5, a full mapping onto the OpenType
`MATH` table: `MathConstants` (axis height, fraction rule thickness, script
shift-up/down, radical clearances), italic correction, top accent attachment,
`MathVariants` size variants, and `GlyphAssembly` for building stretchy
delimiters out of parts. This is the same font data TeX reads to typeset. It is
implemented natively in Chromium 109+ (Jan 2023), Firefox and Safari 16.4+.

It also gives us the CSS that math needs and that nothing else provides:
`math-style` (`normal` | `compact`), `math-depth`, `math-shift`,
`font-size: math`, and `display: block math` / `inline math`.

### What Core deliberately omits

| Omission | Consequence for a book |
| --- | --- |
| Line breaking — `white-space` behaves as `nowrap` on every MathML element | A display equation wider than the measure simply overflows |
| `mlabeledtr` | No equation numbers |
| Most table alignment attributes | No `align`-style multi-line equations out of the box |
| `menclose` | No boxed/cancelled notation |
| `mstack`, `mlongdiv`, `msgroup` | No elementary-school column arithmetic |
| `maligngroup`, `malignmark`, `msline` | No alignment points inside rows |

MathJax 4 ships **no native-MathML output format** and names the first two as
the reason. The first three are ours to solve (they are layout, and we are a
layout engine). The last three are out of scope: they are rare in the books this
engine targets, and adding them would mean re-implementing rendering, which is
exactly the trade this project refuses.

---

## 2. Module layout

```
src/math/
  font.ts        # loading + the MATH-table probe            (~120 lines, is 99)
  candidates.ts  # walk a <math> tree, emit break candidates (~200 lines, is 164)
  penalties.ts   # the penalty table, one exported object    (~80 lines, is 110)
  compose.ts     # rewrite an equation into broken lines     (~250 lines, is 377)
  number.ts      # the numbering grid + counter wiring       (~120 lines, is 217)
src/
  carry.ts       # content(element) cloning for heads/TOCs   (~80 lines, is 116)
```

`carry.ts` ended up outside `src/math/`, beside `strings.ts`. `content(element)`
is a GCPM carrier like the rest of that file's subject, and nothing in it is
about mathematics except the reason it exists — a formula is simply the case
where stringifying destroys the content. Being outside, it is also outside the
budget below, which is the honest accounting: it is not math code.

`compose.ts` is over its estimate by the amount `breakEquations` and
`availableMeasure` cost — finding an equation's own measure, which §6's table
requires (a cell bounds the equation in it, not the page) and the sketch above
did not account for.

Budget: under 1,000 lines total; the five modules above are 952 at M4, so the
next feature here is a design review whether it means to be or not.
`candidates.ts` and `penalties.ts` feed the
generic fragmenter from §3; they do not contain a fragmenter of their own. If
`compose.ts` starts to grow a layout algorithm, something has gone wrong — push
it back into the shared machine.

No module here touches glyphs, fonts metrics or spacing. If we ever find
ourselves computing a script shift, we have taken a wrong turn.

---

## 3. The font pipeline

### Requirement

Ship a webfont with a `MATH` table. Do not rely on installed system fonts —
Chromium has known rendering bugs with them, and a reader's machine is not a
build environment. Known-good families:

| Family | Notes |
| --- | --- |
| Latin Modern Math | ~380 KB. Computer Modern look; the default TeX expectation. |
| New Computer Modern Math | Wider language coverage than Latin Modern. |
| STIX Two Math | Times-compatible; pairs with a Times/Source Serif text face. |
| Libertinus Math | Pairs with Libertinus Serif. |

The engine ships one default and accepts an override. Text and math should be
metrically compatible, so the default math font is chosen to match the default
text font, not the other way round.

**M4 ships no default.** There is still no default *text* face, and this
paragraph says the math font follows it — choosing one now would be choosing it
by the wrong end. So the author names the family, `normalize({ mathFont })`
loads it and proves its `MATH` table is in use, and a family without one throws
there rather than quietly setting the book in flat fractions. The condition for
revisiting is the default text face, not a date.

### Loading

Stage 1 already waits for fonts before measuring. Math makes this
non-negotiable: a formula measured against a fallback font is wrong by a large
margin, and every page after it moves.

```js
await document.fonts.load(`1em "${mathFamily}"`);
await document.fonts.ready;
```

### The probe

A missing `MATH` table **degrades silently**. Fractions go flat, delimiters stop
growing, nothing throws, and the resulting 300-page book is wrong everywhere and
obviously wrong nowhere. So test for it:

```js
// A MATH table means a stretchy fence grows to its content.
// Without one, the browser draws a normal-size parenthesis and gives up.
function hasMathTable(family, measurer) {
  const probe = mount(`
    <math style="font-family:'${family}'">
      <mrow>
        <mo stretchy="true">(</mo>
        <mtable><mtr><mtd><mn>1</mn></mtd></mtr>
                <mtr><mtd><mn>2</mn></mtd></mtr>
                <mtr><mtd><mn>3</mn></mtd></mtr></mtable>
        <mo stretchy="true">)</mo>
      </mrow>
    </math>
    <math style="font-family:'${family}'"><mo>(</mo></math>`);
  const [stretched, plain] = measurer.boxes(probe.querySelectorAll("mo"));
  return stretched.height > plain.height * 2;
}
```

**Font fallback makes this a positive test only** (found in M0.4). Firefox and
WebKit both fall back to a math-capable font when the requested family has no
`MATH` table, so the fence stretches regardless and the probe cannot be made to
fail on either; only Chromium does not fall back. So the probe answers "is a MATH table in
use for this formula", which is the question that matters, rather than "did the
author's chosen font supply it". The negative control is a per-engine
expectation, not a universal one.

Run it at startup and **fail loudly**, and run the same function as a CI test.
If CI cannot prove the `MATH` table loaded, every other math assertion in the
suite is meaningless and the run should stop there rather than produce green
ticks against garbage.

A second, cheaper assertion worth having: `math-depth` actually scales — measure
a `<mn>` at depth 0 against the same `<mn>` inside `<msup>`. If they are equal,
the browser is not doing MathML layout at all and we are looking at fallback
text rendering.

---

## 4. The inline-axis fragmenter

### The reduction

§3's machine is: collect candidates, score them, pick the cheapest that fits.
A display equation wider than the measure is that problem on the inline axis.
So the fragmenter takes an axis, and math supplies candidates and penalties.
This is the whole design; everything below is detail.

### Candidates

Walk the top-level row of `<math display="block">`. A candidate is a position
*after* a top-level `<mo>`. Never descend into:

- a fenced `<mrow>` (one whose first and last children are stretchy `<mo>`),
- any script position (`<msup>`, `<msub>`, `<munder>`, …),
- `<mfrac>` numerator or denominator,
- `<msqrt>` / `<mroot>` contents.

If the top level yields no candidate that fits, descend one level into the
outermost non-fenced `<mrow>` and try again, raising every penalty by a fixed
amount. Two levels of descent is the limit; past that, overflow and report.

### Penalties

Straight from TeX's ordering. One exported table so it can be tuned from
fixtures rather than from argument:

| Break position | Penalty | Rationale |
| --- | --- | --- |
| After a relation (`=`, `≤`, `≈`, `→`, `∈`) | 0 | TeX's preferred display break |
| After a binary operator (`+`, `−`, `±`, `×`, `∓`) | 40 | Second choice; the operator stays on the upper line |
| After a comma or semicolon in a list | 60 | Useful in long tuples and conditions |
| Inside a fenced group (one level down) | 200 | Only when nothing at the top level fits |
| Inside a script, fraction or radical | ∞ | Never |
| Leaving a single line of a 3+-line equation alone | 150 | Math widows and orphans |
| Separating the last line from its number | ∞ | The number rides with its line |

Convention: the broken operator is repeated at the start of the continuation
line in some house styles and omitted in others. Make it an option
(`math-break-repeat-operator`), default off (TeX's own behaviour is to leave the
operator at the end of the upper line).

### Measurement

MathML never wraps, but its children are still real layout boxes. So one batched
`boxes(candidates)` read returns every candidate's inline position, and break
selection is pure arithmetic after that — no trial renders, no reflow per
candidate. This is the single biggest reason to do this inside the engine rather
than as a preprocessing library: the library would have to guess widths; we can
read them.

### Composition

Rewrite the equation as an `<mtable>` whose rows are the fragments:

- **With a relation to align on**, use two columns: everything up to the
  relation in column 1 (right-aligned), the relation and the rest in column 2
  (left-aligned). This reproduces TeX's `align`.
- **With no relation**, use one column, left-aligned, and indent continuation
  rows by a fixed shift (2em is a reasonable default, matching `\displayindent`
  conventions).
- **With a relation more than half the measure in**, use the second form
  anyway. Aligning on the relation puts every continuation row in a column
  narrower than the gutter beside it — on a 250px measure with a 200px
  left-hand side, each one would be chosen against 50px — so a long left-hand
  side is set in one column with an indent, which is what a typesetter does
  with it. (M4, from the fixtures.)

The result is still a single `<math>` element, so it stays one accessible tree
and one copyable object.

### Inline math

Same candidates, lower priority. If no candidate fits, **let it overflow and
report it**, exactly as an unbreakable long word does. Do not scale math down to
fit: a shrunken formula next to full-size text is visibly worse than a slightly
loose line, and it breaks the metric relationship with the surrounding text that
the matched font pair exists to preserve.

### Deletion condition

`w3c/mathml-core#127`. If browsers implement MathML line breaking, delete
`candidates.ts`, `penalties.ts` and `compose.ts`, and let CSS do it. Keep the
interface between these modules and the fragmenter narrow enough that this is a
deletion, not a refactor.

---

## 5. Numbering and references

`mlabeledtr` is not in Core and is not coming. Do not put the number inside the
math; put it beside the math and let the existing counter machinery fill it in.
This is tier P — a rewrite-table entry, not a new mechanism.

### The generated wrapper

`<math display="block">` carrying an author marker (a class, or
`--x-math-number: yes` through the §5 carrier) is wrapped at compose time:

```html
<div class="x-eq" id="eq-euler">
  <span class="x-eq-num" aria-hidden="true"></span>   <!-- left gutter -->
  <math display="block"> … </math>
  <span class="x-eq-num"></span>                      <!-- right gutter -->
</div>
```

```css
.x-eq        { display: grid; grid-template-columns: 1fr auto 1fr;
               align-items: center; counter-increment: equation;
               break-inside: avoid; }
.x-eq > math { grid-column: 2; }
.x-eq-num    { inline-size: max-content; }
.x-eq-num:last-child::after { content: "(" attr(data-x-counter-equation) ")"; }

/* house style: number on the left instead */
.x-eq[data-num-side="left"] .x-eq-num:first-child::after { content: "(" attr(data-x-counter-equation) ")"; }
```

**A number the author gives** is a string instead of `yes`:
`math-number: "(7a)"` prints `(7a)`, whole, in the gutter, and the equation is
not counted, so the one after it takes the number it would have had. It is
how `\tag{7a}` reaches the core (`tex.md` §4), and it needs no TeX: MathML
written by hand can say it too. A `target-counter()` to such an equation
resolves to nothing, because what it resolves is a counter. The TeX front end
fills its references itself, since it knows every tag before stage 1.

**The number is an attribute, not `counter(equation)`, and the engine is what
counts** (M4). Letting the browser count breaks on a book: a formula carried
into a running head by `content(element)` is a *clone*, and a clone carrying
`counter-increment` advances the counter in the document the pages are built
in, so every number after it shifts. The engine instead walks the page in order
reading the author's own `counter-reset`, `counter-set` and `counter-increment`
back out of the browser's cascade — rung P, not a cascade of ours — and writes
the value it arrives at. The reset point still comes from the stylesheet, and
what is printed is what a reference resolves to, because both read that one
attribute. Its limit is scope: a reset applies from where it is seen onwards,
which is what CSS does for a reset on each chapter and not what it does for
nested scopes. Those wait for M6's custom counters.

`inline-size: max-content` on the gutters is not cosmetic. They are `1fr`
tracks, so a browser gives each of them half the free space; measuring one then
reports the *track*, the formula is judged against what is left after two
tracks that only exist because it is narrow, and a three-symbol equation breaks
in two. It did, on Firefox, before the rule was there.

The three-column grid keeps the formula optically centred on the measure
regardless of how wide the number is. A right-floated number does not; it
centres the *remaining* space, so equations visibly shift left as numbers reach
two digits. Both gutters exist at all times so the geometry does not change when
the side changes.

For a broken equation the wrapper holds the generated `<mtable>` and the number
aligns to the **last** row by default (`align-items: end`), or the first, by
option.

### References

`\ref` and `\eqref` become ordinary `target-counter()`, which stage 5 already
resolves:

```css
a.eqref::after  { content: " (" target-counter(attr(href url), equation) ")"; }
a.eqpage::after { content: " on page " target-counter(attr(href url), page); }
```

**This is the capability MathJax structurally cannot have**, at any price,
because it never learns what page anything landed on. "See equation (3.4) on
page 128" costs us nothing new: the `refs`/`provides` sets and the stage 5 loop
were built for §2 and work unchanged.

The loop's settling risk applies here too. An equation number that widens from
`(9)` to `(10)` cannot change the equation's height, so numbering alone is
stable; but a *page* reference that widens can rewrap a paragraph. Same
mitigation as everywhere else: a pass limit, then keep the longer layout.

### Found by the math example (M6)

Writing `examples/math/` turned up three things the specs had not. Two are
fixed; one is open.

- **Fixed: the default number printed as "()".** The engine wrote the number
  on the wrapper and on the `<math>`, and the gutter's `::after` reads `attr()`
  on the *gutter*. Every numbered equation since M4 showed empty parentheses;
  the specs asserted the attribute, never what was drawn. The number is now on
  the gutters too (`page-content.spec.ts` holds it). A side effect worth
  knowing: a real number makes the gutter wider and the measure narrower, and
  the `wide` fixture equation — whose left-hand side sat just under half the
  old measure — crossed the §4 line into one indented column. Its left-hand
  side is shorter now, so the test is still about the aligned case.
- **Fixed: Firefox wrapped display formulas inside the grid.** Firefox
  underestimates the max-content width of a formula with a large operator
  (the `∑` measured at text size, it appears), sizes the `auto` column to that,
  and then breaks the line inside it: `eᶻ = ∑ zⁿ/n!` came out with the fraction
  under the sum. Reproducible with no engine loaded — a `<math
  display="block">` as a grid item in an `auto` track. `white-space: nowrap`
  on `.x-eq > math` stops it; an explicit `max-content` width does not.
- **Open: a wider number label overflows a broken equation.** With the default
  `(n)` a broken equation fits exactly. An author rule that widens the label —
  `.x-eq-num:last-child::after { content: "(" counter(chapter) "."
  attr(data-x-counter-equation) ")" }` for "(2.2)" — leaves the rows as wide
  as before and pushes the number 9px past the measure; a 70px label, 25px.
  `availableMeasure` in `compose.ts` does reserve twice the wider gutter, so
  the gutter is apparently measured narrower than it is drawn — not yet
  confirmed, and the cause is not isolated. Until it is, the example keeps the
  default label and says "(1) in chapter 2" in its references instead.

---

## 6. Where math meets the page edge

| Situation | Rule |
| --- | --- |
| One-line display equation | `break-inside: avoid` as a **penalty**, not a rule — a formula taller than the page area must still be placed rather than sending the fragmenter round again |
| Broken equation (multi-row) | Its rows are block boxes; the vertical fragmenter handles them, and widows/orphans are counted in equation lines |
| Equation after a lead-in sentence | Cheap `break-before: avoid` penalty when the preceding paragraph ends in a colon. A style preset, not a default |
| Equation number | Rides with its line; never separated (penalty ∞) |
| Math inside a footnote or margin box | No code. `math-depth` inherits and the browser scales it. Cover with a reftest |
| Math inside a table cell | Nothing special, but the cell's width feeds the inline-axis fragmenter's measure rather than the page's |
| Math in a running head or TOC entry | Needs `content(element)`, below |

### `content(element)` and carrying math out of the flow

`string-set` stringifies. `textContent` on a formula yields a row of stray
letters and digits — `a2+b2=c2` — which is worse than omitting it. So the tier-P
carrier table needs `content(element)`, which **clones the subtree** instead:

```css
h2 { string-set: chaptertitle content(element); }
```

The clone must be deep, must keep `alttext` / `annotation` / `intent`, and must
get fresh `id`s (or none) so the original remains the unique reference target.
The same fix serves `target-text()` when a chapter title contains math.

Math in a running head should also be set at a reduced `math-depth` so it does
not tower over the running-head text. That is one CSS line in the default
stylesheet, not engine code.

---

## 7. Accessibility, PDF and round-tripping

Because the composed page holds **real MathML**, the visible form and the
accessible form are one tree. There is no hidden duplicate of the kind MathJax
must ship (`mjx-assistive-mml`) and no risk of the two drifting apart.

Three attributes must survive every stage untouched:

- `alttext` — the plain-text fallback.
- `<annotation encoding="application/x-tex">` — the original TeX, so readers can
  copy a formula back out and authors can round-trip.
- MathML 4 `intent` — speech guidance. arXiv is already emitting it at scale.

**One rule for fragmentation:** a *fragment* of an equation must not carry the
whole equation's `intent` or `annotation`. They belong to the first fragment;
subsequent fragments are marked as continuations. An assistive tool that reads
`intent` off the third line of a broken display and announces the whole equation
is worse than one that reads nothing.

For PDF, Chromium's print path renders MathML with the embedded MATH font. Verify
this early — it is an M0 check, not an M4 surprise — and record which engines
embed the font subset correctly. Tagged-PDF math structure is out of scope for
the core; it belongs in whatever produces the PDF.

---

## 8. TeX input: a separate package

The core accepts **MathML only**. Conversion is a preprocessing step, performed
in the open, before stage 1, by an optional package.

Default converter: **Temml** — a KaTeX fork that emits MathML Core rather than
styled HTML. ~174 KB minified (against MathJax 2.7.5's 338 KB and KaTeX's
280 KB), LaTeX coverage comparable to MathJax and better than KaTeX, and it
already implements `\label{…}` and `\ref{…}`, which map onto §5's `id` and
`target-counter()` wiring directly.

Why it stays outside the core:

- The core's contract is "MathML in, pages out". A TeX parser in the core would
  make LaTeX macro semantics a maintenance surface forever — the same mistake as
  owning a CSS cascade (§6).
- Conversion is a *build-time* step for most books. Converting once at build and
  serving static MathML is faster and more reproducible than converting in every
  reader's browser.
- It is swappable. If a better converter appears, or the author already uses
  Pandoc or LaTeXML, the core does not care.

The package's job is small: find the TeX, convert it, insert the MathML, and
preserve the source as `<annotation encoding="application/x-tex">`. It must run
to completion before stage 1 measures anything. `tex.md` is the
implementation plan: delimiters, and how numbering stays the core's.

---

## 9. Test plan

Four layers as in §9 of the plan, plus two math-specific additions.

**Blocking preflight**
- `hasMathTable()` passes on all three engines. If not, abort the run.
- `math-depth` scaling assertion.

**Unit (fake measurer, no browser)**
- Candidate enumeration: never inside scripts, fractions, radicals, fences.
- Penalty ordering: relation before binary operator before comma.
- Descent: one level only when the top level yields nothing that fits.
- Composition: two-column alignment when a relation exists, indent when not.
- Number placement: last row by default, first on option.

**Structural (Playwright, three engines, JSON snapshots)**
- Which equation line lands on which page.
- Where each break fell, by candidate index.
- Equation numbers consecutive from 1, no gaps, no repeats, across all pages.
- No equation overflows the measure or the page area.
- A 3-line equation is never split 1 + 2 against the widow penalty.

**Golden images (per engine, ~30 formulas)**
Nested fractions, large operators with limits, stretched fences over matrices,
multiscripts, long radicals, accents. These catch *"it changed"* — which is the
only math-rendering regression we can meaningfully own, since positioning is the
browser's job.

**Corpus**
- Paged.js `specs/math` — 96 formulas whose only current assertion is that they
  do not throw. A free baseline of real markup, and MIT-licensed.
- Temml's test suite.
- arXiv HTML samples, for volume and for realistic `intent` usage.

Check each corpus's license before vendoring.

---

## 10. Open questions

1. **Does the multicol spike (§3) survive math?** If the fragmenter ends up
   leaning on browser multicol to place vertical breaks, an `<mtable>`-composed
   equation has to fragment correctly inside a column. Test this during the
   two-week spike, not after M3.
2. **Do the three engines agree on `GlyphAssembly` results?** *Answered in M4.6:
   no, and by a lot.* The same parenthesis around the same two-row `<mtable>`,
   in STIX Two Math at 22px, is 53px tall in Chromium and 64px in Firefox;
   around three rows it is 74px against 104.8px. So a display equation's height
   is engine-dependent before we make a single decision about it, and page
   breaks move with it. The consequence is the one taken everywhere else:
   per-engine expectations. The golden images are recorded per engine, and the
   spec asserts only the property all of them must have — more rows, taller
   fence.
3. **Is greedy breaking good enough?** TeX optimizes a display across all its
   lines at once; ours takes the cheapest candidate that fits, line by line.
   Ship greedy, keep the penalties in one tunable table, and only add a search
   pass if fixtures show bad breaks in practice.
4. **Numbering scheme scope.** *Answered in M4, §5.* The engine counts, by
   reading the author's `counter-reset`/`counter-increment` back through the
   cascade; the default is what those say and the engine assumes nothing. A
   number composed of two counters — `(3.4)` from `chapter` and `equation` —
   still needs M6's custom counters, because only `equation` is written into an
   attribute a reference can read.
5. **Does Chromium's print path embed the MATH font subset correctly?** An M0
   verification, because a "yes" here is load-bearing for the whole approach.
