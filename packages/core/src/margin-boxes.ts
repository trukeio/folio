/**
 * The geometry of the sixteen margin boxes (css-page-3 §5.3).
 *
 * The first version of this was a five-by-five CSS grid with the page margins
 * as its outer tracks, on the argument that it did declaratively what
 * `atpage.js:2079` does in JavaScript. It did not: a grid gives each box on an
 * edge a third of it, where §5.3 gives a box alone on its edge the whole edge,
 * gives two boxes shares proportional to their content, keeps a middle box
 * centred however wide its neighbours are, and resolves `width`, `height` and
 * `auto` margins by an equation the grid never saw. Twenty-eight WPT tests in
 * `css-page/margin-boxes/` failed on the pixels of it (`wpt-failures.md`).
 *
 * So the geometry is §5.3's arithmetic, in two halves. `resolveEdge` and
 * `resolveFixed` are pure functions over outer sizes, unit-tested against the
 * worked numbers in the WPT tests themselves. `layoutMarginBoxes` is the DOM
 * half: it measures the min- and max-content size of every box on a page,
 * runs the arithmetic and writes the result back as absolute geometry.
 *
 * Each box is laid out inside an area that is exactly its containing block —
 * an edge between its two corners, or a corner — so that a percentage, an
 * `em` or a `calc()` in the author's `width` is resolved by the browser, never
 * by us. This is not part of the fragmenter and makes no break decisions:
 * margin boxes are outside the content area, and nothing here can move a
 * break. Deleted when every target browser draws `@page` margin boxes into
 * something a script can put on screen, which nothing plans.
 */

import type { Deletion } from "./native.js";

/** The four edges, and the boxes on each in paint order (§5.3, WPT `paint-order-*`). */
export const EDGES = {
  top: ["top-left", "top-center", "top-right"],
  right: ["right-top", "right-middle", "right-bottom"],
  bottom: ["bottom-right", "bottom-center", "bottom-left"],
  left: ["left-bottom", "left-middle", "left-top"],
} as const;

export type Edge = keyof typeof EDGES;

/**
 * Where every margin box goes, in the order they paint: clockwise from the
 * top left corner. A box with a negative margin overlaps its neighbour, and
 * which one is on top is the spec's, not the author's declaration order.
 */
export const PAINT_ORDER: readonly { area: string; boxes: readonly string[] }[] = [
  { area: "top-left-corner", boxes: ["top-left-corner"] },
  { area: "top", boxes: EDGES.top },
  { area: "top-right-corner", boxes: ["top-right-corner"] },
  { area: "right", boxes: EDGES.right },
  { area: "bottom-right-corner", boxes: ["bottom-right-corner"] },
  { area: "bottom", boxes: EDGES.bottom },
  { area: "bottom-left-corner", boxes: ["bottom-left-corner"] },
  { area: "left", boxes: EDGES.left },
];

/**
 * css-page-3 §6.2, table 2: what a box aligns to when the author says nothing.
 * `[text-align, vertical-align]`.
 */
export function defaultAlignment(name: string): [string, string] {
  if (name.endsWith("-corner")) return [name.includes("left-") ? "right" : "left", "middle"];
  if (name.startsWith("top-") || name.startsWith("bottom-")) {
    const side = name.slice(name.indexOf("-") + 1);
    return [side === "center" ? "center" : side, "middle"];
  }
  const side = name.slice(name.indexOf("-") + 1);
  return ["center", side === "middle" ? "middle" : side];
}

/**
 * Properties a margin box does not have.
 *
 * Appendix A lists the CSS 2.1 properties that apply, and leaves everything
 * newer undefined so that it can be added as it makes sense. A denylist
 * rather than that allowlist, so that `background-image`, `text-overflow` or
 * `border-radius` keep working as they do in Paged.js; what is on it is what
 * would take the box out of the geometry this module computes, or hide it
 * (WPT `inapplicable-properties`).
 */
