import { describe, expect, it } from "vitest";
/**
 * Enumeration is tested here rather than beside the source, because it is the
 * first part of the engine that needs the harness: `@truke/folio-test` depends on
 * `@truke/folio`, so the dependency cannot run the other way. Pure modules
 * (positions, penalties, selection) keep their tests beside them.
 */
import {
  carrierName,
  chooseBreak,
  enumerateCandidates,
  FORCED,
  PENALTIES,
  positionKey,
  PROHIBITED,
} from "@truke/folio";
import { blockRect, fakeMeasurer, lineStack } from "./fake-measurer.js";
import type { FakeBox, FakeMeasurer } from "./fake-measurer.js";

const box = (
  id: string,
  from: number,
  to: number,
  over: Partial<FakeBox> = {},
): FakeBox => ({ id, rect: blockRect(from, to), ...over });

/** Three stacked paragraphs, nothing special about any of them. */
const plain: FakeBox = {
  id: "root",
  rect: blockRect(0, 300),
  children: [box("p1", 0, 100), box("p2", 100, 200), box("p3", 200, 300)],
};

describe("enumerateCandidates", () => {
  it("emits a break between each pair of block siblings", () => {
    const m = fakeMeasurer(plain);
    const candidates = enumerateCandidates(m.root, { measurer: m.measurer });

    expect(candidates.map((c) => c.extent)).toEqual([100, 200]);
    expect(candidates.every((c) => c.penalty === PENALTIES.betweenBlocks)).toBe(true);
    expect(candidates.map((c) => positionKey(c.position))).toEqual(["1+0", "2+0"]);
  });

  it("reads all the boxes of one level in a single batched call", () => {
    // §3: never append and measure one node at a time. A performance claim
    // that is not asserted is one that quietly stops being true.
    const m = fakeMeasurer(plain);
    enumerateCandidates(m.root, { measurer: m.measurer });

    expect(m.stats.single).toBe(0);
    expect(m.stats.batched).toBe(1);
    expect(m.stats.batchedElements).toBe(3);
  });

  it("marks a forced break, from either side of the gap", () => {
    const after = fakeMeasurer({
      ...plain,
      children: [
        box("p1", 0, 100, { style: { "break-after": "page" } }),
        box("p2", 100, 200),
      ],
    });
    const before = fakeMeasurer({
      ...plain,
      children: [box("p1", 0, 100), box("p2", 100, 200, { style: { "break-before": "page" } })],
    });

    for (const m of [after, before]) {
      const [candidate] = enumerateCandidates(m.root, { measurer: m.measurer });
      expect(candidate?.penalty).toBe(FORCED);
      expect(candidate?.kind).toBe("forced");
    }
  });

  it("prohibits a break where the author said avoid", () => {
    const m = fakeMeasurer({
      ...plain,
      children: [
        box("p1", 0, 100, { style: { "break-after": "avoid" } }),
        box("p2", 100, 200),
      ],
    });

    expect(enumerateCandidates(m.root, { measurer: m.measurer })[0]?.penalty).toBe(PROHIBITED);
  });

  it("keeps a heading with the block it introduces", () => {
    const m = fakeMeasurer({
      ...plain,
      children: [box("h", 0, 40, { tag: "h2" }), box("p", 40, 140), box("p2", 140, 240)],
    });

    const candidates = enumerateCandidates(m.root, { measurer: m.measurer });
    const afterHeading = candidates.find((c) => c.extent === 40);
    const betweenParas = candidates.find((c) => c.extent === 140);

    expect(afterHeading?.penalty).toBe(PENALTIES.betweenBlocks + PENALTIES.afterHeading);
    expect(betweenParas?.penalty).toBe(PENALTIES.betweenBlocks);
    // And the rule earns its keep: given both, the cheap break wins.
    expect(chooseBreak(candidates, 200)?.candidate.extent).toBe(140);
  });

  it("charges for breaking inside an avoid block, and compounds when nested", () => {
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 400),
      children: [
        {
          ...box("outer", 0, 300, { style: { "break-inside": "avoid" } }),
          children: [
            {
              ...box("inner", 0, 200, { style: { "break-inside": "avoid" } }),
              children: [box("a", 0, 100), box("b", 100, 200)],
            },
            box("c", 200, 300),
          ],
        },
        box("after", 300, 400),
      ],
    });

    const candidates = enumerateCandidates(m.root, { measurer: m.measurer });
    const insideInner = candidates.find((c) => c.extent === 100);
    const insideOuter = candidates.find((c) => c.extent === 200);
    const outside = candidates.find((c) => c.extent === 300);

    expect(outside?.penalty).toBe(PENALTIES.betweenBlocks);
    expect(insideOuter?.penalty).toBe(PENALTIES.betweenBlocks + PENALTIES.insideAvoid);
    expect(insideInner?.penalty).toBe(PENALTIES.betweenBlocks + 2 * PENALTIES.insideAvoid);
  });

  it("emits a candidate per line box, with widow and orphan costs", () => {
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 120),
      children: [box("para", 0, 120, { lines: lineStack(6, 20) })],
    });

    const candidates = enumerateCandidates(m.root, {
      measurer: m.measurer,
      rangeFor: (el) => m.range((el as unknown as { __box: string }).__box),
      widows: 3,
      orphans: 3,
    });

    // Five interior breaks for six lines, each naming the lines left behind
    // rather than a character offset it has not measured.
    expect(candidates).toHaveLength(5);
    expect(candidates.map((c) => c.line)).toEqual([1, 2, 3, 4, 5]);
    expect(candidates.every((c) => c.position.offset === 0)).toBe(true);
    // Breaking after line 1 orphans two: 3 required, 1 left.
    expect(candidates[0]?.penalty).toBe(PENALTIES.betweenLines + 2 * PENALTIES.perOrphan);
    // After line 3 satisfies both.
    expect(candidates[2]?.penalty).toBe(PENALTIES.betweenLines);
    // After line 5 widows two.
    expect(candidates[4]?.penalty).toBe(PENALTIES.betweenLines + 2 * PENALTIES.perWidow);
  });

  it("puts every candidate in document order by extent", () => {
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 300),
      children: [
        box("a", 0, 100, { lines: lineStack(4, 25) }),
        box("b", 100, 200),
        box("c", 200, 300),
      ],
    });

    const extents = enumerateCandidates(m.root, {
      measurer: m.measurer,
      rangeFor: (el) => m.range((el as unknown as { __box: string }).__box),
    }).map((c) => c.extent);

    expect(extents).toEqual([...extents].sort((x, y) => x - y));
  });

  it("works on the inline axis, which is what §7 rides on", () => {
    const equation: FakeBox = {
      id: "eq",
      rect: { blockStart: 0, blockEnd: 40, inlineStart: 0, inlineEnd: 600 },
      children: [
        { id: "lhs", rect: { blockStart: 0, blockEnd: 40, inlineStart: 0, inlineEnd: 200 } },
        { id: "rel", rect: { blockStart: 0, blockEnd: 40, inlineStart: 200, inlineEnd: 260 } },
        { id: "rhs", rect: { blockStart: 0, blockEnd: 40, inlineStart: 260, inlineEnd: 600 } },
      ],
    };
    const m = fakeMeasurer(equation);

    const candidates = enumerateCandidates(m.root, { measurer: m.measurer, axis: "inline" });

    expect(candidates.map((c) => c.extent)).toEqual([200, 260]);
    expect(chooseBreak(candidates, 400)?.candidate.extent).toBe(260);
  });
  it("measures a break to where the ink stops, not to the next box's start", () => {
    // A margin adjoining a fragmentation break is truncated (CSS Break 3), so
    // reserving room for it makes a page hold less than it can. Checked on
    // Chromium and Firefox with a column exactly two lines tall: the second
    // line stays put whether the trailing margin is 0, 18 or 40px.
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 300),
      children: [box("a", 0, 100), box("b", 118, 218)],
    });

    const candidates = enumerateCandidates(m.root, { measurer: m.measurer });

    expect(candidates.map((c) => c.extent)).toEqual([100]);
  });

  it("offers no break between siblings that sit side by side", () => {
    // Two `<td>`s of a row start at the same place. A break "before the second
    // cell" is not a break at all: it cuts the row in half and puts one cell
    // on each page, which is what the table fixture caught.
    const m = fakeMeasurer({
      id: "row",
      rect: blockRect(0, 40),
      children: [
        { id: "left", rect: { blockStart: 0, blockEnd: 40, inlineStart: 0, inlineEnd: 50 } },
        { id: "right", rect: { blockStart: 0, blockEnd: 40, inlineStart: 50, inlineEnd: 300 } },
      ],
    });

    expect(enumerateCandidates(m.root, { measurer: m.measurer })).toEqual([]);
  });

  it("forces a break where the named page changes on a first child", () => {
    // `page` is inherited, so the change can happen several levels down on a
    // first child, where there is no sibling to compare with (CSS Paged Media
    // 3, and `named-page/nested` in the corpus).
    const page = carrierName("page");
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 300),
      children: [
        box("intro", 0, 100),
        box("wrapper", 100, 300, {
          children: [box("preamble", 100, 300, { style: { [page]: "preamble" } })],
        }),
      ],
    });

    const forcedAt = enumerateCandidates(m.root, { measurer: m.measurer })
      .filter((c) => c.kind === "forced")
      .map((c) => c.extent);

    expect(forcedAt).toContain(100);
  });

  it("propagates a first child's break-before to its parent", () => {
    // CSS Break 3 §4.2. Without it a `<section>` asking for a page shares one
    // with whatever preceded its `<main>`.
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 300),
      children: [
        box("header", 0, 100),
        box("main", 100, 300, {
          children: [box("section", 100, 300, { style: { "break-before": "page" } })],
        }),
      ],
    });

    const forced = enumerateCandidates(m.root, { measurer: m.measurer }).filter(
      (c) => c.kind === "forced",
    );

    expect(forced.map((c) => c.extent)).toContain(100);
    expect(forced.every((c) => c.penalty === FORCED)).toBe(true);
  });

  it("offers a paragraph with a formula in it its lines, and no gaps", () => {
    // Inline `<math>` computes to `display: math`. Read as a block, it made
    // its paragraph blocks and loose text: no line candidates, so no widow or
    // orphan accounting, and a free break before each formula and each run of
    // text — a lone last line taken for nothing.
    const m = fakeMeasurer({
      id: "root",
      rect: blockRect(0, 60),
      children: [
        box("p", 0, 60, {
          lines: lineStack(3, 20),
          children: [
            box("formula", 0, 20, { style: { display: "math" } }),
            box("em", 40, 60, { style: { display: "inline" } }),
          ],
        }),
      ],
    });
    const candidates = enumerateCandidates(m.root, {
      measurer: m.measurer,
      rangeFor: (el) => m.range((el as unknown as { __box: string }).__box),
    });
    expect(candidates.map((c) => c.kind)).toEqual(["line", "line"]);
  });

  describe("edge values (review.md §2.3)", () => {
    const page = carrierName("page");
    const named = (id: string, from: number, to: number, name: string, over: Partial<FakeBox> = {}) =>
      box(id, from, to, { ...over, style: { [page]: name, ...over.style } });
    const forcedAt = (root: FakeBox): number[] => {
      const m = fakeMeasurer(root);
      return enumerateCandidates(m.root, { measurer: m.measurer })
        .filter((c) => c.kind === "forced")
        .map((c) => c.extent);
    };

    it("starts a container on its first child's page (`page-name-propagated-001`)", () => {
      // a / b > c > a: the second box starts on `a`, so nothing changes.
      expect(
        forcedAt({
          id: "root",
          rect: blockRect(0, 200),
          children: [
            named("one", 0, 100, "a"),
            named("b", 100, 200, "b", {
              children: [named("c", 100, 200, "c", { children: [named("a2", 100, 200, "a")] })],
            }),
          ],
        }),
      ).toEqual([]);
    });

    it("breaks between a container's children instead (`page-name-siblings-002`)", () => {
      // a / b > (a, auto): the change is inside `b`, between its children.
      expect(
        forcedAt({
          id: "root",
          rect: blockRect(0, 300),
          children: [
            named("one", 0, 100, "a"),
            named("b", 100, 300, "b", {
              children: [named("x", 100, 200, "a"), named("y", 200, 300, "auto")],
            }),
          ],
        }),
      ).toEqual([200]);
    });

    it("skips out-of-flow children when finding first and last", () => {
      // a / b > (abspos, a): the first in-flow child is on `a`.
      expect(
        forcedAt({
          id: "root",
          rect: blockRect(0, 200),
          children: [
            named("one", 0, 100, "a"),
            named("b", 100, 200, "b", {
              children: [
                box("abs", 100, 120, { style: { position: "absolute" } }),
                named("a2", 100, 200, "a"),
              ],
            }),
          ],
        }),
      ).toEqual([]);
    });

    it("neither propagates out of a flex container nor breaks between its items", () => {
      // `page-name-flex-001` and `-004`: nothing at the flex container's edges
      // or between its items, but a break between blocks inside an item.
      const flex = (items: FakeBox[]): FakeBox => ({
        id: "root",
        rect: blockRect(0, 400),
        children: [
          box("before", 0, 100),
          box("flex", 100, 300, { style: { display: "flex" }, children: items }),
          box("after", 300, 400),
        ],
      });
      expect(forcedAt(flex([named("b", 100, 200, "b"), named("c", 200, 300, "c")]))).toEqual([]);
      expect(
        forcedAt(
          flex([box("item", 100, 300, { children: [named("b", 100, 200, "b"), named("c", 200, 300, "c")] })]),
        ),
      ).toEqual([200]);
    });

    it("forces nothing inside an inline-block or an absolutely positioned box", () => {
      for (const style of [{ display: "inline-block" }, { position: "absolute" }]) {
        expect(
          forcedAt({
            id: "root",
            rect: blockRect(0, 200),
            children: [box("wrap", 0, 200, { style, children: [named("a", 0, 100, "a"), named("b", 100, 200, "b")] })],
          }),
        ).toEqual([]);
      }
    });

    it("carries a last child's break-after out through an inline that holds it", () => {
      // `block-in-inline-015`: the block splits the inline, so its forced
      // break is a break between the inline and the next one.
      expect(
        forcedAt({
          id: "root",
          rect: blockRect(0, 200),
          children: [
            box("i1", 0, 100, {
              style: { display: "inline" },
              children: [box("brk", 0, 100, { style: { "break-after": "page" } })],
            }),
            box("i2", 100, 200, { style: { display: "inline" }, children: [box("h", 100, 200)] }),
          ],
        }),
      ).toEqual([100]);
    });

    it("names the page after each break, and the page the content starts on", () => {
      const m = fakeMeasurer({
        id: "root",
        rect: blockRect(0, 200),
        children: [named("one", 0, 100, "a"), named("two", 100, 200, "b")],
      });
      let start: string | undefined;
      const [c] = enumerateCandidates(m.root, { measurer: m.measurer, onStartPage: (p) => (start = p) });
      expect(start).toBe("a");
      expect(c?.page).toBe("b");
    });
  });

  it("does not charge for an avoid the element is too tall to honour", () => {
    // A table 610px tall in a 567px area is going to be split whatever anyone
    // wants; charging for it buys white space on the page before and the split
    // on the page after (`splits/tables/long-table`).
    const tall: FakeBox = {
      id: "root",
      rect: blockRect(0, 700),
      children: [
        box("p", 0, 100),
        box("table", 100, 700, {
          style: { "break-inside": "avoid" },
          children: [box("r1", 100, 400), box("r2", 400, 700)],
        }),
      ],
    };

    const unbounded = enumerateCandidates(fakeMeasurer(tall).root, {
      measurer: fakeMeasurer(tall).measurer,
    });
    const bounded = enumerateCandidates(fakeMeasurer(tall).root, {
      measurer: fakeMeasurer(tall).measurer,
      fragmentainer: 567,
    });

    const inside = (cs: typeof unbounded) => cs.find((c) => c.extent === 400)?.penalty;
    expect(inside(unbounded)).toBe(PENALTIES.betweenBlocks + PENALTIES.insideAvoid);
    expect(inside(bounded)).toBe(PENALTIES.betweenBlocks);
  });
});
describe("slices (doc/review.md §4)", () => {
  // A 300px page, and a box that crosses its end at 300.
  const page = (child: FakeBox): FakeMeasurer => fakeMeasurer({ id: "root", rect: blockRect(0, 1000), children: [child] });
  const slices = (m: FakeMeasurer) =>
    enumerateCandidates(m.root, {
      measurer: m.measurer,
      limit: 300,
      rangeFor: (el) => m.range((el as unknown as { __box: string }).__box),
    }).filter((c) => c.kind === "slice");

  it("slices a box whose content ended before the page did, where the page ends", () => {
    const m = page(box("tall", 0, 900, { children: [box("line", 0, 20)] }));
    const [slice] = slices(m);
    expect(slice?.extent).toBe(300);
    expect(slice?.position.slice).toBe(300);
    expect(slice?.penalty).toBe(PENALTIES.betweenBlocks);
  });

  it("does not slice a box whose content crosses the page end; its content has the breaks", () => {
    const m = page(box("section", 0, 900, { children: [box("p1", 0, 280), box("p2", 280, 900)] }));
    expect(slices(m).map((c) => positionKey(c.position))).toEqual(["0.1+0@20"]);
  });

  it("slices monolithic content at a cost no page's worth of white space reaches", () => {
    const m = page(box("img", 100, 900, { tag: "img" }));
    const [slice] = slices(m);
    expect(slice?.position.slice).toBe(200);
    expect(slice?.penalty).toBe(PENALTIES.sliceMonolithic);
  });

  it("does not slice a box that merely ends in its padding below its last line", () => {
    const m = page(box("p", 0, 310, { lines: lineStack(1, 20, 280), style: { "padding-block-end": "10px" } }));
    expect(slices(m)).toEqual([]);
  });

  it("does not slice a table cell stretched beside a taller one", () => {
    const m = page(box("cell", 0, 900, { children: [box("text", 0, 20)], style: { display: "table-cell" } }));
    expect(slices(m)).toEqual([]);
  });

  it("does not slice below where a box around it clips", () => {
    const m = page(
      box("clip", 0, 250, {
        style: { "overflow-y": "clip" },
        children: [box("tall", 0, 900, { children: [box("line", 0, 20)] })],
      }),
    );
    expect(slices(m)).toEqual([]);
  });

  it("offers nothing without a limit", () => {
    const m = page(box("tall", 0, 900, { children: [box("line", 0, 20)] }));
    expect(enumerateCandidates(m.root, { measurer: m.measurer }).filter((c) => c.kind === "slice")).toEqual([]);
  });
});
