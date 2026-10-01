/**
 * M6: the engine's elements are not the author's (`furniture.ts`).
 *
 * Found by the first WPT test run with the engine loaded, whose reference
 * said `div { height: 283px }` and so sized the engine's content areas. The
 * check is a control: the same document with and without a stylesheet that
 * restyles every div and span must paginate identically, because it has none.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/furniture.html";

type Shape = {
  pages: number;
  overflowed: number[];
  boxes: string[];
  notes: number;
  equations: number;
};

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

async function run(page: Page, hostile: boolean): Promise<Shape> {
  await page.goto(FIXTURE);
  await injectEngine(page);
  return page.evaluate(async (keep) => {
    if (!keep) document.getElementById("hostile")?.remove();
    const flow = await new window.folio.Previewer({ maxPages: 20 }).preview(
      document.getElementById("src"),
    );
    const size = (el: Element | null): string => {
      if (el === null) return "none";
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    return {
      pages: flow.total,
      overflowed: flow.overflowed,
      boxes: flow.pages.flatMap((p) => [
        size(p.matches(".pagedjs_pagebox") ? p : p.querySelector(".pagedjs_pagebox")),
        size(p.querySelector(".pagedjs_area")),
        size(p.querySelector(".pagedjs_margin-bottom-center")),
      ]),
      notes: flow.pages.reduce((n, p) => n + p.querySelectorAll(".folio-footnote").length, 0),
      equations: flow.pages.reduce((n, p) => n + p.querySelectorAll("folio-equation").length, 0),
    };
  }, hostile);
}

test("author rules for div and span do not reach the engine's elements", async ({ page }) => {
  const control = await run(page, false);
  const hostile = await run(page, true);
  expect(control.pages).toBeGreaterThan(1);
  expect(control.notes).toBe(1);
  expect(control.equations).toBe(1);
  expect(control.boxes.slice(0, 2)).toEqual(["320x240", "280x200"]);
  expect(hostile).toEqual(control);
});
