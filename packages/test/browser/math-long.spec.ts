/**
 * The M4 exit check (`doc/milestones.md` §M4).
 *
 * A math-heavy book, not a test case: sixty sections, every sixth equation too
 * wide for the measure, numbers and references throughout. The four claims
 * here are the ones the milestone ends on — it paginates with no overflow, the
 * numbers are consecutive, the layout is identical between runs, and a broken
 * equation is not split against the widow penalty.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/math-long.html";

/** Sections in the fixture, one numbered equation each. */
const SECTIONS = 50;

// Fifty sections paginate into forty-odd pages, and pagination is O(n²) until
// §3's "estimate a chunk and binary-search it" lands (`plan.md` §11). The
// timeout is for the size of the document, not for flakiness: this fixture is
// the one place the engine is asked to do a book's worth of work, and it does
// it while two other workers are using the same processor. Three minutes was
// enough for the file on its own and not enough inside the whole suite.
test.describe.configure({ timeout: 600_000 });

type Run = {
  pages: number;
  overflowed: number[];
  numbers: number[];
  /** Every page as `(index, start, end)`, for the stability check. */
  snapshot: string;
  /** For each broken equation: how many pages its rows are spread over. */
  brokenSpread: number[];
  /** Rows per broken equation. */
  brokenRows: number[];
  /** What the first reference resolved to, and the number of its target. */
  firstRef: [string | null, string | null];
};

declare global {
  interface Window {
    folio: typeof Folio;
    runBook: () => Promise<Run>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runBook = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      // Naming the family here is also asking to be told: `normalize` proves
      // the MATH table is in use and throws if it is not (M4.1).
      const doc = await t.normalize(document, { mathFont: "STIX Two Math" });
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await t.loadMathFont("STIX Two Math", target);
      await target.fonts.ready;

      const result = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
        references: doc.references,
      });

      const numbers: number[] = [];
      const rowsOf = new Map<string, number>();
      const pagesOf = new Map<string, Set<number>>();
      result.pages.forEach((page, index) => {
        for (const eq of page.querySelectorAll(`.${t.EQ_CLASS}`)) {
          const value = eq.getAttribute(t.counterAttribute(t.EQ_COUNTER));
          if (value !== null) numbers.push(Number(value));
        }
        for (const math of page.querySelectorAll(`math[${t.MATH_ROWS}]`)) {
          const id = math.id;
          rowsOf.set(id, Number(math.getAttribute(t.MATH_ROWS)));
          // A row of a broken equation is an <mtr>; which pages hold one is
          // how a split equation announces itself.
          if (math.querySelector("mtr") === null) continue;
          const seen = pagesOf.get(id) ?? new Set<number>();
          seen.add(index);
          pagesOf.set(id, seen);
        }
      });

      const ref = result.pages
        .flatMap((p) => [...p.querySelectorAll("a.eqref")])
        .find((a) => a.getAttribute("data-x-ref-0") !== null);
      const targetId = ref?.getAttribute("href")?.slice(1) ?? "";
      const targetNumber = result.counters.get(targetId)?.get("equation");

      return {
        pages: result.records.length,
        overflowed: result.overflowed,
        numbers,
        snapshot: JSON.stringify(
          result.records.map((r) => [
            r.spec.index,
            `${r.start.path.join(".")}+${r.start.offset}`,
            `${r.end.path.join(".")}+${r.end.offset}`,
          ]),
        ),
        brokenSpread: [...pagesOf.values()].map((s) => s.size),
        brokenRows: [...rowsOf.values()],
        firstRef: [
          ref?.getAttribute("data-x-ref-0") ?? null,
          targetNumber === undefined ? null : String(targetNumber),
        ],
      };
    };
  });
});

test("the book paginates, numbers and refers to its equations", async ({ page }) => {
  // Four assertions in one test, because each run is a book's worth of
  // pagination: splitting them would cost four of those to learn what one
  // tells us.
  const r = await page.evaluate(() => window.runBook());

  expect(r.pages).toBeGreaterThanOrEqual(40);
  expect(r.overflowed).toEqual([]);

  // Consecutive from 1, no gaps, no repeats — one per numbered equation.
  expect(r.numbers.length).toBe(SECTIONS);
  expect(r.numbers).toEqual(r.numbers.map((_, i) => i + 1));

  // And a reference resolves to the number its target was given.
  expect(r.firstRef[0]).not.toBeNull();
  expect(r.firstRef[0]).toBe(r.firstRef[1]);

  // A broken equation's rows are boxes the vertical fragmenter could split.
  // `break-inside: avoid` on the wrapper is what makes it pay to move the
  // whole equation instead — a penalty, not a rule (`math.md` §6), which is
  // the exit check's "a 3-line equation is never split 1 + 2".
  expect(r.brokenRows.length).toBeGreaterThan(0);
  expect(Math.max(...r.brokenRows)).toBeGreaterThanOrEqual(2);
  expect(r.brokenSpread.every((pages) => pages === 1)).toBe(true);
});

test("identical input gives identical positions", async ({ page }) => {
  // §9's determinism invariant, on the document most likely to break it:
  // every page runs the math pass, and a pass that depended on what the last
  // one did would show up here as a moved break.
  const first = await page.evaluate(() => window.runBook());
  const second = await page.evaluate(() => window.runBook());

  expect(second.snapshot).toBe(first.snapshot);
  expect(second.pages).toBe(first.pages);
});
