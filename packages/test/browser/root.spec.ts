/**
 * The page area holds the root (`doc/review.md` §3).
 *
 * The engine used to compose the source root's *children* onto each page and
 * never the root itself, so the frame's own `html` and `body` stood in for
 * it: they matched the author's `html` and `body` rules, and nothing else did.
 * `<body class>`, `<body style="page: a">`, `body { display: grid }` and a
 * source root that was not `body` at all reached no page. Each test here is a
 * row of that review's table.
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

const PAGE = "@page { size: 400px 300px; margin: 20px }";

async function preview(page: Page, html: string, root?: string): Promise<number> {
  await page.setContent(`<!DOCTYPE html>${html}`);
  await injectEngine(page);
  return page.evaluate(async (r) => (await new window.folio.Previewer().preview(r)).total, root);
}

test("the root's class, style and page reach every page", async ({ page }) => {
  const total = await preview(
    page,
    `<style>${PAGE} @page a { size: 300px 400px } body.book p { color: rgb(0, 128, 0) }
      p { break-after: page }</style>
     <body class="book" style="page: a"><p>one</p><p>two</p></body>`,
  );
  expect(total).toBe(2);
  const seen = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".pagedjs_page")].map((p) => ({
      name: p.dataset["pageName"],
      color: getComputedStyle(p.querySelector("p") as Element).color,
      chain: [...p.querySelectorAll("[data-folio-chain]")].map((e) => e.localName).join(">"),
    })),
  );
  expect(seen).toEqual([
    { name: "a", color: "rgb(0, 128, 0)", chain: "html>body" },
    { name: "a", color: "rgb(0, 128, 0)", chain: "html>body" },
  ]);
});

test("body { display: grid } lays out on the page, one page for the grid", async ({ page }) => {
  const total = await preview(
    page,
    `<style>${PAGE} body { display: grid; grid-template-columns: 1fr 1fr; height: 100vh; margin: 0 }
      div { height: 100px }</style>
     <body><div>left</div><div>right</div><div>left</div><div>right</div></body>`,
  );
  // As blocks, four 100px cells are two pages of a 260px area; as a grid
  // they are two 100px rows on one page.
  expect(total).toBe(1);
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page div")].map((d) => Math.round(d.getBoundingClientRect().top)),
  );
  expect(tops[0]).toBe(tops[1]);
});

test("relative font sizes on html and body apply once, and rem is the root's", async ({ page }) => {
  await preview(
    page,
    `<style>${PAGE} html { font-size: 62.5% } body { font-size: 1.1em } .rem { font-size: 2rem }</style>
     <body><p id="p">x</p><p class="rem" id="r">x</p></body>`,
  );
  const sizes = await page.evaluate(() => ({
    p: getComputedStyle(document.querySelector(".pagedjs_page p") as Element).fontSize,
    rem: getComputedStyle(document.querySelector(".pagedjs_page .rem") as Element).fontSize,
  }));
  // The same as the document would compute on its own: 10px × 1.1, and 2 × 10px.
  expect(sizes).toEqual({ p: "11px", rem: "20px" });
});

test("a source root that is not body brings its own rules", async ({ page }) => {
  await preview(
    page,
    `<style>${PAGE} #doc { font-size: 20px } :root { --ink: rgb(0, 0, 255) } #doc p { color: var(--ink) }</style>
     <body><header>chrome</header><main id="doc"><p>text</p></main></body>`,
    "#doc",
  );
  const seen = await page.evaluate(() => {
    const p = document.querySelector(".pagedjs_page p") as Element;
    return {
      size: getComputedStyle(p).fontSize,
      color: getComputedStyle(p).color,
      chain: [...document.querySelectorAll(".pagedjs_page [data-folio-chain]")].map((e) => e.localName).join(">"),
    };
  });
  expect(seen).toEqual({ size: "20px", color: "rgb(0, 0, 255)", chain: "html>body>main" });
});

test("html { display: none } is one blank page, and the host still shows it", async ({ page }) => {
  const total = await preview(
    page,
    `<style>${PAGE} html { display: none }</style><body><p>This should not print.</p></body>`,
  );
  expect(total).toBe(1);
  const seen = await page.evaluate(() => {
    const sheet = document.querySelector(".pagedjs_page") as HTMLElement;
    const p = sheet.querySelector("p");
    return {
      shown: sheet.getBoundingClientRect().width > 0,
      text: p === null ? 0 : p.getClientRects().length,
    };
  });
  expect(seen).toEqual({ shown: true, text: 0 });
});

test("the UA's body margin is on the page, as CSS says, and an author's replaces it", async ({ page }) => {
  // `body { margin: 8px }` from the UA sheet, as Chromium prints it: on every
  // page's sides, and at the top of the first page only, since a margin at a
  // break belongs to the fragment before it (`doc/review.md` §3.6).
  const offsets = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".pagedjs_area")].map((area) => {
        const p = area.querySelector("p") as Element;
        const a = area.getBoundingClientRect();
        const r = p.getBoundingClientRect();
        return [Math.round(r.left - a.left), Math.round(r.top - a.top)];
      }),
    );
  await preview(
    page,
    `<style>${PAGE}</style><body><p style="margin: 0">x</p><p style="margin: 0; break-before: page">y</p></body>`,
  );
  expect(await offsets()).toEqual([
    [8, 8],
    [8, 0],
  ]);

  await preview(page, `<style>${PAGE} body { margin: 0 30px }</style><body><p style="margin: 0">x</p></body>`);
  expect(await offsets()).toEqual([[30, 0]]);
});

// Found while putting the root on the page: `body'` is continued on every page
// after the first, and equation numbering took a continuation's
// `counter-reset` as a new one. So did it for any split element — a section
// that resets `equation` numbered its second page from 1 again.
test("a section that resets equation, split across pages, numbers on", async ({ page }) => {
  await preview(
    page,
    `<style>${PAGE} math[display=block] { math-number: auto } section { counter-reset: equation }
      .tall { height: 200px }</style>
     <body><section>
       <math display="block" id="a"><mi>a</mi></math><div class="tall"></div>
       <math display="block" id="b"><mi>b</mi></math><div class="tall"></div>
       <math display="block" id="c"><mi>c</mi></math>
     </section></body>`,
  );
  const numbers = await page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page .x-eq")].map((eq) => [
      eq.closest(".pagedjs_page")?.id,
      eq.getAttribute("data-x-counter-equation"),
    ]),
  );
  expect(numbers.map(([, n]) => n)).toEqual(["1", "2", "3"]);
  // And it is a test of the continuation only if the section really spans pages.
  expect(new Set(numbers.map(([p]) => p)).size).toBeGreaterThan(1);
});

test("paginating an element, what is above it passes on only what it inherits", async ({ page }) => {
  // An application's shell: a sidebar grid on body, the document offscreen in
  // a holder. Paginating `#doc`, neither is the document's box.
  const total = await preview(
    page,
    `<style>${PAGE} body { display: grid; grid-template-columns: 200px 1fr; font-size: 20px }
      .holder { position: absolute; left: -9999px; color: rgb(0, 128, 0) }</style>
     <body><nav>sidebar</nav><div class="holder"><main id="doc"><p>text</p></main></div></body>`,
    "#doc",
  );
  expect(total).toBe(1);
  const seen = await page.evaluate(() => {
    const area = document.querySelector(".pagedjs_area") as Element;
    const p = area.querySelector("p") as Element;
    const a = area.getBoundingClientRect();
    const r = p.getBoundingClientRect();
    return {
      inside: r.left >= a.left && r.right <= a.right + 1,
      width: Math.round(r.width) === Math.round(a.width),
      size: getComputedStyle(p).fontSize,
      color: getComputedStyle(p).color,
    };
  });
  // On the page, full width; and still the size and colour it inherits.
  expect(seen).toEqual({ inside: true, width: true, size: "20px", color: "rgb(0, 128, 0)" });
});

test("the root's background is the canvas: the page area, not its margins", async ({ page }) => {
  await preview(
    page,
    `<style>${PAGE} body { background: rgb(255, 255, 0) } p { break-after: page }</style>
     <body><p>one</p><p>two</p></body>`,
  );
  const seen = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".pagedjs_page")].map((sheet) => {
      const canvas = sheet.querySelector(":scope > folio-canvas");
      const area = sheet.querySelector(".pagedjs_area") as Element;
      const a = area.getBoundingClientRect();
      const c = canvas?.getBoundingClientRect();
      return {
        color: canvas === null ? null : getComputedStyle(canvas).backgroundColor,
        fills: c !== undefined && Math.round(c.width) === Math.round(a.width) && Math.round(c.height) === Math.round(a.height),
        paper: getComputedStyle(sheet).backgroundColor,
        body: getComputedStyle(sheet.querySelector("[data-folio-root] > body") as Element).backgroundColor,
      };
    }),
  );
  // Yellow on the page area of both pages, white paper in the margins, and
  // body no longer painting it a second time only as tall as its text.
  const want = { color: "rgb(255, 255, 0)", fills: true, paper: "rgb(255, 255, 255)", body: "rgba(0, 0, 0, 0)" };
  expect(seen).toEqual([want, want]);
});

test("the canvas is one background cut across the pages", async ({ page }) => {
  // A no-repeat block of colour 150px tall, from the root's top: whole on a
  // 260px page one, even though page one's text is one line, and nowhere on
  // page two — a continued root fills its page (WPT page-background-001).
  await preview(
    page,
    `<style>${PAGE} body { background: linear-gradient(rgb(0, 0, 255), rgb(0, 0, 255)) no-repeat 0 0 / 50px 150px }
      p { break-after: page; margin: 0 }</style>
     <body><p>one</p><p>two</p></body>`,
  );
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page")].map((sheet) => {
      const image = sheet.querySelector(":scope > folio-canvas > folio-canvas") as HTMLElement;
      const area = (sheet.querySelector(".pagedjs_area") as Element).getBoundingClientRect();
      // Where the root's box starts, relative to this page area.
      return Math.round(image.getBoundingClientRect().top + parseFloat(getComputedStyle(image).borderTopWidth) - area.top);
    }),
  );
  expect(tops).toEqual([0, -260]);
});
