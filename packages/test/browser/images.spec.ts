/**
 * An image is measured at its source's size, loaded or not.
 *
 * The source's images are decoded before pagination (`settle`), but every
 * page holds clones, in the engine frame, and a clone asks for its image
 * again. With no freshness headers on the response, Chromium answers after
 * pagination has measured it at the height of its alt text, so a 200px image
 * went on a page with 20px left and ran into the footer (KFG1, 2026-11-06).
 * The images here are served exactly that way, through a route with no
 * `Cache-Control`. `stampNaturalSize` (`compose.ts`) is the fix.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { injectEngine } from "./inject.js";
import type * as Folio from "@truke/folio";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

const ORIGIN = "http://folio-images.test";

/** A PNG of this size, drawn by the browser, served with no cache headers. */
async function serveImage(page: Page, width: number, height: number): Promise<string> {
  const png = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      ctx.fillStyle = "rgb(0, 0, 255)";
      ctx.fillRect(0, 0, w, h);
      return canvas.toDataURL("image/png").split(",")[1] ?? "";
    },
    [width, height] as const,
  );
  const path = `/img-${width}x${height}.png`;
  await page.route(`${ORIGIN}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(png, "base64") }),
  );
  return `${ORIGIN}${path}`;
}

async function preview(page: Page, body: (src: string) => string, size: [number, number]) {
  await page.route(`${ORIGIN}/`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title>" }));
  await page.goto(`${ORIGIN}/`);
  const src = await serveImage(page, ...size);
  await page.setContent(`<!doctype html>
    <style>
      @page { size: 400px 300px; margin: 20px }
      body { margin: 0 }
      p { font: 16px/20px sans-serif; margin: 0 }
      img { max-width: 100% }
    </style>
    <body>${"<p>Filler line.</p>".repeat(4)}${body(src)}<p>After the image.</p></body>`);
  await injectEngine(page);
  return page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    const imagePage = flow.pages.findIndex((p) => p.querySelector("img") !== null) + 1;
    const img = flow.pages[imagePage - 1]?.querySelector("img");
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      imagePage,
      imageHeight: img?.getBoundingClientRect().height ?? 0,
    };
  });
}

// The page area is 360 × 260px and the four lines above take 80, which
// leaves 180: a 200px image does not fit and must open page 2.
const CASES: [string, (src: string) => string, [number, number]][] = [
  ["a bare image", (src) => `<img src="${src}" alt="figure">`, [300, 200]],
  ["an image in a paragraph", (src) => `<p><img src="${src}" alt="figure"></p>`, [300, 200]],
  ["a block image in a div", (src) => `<div><img style="display: block" src="${src}" alt="figure"></div>`, [300, 200]],
  ["an image in a line of text", (src) => `<p>Text <img src="${src}" alt="figure"></p>`, [300, 200]],
  // 720 × 400 scaled to the 360px measure by `max-width` is 200px tall.
  ["an image scaled by max-width", (src) => `<p><img src="${src}" alt="figure"></p>`, [720, 400]],
];

for (const [name, body, size] of CASES) {
  test(`${name} is measured at its natural size before its clone has loaded`, async ({ page }) => {
    const result = await preview(page, body, size);
    expect(result.overflowed).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.imagePage).toBe(2);
    expect(result.imageHeight).toBeCloseTo(200, 0);
  });
}
