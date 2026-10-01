/**
 * M0.4: the MATH-table probe, on all three engines.
 *
 * This is a blocking preflight (`doc/math.md` §3). If CI cannot prove the MATH
 * table loaded, every other math assertion in the run is meaningless and the
 * run should stop here rather than produce green ticks against garbage.
 *
 * The negative control matters as much as the positive one. A probe that
 * cannot fail proves nothing, and the failure this exists to catch is silent
 * by nature: flat fractions, unstretched delimiters, nothing thrown.
 */
import { expect, test } from "@playwright/test";
import { hasMathTable, loadMathFont, mathDepthScales } from "@truke/folio";

const FIXTURE = "http://127.0.0.1:5177/math-probe.html";
const MATH_FAMILY = "STIX Two Math";
const NO_MATH_FAMILY = "No Math Here";

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await page.evaluate(loadMathFont, MATH_FAMILY);
  // The negative control has to be a font that actually loaded, or it tests
  // fallback behaviour instead of the MATH table.
  await page.evaluate(loadMathFont, NO_MATH_FAMILY);
});

test("the engine supports MathML at all", async ({ page }) => {
  // If this fails, the browser floor (Chromium 109, Firefox 115, Safari 16.4)
  // is not met and nothing else in the math suite means anything.
  const scales = await page.evaluate(mathDepthScales, MATH_FAMILY);
  expect(scales, "math-depth does not scale: this is fallback text rendering").toBe(true);
});

test("a MATH-table font stretches a fence to its content", async ({ page }) => {
  const ok = await page.evaluate(hasMathTable, MATH_FAMILY);
  expect(ok, "stretchy fence did not grow: MATH table missing or font not loaded").toBe(true);
});

test("a font without a MATH table, per engine", async ({ page, browserName }) => {
  // Prove the control font loaded before reading anything into the result.
  // An unresolvable family and a math-capable fallback look identical from the
  // outside, and that ambiguity is what made the first version of this test
  // assert the opposite of what it meant.
  const loaded = await page.evaluate(
    (family) => document.fonts.check(`1em "${family}"`),
    NO_MATH_FAMILY,
  );
  expect(loaded, "the control font did not load, so this proves nothing").toBe(true);

  const ok = await page.evaluate(hasMathTable, NO_MATH_FAMILY);

  // A documented per-engine difference (plan.md §11), found in M0.4 and
  // corrected once CI disagreed with this machine.
  //
  // Given a font that loaded and has no MATH table, only Chromium draws a
  // normal-size parenthesis and lets the probe fail. Firefox and WebKit both
  // fall back to a math-capable font and stretch anyway, so on two of the
  // three engines the probe cannot be made to fail at all. (WebKit's answer
  // came from CI: it cannot launch on a host with ICU 77.)
  //
  // The consequence for the engine is in math.md §3: the probe answers "is a
  // MATH table in use here", not "did the author's font provide it".
  expect(ok).toBe(browserName !== "chromium");
});
