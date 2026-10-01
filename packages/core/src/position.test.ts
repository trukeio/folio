import { describe, expect, it } from "vitest";
import {
  comparePositions,
  elementPath,
  isBefore,
  positionKey,
  positionOf,
  resolve,
} from "./position.js";
import type { Position } from "./types.js";

/** A synthetic tree: positions are tree arithmetic, so no DOM is needed. */
type Fake = { childNodes: Fake[]; parentNode: Fake | null; nodeType: number; name: string };

const el = (name: string, ...children: Fake[]): Fake => {
  const node: Fake = { childNodes: children, parentNode: null, nodeType: 1, name };
  for (const c of children) c.parentNode = node;
  return node;
};
const text = (name: string): Fake => ({ childNodes: [], parentNode: null, nodeType: 3, name });

//  root
//   ├─ h1          [0]
//   │   └─ "Title" [0,0]
//   ├─ p           [1]
//   │   ├─ "a"     [1,0]
//   │   ├─ em      [1,1]
//   │   └─ "b"     [1,2]
//   └─ div         [2]
const title = text("Title");
const a = text("a");
const em = el("em");
const b = text("b");
const h1 = el("h1", title);
const p = el("p", a, em, b);
const div = el("div");
const root = el("root", h1, p, div);

const pos = (path: number[], offset = 0, after = false): Position => ({ path, offset, after });

describe("positionOf", () => {
  it("is the path of child indices from the root", () => {
    expect(positionOf(b, root)).toEqual(pos([1, 2]));
    expect(positionOf(title, root)).toEqual(pos([0, 0]));
    expect(positionOf(div, root)).toEqual(pos([2]));
  });

  it("indexes childNodes, so a text node is addressable", () => {
    // em is the second *element* but the second childNode index is 1.
    expect(positionOf(em, root).path).toEqual([1, 1]);
  });

  it("carries a text offset", () => {
    expect(positionOf(a, root, { offset: 3 })).toEqual(pos([1, 0], 3));
  });

  it("gives the root the empty path", () => {
    expect(positionOf(root, root)).toEqual(pos([]));
  });

  it("refuses a node outside the root", () => {
    expect(() => positionOf(el("stray"), root)).toThrow(/not a descendant/);
  });
});

describe("resolve", () => {
  it("round-trips with positionOf", () => {
    for (const node of [title, a, em, b, h1, p, div]) {
      expect(resolve(root, positionOf(node, root))).toBe(node);
    }
  });

  it("returns null when the tree no longer has that child", () => {
    expect(resolve(root, pos([9]))).toBeNull();
    expect(resolve(root, pos([1, 7]))).toBeNull();
  });
});

describe("comparePositions", () => {
  it("orders siblings by index", () => {
    expect(isBefore(pos([0]), pos([1]))).toBe(true);
    expect(isBefore(pos([1, 0]), pos([1, 2]))).toBe(true);
  });

  it("orders by text offset within one node", () => {
    expect(isBefore(pos([1, 0], 2), pos([1, 0], 5))).toBe(true);
    expect(comparePositions(pos([1, 0], 5), pos([1, 0], 5))).toBe(0);
  });

  it("puts an ancestor before its descendants", () => {
    expect(isBefore(pos([1]), pos([1, 0]))).toBe(true);
  });

  it("puts a slice of a box after its start and its content, in order, and before its end", () => {
    const slice = (at: number): Position => ({ ...pos([1]), slice: at });
    expect(isBefore(pos([1]), slice(300))).toBe(true);
    expect(isBefore(pos([1, 4], 10), slice(300))).toBe(true);
    expect(isBefore(slice(300), slice(600))).toBe(true);
    expect(isBefore(slice(600), pos([1], 0, true))).toBe(true);
    expect(isBefore(slice(600), pos([2]))).toBe(true);
    expect(positionKey(slice(300))).toBe("1+0@300");
  });

  it("puts an `after` ancestor behind its whole subtree", () => {
    // This is why `after` is stored rather than derived: the same path means
    // two different places depending on it.
    expect(isBefore(pos([1], 0, true), pos([1, 2]))).toBe(false);
    expect(isBefore(pos([1, 2]), pos([1], 0, true))).toBe(true);
  });

  it("distinguishes before and after at one node", () => {
    expect(isBefore(pos([1]), pos([1], 0, true))).toBe(true);
  });

  it("puts `after` beyond every offset in the same node, not just offset 0", () => {
    // `after` means past the whole node. Ranking it by offset would place the
    // end of a text node before a position inside it, and a page composed from
    // that range would cut in the wrong place.
    expect(isBefore(pos([1, 0], 20), pos([1, 0], 0, true))).toBe(true);
    expect(isBefore(pos([1, 0], 999), pos([1, 0], 0, true))).toBe(true);
  });

  it("sorts a page's worth of positions into document order", () => {
    const shuffled = [pos([2]), pos([0, 0]), pos([1, 2]), pos([1]), pos([0])];
    const sorted = [...shuffled].sort(comparePositions).map(positionKey);
    expect(sorted).toEqual(["0+0", "0.0+0", "1+0", "1.2+0", "2+0"]);
  });
});

describe("elementPath", () => {
  it("skips text nodes, so a position can be compared with the corpus baseline", () => {
    // em is childNode 1 of p, but element 0 of p.
    expect(elementPath(root, positionOf(em, root))).toEqual([1, 0]);
    expect(elementPath(root, positionOf(div, root))).toEqual([2]);
  });

  it("has no answer for a position inside text", () => {
    expect(elementPath(root, positionOf(b, root))).toBeNull();
  });
});
