/**
 * M3.2: splitting a table across pages.
 *
 * §4 says repeated `thead`/`tfoot` is "cheap once composition works from
 * positions", and this is the test of that claim: a split table is already a
 * table, because composition kept the ancestors of the break, so only the
 * header and footer have to be put back — from the source, not carried from
 * the page before.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/table-split.html";

declare global {
  interface Window {
    folio: typeof Folio;
    runTable: () => Promise<{
      count: number;
      headsPerPage: number[];
      footsPerPage: number[];
      headTextPerPage: string[];
      bodyRowsPerPage: number[];
      firstDataCellPerPage: string[];
      sourceRows: number;
      cellText: string;
      sourceCellText: string;
      heights: number[];
      limit: number;
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runTable = async () => {
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

      const bodyCells = (root: ParentNode) =>
        [...root.querySelectorAll("tbody td")].map((c) => c.textContent).join("|");

      return {
        count: records.length,
        headsPerPage: pages.map((p) => p.querySelectorAll("thead").length),
        footsPerPage: pages.map((p) => p.querySelectorAll("tfoot").length),
        headTextPerPage: pages.map(
          (p) => p.querySelector("thead")?.textContent.replace(/\s+/g, "") ?? "",
        ),
        bodyRowsPerPage: pages.map((p) => p.querySelectorAll("tbody tr").length),
        firstDataCellPerPage: pages.map(
          (p) => p.querySelector("tbody td")?.textContent ?? "",
        ),
        sourceRows: src.querySelectorAll("tbody tr").length,
        cellText: pages.map((p) => bodyCells(p)).join("|"),
        sourceCellText: bodyCells(src),
        heights: pages.map((p) => p.scrollHeight),
        limit: t.contentArea(records[0]?.spec as Folio.PageSpec).block,
      };
    };
  });
});

test("the table splits and every row appears once", async ({ page }) => {
  const r = await page.evaluate(() => window.runTable());

  expect(r.count).toBeGreaterThan(1);
  expect(r.bodyRowsPerPage.reduce((a, b) => a + b, 0)).toBe(r.sourceRows);
  // In order, and each row's cells intact.
  expect(r.cellText).toBe(r.sourceCellText);
});

test("every fragment carries the header", async ({ page }) => {
  const r = await page.evaluate(() => window.runTable());

  const withRows = r.bodyRowsPerPage.map((n, i) => ({ n, i })).filter((x) => x.n > 0);
  expect(withRows.length).toBeGreaterThan(1);

  for (const { i } of withRows) {
    expect(r.headsPerPage[i], `page ${i + 1} has a header`).toBe(1);
    expect(r.headTextPerPage[i]).toBe("ElementSymbol");
  }
  // A continuation starts with data, not by repeating the first row.
  expect(r.firstDataCellPerPage[0]).toBe("Hydrogen");
  expect(r.firstDataCellPerPage[1]).not.toBe("Hydrogen");
});

test("the footer appears where the table continues, and the pages still fit", async ({ page }) => {
  const r = await page.evaluate(() => window.runTable());

  // tfoot repeats on fragments that continue; the last fragment has the real
  // one. Either way, exactly one per fragment that holds rows.
  const withRows = r.bodyRowsPerPage.map((n, i) => ({ n, i })).filter((x) => x.n > 0);
  for (const { i } of withRows) {
    expect(r.footsPerPage[i], `page ${i + 1} footer count`).toBe(1);
  }
  for (const h of r.heights) expect(h).toBeLessThanOrEqual(r.limit + 1);
});
