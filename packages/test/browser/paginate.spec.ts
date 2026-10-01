/**
 * M1: the pagination loop, end to end.
 *
 * This is the first test of the engine as a whole rather than of one of its
 * parts, so it asserts the invariants of `doc/plan.md` §9 directly: every
 * character exactly once, no page overflowing its area, forced breaks
 * honoured, and the same input giving the same positions.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/paginate.html";

declare global {
  interface Window {
    folio: typeof Folio;
    run: () => Promise<{
      pageTexts: string[];
      sourceText: string;
      pageCount: number;
      overflowed: number[];
      heights: number[];
      limit: number;
      records: { start: string; end: string }[];
      forcedPageStartsWith: string | null;
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.run = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);

      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      // The page's own CSS, so the clone lays out as the source does.
      const style = target.createElement("style");
      style.textContent = doc.authorCss;
      target.head.append(style);
      await target.fonts.ready;

      const { records, pages, overflowed } = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
      });

      const spec = records[0]?.spec;
      const area = spec === undefined ? { block: 0 } : t.contentArea(spec);

      return {
        pageTexts: pages.map((p) => p.textContent),
        sourceText: src.textContent,
        pageCount: records.length,
        overflowed,
        // scrollHeight: the content area is a grid item, so its bounding rect
        // is the cell's size whatever it holds — measuring that asks the page
        // how big the page is, and the assertion can never fail.
        heights: pages.map((p) => p.scrollHeight),
        limit: area.block,
        records: records.map((r) => ({
          start: t.positionKey(r.start),
          end: t.positionKey(r.end),
        })),
        forcedPageStartsWith:
          pages
            .map((p) => p.textContent.trim())
            .find((text) => text.startsWith("Forced heading")) ?? null,
      };
    };
  });
});

test("every source character appears exactly once across the pages", async ({ page }) => {
  const result = await page.evaluate(() => window.run());

  expect(result.pageCount).toBeGreaterThan(1);
  expect(result.pageTexts.join("")).toBe(result.sourceText);
});

test("no page overflows its content area", async ({ page }) => {
  const result = await page.evaluate(() => window.run());

  expect(result.overflowed).toEqual([]);
  for (const height of result.heights) {
    expect(height).toBeLessThanOrEqual(result.limit);
  }
});

test("a forced break starts its own page", async ({ page }) => {
  const result = await page.evaluate(() => window.run());

  // plan.md §9 makes this an invariant, not a preference.
  expect(result.forcedPageStartsWith).not.toBeNull();
});

test("pages join end to start, with no gap and no overlap", async ({ page }) => {
  const result = await page.evaluate(() => window.run());

  for (let i = 1; i < result.records.length; i++) {
    expect(result.records[i]?.start).toBe(result.records[i - 1]?.end);
  }
});

test("the same input produces the same positions", async ({ page }) => {
  const first = await page.evaluate(() => window.run());
  const second = await page.evaluate(() => window.run());

  expect(second.records).toEqual(first.records);
  expect(second.pageCount).toBe(first.pageCount);
});

test("fills pages by breaking inside paragraphs, not only between blocks", async ({ page }) => {
  const result = await page.evaluate(() => window.run());

  // A page that stops at the first free block break leaves the rest of the
  // page empty, and every record's end lands on a block boundary with offset
  // zero. At least one break must fall inside a paragraph's text.
  const insideText = result.records.filter((r) => !r.end.endsWith("+0"));
  expect(insideText.length).toBeGreaterThan(0);
});

test("honours a forced break even when everything would fit on one page", async ({ page }) => {
  const result = await page.evaluate(() => {
    const t = window.folio;
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    // Three short blocks with forced breaks between them: comfortably one
    // page's worth of content, and three pages' worth of instructions.
    const src = document.createElement("div");
    src.innerHTML =
      "<p>One</p><p style='break-before:page'>Two</p><p style='break-before:page'>Three</p>";
    document.body.append(src);

    const { records, pages } = t.paginate({
      source: src,
      pageRules: [],
      target,
    });
    src.remove();
    return { count: records.length, texts: pages.map((p) => p.textContent) };
  });

  expect(result.count).toBe(3);
  expect(result.texts).toEqual(["One", "Two", "Three"]);
});

test("an empty box with a forced break after it is a page, and does not stall", async ({ page }) => {
  const result = await page.evaluate(() => {
    const t = window.folio;
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    // An empty element carrying a forced break, first in the flow. It was
    // once taken for no page at all; Chromium prints it as a blank first
    // page (three pages, checked with page.pdf), and so does WPT's
    // `zero-height-page-break-001` in the middle of a document. What must
    // not happen is the old failure: a break that does not advance, so the
    // next page starts where this one did and the loop stalls.
    const src = document.createElement("div");
    src.innerHTML =
      "<div style='break-after:page'></div><p>One</p><p style='break-before:page'>Two</p>";
    document.body.append(src);

    const { records, pages } = t.paginate({ source: src, pageRules: [], target });
    src.remove();
    return { count: records.length, texts: pages.map((p) => p.textContent) };
  });

  expect(result.texts).toEqual(["", "One", "Two"]);
  expect(result.count).toBe(3);
});

test("a formula is one box to the page, but for the rows of a broken equation", async ({ page }) => {
  // A fraction's numerator sits above its denominator, and the walk used to
  // offer a free break between them — half a fraction on each page. Firefox
  // said so ("Incorrect number of children for <mfrac/>") while measuring.
  const inside = await page.evaluate(() => {
    const t = window.folio;
    const box = document.createElement("div");
    box.style.cssText = "width:400px;font:16px/1.5 serif";
    box.innerHTML =
      "<p>Before.</p>" +
      '<math display="block"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>' +
      '<math display="block"><mrow><mo>[</mo><mtable><mtr><mtd><mn>1</mn></mtd></mtr><mtr><mtd><mn>2</mn></mtd></mtr></mtable><mo>]</mo></mrow></math>' +
      "<p>After.</p>";
    document.body.append(box);
    const candidates = t.enumerateCandidates(box, { measurer: t.domMeasurer(box) });
    const at = (path: number[]): Node | undefined =>
      path.reduce<Node | undefined>((n, i) => n?.childNodes[i], box);
    const found = candidates.filter((c) => {
      const node = at(c.position.path);
      return node instanceof Element && node.closest("math") !== null && node.localName !== "math";
    });
    box.remove();
    return found.length;
  });
  expect(inside).toBe(0);
});

test("a chunk never ends inside a formula, on either engine", async ({ page }) => {
  // The measuring box holds a chunk cut at a character budget. Cut inside a
  // <math>, it held half a fraction — invalid MathML, which Firefox reported
  // while measuring. MathML counts as coupled by namespace, because Firefox
  // computes it `display: inline` and a display test never saw it.
  const end = await page.evaluate(() => {
    const t = window.folio;
    const src = document.createElement("div");
    src.innerHTML = '<p>abc</p><math display="block"><mfrac><mi>xyz</mi><mi>uvw</mi></mfrac></math><p>def</p>';
    document.body.append(src);
    // "abc" is 3 characters and "xyz" 3 more: a budget of 5 runs out inside it.
    const chunk = t.chunkFrom(src, { path: [], offset: 0, after: false }, 5);
    src.remove();
    return chunk.end;
  });
  // After the whole <math>, the source's second child, and nowhere inside it.
  expect(end).toEqual({ path: [1], offset: 0, after: true });
});
