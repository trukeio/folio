/**
 * The deletion-condition gate of `doc/plan.md` §8: may a polyfill module go?
 *
 * Each module in core names the WPT tests that decide it (`deletion.ts`).
 * This reads those names against native WPT runs — the browser alone, no
 * engine — and says, per module and per target browser, whether every test
 * passes. A module is deletable when every target browser passes every one.
 *
 * The evidence, as `wpt.mjs` writes it:
 *   wpt-results.json               bare run, continuous-media tests, any engine
 *   wpt-results-native-print.json  `--native-print`, the `-print` tests, Chromium
 * CI downloads each engine's files into one directory; pass it as --results.
 *
 * A test with no result on an engine is "unknown" there, and an unknown is
 * never a pass: Firefox and WebKit cannot print from Playwright, so a module
 * decided by `-print` tests cannot be shown deletable on them by CI, and the
 * report says so rather than guessing. A module that names no test says why
 * (`untested`) and is decided by a person.
 *
 * Exit status 1 when some module is deletable, so the workflow fails loudly
 * and someone deletes it; 0 otherwise.
 *
 *   node packages/test/deletion.mjs [--results dir] [--json out.json]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const here = new URL("./", import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const dir = flag("results", here);
const jsonOut = flag("json", "");

/** The browsers a module must be native in before it goes (`plan.md`, the floor). */
const TARGETS = ["chromium", "firefox", "webkit"];

await import("./bundle.mjs");
const { polyfills } = await import("./.bundle/folio.mjs");
const manifest = JSON.parse(await readFile(join(here, "wpt-manifest.json"), "utf8"));

/** engine → test → "pass" | "fail", from every results file found. */
const seen = Object.fromEntries(TARGETS.map((e) => [e, new Map()]));
const files = [];
async function collect(d) {
  for (const name of await readdir(d, { withFileTypes: true })) {
    const path = join(d, name.name);
    if (name.isDirectory() && !name.name.startsWith(".") && name.name !== "node_modules") await collect(path);
    else if (/^wpt-results(-native-print)?\.json$/.test(name.name)) files.push(path);
  }
}
if (existsSync(dir)) await collect(dir);
for (const file of files) {
  const run = JSON.parse(await readFile(file, "utf8"));
  if (run.folio) continue; // the engine's own run is not native evidence
  if (run.commit !== manifest.commit) {
    console.warn(`skipping ${file}: WPT ${run.commit.slice(0, 8)}, pinned ${manifest.commit.slice(0, 8)}`);
    continue;
  }
  for (const [engine, r] of Object.entries(run.results)) {
    const into = seen[engine];
    if (into === undefined) continue;
    for (const t of r.pass) into.set(t, "pass");
    for (const f of r.fail) into.set(f.test, "fail");
  }
}

const report = polyfills.map((p) => {
  const tests = manifest.tests.filter((t) => p.tests.some((re) => re.test(t)));
  const engines = Object.fromEntries(
    TARGETS.map((engine) => {
      const status = tests.map((t) => seen[engine].get(t) ?? "unknown");
      return [
        engine,
        {
          pass: status.filter((s) => s === "pass").length,
          fail: status.filter((s) => s === "fail").length,
          unknown: status.filter((s) => s === "unknown").length,
        },
      ];
    }),
  );
  const verdict =
    tests.length === 0
      ? "a person decides"
      : TARGETS.every((e) => engines[e].pass === tests.length)
        ? "DELETABLE"
        : TARGETS.some((e) => engines[e].fail > 0)
          ? "not yet"
          : "unknown";
  return { name: p.name, files: p.files, when: p.when, untested: p.untested ?? null, tests: tests.length, engines, verdict };
});

const cell = (c, n) => (n === 0 ? "—" : `${c.pass}/${n}${c.unknown > 0 ? ` (${c.unknown}?)` : ""}`);
console.log(`evidence: ${files.length === 0 ? "none found" : files.map((f) => f.replace(here, "")).join(", ")}\n`);
console.log(`${"module".padEnd(20)} ${"tests".padStart(5)}  ${TARGETS.map((e) => e.padEnd(12)).join(" ")} verdict`);
for (const r of report) {
  console.log(
    `${r.name.padEnd(20)} ${String(r.tests).padStart(5)}  ${TARGETS.map((e) => cell(r.engines[e], r.tests).padEnd(12)).join(" ")} ${r.verdict}`,
  );
}
console.log("\n(n?) is how many of a module's tests have no native result on that engine: unknown, never a pass.");
for (const r of report.filter((r) => r.verdict === "a person decides")) console.log(`  ${r.name}: ${r.untested}`);

if (jsonOut !== "") await writeFile(jsonOut, JSON.stringify({ commit: manifest.commit, report }, null, 2) + "\n");
const deletable = report.filter((r) => r.verdict === "DELETABLE");
if (deletable.length > 0) {
  console.log(`\nDeletable now: ${deletable.map((r) => `${r.name} (${r.files.join(", ")})`).join("; ")}.`);
  process.exit(1);
}
