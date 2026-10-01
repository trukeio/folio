/**
 * M6: four things the engine got wrong that WPT's paginated tests found, once
 * they could be run with the engine loaded (`wpt.mjs --folio`). Each is the
 * smallest document that shows it; the WPT test that found it is named.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

const PAGE = "size: 400px 200px; margin: 20px";

async function preview(page: Page, html: string) {
  await page.setContent(html);
  await injectEngine(page);
  return page.evaluate(async (pageDefaults) => {
    const flow = await new window.folio.Previewer({ pageDefaults }).preview();
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      boxes: flow.pages.map((p) =>
        [...p.querySelectorAll(".pagedjs_margin")].map((b) =>
          [...b.classList].find((c) => c.startsWith("pagedjs_margin-")),
        ),
      ),
      heights: flow.pages.map((p) =>
        [...p.querySelectorAll(".block")].map((b) => Math.round(b.getBoundingClientRect().height)),
      ),
    };
  }, PAGE);
}

test("text before a forced break is content, so the break is kept", async ({ page }) => {
  // WPT css-page/margin-boxes/content-004-print.
  const run = await preview(
    page,
    `Bare text in the body.
     <div style="break-before: page">Two</div>
     <div style="break-before: page">Three</div>`,
  );
  expect(run.total).toBe(3);
});

test("a margin box with no content, or none or normal, is not generated", async ({ page }) => {
  // WPT css-page/margin-boxes/content-001-print.
  const run = await preview(
    page,
    `<style>@page {
      @top-left { background: red }
      @top-center { content: none; background: red }
      @top-right { content: normal; background: red }
      @bottom-left { content: ""; background: yellow }
      @bottom-right { content: "x" }
    }</style><p>One page.</p>`,
  );
  // In paint order, which runs right to left along the bottom edge.
  expect(run.boxes).toEqual([["pagedjs_margin-bottom-right", "pagedjs_margin-bottom-left"]]);
});

test("a named page in a style attribute is a named page", async ({ page }) => {
  // WPT css-page/pseudo-first-margin-001-print.
  const run = await preview(
    page,
    `<div style="page: a">A</div><div style="page: b">B</div>`,
  );
  expect(run.total).toBe(2);
});

test("100vh is the page area, measured and shown", async ({ page }) => {
  // WPT css-page/page-margin-001-print: 160px is 200px less 2 × 20px margins,
  // with the test's own `body { margin: 0 }`.
  const run = await preview(
    page,
    `<style>body { margin: 0 } .block { height: 100vh }</style>
     <div class="block">1</div><div class="block" style="height: 50vh">2</div>
     <div class="block">3</div>`,
  );
  expect(run.overflowed).toEqual([]);
  // The third block begins in the 80px the second leaves and carries on
  // overleaf, as Chromium prints it (probed with `page.pdf`): its clone on
  // page 3 is the whole 160px box, shifted up by the 80 page 2 showed
  // (`doc/review.md` §4).
  expect(run.heights).toEqual([[160], [80, 80], [160]]);
});

test("an equation's number is where its gutter can print it", async ({ page }) => {
  // Found by the math example: the number was written on the wrapper and the
  // formula, and the gutter's `::after` reads `attr()` on the gutter, so the
  // default rendering was "()".
  await page.setContent(
    `<style>math[display=block] { math-number: yes }</style>
     <p>Text.</p><math display="block"><mi>a</mi></math><math display="block"><mi>b</mi></math>`,
  );
  await injectEngine(page);
  const gutters = await page.evaluate(async () => {
    await new window.folio.Previewer().preview();
    return [...document.querySelectorAll(".x-eq-num:last-child")].map((g) =>
      g.getAttribute("data-x-counter-equation"),
    );
  });
  expect(gutters).toEqual(["1", "2"]);
});

test("a negative page margin is page area past the page's edge", async ({ page }) => {
  // WPT css-page/page-margin-negative: a 340px area on a 300px page.
  await page.setContent(`<!doctype html><style>@page { size: 300px; margin: -20px } body { margin: 0 }</style>
    <div class="block" style="height: 20px"></div>`);
  await injectEngine(page);
  const r = await page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    const sheet = flow.pages[0] as HTMLElement;
    const area = (sheet.querySelector(".pagedjs_area") as Element).getBoundingClientRect();
    const box = sheet.getBoundingClientRect();
    return [Math.round(area.left - box.left), Math.round(area.width), Math.round(box.width)];
  });
  expect(r).toEqual([-20, 340, 300]);
});

test("the viewport is the first page's area, named or not", async ({ page }) => {
  // WPT css-page/page-size-009: the first page is `page: smaller`, 200px, and
  // `100vw` is 200px on the unnamed page after it too.
  await page.setContent(`<!doctype html><style>
      @page { size: 300px 400px; margin: 0 } @page smaller { size: 200px } body { margin: 0 }
    </style><div style="page: smaller">First.</div><div class="block" style="width: 100vw; height: 100vh"></div>`);
  await injectEngine(page);
  const r = await page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    const block = document.querySelector(".pagedjs_pages .block") as Element;
    const rect = block.getBoundingClientRect();
    return { total: flow.total, size: [Math.round(rect.width), Math.round(rect.height)] };
  });
  expect(r).toEqual({ total: 2, size: [200, 200] });
});
