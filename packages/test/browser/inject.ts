/** Inject the engine bundle into a page, once per page. */
import type { Page } from "@playwright/test";

const BUNDLE = new URL("../.bundle/folio.js", import.meta.url).pathname;
const VIEWER = new URL("../.bundle/viewer.js", import.meta.url).pathname;

export async function injectEngine(page: Page): Promise<void> {
  await page.addScriptTag({ path: BUNDLE });
  await page.addScriptTag({ path: VIEWER });
}
