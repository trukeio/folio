import { describe, expect, it } from "vitest";
import { autoSides, resolveBorderWidths, resolveSides } from "./page-box.js";

const box = (blockStart: number, inlineEnd: number, blockEnd: number, inlineStart: number) => ({
  blockStart,
  blockEnd,
  inlineStart,
  inlineEnd,
});

describe("resolveSides", () => {
  it("takes a percentage of the page box on its own axis (WPT page-box-004)", () => {
    // 500 × 800: the block sides are shares of 800, the inline sides of 500.
    const margins = resolveSides({ margin: "5% 10% 15% 20%" }, "margin", 48, [500, 800]);
    expect(margins).toEqual(box(40, 50, 120, 100));
  });

  it("lets a longhand, physical or logical, refine the shorthand", () => {
    const d = { padding: "10px", "padding-top": "20px", "padding-inline-start": "2%" };
    expect(resolveSides(d, "padding", 0, [400, 400])).toEqual(box(20, 10, 10, 8));
  });

  it("keeps the fallback for a side that says nothing, or nonsense", () => {
    expect(resolveSides({}, "margin", 48, [400, 400])).toEqual(box(48, 48, 48, 48));
    expect(resolveSides({ margin: "wide" }, "margin", 48, [400, 400])).toEqual(box(48, 48, 48, 48));
  });

  it("reads an auto margin as 0, for resolvePageSpec to share out (WPT page-margin-auto*)", () => {
    expect(resolveSides({ margin: "auto" }, "margin", 48, [400, 400])).toEqual(box(0, 0, 0, 0));
    expect(autoSides({ margin: "auto", "margin-top": "0" })).toEqual({
      blockStart: false,
      blockEnd: true,
      inlineStart: true,
      inlineEnd: true,
    });
  });
});

describe("resolveBorderWidths", () => {
  it("is zero with no style, whatever the width says", () => {
    expect(resolveBorderWidths({})).toEqual(box(0, 0, 0, 0));
    expect(resolveBorderWidths({ "border-width": "10px" })).toEqual(box(0, 0, 0, 0));
  });

  it("reads the shorthand, and a style alone is medium (WPT page-box-005, auto-margins-001)", () => {
    expect(resolveBorderWidths({ border: "10px dotted" })).toEqual(box(10, 10, 10, 10));
    expect(resolveBorderWidths({ border: "solid" })).toEqual(box(3, 3, 3, 3));
    expect(resolveBorderWidths({ border: "thick solid red" })).toEqual(box(5, 5, 5, 5));
  });

  it("lets sides and longhands refine it", () => {
    const d = { border: "4px solid", "border-left": "none", "border-bottom-width": "thin" };
    expect(resolveBorderWidths(d)).toEqual(box(4, 4, 1, 0));
  });
});
