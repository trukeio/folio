/**
 * The MATH-font pipeline (`doc/math.md` §3).
 *
 * A missing `MATH` table degrades silently: fractions go flat, delimiters stop
 * growing, nothing throws, and the resulting book is wrong everywhere and
 * obviously wrong nowhere. So the engine proves the table is there before it
 * measures anything, and CI runs the same functions as a blocking preflight.
 *
 * These run in the page and take no engine objects, so they can be handed
 * straight to `page.evaluate()` in a browser test — which is the point: the
 * startup check and the CI check must be the same code, or the CI check is
 * testing something else. `math.md` writes the probe against `Measurer`; here
 * it reads rects itself, because a `Measurer` cannot cross into the page.
 */

/**
 * Load a math family and prove its `MATH` table is in use, or throw.
 *
 * "Fail loudly" (M4.1). A missing table degrades silently — flat fractions,
 * unstretched delimiters, nothing thrown — so every math result in a run where
 * it failed is meaningless, and stopping is better than a green tick against
 * garbage.
 *
 * Unlike the three below, this one calls its neighbours, so it cannot be
 * handed to `page.evaluate()`: that works only for a function that is entirely
 * self-contained. In a browser test, inject the bundle and call it through
 * `window.folio`.
 */
export async function ensureMathFont(family: string, doc: Document = document): Promise<void> {
  await loadMathFont(family, doc);
  if (!hasMathTable(family, doc)) {
    throw new Error(
      `folio: "${family}" is laying out math without a MATH table. ` +
        "Fractions, radicals and stretchy delimiters will all be wrong.",
    );
  }
}

/** Wait for a family to be usable. A formula measured against a fallback font
 * is wrong by a large margin, and every page after it moves. */
export async function loadMathFont(
  family: string,
  doc: Document = document,
): Promise<void> {
  await doc.fonts.load(`1em "${family}"`);
  await doc.fonts.ready;
}

/**
 * A MATH table means a stretchy fence grows to its content. Without one the
 * browser draws a normal-size parenthesis and gives up.
 */
export function hasMathTable(family: string, doc: Document = document): boolean {
  const mount = doc.createElement("folio-measure");
  mount.style.cssText = "display:block;position:absolute;visibility:hidden";
  // The family goes on each <math>, not on the wrapper: the UA stylesheet sets
  // `font-family: math` on the math element, so an inherited family never
  // reaches the formula and every font would measure the same.
  mount.innerHTML = `
    <math style="font-family:'${family}'"><mrow>
      <mo stretchy="true">(</mo>
      <mtable><mtr><mtd><mn>1</mn></mtd></mtr>
              <mtr><mtd><mn>2</mn></mtd></mtr>
              <mtr><mtd><mn>3</mn></mtd></mtr></mtable>
      <mo stretchy="true">)</mo>
    </mrow></math>
    <math style="font-family:'${family}'"><mo>(</mo></math>`;
  doc.body.append(mount);
  try {
    const ops = mount.querySelectorAll("mo");
    const stretched = ops[0]?.getBoundingClientRect().height ?? 0;
    const plain = ops[2]?.getBoundingClientRect().height ?? 0;
    return plain > 0 && stretched > plain * 2;
  } finally {
    mount.remove();
  }
}

/**
 * The cheaper second assertion: `math-depth` actually scales. If a `<mn>` at
 * depth 0 and the same `<mn>` inside `<msup>` measure the same, the browser is
 * not doing MathML layout at all and we are looking at fallback text.
 */
export function mathDepthScales(family: string, doc: Document = document): boolean {
  const mount = doc.createElement("folio-measure");
  mount.style.cssText = "display:block;position:absolute;visibility:hidden";
  mount.innerHTML = `
    <math style="font-family:'${family}'"><mn>2</mn></math>
    <math style="font-family:'${family}'"><msup><mn>1</mn><mn>2</mn></msup></math>`;
  doc.body.append(mount);
  try {
    const nums = mount.querySelectorAll("mn");
    const base = nums[0]?.getBoundingClientRect().height ?? 0;
    const script = nums[2]?.getBoundingClientRect().height ?? 0;
    return base > 0 && script > 0 && script < base;
  } finally {
    mount.remove();
  }
}
