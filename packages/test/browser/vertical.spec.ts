/**
 * Vertical writing (`doc/review.md` §5).
 *
 * The measurer maps rectangles to logical ones by the writing mode of the box
 * it measures, so the content area and the measuring box take the root's flow,
 * and pages are cut along the block axis — x, in `vertical-rl`, progressing
 * right to left. The page box stays physical.
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

async function run(page: Page, html: string) {
  await page.setContent(`<!doctype html>${html}`);
  await injectEngine(page);
  return page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    const pages = [...document.querySelectorAll<HTMLElement>(".pagedjs_pages .pagedjs_page")];
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      sides: pages.map((p) => p.dataset["pageSide"] ?? ""),
      sizes: pages.map((p) => [Math.round(p.getBoundingClientRect().width), Math.round(p.getBoundingClientRect().height)]),
      // Less the slices of a box shown again on later pages.
      text: flow.pages
        .map((p) => {
          const clone = p.cloneNode(true) as Element;
          for (const el of clone.querySelectorAll("[data-folio-repeated]")) el.remove();
          return clone.textContent;
        })
        .join("")
        .replace(/\s+/g, ""),
    };
  });
}

const PAGE = "@page { size: 400px 300px; margin: 0 } body { margin: 0 }";

test("a vertical-rl document is cut along x, and its first page is a left page", async ({ page }) => {
  const r = await run(
    page,
    `<html style="writing-mode: vertical-rl"><style>${PAGE}</style>
     <div style="inline-size: 100px; block-size: 1000px; background: cyan">Tall along x.</div><p>After.</p></html>`,
  );
  // 1000px of block extent on 400px-wide pages, then the paragraph.
  expect(r.total).toBe(3);
  expect(r.overflowed).toEqual([]);
  expect(r.sides[0]).toBe("left");
  // The page box stays physical: a vertical host does not turn it.
  expect(r.sizes[0]).toEqual([400, 300]);
  expect(r.text).toBe("Tallalongx.After.");
});

test("vb is the block axis and vi the inline axis in a vertical root", async ({ page }) => {
  const r = await run(
    page,
    `<html style="writing-mode: vertical-rl"><style>${PAGE}</style>
     <div id="box" style="block-size: 100vb; inline-size: 50vi; background: yellow">x</div></html>`,
  );
  expect(r.total).toBe(1);
  const size = await page.evaluate(() => {
    const box = document.querySelector(".pagedjs_pages #box") as Element;
    return [Math.round(box.getBoundingClientRect().width), Math.round(box.getBoundingClientRect().height)];
  });
  expect(size).toEqual([400, 150]);
});

test("an orthogonal flow is one box to the page: no break inside it, forced or not", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE}</style><div style="writing-mode: vertical-rl; block-size: 100px">
       <div style="writing-mode: horizontal-tb"><p style="break-after: page">a</p><p>b</p></div></div>`,
  );
  expect(r.total).toBe(1);
});
