/**
 * Enumerating break candidates (`doc/plan.md` §3).
 *
 * "Record every allowed break with a cost: `avoid` rules, widows and orphans,
 * a heading kept with its next block."
 *
 * This is the one place that reads the tree and the one place that reads
 * layout, and it reads layout only through `Measurer` — so the costs it
 * produces can be checked against synthetic boxes, with no browser and no
 * guessing about what a real engine would have done.
 *
 * It takes an axis. For a page that is the block axis; for a display equation
 * wider than the measure it is the inline axis (§7), and nothing below names a
 * direction.
 */
import { FORCED, PENALTIES, PROHIBITED, widowOrphanPenalty } from "./penalties.js";
import { comparePositions, positionOf } from "./position.js";
import { offsetAtLine } from "./text.js";
import { carrierName } from "./css/rewrite.js";
import { MATH_ROWS, MATHML_NS } from "./math/compose.js";
import { SLICED } from "./compose.js";
import type { Candidate } from "./penalties.js";
import type { TextRanges } from "./text.js";
import type { Axis, Measurer, Position, Rect } from "./types.js";
import { scratchRange } from "./dom-measurer.js";

const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/** The carrier the `page` property is cascaded through (§5). */
const PAGE_CARRIER = carrierName("page");

/** Values of `break-before`/`break-after` that must be obeyed (CSS Break 3). */
const FORCED_VALUES = new Set(["page", "always", "left", "right", "recto", "verso", "column"]);

export type EnumerateOptions = {
  measurer: Measurer;
  /** Which axis is being fragmented. Default "block". */
  axis?: Axis;
  /** Build a range over an element's text, for line boxes. */
  rangeFor?: (el: Element) => Range;
  /**
   * How to address the element's text by character. Given this, a line
   * candidate carries the character offset it breaks at; without it, only the
   * line number (M1.4).
   */
  textRanges?: TextRanges;
  widows?: number;
  orphans?: number;
  /** How deep to descend. Blocks below this are atomic. */
  maxDepth?: number;
  /**
   * The fragmentainer's extent, if the caller knows it.
   *
   * Only used to notice that a `break-inside: avoid` cannot be honoured: an
   * element taller than a whole page is going to be split whatever anyone
   * wants, and charging for breaks inside it buys nothing. A table with
   * `break-inside: avoid` that is 610px tall in a 567px area cost a corpus
   * page 240px of white space and was split on the next page anyway.
   */
  fragmentainer?: number;
  /** Told the named page the content starts on ("" for none): page one's name. */
  onStartPage?: (page: string) => void;
  /**
   * Where the page ends, if the caller knows. A box that crosses it with
   * nothing left to break between — monolithic, or only empty extent left —
   * offers a slice there (`doc/review.md` §4).
   */
  limit?: number;
};

const endOf = (rect: Rect, axis: Axis): number =>
  axis === "block" ? rect.blockEnd : rect.inlineEnd;
const startOf = (rect: Rect, axis: Axis): number =>
  axis === "block" ? rect.blockStart : rect.inlineStart;

/**
 * What a box presents to the siblings either side of it (`review.md` §2
 * §3): the named page it starts and ends on, and the forced break before and
 * after it. A block container takes these from its first and last in-flow
 * children, which is how CSS Paged Media 3 propagates a page name and CSS
 * Break 3 §4.2 propagates `break-before` and `break-after`.
 */
type Edges = { start: string; end: string; before: string | null; after: string | null };

/** What a visited element reports to its parent; `end`, where its content's ink ends. */
type Inner = { first: Edges | null; last: Edges | null; blocks: boolean; end: number };

/**
 * Every allowed break inside `root`, in document order, each with its cost.
 *
 * Costs compose: a break between two lines inside an `avoid` block that also
 * orphans a line pays for all three, which is what makes the cheapest-that-fits
 * rule of §3 do something sensible without special cases.
 */
