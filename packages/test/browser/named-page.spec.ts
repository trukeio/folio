/**
 * M2.1: named pages, through the carrier of §5.
 *
 * `page: chapter` is a property the engine has to see but must not cascade
 * itself. The rewrite gives it to the browser as `--x-page`, the browser
 * cascades it with everything else, and the engine reads the result — which
 * is the whole of §5 in one feature.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/named-page.html";

declare global {
  interface Window {
    folio: typeof Folio;
    runNamed: () => Promise<{
      count: number;
      names: string[];
      sizes: [number, number][];
      heads: string[];
      texts: string[];
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runNamed = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const { records, sheets, pages } = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
      });

      return {
        count: records.length,
        names: sheets.map((s) => s.dataset["pageName"] ?? ""),
        sizes: records.map((r) => r.spec.size),
        heads: sheets.map(
          (s) => s.querySelector(".folio-margin-top-center")?.textContent ?? "",
        ),
        texts: pages.map((p) => p.textContent.trim()),
      };
    };
  });
});

test("a change of named page forces a break", async ({ page }) => {
  const r = await page.evaluate(() => window.runNamed());

  // Three short blocks that would sit on one page; the name changes twice, so
  // there are three pages. CSS Paged Media: content cannot be on two named
  // pages at once.
  expect(r.count).toBe(3);
  expect(r.texts).toEqual(["Front matter.", "Chapter one opens here.", "Back matter."]);
});

test("the named page brings its own geometry and margin boxes", async ({ page }) => {
  const r = await page.evaluate(() => window.runNamed());

  expect(r.names).toEqual(["", "chapter", ""]);
  // @page chapter is 400x400; the default page is 400x300.
  expect(r.sizes).toEqual([
    [400, 300],
    [400, 400],
    [400, 300],
  ]);
  expect(r.heads).toEqual(["body", "chapter", "body"]);
});

test("break-before: right leaves a blank page when it must", async ({ page }) => {
  const result = await page.evaluate(() => {
    const t = window.folio;
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    const src = document.createElement("div");
    // One short block, then a block demanding a right (recto) page. Page 2
    // would be a left page, so a blank one goes between.
    src.innerHTML = "<p>One</p><p style='break-before:right'>Two</p>";
    document.body.append(src);

    const { records, pages } = t.paginate({ source: src, pageRules: [], target });
    src.remove();

    return {
      count: records.length,
      blanks: records.map((r) => r.spec.blank),
      sides: records.map((r) => r.spec.side),
      texts: pages.map((p) => p.textContent.trim()),
    };
  });

  expect(result.count).toBe(3);
  expect(result.texts).toEqual(["One", "", "Two"]);
  expect(result.blanks).toEqual([false, true, false]);
  // The content lands on a right page, which is what the author asked for.
  expect(result.sides).toEqual(["right", "left", "right"]);
});

test("a blank page holds nothing, so the content check still passes", async ({ page }) => {
  const result = await page.evaluate(() => {
    const t = window.folio;
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    const src = document.createElement("div");
    src.innerHTML = "<p>One</p><p style='break-before:right'>Two</p><p>Three</p>";
    document.body.append(src);

    const { pages } = t.paginate({ source: src, pageRules: [], target });
    const joined = pages.map((p) => p.textContent).join("");
    const source = src.textContent;
    src.remove();
    return { joined, source };
  });

  expect(result.joined).toBe(result.source);
});
