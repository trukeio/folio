/**
 * Content taller than a page (`doc/review.md` §4).
 *
 * A box with a set height and nothing left in it to break between, and a
 * monolithic box, both cross the pages below them the way Chromium prints
 * them: the page ends inside the box, the next page shows the rest of it, and
 * what follows the box is where the box's height puts it. Before, the box
 * stayed on one page, overflowed it, and everything after it came too early.
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

const PAGE = `@page { size: 400px 300px; margin: 0 } body { margin: 0 }`;

async function run(page: Page, body: string) {
  await page.setContent(`<!doctype html><style>${PAGE}</style>${body}`);
  await injectEngine(page);
  return page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    const onPage = (id: string) => flow.pages.findIndex((p) => p.querySelector(`#${id}:not([data-folio-repeated])`) !== null) + 1;
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      onPage: Object.fromEntries(["tall", "after", "intro"].map((id) => [id, onPage(id)])),
      // The flow's text, less the parts of a box shown again on later pages.
      text: flow.pages
        .map((p) => {
          const clone = p.cloneNode(true) as Element;
          for (const el of clone.querySelectorAll("[data-folio-repeated], .pagedjs_margin")) el.remove();
          return clone.querySelector(".pagedjs_page_content")?.textContent ?? "";
        })
        .join("")
        .replace(/\s+/g, ""),
      // Where the box sits on each page it is on, and how much of it shows.
      slices: flow.pages.map((p) => {
        const content = p.querySelector(".pagedjs_page_content") as HTMLElement;
        const tall = p.querySelector("#tall");
        if (tall === null) return null;
        const top = content.getBoundingClientRect().top;
        const r = tall.getBoundingClientRect();
        return { top: Math.round(r.top - top), height: Math.round(r.height), clipped: content.style.clipPath !== "" };
      }),
      // Where the text after the box is, on its page.
      afterTop: (() => {
        const p = flow.pages.find((q) => q.querySelector("#after") !== null);
        const content = p?.querySelector(".pagedjs_page_content");
        const after = p?.querySelector("#after");
        return content == null || after == null
          ? null
          : Math.round(after.getBoundingClientRect().top - content.getBoundingClientRect().top);
      })(),
    };
  });
}

test("a block taller than the page continues on the pages below it", async ({ page }) => {
  const r = await run(
    page,
    `<div id="tall" style="height:750px; background:cyan">Top of the box.</div><p id="after" style="margin:0">After.</p>`,
  );
  expect(r.total).toBe(3);
  expect(r.overflowed).toEqual([]);
  // 300px on each of the first two pages, and the last 150 on the third.
  expect(r.slices).toEqual([
    { top: 0, height: 300, clipped: false },
    { top: -300, height: 600, clipped: true },
    { top: -600, height: 750, clipped: true },
  ]);
  expect(r.onPage.after).toBe(3);
  expect(r.afterTop).toBe(150);
  expect(r.text).toBe("Topofthebox.After.");
});

test("monolithic content taller than the page is sliced where it starts a page", async ({ page }) => {
  const r = await run(
    page,
    `<div id="tall" style="contain:size; height:500px; background:hotpink">Inside.</div><p id="after" style="margin:0">After.</p>`,
  );
  expect(r.total).toBe(2);
  expect(r.overflowed).toEqual([]);
  expect(r.onPage.after).toBe(2);
  expect(r.afterTop).toBe(200);
  expect(r.text).toBe("Inside.After.");
});

test("monolithic content after something else goes to the next page before it is sliced", async ({ page }) => {
  const r = await run(
    page,
    `<p id="intro" style="margin:0">Intro.</p><div id="tall" style="contain:size; height:500px"></div><p id="after" style="margin:0">After.</p>`,
  );
  expect(r.onPage).toEqual({ intro: 1, tall: 2, after: 3 });
  expect(r.total).toBe(3);
  expect(r.afterTop).toBe(200);
});

test("a continued box around the slice goes on with it", async ({ page }) => {
  const r = await run(
    page,
    `<section style="background:yellow"><div id="tall" style="height:450px"></div><p id="after" style="margin:0">Inside the section, after.</p></section>`,
  );
  expect(r.total).toBe(2);
  expect(r.overflowed).toEqual([]);
  expect(r.afterTop).toBe(150);
});

// Text no element holds by itself: directly in the source root, or loose
// beside a block. It had no line breaks at all, so a page of nothing but text
// overflowed (WPT `margin-boxes/auto-margins-001` on Firefox's larger font).
test("text directly in the root, and loose beside a block, breaks between its lines", async ({ page }) => {
  const words = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ".repeat(30);
  for (const body of [words, `<div style="height:40px"></div>${words}`, `${words}<div style="height:40px"></div>`]) {
    await page.setContent(`<!doctype html><style>${PAGE} body { font: 16px/20px serif }</style>${body}`);
    await injectEngine(page);
    const r = await page.evaluate(async () => {
      const flow = await new window.folio.Previewer().preview();
      const text = flow.pages
        .map((p) => p.querySelector(".pagedjs_page_content")?.textContent ?? "")
        .join("")
        .replace(/\s+/g, "");
      return { total: flow.total, overflowed: flow.overflowed, text };
    });
    expect(r.overflowed).toEqual([]);
    expect(r.total).toBeGreaterThan(1);
    expect(r.text).toBe(words.repeat(1).replace(/\s+/g, ""));
  }
});

// A box with a set height, split around a slice, has one height between its
// fragments: each page gives it the rest, cut at the page's end (`extents.ts`).
// It came back whole on every page, and the page's end was inside it again.
test("a box with a set height around a slice shares its height across the pages", async ({ page }) => {
  const r = await run(
    page,
    `<section style="height:750px; background:yellow"><div id="tall" style="contain:size; height:700px"></div></section><p id="after" style="margin:0">After.</p>`,
  );
  // Where the section ends on each page: its box is shifted up with the slice
  // inside it, so what it shows runs from the page's top to its bottom.
  const ends = await page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page")].map((p) => {
      const s = p.querySelector("section");
      const area = (p.querySelector(".pagedjs_area") as Element).getBoundingClientRect();
      return s === null ? null : Math.round(s.getBoundingClientRect().bottom - area.top);
    }),
  );
  expect(r.total).toBe(3);
  expect(r.overflowed).toEqual([]);
  expect(ends).toEqual([300, 300, 150]);
  expect(r.afterTop).toBe(150);
});

test("text inside monolithic content is not broken between its lines", async ({ page }) => {
  const words = "Inside a box that cannot be broken. ".repeat(40);
  const r = await run(page, `<div id="tall" style="contain:size; height:500px; width:200px">${words}</div><p id="after" style="margin:0">After.</p>`);
  // Neither the box nor anything in it is a split fragment: it is sliced whole.
  const split = await page.evaluate(
    () => document.querySelectorAll(".pagedjs_pages #tall[data-folio-split-from], .pagedjs_pages #tall [data-folio-split-from]").length,
  );
  expect(split).toBe(0);
  expect(r.total).toBe(2);
  expect(r.afterTop).toBe(200);
});

// An absolutely positioned monolithic box is fragmented too, as far as its
// ink goes where it does not clip (WPT `monolithic-overflow-027`, `-028`).
test("an absolutely positioned monolithic box is sliced to where its ink ends", async ({ page }) => {
  const overflowing = await run(
    page,
    `<div id="tall" style="position:absolute; width:100%; contain:size; height:400px"><div style="height:800px"></div></div>`,
  );
  expect(overflowing.total).toBe(3);
  const clipped = await run(
    page,
    `<div id="tall" style="position:absolute; width:100%; overflow-y:clip; contain:size; height:400px"><div style="height:2000px"></div></div>`,
  );
  expect(clipped.total).toBe(2);
});

// A box broken by a page break reaches the page's foot on that page, as
// Chromium prints it (probed with `page.pdf`; WPT `page-margin-004`).
test("a split box fills its page to the foot", async ({ page }) => {
  await run(page, `<section style="background:cyan"><p style="margin:0">One.</p><p id="after" style="margin:0; break-before:page">Two.</p></section>`);
  const ends = await page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page")].map((p) => {
      const s = p.querySelector("section") as Element;
      const area = (p.querySelector(".pagedjs_area") as Element).getBoundingClientRect();
      return Math.round(s.getBoundingClientRect().bottom - area.top);
    }),
  );
  expect(ends[0]).toBe(300);
  expect(ends[1]).toBeLessThan(300);
});

// A page measured absurdly long for its text set the characters-per-page
// estimate near zero; the next chunk's budget rounded to 0, and doubling 0
// grew nothing, forever (WPT `page-name-orthogonal-writing-002`'s reference,
// in horizontal writing here: the hang was not about the writing mode).
test("a huge margin does not hang pagination", async ({ page }) => {
  const r = await run(page, `<div style="margin-bottom:999in">a</div><div id="after">b</div>`);
  expect(r.total).toBeGreaterThanOrEqual(2);
  expect(r.overflowed).toEqual([]);
});