export function enumerateCandidates(root: Element, options: EnumerateOptions): Candidate[] {
  const {
    measurer,
    axis = "block",
    rangeFor,
    textRanges,
    widows,
    orphans,
    maxDepth = 8,
    fragmentainer,
    onStartPage,
    limit,
  } = options;
  const candidates: Candidate[] = [];
  // The flow the page is cut along (`review.md` §5).
  const rootVertical = /^(vertical|sideways)/.test(measurer.styleOf(root, ["writing-mode"])["writing-mode"] ?? "");

  /**
   * The walk is bottom-up: a gap cannot be decided until the box after it has
   * been visited, because the page it starts on is its first in-flow child's
   * — several levels down, as in the corpus's `div.content > div.preamble`.
   * `flow` says whether this element's content is in the page flow at all
   * (not inside an inline-block or an out-of-flow box); `classA` whether its
   * children are separated by gaps a page name can force (not a flex or grid
   * container's items). WPT's `page-name-*` tests are the rows of both.
   */
  const visit = (
    element: Element,
    depth: number,
    avoidCost: number,
    page: string,
    flow: boolean,
    classA: boolean,
    clipEnd = Number.POSITIVE_INFINITY,
  ): Inner => {
    const children = elementChildren(element);

    // One batched read per level, not one read per node (§3, §7).
    const rects = children.length === 0 ? [] : measurer.boxes(children);
    const styles = children.map((c) =>
      measurer.styleOf(c, [
        "break-before",
        "break-after",
        "break-inside",
        "display",
        "position",
        "float",
        "contain",
        "overflow-y",
        "writing-mode",
        PAGE_CARRIER,
      ]),
    );
    const used = styles.map((s) => usedPage(s[PAGE_CARRIER], page));

    const inner = children.map((child, i): Inner => {
      const style = styles[i] as Record<string, string>;
      const rect = rects[i] as Rect;
      // Monolithic content is one box to the page, sliced whole if it must be
      // (`sliceAt`), never broken between the lines inside it (WPT
      // `monolithic-overflow-031`).
      // An orthogonal flow too: Chromium breaks nowhere inside one, forced or
      // not, and takes no page names from it (WPT
      // `page-name-orthogonal-writing-004`).
      const orthogonal = /^(vertical|sideways)/.test(style["writing-mode"] ?? "") !== rootVertical;
      if (depth + 1 >= maxDepth || atomicMath(child) || monolithic(child, style) || orthogonal) {
        return { first: null, last: null, blocks: false, end: Number.POSITIVE_INFINITY };
      }
      // An `avoid` the element is too tall to honour is not charged for.
      const avoidable =
        fragmentainer === undefined || endOf(rect, axis) - startOf(rect, axis) <= fragmentainer;
      const insideAvoid =
        avoidCost + (style["break-inside"] === "avoid" && avoidable ? PENALTIES.insideAvoid : 0);
      const display = style["display"];
      const childFlow = flow && inFlow(style) && !display?.startsWith("inline-");
      const flexOrGrid = /(^|-)(flex|grid)$/.test(display ?? "");
      const childPage = used[i] ?? page;
      const clips = !/^(visible|)$/.test(style["overflow-y"] ?? "") || /\b(paint|strict|content)\b/.test(style["contain"] ?? "");
      const clip = clips ? Math.min(clipEnd, endOf(rect, axis)) : clipEnd;
      return visit(child, depth + 1, insideAvoid, childPage, childFlow, childFlow && !flexOrGrid, clip);
    });

    // Lines belong to the element that holds the text, not to its ancestors.
    // A Range over a block container returns the line rects of everything
    // inside it, so without this every line would be offered twice — once by
    // the paragraph and once by each wrapper around it — at the same extent
    // and with different positions. An inline that holds a block is not text:
    // the block splits it (CSS 2 §9.2.1.1, WPT `block-in-inline-015`).
    const holdsText = children.every(
      (_, i) => isInline((styles[i] as Record<string, string>)["display"]) && !inner[i]?.blocks,
    );

    let linesEnd = Number.NEGATIVE_INFINITY;
    if (holdsText && rangeFor !== undefined && element !== root) {
      linesEnd = appendLineCandidates(candidates, element, root, {
        measurer,
        axis,
        rangeFor,
        textRanges,
        penalty: PENALTIES.betweenLines + avoidCost,
        widows,
        orphans,
        page,
      });
    }

    // Where the ink stops, not where the next box starts. A margin adjoining
    // a fragmentation break does not have to fit inside the fragmentainer —
    // checked on Chromium and Firefox with a column exactly two lines tall,
    // where the second line stays put whether the trailing margin is 0, 18 or
    // 40px. Measuring to the next box's start reserves room for a margin that
    // is never drawn, which cost a corpus page its last two lines.
    let painted = Number.NEGATIVE_INFINITY;
    // The same, in-flow boxes only: a block beside a float starts level with
    // it and is still after its predecessor, so a float's ink cannot make it
    // "beside" — which lost a forced break next to one (WPT
    // `page-name-float-002`'s reference). A break's extent still counts it.
    let flowPainted = Number.NEGATIVE_INFINITY;
    let started = false;
    let first: Edges | null = null;
    let prev: Edges | null = null;
    let previous: { element: Element | null; style: Record<string, string> } | null = null;
    const anonymous: Edges = { start: page, end: page, before: null, after: null };

    // One item: a child element, or a run of text beside blocks, which is a
    // block of its own (CSS 2 §9.2.1.1) on its container's page — so text
    // after a named child is back on the parent's page (`page-name-002`), and
    // text after the last element is content too (`subpixel-page-size-*`).
    const item = (
      node: Node,
      edges: Edges | null,
      rect: Rect,
      element: Element | null,
      style: Record<string, string>,
    ): void => {
      // Siblings that are not stacked in this axis have no gap between them
      // to break at: two `<td>`s of a row start at the same place, so a break
      // "before the second cell" cuts the row in half and puts one cell on
      // each page. A child that begins above where the ink already reached is
      // beside its predecessor, not after it.
      const stacked = flowPainted === Number.NEGATIVE_INFINITY || startOf(rect, axis) >= flowPainted - 0.5;
      if (started && stacked) {
        // Forced by the boxes either side as they present themselves, which
        // for a container is its first and last in-flow children's values.
        const forcedBy =
          prev !== null && edges !== null ? forcingValue(prev.after, edges.before) : null;
        const pageChange = classA && prev !== null && edges !== null && prev.end !== edges.start;
        const isForced = forcedBy !== null || pageChange;
        candidates.push({
          position: positionOf(node, root),
          kind: isForced ? "forced" : "block",
          // The running maximum rather than the previous sibling's end.
          extent: painted === Number.NEGATIVE_INFINITY ? startOf(rect, axis) : painted,
          penalty: isForced ? FORCED : betweenPenalty(previous, style, avoidCost),
          ...(forcedBy === null ? {} : { breakValue: forcedBy }),
          page: edges?.start ?? page,
        });
      }
      started = true;
      if (edges !== null) {
        first ??= edges;
        prev = edges;
      }
      previous = { element, style };
      // An absolutely positioned box is not where the content before a break
      // ends: it is sliced on its own (`sliceAt`), and counted here it made a
      // forced break look 500px deep and not fit (WPT `page-background-003`).
      if (!/^(absolute|fixed)$/.test(style["position"] ?? "")) painted = Math.max(painted, endOf(rect, axis));
      if (element === null || inFlow(style)) flowPainted = Math.max(flowPainted, endOf(rect, axis));
    };

    // A paragraph's breaks are its lines: its inline children have no gaps.
    for (let i = 0; i < children.length && !holdsText; i++) {
      const child = children[i] as Element;
      const style = styles[i] as Record<string, string>;
      if (style["display"] === "none") continue;

      const loose = looseText(child.previousSibling);
      const lines = loose === null ? [] : measurer.lineBoxes(loose.range);
      if (loose !== null && lines.length > 0) {
        item(loose.first, anonymous, spanOf(lines), null, {});
        appendLineCandidates(candidates, element, root, { measurer, axis, penalty: PENALTIES.betweenLines + avoidCost, widows, orphans, page }, runFrom(loose.first));
      }

      const own = usedPageEdges(style, used[i] ?? page);
      const within = inner[i] as Inner;
      const display = style["display"];
      const propagates =
        inFlow(style) && (isBlockContainer(display) || (isInline(display) && within.blocks));
      const edges = !inFlow(style)
        ? null
        : isInline(display) && !within.blocks
          ? anonymous
          : propagates && within.first !== null && within.last !== null
            ? {
                start: within.first.start,
                end: within.last.end,
                before: own.before ?? within.first.before,
                after: own.after ?? within.last.after,
              }
            : own;
      item(child, edges, rects[i] as Rect, child, style);
    }

    const trailing = holdsText ? null : looseText(element.lastChild);
    const lines = trailing === null ? [] : measurer.lineBoxes(trailing.range);
    if (trailing !== null && lines.length > 0) {
      item(trailing.first, anonymous, spanOf(lines), null, {});
      appendLineCandidates(candidates, element, root, { measurer, axis, penalty: PENALTIES.betweenLines + avoidCost, widows, orphans, page }, runFrom(trailing.first));
    }
    // Text directly in the source root is lines too, though no element of its
    // own holds it: WPT `auto-margins-001`'s page is nothing else.
    if (holdsText && element === root && rangeFor !== undefined) {
      linesEnd = appendLineCandidates(candidates, element, root, { measurer, axis, penalty: PENALTIES.betweenLines + avoidCost, widows, orphans, page }, [...root.childNodes]);
    }

    // A box the page ends inside, with no break of its own left there — and
    // not below where a box around it clips what it holds.
    if (limit !== undefined && axis === "block" && limit < clipEnd) {
      children.forEach((child, i) => {
        const style = styles[i] as Record<string, string>;
        const rect = rects[i] as Rect;
        // Monolithic content is sliced as far as its ink goes: a 4in box
        // whose 8in child overflows it prints four 2in pages (WPT
        // `monolithic-overflow-027`), and it may be out of flow — an
        // absolutely positioned box is fragmented as well.
        const whole = monolithic(child, style);
        const end = whole ? inkEnd(child, rect, style, measurer) : rect.blockEnd;
        if (rect.blockStart >= limit - 0.5 || end <= limit + 0.5) return;
        const display = style["display"] ?? "";
        // A float is a block its container stacks, and splits like one (WPT
        // `break-nested-float-in-table-001`); an absolute box only whole.
        const floated = (style["float"] ?? "none") !== "none";
        if ((!inFlow(style) && !whole && !floated) || isInline(display) || display === "none" || display.startsWith("table-")) return;
        // Not across an orthogonal flow, whose block axis is not the page's: a
        // slice there cut WPT `page-margin-002`'s pages in half.
        if (/^(vertical|sideways)/.test(style["writing-mode"] ?? "") !== rootVertical) return;
        const at = sliceAt(child, style, rect, (inner[i] as Inner).end, limit, measurer);
        // Only stacked boxes have their own extent to give: a flex item or a
        // cell stretched beside a taller one shares its row with it.
        if (at === null || (at === "extent" && !classA)) return;
        candidates.push({
          position: { ...positionOf(child, root), slice: limit - rect.blockStart },
          kind: "slice",
          extent: limit,
          // Its own `break-inside: avoid` too, where it could be honoured: a
          // slice is inside it (WPT `body-background-*`).
          penalty:
            at === "monolithic"
              ? PENALTIES.sliceMonolithic
              : PENALTIES.betweenBlocks +
                avoidCost +
                (style["break-inside"] === "avoid" &&
                (fragmentainer === undefined || endOf(rect, axis) - startOf(rect, axis) <= fragmentainer)
                  ? PENALTIES.insideAvoid
                  : 0),
          page: used[i] ?? page,
        });
      });
    }

    // Text whose lines were not read has an end nobody knows: not empty.
    const end = holdsText ? (rangeFor === undefined ? Number.POSITIVE_INFINITY : linesEnd) : painted;
    return { first, last: prev, blocks: !holdsText, end };
  };

  const rootStyle = measurer.styleOf(root, [PAGE_CARRIER, "display"]);
  const rootPage = usedPage(rootStyle[PAGE_CARRIER], "");
  const top = visit(root, 0, 0, rootPage, true, !/(^|-)(flex|grid)$/.test(rootStyle["display"] ?? ""));
  // Extent first; where two breaks are at the same place, document order, so
  // the first of two forced breaks around an empty box is the one taken.
  candidates.sort((a, b) => a.extent - b.extent || comparePositions(a.position, b.position));
  onStartPage?.(top.first?.start ?? rootPage);
  return candidates;
}

