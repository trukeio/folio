/**
 * M1.1: stages 1 and 2 against a real document.
 *
 * The scanner and the page model are unit-tested without a browser. What needs
 * one is what cannot be faked: that fonts are loaded before anything is
 * measured, that the source document is never mutated, and that the engine's
 * iframe does not disturb the host page.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/stage1.html";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
});

test("waits for fonts before anything is measured", async ({ page }) => {
  const ready = await page.evaluate(async () => {
    await window.folio.settle(document);
    return document.fonts.check('1em "Stage One"');
  });

  expect(ready, "stage 1 returned before the webfont was usable").toBe(true);
});

test("extracts @page and leaves every other rule verbatim", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const doc = await window.folio.normalize(document);
    return {
      ruleCount: doc.pageRules.length,
      size: doc.pageRules[0]?.declarations["size"],
      marginBoxes: Object.keys(doc.pageRules[0]?.marginBoxes ?? {}),
      keptLayer: doc.authorCss.includes("@layer base"),
      keptHas: doc.authorCss.includes(":has(+ p)"),
      keptFontFace: doc.authorCss.includes("@font-face"),
      keptPseudoContent: doc.authorCss.includes('content: "@page { fake }"'),
      droppedPage: !doc.authorCss.includes("size: 5in"),
    };
  });

  expect(result.ruleCount).toBe(2);
  expect(result.size).toBe("5in 3in");
  expect(result.marginBoxes).toEqual(["top-center"]);
  // §5's bargain: anything the extractor rewrites is a feature we maintain
  // forever, so everything else must come through untouched.
  expect(result.keptLayer).toBe(true);
  expect(result.keptHas).toBe(true);
  expect(result.keptFontFace).toBe(true);
  expect(result.keptPseudoContent).toBe(true);
  expect(result.droppedPage).toBe(true);
});

test("does not mutate the source document", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const before = document.body.innerHTML;
    await window.folio.normalize(document);
    return { before, after: document.body.innerHTML };
  });

  expect(result.after).toBe(result.before);
});

test("the engine's iframe does not disturb the host page", async ({ page }) => {
  const result = await page.evaluate(() => {
    const heightBefore = document.documentElement.scrollHeight;
    const widthBefore = document.documentElement.scrollWidth;
    const frame = window.folio.createEngineFrame(document);
    return {
      grew:
        document.documentElement.scrollHeight > heightBefore ||
        document.documentElement.scrollWidth > widthBefore,
      invisible: frame.getBoundingClientRect().width === 0,
      ownDocument: frame.contentDocument !== null,
    };
  });

  expect(result.grew, "the engine frame changed the host page's scroll size").toBe(false);
  expect(result.invisible).toBe(true);
  expect(result.ownDocument).toBe(true);
});

test("resolves page geometry from the document's own CSS", async ({ page }) => {
  const specs = await page.evaluate(async () => {
    const doc = await window.folio.normalize(document);
    const ctx = (index: number, side: "left" | "right") => ({
      index,
      name: null,
      side,
      blank: false,
    });
    const first = window.folio.resolvePageSpec(doc.pageRules, ctx(1, "right"));
    const second = window.folio.resolvePageSpec(doc.pageRules, ctx(2, "left"));
    return {
      size: first.size,
      firstTop: first.margins.blockStart,
      secondTop: second.margins.blockStart,
      area: window.folio.contentArea(first),
    };
  });

  // 5in x 3in at 96dpi, 0.5in margins, with :first overriding margin-top to 1in.
  expect(specs.size).toEqual([480, 288]);
  expect(specs.firstTop).toBe(96);
  expect(specs.secondTop).toBe(48);
  expect(specs.area).toEqual({ inline: 384, block: 144 });
});

test("the engine's frame is in standards mode, as the source is", async ({ page }) => {
  const modes = await page.evaluate(() => {
    const frame = window.folio.createEngineFrame(document);
    return {
      source: document.compatMode,
      frame: (frame.contentDocument as Document).compatMode,
    };
  });

  // A blank iframe is in quirks mode. Author CSS measured there is not the
  // CSS the author wrote for the page it came from.
  expect(modes.frame).toBe("CSS1Compat");
  expect(modes.frame).toBe(modes.source);
});
