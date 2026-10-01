/**
 * The page counter is a counter (`page-counters.ts`, css-page-3 §6.1).
 *
 * The way a Paged.js book numbers its body from 1 after the front matter is
 * `main { counter-reset: page 1 }`, and it was ignored: every footer printed
 * the page's index. And a table of contents printed with `target-counter(…,
 * page)` has to agree with the footers, or it sends the reader to the wrong
 * page — so both are read back here, from the same run.
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

const BOOK = `<!doctype html>
<style>
  @page { size: 400px 300px; margin: 40px; @bottom-center { content: counter(page) } }
  @page front { @bottom-center { content: counter(page, lower-roman) } }
  .front { page: front }
  .front section + section { break-before: page }
  main { counter-reset: page 1; break-before: page }
  main section + section { break-before: page }
  .toc a::after { content: " " target-counter(attr(href), page) }
</style>
<div class="front">
  <section><h1>Title</h1></section>
  <section class="toc">
    <a href="#one">One</a><br><a href="#two">Two</a><br><a href="#three">Three</a>
  </section>
</div>
<main>
  <section id="one"><h2>One</h2></section>
  <section id="two"><h2>Two</h2></section>
  <section id="three"><h2>Three</h2></section>
</main>`;

async function run(page: Page, html: string) {
  await page.setContent(html);
  await injectEngine(page);
  return page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    const footer = (p: Element) => p.querySelector(".pagedjs_margin-bottom-center")?.textContent ?? "";
    const toc = [...document.querySelectorAll(".pagedjs_pages .toc a")].map((a) => {
      const attr = [...a.attributes].find((x) => x.name.startsWith("data-x-ref"));
      return attr?.value ?? null;
    });
    // The page each section starts on, by the footer printed on that page.
    const at = (id: string) => {
      const pageOf = flow.pages.find((p) => p.querySelector(`#${id}`) !== null);
      return pageOf === undefined ? null : footer(pageOf);
    };
    return {
      footers: flow.pages.map(footer),
      numbers: flow.records.map((r) => r.number),
      toc,
      targets: ["one", "two", "three"].map(at),
    };
  });
}

test("counter-reset: page 1 numbers the body from 1 after the front matter", async ({ page }) => {
  const r = await run(page, BOOK);
  expect(r.footers).toEqual(["i", "ii", "1", "2", "3"]);
  expect(r.numbers).toEqual([1, 2, 1, 2, 3]);
});

test("target-counter(…, page) prints the number in the footer, not the index", async ({ page }) => {
  const r = await run(page, BOOK);
  expect(r.toc).toEqual(["1", "2", "3"]);
  expect(r.targets).toEqual(r.toc);
});

test("a counter-increment in a margin box does not touch the document's counters", async ({ page }) => {
  // On the element it would be counted by the browser too: the header's
  // increment would advance `chapter` for every heading after it.
  const r = await page.setContent(`<!doctype html><style>
      @page { size: 400px 300px; margin: 40px;
        @top-center { counter-increment: chapter 100; content: counter(chapter) } }
      h2 { counter-increment: chapter; break-before: page }
      h2::before { content: counter(chapter) ". " }
    </style><h2 id="a">A</h2><h2 id="b">B</h2>`).then(async () => {
    await injectEngine(page);
    return page.evaluate(async () => {
      const flow = await new window.folio.Previewer().preview();
      const boxes = flow.pages.map((p) => p.querySelector(".pagedjs_margin-top-center") as Element);
      return {
        text: boxes.map((b) => b.textContent),
        // What the browser would count, which would be drawn in `h2::before`
        // and can be read back nowhere else.
        browser: boxes.map((b) => getComputedStyle(b).counterIncrement),
      };
    });
  });
  // The box counts for itself: the page's chapter plus its own 100.
  expect(r.text).toEqual(["101", "102"]);
  expect(r.browser).toEqual(["none", "none"]);
});
