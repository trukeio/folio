/**
 * M1's performance budget (`doc/milestones.md` §M1).
 *
 * "A forced-layout budget is recorded for a 300-page book fixture, and CI
 * fails on regression against it."
 *
 * The budget is in *composed nodes*, not in seconds. Seconds are a property of
 * the host — the corpus baselines already say so, and this suite runs three
 * workers on one processor — while a clone is a decision the engine made, the
 * same on every machine, and it is what every later cost is proportional to:
 * the browser's layout of the measuring box, the style read per element, the
 * candidate per block child.
 *
 * Two claims, and the second is the load-bearing one:
 *
 *  - **A page costs a bounded number of nodes.** The recorded number below.
 *  - **The book costs twice what half the book costs.** This is the shape, and
 *    it is what `chunk.ts` exists to preserve. Measuring the whole remainder
 *    on every page — which is what the engine did until M1's last exit item
 *    was paid — makes half a book cost a quarter, so the ratio goes to four.
 *    It holds whatever the host's fonts do to the page count, which no
 *    absolute number does.
 *
 * Wall-clock is reported and not asserted, for the same reason the baselines
 * are not portable: it is worth reading and not worth failing on.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/book.html";

/**
 * Nodes one page of the book may compose, averaged over it.
 *
 * Recorded on this host at 59 with a chunk of about two and a half pages
 * (`paginate.ts`, CHUNK_OVERSHOOT). The headroom is for a host whose fonts
 * make shorter pages, not for a change of approach: a regression to measuring
 * the whole remainder puts this in the thousands.
 */
const NODES_PER_PAGE = 150;

/**
 * How much more the whole book may cost than half of it.
 *
 * Linear is 2. Quadratic is 4. The slack above 2 is the chunk estimator
 * warming up and the tables the chunk may not cut, both of which are constants
 * per page rather than growth.
 */
const MAX_SCALING = 2.6;

/** Chapters in the full fixture; half of it is half of this. */
const CHAPTERS = 150;

test.describe.configure({ timeout: 600_000 });

type Run = {
  pages: number;
  overflowed: number[];
  nodes: number;
  ms: number;
  characters: number;
};

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

async function paginateBook(page: Page, chapters: number): Promise<Run> {
  await page.goto(`${FIXTURE}?chapters=${chapters}`);
  await injectEngine(page);
  return page.evaluate(async () => {
    const t = window.folio;
    const src = document.getElementById("src") as Element;
    const doc = await t.normalize(document);
    const frame = t.createEngineFrame(document);
    const target = frame.contentDocument as Document;
    const style = target.createElement("style");
    style.textContent = `body{margin:0}\n${doc.authorCss}`;
    target.head.append(style);
    await target.fonts.ready;

    // Reset after normalize and before paginate: the count is of the
    // fragmenter's work, not of the harness getting ready.
    t.composeStats.nodes = 0;
    const started = performance.now();
    const result = t.paginate({ source: src, pageRules: doc.pageRules, target, maxPages: 600 });
    const ms = Math.round(performance.now() - started);

    return {
      pages: result.records.length,
      overflowed: result.overflowed,
      nodes: t.composeStats.nodes,
      ms,
      characters: src.textContent.replace(/\s+/g, "").length,
    };
  });
}

test("a book's worth of pages costs a book's worth of work", async ({ page }) => {
  const whole = await paginateBook(page, CHAPTERS);
  const half = await paginateBook(page, CHAPTERS / 2);

  console.log(
    `  book: ${whole.pages}p ${whole.nodes} nodes ${whole.ms}ms` +
      ` (${Math.round(whole.nodes / whole.pages)}/page)\n` +
      `  half: ${half.pages}p ${half.nodes} nodes ${half.ms}ms` +
      ` (${Math.round(half.nodes / half.pages)}/page)\n` +
      `  scaling: ${(whole.nodes / half.nodes).toFixed(2)}x for 2x the book`,
  );

  // The fixture is a 300-page book or the budget is measuring something else.
  expect(whole.pages).toBeGreaterThan(250);
  // §9 holds here as everywhere: a fast engine that overflows is not faster.
  expect(whole.overflowed).toEqual([]);
  expect(half.overflowed).toEqual([]);

  expect(whole.nodes / whole.pages).toBeLessThan(NODES_PER_PAGE);
  expect(whole.nodes / half.nodes).toBeLessThan(MAX_SCALING);
});
