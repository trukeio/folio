// Static server for browser fixtures. Fonts do not load over file:// in every
// engine, and the corpus (M0.2) will want a server anyway.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("./fixtures/", import.meta.url).pathname;
const port = Number(process.env["FIXTURE_PORT"] ?? 5177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  // normalize() before join() keeps "../" out of the served root.
  const file = join(root, normalize(path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`fixtures on http://127.0.0.1:${port}`);
});