const ELEMENT_NODE = 1;

/** MathML is one box to the page (a fraction's halves were a free break), bar
 * the rows `math/compose.ts` broke an equation into. */
const atomicMath = (el: Element): boolean => el.namespaceURI === MATHML_NS &&
  !(el.localName === "math" ? el : el.parentElement)?.hasAttribute(MATH_ROWS);

/** `auto`, or nothing, is the parent's page. */
function usedPage(value: string | undefined, parent: string): string {
  return value === undefined || value === "" || value === "auto" ? parent : value;
}

/** Content whose pieces are drawn, not laid out, on the pages it crosses. */
const REPLACED = new Set(["img", "svg", "video", "canvas", "iframe", "object", "embed"]);
/** Where a box's ink ends: its own box, or its overflow where it does not clip. */
function inkEnd(el: Element, rect: Rect, style: Record<string, string>, measurer: Measurer): number {
  if (!/^(visible|)$/.test(style["overflow-y"] ?? "") || /\b(paint|strict|content)\b/.test(style["contain"] ?? "")) return rect.blockEnd;
  const inside = typeof el.querySelectorAll === "function" ? [...el.querySelectorAll("*")] : [];
  return Math.max(rect.blockEnd, ...(inside.length === 0 ? [] : measurer.boxes(inside).map((r) => r.blockEnd)));
}

