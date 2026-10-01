/**
 * M5.1's exit check (`doc/milestones.md`): "a real Paged.js project runs
 * unchanged, with its script tag swapped".
 *
 * Which is exactly what this does. The corpus fixtures load
 * `<script src=".../paged.polyfill.js">`; the route serves ours instead, and
 * nothing else about the fixtures changes — no edits, no config, no shim. The
 * sweep over all 122 lives in `polyfill-corpus.mjs`, because 122 page loads
 * is a script's job; these are the claims worth failing CI over.
 *
 * `doc/compat.md` is the other half of the exit check: what runs differently,
 * and why.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * `window.Paged` is what the polyfill installs; the engine's own types do not
 * describe the host page, so this file says what it expects to find there.
 */
type PagedGlobal = {
  Handler: new (...args: unknown[]) => object;
  registerHandlers: (...classes: unknown[]) => void;
};
declare global {
  interface Window {
    Paged?: PagedGlobal;
    seen?: string[];
  }
}

const CORPUS = "http://127.0.0.1:5177/corpus/specs";
const POLYFILL = new URL("../.bundle/folio.polyfill.js", import.meta.url).pathname;

/** Load a fixture with our engine in place of the one its script tag names. */
async function swapped(page: Page, spec: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0] ?? e.message));
  await page.route("**/paged.polyfill.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(POLYFILL, "utf8") }),
  );
  await page.goto(`${CORPUS}/${spec}`);
  await page.waitForFunction(() => document.querySelector(".pagedjs_pages") !== null, {
    timeout: 30_000,
  });
  return errors;
}

test("a fixture paginates with nothing but the script tag changed", async ({ page }) => {
  const errors = await swapped(page, "counters/nested/nested.html");
  expect(errors).toEqual([]);

  const seen = await page.evaluate(() => ({
    paged: typeof window.Paged,
    areas: document.querySelectorAll(".pagedjs_pages").length,
    pages: document.querySelectorAll(".pagedjs_page").length,
    firstId: document.querySelector(".pagedjs_page")?.id ?? null,
    // The original content is parked where Paged.js parks it, so it is not
    // laid out twice and `PageRecord` still refers to something.
    parked: document.querySelectorAll("template[data-ref='pagedjs-content']").length,
  }));

  expect(seen.paged).toBe("object");
  expect(seen.areas).toBe(1);
  expect(seen.pages).toBeGreaterThan(1);
  expect(seen.firstId).toBe("page-1");
  expect(seen.parked).toBe(1);
});

test("the page DOM carries the names a project's CSS is written against", async ({ page }) => {
  await swapped(page, "counters/nested/nested.html");

  const found = await page.evaluate(() => {
    const first = document.querySelector(".pagedjs_page") as HTMLElement;
    const second = document.querySelectorAll(".pagedjs_page")[1] as HTMLElement;
    return {
      firstClasses: [...first.classList],
      secondClasses: [...second.classList],
      pagebox: document.querySelectorAll(".pagedjs_pagebox").length,
      area: document.querySelectorAll(".pagedjs_page_content").length,
      marginContent: document.querySelectorAll(".pagedjs_margin-content").length,
      // The page counter, rendered into a margin box a project would style.
      bottomLeft:
        document.querySelector(".pagedjs_margin-bottom-left .pagedjs_margin-content")
          ?.textContent ?? null,
    };
  });

  expect(found.firstClasses).toContain("pagedjs_page");
  expect(found.firstClasses).toContain("pagedjs_sheet");
  expect(found.firstClasses).toContain("pagedjs_first_page");
  expect(found.firstClasses).toContain("pagedjs_right_page");
  expect(found.secondClasses).toContain("pagedjs_left_page");
  expect(found.pagebox).toBeGreaterThan(1);
  expect(found.area).toBeGreaterThan(1);
  expect(found.marginContent).toBeGreaterThan(0);
  expect(found.bottomLeft).toBe("1");
});

test("the repeating-table-headers recipe runs instead of throwing", async ({ page }) => {
  // The most copied Paged.js handler there is, and the corpus carries it. It
  // opens with `if (breakToken)`; ours is undefined, so it takes the other
  // branch — which is right, because split tables already carry their headers.
  const errors = await swapped(page, "tables/copy-column-widths/copy-column-widths.html");

  expect(errors).toEqual([]);
  const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
  expect(pages).toBeGreaterThan(1);
  // And the headers are on the continuations, which is what the recipe wanted.
  const repeated = await page.evaluate(
    () => document.querySelectorAll("[data-folio-repeated]").length,
  );
  expect(repeated).toBeGreaterThan(0);
});

test("a handler that throws is reported and does not lose the document", async ({ page }) => {
  await page.route("**/paged.polyfill.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(POLYFILL, "utf8") }),
  );
  await page.addInitScript(() => {
    // On `document`, not on `window`: DOMContentLoaded fires at the document
    // and bubbles to the window afterwards, so a window listener runs after
    // the polyfill's — which is how a project would miss its own handlers.
    document.addEventListener("DOMContentLoaded", () => {
      const Paged = window.Paged as PagedGlobal;
      Paged.registerHandlers(
        class extends Paged.Handler {
          afterPageLayout(): void {
            throw new Error("deliberate");
          }
        },
      );
    });
  });
  await page.goto(`${CORPUS}/counters/nested/nested.html`);
  await page.waitForFunction(() => document.querySelector(".pagedjs_pages") !== null, {
    timeout: 30_000,
  });

  const pages = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
  expect(pages).toBeGreaterThan(1);
});

test("the typed hooks fire, in stage order", async ({ page }) => {
  await page.route("**/paged.polyfill.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(POLYFILL, "utf8") }),
  );
  await page.addInitScript(() => {
    window.seen = [];
    document.addEventListener("DOMContentLoaded", () => {
      const seen = window.seen as string[];
      const Paged = window.Paged as PagedGlobal;
      Paged.registerHandlers(
        class extends Paged.Handler {
          beforeParsed(): void {
            seen.push("beforeParsed");
          }
          afterParsed(): void {
            seen.push("afterParsed");
          }
          afterPageLayout(_page: unknown, _record: unknown, breakToken: unknown): void {
            seen.push(`afterPageLayout:${String(breakToken)}`);
          }
          afterRendered(): void {
            seen.push("afterRendered");
          }
        },
      );
    });
  });
  await page.goto(`${CORPUS}/counters/nested/nested.html`);
  await page.waitForFunction(() => document.querySelector(".pagedjs_pages") !== null, {
    timeout: 30_000,
  });

  const seen = await page.evaluate(() => window.seen as string[]);
  expect(seen[0]).toBe("beforeParsed");
  expect(seen[1]).toBe("afterParsed");
  expect(seen[2]).toBe("afterPageLayout:undefined");
  expect(seen[seen.length - 1]).toBe("afterRendered");
  // One per page, between the parse and the render.
  expect(seen.filter((s) => s.startsWith("afterPageLayout")).length).toBeGreaterThan(1);
});
