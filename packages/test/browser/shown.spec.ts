/**
 * The page shown is the page measured, whatever the host's media says.
 *
 * The pages are measured in the frame, against CSS with `@media print`
 * unwrapped and `@media screen` dropped, and then shown in a host document
 * that still holds the author's original sheets — on a screen, in a window.
 * So `@media not print { .print-only { display: none } }` hid, on screen, a
 * block its page had been broken around (WPT
 * `background-image-only-for-print`), and a width query was answered by the
 * window rather than by the page area the frame is the size of. The screen
 * rules must still style what is around the pages: that is where a project
 * keeps its preview chrome.
 */
import { expect, test } from "@playwright/test";
import { injectEngine } from "./inject.js";
import type * as Folio from "@truke/folio";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

const HTML = `<!DOCTYPE html>
<style>
  @page { size: 400px 300px; margin: 20px }
  @media not print { .print-only { display: none } }
  @media screen { .screen-red, .screen-red::before { color: rgb(255, 0, 0) } }
  @media (min-width: 800px) { .wide { color: rgb(0, 0, 255) } }
  @media (max-width: 400px) { .narrow { color: rgb(0, 128, 0) } }
  .screen-red::before { content: "» " }
</style>
<header><span class="print-only">chrome, print only</span><span class="wide">wide chrome</span></header>
<main id="doc">
  <div class="print-only" style="height: 50px">measured</div>
  <p class="screen-red">printed black</p>
  <p class="wide">the page area is not 800px wide</p>
  <p class="narrow">and a width query is not the page area's</p>
</main>`;

test("screen-only and width-query rules reach the chrome and not the pages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent(HTML);
  await injectEngine(page);
  await page.evaluate(() => new window.folio.Previewer().preview("#doc"));

  const seen = await page.evaluate(() => {
    const find = (sel: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el === null) throw new Error(`no ${sel}`);
      return el;
    };
    const on = (sel: string): HTMLElement => find(`.pagedjs_page ${sel}`);
    const off = (sel: string): HTMLElement => find(`header ${sel}`);
    return {
      printOnlyHeight: on(".print-only").getBoundingClientRect().height,
      screenRed: getComputedStyle(on(".screen-red")).color,
      screenRedBefore: getComputedStyle(on(".screen-red"), "::before").color,
      wide: getComputedStyle(on(".wide")).color,
      narrow: getComputedStyle(on(".narrow")).color,
      chromePrintOnly: getComputedStyle(off(".print-only")).display,
      chromeWide: getComputedStyle(off(".wide")).color,
    };
  });

  expect(seen).toEqual({
    printOnlyHeight: 50,
    screenRed: "rgb(0, 0, 0)",
    screenRedBefore: "rgb(0, 0, 0)",
    wide: "rgb(0, 0, 0)",
    // Width queries are answered against the user agent's page area, not the
    // author's 360px one, as Chromium prints (WPT `media-queries-001`): the
    // default page is wider than 400px, so `.narrow` does not match on the
    // pages. What matters here is that the host's window does not decide it.
    narrow: "rgb(0, 0, 0)",
    chromePrintOnly: "none",
    chromeWide: "rgb(0, 0, 255)",
  });
});
