/**
 * The math drop-ins (`doc/math-drop-in.md`): the engine's formulas with no
 * pages.
 *
 * The exit check is that one source gives the same formulas on a screen as in
 * the book: `examples/math/` and `examples/tex/`, with nothing changed but the
 * script tag, number the same equations the same way, print the same
 * references, and — at the width of the page area — break the same displays
 * into the same rows. Only a reference to a *page* differs, since there is
 * none.
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

/** Serve the repository, `/dist/` from the test bundles, and `pages` — path
 * to HTML — for documents made in the test. */
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

/** The screen config both examples get: the same font check the book makes,
 * and the article as wide as the page area. */
const screenConfig = (width: number): string => `<style>#book { width: ${width}px }</style>
<script>window.FolioMath = { content: "#book", mathFont: "STIX Two Math",
  after: (r) => console.log("folio " + r.equations.size) };</script>`;

/** An example with its paginating script tag swapped for a drop-in. */
function onScreen(example: "math" | "tex", width: number): string {
  const SCREEN = screenConfig(width);
  const html = readFileSync(`${REPO}examples/${example}/index.html`, "utf8");
  const swapped =
    example === "math"
      ? html.replace(/<script type="module">[\s\S]*?<\/script>/, `${SCREEN}<script src="/dist/folio-math.js"></script>`)
      : html.replace(`<script src="/dist/folio.polyfill.js"></script>`, `${SCREEN}<script src="/dist/folio-math-tex.js"></script>`);
  expect(swapped).not.toBe(html);
  return swapped;
}

type Formulas = {
  /** Per numbered equation, in document order: its id and its number. */
  equations: [string, string][];
  /** Per reference: its target and the text its `::after` prints. */
  references: [string, string][];
  /** Per display, in document order: the rows it was broken into. */
  rows: string[];
};

/** What a reader sees of the formulas, from the pages or from the screen. */
async function formulas(page: Page, scope: string): Promise<Formulas> {
  return page.evaluate((scope) => {
    const shown = (el: Element): string => {
      const content = getComputedStyle(el, "::after").content;
      let text = "";
      for (const m of content.matchAll(/"((?:[^"\\]|\\.)*)"|attr\(\s*([\w-]+)[^)]*\)/g)) {
        text += m[1] !== undefined ? m[1] : (el.getAttribute(m[2] ?? "") ?? "");
      }
      return text;
    };
    const roots = [...document.querySelectorAll(scope)];
    const all = (selector: string) => roots.flatMap((r) => [...r.querySelectorAll(selector)]);
    return {
      equations: all(".x-eq").map((eq): [string, string] => [
        eq.querySelector("math")?.id ?? "",
        eq.getAttribute("data-x-counter-equation") ?? "",
      ]),
      references: all("a[href^='#']").map((a): [string, string] => [a.getAttribute("href") ?? "", shown(a)]),
      rows: all("math[display='block']").map((m) => m.getAttribute("data-x-math-rows") ?? "1"),
    };
  }, scope);
}

for (const example of ["math", "tex"] as const) {
  test(`examples/${example} gives the book's formulas on a screen`, async ({ browser }) => {
    test.setTimeout(120_000);

    const book = await browser.newPage();
    const bookErrors = await serve(book);
    const paginated = book.waitForEvent("console", { predicate: (m) => / pages/.test(m.text()), timeout: 60_000 });
    await book.goto(`${ORIGIN}/examples/${example}/`);
    await paginated;
    expect(bookErrors).toEqual([]);
    const printed = await formulas(book, ".pagedjs_page_content");
    // The screen gets the page area's width, whatever the example's page.
    const width = await book.evaluate(() => document.querySelector(".pagedjs_page_content")?.getBoundingClientRect().width ?? 0);
    await book.close();

    const screen = await browser.newPage();
    const screenErrors = await serve(screen, { "/screen.html": onScreen(example, width) });
    const folio = screen.waitForEvent("console", { predicate: (m) => m.text().startsWith("folio "), timeout: 60_000 });
    await screen.goto(`${ORIGIN}/screen.html`);
    await folio;
    expect(screenErrors).toEqual([]);
    const shown = await formulas(screen, "#book");
    await screen.close();

    expect(shown.equations).toEqual(printed.equations);
    // A page number is the one thing a screen does not have.
    const pageless = printed.references.map(([href, text]): [string, string] => [
      href,
      text.replace(/(on page )\d+$/, "$1"),
    ]);
    expect(shown.references).toEqual(pageless);
    expect(shown.rows).toEqual(printed.rows);
    // And the check is not vacuous.
    expect(printed.equations.map(([, n]) => n)).toEqual(["1", "2", "1", "2", "1", "2"]);
    expect(shown.references[0]?.[1]).toBe("(2) in chapter 1");
    if (example === "math") expect(printed.rows.some((r) => r !== "1")).toBe(true);
  });
}

