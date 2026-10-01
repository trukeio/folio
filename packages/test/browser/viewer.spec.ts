/**
 * The viewer (`doc/milestones.md` M5.2).
 *
 * "Spreads, zoom, page navigation, a virtualized page list", and an exit check
 * that is a 300-page book. The claim that matters is the last one, and it is
 * the same shape as M1's: **what the viewer costs does not grow with the
 * book.** A viewer that puts three hundred pages in the document makes the
 * browser lay out three hundred pages on every scroll, and no amount of zoom
 * or navigation is worth that.
 *
 * So the number asserted is the count of *mounted* pages, which is bounded by
 * the window rather than by the document — deterministic, and the same on
 * every machine, where a frame rate is neither.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import type * as FolioViewer from "@truke/folio-viewer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { injectEngine } from "./inject.js";

const BOOK = "http://127.0.0.1:5177/book.html";

type Run = {
  total: number;
  mounted: number;
  current: number;
  /** Page elements actually in the host document. */
  inDocument: number;
  /** The first holder's size, from the engine's own inline style. */
  holder: [number, number];
};

declare global {
  interface Window {
    folio: typeof Folio;
    view: ReturnType<typeof FolioViewer.renderViewer>;
    show: (chapters: number, options?: Record<string, unknown>) => Promise<number>;
  }
}

test.describe.configure({ timeout: 300_000 });

async function open(page: Page, chapters: number, options = {}): Promise<number> {
  await page.goto(`${BOOK}?chapters=${chapters}`);
  await injectEngine(page);
  return page.evaluate(
    async ([chapters, options]) => {
      const t = window.folio;
      const viewer = (window as unknown as { folioViewer: typeof FolioViewer })
        .folioViewer;
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
        maxPages: 600,
      });

      // The source is left where it is; the viewer only reads the pages.
      src.remove();
      window.view = viewer.renderViewer({
        host: document.body,
        sheets: result.sheets,
        records: result.records,
        ...options,
      });
      void chapters;
      return result.records.length;
    },
    [chapters, options] as const,
  );
}

const read = async (page: Page): Promise<Run> => {
  // Two frames: the observer reports on the next one, and the mounts it asks
  // for land on the one after.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return page.evaluate(() => ({
    total: window.view.total,
    mounted: window.view.mounted,
    current: window.view.current,
    inDocument: document.querySelectorAll(".folio-viewer-page > *").length,
    holder: (() => {
      const h = document.querySelector(".folio-viewer-page") as HTMLElement;
      return [Number.parseFloat(h.style.width), Number.parseFloat(h.style.height)] as [
        number,
        number,
      ];
    })(),
  }));
};

test("a placeholder stands at the page's size before anything is rendered", async ({ page }) => {
  await open(page, 4);
  const r = await read(page);

  // 400x600 from the fixture's `@page`, with no bleed. The list has its full
  // height from the start, so the scrollbar does not move under the reader.
  expect(r.holder).toEqual([400, 600]);
  expect(r.total).toBeGreaterThan(4);
});

test("only the pages near the viewport are mounted", async ({ page }) => {
  const total = await open(page, 150);
  const r = await read(page);

  expect(total).toBeGreaterThan(250);
  expect(r.total).toBe(total);
  // The whole point: a 278-page book does not put 278 pages in the document.
  expect(r.mounted).toBeLessThan(20);
  expect(r.mounted).toBe(r.inDocument);
  expect(r.mounted).toBeGreaterThan(0);
});

test("what the viewer costs does not grow with the book", async ({ page }) => {
  await open(page, 40);
  const short = await read(page);
  await open(page, 150);
  const long = await read(page);

  // Four times the book, the same window: the same handful of pages rendered.
  expect(long.total).toBeGreaterThan(short.total * 3);
  expect(long.mounted).toBeLessThanOrEqual(short.mounted + 2);
});

test("navigation moves, mounts what it moves to, and reports where it is", async ({ page }) => {
  await open(page, 150);

  const at = await page.evaluate(async () => {
    window.view.goTo(120);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const holder = document.querySelector('.folio-viewer-page[data-page="120"]') as HTMLElement;
    return {
      current: window.view.current,
      // Mounted by `goTo` itself, not by waiting for the observer: an empty
      // placeholder scrolled to is a blank page until the observer notices.
      mountedTarget: holder.firstChild !== null,
      mounted: window.view.mounted,
    };
  });

  expect(at.current).toBe(120);
  expect(at.mountedTarget).toBe(true);
  expect(at.mounted).toBeLessThan(20);

  const after = await page.evaluate(() => {
    window.view.next();
    const forward = window.view.current;
    window.view.previous();
    return { forward, back: window.view.current };
  });
  expect(after.forward).toBe(121);
  expect(after.back).toBe(120);
});

