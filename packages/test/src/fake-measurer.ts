/**
 * A `Measurer` over synthetic boxes (`doc/plan.md` §9, layer 1).
 *
 * Break selection, penalties, widows and orphans, forced breaks and the
 * reference loop are all decided from numbers. Given fake numbers they can be
 * tested with no browser, deterministically and in milliseconds — which is the
 * layer Paged.js does not have, and the reason the harness comes before the
 * engine.
 *
 * It also counts reads. "Render a chunk, then search" (§3) and the batched
 * `boxes()` of §7 are performance claims, and a claim that is not asserted is
 * a claim that quietly stops being true.
 */
import type { Measurer, Rect } from "@truke/folio";

/** A node in a synthetic box tree. */
export type FakeBox = {
  id: string;
  rect: Rect;
  /** Element name, so enumeration can recognise a heading. Default "div". */
  tag?: string;
  /** Line boxes, for a node holding text. Returned by `lineBoxes()`. */
  lines?: Rect[];
  /** Values `styleOf()` may return, including `--x-*` carriers (§5). */
  style?: Record<string, string>;
  /**
   * The node's own text. Math break candidates are classified by the
   * character an `<mo>` holds (`math.md` §4), so a synthetic tree that cannot
   * hold text cannot test them.
   */
  text?: string;
  /** Attributes the walk reads, such as `stretchy` on a fence. */
  attrs?: Record<string, string>;
  children?: FakeBox[];
};

/** What the measurer was asked to do, so tests can assert on read behaviour. */
export type ReadStats = {
  /** Calls to `box()` — one element, one read. */
  single: number;
  /** Calls to `boxes()` — a batch, however many elements it held. */
  batched: number;
  /** Elements passed through `boxes()` in total. */
  batchedElements: number;
  lineBoxes: number;
  styleOf: number;
};

export type FakeMeasurer = {
  measurer: Measurer;
  /**
   * The stand-in `Element` for a box id. It is a real tree node — it has
   * `childNodes`, `parentNode` and `tagName` — because the fragmenter walks
   * the tree as well as measuring it, and a handle that cannot be walked can
   * only test half of it.
   */
  el(id: string): Element;
  /** The root element of the synthetic tree. */
  root: Element;
  /** A stand-in `Range` over a box's text. */
  range(id: string): Range;
  stats: Readonly<ReadStats>;
  resetStats(): void;
};

/** Build a measurer over a synthetic tree. Ids must be unique. */
type FakeNode = {
  nodeType: number;
  tagName: string;
  /** What the math modules match on: a MathML element in an HTML document
   * keeps its written case in `tagName`, so only this one is dependable. */
  localName: string;
  childNodes: FakeNode[];
  parentNode: FakeNode | null;
  readonly textContent: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  __box: string;
};

export function fakeMeasurer(root: FakeBox): FakeMeasurer {
  const byId = new Map<string, FakeBox>();
  const nodes = new Map<string, FakeNode>();
  const boxOfNode = new Map<FakeNode, FakeBox>();

  const walk = (b: FakeBox, parent: FakeNode | null): FakeNode => {
    if (byId.has(b.id)) throw new Error(`duplicate box id: ${b.id}`);
    byId.set(b.id, b);
    const node: FakeNode = {
      nodeType: 1,
      tagName: (b.tag ?? "div").toUpperCase(),
      localName: (b.tag ?? "div").toLowerCase(),
      childNodes: [],
      parentNode: parent,
      get textContent(): string {
        if (b.text !== undefined) return b.text;
        return node.childNodes.map((c) => c.textContent).join("");
      },
      getAttribute: (name) => b.attrs?.[name] ?? null,
      hasAttribute: (name) => b.attrs?.[name] !== undefined,
      __box: b.id,
    };
    nodes.set(b.id, node);
    boxOfNode.set(node, b);
    for (const c of b.children ?? []) node.childNodes.push(walk(c, node));
    return node;
  };
  const rootNode = walk(root, null);

  const stats: ReadStats = {
    single: 0,
    batched: 0,
    batchedElements: 0,
    lineBoxes: 0,
    styleOf: 0,
  };

  const boxOf = (handle: unknown): FakeBox => {
    const id = (handle as { __box?: string } | null)?.__box;
    if (id === undefined) throw new Error("not a fake element");
    const box = byId.get(id);
    if (box === undefined) throw new Error(`unknown box: ${id}`);
    return box;
  };

  const measurer: Measurer = {
    box(el) {
      stats.single += 1;
      return boxOf(el).rect;
    },
    boxes(els) {
      stats.batched += 1;
      stats.batchedElements += els.length;
      return els.map((el) => boxOf(el).rect);
    },
    lineBoxes(range) {
      stats.lineBoxes += 1;
      const box = boxOf((range as unknown as { __over: unknown }).__over);
      if (box.lines === undefined) {
        throw new Error(`box ${box.id} has no line boxes`);
      }
      return box.lines;
    },
    styleOf(el, props) {
      stats.styleOf += 1;
      const style = boxOf(el).style ?? {};
      const out: Record<string, string> = {};
      for (const p of props) out[p] = style[p] ?? "";
      return out;
    },
  };

  const el = (id: string): Element => {
    const node = nodes.get(id);
    if (node === undefined) throw new Error(`unknown box: ${id}`);
    return node as unknown as Element;
  };

  return {
    measurer,
    el,
    root: rootNode as unknown as Element,
    range: (id) => ({ __over: el(id) }) as unknown as Range,
    stats,
    resetStats() {
      stats.single = 0;
      stats.batched = 0;
      stats.batchedElements = 0;
      stats.lineBoxes = 0;
      stats.styleOf = 0;
    },
  };
}

/** A `Rect` from block-axis extents, for tests that only care about height. */
export function blockRect(
  blockStart: number,
  blockEnd: number,
  inline: [number, number] = [0, 100],
): Rect {
  return {
    blockStart,
    blockEnd,
    inlineStart: inline[0],
    inlineEnd: inline[1],
  };
}

/** `count` stacked line boxes of `height`, starting at `from`. */
export function lineStack(count: number, height: number, from = 0): Rect[] {
  return Array.from({ length: count }, (_, i) =>
    blockRect(from + i * height, from + (i + 1) * height),
  );
}

/** A `Rect` from inline-axis extents, for the math tests, where the block
 * axis is the one that does not matter. */
export function inlineRect(
  inlineStart: number,
  inlineEnd: number,
  block: [number, number] = [0, 20],
): Rect {
  return {
    blockStart: block[0],
    blockEnd: block[1],
    inlineStart,
    inlineEnd,
  };
}
