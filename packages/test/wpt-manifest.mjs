/**
 * Build the WPT manifest: pick the tests, pin the commit.
 *
 *   node packages/test/wpt-manifest.mjs            # keep the pinned commit
 *   node packages/test/wpt-manifest.mjs --latest   # re-pin to WPT master
 *
 * WPT is not vendored. It is BSD-3 and could be, but `css-break` and
 * `css-page` alone are ~1000 files that change upstream continuously, and the
 * value here is "what do browsers support *now*" rather than a frozen copy.
 * So the manifest pins a commit and the runner fetches on demand into a cache
 * that is not committed.
 *
 * Re-pinning is a separate decision from re-selecting: the native results in
 * `doc/native-support.md` were measured at the pinned commit, and a new pin
 * makes them a measurement of different tests.
 */
import { readFile, writeFile } from "node:fs/promises";

const REPO = "https://api.github.com/repos/web-platform-tests/wpt";
const path = new URL("./wpt-manifest.json", import.meta.url).pathname;
const latest = process.argv.includes("--latest");

const commit = latest
  ? (await (await fetch(`${REPO}/commits/master?per_page=1`)).json()).sha
  : JSON.parse(await readFile(path, "utf8")).commit;

const listing = async (dir) => {
  const res = await fetch(`${REPO}/contents/${dir}?ref=${commit}`);
  if (!res.ok) throw new Error(`${dir}: ${res.status}`);
  return (await res.json())
    .filter((e) => e.type === "file" && e.name.endsWith(".html"))
    .map((e) => `${dir}/${e.name}`);
};

// Fragmentation first: these are the rows of the feature map (plan.md §4) whose
// tier is F, and the ones §8 wants deletion conditions for. Reftests only -
// a testharness.js test needs a harness we do not have yet.
const WANTED = [
  /break-(before|after)-\d/,
  /break-inside-avoid/,
  /widows-orphans/,
  /box-decoration-break/,
  /margin-break/,
  // Paginated reftests (M6). A bare browser cannot be scored on these; with
  // the engine loaded (`wpt.mjs --folio`) they are the tests that say
  // whether *we* are right, which is what a deletion condition needs.
  /-print(\.tentative)?\.html$/,
  // GCPM: `leader()`, `string-set`. Manual tests upstream — no reference to
  // compare against — so the runner records them rather than scoring them.
  /^css\/css-gcpm\//,
];

const all = [
  ...(await listing("css/css-break")),
  ...(await listing("css/css-page")),
  ...(await listing("css/css-page/margin-boxes")),
  ...(await listing("css/css-gcpm")),
];
const tests = all
  .filter((p) => WANTED.some((re) => re.test(p)))
  // A reference is not a test, and a crashtest asserts only that nothing
  // crashed - neither has a <link rel=match> to compare against.
  .filter((p) => !/-(ref|notref)\.html$/.test(p) && !p.includes("crash"))
  .sort();

await writeFile(
  path,
  JSON.stringify({ commit, generated: new Date().toISOString().slice(0, 10), tests }, null, 2) + "\n",
);
console.log(`${tests.length} tests pinned at ${commit.slice(0, 8)}`);