test("spreads put a verso and its recto on one row", async ({ page }) => {
  await open(page, 6, { spreads: true });

  const columns = await page.evaluate(() => {
    const holders = [...document.querySelectorAll(".folio-viewer-page")] as HTMLElement[];
    const view = window as unknown as Window;
    return holders.slice(0, 4).map((h) => ({
      side: h.dataset["side"],
      column: view.getComputedStyle(h).gridColumnStart,
    }));
  });

  // Page 1 is a recto and sits in the right-hand column, alone on its row;
  // page 2 is a verso and opens the next spread on the left.
  expect(columns[0]).toEqual({ side: "right", column: "2" });
  expect(columns[1]).toEqual({ side: "left", column: "1" });
  expect(columns[2]).toEqual({ side: "right", column: "2" });
});

test("zoom scales what is shown without re-laying-out the book", async ({ page }) => {
  await open(page, 4);

  const zoomed = await page.evaluate(() => {
    const list = document.querySelector(".folio-viewer") as HTMLElement;
    const before = list.style.getPropertyValue("--folio-zoom");
    window.view.setZoom(0.5);
    return { before, after: list.style.getPropertyValue("--folio-zoom") };
  });

  expect(zoomed.before).toBe("1");
  expect(zoomed.after).toBe("0.5");
});

test("printing prints every page, one to a sheet, each number once", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "page.pdf is Chromium's alone");
  // Zoomed, in spreads, under an application's toolbar, in a document whose
  // own `@page` draws `counter(page)` in `@bottom-center`: everything that
  // made a printed viewer wrong. Before the fix this printed the three mounted
  // pages, blank placeholders for the rest, the toolbar above page 1, and a
  // second page number from the browser's own margin box on every sheet.
  const total = await open(page, 12, { zoom: 0.5, spreads: true });
  await page.evaluate(() => {
    const bar = document.createElement("nav");
    bar.textContent = "toolbar";
    bar.style.cssText = "position:sticky;top:0;padding:20px";
    document.body.prepend(bar);
  });
  const before = await page.evaluate(() => window.view.mounted);
  expect(before).toBeLessThan(total);

  const pdf = await getDocument({
    data: new Uint8Array(await page.pdf({ preferCSSPageSize: true, printBackground: true })),
  }).promise;
  expect(pdf.numPages).toBe(total);

  for (let n = 1; n <= total; n++) {
    const sheet = await pdf.getPage(n);
    const { width, height } = sheet.getViewport({ scale: 1 });
    // The book's pages are 400px by 600px: 300pt by 450pt, unzoomed.
    expect([Math.round(width), Math.round(height)], `page ${n} size`).toEqual([300, 450]);
    const { items } = await sheet.getTextContent();
    const words = items.flatMap((i) => ("str" in i ? [i.str.trim()] : []));
    expect(words.filter((w) => w === String(n)), `page ${n} number`).toHaveLength(1);
    expect(words, `page ${n}`).not.toContain("toolbar");
  }

  // And the list is virtual again afterwards.
  expect(await page.evaluate(() => window.view.mounted)).toBeLessThanOrEqual(before + 2);
});

test("in print media the viewer is the whole document, on every engine", async ({ page }) => {
  // WebKit's half of the test above, which Playwright cannot print: the
  // events are dispatched by hand and print media emulated, and what the
  // viewer's stylesheet did is read back. It cannot say how an engine splits
  // the result into sheets; `print.spec.ts` says what it can and cannot.
  const total = await open(page, 12, { zoom: 0.5, spreads: true });
  await page.evaluate(() => {
    const bar = document.createElement("nav");
    bar.id = "bar";
    bar.textContent = "toolbar";
    document.body.prepend(bar);
    window.dispatchEvent(new Event("beforeprint"));
  });
  await page.emulateMedia({ media: "print" });

  const seen = await page.evaluate(() => {
    const holders = [...document.querySelectorAll<HTMLElement>(".folio-viewer-page")];
    const list = document.querySelector(".folio-viewer") as HTMLElement;
    const style = (el: Element): CSSStyleDeclaration => getComputedStyle(el);
    return {
      mounted: window.view.mounted,
      bar: style(document.getElementById("bar") as HTMLElement).display,
      list: style(list).display,
      zoom: holders.map((h) => style(h).zoom),
      shadow: style(holders[0] as HTMLElement).boxShadow,
      breaks: [style(holders[0] as HTMLElement).breakAfter, style(holders.at(-1) as HTMLElement).breakAfter],
    };
  });
  expect(seen.mounted).toBe(total);
  expect(seen.bar).toBe("none");
  // Spreads undone, and zoom back to actual size.
  expect(seen.list).toBe("block");
  expect(new Set(seen.zoom)).toEqual(new Set(["1"]));
  expect(seen.shadow).toBe("none");
  expect(seen.breaks).toEqual(["page", "auto"]);

  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  expect(await page.evaluate(() => window.view.mounted)).toBeLessThan(total);
});
