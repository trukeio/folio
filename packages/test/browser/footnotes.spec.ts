/**
 * M3.1: footnotes.
 *
 * The clearest case of why a paged engine cannot be a stylesheet: the note
 * area's height depends on where the page breaks, and where the page breaks
 * depends on the note area's height. Nothing in CSS closes that loop.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/footnotes.html";

declare global {
  interface Window {
    folio: typeof Folio;
    runNotes: () => Promise<{
      count: number;
      callsPerPage: number[][];
      notesPerPage: number[][];
      areaAtBottom: boolean[];
      flowText: string;
      sourceText: string;
      contentHeights: number[];
      areaHeights: number[];
      limit: number;
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runNotes = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const { records, pages } = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
      });

      const numbers = (page: HTMLElement, selector: string) =>
        [...page.querySelectorAll(selector)].map((el) =>
          Number((el as HTMLElement).dataset["footnote"]),
        );

      return {
        count: records.length,
        callsPerPage: pages.map((p) => numbers(p, `.${t.CALL_CLASS}`)),
        notesPerPage: pages.map((p) => numbers(p, `.${t.NOTE_CLASS}`)),
        areaAtBottom: pages.map((p) => p.lastElementChild?.className === t.AREA_CLASS),
        flowText: pages
          .map((p) => {
            const clone = p.cloneNode(true) as HTMLElement;
            clone.querySelector(`.${t.AREA_CLASS}`)?.remove();
            for (const call of clone.querySelectorAll(`.${t.CALL_CLASS}`)) call.remove();
            return clone.textContent;
          })
          .join(""),
        sourceText: src.textContent,
        contentHeights: pages.map((p) => p.scrollHeight),
        areaHeights: pages.map((p) => {
          const area = p.querySelector(`.${t.AREA_CLASS}`);
          return area === null ? 0 : Math.round(area.getBoundingClientRect().height);
        }),
        limit: t.contentArea(records[0]?.spec as Folio.PageSpec).block,
      };
    };
  });
});

test("a note sits at the foot of the page its call is on", async ({ page }) => {
  const r = await page.evaluate(() => window.runNotes());

  expect(r.count).toBeGreaterThan(1);
  for (let i = 0; i < r.count; i++) {
    // Not "the notes are somewhere": the notes on a page are exactly the
    // notes called on that page.
    expect(r.notesPerPage[i], `page ${i + 1}`).toEqual(r.callsPerPage[i]);
  }
  // Every note is placed, once.
  expect(r.notesPerPage.flat().sort((a, b) => a - b)).toEqual([1, 2, 3]);
});

test("the note area is at the foot, and the page still fits", async ({ page }) => {
  const r = await page.evaluate(() => window.runNotes());

  for (let i = 0; i < r.count; i++) {
    if (r.areaHeights[i] === 0) continue;
    expect(r.areaAtBottom[i], `page ${i + 1} note area is last`).toBe(true);
    // The area took its space from the text, not from beyond the page.
    expect(r.contentHeights[i]).toBeLessThanOrEqual(r.limit + 1);
  }
});

test("the text loses the note but keeps everything else", async ({ page }) => {
  const r = await page.evaluate(() => window.runNotes());

  const strip = (s: string) => s.replace(/\s+/g, "");
  // Flow text, notes and calls removed, plus the note bodies, is the source.
  const notes = r.notesPerPage.flat().length;
  expect(notes).toBe(3);
  expect(strip(r.flowText).length).toBeLessThan(strip(r.sourceText).length);
  expect(strip(r.sourceText)).toContain(strip(r.flowText).slice(0, 40));
});
