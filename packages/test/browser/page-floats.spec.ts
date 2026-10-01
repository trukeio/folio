/**
 * Page floats (`doc/review.md` §7).
 *
 * `float: top | bottom | snap-block` with `float-reference: page` takes an
 * element to an edge of the page its anchor is on, or of a later page when it
 * does not fit there, and never splits it.
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
    const t = window.folio;
    const flow = await new t.Previewer().preview();
    const block = t.contentArea(flow.records[0]?.spec as Folio.PageSpec).block;
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      block,
      pages: flow.pages.map((sheet) => {
        const p = sheet.querySelector("folio-content") as HTMLElement;
        const box = p.getBoundingClientRect();
        const edge = (name: string) => {
          const el = p.querySelector<HTMLElement>(`:scope > folio-page-floats[data-edge="${name}"]`);
          return el === null
            ? null
            : {
                ids: [...el.children].map((c) => c.id),
                top: Math.round(el.getBoundingClientRect().top - box.top),
                bottom: Math.round(box.bottom - el.getBoundingClientRect().bottom),
                first: p.firstElementChild === el,
              };
        };
        return { start: edge("start"), end: edge("end"), height: p.scrollHeight, inFlow: [...p.querySelectorAll("figure")].filter((f) => f.parentElement?.localName !== "folio-page-floats").map((f) => f.id) };
      }),
      text: flow.pages.map((p) => p.textContent).join("").replace(/\s+/g, ""),
    };
  });
}

const PAGE = "@page { size: 400px 300px; margin: 0 } body { margin: 0; font: 16px/20px serif } p { margin: 0 } figure { margin: 0; block-size: 100px; background: #ccc }";
const TEXT = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `<p>Line ${from + i}.</p>`).join("");

test("a top float goes to the top of its anchor's page, before the text above its anchor", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .top { float: top; float-reference: page }</style>${TEXT(4)}<figure id="f" class="top">F</figure>${TEXT(4, 4)}`,
  );
  expect(r.total).toBe(1);
  expect(r.pages[0]?.start).toEqual({ ids: ["f"], top: 0, bottom: expect.any(Number) as unknown as number, first: true });
  expect(r.pages[0]?.inFlow).toEqual([]);
  expect(r.text).toBe("FLine0.Line1.Line2.Line3.Line4.Line5.Line6.Line7.");
});

test("a bottom float sits at the page's foot", async ({ page }) => {
  const r = await run(page, `<style>${PAGE} .bottom { float: bottom; float-reference: page }</style>${TEXT(2)}<figure id="f" class="bottom">F</figure>${TEXT(2, 2)}`);
  expect(r.pages[0]?.end?.ids).toEqual(["f"]);
  expect(r.pages[0]?.end?.bottom).toBeLessThanOrEqual(1);
});

test("a float that does not fit waits for the next page, and the one after it waits too", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .top { float: top; float-reference: page } #big { block-size: 250px }</style>
     ${TEXT(10)}<figure id="big" class="top">B</figure><figure id="small" class="top">S</figure>${TEXT(20, 10)}`,
  );
  expect(r.overflowed).toEqual([]);
  // Line 10 is past half of page one; 250px beside ten lines does not fit.
  expect(r.pages[0]?.start).toBeNull();
  expect(r.pages[1]?.start?.ids).toEqual(["big"]);
  // Order kept: the small one did not overtake the big one.
  const small = r.pages.findIndex((p) => p.start?.ids.includes("small") === true);
  expect(small).toBeGreaterThanOrEqual(1);
  for (const p of r.pages) expect(p.height).toBeLessThanOrEqual(r.block + 1);
});

test("float-defer holds a float back, and floats left at the end get pages of their own", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .top { float: top; float-reference: page } #d { float-defer: 1 }</style>${TEXT(2)}<figure id="d" class="top">D</figure>${TEXT(2, 2)}`,
  );
  expect(r.total).toBe(2);
  expect(r.pages[0]?.start).toBeNull();
  expect(r.pages[1]?.start?.ids).toEqual(["d"]);
});

test("snap-block goes to the nearer edge", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .snap { float: snap-block; float-reference: page } figure { block-size: 40px }</style>
     <figure id="a" class="snap">A</figure>${TEXT(9)}<figure id="b" class="snap">B</figure>${TEXT(1, 9)}`,
  );
  expect(r.total).toBe(1);
  expect(r.pages[0]?.start?.ids).toEqual(["a"]);
  expect(r.pages[0]?.end?.ids).toEqual(["b"]);
});

test("without a page reference, float: top is left to the browser, which ignores it", async ({ page }) => {
  const r = await run(page, `<style>${PAGE} .top { float: top }</style>${TEXT(2)}<figure id="f" class="top">F</figure>${TEXT(2, 2)}`);
  expect(r.pages[0]?.start).toBeNull();
  expect(r.pages[0]?.inFlow).toEqual(["f"]);
});

test("floats and notes share a page without overflowing it", async ({ page }) => {
  const note = `<span class="fn">${"note ".repeat(60)}</span>`;
  const r = await run(
    page,
    `<style>${PAGE} .top { float: top; float-reference: page } .fn { float: footnote }</style>
     ${TEXT(3)}<figure id="f" class="top">F</figure><p>Called${note} here.</p>${TEXT(20, 3)}`,
  );
  expect(r.overflowed).toEqual([]);
  for (const p of r.pages) expect(p.height).toBeLessThanOrEqual(r.block + 1);
  expect(r.pages[0]?.start?.ids).toEqual(["f"]);
});
