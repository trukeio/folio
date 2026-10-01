/**
 * `footnote-policy` and note splitting (`doc/review.md` §6).
 *
 * An `auto` note that does not fit is split after its last line that does,
 * and its tail goes to the top of the next page's area. `line` and `block`
 * move the call instead. `@page { @footnote { max-height } }` is the cap.
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

async function run(page: Page, html: string) {
  await page.setContent(`<!doctype html>${html}`);
  await injectEngine(page);
  return page.evaluate(async () => {
    const t = window.folio;
    const flow = await new t.Previewer().preview();
    const block = t.contentArea(flow.records[0]?.spec as Folio.PageSpec).block;
    return {
      total: flow.total,
      overflowed: flow.overflowed,
      block,
      notes: flow.pages.map((p) =>
        [...p.querySelectorAll<HTMLElement>(`.${t.NOTE_CLASS}`)].map((n) => ({
          number: Number(n.dataset["footnote"]),
          continued: n.hasAttribute("data-continued"),
          marker: n.querySelector(`.${t.MARKER_CLASS}`) !== null,
          text: n.textContent.replace(/\s+/g, ""),
        })),
      ),
      areas: flow.pages.map((p) => {
        const area = p.querySelector(`.${t.AREA_CLASS}`);
        return area === null ? 0 : area.getBoundingClientRect().height;
      }),
      heights: flow.pages.map((p) => p.scrollHeight),
    };
  });
}

const PAGE = "@page { size: 400px 300px; margin: 0 } body { margin: 0; font: 16px/20px serif } p { margin: 0 }";
const WORDS = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
const LONG = `<span class="fn">${WORDS}</span>`;

test("an auto note that does not fit is split, and its tail opens the next page's area", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .fn { float: footnote }</style>
     <p>One${LONG} two.</p>${"<p>More text.</p>".repeat(20)}`,
  );
  expect(r.overflowed).toEqual([]);
  const parts = r.notes.flat().filter((n) => n.number === 1);
  expect(parts.length).toBeGreaterThan(1);
  // The head keeps the marker; each continuation has none.
  expect(parts[0]).toMatchObject({ continued: false, marker: true });
  for (const part of parts.slice(1)) expect(part).toMatchObject({ continued: true, marker: false });
  // Every word once, in order.
  expect(parts.map((p) => p.text).join("").replace(/^1(?=w0)/, "")).toBe(WORDS.replace(/\s+/g, ""));
  // The continuation is first in its page's area.
  expect(r.notes[1]?.[0]).toMatchObject({ number: 1, continued: true });
  // Within the default cap of 70% wherever text shares the page.
  expect(r.areas[0]).toBeLessThanOrEqual(r.block * 0.7 + 1);
  for (const h of r.heights) expect(h).toBeLessThanOrEqual(r.block + 1);
});

test("a note with footnote-policy: line is not split", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .fn { float: footnote; footnote-policy: line }</style>
     <p>One${`<span class="fn">${WORDS.slice(0, 200)}</span>`} two.</p>${"<p>More text.</p>".repeat(20)}`,
  );
  const parts = r.notes.flat().filter((n) => n.number === 1);
  expect(parts).toHaveLength(1);
  expect(parts[0]?.continued).toBe(false);
});

test("@footnote max-height caps the area", async ({ page }) => {
  const r = await run(
    page,
    `<style>${PAGE} .fn { float: footnote } @page { @footnote { max-height: 30%; border-top: 1px solid } }</style>
     <p>One${LONG} two.</p>${"<p>More text.</p>".repeat(20)}`,
  );
  expect(r.overflowed).toEqual([]);
  for (const h of r.areas) expect(h).toBeLessThanOrEqual(r.block * 0.3 + 1);
  expect(r.notes.flat().filter((n) => n.number === 1).length).toBeGreaterThan(2);
});

test("notes left when the text ends get pages of their own", async ({ page }) => {
  const r = await run(page, `<style>${PAGE} .fn { float: footnote }</style><p>Short${LONG}.</p>`);
  expect(r.overflowed).toEqual([]);
  expect(r.total).toBeGreaterThan(1);
  const parts = r.notes.flat();
  expect(parts.map((p) => p.text).join("").replace(/^1(?=w0)/, "")).toBe(WORDS.replace(/\s+/g, ""));
  for (const h of r.heights) expect(h).toBeLessThanOrEqual(r.block + 1);
});

test("a break after notes in a paragraph does not land inside one, so none is numbered twice", async ({ page }) => {
  // The break's offset is counted in the measuring box, where each note is a
  // call, and found in the source, where it is text; every note before the
  // break used to move it earlier, into a note.
  const note = (i: number) => `<span class="fn">Note ${i} ${"x".repeat(60)} end.</span>`;
  const para = Array.from({ length: 6 }, (_, i) => `Sentence ${i} of the text runs on for a while here${note(i)}.`).join(" ");
  const r = await run(
    page,
    `<style>${PAGE} .fn { float: footnote; footnote-policy: line }</style><p>${para} ${para.replace(/Note (\d)/g, "Note 1$1")}</p>`,
  );
  const numbers = r.notes.flat().map((n) => n.number);
  expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  for (const n of r.notes.flat()) expect(n.text).toMatch(/Note\d+x+end\.$/);
});
