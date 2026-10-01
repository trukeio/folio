/**
 * Stage 4: compose a page (`doc/plan.md` §2).
 *
 * "Build each page's DOM from its start and end positions, with split-from /
 * split-to markers."
 *
 * The source document is never touched. A page is *generated* from it, which is
 * the difference from Paged.js: nothing is extracted, nothing is carried from
 * page to page, and composing page 40 does not depend on having composed page
 * 39. Every page is a pure function of `(spec, start, end)` over an unchanging
 * tree — which is what makes re-laying-out one page a function call, and what
 * removes the class of bug behind Paged.js's `specs/infinite-loop` test.
 */
import { comparePositions } from "./position.js";
import { rewriteInlineStyle } from "./css/rewrite.js";
import { BOX_PINS } from "./furniture.js";
import type { Position } from "./types.js";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Marks an element whose content began on an earlier page. */
export const SPLIT_FROM = "data-folio-split-from";
/** Marks an element whose content continues on a later page. */
export const SPLIT_TO = "data-folio-split-to";
/** The cloned element's path in the source tree, e.g. `2.1.0`. */
export const SOURCE_PATH = "data-folio-path";
/** Where this fragment's first text node starts in the source text. */
export const TEXT_START = "data-folio-text-start";
/**
 * The engine's own measuring frame.
 *
 * It is the engine's, not the author's, so it is never part of a page. It is
 * kept out of the source root as well (`createEngineFrame`); this marker is
 * the second line of defence, for a caller who paginates a root the frame
 * happens to sit in.
 */
export const ENGINE_FRAME = "data-folio-frame";
/** The clone of the document's root element, which `:root` is rewritten to match. */
export const ROOT = "data-folio-root";
/** The clone of the source root: where a page's own content begins. */
export const SOURCE_ROOT = "data-folio-source-root";
/** Every clone in the root chain. */
export const CHAIN = "data-folio-chain";
/**
 * A box a page begins or ends inside, cloned whole and shown in part
 * (`Position.slice`, `doc/review.md` §4). On a page after its first it is
 * also `data-folio-repeated`: its content is on the page before, too.
 */
export const SLICED = "data-folio-sliced";

/**
 * Nodes cloned into pages and measuring boxes since it was last reset.
 *
 * M1's exit check asks for a recorded performance budget that CI fails on.
 * This is what it is counted in, rather than seconds: a clone is what every
 * later cost is proportional to — the browser's layout of the box, the style
 * read per element, the candidate per block child — and unlike a stopwatch it
 * is the same number on every machine. A measuring box that holds the whole
 * remainder rather than a chunk (`chunk.ts`) shows up here as a count that
 * grows with the page number, which is the regression the budget exists to
 * catch.
 */
export const composeStats = { nodes: 0 };

export type ComposeOptions = {
  /** The unchanging source subtree. */
  source: Element;
  start: Position;
  /** Exclusive: the first position *not* on this page. */
  end: Position;
  /** Document the page is built in — the engine's own (§2). */
  target: Document;
  /**
   * Stamp each clone with where it came from. The fragmenter measures the
   * composed page, so the breaks it finds are positions in the *clone*; without
   * a way back they cannot be stored in a `PageRecord`, whose whole value is
   * that it refers to the unchanging source.
   */
  stampPaths?: boolean;
};

/** Is `position` strictly inside the subtree at `path`? */
export function isInsideSubtree(path: readonly number[], position: Position): boolean {
  if (position.path.length <= path.length) return false;
  for (let i = 0; i < path.length; i++) {
    if (position.path[i] !== path[i]) return false;
  }
  return true;
}

/** Where a subtree sits relative to a page's range. */
export type Overlap = "before" | "after" | "inside";

export function overlap(
  path: readonly number[],
  start: Position,
  end: Position,
): Overlap {
  const opens: Position = { path: [...path], offset: 0, after: false };
  const closes: Position = { path: [...path], offset: 0, after: true };

  // Entirely before the page began, or entirely after it ended. `after: true`
  // is what makes "the whole subtree" expressible as one comparison.
  if (comparePositions(closes, start) <= 0 && !isInsideSubtree(path, start)) return "before";
  if (comparePositions(opens, end) >= 0) return "after";
  return "inside";
}

/**
 * Build the page. Returns a fragment of cloned nodes; the caller puts it in a
 * page box.
 *
 * The page's slice of the source is inside the **root chain**: a clone of
 * every element from the document's root down to the source root, because
 * the page area holds the root, not its children (css-page-3 §3,
 * `doc/review.md` §3). `body { display: grid }`, `<body style="page: a">`
 * and `html { margin }` are the root's own box, and they are on the page
 * only if the root is. Each is a split clone like any other — continued on
 * every page but the first, continuing on every page but the last — so
 * `fragments.ts` slices it as it slices a `<section>`. Nothing in the chain
 * is stamped: positions stay relative to the source root.
 */