const INAPPLICABLE =
  /^(display|position|top|right|bottom|left|inset(-.*)?|float|clear|columns?(-.*)?|orphans|widows|transform(-.*)?|rotate|scale|translate|flex(-.*)?|grid(-.*)?|order|align-.*|justify-.*|place-.*|contain|content-visibility)$/;

export function appliesToMarginBox(property: string): boolean {
  return !INAPPLICABLE.test(property);
}

/**
 * One box on an edge, in the variable dimension, as outer sizes: margins,
 * borders and padding included.
 */
export type EdgeBox = {
  /** `width: auto` (or `height`, on a side edge). */
  auto: boolean;
  /** The outer size asked for, when it is not auto. */
  size: number;
  /** Outer min-content and max-content sizes, when it is. */
  min: number;
  max: number;
  /** `min-width` and `max-width`, as outer sizes; absent when not set. */
  floor?: number;
  ceiling?: number;
  /**
   * How many boxes this stands for when there is no content to share by:
   * 2 for the imaginary pair the middle box is sized against.
   */
  weight?: number;
};

/** A box that is not generated: zero wide, and not auto (§5.3.2.2). */
export const ABSENT: EdgeBox = { auto: false, size: 0, min: 0, max: 0 };

/**
 * Share `available` between two boxes (§5.3.2.2, "if the middle box is not
 * generated"). Returns their outer sizes.
 */
function shareTwo(available: number, a: EdgeBox, c: EdgeBox): [number, number] {
  if (!a.auto && !c.auto) return [a.size, c.size];
  if (!a.auto) return [a.size, available - a.size];
  if (!c.auto) return [available - c.size, c.size];

  let base: [number, number];
  let factors: [number, number];
  if (a.max + c.max < available) {
    base = [a.max, c.max];
    factors = [a.max, c.max];
  } else if (a.min + c.min < available) {
    base = [a.min, c.min];
    factors = [a.max - a.min, c.max - c.min];
  } else {
    base = [a.min, c.min];
    factors = [a.min, c.min];
  }
  // Nothing to share by: every box alike, so three empty boxes take a third
  // of the edge each (WPT `dimensions-010`), not half to the middle one.
  if (factors[0] + factors[1] === 0) factors = [a.weight ?? 1, c.weight ?? 1];
  const flex = available - base[0] - base[1];
  const sum = factors[0] + factors[1];
  return [base[0] + (flex * factors[0]) / sum, base[1] + (flex * factors[1]) / sum];
}

/** The same, before `min-width` and `max-width` are applied. */
function tentative(available: number, [a, b, c]: readonly EdgeBox[]): number[] {
  const [left, center, right] = [a ?? ABSENT, b ?? ABSENT, c ?? ABSENT];
  if (center === ABSENT) {
    const [x, z] = shareTwo(available, left, right);
    return [x, 0, z];
  }

  // The middle box's width first, against an imaginary box twice each of its
  // neighbours in turn; the doubled box that comes out wider is the one kept,
  // which is what keeps the middle box centred (§5.3.2.2, and WPT
  // `dimensions-007`'s worked numbers). Twice a fixed box is fixed, and
  // leaves the middle box the rest (`dimensions-011`).
  const double = (box: EdgeBox): EdgeBox => ({
    auto: box.auto,
    size: 2 * box.size,
    min: 2 * outerMin(box),
    max: 2 * outerMax(box),
    weight: 2,
  });
  const against = [left, right].map((box) => shareTwo(available, center, double(box)));
  const [x = [0, 0], z = [0, 0]] = against;
  const middle = center.auto ? (x[1] >= z[1] ? x : z)[0] : center.size;
  const side = (available - middle) / 2;
  return [left.auto ? side : left.size, middle, right.auto ? side : right.size];
}

const outerMin = (box: EdgeBox): number => (box.auto ? box.min : box.size);
const outerMax = (box: EdgeBox): number => (box.auto ? box.max : box.size);

