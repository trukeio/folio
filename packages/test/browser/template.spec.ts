/**
 * M1.5: the page template and its margin boxes.
 *
 * The geometry is a CSS grid whose outer tracks are the page margins (§4), so
 * what is worth asserting is that the boxes land where the spec says and that
 * the counters resolve — including `counter(pages)`, which cannot be known
 * until the last page exists.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import type * as Viewer from "@truke/folio-viewer";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/template.html";

declare global {
  interface Window {
    folio: typeof Folio;
    folioViewer: typeof Viewer;
    runTemplate: () => Promise<{
      count: number;
      marginText: Record<string, string>[];
      pageRect: { width: number; height: number };
      contentRect: { x: number; y: number; width: number; height: number };
      topCenterStyle: { fontStyle: string; justifyContent: string };
      dataset: { number: string; side: string }[];
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runTemplate = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const { records, sheets } = t.paginate({ source: src, pageRules: doc.pageRules, target });

      const first = sheets[0] as HTMLElement;
      const content = first.querySelector(".folio-content") as HTMLElement;
      const page = first.getBoundingClientRect();
      const inner = content.getBoundingClientRect();
      const topCenter = first.querySelector(".folio-margin-top-center") as HTMLElement;
      const cs = getComputedStyle(topCenter);

      return {
        count: records.length,
        marginText: sheets.map((sheet) =>
          Object.fromEntries(
            [...sheet.querySelectorAll("[class*=folio-margin-]")].map((box) => [
              (box.className.match(/folio-margin-([\w-]+)/) ?? [])[1] ?? "?",
              box.textContent,
            ]),
          ),
        ),
        pageRect: { width: page.width, height: page.height },
        contentRect: {
          x: inner.left - page.left,
          y: inner.top - page.top,
          width: inner.width,
          height: inner.height,
        },
        topCenterStyle: { fontStyle: cs.fontStyle, justifyContent: cs.justifyContent },
        dataset: sheets.map((s) => ({
          number: s.dataset["pageNumber"] ?? "",
          side: s.dataset["pageSide"] ?? "",
        })),
      };
    };
  });
});

test("the page is the paper size and the content area is inside its margins", async ({ page }) => {
  const r = await page.evaluate(() => window.runTemplate());

  expect(r.pageRect).toEqual({ width: 400, height: 300 });
  // 20px side margins, 30px top and bottom: the grid's outer tracks.
  expect(r.contentRect).toEqual({ x: 20, y: 30, width: 360, height: 240 });
});

test("margin boxes carry their content and their own style", async ({ page }) => {
  const r = await page.evaluate(() => window.runTemplate());

  expect(r.marginText[0]?.["top-center"]).toBe("The Title");
  expect(r.marginText[0]?.["top-left-corner"]).toBe("x");
  expect(r.topCenterStyle.fontStyle).toBe("italic");
  // A `-center` box centres, per its name.
  expect(r.topCenterStyle.justifyContent).toBe("center");
});

test("counter(page) counts up and counter(pages) knows the total", async ({ page }) => {
  const r = await page.evaluate(() => window.runTemplate());

  expect(r.count).toBe(3);
  expect(r.marginText.map((m) => m["bottom-right"])).toEqual(["1", "2", "3"]);
  // `pages` is only knowable after the last page — the extra pass §4 predicts.
  expect(r.marginText.map((m) => m["bottom-left"])).toEqual([
    "page 1 of 3",
    "page 2 of 3",
    "page 3 of 3",
  ]);
});

test("pages know their number and side", async ({ page }) => {
  const r = await page.evaluate(() => window.runTemplate());

  expect(r.dataset).toEqual([
    { number: "1", side: "right" },
    { number: "2", side: "left" },
    { number: "3", side: "right" },
  ]);
});

test("the viewer shows the pages without taking them from the engine", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const t = window.folio;
    const src = document.getElementById("src") as Element;
    const doc = await t.normalize(document);
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;
    const style = target.createElement("style");
    style.textContent = `body{margin:0}\n${doc.authorCss}`;
    target.head.append(style);
    await target.fonts.ready;

    const { sheets } = t.paginate({ source: src, pageRules: doc.pageRules, target });
    const host = document.createElement("div");
    document.body.append(host);

    const viewer = window.folioViewer.renderViewer({ host, sheets });
    const shown = host.querySelectorAll(".folio-viewer-page").length;
    const stillInEngine = sheets.every((s) => target.body.contains(s));

    viewer.destroy();
    const afterDestroy = host.querySelectorAll(".folio-viewer-page").length;
    host.remove();

    return { shown, stillInEngine, afterDestroy, sheetCount: sheets.length };
  });

  expect(result.shown).toBe(result.sheetCount);
  // Importing, not moving: a page can still be laid out again from its record.
  expect(result.stillInEngine).toBe(true);
  expect(result.afterDestroy).toBe(0);
});
