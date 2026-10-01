/**
 * Bleed, printer's marks and `@media print` (`doc/milestones.md` M2.1, M2.2).
 *
 * The three M2 debts that are about the *sheet* rather than the flow. They
 * share a spec because they share a claim: none of them may move a break.
 * Bleed and marks are properties of the paper a page is printed on, not of
 * the page (css-page-3 §11), and print CSS is the CSS the document was
 * always meant to be laid out with — so switching them on must change what
 * is around the page and inside it, and never where it ends.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const CORPUS = "http://127.0.0.1:5177/corpus/specs";

type Sheet = {
  sheet: [number, number];
  pageBox: [number, number];
  marks: number;
};

type Run = {
  pages: number;
  bleed: { blockStart: number; blockEnd: number; inlineStart: number; inlineEnd: number };
  marks: { crop: boolean; cross: boolean };
  trim: [number, number];
  sheets: Sheet[];
  /** The colour `@media print` asks for, read off the composed page. */
  sectionColour: string | null;
  cssMentions: { print: boolean; screen: boolean; rangeQuery: boolean };
};

declare global {
  interface Window {
    folio: typeof Folio;
    runSheet: () => Promise<Run>;
  }
}

async function run(page: Page, spec: string): Promise<Run> {
  await page.goto(`${CORPUS}/${spec}`);
  // These fixtures load Paged.js; we are the engine under test.
  await page.route("**/paged.polyfill.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "" }),
  );
  await injectEngine(page);
  return page.evaluate(async () => {
    const t = window.folio;
    const src = document.body;
    const doc = await t.normalize(document);
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;
    const style = target.createElement("style");
    style.textContent = `body{margin:0}\n${doc.authorCss}`;
    target.head.append(style);
    await target.fonts.ready;

    const result = t.paginate({ source: src, pageRules: doc.pageRules, target, maxPages: 20 });
    const first = result.records[0]?.spec as Folio.PageSpec;
    // Unrounded: A4 is 793.7px wide, so rounding the sheet and the page box
    // separately and subtracting can be a pixel out when neither is.
    const size = (el: Element): [number, number] => {
      const r = el.getBoundingClientRect();
      return [r.width, r.height];
    };
    const section = result.pages[0]?.querySelector("section");

    return {
      pages: result.records.length,
      bleed: first.bleed,
      marks: first.marks,
      trim: [first.size[0], first.size[1]] as [number, number],
      sheets: result.sheets.map((s) => ({
        sheet: size(s),
        pageBox: size(s.querySelector(".folio-pagebox") ?? s),
        marks: s.querySelectorAll(".folio-mark").length,
      })),
      sectionColour:
        section === null || section === undefined
          ? null
          : (target.defaultView as Window).getComputedStyle(section).color,
      cssMentions: {
        print: /@media\s+print/.test(doc.authorCss),
        screen: /@media\s+screen/.test(doc.authorCss),
        rangeQuery: /min-width <= 600px/.test(doc.authorCss),
      },
    };
  });
}

/** What the sheet adds to the page box, in each axis. */
const grown = (s: Sheet): [number, number] => [
  s.sheet[0] - s.pageBox[0],
  s.sheet[1] - s.pageBox[1],
];

test("bleed grows the sheet and leaves the page box alone", async ({ page }) => {
  const r = await run(page, "bleed/bleed.html");

  // 10mm a side on A4.
  expect(r.bleed.blockStart).toBeCloseTo(37.8, 1);
  for (const s of r.sheets) {
    expect(s.pageBox[0]).toBeCloseTo(r.trim[0], 1);
    expect(s.pageBox[1]).toBeCloseTo(r.trim[1], 1);
    expect(grown(s)[0]).toBeCloseTo(r.bleed.inlineStart + r.bleed.inlineEnd, 1);
    expect(grown(s)[1]).toBeCloseTo(r.bleed.blockStart + r.bleed.blockEnd, 1);
    expect(s.marks).toBe(0);
  }
});

test("bleed can differ per side, and follows :left and :right", async ({ page }) => {
  const r = await run(page, "custom-bleeds/custom-bleeds.html");

  // `@page :right { bleed: 0.125in 0.125in 0.125in 0in }` — nothing at the
  // spine, an eighth of an inch everywhere else.
  expect(r.bleed.inlineStart).toBe(0);
  expect(r.bleed.inlineEnd).toBe(12);
  expect(r.bleed.blockStart).toBe(12);
  expect(grown(r.sheets[0] as Sheet)).toEqual([12, 24]);
});

test("crop and cross marks are drawn outside the bleed", async ({ page }) => {
  const r = await run(page, "marks/marks.html");

  expect(r.marks).toEqual({ crop: true, cross: true });
  // `bleed` is absent, so it is `auto`, which is 6pt once crop marks are
  // asked for — the marks have to be drawn around something.
  expect(r.bleed.blockStart).toBe(8);
  for (const s of r.sheets) {
    expect(s.pageBox[0]).toBeCloseTo(r.trim[0], 1);
    // 8px of bleed plus 18px of mark, each side.
    expect(grown(s)).toEqual([52, 52]);
    // Eight crop marks, two at each corner; eight cross arms, two per edge.
    expect(s.marks).toBe(16);
  }
});

test("a page with no bleed and no marks is still one element", async ({ page }) => {
  const r = await run(page, "counters/nested/nested.html");

  expect(r.bleed).toEqual({ blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 });
  for (const s of r.sheets) {
    expect(s.sheet).toEqual(s.pageBox);
    expect(s.marks).toBe(0);
  }
});

test("@media print applies and @media screen does not", async ({ page }) => {
  const r = await run(page, "media/print/print.html");

  // The fixture paints `section` red and then green inside `@media print`.
  // Built in an iframe, which is a screen, the browser would leave it red.
  expect(r.sectionColour).toBe("rgb(0, 128, 0)");
  // Both blocks are resolved away before the CSS reaches the frame, and the
  // feature query the fixture calls `dont-choke-on-this` survives.
  expect(r.cssMentions.print).toBe(false);
  expect(r.cssMentions.screen).toBe(false);
  expect(r.cssMentions.rangeQuery).toBe(true);
});
