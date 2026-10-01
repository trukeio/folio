/**
 * M0.3: the multicol spike (`doc/milestones.md`, `doc/plan.md` §3).
 *
 * The question: give one column the page height and let the browser place the
 * breaks. If the browser will decide them, stage 3 shrinks to reading them
 * back. If it will not, we decide breaks in JS and multicol is only a
 * measuring device, which is how Vivliostyle uses it.
 *
 * Six things have to be true for a go, and this asks each one on three engines:
 *
 *   1. read-back   - we can tell which column a given element landed in
 *   2. forced      - break-before is honoured
 *   3. avoid       - break-inside: avoid is honoured
 *   4. widows      - widows/orphans are honoured
 *   5. text-offset - we can recover *where in the text* the break fell
 *   6. math        - an <mtable>-composed equation fragments rather than clips
 *
 * A "no" on 1 or 5 is fatal: without a position there is nothing to compose a
 * page from. A "no" on 2-4 means the penalties of §3 stay in JS regardless.
 *
 *   node packages/test/spike-multicol.mjs [--engine chromium|firefox|webkit|all]
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";

const all = { chromium, firefox, webkit };
const args = process.argv.slice(2);
const pick = args.includes("--engine") ? args[args.indexOf("--engine") + 1] : "all";
const engines = pick === "all" ? Object.keys(all) : [pick];
const port = Number(process.env.FIXTURE_PORT ?? 5177);

const COLUMN = 400;
const GAP = 40;

/** Everything is measured in the page; this returns plain data. */
const PROBE = ({ column, gap }) => {
  const flow = document.getElementById("flow");
  globalThis.buildSpikeContent(flow);

  const origin = flow.getBoundingClientRect().left;

  // Measure the pitch rather than assuming it: the browser decides the column
  // width, and an assumed pitch silently reports breaks that did not happen.
  const probeRects = [...document.getElementById("p2").getClientRects()];
  const measuredPitch =
    probeRects.length > 1
      ? Math.round(probeRects[1].left - probeRects[0].left)
      : column + gap;
  // floor, not round: a rect near a column's right edge is past the midpoint
  // of the column pitch and rounds into the *next* column, which silently
  // reports breaks that did not happen.
  const columnOf = (x) => Math.floor((x - origin) / measuredPitch);

  // 1. read-back: which column did each stamped element land in?
  const placed = {};
  for (const el of flow.querySelectorAll("[id]")) {
    const rects = [...el.getClientRects()];
    if (rects.length === 0) continue;
    placed[el.id] = {
      columns: [...new Set(rects.map((r) => columnOf(r.left)))].sort((a, b) => a - b),
      rects: rects.length,
    };
  }

  // 5. text-offset: for a paragraph that spans two columns, can we recover the
  // character offset where it broke? Walk line boxes and find the first line
  // that starts in a later column than the previous one.
  const splitOffset = (id) => {
    const el = document.getElementById(id);
    const text = el.firstChild;
    if (!text || text.nodeType !== 3) return null;
    const range = document.createRange();
    let prevColumn = null;
    // Binary search would be the real implementation; linear is fine for a spike.
    for (let i = 1; i <= text.data.length; i++) {
      range.setStart(text, i - 1);
      range.setEnd(text, i);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const col = columnOf(rect.left);
      if (prevColumn !== null && col !== prevColumn) {
        return { offset: i - 1, fromColumn: prevColumn, toColumn: col };
      }
      prevColumn = col;
    }
    return null;
  };

  // 6. math: does the equation fragment, or does it overflow its column?
  const eq = document.getElementById("eq1");
  const eqRects = [...eq.getClientRects()];
  const flowHeight = flow.getBoundingClientRect().height;
  const mathResult = {
    fragments: eqRects.length,
    columns: [...new Set(eqRects.map((r) => columnOf(r.left)))].sort((a, b) => a - b),
    height: Math.round(eq.getBoundingClientRect().height),
    columnHeight: Math.round(flowHeight),
    rows: eq.querySelectorAll("mtr").length,
    rowColumns: [
      ...new Set(
        [...eq.querySelectorAll("mtr")]
          .map((r) => r.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .map((r) => columnOf(r.left)),
      ),
    ].sort((a, b) => a - b),
  };

  const columnCount = Math.max(...Object.values(placed).flatMap((p) => p.columns)) + 1;

  // Is widows/orphans honoured, or does the browser break greedily? Render the
  // same content with widows:1 and widows:4 and compare where the break fell.
  // Asking "did the result satisfy widows" cannot tell an honoured constraint
  // from a lucky one; changing it and watching the break move can.
  const linesInFirstFragment = (id) => {
    const el = document.getElementById(id);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()];
    if (rects.length === 0) return null;
    const firstColumn = columnOf(rects[0].left);
    return rects.filter((r) => columnOf(r.left) === firstColumn).length;
  };

  // Same A/B for break-inside: avoid. A block that happens to fit proves
  // nothing; a block that splits with `auto` and stops splitting with `avoid`
  // proves the constraint is honoured.
  const box = document.getElementById("box");
  const avoidFlow = document.getElementById("avoidflow");
  box.style.breakInside = "auto";
  void avoidFlow.offsetHeight;
  const avoidAuto = box.getClientRects().length;
  box.style.breakInside = "avoid";
  void avoidFlow.offsetHeight;
  const avoidAvoid = box.getClientRects().length;
  box.style.breakInside = "";

  const wo = document.getElementById("wo1");
  wo.style.widows = "1";
  wo.style.orphans = "1";
  void flow.offsetHeight;
  const greedy = linesInFirstFragment("wo1");
  wo.style.widows = "4";
  wo.style.orphans = "4";
  void flow.offsetHeight;
  const constrained = linesInFirstFragment("wo1");
  wo.style.widows = "";
  wo.style.orphans = "";

  return {
    measuredPitch,
    avoidHonoured: avoidAuto > 1 && avoidAvoid === 1,
    avoidFragmentsAuto: avoidAuto,
    avoidFragmentsAvoid: avoidAvoid,
    widowsHonoured: greedy !== constrained,
    widowsGreedyLines: greedy,
    widowsConstrainedLines: constrained,
    columnCount,
    placed,
    forcedHeadingColumn: placed["forced1"]?.columns ?? null,
    // A forced break is only honoured if the heading starts a column. Landing
    // in one proves nothing; landing at its top does.
    forcedTopDelta: (() => {
      const h = document.getElementById("forced1").getBoundingClientRect();
      const first = [...document.getElementById("p1").getClientRects()][0];
      return Math.round(h.top - first.top);
    })(),
    avoidColumns: placed["avoid1"]?.columns ?? null,
    woColumns: placed["wo1"]?.columns ?? null,
    woLineCount: (() => {
      const el = document.getElementById("wo1");
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].length;
    })(),
    splitOffset: splitOffset("wo1") ?? splitOffset("p1"),
    math: mathResult,
  };
};

