/**
 * The page box has a border and padding (css-page-3 §3, `css/page-box.ts`).
 *
 * They sit between the page's margins and its page area, so they take room
 * the fragmenter would otherwise fill: every break on the page depends on
 * them. And they are painted by §3.1's order — page background under the
 * whole page, the canvas on the page box's border box, the border above it.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { injectEngine } from "./inject.js";
import type * as Folio from "@truke/folio";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

async function preview(page: Page, html: string): Promise<number> {
  await page.setContent(`<!DOCTYPE html>${html}`);
  await injectEngine(page);
  return page.evaluate(async () => (await new window.folio.Previewer().preview()).total);
}

test("the page area is inside the margins, the border and the padding", async ({ page }) => {
  await preview(
    page,
    `<style>@page { size: 400px 300px; margin: 20px; border: 10px dotted; padding: 5% 10%; color: rgb(255, 0, 0) }</style>
     <body><p style="margin: 0">x</p></body>`,
  );
  const seen = await page.evaluate(() => {
    const sheet = document.querySelector(".pagedjs_page") as Element;
    const s = sheet.getBoundingClientRect();
    const a = (sheet.querySelector(".pagedjs_area") as Element).getBoundingClientRect();
    const border = sheet.querySelector('[data-folio-layer="border"]') as Element;
    const b = getComputedStyle(border);
    return {
      // Percentages of the page box on their own axis: 5% of 300, 10% of 400.
      area: [a.left - s.left, a.top - s.top, a.width, a.height].map(Math.round),
      border: [b.borderTopWidth, b.borderLeftStyle, b.borderTopColor],
    };
  });
  // 20 + 10 + 40 across, 20 + 10 + 15 down; 400 - 140 by 300 - 90.
  expect(seen.area).toEqual([70, 45, 260, 210]);
  // Drawn as wide as the area took, in the page's `color` when it has none.
  expect(seen.border).toEqual(["10px", "dotted", "rgb(255, 0, 0)"]);
});

test("the page background paints the margins too; the canvas, the page box", async ({ page }) => {
  await preview(
    page,
    `<style>@page { size: 400px 300px; margin: 50px; background: rgb(0, 0, 255) }
      @page :first { background: rgb(255, 255, 255) }
      body { background: rgb(255, 255, 0) } p { break-after: page }</style>
     <body><p>one</p><p>two</p></body>`,
  );
  // Page 2: blue at the corner, in the margin; yellow in the middle.
  const colours = await page.evaluate(() => {
    const sheet = document.querySelectorAll(".pagedjs_page")[1] as Element;
    const r = sheet.getBoundingClientRect();
    const at = (x: number, y: number): string[] =>
      document.elementsFromPoint(r.left + x, r.top + y).map((el) => getComputedStyle(el).backgroundColor);
    return { margin: at(10, 10), middle: at(200, 150) };
  });
  expect(colours.margin).toContain("rgb(0, 0, 255)");
  expect(colours.middle).toContain("rgb(255, 255, 0)");
});
