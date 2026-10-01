/**
 * Splitting text at line boxes (`doc/plan.md` §3).
 *
 * "Group `Range.getClientRects()` into lines and break after the last line
 * that fits." Grouping is the measurer's job (`groupIntoLines`); this is the
 * other half — turning a line number into a character offset in the source,
 * which is what `Position` stores and what composition will cut on.
 *
 * It is a binary search over prefixes, not a walk. Paged.js measures word by
 * word and then letter by letter (§1, "word-then-letter text measurement");
 * for a 2,000-character paragraph that is thousands of measurements where
 * eleven will do. The search works because the number of lines in a prefix
 * only ever grows as the prefix grows.
 */
import type { Measurer } from "./types.js";
import { scratchRange } from "./dom-measurer.js";

/** How the engine addresses the text of an element. Injected, so the search
 * can be tested without a DOM. */
export type TextRanges = {
  /** Characters of text inside the element, in document order. */
  length(el: Element): number;
  /** A range covering the element's first `chars` characters. */
  prefix(el: Element, chars: number): Range;
};

const TEXT_NODE = 3;

/** Text nodes of an element in document order, with their cumulative starts. */
function textNodes(el: Element): { node: Node; start: number }[] {
  const out: { node: Node; start: number }[] = [];
  let total = 0;

  const walk = (node: Node): void => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      if (child === undefined) continue;
      if (child.nodeType === TEXT_NODE) {
        out.push({ node: child, start: total });
        total += (child.textContent ?? "").length;
      } else {
        walk(child);
      }
    }
  };
  walk(el);
  return out;
}

/** `TextRanges` over real DOM. */
export function domTextRanges(): TextRanges {
  return {
    length(el) {
      const nodes = textNodes(el);
      const last = nodes[nodes.length - 1];
      return last === undefined ? 0 : last.start + (last.node.textContent ?? "").length;
    },

    prefix(el, chars) {
      const doc = el.ownerDocument;
      const range = scratchRange(doc);
      const nodes = textNodes(el);
      const first = nodes[0];
      if (first === undefined) {
        range.selectNodeContents(el);
        return range;
      }

      range.setStart(first.node, 0);
      for (const { node, start } of nodes) {
        const length = (node.textContent ?? "").length;
        if (chars <= start + length) {
          range.setEnd(node, Math.max(0, chars - start));
          return range;
        }
      }
      const last = nodes[nodes.length - 1] as { node: Node; start: number };
      range.setEnd(last.node, (last.node.textContent ?? "").length);
      return range;
    },
  };
}

/**
 * The character offset at which line `line` ends, or null if the element has
 * no such line.
 *
 * `line` is 1-based and counts lines kept: `offsetAtLine(el, 3)` is where a
 * break that leaves three lines behind would cut.
 */
export function offsetAtLine(
  el: Element,
  line: number,
  { measurer, ranges }: { measurer: Measurer; ranges: TextRanges },
): number | null {
  if (line < 1) return null;

  const total = ranges.length(el);
  if (total === 0) return null;

  const linesIn = (chars: number): number =>
    chars === 0 ? 0 : measurer.lineBoxes(ranges.prefix(el, chars)).length;

  // Not enough lines to break after this one: the whole element fits before it.
  if (linesIn(total) <= line) return null;

  // Largest prefix that still occupies `line` lines. Adding one character adds
  // at most one line, so the predicate is monotonic and binary search is safe.
  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (linesIn(mid) <= line) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? null : lo;
}