/**
 * The outer sizes of the three boxes on one edge, in paint order's
 * *geometric* order — start, middle, end — with §5.3.2.3's two re-runs for
 * `max-width` and then `min-width`. Boxes that are not generated are
 * `ABSENT` and come back as 0.
 */
export function resolveEdge(available: number, boxes: readonly EdgeBox[]): number[] {
  let current = [...boxes];
  let sizes = tentative(available, current);

  const clamp = (test: (box: EdgeBox, size: number) => number | undefined): void => {
    const next = current.map((box, i) => {
      const to = box === ABSENT ? undefined : test(box, sizes[i] ?? 0);
      return to === undefined ? box : { ...box, auto: false, size: to };
    });
    if (next.some((box, i) => box !== current[i])) sizes = tentative(available, next);
    current = next;
  };
  clamp((box, size) => (box.ceiling !== undefined && size > box.ceiling ? box.ceiling : undefined));
  clamp((box, size) => (box.floor !== undefined && size < box.floor ? box.floor : undefined));
  return sizes;
}

/** Where each box's outer edge starts: flush start, centred, flush end. */
export function placeEdge(available: number, sizes: readonly number[]): number[] {
  const [, b = 0, c = 0] = sizes;
  return [0, (available - b) / 2, available - c];
}

/**
 * One axis of a box in its fixed dimension (§5.3.3): the page margin's depth,
 * and the box's border-box size and two margins, `null` where `auto`.
 */
export type Fixed = { size: number | null; start: number | null; end: number | null };

/**
 * Solve `start + size + end = depth`, as §5.3.3 does.
 *
 * `edge` is the side of the box that faces the edge of the paper: that margin
 * is the one ignored when all three are given. For a top box it is the start
 * (`margin-top`), for a bottom box the end; a corner has one in each axis.
 */
export function resolveFixed(depth: number, box: Fixed, edge: "start" | "end"): Required<{
  [K in keyof Fixed]: number;
}> {
  const { size } = box;
  let { start, end } = box;
  const given = (size ?? 0) + (start ?? 0) + (end ?? 0);
  // Too big already: an auto margin cannot also be negative. (The printable
  // inset is taken to be zero; there is no way for a page to learn it.)
  if (given > depth) {
    start ??= 0;
    end ??= 0;
  }
  if (size !== null && start !== null && end !== null) {
    if (edge === "start") start = null;
    else end = null;
  }

  if (size === null) {
    start ??= 0;
    end ??= 0;
    return { start, end, size: depth - start - end };
  }
  if (start === null && end === null) {
    const each = (depth - size) / 2;
    return { start: each, end: each, size };
  }
  if (start === null) return { start: depth - size - (end ?? 0), end: end ?? 0, size };
  return { start, end: depth - size - start, size };
}

type Axis = "x" | "y";

const SIZE = { x: "width", y: "height" } as const;
const MIN = { x: "min-width", y: "min-height" } as const;
const MAX = { x: "max-width", y: "max-height" } as const;
const START = { x: "left", y: "top" } as const;
const MARGIN_START = { x: "margin-left", y: "margin-top" } as const;
const MARGIN_END = { x: "margin-right", y: "margin-bottom" } as const;

/** What the author wrote on a box, read once before the layout writes over it. */
type Authored = Record<string, string>;

const AUTHORED_PROPERTIES = [
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin-left", "margin-right", "margin-top", "margin-bottom", "box-sizing",
] as const;

const INITIAL: Record<string, string> = {
  width: "auto",
  height: "auto",
  "min-width": "auto",
  "min-height": "auto",
  "max-width": "none",
  "max-height": "none",
  "box-sizing": "",
};

/**
 * The author's own values, as written — `auto`, `20%`, `5em` — or the initial
 * value where they wrote nothing. The computed value would not do:
 * `getComputedStyle` answers `width` in used pixels, and "was this auto?" is
 * the question the algorithm starts with. Kept per element, so that laying a
 * page out a second time (`relayoutAfterImages`) starts from the author's
 * values and not from the first layout's.
 */
