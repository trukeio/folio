/**
 * M0.1: the WPT reftest runner (`doc/plan.md` §9 layer 3, §8).
 *
 * A reftest renders a test page and a reference page and asserts they look the
 * same. Run against a bare browser it answers "what does this engine support
 * natively" — which is the evidence §8's deletion conditions need: a module
 * may be deleted when every target browser passes the tests it stands in for.
 * Run with our engine loaded (M6), the same tests answer "does the engine
 * behave correctly", with no second corpus to maintain.
 *
 * Tests are fetched on demand into .wpt-cache/ (not committed) at the commit
 * pinned in wpt-manifest.json.
 *
 *   node packages/test/wpt.mjs [--engine chromium|firefox|webkit|all] [--filter x]
 *   node packages/test/wpt.mjs --folio [--engine ...] [--filter x] [--verbose]
 *                                        [--shots dir]   # failing pages, test | ref
 *   node packages/test/wpt.mjs --native-print [--filter x] [--verbose] [--shots dir]
 *
 * The two modes run disjoint halves of the manifest. A bare browser can only
 * be scored on continuous-media tests; the `-print` tests are paginated, and
 * comparing viewport screenshots cannot evaluate them. With `--folio`, only
 * the `-print` tests run: the test and its reference are both paginated by
 * our `Previewer` and compared page by page — the same number of pages, and
 * each page the same pixels — and the page count is checked against
 * Chromium's own print of the reference (`nativePages`), so that
 * a test and a reference we get wrong alike do not pass together. A
 * continuous-media test says nothing about us:
 * paginating it and its reference just measures the browser twice.
 *
 * `--native-print` is the third mode: the `-print` half again, printed by the
 * browser with no engine loaded (`nativeShots`). It is the native evidence for
 * the paginated tests the deletion conditions name (`deletion.mjs`), and it
 * is Chromium's alone.
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const engines = { chromium, firefox, webkit };
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const pick = flag("engine", "chromium");
const filter = flag("filter", "");
const withFolio = args.includes("--folio");
/**
 * The paginated half, printed by the browser itself: the native evidence for
 * `deletion.mjs`. Chromium only — `page.pdf` is its alone — so a `-print`
 * test is "unknown" on the other engines, never a pass.
 */
const nativePrint = args.includes("--native-print");
const verbose = args.includes("--verbose");
/** Where to write the pages of a failing test, for looking at. */
const shotsDir = flag("shots", "");

const here = new URL("./", import.meta.url).pathname;
const cache = join(here, ".wpt-cache");
const manifest = JSON.parse(await readFile(join(here, "wpt-manifest.json"), "utf8"));
const RAW = `https://raw.githubusercontent.com/web-platform-tests/wpt/${manifest.commit}`;

/**
 * A paginated reftest: its reference is paginated too. WPT's rule is `-print`
 * immediately before the extension, or a directory named `print`
 * (`docs/writing-tests/print-reftests.md`).
 */
const isPrint = (test) => /-print(\.tentative)?\.html$/.test(test) || test.includes("/print/");

/**
 * The page a print reftest gets unless it asks for another: 5in by 3in with
 * half-inch margins, per the same document. It is the user agent's default,
 * not an author rule — `size: landscape` alone rotates it — so the engine gets
 * it as `pageDefaults`, and the browser's print as its paper.
 */
const WPT_PAGE = "size: 5in 3in; margin: 0.5in";

/**
 * Which pages a file compares: `<meta name=reftest-pages>`, a list of `n`,
 * `a-b`, `-b` and `a-`. It belongs to the file it is in — a reference without
 * one compares all of its pages. Returns 1-based page numbers kept, given the
 * total, or every page when the file names none.
 */
function pagesOf(html, total) {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  const ranges = rangesOf(html);
  return ranges === null ? all : all.filter((n) => ranges.some(([lo, hi]) => n >= lo && n <= hi));
}

