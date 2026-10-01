/**
 * M6: `box-decoration-break`, `margin-break`, and what else belongs to one
 * fragment of an element rather than to every clone of it (`fragments.ts`).
 *
 * The assertions read computed styles off the composed pages, which is what
 * the browser draws. Generated content is the exception, as it is everywhere
 * (`counters.spec.ts`): its text is not in the DOM, so `::before` is asserted
 * by its computed `content` being `none`.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/fragments.html";

type Fragment = {
  page: number;
  from: boolean;
  to: boolean;
  style: Record<string, string>;
  before: string;
  after: string;
};

type Run = {
  pages: number;
  overflowed: number[];
  /** section id → its fragments of the element the section is about. */
  fragments: Record<string, Fragment[]>;
  /** section id → the first element of each page it is on, and its margin. */
  openers: Record<string, { page: number; text: string; marginTop: string }[]>;
  /** The indent of the first paragraph on each page of #fresh after the first. */
  freshIndents: string[];
  /** Each fragment of #list's `<ol>`: its `start`, and its inline style. */
  lists: { start: string | null; style: string | null }[];
};

declare global {
  interface Window {
    folio: typeof Folio;
    runFragments: () => Promise<Run>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runFragments = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const view = target.defaultView as Window;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const result = t.paginate({ source: src, pageRules: doc.pageRules, target, maxPages: 60 });

      const PROPS = [
        "padding-top",
        "padding-bottom",
        "border-top-width",
        "border-bottom-width",
        "margin-top",
        "text-indent",
        "list-style-type",
      ];
      const about: Record<string, string> = {
        slice: ".box",
        clone: ".box",
        pseudo: "p",
        list: "#long",
      };
      const fragments: Record<string, Fragment[]> = {};
      const openers: Run["openers"] = {};
      const freshIndents: string[] = [];
      const lists: Run["lists"] = [];

      result.pages.forEach((content, i) => {
        for (const [id, selector] of Object.entries(about)) {
          for (const el of content.querySelectorAll(`#${id} ${selector}`)) {
            const cs = view.getComputedStyle(el);
            (fragments[id] ??= []).push({
              page: i + 1,
              from: el.hasAttribute("data-folio-split-from"),
              to: el.hasAttribute("data-folio-split-to"),
              style: Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)])),
              before: view.getComputedStyle(el, "::before").content,
              after: view.getComputedStyle(el, "::after").content,
            });
          }
        }
        for (const ol of content.querySelectorAll("#list ol")) {
          lists.push({ start: ol.getAttribute("start"), style: ol.getAttribute("style") });
        }
        const section = content.querySelector("section");
        if (section === null) return;
        const first = section.firstElementChild;
        if (first === null) return;
        (openers[section.id] ??= []).push({
          page: i + 1,
          text: first.textContent.slice(0, 12),
          marginTop: view.getComputedStyle(first).marginTop,
        });
        if (section.id === "fresh" && section.hasAttribute("data-folio-split-from")) {
          freshIndents.push(view.getComputedStyle(first).textIndent);
        }
      });

      return {
        pages: result.records.length,
        overflowed: result.overflowed,
        fragments,
        openers,
        freshIndents,
        lists,
      };
    };
  });
});

test("no page overflows, and every box that should break did", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  expect(run.overflowed).toEqual([]);
  for (const id of ["slice", "clone", "pseudo", "list"]) {
    expect(run.fragments[id]?.length, id).toBeGreaterThanOrEqual(2);
  }
});

test("slice: no edge is drawn at the break, and the continued line is not indented", async ({
  page,
}) => {
  const run = await page.evaluate(() => window.runFragments());
  const [first, ...rest] = run.fragments["slice"] ?? [];
  const last = rest.at(-1);
  expect(first?.to).toBe(true);
  expect(first?.style).toMatchObject({
    "padding-top": "10px",
    "border-top-width": "4px",
    "padding-bottom": "0px",
    "border-bottom-width": "0px",
    "text-indent": "24px",
  });
  expect(last?.from).toBe(true);
  expect(last?.style).toMatchObject({
    "padding-top": "0px",
    "border-top-width": "0px",
    "padding-bottom": "10px",
    "border-bottom-width": "4px",
    "text-indent": "0px",
  });
});

test("clone: every fragment is drawn whole", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  for (const fragment of run.fragments["clone"] ?? []) {
    expect(fragment.style, `page ${fragment.page}`).toMatchObject({
      "padding-top": "10px",
      "border-top-width": "4px",
      "padding-bottom": "10px",
      "border-bottom-width": "4px",
    });
  }
});

test("::before is the first fragment's, ::after the last's", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  const fragments = run.fragments["pseudo"] ?? [];
  fragments.forEach((f, i) => {
    expect(f.before !== "none", `::before on fragment ${i}`).toBe(i === 0);
    expect(f.after !== "none", `::after on fragment ${i}`).toBe(i === fragments.length - 1);
  });
});

test("a list item's marker is drawn once", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  const fragments = run.fragments["list"] ?? [];
  expect(fragments[0]?.style["list-style-type"]).toBe("decimal");
  for (const f of fragments.slice(1)) expect(f.style["list-style-type"]).toBe("none");
});

test("a list continued on a later page goes on counting", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  // The third item breaks. Its second half is still item 3 — with its marker
  // hidden — so the continuation starts there and "Four." is 4. Without the
  // `start`, both engines began the clone at 1; Firefox had also been handed
  // an inline `counter-reset: list-item 0` by the counter walk.
  expect(run.lists).toEqual([
    { start: null, style: null },
    { start: "3", style: null },
  ]);
});

test("a paragraph that opens a page fresh keeps its indent", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  expect(run.freshIndents.length).toBeGreaterThan(0);
  for (const indent of run.freshIndents) expect(indent).toBe("36px");
});

test("margin-break: kept after a forced break, discarded on request", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  expect(run.openers["forced"]?.[0]?.marginTop).toBe("40px");
  expect(run.openers["discard"]?.[0]?.marginTop).toBe("0px");
});

test("margin-break: truncated after an unforced break, unless kept", async ({ page }) => {
  const run = await page.evaluate(() => window.runFragments());
  const keep = run.openers["keep"] ?? [];
  const auto = run.openers["auto"] ?? [];
  expect(keep.length).toBeGreaterThan(1);
  expect(auto.length).toBeGreaterThan(1);
  // The first page of each section follows a forced break.
  expect(keep[0]?.marginTop).toBe("30px");
  expect(auto[0]?.marginTop).toBe("30px");
  for (const o of keep.slice(1)) expect(o.marginTop, o.text).toBe("30px");
  for (const o of auto.slice(1)) expect(o.marginTop, o.text).toBe("0px");
});
