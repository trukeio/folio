/**
 * Printing the host document: what "Print to PDF" makes of the pages.
 *
 * Every other browser test looks at the pages on a screen. A reader prints
 * them, and the host document still holds the author's original sheets —
 * `@page` rules included — which Chromium has applied natively since 131. So
 * the paper got the author's page *twice*: once as our page sheet, and once
 * as the browser's own page box around it, with its own margin boxes and its
 * own margins. A `counter(page)` in `@bottom-center` printed two numbers on
 * every sheet, and the sheet was shrunk to about 78% to fit inside the
 * author's margins. `insertPrintCss` in `preview.ts` is the fix.
 *
 * `page.pdf` is Chromium's alone. Firefox is printed the way a reader would,
 * through `window.print()`, silenced by preferences and sent to a file; that
 * path always uses the printer's paper (Letter), whatever `@page` says, so
 * there it checks count, numbers and placement but not sheet size. Either
 * PDF is read with pdf.js, which gives each run of text and where it was
 * drawn.
 */
import { expect, test } from "@playwright/test";
import { A5, FIXTURE, MIXED, expectNumbersOnce, load, numbersOnScreen, pdfSizes, sheetSizes, textOf } from "./print-pdf.js";
import { injectEngine } from "./inject.js";
import type * as Folio from "@truke/folio";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

test.describe("print to PDF", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "page.pdf is Chromium's alone");

  test("each sheet is one page, printed once, at the size it was laid out", async ({ page }) => {
    await load(page, A5);
    const expected = await numbersOnScreen(page);
    expect(expected.map((e) => e.text)).toEqual(["1", "2"]);
    expectNumbersOnce(await textOf(await page.pdf({ preferCSSPageSize: true, printBackground: true })), expected);
  });

  test("an author's @page :first, named sizes and page: do not print through", async ({ page }) => {
    await load(page, MIXED);
    const expected = await sheetSizes(page);
    expect(expected).toHaveLength(2);

    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    // One PDF page per sheet, each the size of its own sheet: A5 portrait,
    // then A5 landscape from the named page.
    const printed = await pdfSizes(pdf);
    expect(printed).toHaveLength(expected.length);
    printed.forEach(([w, h], i) => {
      const [ew, eh] = expected[i] as [number, number];
      expect(Math.abs(w - ew), `page ${i + 1} width`).toBeLessThan(1);
      expect(Math.abs(h - eh), `page ${i + 1} height`).toBeLessThan(1);
    });

    // And each number once: the browser's `:first` and `wide` boxes are gone.
    const text = await textOf(pdf);
    expect(text[0]?.filter((d) => d.text.includes("1")).map((d) => d.text)).toEqual(["first 1"]);
    expect(text[1]?.filter((d) => d.text === "2")).toHaveLength(1);
  });
  // The source stays behind as an empty box with its content parked in a
  // template. Paginated from an element rather than `body`, that box sat in
  // front of the pages, and Chromium gave it a sheet of its own: a blank page
  // before page 1 of `examples/report/`, which only printing could see.
  test("paginated from an element, nothing but the pages prints", async ({ page }) => {
    const html = A5.replace('<script src="/folio.polyfill.js"></script>', "")
      .replace("<section>", '<header>An application toolbar</header><article id="doc"><section>')
      .concat("</article>");
    await page.route(FIXTURE, (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(FIXTURE);
    await injectEngine(page);
    await page.evaluate(() => new window.folio.Previewer().preview("#doc"));
    const expected = await numbersOnScreen(page);
    expect(expected.map((e) => e.text)).toEqual(["1", "2"]);

    const text = await textOf(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    expectNumbersOnce(text, expected);
    expect(text.flat().filter((d) => d.text.includes("toolbar"))).toEqual([]);
  });
});

/**
 * The same stylesheet in print media, on every engine — WebKit included,
 * which Playwright cannot print at all (no `page.pdf`, no print-to-file). So
 * this is not a print: it switches the page to print media and reads back
 * what the stylesheet did. It catches an engine ignoring or misparsing the
 * rules, not how that engine splits the result into sheets. Two features may
 * be missing on an engine — the `page` property and `@page` `size` — and
 * those are recorded as annotations rather than failures, because without
 * them the pages still print, only not at their own paper size.
 */
test.describe("print media, every engine", () => {
  test("the print stylesheet parses and applies", async ({ page }, testInfo) => {
    await load(page, MIXED);
    await page.emulateMedia({ media: "print" });

    const seen = await page.evaluate(() => {
      const sheet = [...document.styleSheets].find(
        (s) => (s.ownerNode as Element | null)?.id === "folio-print-css",
      );
      const media = [...(sheet?.cssRules ?? [])].find((r) => r instanceof CSSMediaRule);
      const pages = [...(media?.cssRules ?? [])].filter((r) => r instanceof CSSPageRule);
      const sheets = [...document.querySelectorAll<HTMLElement>(".pagedjs_page")];
      const style = (el: Element): CSSStyleDeclaration => getComputedStyle(el);
      return {
        pageRules: pages.map((r) => r.selectorText),
        sizes: pages.map((r) => r.style.getPropertyValue("size")),
        pageProperty: CSS.supports("page", "auto"),
        named: sheets.map((s) => style(s).getPropertyValue("page")),
        margins: sheets.map((s) => style(s).margin),
        breaks: sheets.map((s) => style(s).breakAfter),
        body: style(document.body).margin,
      };
    });

    // One plain `@page`, and one per distinct sheet size: A5 portrait and
    // the landscape named page.
    expect(seen.pageRules).toEqual(["", "folio-sheet-0", "folio-sheet-1"]);
    expect(seen.margins).toEqual(["0px", "0px"]);
    expect(seen.body).toBe("0px");
    // A break between sheets, and none after the last.
    expect(seen.breaks).toEqual(["page", "auto"]);

    if (seen.sizes.slice(1).every((s) => s !== "")) {
      expect(seen.sizes.slice(1).every((s) => s.endsWith("px"))).toBe(true);
    } else {
      testInfo.annotations.push({ type: "unsupported", description: "@page size is dropped" });
    }
    // WebKit parses `page` (`CSS.supports` says yes) and reports it as "" in
    // the computed style, so whether it applies cannot be read from here;
    // that is recorded rather than failed, like an engine without it at all.
    if (seen.pageProperty && seen.named.some((n) => n !== "")) {
      expect(seen.named).toEqual(["folio-sheet-0", "folio-sheet-1"]);
    } else {
      const why = seen.pageProperty ? "not in the computed style" : "not supported";
      testInfo.annotations.push({ type: "unsupported", description: `the page property: ${why}` });
    }
  });
});