/** `reftest-pages` as `[lo, hi]` pairs, open ends as ±Infinity; null if absent. */
function rangesOf(html) {
  const m = html.match(/<meta[^>]+name=["']?reftest-pages["']?[^>]*>/i);
  const spec = m?.[0].match(/content=["']([^"']*)["']/i)?.[1];
  if (spec === undefined) return null;
  return spec
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((item) => {
      const [a, b] = item.includes("-") ? item.split("-") : [item, item];
      return [a === "" ? 1 : Number(a), b === "" ? Infinity : Number(b)];
    });
}

/** Fetch one WPT file into the cache, once. */
async function ensure(path) {
  const local = join(cache, path);
  if (existsSync(local)) return local;
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) return null;
  await mkdir(dirname(local), { recursive: true });
  await writeFile(local, Buffer.from(await res.arrayBuffer()));
  return local;
}

/** A reftest names its reference with <link rel="match">. */
function referenceOf(html, testPath) {
  const m = html.match(/<link[^>]+rel=["']?match["']?[^>]*>/i);
  const href = m?.[0].match(/href=["']([^"']+)["']/i)?.[1];
  if (href === undefined) return null;
  // Root-relative references are relative to the WPT root, not the test.
  if (href.startsWith("/")) return href.slice(1);
  return join(dirname(testPath), href).replace(/\\/g, "/");
}

/**
 * How far a test lets its rendering differ: `<meta name="fuzzy">`, in WPT's
 * `maxDifference=a-b;totalPixels=c-d` form or the bare `a-b;c-d` one. Only the
 * upper bound of the pixel count is used, on top of pixelmatch's own
 * anti-aliasing threshold; no fuzz means no pixel may differ. For a print
 * reftest it applies to each page separately.
 */
function fuzzOf(html) {
  let pixels = 0;
  for (const m of html.matchAll(/<meta[^>]+name=["']?fuzzy["']?[^>]*>/gi)) {
    const content = m[0].match(/content=["']([^"']+)["']/i)?.[1] ?? "";
    const spec = content.includes(":") ? content.slice(content.lastIndexOf(":") + 1) : content;
    const parts = spec.split(";");
    const total = parts.find((p) => p.includes("totalPixels")) ?? parts[1] ?? "";
    const upper = Number(total.replace(/.*=/, "").split("-").at(-1));
    if (Number.isFinite(upper)) pixels = Math.max(pixels, upper);
  }
  return pixels;
}

async function shoot(page, file, print) {
  // WPT names its print reftests `-print`. Rendering one in screen media
  // compares two different layouts and calls the difference a failure.
  await page.emulateMedia({ media: print ? "print" : "screen" });
  await page.goto(`file://${file}`, { waitUntil: "load" });
  await reftestWait(page);
  return PNG.sync.read(await page.screenshot());
}

/** WPT's reftest wait: a test may declare it is not ready yet. */
async function reftestWait(page) {
  await page
    .waitForFunction(() => !document.documentElement.classList.contains("reftest-wait"), null, { timeout: 5000 })
    .catch(() => {});
}

// --- The engine-loaded mode ------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xht": "application/xhtml+xml",
  ".xhtml": "application/xhtml+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Serve the WPT tree from the cache, fetching what is missing.
 *
 * Over HTTP rather than `file://` because WPT tests are written against the
 * root of a server: `/fonts/Ahem.ttf`, `/images/green.png`, `/common/...`.
 * Nothing is listed in advance — a file is mirrored the first time a test
 * asks for it, which is also how the cache stays the size of what was run.
 */
function serveWpt() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(
      /^\/+/,
      "",
    );
    if (path.startsWith("..")) return void res.writeHead(403).end();
    const local = await ensure(path).catch(() => null);
    if (local === null) return void res.writeHead(404).end();
    const type = TYPES[extname(local).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type }).end(await readFile(local));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const PAGE_TIMEOUT = 30_000;

/**
 * Paginate one document with the engine and screenshot each page.
 *
 * A fresh page each time: the `Previewer` rebuilds the document it runs in,
 * and a test must not see the one before it.
 */
async function paginated(context, url, bundle) {
  const page = await context.newPage();
  try {
    await page.emulateMedia({ media: "screen" });
    await page.goto(url, { waitUntil: "load" });
    await reftestWait(page);
    await page.addScriptTag({ path: bundle });
    const run = page.evaluate(async (pageDefaults) => {
      const flow = await new window.folio.Previewer({ maxPages: 40, pageDefaults }).preview();
      return { total: flow.total, overflowed: flow.overflowed };
    }, WPT_PAGE);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${PAGE_TIMEOUT / 1000}s`)), PAGE_TIMEOUT),
    );
    const flow = await Promise.race([run, timeout]);

    // Each page alone, at the origin. Stacked, a page after an A4 one starts
    // at a fractional offset, is rasterised half a pixel differently and
    // clipped a pixel taller — a difference in where the page sat on the
    // screen, not in the page.
    const sizes = await page.evaluate(() =>
      [...document.querySelectorAll(".pagedjs_pages > *")].map((el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      }),
    );
    // Clipped at the document's left edge: in a right-to-left host the scroll
    // origin is at the right, and the clip missed every page (WPT
    // `page-left-right-002`). The pages keep the author's direction and
    // writing mode, which their own content area and `html'` carry.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("direction", "ltr", "important");
      // And a vertical host, whose scroll origin is at the right too
      // (`review.md` §5): the pages keep their writing mode.
      document.documentElement.style.setProperty("writing-mode", "horizontal-tb", "important");
    });
    const shots = [];
    for (let i = 0; i < sizes.length; i++) {
      const [width, height] = sizes[i];
      await page.setViewportSize({ width: Math.max(width, 1), height: Math.max(height, 1) });
      await page.evaluate((n) => {
        document.querySelectorAll(".pagedjs_pages > *").forEach((el, j) => {
          el.style.visibility = j === n ? "visible" : "hidden";
          if (j === n) el.style.cssText += ";position:fixed;left:0;top:0;margin:0;z-index:2147483647";
        });
      }, i);
      shots.push(PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width, height } })));
      await page.evaluate((n) => {
        const el = document.querySelectorAll(".pagedjs_pages > *")[n];
        el.style.position = el.style.left = el.style.top = el.style.zIndex = el.style.margin = "";
      }, i);
    }
    return { ...flow, shots };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * How many pages the browser itself prints the reference on.
 *
 * Comparing our test against our reference proves the two agree, and two
 * things the engine gets wrong in the same way agree perfectly: every
 * vertical-writing test passed that way before this check, with vertical
 * writing unimplemented. The browser's own print of the reference is an
 * oracle that owes us nothing, and its page count is the part of it that
 * survives the difference between a PDF raster and a screen one.
 *
 * `page.pdf` is Chromium's alone, so Chromium is the oracle for every engine
 * under test. A reference is written to paginate the same way everywhere —
 * explicit sizes, forced breaks — and its page count is the one fact taken
 * from it. Without this, Firefox scored 86/235 against Chromium's 51, and the
 * difference was all tests that both sides got wrong alike.
 */
