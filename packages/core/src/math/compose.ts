/**
 * Breaking a display equation into lines (`doc/math.md` §4, "Composition").
 *
 * The decision is `chooseBreak`, the function pages use; this file is the
 * rewrite that follows it. An equation wider than the measure becomes an
 * `<mtable>` whose rows are the fragments — still one `<math>`, so it stays
 * one accessible tree and one copyable object, and its rows are boxes the
 * vertical fragmenter already handles. If this file starts to contain a layout
 * algorithm the work has gone wrong (`math.md` §2).
 */
import { chooseBreak } from "../select.js";
import { resolve } from "../position.js";
import { mathCandidates, mathChildren, topRow } from "./candidates.js";
import { classifyOperator, MATH_PENALTIES } from "./penalties.js";
import { EQ_CLASS, EQ_NUM_CLASS } from "./number.js";
import type { MathCandidate } from "./candidates.js";
import type { Measurer, Position, Rect } from "../types.js";

/** How many rows a broken equation was composed into; absent when untouched. */
export const MATH_ROWS = "data-x-math-rows";

export type BreakEquationOptions = {
  measurer: Measurer;
  /** The available inline size, in CSS pixels. */
  measure: number;
  /**
   * `math-break-repeat-operator` (`math.md` §4): repeat the broken operator at
   * the start of the continuation row. Off by default, as TeX does it.
   */
  repeatOperator?: boolean;
  /** Indent of a continuation row when there is no relation to align on. */
  indent?: string;
  /** The same indent in pixels, for the arithmetic. 2em at the default size. */
  indentPx?: number;
};

export type BreakResult = {
  /** Rows composed. 1 means the equation was left exactly as it was. */
  rows: number;
  /** True when a row still exceeds the measure and nothing could be done. */
  overflow: boolean;
};

/** A break leaving less than this share of the measure behind is charged the
 * lonely-line penalty: the inline-axis widow rule of `math.md` §4. */
const STUB_SHARE = 0.15;

/**
 * Break `math` if it is wider than the measure. Nothing is measured after the
 * first read: MathML never wraps, so a break at child *i* leaves exactly the
 * width up to *i*, and the rest is arithmetic plus node moving.
 */
export function breakEquation(math: Element, options: BreakEquationOptions): BreakResult {
  const { measurer, measure, repeatOperator = false, indentPx = 32 } = options;

  const rect = measurer.box(math);
  const width = rect.inlineEnd - rect.inlineStart;
  if (width <= measure || measure <= 0) return { rows: 1, overflow: width > measure };

  const candidates = mathCandidates(math, { measurer });
  if (candidates.length === 0) return { rows: 1, overflow: true };

  const breaks = planBreaks(candidates, width, { measure, indentPx });
  if (breaks.length === 0) return { rows: 1, overflow: true };

  const rows = splitIntoRows(math, breaks, repeatOperator);
  compose(math, rows, {
    ...options,
    aligned: alignment(candidates, measure, indentPx).aligned,
  });

  math.setAttribute(MATH_ROWS, String(rows.length));
  // Whether every row now fits is not knowable without measuring again, and
  // the caller measures the page anyway.
  return { rows: rows.length, overflow: false };
}

/**
 * Whether to align on a relation, and how much room that leaves a
 * continuation row. Two columns only while the left one is worth having: a
 * left-hand side past half the measure leaves a right column too narrow to
 * break against, and one column with an indent is what a typesetter does with
 * a long left-hand side.
 */
function alignment(
  candidates: readonly MathCandidate[],
  measure: number,
  indentPx: number,
): { aligned: boolean; gutter: number } {
  const relation = candidates.find((c) => c.depth === 0 && c.operator === "relation");
  if (relation === undefined || relation.extent > measure / 2) {
    return { aligned: false, gutter: indentPx };
  }
  return { aligned: true, gutter: relation.extent };
}

/**
 * Where to break, greedily, left to right: the cheapest break that fits this
 * row, then start again from there. Pure arithmetic over measured candidates,
 * so the inline axis is unit-tested against synthetic boxes as the block axis
 * is.
 *
 * §4's descent rule is enforced here rather than in the penalty: depth 0 is
 * offered alone, and a deeper level only when nothing at the top level fits.
 * Otherwise a nested break that wasted less space could outbid a top-level one
 * and undo the rule the penalties express.
 */
