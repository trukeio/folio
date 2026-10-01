/**
 * M5.1's exit check, swept (`doc/milestones.md`).
 *
 * "A real Paged.js project runs unchanged, with its script tag swapped." Every
 * fixture in the Paged.js spec corpus is a real Paged.js project, and every
 * one names `paged.polyfill.js` in a script tag. So: intercept that request,
 * serve ours, change nothing else, and check the page count against what our
 * own library API produced on the same fixture — the polyfill must not be a
 * second engine with opinions of its own.
 *
 *   node packages/test/serve.mjs &
 *   node packages/test/polyfill-corpus.mjs
 *
 * `doc/compat.md` records what runs differently and why.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
const polyfill = readFileSync("packages/test/.bundle/folio.polyfill.js", "utf8");
const baseline = new Map(
  JSON.parse(readFileSync("packages/test/baselines/folio-chromium.json", "utf8"))
    .results.map((r) => [r.spec, r.pageCount]),
);
const fixtures = globSync("specs/**/*.html", { cwd: "packages/test/fixtures/corpus" })
  .filter((f) => f !== "specs/index.html").sort();
const browser = await chromium.launch();
let ok = 0, mismatch = 0, broken = 0;
for (const fixture of fixtures) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0].slice(0, 70)));
  await page.route("**/paged.polyfill.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: polyfill }));
  try {
    await page.goto(`http://127.0.0.1:5177/corpus/${fixture}`, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector(".pagedjs_pages") !== null, { timeout: 30000 });
    const n = await page.evaluate(() => document.querySelectorAll(".pagedjs_page").length);
    const want = baseline.get(fixture);
    if (errors.length > 0) { broken++; console.log(`  ERR  ${fixture}  ${errors[0]}`); }
    else if (n !== want) { mismatch++; console.log(`  DIFF ${fixture}  api=${want} polyfill=${n}`); }
    else ok++;
  } catch (e) {
    broken++;
    console.log(`  FAIL ${fixture}  ${String(e).split("\n")[0].slice(0, 70)}`);
  } finally { await page.close(); }
}
await browser.close();
console.log(`\n${ok} match the library API, ${mismatch} differ, ${broken} failed, of ${fixtures.length}`);
