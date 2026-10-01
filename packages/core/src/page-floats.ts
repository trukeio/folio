/**
 * Page floats (CSS Page Floats 3, `doc/review.md` §7).
 *
 * `float: top` with `float-reference: page` takes an element out of the flow
 * and puts it at the block-start of the page its anchor is on, or of a later
 * page when it does not fit there. It is a note area at the other end of the
 * page, never split: the fragmenter reserves its space in the same bisection
 * that reserves the notes' (`paginate.ts`), and this file takes floats out,
 * measures them, and builds the two edges of a page.
 *
 * Browsers drop `float: top` and have never heard of `float-reference`, so
 * both are carriers (`css/rewrite.ts`). An element whose reference is
 * `inline`, the initial value, is not a page float, and is left alone.
 *
 * **Delete when** a browser paginates with page floats natively. None does,
 * and `CSS.supports("float-reference", "page")` could not tell: parsing the
 * property is not floating to a page the browser is not building.
 */
import { carrierName } from "./css/rewrite.js";
import { OUT_OF_FLOW } from "./footnotes.js";
import type { Deletion } from "./native.js";

/** What a float leaves in the flow: nothing to see, and where it was. */
export const ANCHOR = "folio-float-anchor";
/** One edge of a page's floats, `data-edge="start"` or `"end"`. */
export const EDGE = "folio-page-floats";

export type Edge = "start" | "end";

/** A page float out of the flow. */
export type PageFloat = {
  el: HTMLElement;
  /** What it left behind; null once it is carried past its anchor's page. */
  anchor: HTMLElement | null;
  /** `snap` is decided per page, by where the anchor is. */
  edge: Edge | "snap";
  /** Pages still to wait (`float-defer`). */
  defer: number;
};

const EDGES: Record<string, Edge | "snap"> = {
  top: "start",
  "block-start": "start",
  bottom: "end",
  "block-end": "end",
  "snap-block": "snap",
};
/** No columns or regions here: each is the page. */
const PAGE_REFERENCES = ["page", "column", "region"];

/**
 * Take the page floats out of `root`, in document order, each leaving an
 * anchor. The anchor carries the float's source path twice: as its own
 * stamp, so a break before it is a break before the float, and as
 * `OUT_OF_FLOW`, so a line break's offset skips the float's text.
 */
export function extractFloats(root: HTMLElement, view: Window): PageFloat[] {
  const doc = root.ownerDocument;
  const found: PageFloat[] = [];
  for (const el of [...root.querySelectorAll<HTMLElement>("*")]) {
    // Inside a float already taken: it goes with it.
    if (!root.contains(el)) continue;
    const style = view.getComputedStyle(el);
    const edge = EDGES[style.getPropertyValue(carrierName("float")).trim()];
    if (edge === undefined) continue;
    if (!PAGE_REFERENCES.includes(style.getPropertyValue(carrierName("float-reference")).trim())) continue;

    const anchor = doc.createElement(ANCHOR);
    // A block leaves a block, which margins collapse through; anything else
    // leaves a point on its line.
    anchor.style.cssText = /^inline/.test(style.display)
      ? "display:inline-block;inline-size:0;block-size:0"
      : "display:block;block-size:0;margin:0";
    const stamp = el.getAttribute("data-folio-path");
    if (stamp !== null) {
      anchor.setAttribute("data-folio-path", stamp);
      anchor.setAttribute(OUT_OF_FLOW, stamp);
    }
    // Before it leaves: a computed style is live, and empty out of the tree.
    const defer = parseInt(style.getPropertyValue(carrierName("float-defer")), 10);
    el.replaceWith(anchor);
    found.push({ el, anchor, edge, defer: defer > 0 ? defer : 0 });
  }
  return found;
}

/** The edge a float goes to on a page, `snap-block` by where its anchor is. */
function edgeOf(f: PageFloat, at: number, origin: number, block: number): Edge {
  if (f.edge !== "snap") return f.edge;
  return f.anchor === null || at - origin < block / 2 ? "start" : "end";
}

/** Which floats of a page's queue go on it, and how much of it they take. */
export type FloatPlan = {
  /** Queue index to edge, for the floats placed. */
  edges: Map<number, Edge>;
  /** The block size of the placed floats anchored at or above `extent`. */
  above: (extent: number) => number;
};