/**
 * A document as the browser prints it, page by page: `page.pdf` on WPT's
 * default paper, rasterised by `pdftoppm` at 96dpi so a page is as many pixels
 * as it is CSS pixels. Both sides of a native comparison go through this, so
 * the raster is the same on each.
 */
async function nativeShots(context, url) {
  const page = await context.newPage();
  const dir = await mkdtemp(join(tmpdir(), "wpt-print-"));
  try {
    await page.emulateMedia({ media: "print" });
    await page.goto(url, { waitUntil: "load" });
    await reftestWait(page);
    await page.pdf({
      path: join(dir, "out.pdf"),
      width: "5in",
      height: "3in",
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      preferCSSPageSize: true,
      printBackground: true,
    });
    execFileSync("pdftoppm", ["-r", "96", "-png", join(dir, "out.pdf"), join(dir, "page")]);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const shots = await Promise.all(files.map(async (f) => PNG.sync.read(await readFile(join(dir, f)))));
    return { total: shots.length, shots };
  } finally {
    await page.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

const printed = new Map();
async function nativePages(url) {
  if (printed.has(url)) return printed.get(url);
  const page = await (await oracle()).newPage();
  try {
    await page.emulateMedia({ media: "print" });
    await page.goto(url, { waitUntil: "load" });
    await reftestWait(page);
    const pdf = (
      await page.pdf({
        width: "5in",
        height: "3in",
        margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
        preferCSSPageSize: true,
      })
    ).toString("latin1");
    const count = (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    printed.set(url, count);
    return count;
  } finally {
    await page.close().catch(() => {});
  }
}

let oracleContext = null;
async function oracle() {
  oracleContext ??= await (await chromium.launch()).newContext();
  return oracleContext;
}

/**
 * Compare two paginations: page count first, then each page's pixels. Each
 * side is already cut down to the pages its own file asks to compare.
 */
function comparePages(test, ref, fuzz, native) {
  if (test.missing !== null) return `page ${test.missing} asked for, the test has ${test.total}`;
  // Two empty paginations are identical and prove nothing.
  if (test.shots.length === 0) return "no pages";
  if (ref.shots.length !== native) {
    return `reference is ${ref.shots.length} pages, the browser prints it on ${native}`;
  }
  if (test.shots.length !== ref.shots.length) {
    return `${test.shots.length} pages, reference has ${ref.shots.length}`;
  }
  const bad = [];
  for (let i = 0; i < test.shots.length; i++) {
    const a = test.shots[i];
    const b = ref.shots[i];
    if (a.width !== b.width || a.height !== b.height) {
      return `page ${i + 1} is ${a.width}×${a.height}, reference ${b.width}×${b.height}`;
    }
    const differ = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
    if (differ > fuzz) bad.push(`${differ}px on page ${i + 1}`);
  }
  return bad.length === 0 ? null : bad.join(", ");
}

/** Test pages above, reference pages below, side by side per page. */
async function writeShots(test, a, b) {
  const all = [...a.shots, ...b.shots];
  const width = Math.max(1, ...a.shots.map((p) => p.width)) + Math.max(1, ...b.shots.map((p) => p.width)) + 8;
  const rows = Math.max(a.shots.length, b.shots.length);
  const rowHeight = Math.max(1, ...all.map((p) => p.height)) + 8;
  const out = new PNG({ width, height: rows * rowHeight });
  out.data.fill(128);
  const colB = Math.max(1, ...a.shots.map((p) => p.width)) + 8;
  const blit = (img, x0, y0) => PNG.bitblt(img, out, 0, 0, img.width, img.height, x0, y0);
  a.shots.forEach((img, i) => blit(img, 0, i * rowHeight));
  b.shots.forEach((img, i) => blit(img, colB, i * rowHeight));
  await mkdir(shotsDir, { recursive: true });
  await writeFile(join(shotsDir, test.replace(/\//g, "__") + ".png"), PNG.sync.write(out));
}

/** Keep the pages a file asks to compare. */
function select(run, html) {
  const keep = pagesOf(html, run.shots.length);
  // Asking for page 2 of a one-page result is a mismatch, not an empty one.
  const beyond = (rangesOf(html) ?? []).find(([lo]) => lo > run.shots.length);
  const missing = beyond === undefined ? null : beyond[0];
  return { ...run, shots: keep.map((n) => run.shots[n - 1]), missing };
}

// --- Run -------------------------------------------------------------------

const bundle = join(here, ".bundle/folio.js");
if (nativePrint && pick !== "chromium") throw new Error("--native-print is Chromium's alone: page.pdf");
if (withFolio) await import("./bundle.mjs");
const served = withFolio || nativePrint ? await serveWpt() : null;
const paginatedMode = withFolio || nativePrint;

const results = {};
for (const name of pick === "all" ? Object.keys(engines) : [pick]) {
  const browser = await engines[name].launch();
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  const engineResults = { pass: [], fail: [], skipped: [] };

  for (const test of manifest.tests.filter((t) => t.includes(filter))) {
    // Each mode runs the half of the manifest it can score; see the header.
    if (paginatedMode !== isPrint(test)) {
      engineResults.skipped.push({
        test,
        why: paginatedMode ? "continuous media: says nothing about pagination" : "paginated: run with --folio",
      });
      continue;
    }

    const testFile = await ensure(test);
    if (testFile === null) {
      engineResults.skipped.push({ test, why: "test not fetched" });
      continue;
    }
    const html = await readFile(testFile, "utf8");
    const refPath = referenceOf(html, test);
    if (refPath === null) {
      // Not a reftest: testharness.js tests need a harness we do not have,
      // and GCPM's are manual — "test passes if…", read by a person.
      engineResults.skipped.push({ test, why: "no <link rel=match>" });
      continue;
    }
    const refFile = await ensure(refPath);
    if (refFile === null) {
      engineResults.skipped.push({ test, why: `reference missing: ${refPath}` });
      continue;
    }

    try {
      if (nativePrint) {
        const refHtml = await readFile(refFile, "utf8");
        const a = select(await nativeShots(context, `${served.origin}/${test}`), html);
        const b = select(await nativeShots(context, `${served.origin}/${refPath}`), refHtml);
        // The reference is the browser's own print, so it is its own oracle.
        const why = comparePages(a, b, fuzzOf(html), b.shots.length);
        if (why === null) engineResults.pass.push(test);
        else engineResults.fail.push({ test, why });
        if (why !== null && shotsDir !== "") await writeShots(test, a, b);
        if (verbose) console.log(`  ${why === null ? "pass" : "FAIL"}  ${test}${why === null ? "" : `  ${why}`}`);
        continue;
      }
      if (withFolio) {
        const refHtml = await readFile(refFile, "utf8");
        const a = select(await paginated(context, `${served.origin}/${test}`, bundle), html);
        const b = select(await paginated(context, `${served.origin}/${refPath}`, bundle), refHtml);
        const native = pagesOf(refHtml, await nativePages(`${served.origin}/${refPath}`)).length;
        const why = comparePages(a, b, fuzzOf(html), native);
        if (why === null) engineResults.pass.push(test);
        else engineResults.fail.push({ test, why });
        if (why !== null && shotsDir !== "") await writeShots(test, a, b);
        if (verbose) console.log(`  ${why === null ? "pass" : "FAIL"}  ${test}${why === null ? "" : `  ${why}`}`);
        continue;
      }

      const a = await shoot(page, testFile, false);
      const b = await shoot(page, refFile, false);
      if (a.width !== b.width || a.height !== b.height) {
        engineResults.fail.push({ test, why: "size differs" });
        continue;
      }
      const diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
      if (diff === 0) engineResults.pass.push(test);
      else engineResults.fail.push({ test, why: `${diff} pixels differ` });
    } catch (error) {
      const why = String(error).split("\n")[0].slice(0, 120);
      engineResults.fail.push({ test, why });
      if (verbose) console.log(`  FAIL  ${test}  ${why}`);
    }
  }

  await browser.close();
  results[name] = engineResults;
  const total = engineResults.pass.length + engineResults.fail.length;
  console.log(
    `${name.padEnd(9)} ${String(engineResults.pass.length).padStart(3)}/${String(total).padEnd(3)} pass` +
      `   ${engineResults.skipped.length} skipped`,
  );
}
served?.server.close();
await oracleContext?.browser()?.close();

const out = join(
  here,
  withFolio ? "wpt-results-folio.json" : nativePrint ? "wpt-results-native-print.json" : "wpt-results.json",
);
await writeFile(
  out,
  JSON.stringify({ commit: manifest.commit, folio: withFolio, nativePrint, results }, null, 2) + "\n",
);
console.log(`\nreport -> ${out}`);
