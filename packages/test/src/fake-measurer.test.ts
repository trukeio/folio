import { describe, expect, it } from "vitest";
import { blockRect, fakeMeasurer, lineStack } from "./fake-measurer.js";
import type { FakeBox } from "./fake-measurer.js";

const doc: FakeBox = {
  id: "root",
  rect: blockRect(0, 300),
  children: [
    { id: "h1", rect: blockRect(0, 40), style: { "--x-string-set": "title content()" } },
    { id: "p1", rect: blockRect(40, 160), lines: lineStack(6, 20, 40) },
    { id: "p2", rect: blockRect(160, 300), lines: lineStack(7, 20, 160) },
  ],
};

describe("fakeMeasurer", () => {
  it("returns the rect a box was declared with", () => {
    const m = fakeMeasurer(doc);
    expect(m.measurer.box(m.el("p1"))).toEqual(blockRect(40, 160));
  });

  it("counts a batch as one read however many elements it holds", () => {
    const m = fakeMeasurer(doc);
    const els = ["h1", "p1", "p2"].map((id) => m.el(id));

    const rects = m.measurer.boxes(els);

    expect(rects).toHaveLength(3);
    expect(m.stats.batched).toBe(1);
    expect(m.stats.batchedElements).toBe(3);
    expect(m.stats.single).toBe(0);
  });

  it("gives line boxes for text, which is what widows and orphans count", () => {
    const m = fakeMeasurer(doc);

    const lines = m.measurer.lineBoxes(m.range("p2"));

    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual(blockRect(160, 180));
    expect(lines.at(-1)).toEqual(blockRect(280, 300));
  });

  it("reads carrier properties and returns empty for absent ones", () => {
    const m = fakeMeasurer(doc);

    const style = m.measurer.styleOf(m.el("h1"), ["--x-string-set", "--x-float"]);

    expect(style).toEqual({
      "--x-string-set": "title content()",
      "--x-float": "",
    });
  });

  it("refuses a tree with duplicate ids", () => {
    const dup: FakeBox = {
      id: "a",
      rect: blockRect(0, 10),
      children: [{ id: "a", rect: blockRect(0, 5) }],
    };
    expect(() => fakeMeasurer(dup)).toThrow(/duplicate box id: a/);
  });

  it("refuses to measure an element it does not know", () => {
    const m = fakeMeasurer(doc);
    expect(() => m.measurer.box({} as Element)).toThrow(/not a fake element/);
  });

  it("throws rather than inventing line boxes for a box without text", () => {
    const m = fakeMeasurer(doc);
    expect(() => m.measurer.lineBoxes(m.range("h1"))).toThrow(/no line boxes/);
  });

  it("resets its counters", () => {
    const m = fakeMeasurer(doc);
    m.measurer.box(m.el("h1"));
    m.resetStats();
    expect(m.stats).toEqual({
      single: 0,
      batched: 0,
      batchedElements: 0,
      lineBoxes: 0,
      styleOf: 0,
    });
  });
});