const AUTHOR = new WeakMap<HTMLElement, Authored>();

function authoredOf(el: HTMLElement): Authored {
  let saved = AUTHOR.get(el);
  if (saved === undefined) {
    saved = {};
    const logical = logicalNames(el);
    for (const p of AUTHORED_PROPERTIES) {
      // A physical declaration, or the logical one that means the same side
      // in this box's writing mode: `block-size: fit-content` on a
      // vertical-rl box is its width (WPT `dimensions-013`).
      const named = el.style.getPropertyValue(p).trim() || el.style.getPropertyValue(logical[p] ?? "").trim();
      saved[p] = named || (INITIAL[p] ?? "0");
    }
    AUTHOR.set(el, saved);
  }
  return saved;
}

/** The logical property that names each physical one, in the box's writing mode. */
function logicalNames(el: HTMLElement): Record<string, string> {
  const style = getComputedStyle(el);
  const vertical = /^(vertical|sideways)/.test(style.writingMode);
  const rl = /-rl$/.test(style.writingMode);
  const rtl = style.direction === "rtl";
  const [inlineStart, inlineEnd] = rtl ? ["end", "start"] : ["start", "end"];
  if (vertical) {
    return {
      width: "block-size",
      height: "inline-size",
      "min-width": "min-block-size",
      "min-height": "min-inline-size",
      "max-width": "max-block-size",
      "max-height": "max-inline-size",
      "margin-left": rl ? "margin-block-end" : "margin-block-start",
      "margin-right": rl ? "margin-block-start" : "margin-block-end",
      "margin-top": `margin-inline-${inlineStart}`,
      "margin-bottom": `margin-inline-${inlineEnd}`,
    };
  }
  return {
    width: "inline-size",
    height: "block-size",
    "min-width": "min-inline-size",
    "min-height": "min-block-size",
    "max-width": "max-inline-size",
    "max-height": "max-block-size",
    "margin-left": `margin-inline-${inlineStart}`,
    "margin-right": `margin-inline-${inlineEnd}`,
    "margin-top": "margin-block-start",
    "margin-bottom": "margin-block-end",
  };
}

/** One margin box through the layout: what it asked for, and what was measured. */
type Box = {
  el: HTMLElement;
  author: Authored;
  /** Resolved margins, `null` where `auto`. */
  margin: Record<string, number | null>;
  /** Border-box sizes for a specified `width` and `height`. */
  specified: { x: number | null; y: number | null };
  floor: number | null;
  ceiling: number | null;
  min: number;
  max: number;
  /** Vertical writing: its inline axis is `y`, where content sizes are keywords too. */
  vertical: boolean;
};

type EdgeJob = { boxes: (Box | undefined)[]; variable: Axis; available: number };

const isSet = (value: string | undefined): value is string =>
  value !== undefined && value !== "auto" && value !== "none";

/**
 * Lay out the margin boxes of any number of pages, after their content is in.
 *
 * Each map is one page's: a box's name to the element that holds its content,
 * whose parent is the box, whose parent is the area that is the box's
 * containing block. Every read is of the page as the browser laid it out, so
 * the pages must be in a rendered document.
 *
 * **All pages at once, in a handful of passes.** Measuring a box means giving
 * it a width and reading one back, and every read after a write is a layout of
 * the document. A box at a time that was about ten layouts a box; so each pass
 * writes one state to every box on every page and then reads them all — the
 * specified sizes and margins, `min-width`, `max-width`, the min-content and
 * the max-content sizes. Six layouts for a book, not thousands. (The 160
 * seconds Firefox first spent here on `fixtures/book.html` were not these
 * layouts but the engine's discarded ranges; see `scratchRange`.)
 */
