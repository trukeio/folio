import { describe, expect, it } from "vitest";
import { ABSENT, defaultAlignment, placeEdge, resolveEdge, resolveFixed } from "./margin-boxes.js";
import type { EdgeBox } from "./margin-boxes.js";

const auto = (min: number, max: number): EdgeBox => ({ auto: true, size: 0, min, max });
const fixed = (size: number): EdgeBox => ({ auto: false, size, min: 0, max: 0 });

describe("resolveEdge, with no middle box", () => {
  it("gives a box alone on its edge the whole edge", () => {
    expect(resolveEdge(200, [auto(10, 40), ABSENT, ABSENT])).toEqual([200, 0, 0]);
    expect(resolveEdge(200, [ABSENT, ABSENT, auto(10, 40)])).toEqual([0, 0, 200]);
  });

  it("gives an auto box what a fixed neighbour leaves (WPT content-001)", () => {
    expect(resolveEdge(200, [fixed(100), ABSENT, auto(10, 20)])).toEqual([100, 0, 100]);
  });

  it("shares the space left over in proportion to max-content", () => {
    // 60 left over, shared 1:2.
    expect(resolveEdge(150, [auto(10, 30), ABSENT, auto(10, 60)])).toEqual([50, 0, 100]);
  });

  it("shrinks from max-content by the difference to min-content when that fits", () => {
    // Max 100 + 100 does not fit in 120; min 20 + 60 does, with 40 to share
    // by (100-20):(100-60) = 2:1.
    const [a, , c] = resolveEdge(120, [auto(20, 100), ABSENT, auto(60, 100)]);
    expect(a).toBeCloseTo(20 + 40 * (2 / 3));
    expect(c).toBeCloseTo(60 + 40 * (1 / 3));
  });

  it("shrinks proportionally to min-content when even that does not fit (WPT dimensions-008)", () => {
    // Its comment: left min 18em, right 6em, 20em available; 15em and 5em.
    const em = 16;
    const [a, , c] = resolveEdge(20 * em, [auto(18 * em, 19 * em), ABSENT, auto(6 * em, 10 * em)]);
    expect(a).toBeCloseTo(15 * em);
    expect(c).toBeCloseTo(5 * em);
  });

  it("treats two empty boxes as equal", () => {
    expect(resolveEdge(100, [auto(0, 0), ABSENT, auto(0, 0)])).toEqual([50, 0, 50]);
  });
});

describe("resolveEdge, with a middle box", () => {
  it("fixes the pair at twice a fixed side box, and gives the middle the rest (WPT dimensions-011)", () => {
    // 20em of 16px: a 1em auto box, a 5em auto middle, a 4em fixed box.
    expect(resolveEdge(320, [auto(16, 16), auto(80, 80), fixed(64)])).toEqual([64, 192, 64]);
  });

  it("shares by content when the wider side box is auto (WPT dimensions-011)", () => {
    expect(resolveEdge(320, [auto(96, 96), auto(64, 64), fixed(32)])).toEqual([120, 80, 32]);
  });

  it("sizes the middle box against each doubled side and keeps the wider (WPT dimensions-007)", () => {
    expect(resolveEdge(20, [auto(1, 9), auto(1, 17), auto(1, 3)])).toEqual([5.25, 9.5, 5.25]);
    expect(resolveEdge(20, [auto(3, 51), auto(4, 36), auto(7, 23)])).toEqual([7.5, 5, 7.5]);
  });

  it("gives three empty boxes a third each (WPT dimensions-010)", () => {
    expect(resolveEdge(450, [auto(0, 0), auto(0, 0), auto(0, 0)])).toEqual([150, 150, 150]);
  });

  it("gives a middle box alone the whole edge (WPT background-001)", () => {
    expect(resolveEdge(300, [ABSENT, auto(0, 0), ABSENT])).toEqual([0, 300, 0]);
  });

  it("keeps the middle box centred however unequal its neighbours are", () => {
    const [a, b, c] = resolveEdge(300, [auto(10, 20), auto(10, 20), auto(10, 80)]);
    expect(b).toBeCloseTo(300 * (20 / 180));
    expect(a).toBeCloseTo((300 - (b ?? 0)) / 2);
    expect(c).toBeCloseTo(a ?? 0);
    const [, start] = placeEdge(300, [a ?? 0, b ?? 0, c ?? 0]);
    expect((start ?? 0) + (b ?? 0) / 2).toBeCloseTo(150);
  });

  it("thirds three equal boxes (WPT alignment-001)", () => {
    const [a, b, c] = resolveEdge(450, [auto(8, 8), auto(8, 8), auto(8, 8)]);
    expect(a).toBeCloseTo(150);
    expect(b).toBeCloseTo(150);
    expect(c).toBeCloseTo(150);
  });

  it("gives the sides of a fixed middle what is left, halved", () => {
    expect(resolveEdge(300, [auto(0, 10), fixed(100), auto(0, 90)])).toEqual([100, 100, 100]);
  });
});

