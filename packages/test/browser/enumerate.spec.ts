/**
 * M1.3: candidate enumeration against real layout.
 *
 * The costs are unit-tested against synthetic boxes; what a browser adds is
 * the part that cannot be faked — that `Measurer` reads a real document the
 * way the fragmenter assumes, and that the candidates come back in the order
 * and at the extents the page actually has.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/enumerate.html";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await page.evaluate(async () => {
    await document.fonts.load('1em "Fixture"');
    await document.fonts.ready;
  });
  await injectEngine(page);
});

async function enumerate(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById("doc") as Element;
    const measurer = window.folio.domMeasurer(root);
    const candidates = window.folio.enumerateCandidates(root, {
      measurer,
      rangeFor: (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range;
      },
      widows: 2,
      orphans: 2,
    });
    return candidates.map((c) => ({
      key: window.folio.positionKey(c.position),
      line: c.line,
      kind: c.kind,
      extent: Math.round(c.extent),
      penalty: c.penalty,
    }));
  });
}

test("finds breaks in document order at real extents", async ({ page }) => {
  const candidates = await enumerate(page);

  expect(candidates.length).toBeGreaterThan(5);
  const extents = candidates.map((c) => c.extent);
  expect(extents).toEqual([...extents].sort((a, b) => a - b));
});

test("marks the forced break the stylesheet asks for", async ({ page }) => {
  const forced = (await enumerate(page)).filter((c) => c.kind === "forced");

  expect(forced).toHaveLength(1);
  expect(forced[0]?.penalty).toBe(-Infinity);
});

test("charges more to break just after a heading than between paragraphs", async ({ page }) => {
  const candidates = await enumerate(page);
  const blocks = candidates.filter((c) => c.kind === "block" && Number.isFinite(c.penalty));

  const cheapest = Math.min(...blocks.map((c) => c.penalty));
  const afterHeading = blocks.find((c) => c.penalty >= 800 && c.penalty < 1000);

  expect(cheapest).toBe(0);
  expect(afterHeading, "no candidate carries the heading penalty").toBeDefined();
});

test("splits a real paragraph at its line boxes", async ({ page }) => {
  const lines = (await enumerate(page)).filter((c) => c.kind === "line");

  // The long paragraph is ~400px wide at 16px/24px, so it wraps several times.
  expect(lines.length).toBeGreaterThan(3);

  // Every line candidate belongs to one paragraph, and they are one line-height
  // apart. A wrapper element offering the same lines again would show up here
  // as a duplicate extent.
  const keys = new Set(lines.map((c) => c.key));
  expect(keys.size).toBe(1);
  const gaps = lines.slice(1).map((c, i) => c.extent - (lines[i] as { extent: number }).extent);
  expect(gaps.every((g) => g === 24)).toBe(true);
});

test("the chosen break is the cheapest that fits a real page height", async ({ page }) => {
  const chosen = await page.evaluate(() => {
    const root = document.getElementById("doc") as Element;
    const measurer = window.folio.domMeasurer(root);
    const candidates = window.folio.enumerateCandidates(root, {
      measurer,
      rangeFor: (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range;
      },
    });
    const top = measurer.box(root).blockStart;
    const choice = window.folio.chooseBreak(candidates, top + 200);
    return choice === null
      ? null
      : { extent: Math.round(choice.candidate.extent - top), penalty: choice.candidate.penalty, overflowed: choice.overflowed };
  });

  expect(chosen).not.toBeNull();
  expect(chosen?.overflowed).toBe(false);
  expect(chosen?.extent).toBeLessThanOrEqual(200);
  expect(chosen?.penalty).toBeLessThan(1000);
});

test("line candidates carry the character offset the browser wraps at", async ({ page }) => {
  const result = await page.evaluate(() => {
    const root = document.getElementById("doc") as Element;
    const measurer = window.folio.domMeasurer(root);
    const ranges = window.folio.domTextRanges();

    const candidates = window.folio.enumerateCandidates(root, {
      measurer,
      rangeFor: (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range;
      },
      textRanges: ranges,
    });

    const long = document.getElementById("long") as Element;
    const longText = long.textContent;
    const lines = candidates.filter((c) => c.kind === "line");

    return {
      total: ranges.length(long),
      offsets: lines.map((c) => c.position.offset),
      linesAt: lines.map((c) => ({
        line: c.line,
        atOffset: measurer.lineBoxes(ranges.prefix(long, c.position.offset)).length,
        oneMore: measurer.lineBoxes(ranges.prefix(long, c.position.offset + 1)).length,
      })),
      // An offset names where the *next* line starts, so the character before
      // it is the last one kept — a space at a normal wrap.
      breaks: lines.map((c) => ({
        before: longText.charAt(c.position.offset - 1),
        at: longText.charAt(c.position.offset),
      })),
    };
  });

  // Real offsets, in order, inside the paragraph.
  expect(result.offsets.every((o) => o > 0)).toBe(true);
  expect(result.offsets).toEqual([...result.offsets].sort((a, b) => a - b));
  expect(Math.max(...result.offsets)).toBeLessThan(result.total);

  // The substantive property: a prefix ending at the offset occupies exactly
  // the lines the candidate claims, and one more character spills over.
  for (const { line, atOffset, oneMore } of result.linesAt) {
    expect(atOffset).toBe(line);
    expect(oneMore).toBe((line as number) + 1);
  }

  // Every break falls between words: the last character kept is a space and
  // the next line starts on a real character, never mid-word.
  for (const { before, at } of result.breaks) {
    expect(before).toBe(" ");
    expect(at.trim()).not.toBe("");
  }
});
