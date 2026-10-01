/**
 * M0.2: vendor the Paged.js spec corpus.
 *
 * Paged.js is MIT, so its specs can be reused directly as fixtures
 * (`doc/plan.md` §1). They are the differential baseline of layer 4: every
 * difference between our pagination and theirs is either a bug or a documented
 * improvement, and neither can be claimed without a baseline to compare to.
 *
 * Fixtures are copied byte-for-byte. Their `<script src=".../paged.polyfill.js">`
 * is left as-is and intercepted at request time by the runner, so a fixture in
 * this repo is the same file as the fixture upstream.
 *
 *   node packages/test/vendor-corpus.mjs [path-to-pagedjs-checkout]
 */
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const source = process.argv[2] ?? "/files/go/src/github.com/pagedjs/pagedjs";
const dest = new URL("./fixtures/corpus/", import.meta.url).pathname;

// Excluded: jest's own machinery, and 16 MB of per-engine image snapshots we
// have no use for — layer 2 is structural, and screenshots are for margin
// boxes and marks only (plan.md §9).
const skip = new Set(["__image_snapshots__", "jest_helpers", "jest.config.js"]);

const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

await cp(join(source, "specs"), join(dest, "specs"), {
  recursive: true,
  filter: (src) => {
    const name = src.split("/").pop() ?? "";
    return !skip.has(name) && !name.endsWith(".spec.js");
  },
});
await cp(join(source, "LICENSE.md"), join(dest, "LICENSE.md"));

await writeFile(
  join(dest, "PROVENANCE.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, license: pkg.license, commit, vendored: new Date().toISOString().slice(0, 10) },
    null,
    2,
  ) + "\n",
);

console.log(`vendored ${pkg.name}@${pkg.version} (${commit.slice(0, 8)})`);
