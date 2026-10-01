/**
 * An esbuild plugin that bundles Temml without mhchem (`doc/tex.md` §5).
 *
 * Temml's module builds (`temml.mjs`, `temml.cjs`) include mhchem, the
 * `\ce` and `\pu` chemistry package; its script build (`temml.js`, which
 * `temml.min.js` is minified from) does not. Nothing here uses chemistry, and
 * it is 10 kB of the TeX bundle's 66 gzipped. So `import temml from "temml"`
 * resolves to the script build, with the export it lacks added. The two
 * produce the same MathML for everything else.
 *
 * The script build is a file name in Temml's `dist/`, not an export, so a
 * Temml upgrade must keep it: this throws if it is gone or no longer defines
 * `temml`.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const fromTemmlPackage = createRequire(new URL("../packages/temml/package.json", import.meta.url));

export const temmlWithoutMhchem = {
  name: "temml-without-mhchem",
  setup(build) {
    build.onResolve({ filter: /^temml$/ }, () => ({
      path: join(dirname(fromTemmlPackage.resolve("temml")), "temml.js"),
      namespace: "temml-script",
    }));
    build.onLoad({ filter: /.*/, namespace: "temml-script" }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      if (!/^var temml = /m.test(source)) throw new Error(`${path} no longer defines \`var temml\``);
      return { contents: `${source}\nexport default temml;\n`, loader: "js", resolveDir: dirname(path) };
    });
  },
};
