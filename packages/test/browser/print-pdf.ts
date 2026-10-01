/**
 * What the print tests share: the fixtures, loading one under the polyfill,
 * where the screen put each page number, and reading a PDF back with pdf.js.
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const POLYFILL = new URL("../.bundle/folio.polyfill.js", import.meta.url).pathname;
export const FIXTURE = "http://127.0.0.1:5177/print-probe.html";

/** A5, a page number at the foot, two chapters on two pages. */
export const A5 = `<!doctype html>
<meta charset="utf-8">
<script src="/folio.polyfill.js"></script>
<style>
  @page {
    size: 148mm 210mm;
    margin: 18mm 16mm 20mm;
    @bottom-center { content: counter(page); font: 9pt/1 serif }
  }
  body { margin: 0; font: 11pt/1.5 serif }
  section + section { break-before: page }
</style>
<section><h1>One</h1><p>The first chapter.</p></section>
<section><h1>Two</h1><p>The second chapter.</p></section>`;

/**
 * The same, with what a plain `@page` override cannot beat by specificity:
 * an `@page :first` with a margin box of its own, a named page of another
 * size, and the author's `page:` property, which the host also applies.
 */
export const MIXED = A5.replace(
  "body {",
  `@page :first { @bottom-center { content: "first " counter(page); font: 9pt/1 serif } }
  @page wide { size: 210mm 148mm; @bottom-center { content: counter(page); font: 9pt/1 serif } }
  section + section { page: wide }
  body {`,
).replace("section + section { break-before: page }", "");

export type Drawn = { text: string; x: number; y: number };

/** Every run of text on every page of a PDF, in points from the top left. */
export async function textOf(pdf: Buffer): Promise<Drawn[][]> {
  const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const pages: Drawn[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const height = page.getViewport({ scale: 1 }).height;
    const { items } = await page.getTextContent();
    pages.push(
      items.flatMap((item) =>
        "str" in item && item.str.trim() !== ""
          ? [{ text: item.str.trim(), x: item.transform[4] as number, y: height - item.transform[5] }]
          : [],
      ),
    );
  }
  return pages;
}

export async function load(page: Page, html: string): Promise<void> {
  await page.route("**/folio.polyfill.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: readFileSync(POLYFILL, "utf8") }),
  );
  await page.route(FIXTURE, (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(FIXTURE);
  await page.waitForFunction(() => document.querySelectorAll(".pagedjs_page").length > 0);
}

/** Where each page number is on screen, relative to its sheet, in points. */
export async function numbersOnScreen(page: Page): Promise<Drawn[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page")].map((sheet) => {
      const origin = sheet.getBoundingClientRect();
      const box = sheet.querySelector(".pagedjs_margin-bottom-center") as HTMLElement;
      // The text, not the box's contents: those include the inner block,
      // which is as wide as the box whatever the text's alignment in it.
      const range = document.createRange();
      const first = document.createTreeWalker(box, NodeFilter.SHOW_TEXT).nextNode();
      range.selectNodeContents(first ?? box);
      const r = range.getBoundingClientRect();
      const pt = (px: number): number => px * 0.75;
      const text = box.textContent.trim();
      return { text, x: pt(r.left - origin.left), y: pt(r.top - origin.top) };
    }),
  );
}

/** One number per printed page, where the screen had it: not scaled, not doubled. */
export function expectNumbersOnce(printed: Drawn[][], expected: Drawn[]): void {
  expect(printed.length).toBe(expected.length);
  printed.forEach((items, i) => {
    const want = expected[i] as Drawn;
    const numbers = items.filter((d) => d.text === want.text);
    expect(numbers, `page ${i + 1}`).toHaveLength(1);
    expect(Math.abs((numbers[0] as Drawn).x - want.x), `page ${i + 1} x`).toBeLessThan(2);
    expect(Math.abs((numbers[0] as Drawn).y - want.y), `page ${i + 1} y`).toBeLessThan(12);
  });
}

/** Each sheet's size on screen, in points. */
export async function sheetSizes(page: Page): Promise<[number, number][]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page")].map((sheet): [number, number] => {
      const r = sheet.getBoundingClientRect();
      return [r.width * 0.75, r.height * 0.75];
    }),
  );
}

/** Each PDF page's size, in points. */
export async function pdfSizes(pdf: Buffer): Promise<[number, number][]> {
  const doc = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const sizes: [number, number][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { width, height } = (await doc.getPage(n)).getViewport({ scale: 1 });
    sizes.push([width, height]);
  }
  return sizes;
}
