import { describe, expect, it } from "vitest";
import type { PageRecord, PageSpec, Position } from "@truke/folio";
import { diffSnapshots, positionKey, serialize, snapshotPages } from "./snapshot.js";

const pos = (path: number[], offset = 0, after = false): Position => ({
  path,
  offset,
  after,
});

const spec = (index: number, over: Partial<PageSpec> = {}): PageSpec => ({
  index,
  name: null,
  side: index % 2 === 0 ? "left" : "right",
  blank: false,
  size: [816, 1056],
  margins: { blockStart: 96, blockEnd: 96, inlineStart: 96, inlineEnd: 96 },
  bleed: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  marks: { crop: false, cross: false },
  ...over,
});

const page = (index: number, start: Position, end: Position, over: Partial<PageRecord> = {}): PageRecord => ({
  spec: spec(index),
  start,
  end,
  refs: new Set(),
  provides: new Set(),
  ...over,
});

describe("positionKey", () => {
  it("is one comparable string", () => {
    expect(positionKey(pos([0, 3, 1], 12))).toBe("0.3.1+12");
    expect(positionKey(pos([0, 3, 1], 12, true))).toBe("0.3.1+12^");
  });

  it("distinguishes before and after the same offset", () => {
    expect(positionKey(pos([1], 0))).not.toBe(positionKey(pos([1], 0, true)));
  });
});

describe("snapshotPages", () => {
  it("sorts refs and provides, so Set order cannot leak into the snapshot", () => {
    const records = [
      page(1, pos([0]), pos([2]), {
        refs: new Set(["fig-2", "eq-1", "sec-3"]),
        provides: new Set(["p-b", "p-a"]),
      }),
    ];

    const snap = snapshotPages(records);

    expect(snap.pages[0]?.refs).toEqual(["eq-1", "fig-2", "sec-3"]);
    expect(snap.pages[0]?.provides).toEqual(["p-a", "p-b"]);
  });

  it("is stable: the same records serialize identically", () => {
    const build = (): PageRecord[] => [
      page(1, pos([0]), pos([2]), { refs: new Set(["b", "a"]) }),
      page(2, pos([2]), pos([5])),
    ];
    expect(serialize(snapshotPages(build()))).toBe(serialize(snapshotPages(build())));
  });
});

describe("diffSnapshots", () => {
  const base = snapshotPages([page(1, pos([0]), pos([2])), page(2, pos([2]), pos([5]))]);

  it("finds nothing when nothing moved", () => {
    expect(diffSnapshots(base, base)).toEqual([]);
  });

  it("reports a moved break as a field difference, with both values", () => {
    const moved = snapshotPages([page(1, pos([0]), pos([3])), page(2, pos([3]), pos([5]))]);

    const diffs = diffSnapshots(base, moved);

    expect(diffs).toContainEqual({
      kind: "field",
      index: 1,
      field: "end",
      expected: "2+0",
      actual: "3+0",
    });
  });

  it("reports a page-count change and the page that is gone", () => {
    const shorter = snapshotPages([page(1, pos([0]), pos([5]))]);

    const diffs = diffSnapshots(base, shorter);

    expect(diffs).toContainEqual({ kind: "page-count", expected: 2, actual: 1 });
    expect(diffs).toContainEqual({ kind: "missing-page", index: 2 });
  });

  it("reports an added page", () => {
    const longer = snapshotPages([
      page(1, pos([0]), pos([2])),
      page(2, pos([2]), pos([4])),
      page(3, pos([4]), pos([5])),
    ]);

    expect(diffSnapshots(base, longer)).toContainEqual({ kind: "extra-page", index: 3 });
  });
});