const LONG = `<math display="block" id="long"><mi>f</mi><mo>=</mo>${Array.from(
  { length: 24 },
  (_, i) => `<msup><mi>x</mi><mn>${i + 1}</mn></msup><mo>+</mo>`,
).join("")}<mn>1</mn></math>`;

/** A MathML document for the MathML-only drop-in. */
function mathml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  @font-face { font-family: "STIX Two Math"; src: url("/packages/test/fixtures/fonts/STIXTwoMath-Regular.otf") }
  body { font: 16px/1.4 serif; margin: 20px }
  math { font-family: "STIX Two Math" }
  math[display="block"] { math-number: yes }
  a.eq::after { content: "(" target-counter(attr(href url), equation) ")" }
</style>
<script>window.FolioMath = { mathFont: "STIX Two Math", after: () => console.log("folio") };</script>
<script src="/dist/folio-math.js"></script>
</head><body>${body}</body></html>`;
}

async function load(page: Page, html: string): Promise<string[]> {
  const errors = await serve(page, { "/doc.html": html });
  const done = page.waitForEvent("console", { predicate: (m) => m.text() === "folio", timeout: 30_000 });
  await page.goto(`${ORIGIN}/doc.html`);
  await done;
  return errors;
}

test("the MathML drop-in numbers what CSS marks, and fills references", async ({ page }) => {
  const errors = await load(
    page,
    mathml(`<p>See <a class="eq" href="#b"></a>.</p>
<math display="block" id="a"><mi>a</mi><mo>=</mo><mi>b</mi></math>
<math display="block" id="b"><mi>c</mi><mo>=</mo><mi>d</mi></math>
<p>Inline <math><mi>x</mi></math> is not numbered.</p>`),
  );
  expect(errors).toEqual([]);
  const seen = await page.evaluate(() => ({
    numbers: [...document.querySelectorAll(".x-eq")].map((eq) => eq.getAttribute("data-x-counter-equation")),
    reference: document.querySelector("a.eq")?.getAttribute("data-x-ref-0"),
    after: getComputedStyle(document.querySelector("a.eq") as Element, "::after").content,
    // Nothing of the paginator on the page.
    pages: document.querySelectorAll(".pagedjs_page, iframe").length,
  }));
  expect(seen.numbers).toEqual(["1", "2"]);
  expect(seen.reference).toBe("2");
  // What is printed: Chromium serializes it as one string, Firefox as three.
  expect(seen.after.replace(/"\s*"/g, "")).toBe('"(2)"');
  expect(seen.pages).toBe(0);
});

test("a display is broken again when its container changes width", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  const errors = await load(page, mathml(`<div id="box">${LONG}</div>`));
  expect(errors).toEqual([]);
  const state = () =>
    page.evaluate(() => {
      const math = document.getElementById("long") as Element;
      const eq = math.closest(".x-eq") as Element;
      return {
        rows: math.getAttribute("data-x-math-rows"),
        wider: math.getBoundingClientRect().width > eq.getBoundingClientRect().width + 1,
        text: math.textContent,
      };
    });
  const wide = await state();
  expect(wide.rows).toBeNull();

  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(async () => (await state()).rows).not.toBeNull();
  const narrow = await state();
  // Four rows at this width. Three was `splitIntoRows` resolving the second
  // break after the first cut had renumbered the row, so a row overflowed.
  expect(Number(narrow.rows)).toBeGreaterThan(2);
  expect(narrow.wider).toBe(false);
  // Nothing lost or repeated by the breaking.
  expect(narrow.text).toBe(wide.text);

  await page.setViewportSize({ width: 1600, height: 800 });
  await expect.poll(async () => (await state()).rows).toBeNull();
  expect((await state()).text).toBe(wide.text);
});

test("beside the paginator the drop-in does nothing", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>@page { size: A6 } math[display="block"] { math-number: yes }</style>
<script>window.PagedConfig = { after: (f) => console.log(f.total + " pages") };</script>
<script src="/dist/folio.polyfill.js"></script><script src="/dist/folio-math.js"></script>
</head><body><math display="block"><mi>a</mi></math><math display="block"><mi>b</mi></math></body></html>`;
  const errors = await serve(page, { "/both.html": html });
  const done = page.waitForEvent("console", { predicate: (m) => / pages/.test(m.text()) });
  await page.goto(`${ORIGIN}/both.html`);
  await done;
  expect(errors).toEqual([]);
  expect(warnings.some((w) => w.includes("math drop-in does nothing"))).toBe(true);
  const numbers = await page.evaluate(() =>
    [...document.querySelectorAll(".pagedjs_page .x-eq")].map((eq) => eq.getAttribute("data-x-counter-equation")),
  );
  expect(numbers).toEqual(["1", "2"]);
});
