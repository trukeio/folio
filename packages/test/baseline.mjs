/**
 * M0.2: run the corpus through Paged.js and store the result as the baseline.
 *
 * This is layer 4's reference point (`doc/plan.md` §9). It runs before there is
 * an engine on purpose: a differential test needs something to differ from, and
 * measuring Paged.js now also tells us which corpus specs are stable enough to
 * be evidence at all.
 *
 *   node packages/test/baseline.mjs [--engine chromium] [--filter substring]
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { platform, release } from "node:os";
import { globSync } from "node:fs";
import { join, relative } from "node:path";

const engines = { chromium, firefox, webkit };
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const engineName = flag("engine", "chromium");
const filter = flag("filter", "");
const root = new URL("./fixtures/", import.meta.url).pathname;
const corpus = join(root, "corpus");
const outDir = new URL("./baselines/", import.meta.url).pathname;
const port = Number(process.env.FIXTURE_PORT ?? 5177);

/**
 * Stamped into the source before Paged.js runs, and cloned onto every page.
 *
 * Escaping matters here. This is a template literal, so a backslash-s written
 * plainly collapses to a bare "s" before the page ever sees it: the whitespace
 * regex below must be written with a doubled backslash, or it strips the
 * letter s and leaves whitespace in place. That bug made Paged.js look like it
 * was losing content across the whole corpus (M0.2).
 */
const STAMP = `
window.PagedConfig = {
  auto: true,
  before: () => {
    const walk = (el, path) => {
      el.setAttribute("data-corpus-path", path.join("."));
      [...el.children].forEach((c, i) => walk(c, [...path, i]));
    };
    [...document.body.children].forEach((c, i) => walk(c, [i]));

    // The source side of the content check, taken before anything is split.
    const source = {};
    document.querySelectorAll("[data-corpus-path]").forEach((el) => {
      // Non-whitespace characters only. Source indentation between block
      // elements is collapsible whitespace that no paginator preserves, so
      // counting it would flag every fixture in the corpus and mean nothing.
      // Whitespace regex: see the note above STAMP about escaping.
      source[el.dataset.corpusPath] = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .reduce((s, n) => s + n.data.replace(/\\s+/g, "").length, 0);
    });
    window.__corpusSource = source;
  },
  after: () => { window.__corpusDone = true; },
};
`;

const EXTRACT = () => {
  const own = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .reduce((s, n) => s + n.data.replace(/\s+/g, "").length, 0);

  /**
   * Text that is laid out *outside* the area this page prints.
   *
   * Recorded because a page count on its own cannot be compared: an engine
   * that drops content needs fewer pages, and "fewer pages" then reads as an
   * improvement when it is the opposite. Paged.js implements widows and
   * orphans with a column trick, so what it cannot fit goes *sideways*: on
   * `widows-orphans` 62 line boxes are laid out past the right edge of a
   * 302px page, where nothing will ever print them.
   *
   * Line boxes of text nodes, not element boxes. Paged.js's own wrapper is a
   * multi-column box several pages wide by construction, so measuring element
   * boxes calls 93 of 122 fixtures broken; measuring the lines calls 8.
   */
  const lostOf = (pg) => {
    const area = pg.querySelector(".pagedjs_page_content") ?? pg.querySelector(".pagedjs_area");
    if (area === null) return { lines: 0, past: 0 };
    const box = area.getBoundingClientRect();
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let lines = 0;
    let past = 0;
    // How far down the area the ink actually reaches, so "fewer pages" can be
    // told apart from "fuller pages".
    let fill = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue;
        const out = Math.max(r.right - box.right, r.bottom - box.bottom);
        if (out > 1) {
          lines += 1;
          past = Math.max(past, out);
        } else {
          fill = Math.max(fill, r.bottom - box.top);
        }
      }
    }
    return { lines, past: Math.round(past * 10) / 10, fill: Math.round(fill) };
  };

  const pages = [...document.querySelectorAll(".pagedjs_page")];
  return {
    pageCount: pages.length,
    pages: pages.map((pg, index) => ({
      index,
      lost: lostOf(pg),
      items: [...pg.querySelectorAll("[data-corpus-path]")]
        .map((el) => ({ path: el.dataset.corpusPath, chars: own(el) }))
        .filter((it) => it.chars > 0),
    })),
    source: window.__corpusSource ?? {},
  };
};

const fixtures = globSync("specs/**/*.html", { cwd: corpus })
  // specs/index.html is the corpus's own listing page: it loads no polyfill and
  // paginates nothing.
  .filter((f) => f !== "specs/index.html")
  .filter((f) => f.includes(filter))
  .sort();

const polyfill = await readFile(join(root, "vendor/paged.polyfill.js"), "utf8");

const browser = await engines[engineName].launch();
const environment = {
  engine: engineName,
  engineVersion: browser.version(),
  platform: `${platform()} ${release()}`,
  // Load-bearing (found in M0.2): no corpus fixture loads a webfont and 41 of
  // them name a font-family, so every page count here is a function of the
  // fonts installed on this machine. A baseline is evidence about one
  // environment, not a portable expectation - which is why layer 4 compares
  // the two engines inside one run rather than against this file.
  fontsArePinned: false,
};
const results = [];
const failures = [];

for (const fixture of fixtures) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  try {
    // Fixtures keep their upstream `<script src="../../../dist/paged.polyfill.js">`,
    // at whatever depth they sit. Intercepting by name works for all of them and
    // keeps every vendored file byte-identical to upstream.
    await page.route("**/paged.polyfill.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: polyfill }),
    );
    await page.addInitScript(STAMP);
    await page.goto(`http://127.0.0.1:${port}/corpus/${fixture}`, { timeout: 15000 });
    await page.waitForFunction("window.__corpusDone === true", null, { timeout: 30000 });
    const result = await page.evaluate(EXTRACT);
    results.push({ spec: fixture, ...result });
    process.stdout.write(`  ${String(result.pageCount).padStart(3)}p  ${fixture}\n`);
  } catch (error) {
    failures.push({ spec: fixture, error: String(error).split("\n")[0] });
    process.stdout.write(`    ??  ${fixture}  (${String(error).split("\n")[0].slice(0, 60)})\n`);
  } finally {
    await page.close();
  }
}
await browser.close();

await mkdir(outDir, { recursive: true });
const out = join(outDir, `pagedjs-${engineName}.json`);
await writeFile(
  out,
  JSON.stringify({ environment, pagedjs: "0.5.0-beta.2", results, failures }, null, 2) + "\n",
);

console.log(`\n${results.length} paginated, ${failures.length} failed -> ${relative(process.cwd(), out)}`);
