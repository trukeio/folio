/**
 * M1's exit check: run the Paged.js corpus through our engine.
 *
 * `baseline.mjs` measured Paged.js on the same fixtures (M0.2). This measures
 * us, in the same terms, so the two can be compared: page counts, and which
 * source element put how much text on which page.
 *
 * The properties of `doc/plan.md` §9 are checked per fixture — every character
 * exactly once, nothing overflowing — because a differential result is only
 * interesting once the invariants hold.
 *
 *   node packages/test/paginate-corpus.mjs [--engine chromium] [--filter x]
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { globSync } from "node:fs";
import { join } from "node:path";

const engines = { chromium, firefox, webkit };
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

const engineName = flag("engine", "chromium");
const filter = flag("filter", "");
const limit = Number(flag("limit", "0"));
const here = new URL("./", import.meta.url).pathname;
const corpus = join(here, "fixtures/corpus");
const port = Number(process.env.FIXTURE_PORT ?? 5177);

const bundle = await readFile(join(here, ".bundle/folio.js"), "utf8");

/** Runs in the page: paginate with our engine and report placements. */
const PAGINATE = async () => {
  const t = window.folio;
  const source = document.body;
  const doc = await t.normalize(document);
  const frame = t.createEngineFrame(document);
  const target = frame.contentDocument;

  const style = target.createElement("style");
  // No `body { margin: 0 }`: the source is `body`, and the UA's 8px margin is
  // on its pages as CSS says (`doc/review.md` §3.6); the frame's own body
  // is pinned by `createEngineFrame`.
  style.textContent = doc.authorCss;
  target.head.append(style);
  await target.fonts.ready;

  // How many notes the source has, counted as the engine finds them, so a
  // note numbered twice (or lost) shows up: the content check below leaves
  // note areas out.
  const probe = target.importNode(source, true);
  target.body.append(probe);
  const sourceNotes = t.extractFootnotes(probe, target.defaultView, 1).length;
  probe.remove();

  const { records, pages, overflowed, running, footnotes } = t.paginate({
    source,
    pageRules: doc.pageRules,
    target,
    maxPages: 300,
  });

  // `position: running()` moves an element out of the flow and into margin
  // boxes, so the flow legitimately no longer holds its text. The expected
  // text is the source minus exactly those elements — which is a stronger
  // check than ignoring the difference, because anything else that goes
  // missing still fails.
  const expected = source.cloneNode(true);
  // Resolve every path before removing anything: a removal shifts the
  // childNodes indices after it, so removing as we go makes the second path
  // point at whatever moved into its place.
  // Footnotes move to the foot of their page, so the flow no longer holds
  // their text *in that place*. Both sides drop them, and a separate check
  // below says the notes were placed — together that is stronger than
  // comparing the text as a bag of characters, which would pass even if a
  // note landed on the wrong page.
  const doomed = [];
  for (const el of [...running.values(), ...footnotes]) {
    const raw = el.getAttribute("data-folio-path");
    if (raw === null) continue;
    let node = expected;
    for (const i of raw.split(".").filter((p) => p !== "").map(Number)) {
      node = node?.childNodes[i];
    }
    if (node !== undefined && node !== null) doomed.push(node);
  }
  for (const node of doomed) node.remove();

  const nonWhitespace = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .reduce((s, n) => s + n.data.replace(/\s+/g, "").length, 0);

  /**
   * Text laid out outside the page's content area, in either axis.
   *
   * The same measurement `baseline.mjs` takes of Paged.js, so the two sides
   * can be compared: a page count means nothing on its own if one engine gets
   * it by dropping content off the page (`doc/differential.md`). Ours has no
   * column trick to hide anything in, so this should stay at zero — which is
   * what makes it worth asserting.
   */
  const lostOf = (area) => {
    const rect = area.getBoundingClientRect();
    const walker = target.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let lines = 0;
    let past = 0;
    // How far down the area the ink actually reaches, so "fewer pages" can be
    // told apart from "fuller pages".
    let fill = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const range = target.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue;
        const out = Math.max(r.right - rect.right, r.bottom - rect.bottom);
        if (out > 1) {
          lines += 1;
          past = Math.max(past, out);
        } else {
          fill = Math.max(fill, r.bottom - rect.top);
        }
      }
    }
    return { lines, past: Math.round(past * 10) / 10, fill: Math.round(fill) };
  };

  const placements = pages.map((box, index) => ({
    index,
    lost: lostOf(box),
    items: [...box.querySelectorAll("[data-folio-path]")]
      .map((el) => {
        const raw = el.getAttribute("data-folio-path");
        const path = raw === "" ? [] : raw.split(".").map(Number);
        const elementPath = t.elementPath(source, { path, offset: 0, after: false });
        return { path: elementPath === null ? null : elementPath.join("."), chars: nonWhitespace(el) };
      })
      .filter((it) => it.path !== null && it.chars > 0),
  }));

  return {
    pageCount: records.length,
    overflowed,
    pages: placements,
    // The §9 content property, measured the same way the baseline measures it.
    // The flow, minus what the engine generated or repeated on purpose.
    // Footnote calls and markers are numbers the source never had; a repeated
    // table header is source text appearing on several pages by design. Both
    // look exactly like a content-check failure, and neither is one.
    pageText: pages
      .map((p) => {
        const clone = p.cloneNode(true);
        for (const el of clone.querySelectorAll(
          `[data-folio-repeated], .${t.CALL_CLASS}, .${t.MARKER_CLASS}, .${t.AREA_CLASS}`,
        )) {
          el.remove();
        }
        return clone.textContent;
      })
      .join("")
      .replace(/\s+/g, ""),
    sourceText: expected.textContent.replace(/\s+/g, ""),
    runningCount: running.size,
    // Every note that left the flow is at the foot of some page.
    footnotesPlaced: footnotes.length,
    // Distinct numbers: a note split across pages is one note.
    footnotesAsSource: new Set(footnotes.map((n) => n.dataset.footnote)).size === sourceNotes,
    footnoteTextOk: footnotes.every((note) => {
      const area = note.closest(`.${t.AREA_CLASS}`);
      return area !== null && note.textContent.trim() !== "";
    }),
  };
};

