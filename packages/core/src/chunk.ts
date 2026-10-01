/**
 * How much of the document to measure (`doc/plan.md` §3).
 *
 * "Estimate how much content fits from characters per page, render that much,
 * then binary-search the block children. Do not append and measure one node at
 * a time."
 *
 * The fragmenter needs a box it can see the break in. Until now that box held
 * *everything that remained*, which is correct and quadratic: page 1 of a
 * 300-page book lays out 300 pages of content, page 2 lays out 299.
 *
 * A chunk is the same box with an end on it. What makes it safe is
 * one-directional flow: in block layout nothing below a line moves the lines
 * above it, so a candidate at `extent <= limit` has the same geometry in a
 * truncated box as in a whole one — *provided* the cut is far enough past the
 * limit that it cannot be read as the end of the content. `paginate.ts`
 * checks that before it trusts the box, and grows a chunk that fits rather
 * than believing it.
 *
 * One thing breaks the rule, and it is handled here: a **width-coupled
 * container** resolves its children's sizes from children the cut may have
 * removed. A table's column widths come from *all* its rows, so half a table
 * is a table with different columns and therefore different row heights,
 * including rows above the limit; flex, grid and multicol size the same way.
 * It also takes `repeatTableParts` with it — a truncated table would be
 * stamped as continuing and handed a footer the real page will not have. So a
 * chunk never ends inside one; it ends past the outermost one it landed in.
 *
 * The cost is that a table taller than a chunk is measured whole on every
 * page it crosses, which is the old quadratic behaviour confined to one
 * table. `table-layout: fixed` opts out, the columns no longer being the
 * rows' to decide.
 */
import { MATHML_NS } from "./math/compose.js";
import type { Position } from "./types.js";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * The structural part of a DOM node this module needs.
 *
 * Structural, as `position.ts` is, so the walk can be tested against a
 * synthetic tree with no browser — which matters more here than it looks: a
 * chunk that ends one node early is invisible to the corpus, because the
 * growth loop asks for a bigger one and the page comes out the same.
 */
type TreeNode = {
  readonly childNodes: ArrayLike<TreeNode>;
  readonly parentNode: TreeNode | null;
  readonly firstChild: TreeNode | null;
  readonly nextSibling: TreeNode | null;
  readonly nodeType: number;
  readonly textContent: string | null;
};

export type ChunkOptions = {
  /**
   * Does this element size its children from children the chunk may have cut?
   *
   * Injected so the walk is testable without a browser; the default reads the
   * browser's own cascade, which is the only honest answer for an author's
   * `display` — a tag name does not decide it.
   */
  coupled?: (node: TreeNode) => boolean;
};

export type Chunk = {
  /**
   * Exclusive end for `composePage`, or null for "everything that is left".
   *
   * Null is not an optimisation: it tells the caller the box it is about to
   * measure is the whole remainder, which is the only state in which "it all
   * fits" is a fact rather than an artefact of the cut.
   */
  end: Position | null;
  /** Source characters between `start` and `end`, for the density estimate. */
  characters: number;
};

/** A chunk of about `budget` characters of text, starting at `start`. */
export function chunkFrom(
  source: TreeNode,
  start: Position,
  budget: number,
  options: ChunkOptions = {},
): Chunk {
  const coupled = options.coupled ?? domCoupling(source);
  const path = [...start.path];
  let node: TreeNode | null = resolveNode(source, path);
  if (node === null) return { end: null, characters: 0 };

  let characters = 0;
  let atStart = true;

  for (;;) {
    // The position the page starts at is a boundary, not a node to visit:
    // `after` means the page begins past this subtree, and an offset means it
    // begins part-way into this text.
    const skip = atStart && start.after;

    if (!skip && node.nodeType === TEXT_NODE) {
      const from = atStart ? start.offset : 0;
      const length = Math.max(0, (node.textContent ?? "").length - from);
      if (characters + length >= budget) {
        const offset = from + (budget - characters);
        return endAt(source, node, path, offset, budget, coupled);
      }
      characters += length;
    } else if (!skip && node.firstChild !== null) {
      path.push(0);
      node = node.firstChild;
      atStart = false;
      continue;
    }
    atStart = false;

    // Forward in document order, maintaining the path as we go: computing it
    // afresh at the end would walk the siblings of every ancestor, which is
    // the cost this whole module exists to avoid.
    let next: TreeNode | null = null;
    while (path.length > 0) {
      const sibling: TreeNode | null = node.nextSibling;
      if (sibling !== null) {
        path[path.length - 1] = (path[path.length - 1] as number) + 1;
        next = sibling;
        break;
      }
      path.pop();
      const parent: TreeNode | null = node.parentNode;
      if (parent === null) break;
      node = parent;
    }
    if (next === null) return { end: null, characters };
    node = next;
  }
}

