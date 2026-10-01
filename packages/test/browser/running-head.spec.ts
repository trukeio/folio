/**
 * M2.3: named strings and running elements.
 *
 * The running head — `string-set` on a heading, `string()` in a margin box —
 * is the feature that makes a named string worth having, and it is entirely
 * about pages: which value a page shows depends on where the page ended,
 * which no stylesheet can know.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/running-head.html";

declare global {
  interface Window {
    folio: typeof Folio;
    runHeads: () => Promise<{
      count: number;
      topLeft: string[];
      topRight: string[];
      folio: string[];
      folioIsElement: boolean[];
      bodyText: string[];
      assigns: boolean[];
      sourceText: string;
      /** Every page's start, as a comparable key. */
      breaks: string[];
      /** The same, with the running element deleted from the source. */
      breaksWithout: string[];
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runHeads = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const { records, sheets, pages } = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
      });
      // The *content* of a margin box, not the box. A margin box holds an
      // inner `.folio-margin-content` — Paged.js has one and projects style
      // it, so the engine has one too (M5.1) — and that is where the text and
      // any carried element land.
      const box = (sheet: HTMLElement, name: string) =>
        sheet.querySelector(`.folio-margin-${name} .folio-margin-content`);

      /**
       * The same document with the running element deleted, paginated again.
       *
       * A running element is not in the flow, so taking it out must not move
       * a single break. That is the sharpest way to state it — sharper than
       * any measurement of how full a page is, because penalties legitimately
       * leave a page short and a running element never may.
       */
      function withoutRunning(): string[] {
        const clone = src.cloneNode(true) as Element;
        clone.removeAttribute("id");
        // Replaced, not removed: a `Position` is a path of child indices, so
        // deleting a child renumbers its siblings and every break after it
        // reads as different when nothing has moved. An empty `display: none`
        // div holds the index and takes no space.
        const folio = clone.querySelector("#folio");
        if (folio !== null) {
          const gap = document.createElement("div");
          gap.style.display = "none";
          folio.replaceWith(gap);
        }
        // Rendered, because measuring needs layout, and out of the way,
        // because it is a second copy of the document. Moved by a holder,
        // not by a style on the clone: the source root's own box is on
        // every page (`review.md` §3), and what is above it is not.
        const holder = document.createElement("div");
        holder.style.cssText = "position:absolute;left:-99999px;top:0";
        holder.append(clone);
        document.body.append(holder);
        try {
          return t
            .paginate({ source: clone, pageRules: doc.pageRules, target })
            .records.map((rec) => t.positionKey(rec.start));
        } finally {
          holder.remove();
        }
      }

      return {
        count: records.length,
        topLeft: sheets.map((s) => box(s, "top-left")?.textContent ?? ""),
        topRight: sheets.map((s) => box(s, "top-right")?.textContent ?? ""),
        folio: sheets.map((s) => box(s, "bottom-center")?.textContent ?? ""),
        folioIsElement: sheets.map(
          (s) => box(s, "bottom-center")?.firstElementChild?.id === "folio",
        ),
        bodyText: pages.map((p) => p.textContent),
        // A page "assigns" the string if it holds a heading that sets it.
        assigns: pages.map((p) => p.querySelector("h2") !== null),
        sourceText: src.textContent,
        breaks: records.map((rec) => t.positionKey(rec.start)),
        breaksWithout: withoutRunning(),
      };
    };
  });
});

test("a running head shows the chapter the page is in", async ({ page }) => {
  const r = await page.evaluate(() => window.runHeads());

  expect(r.count).toBeGreaterThan(2);
  // `string(name)` means the first assignment on the page, falling back to the
  // value carried in — so a page that opens a chapter partway down shows the
  // new chapter, and a page that assigns nothing carries the old one.
  expect(r.topLeft[0]).toBe("Chapter One");
  expect(r.topLeft.at(-1)).toBe("Chapter Two");
  // Every page has a head: the value persists across pages that assign nothing.
  expect(r.topLeft.every((h) => h !== "")).toBe(true);
});

test("first-except blanks the page where the chapter opens", async ({ page }) => {
  const r = await page.evaluate(() => window.runHeads());

  // Stated as the rule rather than as page numbers: the engines break this
  // fixture in different places, and an expectation pinned to an index is an
  // expectation about Chromium's line breaking.
  expect(r.assigns.some(Boolean)).toBe(true);
  expect(r.assigns.some((a) => !a)).toBe(true);

  for (let i = 0; i < r.count; i++) {
    if (r.assigns[i] === true) {
      expect(r.topRight[i], `page ${i + 1} opens a chapter`).toBe("");
    } else {
      expect(r.topRight[i], `page ${i + 1} only carries the string`).toBe(r.topLeft[i]);
      expect(r.topRight[i]).not.toBe("");
    }
  }
});

test("a running element travels to the margin box as an element", async ({ page }) => {
  const r = await page.evaluate(() => window.runHeads());

  expect(r.folio.every((f) => f === "The Book")).toBe(true);
  // A clone of the element, not its text: §7's point about math in a running
  // head — textContent would destroy a formula.
  expect(r.folioIsElement.every(Boolean)).toBe(true);
});

test("a running element does not move a single break", async ({ page }) => {
  const r = await page.evaluate(() => window.runHeads());

  // The measuring box has running elements taken out before candidates are
  // enumerated, because a running element is not in the flow. The *composed
  // page* has to be measured the same way, and was not: `paginate` measured
  // it with the head still in it, found it too tall, and took a tighter break
  // to make room for something that would not be there. On
  // `issues/duplicate-headers` a break at 630px of a 643px area fell back to
  // 547, every chapter ended with a 65px page of its own, and the document
  // came out at eight pages where six were needed.
  //
  // Deleting the running element from the source is the control: if it is
  // truly out of the flow, the pages break in exactly the same places.
  expect(r.breaksWithout).toEqual(r.breaks);
  // And it is a document worth asking the question of.
  expect(r.count).toBeGreaterThan(2);
});

test("a running element leaves the flow, and the rest still round-trips", async ({ page }) => {
  const r = await page.evaluate(() => window.runHeads());

  // `position: running()` takes the element out of the text.
  expect(r.bodyText.join("")).not.toContain("The Book");
  expect(`The Book${r.bodyText.join("")}`).toBe(r.sourceText);
});