/**
 * Plan a page's floats (`review.md` §7.2). The queue is the floats
 * carried from the page before, then those anchored in the measuring box,
 * in order. Each goes on this page if it fits beside the text up to its
 * anchor and the floats before it. The first that does not stops the rest,
 * so none overtakes another. A float at the very start of a page is placed
 * whatever its size. `blockStartOf` is the page measurer's.
 */
export function planFloats(
  queue: readonly PageFloat[],
  page: { origin: number; block: number; inline: number; writingMode: string },
  target: Document,
  blockStartOf: (el: Element) => number,
): FloatPlan {
  const edges = new Map<number, Edge>();
  const placed: { el: HTMLElement; edge: Edge; at: number; height: number }[] = [];
  for (const [i, f] of queue.entries()) {
    if (f.defer > 0) continue;
    const at = f.anchor === null ? page.origin : blockStartOf(f.anchor);
    const edge = edgeOf(f, at, page.origin, page.block);
    const height = measureFloats([...placed, { el: f.el, edge }], page.inline, target, page.writingMode);
    const first = placed.length === 0 && at <= page.origin + 1;
    if (height + at - page.origin > page.block && !first) break;
    placed.push({ el: f.el, edge, at, height });
    edges.set(i, edge);
  }
  return {
    edges,
    above: (extent) => placed.reduce((h, p) => (p.at <= extent ? p.height : h), 0),
  };
}

/**
 * Take a composed page's floats out and place those the plan put on it. The
 * rest are carried, their anchors left behind, and a deferred one is a page
 * nearer its turn. `carried` is not changed: a page may be composed again.
 */
export function takeFloats(
  content: HTMLElement,
  view: Window,
  carried: readonly PageFloat[],
  plan: FloatPlan,
  target: Document,
): PageFloat[] {
  const queue = [...carried, ...extractFloats(content, view)];
  const placed: { el: HTMLElement; edge: Edge }[] = [];
  const rest: PageFloat[] = [];
  for (const [i, f] of queue.entries()) {
    const edge = plan.edges.get(i);
    if (edge !== undefined) placed.push({ el: f.el, edge });
    else rest.push({ ...f, anchor: null, defer: Math.max(0, f.defer - 1) });
  }
  placeFloats(content, placed, target);
  return rest;
}

/** An edge's block, holding these floats. */
function buildEdge(els: readonly HTMLElement[], edge: Edge, target: Document): HTMLElement {
  const box = target.createElement(EDGE);
  box.dataset["edge"] = edge;
  // Its own formatting context: the floats' margins stay inside it.
  box.style.display = "flow-root";
  box.append(...els);
  return box;
}

/** The block size both edges of these floats take, measured on clones. */
export function measureFloats(
  floats: readonly { el: HTMLElement; edge: Edge }[],
  inlineSize: number,
  target: Document,
  writingMode: string,
): number {
  if (floats.length === 0) return 0;
  const holder = target.createElement("folio-measure");
  holder.style.cssText = `display:block;writing-mode:${writingMode};inline-size:${inlineSize}px;position:absolute;visibility:hidden`;
  for (const edge of ["start", "end"] as const) {
    const els = floats.filter((f) => f.edge === edge).map((f) => f.el.cloneNode(true) as HTMLElement);
    if (els.length > 0) holder.append(buildEdge(els, edge, target));
  }
  target.body.append(holder);
  const r = holder.getBoundingClientRect();
  holder.remove();
  return /^(vertical|sideways)/.test(writingMode) ? r.width : r.height;
}

/**
 * Put these floats on a page: the start edge first in the content area, the
 * end edge after the flow. The note area comes after it (`placeFootnotes`).
 */
export function placeFloats(content: HTMLElement, floats: readonly { el: HTMLElement; edge: Edge }[], target: Document): void {
  const start = floats.filter((f) => f.edge === "start").map((f) => f.el);
  const end = floats.filter((f) => f.edge === "end").map((f) => f.el);
  if (start.length > 0) content.prepend(buildEdge(start, "start", target));
  if (end.length > 0) content.append(buildEdge(end, "end", target));
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "page floats",
  files: ["page-floats.ts"],
  feature: "`float: top | bottom | snap-block` with `float-reference: page` (CSS Page Floats 3)",
  when: "A browser paginates with page floats natively",
  tests: [],
  untested: "The pinned WPT set has no page-float test; `page-floats.spec.ts` is the check",
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
