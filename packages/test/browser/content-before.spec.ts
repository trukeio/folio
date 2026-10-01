/**
 * `content(before)` and `content(after)` in `string-set` (GCPM 3 §1.1).
 *
 * The usual running head is the chapter's number and its title, and the
 * number is generated: `h2::before { content: "Chapter " counter(chapter)
 * ". " }`. The pseudo-element's text is not in the DOM and the browser gives
 * back its `content` as `counter(chapter)` rather than `3`, so both halves are
 * the engine's to work out — the string from the computed value, the number
 * from its own counter walk, at the heading.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

const BOOK = `<!doctype html>
<style>
  @page { size: 400px 300px; margin: 40px; @top-center { content: string(head) } }
  body { counter-reset: chapter }
  h2 { counter-increment: chapter; string-set: head content(before) content() content(after) }
  h2::before { content: "Chapter " counter(chapter, upper-roman) ". " }
  h2::after { content: " (" attr(data-part) ")" }
  h3 { string-set: head content(before) content() }
  h3::before { counter-increment: section; content: "§" counter(section) " " }
  section + section { break-before: page }
</style>
<section><h2 data-part="A">Tides</h2><p>Text.</p></section>
<section><h2 data-part="B">Winds</h2><p>Text.</p></section>
<section style="counter-reset: section 4"><h3>Currents</h3><p>Text.</p></section>`;

async function heads(page: Page, html: string) {
  await page.setContent(html);
  await injectEngine(page);
  return page.evaluate(async () => {
    const flow = await new window.folio.Previewer().preview();
    return flow.pages.map((p) => p.querySelector(".pagedjs_margin-top-center")?.textContent ?? "");
  });
}

test("a running head takes the generated number and suffix from ::before and ::after", async ({ page }) => {
  const r = await heads(page, BOOK);
  expect(r.slice(0, 2)).toEqual(["Chapter I. Tides (A)", "Chapter II. Winds (B)"]);
});

test("a counter incremented on the ::before itself is counted for the string", async ({ page }) => {
  const r = await heads(page, BOOK);
  expect(r[2]).toBe("§5 Currents");
});
