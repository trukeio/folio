/**
 * `::nth-fragment()` on rung P+ (`doc/review.md` §8).
 *
 * The selector is rewritten to an attribute test, and each element on a page
 * is stamped with the fragment it is there before the page is measured, so a
 * fragment's own size is what the break is chosen against.
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

async function run(page: Page, html: string, selector: string) {
  await page.setContent(`<!doctype html>${html}`);
  await injectEngine(page);
  return page.evaluate(async (selector) => {
    const t = window.folio;
    const flow = await new t.Previewer().preview();
    const block = t.contentArea(flow.records[0]?.spec as Folio.PageSpec).block;
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      heights: flow.pages.map((p) => (p.querySelector("folio-content") as HTMLElement).scrollHeight),
      block,
      // Per page, each matching element's colour and font size.
      found: flow.pages.map((p) =>
        [...p.querySelectorAll<HTMLElement>(selector)].map((el) => {
          const s = getComputedStyle(el);
          return `${el.id}:${s.color}:${s.fontSize}`;
        }),
      ),
      text: flow.pages.map((p) => p.textContent).join("").replace(/\s+/g, ""),
    };
  }, selector);
}

const PAGE = "@page { size: 400px 200px; margin: 0 } body { margin: 0; font: 16px/20px serif } p { margin: 0 }";
const LINES = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("<br>");

test("each fragment of a split element is styled by its index, and a whole one is fragment 1", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE}
       p::nth-fragment(1) { color: rgb(255, 0, 0) }
       p::nth-fragment(2) { color: rgb(0, 0, 255) }
       p::nth-fragment(3) { color: rgb(0, 128, 0) }</style>
     <p id="a">Whole.</p><p id="b">${LINES(20)}</p>`,
    "p",
  );
  expect(r.total).toBe(3);
  expect(r.found[0]).toEqual(["a:rgb(255, 0, 0):16px", "b:rgb(255, 0, 0):16px"]);
  expect(r.found[1]).toEqual(["b:rgb(0, 0, 255):16px"]);
  expect(r.found[2]).toEqual(["b:rgb(0, 128, 0):16px"]);
});

test("a fragment's own size is what its page is measured with", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} div::nth-fragment(n+2) { font-size: 24px; line-height: 40px }</style><div id="d">${LINES(28)}</div>`,
    "div",
  );
  expect(r.overflowed).toEqual([]);
  for (const h of r.heights) expect(h).toBeLessThanOrEqual(r.block + 1);
  // Page 1 has ten 20px lines. Measured at 16px, the rest would be two more
  // pages; at 40px they are five lines a page, which is four.
  expect(r.total).toBeGreaterThanOrEqual(5);
  expect(r.found.slice(1).map((p) => p[0])).toEqual(Array(r.total - 1).fill("d:rgb(0, 0, 0):24px"));
  expect(r.found[0]?.[0]).toBe("d:rgb(0, 0, 0):16px");
  expect(r.text).toBe(Array.from({ length: 28 }, (_, i) => `line${i}`).join(""));
});

test("a smaller fragment fills its page, because its page is measured stamped", async ({ page }) => {
  // Measured unstamped, page 2 would break after ten 20px lines and show
  // them in half the page. Too tall is caught by measuring the page after;
  // too short is not, so this is the case that needs the measuring box to
  // carry the stamps too.
  const r = await run(
    page,
    `<style>${PAGE} div::nth-fragment(n+2) { font-size: 8px; line-height: 10px }</style><div id="d">${LINES(45)}</div>`,
    "div",
  );
  // Ten lines on page 1, then about twenty a page; measured at 16px, ten.
  expect(r.total).toBe(3);
  expect(r.overflowed).toEqual([]);
});

test("odd and even, and the weight of a pseudo-element", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE}
       div::nth-fragment(odd) { color: rgb(255, 0, 0) }
       div::nth-fragment(even) { color: rgb(0, 0, 255) }
       .keep { color: rgb(0, 128, 0) }</style>
     <div id="d">${LINES(25)}</div><div id="k" class="keep">${LINES(12)}</div>`,
    "div",
  );
  const d = r.found.map((p) => p.find((s) => s.startsWith("d:"))?.split(":")[1]).filter((c) => c !== undefined);
  expect(d).toEqual(["rgb(255, 0, 0)", "rgb(0, 0, 255)", "rgb(255, 0, 0)"]);
  // A class outweighs a type selector with a pseudo-element.
  for (const p of r.found) for (const s of p.filter((x) => x.startsWith("k:"))) expect(s).toContain("rgb(0, 128, 0)");
});

test("a document without the selector is not stamped", async ({ page }) => {
  await run(page, `<style>${PAGE}</style><p>${LINES(20)}</p>`, "p");
  expect(await page.locator("[data-folio-nth]").count()).toBe(0);
});