export function composePage(options: ComposeOptions): DocumentFragment {
  const { source, start, end, target } = options;
  const fragment = target.createDocumentFragment();

  let holder: ParentNode = fragment;
  const chain = rootChain(source);
  if (chain.length > 0) {
    // Relative font sizes are the one inherited value the frame's own `html`
    // and `body`, which match the same rules, would apply twice: 62.5% of
    // 62.5% (`review.md` §3.8). A real root inherits from nothing.
    const context = target.createElement("folio-root");
    // A plain block and nothing more. Margins collapse through it exactly as
    // they did when the page's content sat in the content area directly —
    // `flow-root` here kept the last block's margin in, which a margin
    // adjoining a break never has to fit, and a page height pushed the
    // footnote area after it off the page. Both cost corpus pages.
    context.style.fontSize = "medium";
    fragment.append(context);
    holder = context;
  }
  // Paginating `body`, the chain is the document's root and honoured in full.
  // Paginating an element inside the page, what is above it is the
  // application's layout — an offscreen holder, a `body { display: grid }`
  // shell with a sidebar — and passes on only what it inherits.
  const application = source !== source.ownerDocument.body;
  const continued = start.path.length > 0 || start.offset > 0;
  const continues = (end.path[0] ?? source.childNodes.length) < source.childNodes.length;
  for (const element of chain) {
    const clone = element.cloneNode(false) as Element;
    composeStats.nodes++;
    // The host marks its own elements (the print path, a viewer's state);
    // none of that is the author's.
    for (const name of clone.getAttributeNames()) {
      if (name.startsWith("data-folio-")) clone.removeAttribute(name);
    }
    const style = clone.getAttribute("style");
    if (style !== null && style !== "") clone.setAttribute("style", rewriteInlineStyle(style));
    if (application && element !== source) {
      clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${BOX_PINS}`);
    }
    clone.setAttribute(CHAIN, "");
    if (continued) clone.setAttribute(SPLIT_FROM, "");
    if (continues) clone.setAttribute(SPLIT_TO, "");
    if (element === chain[0]) clone.setAttribute(ROOT, "");
    holder.append(clone);
    holder = clone;
  }
  if (holder !== fragment) (holder as Element).setAttribute(SOURCE_ROOT, "");

  for (const child of cloneChildren(source, [], options)) holder.append(child);
  return fragment;

  function cloneChildren(node: Node, path: number[], ctx: ComposeOptions): Node[] {
    const out: Node[] = [];
    const children = node.childNodes;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child === undefined) continue;
      const childPath = [...path, i];
      const where = overlap(childPath, start, end);
      if (where !== "inside") continue;

      if (child.nodeType === TEXT_NODE) {
        const text = sliceText(child, childPath, ctx);
        if (text !== null) {
          composeStats.nodes++;
          out.push(text);
        }
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      // The engine's own furniture is not content. A measuring frame composed
      // into a page is an element with no text and no height that still ends
      // the page's range, and the section before it then has to fit whatever
      // is left — which is how a 1702px section came to sit in a 680px area.
      if ((child as Element).hasAttribute(ENGINE_FRAME)) continue;

      out.push(cloneElement(child as Element, childPath, ctx));
    }
    return out;
  }

  function cloneElement(element: Element, path: number[], ctx: ComposeOptions, whole = false): Element {
    // Shallow clone: attributes and identity come across, children are decided
    // by the range, not by the source — unless the page is a slice of this box.
    const from = samePath(path, start.path) ? start.slice : undefined;
    const to = samePath(path, end.path) ? end.slice : undefined;
    const clone = element.cloneNode(false) as Element;
    composeStats.nodes++;
    // A `style` attribute is author CSS too, and gets stage 1's rewrites.
    const style = clone.getAttribute("style");
    if (style !== null && style !== "") clone.setAttribute("style", rewriteInlineStyle(style));

    // An element the page begins inside continues from the previous page; one
    // the page ends inside continues onto the next. Both are the author's to
    // style (`box-decoration-break`, `margin-break`), so they are marked
    // rather than guessed at.
    if (isInsideSubtree(path, start)) clone.setAttribute(SPLIT_FROM, "");
    if (isInsideSubtree(path, end)) clone.setAttribute(SPLIT_TO, "");

    if (ctx.stampPaths === true) {
      clone.setAttribute(SOURCE_PATH, path.join("."));
      // Text sliced at the page's start means every offset inside this clone
      // is short by that much. Record it, or a break found at clone offset 12
      // would be stored as source offset 12 and cut in the wrong place.
      const sliced = firstSlicedTextOffset(element, path, start);
      if (sliced > 0) clone.setAttribute(TEXT_START, String(sliced));
    }

    if (from !== undefined || to !== undefined) {
      showSlice(clone, from ?? 0, to ?? null);
      // Repeated, not continued: it is the same box again, whole, and the
      // fragment rules would take its top border and padding away.
      if (from !== undefined) clone.setAttribute("data-folio-repeated", "");
      clone.removeAttribute(SPLIT_FROM);
      clone.removeAttribute(SPLIT_TO);
    }
    if (whole || from !== undefined || to !== undefined) {
      for (const [i, child] of [...element.childNodes].entries()) {
        if (child.nodeType === TEXT_NODE) clone.append(ctx.target.createTextNode(child.textContent ?? ""));
        else if (child.nodeType === ELEMENT_NODE) clone.append(cloneElement(child as Element, [...path, i], ctx, true));
        composeStats.nodes++;
      }
      return clone;
    }
    for (const child of cloneChildren(element, path, ctx)) clone.append(child);
    return clone;
  }

  function sliceText(node: Node, path: number[], ctx: ComposeOptions): Text | null {
    const text = node.textContent ?? "";
    const from = samePath(path, start.path) ? start.offset : 0;
    const to = samePath(path, end.path) ? end.offset : text.length;
    if (to <= from) return null;
    return ctx.target.createTextNode(text.slice(from, to));
  }
}

/**
 * Show the part of a box from `from` to `to` pixels of its border box (`to`
 * null: to its end). Shifted up by what earlier pages showed — the margin
 * collapses up through the continued boxes around it, and the page clips
 * what rises above it (`paginate.ts`) — and cut at `to` by its own height,
 * with no bottom border or padding, as `box-decoration-break: slice` would
 * cut it. An image keeps its scale and shows its top part. Inline and
 * `!important`, over the fragment rules and the author's own.
 */
function showSlice(clone: Element, from: number, to: number | null): void {
  clone.setAttribute(SLICED, "");
  const style = (clone as HTMLElement).style;
  const set = (property: string, value: string): void => style.setProperty(property, value, "important");
  if (from > 0) set("margin-block-start", `${String(-from)}px`);
  if (to === null) return;
  for (const [property, value] of [
    ["box-sizing", "border-box"],
    ["block-size", `${String(to)}px`],
    ["min-block-size", "0"],
    ["max-block-size", "none"],
    ["padding-block-end", "0"],
    ["border-block-end-width", "0"],
    ["margin-block-end", "0"],
    // The block axis whichever it is (`review.md` §5).
    ["overflow-block", "clip"],
    ["object-fit", "cover"],
    ["object-position", "50% 0"],
  ]) {
    set(property as string, value as string);
  }
}

/**
 * The document's root element down to `source`, outermost first; empty for a
 * source that is not in a document's tree, which is composed bare.
 */
function rootChain(source: Element): Element[] {
  const root = source.ownerDocument.documentElement;
  if (!root.contains(source)) return [];
  const chain: Element[] = [];
  for (let el: Element | null = source; el !== null; el = el.parentElement) chain.unshift(el);
  return chain;
}

/** Where a composed page's own content begins: the source root's clone. */
export function sourceRootIn(box: Element): Element {
  return box.querySelector(`[${SOURCE_ROOT}]`) ?? box;
}

/**
 * How many characters of this element's text the page's start skipped.
 *
 * Counted over *all* its descendant text in document order, not over its first
 * text child. A paragraph built from `<span>`s — which is most prose with any
 * markup in it — has its text spread across many nodes, and an offset that
 * means "the 200th character of this paragraph" is meaningless as an offset
 * into the first of them.
 */
function firstSlicedTextOffset(
  element: Element,
  path: readonly number[],
  start: Position,
): number {
  if (start.path.length <= path.length) return 0;
  for (let i = 0; i < path.length; i++) {
    if (start.path[i] !== path[i]) return 0;
  }

  // An explicit walk, not a closure with a flag: TypeScript's control flow
  // does not follow assignments made inside a callback, so a `found` flag set
  // in one reads as permanently false and everything after it as dead code.
  const target = start.path.slice(path.length);
  let skipped = 0;
  const stack: { node: Node; prefix: number[] }[] = [{ node: element, prefix: [] }];

  while (stack.length > 0) {
    const { node, prefix } = stack.pop() as { node: Node; prefix: number[] };
    const children = node.childNodes;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child === undefined) continue;
      const childPath = [...prefix, i];

      if (samePath(childPath, target)) {
        return skipped + (child.nodeType === TEXT_NODE ? start.offset : 0);
      }
      if (child.nodeType === TEXT_NODE) {
        skipped += (child.textContent ?? "").length;
      } else {
        // Depth-first in document order: finish this subtree before moving on.
        const inner = descend(child, childPath, target);
        if (inner.found) return skipped + inner.skipped;
        skipped += inner.skipped;
      }
    }
  }

  return 0;
}

/** Characters before `target` inside one subtree, and whether it was there. */
function descend(
  node: Node,
  prefix: number[],
  target: readonly number[],
): { skipped: number; found: boolean } {
  let skipped = 0;
  const children = node.childNodes;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === undefined) continue;
    const childPath = [...prefix, i];

    if (samePath(childPath, target)) return { skipped, found: true };
    if (child.nodeType === TEXT_NODE) {
      skipped += (child.textContent ?? "").length;
    } else {
      const inner = descend(child, childPath, target);
      skipped += inner.skipped;
      if (inner.found) return { skipped, found: true };
    }
  }
  return { skipped, found: false };
}

function samePath(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
