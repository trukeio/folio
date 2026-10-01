/**
 * M2.4: the stage 5 reference loop.
 *
 * "Equation (3.4) on page 128" is the capability §7 says MathJax cannot have
 * at any price, and it is this: a reference whose value is a page number,
 * which nothing knows until the document is paginated.
 *
 * The mechanism stays on rung P. `target-counter()` in a `content` value is
 * rewritten to `attr()`, and the engine writes the answer into that attribute
 * — so the author's selector, the cascade and the browser's own `::after` all
 * still do the work, and we supply only a number.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/cross-ref.html";

declare global {
  interface Window {
    folio: typeof Folio;
    runRefs: () => Promise<{
      count: number;
      refText: string;
      titleText: string;
      refAttr: string | null;
      targetPage: number | null;
      provides: string[][];
      refs: string[][];
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runRefs = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const { records, pages } = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
        references: doc.references,
      });

      const view = target.defaultView as Window;
      const refLink = pages[0]?.querySelector("a.ref") as Element;
      const titleLink = pages[0]?.querySelector("a.title") as Element;
      // Chromium serializes computed `content` concatenated, Firefox as the
      // list of its parts: `" (page 2)"` against `" (page " "2" ")"`. Strip
      // the quoting so the assertion is about the value, not the serializer.
      const after = (el: Element) =>
        view.getComputedStyle(el, "::after").content.replace(/["\s]/g, "");

      const targetPage = pages.findIndex((p) => p.querySelector("#later") !== null);

      return {
        count: records.length,
        refText: after(refLink),
        titleText: after(titleLink),
        refAttr: refLink.getAttribute("data-x-ref-0"),
        targetPage: targetPage === -1 ? null : targetPage + 1,
        provides: records.map((r) => [...r.provides]),
        refs: records.map((r) => [...r.refs]),
      };
    };
  });
});

test("a cross-reference resolves to the page its target landed on", async ({ page }) => {
  const r = await page.evaluate(() => window.runRefs());

  expect(r.count).toBeGreaterThan(1);
  expect(r.targetPage).not.toBeNull();
  // The number in the generated content is the page the target is really on,
  // which only the second pass could know.
  expect(r.refText).toContain(`(page${r.targetPage})`);
  // And the attribute the engine wrote is the page itself, not a rendering
  // of it: that is the value the browser's attr() read.
  expect(r.refAttr).toBe(String(r.targetPage));
});

test("target-text brings the target's words, not its page", async ({ page }) => {
  const r = await page.evaluate(() => window.runRefs());

  expect(r.titleText).toContain("TheLaterSection");
});

test("each page records what it provides and what it reads", async ({ page }) => {
  const r = await page.evaluate(() => window.runRefs());

  // PageRecord.refs and .provides, which have been empty sets since M1.
  expect(r.provides.flat()).toContain("later");
  expect(r.refs[0]).toContain("later");
  // The page holding the target provides it, and only that page.
  expect(r.provides.filter((p) => p.includes("later"))).toHaveLength(1);
});
