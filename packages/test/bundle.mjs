/**
 * Build @truke/folio into one script the browser tests can inject.
 *
 * Browser tests of engine code need the engine *in the page*. Passing a
 * function through `page.evaluate` only works while that function is entirely
 * self-contained — the moment it calls a module-scope helper it fails in the
 * page with a ReferenceError, which is a trap that looks like a test failure.
 * So: bundle once, inject, and call `window.folio` like any other library.
 */
import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { temmlWithoutMhchem } from "../../scripts/temml-without-mhchem.mjs";

const out = new URL("./.bundle/folio.js", import.meta.url).pathname;
const viewerOut = new URL("./.bundle/viewer.js", import.meta.url).pathname;
/** The Paged.js drop-in (M5.1): the file a project's script tag points at. */
const polyfillOut = new URL("./.bundle/folio.polyfill.js", import.meta.url).pathname;
/** The TeX front end's script tag (`doc/tex.md` §2), and the engine as a
 * module, which is how `examples/math/` loads it. */
const texOut = new URL("./.bundle/folio-tex.js", import.meta.url).pathname;
const esmOut = new URL("./.bundle/folio.mjs", import.meta.url).pathname;
/** The math drop-ins (`doc/math-drop-in.md`): no pages, MathML and TeX. */
const mathOut = new URL("./.bundle/folio-math.js", import.meta.url).pathname;
const mathTexOut = new URL("./.bundle/folio-math-tex.js", import.meta.url).pathname;
const target = ["chrome109", "firefox115", "safari16.4"]; // the browser floor

await build({
  entryPoints: [new URL("../core/src/index.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  globalName: "folio",
  target,
  outfile: out,
  logLevel: "warning",
});

await build({
  entryPoints: [new URL("../viewer/src/index.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  globalName: "folioViewer",
  target,
  outfile: viewerOut,
  logLevel: "warning",
});

// The polyfill runs on load rather than exporting anything, so it is built as
// a plain script with no global name: a project points its script tag at it
// where `paged.polyfill.js` was and changes nothing else.
await build({
  entryPoints: [new URL("../core/src/polyfill.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  target,
  outfile: polyfillOut,
  logLevel: "warning",
});
// Paged.js's name for the same file, as `scripts/build.mjs` writes it.
await copyFile(polyfillOut, polyfillOut.replace("folio.polyfill", "paged.polyfill"));

await build({
  entryPoints: [new URL("../temml/src/global.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  globalName: "folioTeX",
  target,
  plugins: [temmlWithoutMhchem], // as scripts/build.mjs does
  outfile: texOut,
  logLevel: "warning",
});

await build({
  entryPoints: [new URL("../core/src/index.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  target,
  outfile: esmOut,
  logLevel: "warning",
});

for (const [entry, outfile] of [
  ["../core/src/math-global.ts", mathOut],
  ["../temml/src/math-global.ts", mathTexOut],
]) {
  await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    format: "iife",
    globalName: "folioMath",
    target,
    plugins: [temmlWithoutMhchem],
    outfile,
    logLevel: "warning",
  });
}

export default async function globalSetup() {}
console.log(
  `bundled -> ${out}\n         -> ${viewerOut}\n         -> ${polyfillOut}\n         -> ${texOut}\n         -> ${esmOut}` +
    `\n         -> ${mathOut}\n         -> ${mathTexOut}`,
);