const monolithic = (el: Element, style: Record<string, string>): boolean =>
  REPLACED.has(el.localName) || el.hasAttribute(SLICED) || /\b(size|strict)\b/.test(style["contain"] ?? "");

/**
 * Can the page end inside this box, at `limit`, and why: it is monolithic, or
 * everything in it has ended and what crosses the page is its own extent — a
 * `height: 400vh` block, its padding and border (CSS Break 3 §4.4's class C
 * break, with the rest of the box continued). Null where neither holds.
 */
function sliceAt(
  el: Element,
  style: Record<string, string>,
  rect: Rect,
  contentEnd: number,
  limit: number,
  measurer: Measurer,
): "monolithic" | "extent" | null {
  if (monolithic(el, style)) return "monolithic";
  if (contentEnd > limit + 0.5) return null;
  // Taller than what it holds: a set height or a minimum. Not a paragraph,
  // whose text is measured by its glyphs and so ends a few pixels above its
  // last line box — the page limit fell in that gap, and the paragraph was
  // printed twice. More than half a line of empty extent is not that.
  const own = measurer.styleOf(el, ["padding-block-end", "border-block-end-width", "line-height", "font-size"]);
  const px = (p: string): number => parseFloat(own[p] ?? "") || 0;
  const line = px("line-height") || 1.2 * px("font-size");
  const inside = rect.blockEnd - px("padding-block-end") - px("border-block-end-width");
  return inside - Math.max(contentEnd, rect.blockStart) > Math.max(1, line / 2) ? "extent" : null;
}

