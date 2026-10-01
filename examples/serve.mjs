/**
 * A static server for the examples (`doc/using.md`).
 *
 * It serves the repository root, not `examples/`, so an example can load
 * `/dist/folio.js` — the thing it is there to demonstrate — by the same
 * path an application would use after copying `dist/` into its own site.
 *
 *   pnpm build && pnpm examples
 *   open http://127.0.0.1:5180/examples/
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const port = Number(process.env["EXAMPLES_PORT"] ?? 5180);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  // normalize() before join() keeps "../" out of the served root.
  let file = join(root, normalize(path === "/" ? "/examples/" : path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (file.endsWith("/")) file += "index.html";

  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end(`not found: ${path}\n\nDid you run \`pnpm build\` first?`);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`examples on http://127.0.0.1:${port}/examples/`);
});
