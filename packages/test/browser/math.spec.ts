/**
 * M4: math in a paginated document, in a real engine.
 *
 * Layer 1 proves the arithmetic of the inline axis against synthetic boxes
 * (`packages/test/src/math.test.ts`). This is the other half: that the rewrite
 * produces MathML the browser lays out, that a broken equation is a stack of
 * rows the vertical fragmenter can place, that the numbers are consecutive
 * across pages, and that a formula reaches a running head as a formula.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/math.html";

type Run = {
  pages: number;
  overflowed: number[];
  /** Rows each equation was composed into, by id. */
  rows: Record<string, number>;
  /** How each broken equation was composed: cells per row, and the text of
   * each row, so the shape can be asserted without a screenshot. */
  shape: Record<string, { cells: number[]; indented: boolean; text: string[] }>;
  /** The number printed beside each equation, by id, in page order. */
  numbers: [string, string][];
  /** What the reference to the numbered equation resolved to. */
  eqref: string;
  eqrefAttr: string | null;
  /** Tag names inside the running head, to prove the formula travelled. */
  headTags: string[];
  /** The TeX annotation on the equation that was broken. */
  annotation: string | null;
  /** Every numbered equation's id and its number. */
  counters: [string, number][];
};

declare global {
  interface Window {
    folio: typeof Folio;
    runMath: () => Promise<Run>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runMath = async () => {
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
      // A formula measured against a fallback font is wrong by a large
      // margin, and every page after it moves (`math.md` §3).
      await t.loadMathFont("STIX Two Math", target);
      await target.fonts.ready;

      const result = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
        references: doc.references,
      });

      const view = target.defaultView as Window;
      const rows: Record<string, number> = {};
      const shape: Run["shape"] = {};
      const numbers: [string, string][] = [];
      for (const page of result.pages) {
        for (const math of page.querySelectorAll("math[id]")) {
          const count = math.getAttribute(t.MATH_ROWS);
          rows[math.id] = count === null ? 1 : Number(count);
          const mtr = [...math.querySelectorAll("mtr")];
          if (mtr.length === 0) continue;
          shape[math.id] = {
            cells: mtr.map((row) => row.querySelectorAll("mtd").length),
            indented: mtr.slice(1).every((row) => row.querySelector("mtd > mspace") !== null),
            text: mtr.map((row) => row.textContent.replace(/\s+/g, "")),
          };
        }
        for (const eq of page.querySelectorAll(`.${t.EQ_CLASS}`)) {
          const math = eq.querySelector("math");
          numbers.push([
            math?.id ?? "",
            eq.getAttribute(t.counterAttribute(t.EQ_COUNTER)) ?? "",
          ]);
        }
      }

      const eqref = result.pages[0]?.querySelector("a.eqref") as Element;
      const head = result.sheets
        .map((sheet) => sheet.querySelector(".folio-margin-top-center"))
        .find((box) => box !== null && box.querySelector("math") !== null);

      return {
        pages: result.records.length,
        overflowed: result.overflowed,
        rows,
        shape,
        numbers,
        eqref: view.getComputedStyle(eqref, "::after").content.replace(/["\s]/g, ""),
        eqrefAttr: eqref.getAttribute("data-x-ref-0"),
        headTags: [...(head?.querySelectorAll("*") ?? [])].map((el) => el.tagName.toLowerCase()),
        annotation:
          result.pages
            .map((p) => p.querySelector("#wide annotation"))
            .find((a) => a !== null)?.textContent ?? null,
        // `counters` holds every counter at every id now; this file is
        // about equations, so it takes that one.
        counters: [...result.counters]
          .map(([id, values]): [string, number | undefined] => [id, values.get("equation")])
          .filter((entry): entry is [string, number] => entry[1] !== undefined),
      };
    };
  });
});