export function planBreaks(
  candidates: readonly MathCandidate[],
  width: number,
  { measure, indentPx = 32 }: { measure: number; indentPx?: number },
): MathCandidate[] {
  // Continuation rows start beneath the alignment point, or indented when
  // there is nothing to align on, so they have less room than the first row.
  // Charging them the full measure would choose breaks for a line that cannot
  // exist.
  const { gutter } = alignment(candidates, measure, indentPx);
  const continuation = gutter < measure ? measure - gutter : measure;

  const maxDepth = candidates.reduce((d, c) => Math.max(d, c.depth), 0);
  const chosen: MathCandidate[] = [];
  let origin = 0;

  while (width - origin > (chosen.length === 0 ? measure : continuation)) {
    const limit = chosen.length === 0 ? measure : continuation;
    const rest = candidates.filter((c) => c.extent > origin);
    if (rest.length === 0) break;

    let taken: MathCandidate | null = null;
    for (let depth = 0; depth <= maxDepth && taken === null; depth++) {
      const pool = rest.filter((c) => c.depth <= depth);
      // The selector sees this row's view — extents from where the row begins
      // — and answers with one of those; what goes on the list is the
      // original, whose extent is a position in the whole equation.
      const offered = pool.map((c) => shift(c, origin, width, limit));
      const choice = chooseBreak(offered, limit);
      // An overflowing choice at depth *d* is not an answer while depth d+1
      // is still unasked; at the last depth it is the least-bad break, which
      // is better than dropping the content.
      if (choice === null) continue;
      if (choice.overflowed && depth < maxDepth) continue;
      taken = pool[offered.indexOf(choice.candidate as MathCandidate)] ?? null;
    }
    if (taken === null) break;

    // No progress means the same break was chosen twice, which would spin.
    if (taken.extent <= origin) break;
    chosen.push(taken);
    origin = taken.extent;
  }

  return chosen;
}

/** A candidate as seen from the start of the current row. */
function shift(
  c: MathCandidate,
  origin: number,
  width: number,
  limit: number,
): MathCandidate {
  const remainder = width - c.extent;
  const stub = remainder > 0 && remainder < limit * STUB_SHARE;
  return {
    ...c,
    extent: c.extent - origin,
    penalty: c.penalty + (stub ? MATH_PENALTIES.lonelyLine : 0),
  };
}

/**
 * Cut the top row into one node list per row. The row is emptied as it goes,
 * so a break inside a nested `<mrow>` splits it in two rather than moving it
 * whole.
 */
function splitIntoRows(
  math: Element,
  breaks: readonly MathCandidate[],
  repeatOperator: boolean,
): Node[][] {
  const row = topRow(math);
  const rows: Node[][] = [];
  let carried: Node | null = null;

  // Every position is resolved before the first cut: a position is child
  // indices, and a cut takes children out of the row, so a later break
  // resolved afterwards named an operator one row further on.
  for (const op of breaks.map((brk) => nodeAt(math, brk.position))) {
    if (op === null || !row.contains(op)) continue;
    const taken = cutFront(row, op);
    if (carried !== null) taken.unshift(carried);
    carried = repeatOperator ? op.cloneNode(true) : null;
    rows.push(taken);
  }

  const rest: Node[] = [...row.childNodes];
  row.replaceChildren();
  if (carried !== null) rest.unshift(carried);
  if (rest.length > 0) rows.push(rest);
  return rows;
}

/** The DOM node a candidate names. `resolve` answers in its structural view of
 * a tree; here that tree really is DOM, and this is where they are one. */
function nodeAt(math: Element, position: Position): Node | null {
  return resolve(math, position) as unknown as Node | null;
}

/** Everything up to and including `op`, removed from `container`. */
function cutFront(container: Element, op: Node): Node[] {
  const taken: Node[] = [];
  while (container.firstChild !== null) {
    const child = container.firstChild;
    if (child === op) {
      container.removeChild(child);
      taken.push(child);
      return taken;
    }
    if (child.nodeType === ELEMENT_NODE && (child as Element).contains(op)) {
      // Split the wrapper: the shell carries its attributes to the upper row
      // and the original keeps the remainder, so nothing inside it moves.
      const shell = child.cloneNode(false) as Element;
      for (const node of cutFront(child as Element, op)) shell.append(node);
      taken.push(shell);
      return taken;
    }
    container.removeChild(child);
    taken.push(child);
  }
  return taken;
}

const ELEMENT_NODE = 1;

/**
 * Put the rows back as an `<mtable>`: two columns when there is a relation to
 * align on — everything up to it right-aligned, the relation and its
 * right-hand side left-aligned, which is TeX's `align` — one column and a
 * fixed indent when there is not.
 */
