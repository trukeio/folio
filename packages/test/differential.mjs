/**
 * Layer 4: compare our pagination against Paged.js (`doc/plan.md` §9).
 *
 * "Every difference is either a bug or a documented improvement." This does
 * not judge which; it produces the list to be triaged, sorted so the largest
 * disagreements come first.
 *
 * Both sides were measured in the same browser on the same machine, which
 * matters: the baseline is not portable (M0.2), so the comparison has to be
 * made from two runs of the same environment.
 *
 *   node packages/test/differential.mjs [--engine chromium]
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const engine = args.includes("--engine") ? args[args.indexOf("--engine") + 1] : "chromium";
const dir = new URL("./baselines/", import.meta.url).pathname;

const read = async (name) => {
  const path = `${dir}${name}`;
  if (!existsSync(path)) throw new Error(`missing ${path} — run the matching runner first`);
  return JSON.parse(await readFile(path, "utf8"));
};

const theirs = await read(`pagedjs-${engine}.json`);
const ours = await read(`folio-${engine}.json`);

const byCorpus = new Map(theirs.results.map((r) => [r.spec, r]));
const rows = [];

for (const mine of ours.results) {
  const base = byCorpus.get(mine.spec);
  if (base === undefined) continue;

  // Which page each source element first appears on, on each side.
  const firstPage = (pages) => {
    const map = new Map();
    for (const page of pages) {
      for (const item of page.items) {
        if (!map.has(item.path)) map.set(item.path, page.index);
      }
    }
    return map;
  };

  const a = firstPage(base.pages);
  const b = firstPage(mine.pages);
  const shared = [...a.keys()].filter((p) => b.has(p));
  const moved = shared.filter((p) => a.get(p) !== b.get(p));

  rows.push({
    spec: mine.spec,
    theirPages: base.pageCount,
    ourPages: mine.pageCount,
    contentOk: mine.contentOk,
    sharedElements: shared.length,
    movedElements: moved.length,
    onlyOurs: [...b.keys()].filter((p) => !a.has(p)).length,
    onlyTheirs: [...a.keys()].filter((p) => !b.has(p)).length,
  });
}

const same = rows.filter((r) => r.theirPages === r.ourPages).length;
const contentHolds = rows.filter((r) => r.contentOk).length;

console.log(`corpus specs compared: ${rows.length}`);
console.log(`content property holds (ours): ${contentHolds}/${rows.length}`);
console.log(`same page count as Paged.js:   ${same}/${rows.length}`);
console.log();

const worst = rows
  .filter((r) => r.theirPages !== r.ourPages || r.movedElements > 0)
  .sort((x, y) => Math.abs(y.ourPages - y.theirPages) - Math.abs(x.ourPages - x.theirPages))
  .slice(0, 20);

console.log(`${"spec".padEnd(58)} ${"theirs".padStart(6)}${"ours".padStart(6)}${"moved".padStart(7)}`);
for (const r of worst) {
  console.log(
    `${r.spec.slice(0, 58).padEnd(58)} ${String(r.theirPages).padStart(6)}${String(r.ourPages).padStart(6)}${String(r.movedElements).padStart(7)}`,
  );
}