test("an equation wider than the measure becomes a stack of rows", async ({ page }) => {
  const r = await page.evaluate(() => window.runMath());

  // The wide one breaks; the ones that fit are left exactly as they were,
  // which is the difference between a break decision and a rewrite.
  expect(r.rows["wide"]).toBeGreaterThan(1);
  expect(r.rows["first"]).toBe(1);
  expect(r.rows["euler"]).toBe(1);
});

test("no page overflows, with math on it", async ({ page }) => {
  // §9's invariant, which a broken equation is the new way to violate: the
  // stack of rows is taller than the line it replaced, and a page measured
  // before the rewrite would be measured against a page that never exists.
  const r = await page.evaluate(() => window.runMath());
  expect(r.overflowed).toEqual([]);
  expect(r.pages).toBeGreaterThan(1);
});

test("equation numbers are consecutive from 1, with no gaps or repeats", async ({ page }) => {
  const r = await page.evaluate(() => window.runMath());

  const values = r.numbers.map(([, n]) => Number(n));
  expect(values.length).toBeGreaterThan(2);
  expect(values).toEqual(values.map((_, i) => i + 1));
});

test("a reference resolves to the equation's number", async ({ page }) => {
  const r = await page.evaluate(() => window.runMath());

  const euler = r.numbers.find(([id]) => id === "euler")?.[1];
  expect(euler).toBeDefined();
  expect(r.eqrefAttr).toBe(euler);
  expect(r.eqref).toContain(`(${euler})`);
});

test("a formula reaches a running head as a formula", async ({ page }) => {
  // `textContent` on a formula yields a row of stray letters — `a2+b2=c2` —
  // so `content(element)` clones the subtree instead (`math.md` §6).
  const r = await page.evaluate(() => window.runMath());

  expect(r.headTags).toContain("math");
  expect(r.headTags).toContain("msup");
});

test("breaking an equation keeps its TeX annotation", async ({ page }) => {
  // §7: the visible form and the accessible form are one tree, and the
  // annotation is what lets an author round-trip the formula back out.
  const r = await page.evaluate(() => window.runMath());

  expect(r.annotation).toBe("x+y+z=a+b+c+d+e+f+g+h+i+j+k+m");
});

test("an equation with a relation is set in two columns, aligned on it", async ({ page }) => {
  // Its left-hand side is short on purpose. Past half the measure the rule is
  // one indented column instead (§4), and this equation sat on that line
  // unnoticed while its number rendered as an empty "()": the gutter was
  // nearly zero, the measure 40px wider than a real number leaves it.
  // TeX's `align`: everything up to the relation in the right-aligned left
  // column, the relation and its right-hand side in the left-aligned one
  // (`math.md` §4). A row with no relation of its own sits in the column the
  // alignment point has already been passed to, which is why every row has two
  // cells and the second row's first cell is empty.
  const r = await page.evaluate(() => window.runMath());

  const wide = r.shape["wide"];
  expect(wide).toBeDefined();
  expect(wide?.cells.every((n) => n === 2)).toBe(true);
  expect(wide?.text[0]).toContain("=");
  expect(wide?.indented).toBe(false);
});

test("an equation with no relation is set in one column and indented", async ({ page }) => {
  const r = await page.evaluate(() => window.runMath());

  const fenced = r.shape["fenced"];
  expect(fenced).toBeDefined();
  expect(fenced?.cells.every((n) => n === 1)).toBe(true);
  expect(fenced?.indented).toBe(true);
});

test("a break never falls inside a fenced group", async ({ page }) => {
  // §4: a fenced `<mrow>` is one unit however wide it is. Breaking inside it
  // would leave an opening delimiter with nothing to close it on the line,
  // which is worse than the overflow it avoids. Balanced parentheses per row
  // is the cheapest way to state that.
  const r = await page.evaluate(() => window.runMath());

  const rows = r.shape["fenced"]?.text ?? [];
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect([...row].filter((c) => c === "(").length).toBe(
      [...row].filter((c) => c === ")").length,
    );
  }
});