describe("resolveEdge, min and max", () => {
  it("re-runs with max-width as the width when a box would exceed it", () => {
    const capped: EdgeBox = { ...auto(10, 40), ceiling: 50 };
    expect(resolveEdge(200, [capped, ABSENT, ABSENT])).toEqual([50, 0, 0]);
    expect(resolveEdge(200, [capped, ABSENT, auto(10, 40)])).toEqual([50, 0, 150]);
  });

  it("re-runs with min-width as the width when a box would fall short of it", () => {
    const floored: EdgeBox = { ...fixed(10), floor: 30 };
    expect(resolveEdge(200, [floored, ABSENT, auto(0, 5)])).toEqual([30, 0, 170]);
  });
});

describe("placeEdge", () => {
  it("puts the first box flush at the start, the middle centred, the last flush at the end", () => {
    expect(placeEdge(300, [50, 100, 70])).toEqual([0, 100, 230]);
  });
});

describe("resolveFixed", () => {
  it("fills the margin's depth with an auto height", () => {
    expect(resolveFixed(100, { size: null, start: null, end: null }, "start")).toEqual({
      start: 0,
      size: 100,
      end: 0,
    });
    expect(resolveFixed(100, { size: null, start: 10, end: 20 }, "start")).toEqual({
      start: 10,
      size: 70,
      end: 20,
    });
  });

  it("centres a box with a height and two auto margins", () => {
    expect(resolveFixed(100, { size: 40, start: null, end: null }, "start")).toEqual({
      start: 30,
      size: 40,
      end: 30,
    });
  });

  it("never makes an auto margin negative (WPT auto-margins-002)", () => {
    expect(resolveFixed(100, { size: 140, start: null, end: null }, "start")).toEqual({
      start: -40,
      size: 140,
      end: 0,
    });
    expect(resolveFixed(100, { size: 140, start: null, end: null }, "end")).toEqual({
      start: 0,
      size: 140,
      end: -40,
    });
  });

  it("ignores the margin on the paper's side when over-constrained", () => {
    expect(resolveFixed(100, { size: 50, start: 10, end: 10 }, "start")).toEqual({
      start: 40,
      size: 50,
      end: 10,
    });
    expect(resolveFixed(100, { size: 50, start: 10, end: 10 }, "end")).toEqual({
      start: 10,
      size: 50,
      end: 40,
    });
  });
});

describe("defaultAlignment", () => {
  it("is css-page-3's table 2", () => {
    expect(defaultAlignment("top-left-corner")).toEqual(["right", "middle"]);
    expect(defaultAlignment("top-left")).toEqual(["left", "middle"]);
    expect(defaultAlignment("top-center")).toEqual(["center", "middle"]);
    expect(defaultAlignment("bottom-right")).toEqual(["right", "middle"]);
    expect(defaultAlignment("top-right-corner")).toEqual(["left", "middle"]);
    expect(defaultAlignment("bottom-left-corner")).toEqual(["right", "middle"]);
    expect(defaultAlignment("left-top")).toEqual(["center", "top"]);
    expect(defaultAlignment("right-middle")).toEqual(["center", "middle"]);
    expect(defaultAlignment("left-bottom")).toEqual(["center", "bottom"]);
  });
});