/** A box's own edges, before anything is propagated into them. */
function usedPageEdges(style: Record<string, string>, page: string): Edges {
  return {
    start: page,
    end: page,
    before: forcingValue(undefined, style["break-before"]),
    after: forcingValue(style["break-after"], undefined),
  };
}

/** In normal flow: not absolutely positioned, fixed or floated. */
function inFlow(style: Record<string, string>): boolean {
  const position = style["position"];
  const float = style["float"];
  if (position === "absolute" || position === "fixed") return false;
  return float === undefined || float === "" || float === "none";
}

/**
 * A block container, which is what propagates its children's edges. Through
 * `flow-root` and `overflow: hidden` too: checked on Chromium, where a named
 * first child takes the container's top border onto its page either way.
 */
function isBlockContainer(display: string | undefined): boolean {
  return [undefined, "", "block", "list-item", "flow-root"].includes(display);
}

/** The extent of a run of lines, as one rect. */
function spanOf(lines: Rect[]): Rect {
  const a = lines[0] as Rect;
  const b = lines[lines.length - 1] as Rect;
  return { ...a, blockEnd: b.blockEnd, inlineEnd: b.inlineEnd };
}

/**
 * The text that paints between `from`, going backwards, and the element before
 * it: the loose text before an element, or after a container's last one.
 */
