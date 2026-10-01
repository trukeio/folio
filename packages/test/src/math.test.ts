import { describe, expect, it } from "vitest";
/**
 * The inline axis, against synthetic boxes (`doc/plan.md` §9, layer 1).
 *
 * This is the claim of `math.md` §4 under test: breaking a display equation is
 * the page fragmenter turned ninety degrees. The candidates are measured once,
 * the decision is arithmetic, and none of it needs a browser — which is the
 * same standard the block axis is held to in `candidates.test.ts`.
 */
import { mathCandidates, planBreaks, MATH_PENALTIES } from "@truke/folio";
import { fakeMeasurer, inlineRect } from "./fake-measurer.js";
import type { FakeBox } from "./fake-measurer.js";

/** One token of an equation, laid out left to right. */
const token = (
  id: string,
  tag: string,
  from: number,
  to: number,
  text?: string,
  children?: FakeBox[],
): FakeBox => ({
  id,
  tag,
  rect: inlineRect(from, to),
  ...(text === undefined ? {} : { text }),
  ...(children === undefined ? {} : { children }),
});

/**
 * `a + b = c + d`, 400px wide, one token every 50px.
 *
 *     0    50   100  150  200  250  300  350  400
 *     | a  | +  | b  | =  | c  | +  | d  |
 */
const equation: FakeBox = {
  id: "math",
  tag: "math",
  rect: inlineRect(0, 400),
  children: [
    {
      id: "row",
      tag: "mrow",
      rect: inlineRect(0, 400),
      children: [
        token("a", "mi", 0, 50, "a"),
        token("plus1", "mo", 50, 100, "+"),
        token("b", "mi", 100, 150, "b"),
        token("eq", "mo", 150, 200, "="),
        token("c", "mi", 200, 250, "c"),
        token("plus2", "mo", 250, 300, "+"),
        token("d", "mi", 300, 400, "d"),
      ],
    },
  ],
};

describe("mathCandidates", () => {
  it("offers a break after every top-level operator, and nowhere else", () => {
    const m = fakeMeasurer(equation);
    const candidates = mathCandidates(m.root, { measurer: m.measurer });

    expect(candidates.map((c) => c.extent)).toEqual([100, 200, 300]);
    expect(candidates.map((c) => c.operator)).toEqual(["binary", "relation", "binary"]);
    // The path is into the source tree, through the <mrow>: child 3 of child 0.
    expect(candidates[1]?.position.path).toEqual([0, 3]);
    expect(candidates[1]?.position.after).toBe(true);
  });

  it("prices a relation below a binary operator", () => {
    const m = fakeMeasurer(equation);
    const [plus, relation] = mathCandidates(m.root, { measurer: m.measurer });
    expect(relation?.penalty).toBe(MATH_PENALTIES.afterRelation);
    expect(plus?.penalty).toBe(MATH_PENALTIES.afterBinary);
  });

  it("reads every candidate in one batched call", () => {
    // §4: MathML never wraps, so one read of the row gives every candidate's
    // inline position and the rest is arithmetic. A trial render per candidate
    // is the thing this design exists to avoid.
    const m = fakeMeasurer(equation);
    mathCandidates(m.root, { measurer: m.measurer });

    expect(m.stats.batched).toBe(1);
    expect(m.stats.single).toBe(0);
  });

  it("never offers a break after the last operator of a row", () => {
    const trailing = fakeMeasurer({
      id: "math",
      tag: "math",
      rect: inlineRect(0, 200),
      children: [
        token("a", "mi", 0, 100, "a"),
        token("plus", "mo", 100, 200, "+"),
      ],
    });
    expect(mathCandidates(trailing.root, { measurer: trailing.measurer })).toEqual([]);
  });

  it("refuses to break inside a script, a fraction or a radical", () => {
    const script = fakeMeasurer({
      id: "math",
      tag: "math",
      rect: inlineRect(0, 300),
      children: [
        token("sup", "msup", 0, 150, undefined, [
          token("base", "mi", 0, 100, "x"),
          // A `+` inside the exponent is not a break position at any price.
          token("exp", "mrow", 100, 150, undefined, [
            token("e1", "mn", 100, 120, "1"),
            token("eplus", "mo", 120, 135, "+"),
            token("e2", "mn", 135, 150, "2"),
          ]),
        ]),
        token("trail", "mi", 150, 300, "y"),
      ],
    });
    expect(mathCandidates(script.root, { measurer: script.measurer })).toEqual([]);
  });

  it("descends into a plain row, at a cost, but not into a fenced one", () => {
    const nested = (tag: string, fenced: boolean): FakeBox => ({
      id: "math",
      tag: "math",
      rect: inlineRect(0, 400),
      children: [
        token("group", tag, 0, 300, undefined, [
          ...(fenced ? [token("open", "mo", 0, 20, "(")] : []),
          token("x", "mi", 20, 100, "x"),
          token("inner", "mo", 100, 150, "+"),
          token("y", "mi", 150, 280, "y"),
          ...(fenced ? [token("close", "mo", 280, 300, ")")] : []),
        ]),
        token("tail", "mi", 300, 400, "z"),
      ],
    });

    const open = fakeMeasurer(nested("mrow", false));
    const inner = mathCandidates(open.root, { measurer: open.measurer });
    expect(inner.map((c) => c.depth)).toEqual([1]);
    expect(inner[0]?.penalty).toBe(MATH_PENALTIES.afterBinary + MATH_PENALTIES.perDescent);

    const closed = fakeMeasurer(nested("mrow", true));
    expect(mathCandidates(closed.root, { measurer: closed.measurer })).toEqual([]);
  });
});