/**
 * The end position, moved past any container whose layout reads ahead.
 *
 * Returns an `after` position on the outermost such ancestor, which includes
 * its whole subtree — `overlap()` in `compose.ts` reads an ancestor's `after`
 * as following all of its descendants, which is exactly what is wanted.
 */
function endAt(
  source: TreeNode,
  node: TreeNode,
  path: readonly number[],
  offset: number,
  characters: number,
  coupled: (node: TreeNode) => boolean,
): Chunk {
  const past = outermostCoupled(source, node, path, coupled);
  if (past !== null) return { end: { path: past, offset: 0, after: true }, characters };
  return { end: { path: [...path], offset, after: false }, characters };
}

/**
 * The path of the outermost width-coupled ancestor of `node`, if any.
 *
 * Never the source root: a chunk ending past it would be the whole document,
 * which is what this module exists to avoid. A flex or grid *root* is a
 * documented limit rather than a handled case — the fragmenter walks block
 * children, so such a root is outside the model before it is outside the
 * chunk.
 */
function outermostCoupled(
  source: TreeNode,
  node: TreeNode,
  path: readonly number[],
  coupled: (node: TreeNode) => boolean,
): number[] | null {
  let found: number[] | null = null;
  // `path` names `node`; a text node's parent is one step shallower, and the
  // paths recorded here have to stay in step with the chain being walked or
  // the snap lands on a sibling of the container it meant to clear.
  let current: TreeNode | null = node;
  let depth = path.length;
  if (current.nodeType !== ELEMENT_NODE) {
    current = current.parentNode;
    depth--;
  }

  while (current !== null && current !== source && depth > 0) {
    if (current.nodeType === ELEMENT_NODE && coupled(current)) found = path.slice(0, depth);
    current = current.parentNode;
    depth--;
  }
  return found;
}

/**
 * The default `coupled`: the cascade's say, and MathML — half a formula is none.
 *
 * `ownerDocument` is optional in the type because a `TreeNode` need not be a
 * DOM node — that is the whole point of the structural type, and a version of
 * this that asserted the property away passed the linter and threw on every
 * synthetic tree. MathML goes by namespace: Firefox computes it `inline`.
 */
function domCoupling(source: TreeNode): (node: TreeNode) => boolean {
  const owner = (source as { ownerDocument?: { defaultView: Window | null } }).ownerDocument;
  const view = owner?.defaultView;
  if (view === null || view === undefined) return () => false;

  return (node) => {
    const style = view.getComputedStyle(node as unknown as Element);
    const display = style.display;
    if (display.startsWith("table") || display === "inline-table") {
      // Fixed layout resolves the columns from the first row and the author's
      // widths, so the rows below the cut cannot change the rows above it.
      return style.tableLayout !== "fixed";
    }
    if (/flex|grid/.test(display) || (node as { namespaceURI?: string }).namespaceURI === MATHML_NS) return true;
    return style.columnCount !== "auto" || style.columnWidth !== "auto";
  };
}

function resolveNode(source: TreeNode, path: readonly number[]): TreeNode | null {
  let node: TreeNode = source;
  for (const index of path) {
    const next: TreeNode | undefined = node.childNodes[index];
    if (next === undefined) return null;
    node = next;
  }
  return node;
}
