/**
 * M4.6: golden images.
 *
 * Positioning is the browser's and the font's — `math.md` §1 is explicit that
 * we never compute a glyph position or a script shift — so the only
 * math-rendering regression this project can own is "it changed". Thirty
 * formulas, one image each, per engine.
 *
 * The threshold is deliberately loose about colour and tight about area:
 * antialiasing differs between hosts and does not matter, while a fraction
 * gone flat, a fence that stopped stretching or a script that stopped shifting
 * moves a large fraction of the pixels in the box. That is the failure the
 * MATH table causes when it silently does not load, and it is what this
 * catches.
 *
 * The baselines are host-specific, like the page-count baselines
 * (`packages/test/baselines/README`). They were recorded on the machine named
 * in `.baseline-host`; another platform records its own on first run, because
 * `updateSnapshots: "missing"` writes what is not there rather than failing.
 */
import { expect, test } from "@playwright/test";

const FIXTURE = "http://127.0.0.1:5177/math-gallery.html";

/** Loose on colour, tight on area: see the note above. */
const TOLERANCE = { threshold: 0.35, maxDiffPixelRatio: 0.02 } as const;

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  // A formula measured or drawn against a fallback font is a different
  // formula. Nothing below means anything until this resolves.
  await page.evaluate(async () => {
    await document.fonts.load('22px "STIX Two Math"');
    await document.fonts.ready;
  });
});

test("every formula renders as it did", async ({ page }) => {
  const names = await page.evaluate(() =>
    [...document.querySelectorAll("[data-name]")].map((el) => el.getAttribute("data-name") ?? ""),
  );
  expect(names.length).toBe(30);

  for (const name of names) {
    await expect(page.locator(`[data-name="${name}"]`)).toHaveScreenshot(
      `${name}.png`,
      TOLERANCE,
    );
  }
});

test("a stretchy fence grows with what it holds", async ({ page }, testInfo) => {
  // `math.md` §10 Q2: do the engines agree on `GlyphAssembly`? Measured in
  // M4.6: no, and by a lot — the same parenthesis around the same two rows is
  // 53px in Chromium and 64px in Firefox, and around three rows 74px against
  // 104.8px. So the heights are attached to the result rather than asserted,
  // and what is asserted is the property every engine must have.
  const heights = await page.evaluate(() => {
    const of = (name: string) => {
      const box = document.querySelector(`[data-name="${name}"] mo`);
      return box === null ? 0 : Math.round(box.getBoundingClientRect().height * 100) / 100;
    };
    return { two: of("fence-matrix-2"), three: of("fence-matrix-3") };
  });

  await testInfo.attach("fence-heights", {
    body: JSON.stringify({ engine: testInfo.project.name, ...heights }),
    contentType: "application/json",
  });

  expect(heights.two).toBeGreaterThan(0);
  expect(heights.three).toBeGreaterThan(heights.two);
});
