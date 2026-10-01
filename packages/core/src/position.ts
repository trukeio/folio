/**
 * Positions in the source tree (`doc/plan.md` §2).
 *
 * A `Position` is a path of child indices from the root plus an offset. It is
 * plain data, comparable by value, and it never holds a node — which is what
 * lets a page be described by `(spec, start)` and laid out again by a function
 * call, instead of by stopping and restarting a walk over live DOM.
 *
 * `path` indexes `childNodes`, not `children`: a break can fall inside a text
 * node, and text nodes have to be addressable for `offset` to mean anything.
 * (The corpus placement model in `@truke/folio-test` uses element-only paths, for
 * a different job: comparing against Paged.js output, where our text nodes do
 * not exist. `elementPath` below converts.)
 */
import type { Position } from "./types.js";

/** The structural part of a DOM node this module needs. */
type TreeNode = {
  readonly childNodes: ArrayLike<TreeNode>;
  readonly parentNode: TreeNode | null;
  readonly nodeType: number;
};

const TEXT_NODE = 3;

export const START: Position = { path: [], offset: 0, after: false };

/** Where `node` sits relative to `root`, optionally inside its text. */
export function positionOf(
  node: TreeNode,
  root: TreeNode,
  { offset = 0, after = false }: { offset?: number; after?: boolean } = {},
): Position {
  const path: number[] = [];
  let current: TreeNode = node;

  // Walking off the top without meeting root is the only failure mode: it
  // means the caller handed us a node from another tree.
  while (current !== root) {
    const parent = current.parentNode;
    if (parent === null) throw new Error("node is not a descendant of root");
    const index = indexIn(parent, current);
    if (index === -1) throw new Error("node is not among its parent's children");
    path.unshift(index);
    current = parent;
  }

  return { path, offset, after };
}

function indexIn(parent: TreeNode, child: TreeNode): number {
  const children = parent.childNodes;
  for (let i = 0; i < children.length; i++) {
    if (children[i] === child) return i;
  }
  return -1;
}

/** The node a position names, or null if the tree no longer has it. */
export function resolve(root: TreeNode, position: Position): TreeNode | null {
  let node: TreeNode = root;
  for (const index of position.path) {
    const next: TreeNode | undefined = node.childNodes[index];
    if (next === undefined) return null;
    node = next;
  }
  return node;
}

/**
 * Document order: negative if `a` comes first, 0 if identical, positive if `b`
 * does. An ancestor precedes its descendants unless it is an `after` position,
 * which follows all of them — that is what makes `after` worth storing rather
 * than deriving.
 */
export function comparePositions(a: Position, b: Position): number {
  const shared = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < shared; i++) {
    const d = (a.path[i] as number) - (b.path[i] as number);
    if (d !== 0) return d;
  }

  if (a.path.length !== b.path.length) {
    // One is an ancestor of the other. The ancestor comes first, unless it is
    // positioned after its own subtree.
    const ancestorIsA = a.path.length < b.path.length;
    // A slice of a box is past its content, as `after` is.
    const ancestorAfter = ancestorIsA ? a.after || a.slice !== undefined : b.after || b.slice !== undefined;
    if (ancestorAfter) return ancestorIsA ? 1 : -1;
    return ancestorIsA ? -1 : 1;
  }

  // `after` outranks `offset`: it means "past this node entirely", so it is
  // beyond every offset within it, not merely beyond offset 0. Comparing
  // offsets first puts the end of a text node *before* a position inside it,
  // which silently cuts pages in the wrong place.
  if (a.after !== b.after) return a.after ? 1 : -1;
  // The box's start, then its slices in order, then past it.
  if ((a.slice ?? -1) !== (b.slice ?? -1)) return (a.slice ?? -1) - (b.slice ?? -1);
  if (a.offset !== b.offset) return a.offset - b.offset;
  return 0;
}

export const isBefore = (a: Position, b: Position): boolean => comparePositions(a, b) < 0;
export const isAfter = (a: Position, b: Position): boolean => comparePositions(a, b) > 0;
export const isSame = (a: Position, b: Position): boolean => comparePositions(a, b) === 0;

/** A stable string form, for snapshots and debugging: `0.3.1+12^`. */
export function positionKey(p: Position): string {
  return `${p.path.join(".")}+${p.offset}${p.after ? "^" : ""}${p.slice === undefined ? "" : `@${String(p.slice)}`}`;
}

/**
 * The same position as a path of *element* indices, skipping text nodes, so it
 * can be compared with the corpus baseline. Returns null if the position is
 * inside a text node, which has no element path.
 */
export function elementPath(root: TreeNode, position: Position): number[] | null {
  const path: number[] = [];
  let node: TreeNode = root;

  for (const index of position.path) {
    const child: TreeNode | undefined = node.childNodes[index];
    if (child === undefined) return null;
    if (child.nodeType === TEXT_NODE) return null;
    let elementIndex = 0;
    for (let i = 0; i < index; i++) {
      if ((node.childNodes[i] as TreeNode).nodeType !== TEXT_NODE) elementIndex++;
    }
    path.push(elementIndex);
    node = child;
  }
  return path;
}