export function layoutMarginBoxes(pages: readonly ReadonlyMap<string, HTMLElement>[]): void {
  const edges: EdgeJob[] = [];
  const corners: { box: Box; x: "start" | "end"; y: "start" | "end" }[] = [];
  const fixed: { box: Box; axis: Axis; edge: "start" | "end" }[] = [];
  const all: Box[] = [];

  const box = (inner: HTMLElement | undefined): Box | undefined => {
    const el = inner?.parentElement ?? null;
    if (el === null) return undefined;
    const b: Box = {
      el,
      author: authoredOf(el),
      margin: {},
      specified: { x: null, y: null },
      floor: null,
      ceiling: null,
      min: 0,
      max: 0,
      vertical: false,
    };
    all.push(b);
    return b;
  };

  for (const page of pages) {
    for (const edge of Object.keys(EDGES) as Edge[]) {
      // Geometric order, start to end: paint order runs backwards along the
      // bottom and up the left.
      const names = [...EDGES[edge]];
      if (edge === "bottom" || edge === "left") names.reverse();
      const boxes = names.map((n) => box(page.get(n)));
      if (boxes.every((b) => b === undefined)) continue;
      const horizontal = edge === "top" || edge === "bottom";
      edges.push({ boxes, variable: horizontal ? "x" : "y", available: 0 });
      for (const b of boxes) {
        if (b === undefined) continue;
        fixed.push({
          box: b,
          axis: horizontal ? "y" : "x",
          edge: edge === "top" || edge === "left" ? "start" : "end",
        });
      }
    }
    for (const name of ["top-left-corner", "top-right-corner", "bottom-right-corner", "bottom-left-corner"]) {
      const b = box(page.get(name));
      if (b === undefined) continue;
      const x = name.includes("left-") ? "start" : "end";
      const y = name.startsWith("top-") ? "start" : "end";
      corners.push({ box: b, x, y });
    }
  }
  if (all.length === 0) return;

  // Pass 1: every box at its specified size, in the author's box model, with
  // the margins as written. Nothing here depends on another box.
  for (const b of all) {
    const s = b.el.style;
    for (const p of ["position:absolute", "left:0", "top:0", "right:auto", "bottom:auto"]) {
      const [k, v] = p.split(":") as [string, string];
      s.setProperty(k, v);
    }
    s.setProperty("box-sizing", b.author["box-sizing"] ?? "");
    for (const axis of ["x", "y"] as const) {
      s.setProperty(MIN[axis], "0");
      s.setProperty(MAX[axis], "none");
      s.setProperty(SIZE[axis], b.author[SIZE[axis]] ?? "auto");
      for (const m of [MARGIN_START[axis], MARGIN_END[axis]]) s.setProperty(m, b.author[m] ?? "0");
    }
  }
  const areaSize = new Map<Element, DOMRect>();
  for (const b of all) {
    const area = b.el.parentElement as HTMLElement;
    if (!areaSize.has(area)) areaSize.set(area, area.getBoundingClientRect());
    const rect = b.el.getBoundingClientRect();
    const style = getComputedStyle(b.el);
    b.vertical = /^(vertical|sideways)/.test(style.writingMode);
    for (const axis of ["x", "y"] as const) {
      if (isSet(b.author[SIZE[axis]])) b.specified[axis] = axis === "x" ? rect.width : rect.height;
      for (const m of [MARGIN_START[axis], MARGIN_END[axis]]) {
        // A percentage is of the area on the margin's own axis, as Chromium
        // prints it (WPT `dimensions-012`), where the browser would take
        // both from the area's width.
        const pct = /^(-?[\d.]+)%$/.exec(b.author[m] ?? "")?.[1];
        const along = areaSize.get(area) as DOMRect;
        b.margin[m] =
          b.author[m] === "auto"
            ? null
            : pct !== undefined
              ? (parseFloat(pct) / 100) * (axis === "x" ? along.width : along.height)
              : parseFloat(style.getPropertyValue(m)) || 0;
      }
    }
  }
  for (const job of edges) {
    const first = job.boxes.find((b) => b !== undefined) as Box;
    const r = areaSize.get(first.el.parentElement as HTMLElement) as DOMRect;
    job.available = job.variable === "x" ? r.width : r.height;
  }

  // Passes 2 and 3: `min-width` and `max-width` in the variable dimension,
  // as border-box sizes.
  const variableOf = new Map<Box, Axis>();
  for (const job of edges) for (const b of job.boxes) if (b !== undefined) variableOf.set(b, job.variable);
  const measureAt = (property: (axis: Axis) => string, keep: (b: Box, size: number) => void): void => {
    const which = all.filter((b) => {
      const axis = variableOf.get(b);
      return axis !== undefined && isSet(b.author[property(axis)]) && parseFloat(b.author[property(axis)] ?? "") !== 0;
    });
    for (const b of which) {
      const axis = variableOf.get(b) as Axis;
      b.el.style.setProperty(SIZE[axis], b.author[property(axis)] ?? "auto");
    }
    for (const b of which) keep(b, extent(b.el, variableOf.get(b) as Axis));
    for (const b of which) {
      const axis = variableOf.get(b) as Axis;
      b.el.style.setProperty(SIZE[axis], b.author[SIZE[axis]] ?? "auto");
    }
  };
  measureAt((axis) => MIN[axis], (b, size) => (b.floor = size));
  measureAt((axis) => MAX[axis], (b, size) => (b.ceiling = size));

  // The fixed dimension (§5.3.3), for edge boxes and both axes of a corner:
  // pure arithmetic on pass 1, written as border-box sizes.
  const writeFixed = (b: Box, axis: Axis, depth: number, edge: "start" | "end"): void => {
    const used = resolveFixed(
      depth,
      {
        size: b.specified[axis],
        start: b.margin[MARGIN_START[axis]] ?? null,
        end: b.margin[MARGIN_END[axis]] ?? null,
      },
      edge,
    );
    write(b.el, axis, 0, used.start, used.size, used.end);
  };
  for (const f of fixed) {
    const r = areaSize.get(f.box.el.parentElement as HTMLElement) as DOMRect;
    writeFixed(f.box, f.axis, f.axis === "x" ? r.width : r.height, f.edge);
  }
  for (const c of corners) {
    const r = areaSize.get(c.box.el.parentElement as HTMLElement) as DOMRect;
    writeFixed(c.box, "x", r.width, c.x);
    writeFixed(c.box, "y", r.height, c.y);
  }

  // Passes 4 and 5: content sizes in the variable dimension, with that
  // dimension's margins out of the way (auto margins there are zero,
  // §5.3.2.1). A top box's min-content and max-content widths; a side box's
  // height at the width it now has, which is one height for both — unless
  // its writing is vertical, when height is its inline size and has both
  // (WPT `dimensions-006`).
  const auto = [...variableOf].filter(([b, axis]) => !isSet(b.author[SIZE[axis]]));
  const contentPass = (keyword: string, keep: (b: Box, size: number) => void): void => {
    for (const [b, axis] of auto) {
      b.el.style.setProperty(SIZE[axis], axis === "x" || b.vertical ? keyword : "auto");
      b.el.style.setProperty(MARGIN_START[axis], "0");
      b.el.style.setProperty(MARGIN_END[axis], "0");
    }
    for (const [b, axis] of auto) keep(b, extent(b.el, axis));
  };
  contentPass("min-content", (b, size) => (b.min = size));
  contentPass("max-content", (b, size) => (b.max = size));

  for (const job of edges) {
    const outer = (b: Box, axis: Axis): number =>
      (b.margin[MARGIN_START[axis]] ?? 0) + (b.margin[MARGIN_END[axis]] ?? 0);
    const measured = job.boxes.map((b): EdgeBox => {
      if (b === undefined) return ABSENT;
      const m = outer(b, job.variable);
      const specified = b.specified[job.variable];
      const e: EdgeBox =
        specified === null
          ? { auto: true, size: 0, min: b.min + m, max: b.max + m }
          : { auto: false, size: specified + m, min: 0, max: 0 };
      if (b.floor !== null) e.floor = b.floor + m;
      if (b.ceiling !== null) e.ceiling = b.ceiling + m;
      return e;
    });
    const sizes = resolveEdge(job.available, measured);
    const starts = placeEdge(job.available, sizes);
    job.boxes.forEach((b, i) => {
      if (b === undefined) return;
      const before = b.margin[MARGIN_START[job.variable]] ?? 0;
      const after = b.margin[MARGIN_END[job.variable]] ?? 0;
      write(b.el, job.variable, starts[i] ?? 0, before, (sizes[i] ?? 0) - before - after, after);
    });
  }

  for (const b of all) alignContent(b.el);
}

