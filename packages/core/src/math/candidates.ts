/**
 * Break candidates inside a display equation (`doc/math.md` §4).
 *
 * The reduction that makes math cheap: §3's machine is "collect candidates,
 * score them, pick the cheapest that fits", and an equation wider than the
 * measure is that problem on the inline axis. So this is the twin of
 * `candidates.ts` — same `Candidate`, same `chooseBreak`, same penalty scale —
 * with no fragmenter of its own.
 *
 * It reads layout once, in one batched call, because MathML never wraps: every
 * child of the top row is on one line, so a child's inline end *is* the width
 * up to that point and selection is arithmetic after it. A preprocessing
 * library would have to guess those widths; inside the engine we read them.
 *
 * Deletion condition (`math.md` §4): `w3c/mathml-core#127`. If browsers
 * implement MathML line breaking, this file, `math/penalties.ts` and
 * `math/compose.ts` go, and CSS does it.
 */
import { positionOf } from "../position.js";
import { classifyOperator, penaltyAfter, MATH_PENALTIES } from "./penalties.js";
import type { Candidate } from "../penalties.js";
import type { Measurer, Rect } from "../types.js";
import type { Deletion } from "../native.js";

/** A candidate with the level it was found at, so descent can be rationed. */
export type MathCandidate = Candidate & {
  /** 0 for the top row, 1 for one level in. */
  depth: number;
  /** What was broken after, for the alignment decision in composition. */
  operator: "relation" | "binary" | "separator";
};

export type MathCandidateOptions = {
  measurer: Measurer;
  /** How far to descend below the top row. §4's limit is two. */
  maxDepth?: number;
};

/**
 * Elements a break may never fall inside (`math.md` §4).
 *
 * Matched on `localName`, not `tagName`: a MathML element in an HTML document
 * keeps the case it was written in, so `tagName` is `mo`, not `MO`, and an
 * uppercase comparison silently finds no candidates anywhere.
 */
const OPAQUE = new Set([
  "msub", "msup", "msubsup", "munder", "mover", "munderover", "mmultiscripts",
  "mfrac", "msqrt", "mroot", "mtable", "mtext", "ms", "maction",
]);

/** Elements that are pure grouping, so their children are the real row. */
const TRANSPARENT = new Set(["mrow", "mstyle", "mpadded", "semantics"]);

/**
 * The row whose children are the equation's top level. `<math>` holding one
 * `<mrow>` — what every TeX converter emits — has its top level one step down,
 * and a `<semantics>` wrapper (the TeX annotation, §7) is another. Walking
 * through them is the difference between finding every break and finding none.
 */
export function topRow(math: Element): Element {
  let row = math;
  for (;;) {
    const children = mathChildren(row);
    const only = children.length === 1 ? children[0] : undefined;
    // <semantics> is not single-child: the presentation tree comes first and
    // the annotations follow it. Take the first child and leave them alone.
    if (row.localName === "semantics" && children.length > 0) {
      row = children[0] as Element;
      continue;
    }
    if (only !== undefined && TRANSPARENT.has(only.localName)) {
      row = only;
      continue;
    }
    return row;
  }
}

/**
 * Every place this equation may be broken, in document order, with inline
 * extents measured from its start. One `boxes()` call covers every depth: the
 * walk that collects the operators touches no layout.
 */
export function mathCandidates(
  math: Element,
  { measurer, maxDepth = 2 }: MathCandidateOptions,
): MathCandidate[] {
  const found: { op: Element; depth: number; kind: "relation" | "binary" | "separator" }[] = [];

  const walk = (row: Element, depth: number): void => {
    const children = mathChildren(row);
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Element;
      if (child.localName === "mo") {
        // A break *after* the last child is not a break, it is the end of the
        // equation.
        if (i === children.length - 1) continue;
        const kind = classifyOperator(child.textContent);
        if (kind === "relation" || kind === "binary" || kind === "separator") {
          found.push({ op: child, depth, kind });
        }
        continue;
      }
      if (depth + 1 > maxDepth) continue;
      if (OPAQUE.has(child.localName)) continue;
      if (!TRANSPARENT.has(child.localName)) continue;
      // A fenced group is one unit however wide it is: breaking inside it
      // would leave an opening delimiter with nothing to close it on the
      // line, which is worse than the overflow it avoids.
      if (isFenced(child)) continue;
      walk(child, depth + 1);
    }
  };
  walk(topRow(math), 0);

  if (found.length === 0) return [];

  // The one read. Everything below is arithmetic.
  const rects = measurer.boxes([math, ...found.map((f) => f.op)]);
  const origin = (rects[0] as Rect).inlineStart;

  return found.map((f, i) => ({
    position: positionOf(f.op, math, { after: true }),
    kind: "block" as const,
    extent: (rects[i + 1] as Rect).inlineEnd - origin,
    penalty: (penaltyAfter(f.kind) ?? 0) + f.depth * MATH_PENALTIES.perDescent,
    depth: f.depth,
    operator: f.kind,
  }));
}

/**
 * A fenced row: first and last children are delimiters. `math.md` §4 says
 * "stretchy `<mo>`", but the attribute is usually absent — the operator
 * dictionary makes a parenthesis stretchy unasked, and only an author
 * suppressing it writes `stretchy="false"`. So the test is the character, and
 * an explicit `stretchy="false"` is taken at its word.
 */
export function isFenced(row: Element): boolean {
  const children = mathChildren(row);
  if (children.length < 2) return false;
  const first = children[0] as Element;
  const last = children[children.length - 1] as Element;
  return isFence(first) && isFence(last);
}

function isFence(el: Element): boolean {
  if (el.localName !== "mo") return false;
  if (el.getAttribute("stretchy") === "false") return false;
  return classifyOperator(el.textContent) === "fence";
}

const ELEMENT_NODE = 1;

/** As in `candidates.ts`: from `childNodes`, so it walks the tree `Position`
 * indexes. */
export function mathChildren(element: Element): Element[] {
  const out: Element[] = [];
  const nodes = element.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node !== undefined && node.nodeType === ELEMENT_NODE) out.push(node as Element);
  }
  return out;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "math line breaking",
  files: ["math/candidates.ts", "math/penalties.ts", "math/compose.ts"],
  feature: "Breaking display equations on the inline axis",
  when: "Browsers implement MathML line breaking (`w3c/mathml-core#127`)",
  tests: [],
  untested: "Decided by `w3c/mathml-core#127`, not WPT: there is no test to run until it is specified",
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