await mkdir(new URL("./spike/", import.meta.url).pathname, { recursive: true });
const report = {};

for (const name of engines) {
  const browser = await all[name].launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/spike/multicol.html`);
  await page.addScriptTag({ url: "/spike/content.js" });
  await page.evaluate(async () => {
    await document.fonts.load('1em "STIX Two Text"');
    await document.fonts.load('1em "STIX Two Math"');
    await document.fonts.ready;
  });
  report[name] = { version: browser.version(), ...(await page.evaluate(PROBE, { column: COLUMN, gap: GAP })) };
  await browser.close();
}

const out = new URL("./spike/multicol-report.json", import.meta.url).pathname;
await writeFile(out, JSON.stringify(report, null, 2) + "\n");

// A table, because the whole point is comparing engines.
const row = (label, fn) =>
  `${label.padEnd(22)} ${engines.map((e) => String(fn(report[e])).padEnd(22)).join("")}`;
console.log(`${"".padEnd(22)} ${engines.map((e) => e.padEnd(22)).join("")}`);
console.log(row("measured pitch", (r) => r.measuredPitch));
console.log(row("columns produced", (r) => r.columnCount));
console.log(row("forced break -> col", (r) => `${JSON.stringify(r.forcedHeadingColumn)} +${r.forcedTopDelta}px from top`));
console.log(row("avoid block cols", (r) => JSON.stringify(r.avoidColumns)));
console.log(row("avoid honoured", (r) => `${r.avoidHonoured} (${r.avoidFragmentsAuto} vs ${r.avoidFragmentsAvoid} frags)`));
console.log(row("widows para cols", (r) => JSON.stringify(r.woColumns)));
console.log(row("widows para lines", (r) => r.woLineCount));
console.log(row("widows honoured", (r) => `${r.widowsHonoured} (${r.widowsGreedyLines} vs ${r.widowsConstrainedLines})`));
console.log(row("split offset", (r) => JSON.stringify(r.splitOffset)));
console.log(row("math cols", (r) => JSON.stringify(r.math.columns)));
console.log(row("math rows/cols", (r) => `${r.math.rows} rows -> ${JSON.stringify(r.math.rowColumns)}`));
console.log(row("math h vs column h", (r) => `${r.math.height} / ${r.math.columnHeight}`));
console.log(row("math fragments?", (r) => (r.math.fragments > 1 ? `yes (${r.math.fragments})` : "NO - one box")));
console.log(`\nreport -> ${out}`);