function looseText(from: Node | null | undefined): { range: Range; first: Node } | null {
  let range: Range | null = null;
  let first: Node | null = null;
  for (let n = from; n != null && n.nodeType !== ELEMENT_NODE; n = n.previousSibling) {
    if (n.nodeType !== 3 || (n.textContent ?? "").trim() === "") continue;
    range ??= n.ownerDocument === null ? null : scratchRange(n.ownerDocument);
    if (first === null) range?.setEndAfter(n);
    range?.setStartBefore(n);
    first = n;
  }
  return first === null || range === null ? null : { range, first };
}

/** The nodes of a run of loose text, from its first to the next element. */
function runFrom(first: Node): Node[] {
  const out: Node[] = [];
  for (let n: Node | null = first; n !== null && n.nodeType !== ELEMENT_NODE; n = n.nextSibling) out.push(n);
  return out;
}

/**
 * A run of text no element holds by itself — loose text beside blocks (CSS 2
 * §9.2.1.1's anonymous block), or text directly in the source root — as
 * `TextRanges`, and the text node and offset of each of its characters. A
 * line break in it is a position in a text node, since no element's text
 * can count the offset. Before, such a run was one unbreakable item, and a
 * page of nothing but text overflowed.
 */
function runRanges(nodes: readonly Node[], doc: Document): { ranges: TextRanges; total: number; at: (chars: number) => { node: Node; offset: number } } | null {
  const texts: { node: Node; start: number }[] = [];
  let total = 0;
  const walk = (n: Node): void => {
    if (n.nodeType !== 3) return n.childNodes.forEach(walk);
    texts.push({ node: n, start: total });
    total += (n.textContent ?? "").length;
  };
  nodes.forEach(walk);
  const first = texts[0];
  if (first === undefined || total === 0) return null;
  const at = (chars: number): { node: Node; offset: number } => {
    const hit = texts.find((t) => chars <= t.start + (t.node.textContent ?? "").length) ?? first;
    return { node: hit.node, offset: Math.max(0, chars - hit.start) };
  };
  const prefix = (_: Element, chars: number): Range => {
    const range = scratchRange(doc);
    const end = at(chars);
    range.setStart(first.node, 0);
    range.setEnd(end.node, end.offset);
    return range;
  };
  return { ranges: { length: () => total, prefix }, total, at };
}

/** A CSS integer that means something: `widows: 0` and `auto` do not. */
function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Does this `display` keep its box in the line flow? Inline `<math>` is `math`:
 * missed, a paragraph with a formula was blocks and loose text, broken freely. */
function isInline(display: string | undefined): boolean {
  if (display === undefined || display === "") return false;
  return /^(inline|ruby|contents$|math$)/.test(display);
}

/**
 * Element children, derived from `childNodes` rather than `children`, so this
 * walks the same tree `Position` indexes. Two views of "the children" that
 * disagree about text nodes would make every position off by one.
 */
