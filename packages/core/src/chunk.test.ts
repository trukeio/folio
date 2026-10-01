import { describe, expect, it } from "vitest";
import { chunkFrom } from "./chunk.js";
import type { Position } from "./types.js";

/**
 * A synthetic tree, because layer 1 has no DOM (`doc/plan.md` §9).
 *
 * The walk is the part of `chunk.ts` worth testing here: it maintains a path
 * by hand while moving in document order, and a path that drifts by one is
 * invisible downstream — `paginate.ts` grows a chunk that came out short and
 * the page is decided the same way, so the corpus cannot see the bug.
 */
type Fake = {
  childNodes: Fake[];
  parentNode: Fake | null;
  firstChild: Fake | null;
  nextSibling: Fake | null;
  nodeType: number;
  textContent: string | null;
  name: string;
};

const text = (s: string): Fake => node(3, "#text", [], s);
const el = (name: string, children: Fake[]): Fake => node(1, name, children, null);

function node(nodeType: number, name: string, children: Fake[], data: string | null): Fake {
  const self: Fake = {
    nodeType,
    name,
    childNodes: children,
    parentNode: null,
    firstChild: children[0] ?? null,
    nextSibling: null,
    textContent: data,
  };
  children.forEach((child, i) => {
    child.parentNode = self;
    child.nextSibling = children[i + 1] ?? null;
  });
  if (data === null) {
    self.textContent = children.map((c) => c.textContent ?? "").join("");
  }
  return self;
}

const at = (path: number[], offset = 0, after = false): Position => ({ path, offset, after });
const START = at([]);

/** Four paragraphs of ten characters each. */
const flat = () =>
  el("root", [
    el("p", [text("aaaaaaaaaa")]),
    el("p", [text("bbbbbbbbbb")]),
    el("p", [text("cccccccccc")]),
    el("p", [text("dddddddddd")]),
  ]);

// The tree is a Fake, not a DOM node; `chunkFrom` is written against the
// structural shape both satisfy.
const chunk = (root: Fake, start: Position, budget: number, coupled?: (n: unknown) => boolean) =>
  chunkFrom(root, start, budget, coupled === undefined ? {} : { coupled });

describe("chunkFrom", () => {
  it("ends inside the text node that exhausts the budget", () => {
    const { end, characters } = chunk(flat(), START, 25);
    expect(end).toEqual(at([2, 0], 5));
    expect(characters).toBe(25);
  });

  it("reports the whole remainder when the document ends first", () => {
    const { end, characters } = chunk(flat(), START, 400);
    expect(end).toBeNull();
    expect(characters).toBe(40);
  });

  it("counts from an offset inside the starting text node", () => {
    // Six characters left of the first paragraph, then ten of the second:
    // the budget runs out four characters into the third.
    const { end } = chunk(flat(), at([0, 0], 4), 20);
    expect(end).toEqual(at([2, 0], 4));
  });

  it("skips the subtree a start position sits after", () => {
    const { end, characters } = chunk(flat(), at([0], 0, true), 15);
    expect(end).toEqual(at([2, 0], 5));
    expect(characters).toBe(15);
  });

  it("descends and climbs, keeping the path in step", () => {
    const tree = el("root", [
      el("section", [el("h2", [text("head")]), el("p", [text("body text")])]),
      el("section", [el("p", [text("second section")])]),
    ]);
    // 4 + 9 = 13 characters in the first section, so 16 lands three into the
    // second section's only paragraph.
    expect(chunk(tree, START, 16).end).toEqual(at([1, 0, 0], 3));
  });

  it("does not end inside a width-coupled container", () => {
    const tree = el("root", [
      el("p", [text("aaaaaaaaaa")]),
      el("table", [el("tr", [text("bbbbbbbbbb")]), el("tr", [text("cccccccccc")])]),
      el("p", [text("dddddddddd")]),
    ]);
    // The budget runs out inside the table's second row; the chunk takes the
    // whole table instead, or the browser resolves its columns from half of
    // the rows and every row above the cut changes height.
    const { end } = chunk(tree, START, 25, (n) => (n as Fake).name === "table");
    expect(end).toEqual(at([1], 0, true));
  });

  it("clears the outermost coupled container, not the innermost", () => {
    const tree = el("root", [
      el("table", [el("tr", [el("td", [el("table", [el("tr", [text("aaaaaaaaaa")])])])])]),
      el("p", [text("bbbbbbbbbb")]),
    ]);
    const { end } = chunk(tree, START, 5, (n) => (n as Fake).name === "table");
    expect(end).toEqual(at([0], 0, true));
  });

  it("reports the whole remainder for a start that does not resolve", () => {
    expect(chunk(flat(), at([9, 9]), 10).end).toBeNull();
  });
});
