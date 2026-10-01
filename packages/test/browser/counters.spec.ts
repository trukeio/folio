/**
 * Custom counters across pages (`doc/milestones.md` M2.3).
 *
 * The rendered numbers are the thing being tested and the one thing that
 * cannot be read back: `getComputedStyle(el, "::before").content` gives
 * `counter(chapter)`, not `3`, and a pseudo-element's text is not in the DOM.
 * So the assertions are on what the engine computed and wrote down — the
 * `counters` map, the attribute a reference resolves through, the margin box's
 * text, and the inline `counter-reset` that makes the browser agree with all
 * three. That last one is the join: if it is right, what is printed is right.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/counters.html";

type Run = {
  pages: number;
  /** id → counter name → value, from the engine. */
  counters: [string, [string, number][]][];
  /** What each page's `@bottom-left` says. */
  bottomLeft: string[];
  /** The ids of the headings that landed on each page, in order. */
  headingsPerPage: string[][];
  /** The `target-counter()` answer written on the cross-reference. */
  refAttr: string | null;
  /** The inline `counter-reset` the engine wrote on continuations. */
  carried: string[];
  /** Whether a repeated table header carries counter declarations. */
  repeatedCounted: boolean;
};

declare global {
  interface Window {
    folio: typeof Folio;
    runCounters: () => Promise<Run>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runCounters = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const result = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
        references: doc.references,
        maxPages: 40,
      });

      const ref = result.pages
        .flatMap((p) => [...p.querySelectorAll("a.ref")])
        .find((a) => a.hasAttribute("data-x-ref-0"));

      return {
        pages: result.records.length,
        counters: [...result.counters].map(
          ([id, values]): [string, [string, number][]] => [id, [...values]],
        ),
        bottomLeft: result.sheets.map(
          (sheet) =>
            sheet.querySelector(".folio-margin-bottom-left")?.textContent ?? "",
        ),
        headingsPerPage: result.pages.map((p) =>
          [...p.querySelectorAll("h2")].map((h) => h.id),
        ),
        refAttr: ref?.getAttribute("data-x-ref-0") ?? null,
        carried: result.pages
          .flatMap((p) => [...p.querySelectorAll("[data-folio-split-from]")])
          .map((el) => (el as HTMLElement).style.counterReset)
          .filter((v) => v !== ""),
        repeatedCounted: result.pages
          .flatMap((p) => [...p.querySelectorAll("[data-folio-repeated]")])
          .some((el) => {
            const view = target.defaultView as Window;
            const s = view.getComputedStyle(el);
            return s.counterIncrement !== "none" || s.counterSet !== "none";
          }),
      };
    };
  });
});

const counterAt = (r: Run, id: string, name: string): number | undefined =>
  new Map(new Map(r.counters).get(id) ?? []).get(name);

test("a chapter counter keeps counting across the pages", async ({ page }) => {
  const r = await page.evaluate(() => window.runCounters());

  expect(r.pages).toBeGreaterThan(2);
  // Three sections, three chapters, and the third is on a later page than the
  // first — which is the whole point: the browser's own counting carries
  // because every page is in one document, and the engine's walk agrees.
  expect(counterAt(r, "h1", "chapter")).toBe(1);
  expect(counterAt(r, "h2", "chapter")).toBe(2);
  expect(counterAt(r, "h3", "chapter")).toBe(3);
});

test("a counter reset on a section that breaks does not restart", async ({ page }) => {
  const r = await page.evaluate(() => window.runCounters());

  // The long section spans a break, so the engine writes the value its
  // paragraph counter had reached back onto the continuation. Without this
  // the count restarts at zero on every page it covers.
  expect(r.carried.length).toBeGreaterThan(0);
  expect(r.carried.some((v) => /para\s+[1-9]/.test(v))).toBe(true);
});

test("target-counter resolves an author's counter, not only the page", async ({ page }) => {
  const r = await page.evaluate(() => window.runCounters());
  // `a.ref` points at the second chapter's heading.
  expect(r.refAttr).toBe("2");
});

test("counter() in a margin box names the chapter the page ends in", async ({ page }) => {
  const r = await page.evaluate(() => window.runCounters());

  // The rule, not a remembered number: css-page-3 §5.1 gives a margin box the
  // counter as it stands at the end of the page's principal box. So each
  // page's footer is the last heading to have appeared on it or before it —
  // a page that begins in chapter 1 and reaches chapter 2 says "ch 2", and a
  // page with no heading at all repeats the one before.
  let expected = 0;
  r.bottomLeft.forEach((text, i) => {
    for (const id of r.headingsPerPage[i] ?? []) {
      expected = counterAt(r, id, "chapter") ?? expected;
    }
    expect(text).toBe(`ch ${expected}`);
  });

  // And it did move, or the check above would hold for a counter stuck at one.
  expect(r.bottomLeft[r.bottomLeft.length - 1]).toBe("ch 3");
  expect(new Set(r.bottomLeft).size).toBeGreaterThan(1);
});

test("a repeated table header does not count a second time", async ({ page }) => {
  const r = await page.evaluate(() => window.runCounters());
  // The header is the same source row put back on a later fragment. Left to
  // increment, it numbers the rows of a split table one too high from the
  // second page on.
  expect(r.repeatedCounted).toBe(false);
});
