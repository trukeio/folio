/**
 * The TeX front end (`doc/tex.md`), with the engine it feeds.
 *
 * The exit check is §6 step 8: `examples/tex/` is `examples/math/` written in
 * LaTeX, and the two must paginate alike — the same pages, the same equation
 * numbers on them, the same references printed. It needs no opinion about
 * typography, and it catches anything the front end does differently from
 * hand-written MathML, in numbering, ids or spacing.
 *
 * The examples are served from the repository through a route, with `/dist/`
 * answered from the bundles Playwright's `globalSetup` built, so the test
 * never runs against a stale `pnpm build`.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const ORIGIN = "http://folio.test";
const REPO = new URL("../../../", import.meta.url).pathname;
const BUNDLE = new URL("../.bundle/", import.meta.url).pathname;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript",
  mjs: "text/javascript",
  otf: "font/otf",
  woff2: "font/woff2",
};

/** Serve the repository under `ORIGIN`, `/dist/` from the test bundles, and
 * `pages` — path to HTML — for documents written in the test. */
async function serve(page: Page, pages: Record<string, string> = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0] ?? e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const inline = pages[path];
    if (inline !== undefined) return route.fulfill({ contentType: "text/html; charset=utf-8", body: inline });
    const file = path.startsWith("/dist/") ? BUNDLE + path.slice(6) : REPO + path.slice(1).replace(/\/$/, "/index.html");
    const type = TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream";
    try {
      return route.fulfill({ contentType: type, body: readFileSync(file) });
    } catch {
      return route.fulfill({ status: 404, body: "not found" });
    }
  });
  return errors;
}

/** Load `path` and wait for the "N pages" line both examples log when done. */
async function paginate(page: Page, path: string): Promise<void> {
  const done = page.waitForEvent("console", { predicate: (m) => / pages/.test(m.text()), timeout: 60_000 });
  await page.goto(`${ORIGIN}${path}`);
  await done;
}

type Laid = {
  pages: number;
  /** Per equation, in document order: the page it is on, its id, its number. */
  equations: [number, string, string][];
  /** Per reference: its target and the text its `::after` prints. */
  references: [string, string][];
  /** Any TeX left over on the pages. */
  leftover: string[];
  /** Formulas outside the page areas: carried into running heads. */
  carried: number;
};

/** What the pages show, read the way a reader would. */
async function laidOut(page: Page): Promise<Laid> {
  return page.evaluate(() => {
    /** A generated `content` value, with every `attr()` filled in. */
    const shown = (el: Element): string => {
      const content = getComputedStyle(el, "::after").content;
      let text = "";
      for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([\w-]+)[^)]*\)/g)) {
        text += m[1] !== undefined ? m[1] : (el.getAttribute(m[2] ?? "") ?? "");
      }
      return text;
    };
    const pages = [...document.querySelectorAll(".pagedjs_page")];
    const equations: [number, string, string][] = [];
    const references: [string, string][] = [];
    const leftover: string[] = [];
    pages.forEach((p, i) => {
      for (const eq of p.querySelectorAll(".x-eq")) {
        const math = eq.querySelector("math");
        equations.push([i + 1, math?.id ?? "", eq.getAttribute("data-x-counter-equation") ?? ""]);
      }
      for (const a of p.querySelectorAll("a[href^='#']")) {
        references.push([a.getAttribute("href") ?? "", shown(a)]);
      }
      // What is drawn, which is not the `<annotation>`: that keeps the TeX on
      // purpose.
      let text = "";
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
        // Nor `<code>`, where the example shows the delimiters as prose.
        if (n.parentElement?.closest("annotation, code") == null) text += n.nodeValue ?? "";
      }
      for (const m of text.matchAll(/\\[([]|\\(?:begin|eqref|label)\b/g)) leftover.push(m[0]);
    });
    const carried = pages.flatMap((p) =>
      [...p.querySelectorAll("math")].filter((m) => m.closest(".pagedjs_page_content") === null),
    ).length;
    return { pages: pages.length, equations, references, leftover, carried };
  });
}

test("the LaTeX example paginates as the MathML one does", async ({ browser }) => {
  test.setTimeout(120_000);
  const results: Laid[] = [];
  for (const path of ["/examples/math/", "/examples/tex/"]) {
    const page = await browser.newPage();
    const errors = await serve(page);
    await paginate(page, path);
    expect(errors, path).toEqual([]);
    results.push(await laidOut(page));
    await page.close();
  }
  const [math, tex] = results;
  expect(tex?.leftover).toEqual([]);
  expect(tex?.pages).toBe(math?.pages);
  expect(tex?.equations).toEqual(math?.equations);
  expect(tex?.references).toEqual(math?.references);
  expect(tex?.carried).toBe(math?.carried);
  // And the check is not vacuous: every chapter numbers from 1.
  expect(math?.equations.map(([, , n]) => n)).toEqual(["1", "2", "1", "2", "1", "2"]);
  expect(math?.references[0]?.[1]).toBe("(2) in chapter 1");
  // The chapter title's formula rides in the running head, as a formula.
  expect(math?.carried).toBeGreaterThan(0);
});

