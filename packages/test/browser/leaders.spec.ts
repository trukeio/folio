/**
 * M6: `leader()` (`leaders.ts`).
 *
 * A leader's text is generated content, so it is read where the engine wrote
 * it — the attribute its `attr()` reads — and its effect is read off the
 * geometry: the entry is still one line tall (or two, for the title that
 * wraps), and its box now reaches the end of the line, less at most one copy
 * of the pattern.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/leaders.html";

type Entry = {
  href: string;
  leader: string;
  page: string;
  lines: number;
  /** How far the entry's last line stops short of the end of the line, in px. */
  gap: number;
};

declare global {
  interface Window {
    folio: typeof Folio;
    runLeaders: () => Promise<{ pages: number; entries: Entry[]; overflowed: number[] }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
  await page.evaluate(() => {
    window.runLeaders = async () => {
      const t = window.folio;
      const src = document.getElementById("src") as Element;
      const doc = await t.normalize(document);
      const frame = t.createEngineFrame(document);
      const target = frame.contentDocument as Document;
      const style = target.createElement("style");
      style.textContent = `body{margin:0}\n${doc.authorCss}`;
      target.head.append(style);
      await target.fonts.ready;

      const result = t.paginate({
        source: src,
        pageRules: doc.pageRules,
        target,
        references: doc.references,
        maxPages: 20,
      });

      const leaderRef = doc.references.find((r) => r.wants === "leader");
      const pageRef = doc.references.find((r) => r.wants === "page");
      const first = result.pages[0] as HTMLElement;
      const area = first.getBoundingClientRect();
      const entries = [...first.querySelectorAll("nav a")].map((a) => {
        const attrs = [...a.attributes];
        const leader = attrs.find((x) => x.name.startsWith("data-x-leader-"))?.value ?? "";
        const rects = [...a.getClientRects()];
        const last = rects.at(-1) as DOMRect;
        return {
          href: a.getAttribute("href") ?? "",
          leader,
          page: attrs.find((x) => x.name.startsWith("data-x-ref-"))?.value ?? "",
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
          gap: area.right - last.right,
        };
      });
      void leaderRef;
      void pageRef;
      return { pages: result.records.length, entries, overflowed: result.overflowed };
    };
  });
});

test("the rewrite finds the leaders and the references beside them", async ({ page }) => {
  const refs = await page.evaluate(async () => {
    const doc = await window.folio.normalize(document);
    return doc.references.map((r) => ({ wants: r.wants, pattern: r.leader?.pattern ?? null }));
  });
  expect(refs.filter((r) => r.wants === "leader").map((r) => r.pattern)).toEqual([
    ". ",
    "-",
    "_",
  ]);
  expect(refs.filter((r) => r.wants === "page")).toHaveLength(3);
});

test("each entry fills its line, and no entry gains a line", async ({ page }) => {
  const run = await page.evaluate(() => window.runLeaders());
  expect(run.overflowed).toEqual([]);
  expect(run.entries.map((e) => e.page)).toEqual(["2", "3", "4", "5"]);
  expect(run.entries.map((e) => e.lines)).toEqual([1, 2, 1, 1]);
  for (const entry of run.entries) {
    expect(entry.leader.length, entry.href).toBeGreaterThan(10);
    // Short of the line end by less than one copy of the pattern.
    expect(entry.gap, entry.href).toBeGreaterThanOrEqual(0);
    expect(entry.gap, entry.href).toBeLessThan(12);
  }
});