function elementChildren(element: Element): Element[] {
  const out: Element[] = [];
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node !== undefined && node.nodeType === ELEMENT_NODE) out.push(node as Element);
  }
  return out;
}

/** Which value forced the break, `break-after` winning where both do. */
function forcingValue(
  breakAfter: string | null | undefined,
  breakBefore: string | null | undefined,
): string | null {
  if (breakAfter != null && FORCED_VALUES.has(breakAfter)) return breakAfter;
  if (breakBefore != null && FORCED_VALUES.has(breakBefore)) return breakBefore;
  return null;
}

function betweenPenalty(
  previous: { element: Element | null; style: Record<string, string> } | null,
  style: Record<string, string>,
  avoidCost: number,
): number {
  if (previous?.style["break-after"] === "avoid" || style["break-before"] === "avoid") {
    return PROHIBITED;
  }

  let penalty = PENALTIES.betweenBlocks + avoidCost;
  // A heading belongs with what it introduces. CSS has no property for this;
  // Paged.js has no rule for it either. It is a penalty, not a prohibition,
  // so a heading at the foot of a page still beats an overflowing page.
  if (previous?.element != null && HEADINGS.has(previous.element.tagName)) {
    penalty += PENALTIES.afterHeading;
  }
  return penalty;
}

function appendLineCandidates(
  into: Candidate[],
  element: Element,
  root: Element,
  ctx: {
    measurer: Measurer;
    axis: Axis;
    rangeFor?: ((el: Element) => Range) | undefined;
    textRanges?: TextRanges | undefined;
    penalty: number;
    widows?: number | undefined;
    orphans?: number | undefined;
    page: string;
  },
  run?: readonly Node[],
): number {
  // A run's breaks are in its text nodes (`runRanges`); an element's, offsets
  // into its text as a whole.
  const own = run === undefined ? null : runRanges(run, element.ownerDocument);
  if (run !== undefined && own === null) return Number.NEGATIVE_INFINITY;
  const ranges = own?.ranges ?? ctx.textRanges;
  const place = (chars: number): Position => {
    const cut = own?.at(chars);
    return cut === undefined ? positionOf(element, root, { offset: chars }) : positionOf(cut.node, root, { offset: cut.offset });
  };
  let lines: Rect[];
  try {
    lines = ctx.measurer.lineBoxes(own !== null ? own.ranges.prefix(element, own.total) : (ctx.rangeFor as (el: Element) => Range)(element));
  } catch {
    return Number.NEGATIVE_INFINITY; // no text here
  }
  const end = lines.length === 0 ? Number.NEGATIVE_INFINITY : Math.max(...lines.map((l) => endOf(l, ctx.axis)));
  if (lines.length < 2) return end; // nothing to split

  // The author's values, not ours. Until now these were the CSS initial value
  // of 2 whatever the stylesheet said, so `widows: 3` was read as 2 and a
  // two-line widow cost nothing.
  const style = ctx.measurer.styleOf(element, ["widows", "orphans"]);
  const widows = positiveInt(style["widows"]) ?? ctx.widows;
  const orphans = positiveInt(style["orphans"]) ?? ctx.orphans;

  // Breaking after line i leaves i+1 lines behind and the rest carried over,
  // so widows and orphans are arithmetic once text is split at line boxes.
  for (let i = 0; i < lines.length - 1; i++) {
    const linesBefore = i + 1;
    const linesAfter = lines.length - linesBefore;
    const offset = ranges === undefined ? 0 : offsetAtLine(element, linesBefore, { measurer: ctx.measurer, ranges });
    if (offset === null && own !== null) continue;

    into.push({
      position: place(offset ?? 0),
      line: linesBefore,
      kind: "line",
      page: ctx.page,
      extent: endOf(lines[i] as Rect, ctx.axis),
      penalty:
        ctx.penalty +
        widowOrphanPenalty(linesBefore, linesAfter, {
          ...(widows === undefined ? {} : { widows }),
          ...(orphans === undefined ? {} : { orphans }),
        }),
    });
  }
  return end;
}
