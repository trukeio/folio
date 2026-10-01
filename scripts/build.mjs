/**
 * Build the distribution (`doc/using.md`).
 *
 * Three things an application can want, and they are not the same thing:
 *
 *   folio.polyfill.js   a drop-in script. Loads, waits for the DOM, paginates
 *                       the page it is on. Nothing to import and nothing to
 *                       call — this is the file a Paged.js project's script
 *                       tag points at after the swap. `paged.polyfill.js` is
 *                       the same file under Paged.js's name, for a project
 *                       that vendors it and would rather not touch the tag.
 *   folio.js            the library, as a classic script. `window.folio`.
 *   folio.mjs           the same, as a module, for a bundler or an import map.
 *
 *   folio-tex.js        the TeX front end (`doc/tex.md`): \( … \) and \[ … \]
 *                       to MathML before the engine measures. Its own file,
 *                       because Temml is larger than the engine.
 *
 * …and the viewer beside them, because a page list with spreads and zoom is
 * not what a print stylesheet wants and should not be in the same file.
 *
 * Minified copies sit next to the readable ones. The readable one is the
 * default in the documentation: a paged-media engine is something authors
 * debug in the browser's inspector, and a stack trace through minified output
 * helps nobody.
 */
import { build } from "esbuild";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { temmlWithoutMhchem } from "./temml-without-mhchem.mjs";

const root = new URL("../", import.meta.url).pathname;
const dist = `${root}dist/`;
// The browser floor of `plan.md` §1, set by MathML Core.
const target = ["chrome109", "firefox115", "safari16.4"];

await mkdir(dist, { recursive: true });

/** One entry point, in every form an application might load it in. */
async function bundle({ entry, out, globalName, esm = true, banner }) {
  const entryPoints = [`${root}packages/${entry}`];
  const shared = {
    entryPoints,
    bundle: true,
    target,
    logLevel: "warning",
    plugins: [temmlWithoutMhchem],
    ...(banner === undefined ? {} : { banner: { js: banner } }),
  };

  await build({
    ...shared,
    format: "iife",
    ...(globalName === undefined ? {} : { globalName }),
    outfile: `${dist}${out}.js`,
  });
  await build({
    ...shared,
    format: "iife",
    ...(globalName === undefined ? {} : { globalName }),
    minify: true,
    outfile: `${dist}${out}.min.js`,
  });
  if (esm) {
    await build({ ...shared, format: "esm", outfile: `${dist}${out}.mjs` });
  }
}

// The bundles that carry Temml's code carry its notice, as MIT asks: Temml's
// own files have no comment esbuild would keep (`THIRD-PARTY-LICENSES.md`).
const TEMML = "/*! Includes Temml 0.13.5 | MIT | (c) 2020 Ron Kok | see THIRD-PARTY-LICENSES.md */";

await bundle({ entry: "core/src/index.ts", out: "folio", globalName: "folio" });
await bundle({ entry: "viewer/src/index.ts", out: "folio-viewer", globalName: "folioViewer" });
// No global name: the polyfill runs on load and exports nothing an application
// reaches for. It puts `Paged` on the window itself, as the file it replaces did.
await bundle({ entry: "core/src/polyfill.ts", out: "folio.polyfill", esm: false });
// Paged.js's name for the same bytes: a copy dropped over a vendored
// `paged.polyfill.js` is the whole migration. A copy, not a redirect, because
// a page served from `file:` follows no redirect.
await copyFile(`${dist}folio.polyfill.js`, `${dist}paged.polyfill.js`);
await copyFile(`${dist}folio.polyfill.min.js`, `${dist}paged.polyfill.min.js`);
// Registers itself with the polyfill, as the polyfill registers `Paged`; a
// bundler imports `@truke/folio-temml` instead, so there is no module form.
await bundle({ entry: "temml/src/global.ts", out: "folio-tex", globalName: "folioTeX", esm: false, banner: TEMML });
// The same formulas with no pages (`doc/math-drop-in.md`): MathML alone, and
// with the TeX front end. A page that paginates loads neither.
await bundle({ entry: "core/src/math-global.ts", out: "folio-math", globalName: "folioMath", esm: false });
await bundle({ entry: "temml/src/math-global.ts", out: "folio-math-tex", globalName: "folioMath", esm: false, banner: TEMML });

await copyFile(`${root}THIRD-PARTY-LICENSES.md`, `${dist}THIRD-PARTY-LICENSES.md`);
await writeFile(
  `${dist}README.md`,
  `# folio — distribution

Built by \`pnpm build\`. See \`doc/using.md\` for what to load and when.

| File | Load it as | Gives you |
| --- | --- | --- |
| \`folio.polyfill.js\` | \`<script src>\` | Paginates the page on load. Paged.js drop-in. |
| \`paged.polyfill.js\` | \`<script src>\` | The same file under Paged.js's name. |
| \`folio.js\` | \`<script src>\` | \`window.folio\` — the library. |
| \`folio.mjs\` | \`import\` | The same, as a module. |
| \`folio-viewer.js\` | \`<script src>\` | \`window.folioViewer\` — spreads, zoom, virtualized pages. |
| \`folio-viewer.mjs\` | \`import\` | The same, as a module. |
| \`folio-tex.js\` | \`<script src>\` | TeX to MathML before paginating: \`\\( … \\)\`, \`\\[ … \\]\`. Options in \`window.FolioTeX\`. |
| \`folio-math.js\` | \`<script src>\` | The math with no pages: numbers, breaks, references. Options in \`window.FolioMath\`. |
| \`folio-math-tex.js\` | \`<script src>\` | The same, with TeX converted first, as \`folio-tex.js\` does. |

\`.min.js\` beside each is the same file, minified. \`THIRD-PARTY-LICENSES.md\`
lists what the TeX files bundle and its licence; keep it with them.
`,
);

const sizes = [
  "folio.polyfill.js",
  "folio.polyfill.min.js",
  "folio.js",
  "folio.min.js",
  "folio.mjs",
  "folio-viewer.js",
  "folio-viewer.min.js",
  "folio-viewer.mjs",
  "folio-tex.js",
  "folio-tex.min.js",
  "folio-math.js",
  "folio-math.min.js",
  "folio-math-tex.js",
  "folio-math-tex.min.js",
].map((name) => `  ${name.padEnd(26)} ${(statSync(dist + name).size / 1024).toFixed(0)} kB`);

console.log(`built -> ${dist}\n${sizes.join("\n")}`);
