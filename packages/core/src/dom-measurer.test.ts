import { describe, expect, it } from "vitest";
import { groupIntoLines } from "./dom-measurer.js";
import type { Rect } from "./types.js";

const r = (blockStart: number, blockEnd: number, inlineStart: number, inlineEnd: number): Rect => ({
  blockStart,
  blockEnd,
  inlineStart,
  inlineEnd,
});

describe("groupIntoLines", () => {
  it("merges the fragments of one line into one box", () => {
    // A line containing <em> arrives as three rects; treating them as three
    // lines would invent two break opportunities that do not exist.
    const lines = groupIntoLines([r(0, 20, 0, 50), r(0, 20, 50, 90), r(0, 20, 90, 120)]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual(r(0, 20, 0, 120));
  });

  it("keeps separate lines separate", () => {
    const lines = groupIntoLines([r(0, 20, 0, 100), r(20, 40, 0, 80), r(40, 60, 0, 60)]);
    expect(lines).toHaveLength(3);
  });

  it("tolerates sub-pixel differences within a line", () => {
    expect(groupIntoLines([r(0, 20, 0, 50), r(0.4, 18, 50, 90)])).toHaveLength(1);
  });

  it("keeps a subscript, a superscript and a formula's box on their line", () => {
    // Measured in Chromium at 9.5pt/1.5: "Starting from T₀ at t = 0, …" over
    // two lines. The text of line 1 is 97–113, the <math> box starts at 101,
    // the subscript at 105; line 2 starts at 116. Grouped by top edge this was
    // four lines, and the fragmenter judged widows by that count.
    const lines = groupIntoLines([
      r(97, 113, 0, 90), // text before the formula
      r(101, 115, 90, 110), // <math>
      r(99, 113, 90, 100), // <mi>T</mi>
      r(105, 114, 100, 110), // <mn>0</mn>, the subscript
      r(97, 113, 110, 300), // text after
      r(116, 132, 0, 200), // line 2
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(r(97, 115, 0, 300));
  });

  it("keeps a superscript raised above the text on its line", () => {
    expect(groupIntoLines([r(92, 102, 60, 70), r(97, 113, 0, 200), r(116, 132, 0, 200)])).toHaveLength(2);
  });

  it("keeps lines apart when a tight line-height makes their boxes overlap", () => {
    // line-height 1 with a font whose content area is 1.16em: each box runs
    // 3px into the next line's, and the lines are still three.
    const lines = groupIntoLines([r(0, 19, 0, 100), r(16, 35, 0, 100), r(32, 51, 0, 100)]);
    expect(lines).toHaveLength(3);
  });

  it("puts a tall inline box on the line it sits on, whichever it starts", () => {
    // An inline image 40px tall ending on line 2's baseline: its middle is
    // in line 2, and so is it.
    const lines = groupIntoLines([r(0, 16, 0, 200), r(20, 60, 0, 40), r(44, 60, 40, 200)]);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.blockStart).toBe(20);
  });

  it("takes the tallest extent of a mixed-height line", () => {
    const [line] = groupIntoLines([r(0, 20, 0, 50), r(0, 32, 50, 90)]);
    expect(line?.blockEnd).toBe(32);
  });

  it("sorts fragments that arrive out of order", () => {
    const lines = groupIntoLines([r(40, 60, 0, 60), r(0, 20, 0, 100)]);
    expect(lines.map((l) => l.blockStart)).toEqual([0, 40]);
  });

  it("has nothing to say about no rects", () => {
    expect(groupIntoLines([])).toEqual([]);
  });
});