function compose(
  math: Element,
  rows: readonly Node[][],
  options: BreakEquationOptions & { aligned: boolean },
): void {
  const doc = math.ownerDocument;
  const el = (name: string): Element => doc.createElementNS(MATHML_NS, name);
  const table = el("mtable");
  table.setAttribute("columnalign", options.aligned ? "right left" : "left");
  // An `<mtable>` is compact math-style by default, which would shrink every
  // fraction and every limit the moment an equation broke. This is the CSS
  // MathML Core defines for exactly this, so it costs no engine code.
  table.setAttribute("style", "math-style: normal");
  table.setAttribute("class", "x-eq-rows");

  let passedRelation = false;
  for (const [index, nodes] of rows.entries()) {
    const tr = el("mtr");
    if (options.aligned) {
      const at = firstRelation(nodes);
      const left = el("mtd");
      const right = el("mtd");
      if (at === -1) {
        // Everything before the alignment point is in the left column and
        // everything after it in the right, so a row with no relation of its
        // own goes to whichever side the alignment point has been passed to.
        (passedRelation ? right : left).append(...nodes);
      } else {
        left.append(...nodes.slice(0, at));
        right.append(...nodes.slice(at));
        passedRelation = true;
      }
      tr.append(left, right);
    } else {
      const cell = el("mtd");
      if (index > 0) {
        const space = el("mspace");
        space.setAttribute("width", options.indent ?? MATH_PENALTIES.indent);
        cell.append(space);
      }
      cell.append(...nodes);
      tr.append(cell);
    }
    table.append(tr);
  }

  // `<semantics>` holds the TeX annotation and the `intent` the accessible
  // form depends on (§7). Replace the presentation tree inside it, not it.
  const host = mathChildren(math).find((c) => c.localName === "semantics") ?? math;
  for (const child of [...host.childNodes]) {
    if (child.nodeType === ELEMENT_NODE && (child as Element).localName.startsWith("annotation")) {
      continue;
    }
    host.removeChild(child);
  }
  host.prepend(table);
}

export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/** Where a row's own alignment point is, or -1. */
function firstRelation(nodes: readonly Node[]): number {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Node;
    if (node.nodeType !== ELEMENT_NODE) continue;
    const el = node as Element;
    if (el.localName === "mo" && classifyOperator(el.textContent) === "relation") return i;
  }
  return -1;
}

export type BreakEquationsResult = {
  broken: Element[];
  /** Still wider than their measure: reported rather than hidden. */
  overflowed: Element[];
};

/**
 * Break every display equation in `root` wider than its measure.
 *
 * The measure is the equation's own containing block, not the page's: one in a
 * table cell is bounded by the cell, one beside its number by the middle
 * column of the grid (`math.md` §6). Inline math is left alone — §4 has it
 * overflow and be reported, as an unbreakable long word does, rather than be
 * shrunk out of metric step with the text around it.
 */
export function breakEquations(
  root: Element,
  options: Omit<BreakEquationOptions, "measure"> & { limit?: number },
): BreakEquationsResult {
  const broken: Element[] = [];
  const overflowed: Element[] = [];

  for (const math of root.querySelectorAll("math")) {
    if (math.getAttribute("display") !== "block") continue;
    // The measuring box holds everything that remains, on every page, so
    // breaking all of it is §11's O(n²) with a large constant. An equation
    // below the page cannot move the break above it, so the walk stops there
    // and the next page, which starts higher up, sees it.
    if (options.limit !== undefined && options.measurer.box(math).blockStart > options.limit) {
      break;
    }
    const measure = availableMeasure(math, options.measurer);
    const result = breakEquation(math, { ...options, measure });
    if (result.rows > 1) {
      broken.push(math);
      // So the number aligns to the last row rather than the middle of a stack
      // (§5). An attribute, not `:has()`, which is below the Firefox 115 floor
      // — and only on a wrapper of ours, never on whatever else holds an
      // equation nobody asked to number.
      const wrapper = math.parentElement;
      if (wrapper !== null && wrapper.classList.contains(EQ_CLASS)) {
        wrapper.setAttribute("data-rows", String(result.rows));
      }
    }
    if (result.overflow) overflowed.push(math);
  }

  return { broken, overflowed };
}

/** How much room this equation actually has, read through the `Measurer`. */
function availableMeasure(math: Element, measurer: Measurer): number {
  const parent = math.parentElement;
  if (parent === null) return 0;

  const inline = (r: Rect): number => r.inlineEnd - r.inlineStart;
  const px = (value: string | undefined): number => Number.parseFloat(value ?? "0") || 0;
  const padding = measurer.styleOf(parent, ["padding-inline-start", "padding-inline-end"]);
  const inset = px(padding["padding-inline-start"]) + px(padding["padding-inline-end"]);

  if (!parent.classList.contains(EQ_CLASS)) {
    return inline(measurer.box(parent)) - inset;
  }

  // The number's gutters are `1fr auto 1fr`, so the formula gets the width
  // left after the *wider* gutter is doubled — both are reserved, which is
  // what keeps the formula centred on the measure when the number grows.
  const gutters = [...parent.children].filter((c) => c.classList.contains(EQ_NUM_CLASS));
  const rects = measurer.boxes([parent, ...gutters]);
  const widest = rects.slice(1).reduce((w, r) => Math.max(w, inline(r)), 0);
  return inline(rects[0] as Rect) - inset - 2 * widest;
}