function extent(el: HTMLElement, axis: Axis): number {
  const r = el.getBoundingClientRect();
  return axis === "x" ? r.width : r.height;
}

/** Put the used values on the box: its outer edge at `at`, then margin, border box, margin. */
function write(el: HTMLElement, axis: Axis, at: number, before: number, size: number, after: number): void {
  el.style.setProperty("box-sizing", "border-box");
  el.style.setProperty(START[axis], `${String(at)}px`);
  el.style.setProperty(MARGIN_START[axis], `${String(before)}px`);
  el.style.setProperty(MARGIN_END[axis], `${String(after)}px`);
  el.style.setProperty(SIZE[axis], `${String(Math.max(0, size))}px`);
  // Already accounted for; left on, they would clamp the result a second time.
  el.style.setProperty(MIN[axis], "0");
  el.style.setProperty(MAX[axis], "none");
}

/**
 * `vertical-align` on a margin box "behaves as specified for table cells"
 * (§6): it places the content in the box. The box is a column, and the
 * content is moved along it; `text-align` inherits into the content as it is.
 */
function alignContent(el: HTMLElement): void {
  const align = el.style.getPropertyValue("vertical-align").trim();
  const justify = align === "bottom" ? "flex-end" : align === "middle" ? "center" : "flex-start";
  el.style.setProperty("display", "flex");
  el.style.setProperty("flex-direction", "column");
  el.style.setProperty("justify-content", justify);
}

