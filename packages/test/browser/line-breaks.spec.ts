/**
 * A page break at a forced line break.
 *
 * A line ended by `<br>` breaks at the end of its text, and the offset found
 * there is also the offset before the `<br>`. Taken literally, the next page
 * began with the `<br>`, which is an empty first line: every continued page
 * held one line fewer than fits.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

test("a page after a <br> starts with the next line, not an empty one", async ({ page }) => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("<br>");
  await page.setContent(
    `<!doctype html><style>@page { size: 400px 210px; margin: 0 } body { margin: 0; font: 16px/20px serif }</style><div>${lines}</div>`,
  );
  await injectEngine(page);
  const r = await page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    return {
      firsts: flow.pages.map((p) => (p.querySelector("div")?.firstChild?.textContent ?? "").trim()),
      text: flow.pages.map((p) => p.textContent).join("").replace(/\s+/g, ""),
    };
  });
  // Ten 20px lines a page, with room to spare, each page beginning with its
  // first line's text.
  expect(r.firsts).toEqual(["line 0", "line 10", "line 20"]);
  expect(r.text).toBe(Array.from({ length: 30 }, (_, i) => `line${i}`).join(""));
});

test("an image that begins the next line stays on the next page", async ({ page }) => {
  const img = `<img style="display:inline-block;width:10px;height:10px;background:red" alt="">`;
  const lines = Array.from({ length: 12 }, (_, i) => `${img}line ${i}`).join(" ");
  await page.setContent(
    `<!doctype html><style>@page { size: 90px 100px; margin: 0 } body { margin: 0; font: 16px/20px serif }</style><div>${lines}</div>`,
  );
  await injectEngine(page);
  const r = await page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    return { overflowed: flow.overflowed, images: flow.pages.map((p) => p.querySelectorAll("img").length) };
  });
  expect(r.overflowed).toEqual([]);
  expect(r.images.reduce((a, b) => a + b, 0)).toBe(12);
});