describe("planBreaks", () => {
  const candidates = (box: FakeBox = equation) => {
    const m = fakeMeasurer(box);
    return mathCandidates(m.root, { measurer: m.measurer });
  };

  it("leaves an equation that fits alone", () => {
    expect(planBreaks(candidates(), 400, { measure: 400 })).toEqual([]);
  });

  it("breaks at the relation when the relation fits", () => {
    // 250px of measure: both the first `+` (100) and the `=` (200) fit, and
    // the relation is the cheaper break as well as the fuller line.
    const chosen = planBreaks(candidates(), 400, { measure: 250 });
    expect(chosen.map((c) => c.extent)).toEqual([200]);
  });

  it("takes the operator when the relation does not fit", () => {
    // The relation is 200px in and the measure is 150, so the first row ends
    // at the `+` instead — a worse break, taken because it is the only one.
    const chosen = planBreaks(candidates(), 400, { measure: 150 });
    expect(chosen[0]?.extent).toBe(100);
    expect(chosen[0]?.operator).toBe("binary");
  });

  it("keeps breaking until what is left fits the continuation measure", () => {
    // Continuation rows start beneath the alignment point, so they have
    // 400 - 200 = 200px, and a 400px equation cut at 100 still has 300 left.
    const chosen = planBreaks(candidates(), 400, { measure: 150 });
    const last = chosen[chosen.length - 1]?.extent ?? 0;
    expect(400 - last).toBeLessThanOrEqual(400 - 200);
  });

  it("never returns a break that does not advance", () => {
    const chosen = planBreaks(candidates(), 400, { measure: 60 });
    const extents = chosen.map((c) => c.extent);
    expect(extents).toEqual([...extents].sort((a, b) => a - b));
    expect(new Set(extents).size).toBe(extents.length);
  });

  it("prefers the top level, and descends only when nothing there fits", () => {
    const deep: FakeBox = {
      id: "math",
      tag: "math",
      rect: inlineRect(0, 400),
      children: [
        token("group", "mrow", 0, 300, undefined, [
          token("x", "mi", 0, 100, "x"),
          token("inner", "mo", 100, 150, "+"),
          token("y", "mi", 150, 300, "y"),
        ]),
        token("top", "mo", 300, 340, "="),
        token("z", "mi", 340, 400, "z"),
      ],
    };
    // 350px: the top-level relation fits, so the nested break is not taken.
    expect(planBreaks(candidates(deep), 400, { measure: 350 }).map((c) => c.depth)).toEqual([0]);
    // 200px: it does not, so the nested break opens the first row — and the
    // top-level one still ends the second, because by then it fits.
    expect(planBreaks(candidates(deep), 400, { measure: 200 }).map((c) => c.depth)).toEqual([
      1, 0,
    ]);
  });
});