/**
 * Lay the margin boxes out again once the images in them have loaded.
 *
 * `content: url(logo.png)` is an image in the line, and the first layout ran
 * before it had a size: a box's share of its edge is proportional to what is
 * in it, and an image that has not loaded is nothing. Pagination is
 * synchronous and cannot wait, and nothing it decides depends on a margin
 * box, so the wait is here, after it and before the pages are shown.
 */
export async function relayoutAfterImages(sheets: readonly HTMLElement[]): Promise<void> {
  const pages: Map<string, HTMLElement>[] = [];
  const loading: Promise<unknown>[] = [];
  for (const sheet of sheets) {
    const images = [...sheet.querySelectorAll<HTMLImageElement>("folio-margin-content img")];
    if (images.length === 0) continue;
    loading.push(...images.map((img) => img.decode().catch(() => undefined)));
    const boxes = new Map<string, HTMLElement>();
    for (const inner of sheet.querySelectorAll<HTMLElement>("folio-margin-content")) {
      const name = /(?:^| )folio-margin-([\w-]+)/.exec(inner.parentElement?.className ?? "")?.[1];
      if (name !== undefined) boxes.set(name, inner);
    }
    pages.push(boxes);
  }
  if (pages.length === 0) return;
  await Promise.all(loading);
  layoutMarginBoxes(pages);
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "margin boxes",
  files: ["margin-boxes.ts"],
  feature: "`@page` margin boxes and their geometry (css-page-3 §5.3)",
  when: "Every target browser draws `@page` margin boxes into something a script can show",
  tests: [/^css\/css-page\/margin-boxes\//],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