/** A small document with the TeX script before or after the polyfill. */
function drop(texFirst: boolean, body: string): string {
  const tex = `<script src="/dist/folio-tex.js"></script>`;
  const polyfill = `<script src="/dist/folio.polyfill.js"></script>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<style>@page { size: A6; margin: 10mm } body { font: 11pt/1.4 serif }</style>
<script>window.PagedConfig = { after: (flow) => console.log(flow.total + " pages") };</script>
${texFirst ? tex + polyfill : polyfill + tex}
</head><body>${body}</body></html>`;
}

const SMALL = String.raw`<p>Let \(x^2 \ge 0\).</p>
\begin{equation} a = b \label{eq:first} \end{equation}
<p>and</p>
\[ c = d \tag{7a} \label{tagged} \]
<p>and</p>
\begin{align} e &= f \label{third} \end{align}
<p>See \eqref{eq:first}, \eqref{tagged} and \ref{third}.</p>`;

for (const texFirst of [true, false]) {
  test(`the TeX script works loaded ${texFirst ? "before" : "after"} the polyfill`, async ({ page }) => {
    const errors = await serve(page, { "/small.html": drop(texFirst, SMALL) });
    await paginate(page, "/small.html");
    expect(errors).toEqual([]);
    const laid = await laidOut(page);
    expect(laid.leftover).toEqual([]);
    // A tag is printed whole and not counted: the equation after it is (2).
    expect(laid.equations.map(([, id, n]) => [id, n])).toEqual([
      ["eq:first", "1"],
      ["tagged", "(7a)"],
      ["third", "2"],
    ]);
    expect(laid.references).toEqual([
      ["#eq:first", "(1)"],
      ["#tagged", "(7a)"],
      ["#third", "2"],
    ]);
    const gutters = await page.evaluate(() =>
      [...document.querySelectorAll(".pagedjs_page .x-eq-num:last-child")].map(
        (g) => getComputedStyle(g, "::after").content,
      ),
    );
    expect(gutters.length).toBe(3);
    // The tagged gutter prints its label without parentheses of its own.
    expect(gutters[1]).not.toContain(`"("`);
  });
}

test("the library takes the handler, with no polyfill on the page", async ({ page }) => {
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<style>@page { size: A6; margin: 10mm } body { font: 11pt/1.4 serif }</style>
<script src="/dist/folio.js"></script><script src="/dist/folio-tex.js"></script>
</head><body>${SMALL}</body></html>`;
  const errors = await serve(page, { "/library.html": doc });
  await page.goto(`${ORIGIN}/library.html`);
  const total = await page.evaluate(async () => {
    const w = window as unknown as {
      folio: { Previewer: new (s: object) => { preview: () => Promise<{ total: number }> } };
      folioTeX: { createTeXHandler: (o: object) => unknown };
    };
    const handler = w.folioTeX.createTeXHandler({ tags: "all" });
    return (await new w.folio.Previewer({ handlers: [handler] }).preview()).total;
  });
  expect(errors).toEqual([]);
  expect(total).toBeGreaterThan(0);
  const laid = await laidOut(page);
  expect(laid.leftover).toEqual([]);
  // Under "all", the \[ … \] display with a tag keeps its tag.
  expect(laid.equations.map(([, id, n]) => [id, n])).toEqual([
    ["eq:first", "1"],
    ["tagged", "(7a)"],
    ["third", "2"],
  ]);
});

test("a display inside a paragraph paginates with nothing lost", async ({ page }) => {
  // MathJax leaves \[ … \] where it was, so inside a <p> it is a block in the
  // middle of the paragraph's lines. The core had not been asked to break one.
  const para = String.raw`<p>Some words before the formula, enough of them to fill a line or two
    of the page, and then \[ \sum_{k=1}^{n} k = \frac{n(n+1)}{2} \] and some words after it,
    which continue the same paragraph for a few more lines of text.</p>`;
  const errors = await serve(page, { "/inside.html": drop(true, para.repeat(12)) });
  const overflowed: unknown[] = [];
  page.on("console", (m) => {
    if (m.text().startsWith("overflow")) overflowed.push(m.text());
  });
  await paginate(page, "/inside.html");
  expect(errors).toEqual([]);
  const seen = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".pagedjs_page")];
    const area = (p: Element) => p.querySelector(".pagedjs_page_content, .pagedjs_area")?.getBoundingClientRect();
    return {
      pages: pages.length,
      maths: document.querySelectorAll(".pagedjs_page math[display='block']").length,
      // Every display sits inside its page's area.
      outside: pages.flatMap((p) => {
        const box = area(p);
        if (box === undefined) return [];
        return [...p.querySelectorAll("math[display='block']")]
          .map((m) => m.getBoundingClientRect())
          .filter((r) => r.height > 0 && (r.top < box.top - 1 || r.bottom > box.bottom + 1))
          .map((r) => r.bottom - box.bottom);
      }),
    };
  });
  expect(seen.pages).toBeGreaterThan(1);
  expect(seen.maths).toBe(12);
  expect(seen.outside).toEqual([]);
  expect(overflowed).toEqual([]);
});
