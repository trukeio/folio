/**
 * HTML in, PDF out, with no one at a browser (`doc/using.md` "On a server").
 *
 *   node scripts/pdf.mjs book.html                  # -> book.pdf
 *   node scripts/pdf.mjs book.html -o out/book.pdf
 *   node scripts/pdf.mjs https://example.com/report.html -o report.pdf
 *   node scripts/pdf.mjs examples/report/index.html --root . -o report.pdf
 *
 * Options:
 *   -o, --out FILE        where the PDF goes (default: the input, .pdf)
 *   --root DIR            what a local file is served from (default: its
 *                         directory). Set it when the page asks for absolute
 *                         paths such as /dist/folio.js.
 *   --content SELECTOR    what to paginate (default: <body>)
 *   --page-defaults CSS   the user agent's page, e.g. "size: A4; margin: 20mm";
 *                         any @page in the document wins over it
 *   --wait EXPRESSION     the page paginates itself: print once this is
 *                         truthy, and run nothing of ours. If its value has
 *                         `overflowed`, as a Flow does, that is reported.
 *   --timeout SECONDS     give up on pagination after this (default: 600)
 *
 * The page is paginated in headless Chromium and printed by Chromium:
 * `page.pdf` is Chromium's alone, and it is what `print.spec.ts` checks. A
 * page that already loads the drop-in polyfill is paginated by it, with its own
 * `PagedConfig` and handlers (the TeX front end, say); `--content` and
 * `--page-defaults` are then the page's to set, not ours. Any other page is
 * given `dist/folio.js` and a `Previewer` — unless it runs a `Previewer` of
 * its own, which nothing outside the page can see begin or end: say when it
 * is done with `--wait`, e.g. `--wait window.flow` after the page's
 * `window.flow = await previewer.preview()`. Either way the PDF is printed
 * only after pagination has finished, never on the first page to appear.
 *
 * A local file is served over HTTP, not opened as file://: the engine reads
 * the author's sheets through CSSOM, and Chromium will not let a file:// page
 * read a linked sheet's rules.
 *
 * Exits 1 if any page overflowed its area. The PDF is still written: the
 * overflow is reported, not hidden, as the engine reports it.
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const repo = new URL("../", import.meta.url).pathname;
const library = join(repo, "dist/folio.js");

function usage(code) {
  console.error("usage: node scripts/pdf.mjs <file.html | URL> [-o out.pdf] [--root DIR]");
  console.error("       [--content SELECTOR] [--page-defaults CSS] [--wait EXPRESSION] [--timeout SECONDS]");
  process.exit(code);
}

let opts;
let positionals;
try {
  ({ values: opts, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      root: { type: "string" },
      content: { type: "string" },
      "page-defaults": { type: "string" },
      wait: { type: "string" },
      timeout: { type: "string", default: "600" },
      help: { type: "boolean", short: "h" },
    },
  }));
} catch (error) {
  console.error(error.message);
  usage(2);
}
if (opts.help) usage(0);

const input = positionals[0];
if (input === undefined || positionals.length > 1) usage(2);
if (!existsSync(library)) {
  console.error(`${library} is missing: run \`pnpm build\` first.`);
  process.exit(2);
}

const remote = /^https?:\/\//.test(input);
const out = opts.out ?? (remote ? "out.pdf" : input.replace(/\.x?html?$/i, "") + ".pdf");

const types = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Serve `root` on a free port; resolves to the server once it listens. */
function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    // normalize() before join() keeps "../" out of the served root.
    let file = join(root, normalize(path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (file.endsWith(sep)) file += "index.html";
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end(`not found: ${path}`);
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

let server;
let url = input;
if (!remote) {
  const file = resolve(input);
  const root = resolve(opts.root ?? dirname(file));
  const path = relative(root, file);
  if (path.startsWith("..")) {
    console.error(`${input} is not under --root ${root}`);
    process.exit(2);
  }
  server = await serve(root);
  url = `http://127.0.0.1:${server.address().port}/${path.split(sep).map(encodeURIComponent).join("/")}`;
}

const browser = await chromium.launch();
let overflowed;
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.error(`page ${message.type()}: ${message.text()}`);
  });

  // Before any of the page's scripts: hear when the drop-in finishes. The
  // polyfill reads `PagedConfig` once and calls its `after` with the flow,
  // or with nothing when the page set `auto: false` and paginates itself.
  await page.addInitScript(() => {
    let config = {};
    let settle;
    window.__folioPdf = new Promise((done) => (settle = done));
    Object.defineProperty(window, "PagedConfig", {
      configurable: true,
      get: () => ({
        ...config,
        after: async (flow) => {
          await config.after?.(flow);
          settle({ flow, config });
        },
      }),
      set: (value) => {
        config = value ?? {};
      },
    });
  });

  await page.goto(url, { waitUntil: "load" });

  const seconds = Number(opts.timeout);
  let flow;
  let how = "";
  if (opts.wait !== undefined) {
    await page.waitForFunction(opts.wait, null, { timeout: seconds * 1000 });
    flow = await page.evaluate((expression) => {
      const value = new Function(`return (${expression})`)();
      return {
        total: document.querySelectorAll(".pagedjs_page").length,
        overflowed: Array.isArray(value?.overflowed) ? value.overflowed : [],
        ms: typeof value?.performance === "number" ? value.performance : undefined,
      };
    }, opts.wait);
    how = " (the page's own run)";
  } else {
    const dropIn = await page.evaluate(() => window.Paged?.previewer !== undefined);
    if (dropIn) how = " (the page's own polyfill)";
    else await page.addScriptTag({ path: library });

    const run = page.evaluate(
      async ({ dropIn, content, pageDefaults }) => {
        const pick = (flow) => ({ total: flow.total, overflowed: flow.overflowed, ms: flow.performance });
        if (!dropIn) {
          const previewer = new window.folio.Previewer(pageDefaults === undefined ? {} : { pageDefaults });
          return pick(await previewer.preview(content ?? null));
        }
        const { flow, config } = await window.__folioPdf;
        if (flow !== undefined) return pick(flow);
        // `auto: false`: run what the page would have run from its button.
        return pick(
          await window.Paged.previewer.preview(config.content ?? null, config.stylesheets ?? null, config.renderTo ?? null),
        );
      },
      { dropIn, content: opts.content, pageDefaults: opts["page-defaults"] },
    );
    // Unref'd: left running when pagination wins or fails, it must not keep
    // the process alive.
    const expired = new Promise((_, fail) =>
      setTimeout(() => fail(new Error(`pagination did not finish in ${seconds}s`)), seconds * 1000).unref(),
    );
    flow = await Promise.race([run, expired]);
  }

  // Only these two: the engine's print stylesheet makes Chromium's page
  // exactly each sheet, and a size or margin passed here would fight it.
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });

  overflowed = flow.overflowed;
  const time = flow.ms === undefined ? "" : ` in ${(flow.ms / 1000).toFixed(1)}s`;
  console.log(`${out}: ${flow.total} pages${time}${how}`);
  if (overflowed.length > 0) console.error(`pages that overflowed their area: ${overflowed.join(", ")}`);
} finally {
  await browser.close();
  server?.close();
}
process.exit(overflowed?.length > 0 ? 1 : 0);