const fixtures = globSync("specs/**/*.html", { cwd: corpus })
  .filter((f) => f !== "specs/index.html")
  .filter((f) => f.includes(filter))
  .sort()
  .slice(0, limit > 0 ? limit : undefined);

const browser = await engines[engineName].launch();
const results = [];
const failures = [];

for (const fixture of fixtures) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  try {
    // The fixtures load Paged.js. We are the engine under test, so it must not
    // run: serve an empty script in its place.
    await page.route("**/paged.polyfill.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.goto(`http://127.0.0.1:${port}/corpus/${fixture}`, { timeout: 15000 });
    await page.addScriptTag({ content: bundle });

    const result = await page.evaluate(PAGINATE);
    const contentOk = result.pageText === result.sourceText;

    results.push({
      spec: fixture,
      pageCount: result.pageCount,
      contentOk,
      footnotesPlaced: result.footnotesPlaced,
      footnoteTextOk: result.footnoteTextOk,
      footnotesAsSource: result.footnotesAsSource,
      lost: result.sourceText.length - result.pageText.length,
      overflowed: result.overflowed,
      pages: result.pages,
    });
    process.stdout.write(
      `  ${String(result.pageCount).padStart(3)}p ${contentOk ? " ok " : "LOST"}` +
        `${result.overflowed.length > 0 ? " OVER" : "     "} ${fixture}\n`,
    );
  } catch (error) {
    const why = String(error).split("\n")[0].slice(0, 70);
    failures.push({ spec: fixture, error: why });
    process.stdout.write(`    ??      ${fixture}  (${why})\n`);
  } finally {
    await page.close();
  }
}
await browser.close();

await mkdir(join(here, "baselines"), { recursive: true });
const out = join(here, `baselines/folio-${engineName}.json`);
await writeFile(out, JSON.stringify({ engine: engineName, results, failures }, null, 2) + "\n");

const ok = results.filter((r) => r.contentOk).length;
const over = results.filter((r) => r.overflowed.length > 0);

console.log(
  `\n${results.length} paginated, ${failures.length} failed; content property holds on ${ok}/${results.length}`,
);
// §9 has two invariants, not one. Reporting only the content property let a
// run with three overflowing pages read as a clean pass.
const notesBroken = results.filter((r) => r.footnotesPlaced > 0 && !r.footnoteTextOk);
console.log(`specs with footnotes: ${results.filter((r) => r.footnotesPlaced > 0).length}` +
  `, all notes in a note area: ${notesBroken.length === 0}` +
  `, as many notes as the source: ${results.every((r) => r.footnotesAsSource)}`);
console.log(`pages that overflowed their area: ${over.length} spec(s)`);
for (const r of over) console.log(`  ${r.spec} pages ${r.overflowed.join(", ")}`);
