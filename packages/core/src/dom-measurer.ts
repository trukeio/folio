/**
 * The `Measurer` over real layout (`doc/plan.md` §2).
 *
 * Everything the fragmenter knows about the page comes through here, which is
 * what lets break logic be unit-tested against synthetic boxes. It is also the
 * only file that knows how logical axes map onto physical ones: the rest of
 * the engine says block-start and inline-end and never top or left, so
 * vertical writing is a change here and nowhere else (§3, §4).
 */
import type { Measurer, Rect } from "./types.js";

type Physical = { top: number; right: number; bottom: number; left: number };

type Mapping = (r: Physical) => Rect;

/** How a writing mode maps physical edges onto logical ones. */
function mappingFor(writingMode: string, direction: string): Mapping {
  const rtl = direction === "rtl";

  if (writingMode.startsWith("vertical") || writingMode.startsWith("sideways")) {
    // Block flows horizontally. vertical-rl runs right to left.
    const rl = writingMode === "vertical-rl" || writingMode === "sideways-rl";
    return (r) => ({
      blockStart: rl ? -r.right : r.left,
      blockEnd: rl ? -r.left : r.right,
      inlineStart: rtl ? -r.bottom : r.top,
      inlineEnd: rtl ? -r.top : r.bottom,
    });
  }

  return (r) => ({
    blockStart: r.top,
    blockEnd: r.bottom,
    inlineStart: rtl ? -r.right : r.left,
    inlineEnd: rtl ? -r.left : r.right,
  });
}

const SCRATCH = new WeakMap<Document, Range>();

/**
 * The one `Range` the engine measures with, per document.
 *
 * A range is live: while it exists, the document keeps it up to date through
 * every mutation, and in Firefox that includes every attribute change. The
 * engine used to make a new range for each measurement — every line count,
 * every stretch of loose text — and each one lived until the garbage
 * collector next ran. With tens of thousands of them waiting, one
 * `style.setProperty` on anything in the document took 1.5ms instead of
 * 0.005ms, and laying out the margin boxes of the 332-page book took Firefox
 * 160 seconds. Every use sets both ends before it reads, and nothing holds
 * the range across a call, so one is enough.
 */
export function scratchRange(doc: Document): Range {
  let range = SCRATCH.get(doc);
  if (range === undefined) {
    range = doc.createRange();
    SCRATCH.set(doc, range);
  }
  return range;
}

/**
 * Extents are in the coordinate space the browser reports, so a caller
 * comparing them against a page limit must express that limit in the same
 * space — `origin + available`, not `available`.
 */
export function domMeasurer(root: Element): Measurer {
  const view = root.ownerDocument.defaultView;
  if (view === null) throw new Error("element is not in a rendered document");

  const rootStyle = view.getComputedStyle(root);
  const map = mappingFor(rootStyle.writingMode, rootStyle.direction);

  const toLogical = (r: DOMRect): Rect =>
    map({ top: r.top, right: r.right, bottom: r.bottom, left: r.left });

  return {
    box(el) {
      return toLogical(el.getBoundingClientRect());
    },

    boxes(els) {
      // One pass, no writes in between: the browser answers all of these from
      // a single layout rather than one per element (§3).
      return els.map((el) => toLogical(el.getBoundingClientRect()));
    },

    lineBoxes(range) {
      const rects = [...range.getClientRects()].map(toLogical);
      return groupIntoLines(rects);
    },

    styleOf(el, props) {
      const style = view.getComputedStyle(el);
      const out: Record<string, string> = {};
      for (const p of props) out[p] = style.getPropertyValue(p);
      return out;
    },
  };
}

/**
 * `getClientRects()` gives one rect per line *fragment*, so a line containing
 * an inline element arrives as several. Group them, or every such line looks
 * like several break opportunities that do not exist.
 *
 * A fragment belongs to a line when either's vertical middle falls inside the
 * other — not when they share a top edge. A superscript, a subscript and a
 * `<math>` element's own box each start a few pixels away from the text
 * around them, 4 to 8px at 9.5pt, and grouping by top edge counted a two-line
 * paragraph with a formula in it as three or four lines. That misjudged widows and orphans (a lone
 * last line was taken for two), and offered breaks in the middle of a line,
 * inside the formula. The middle is also what keeps adjacent lines apart when
 * a tight `line-height` makes their boxes overlap: the next line's middle is
 * still below this one's end.
 */
export function groupIntoLines(rects: readonly Rect[], tolerance = 1): Rect[] {
  if (rects.length === 0) return [];

  const sorted = [...rects].sort(
    (a, b) => a.blockStart - b.blockStart || a.inlineStart - b.inlineStart,
  );
  const lines: Rect[] = [];

  for (const rect of sorted) {
    const current = lines[lines.length - 1];
    if (current !== undefined && (within(rect, current, tolerance) || within(current, rect, tolerance))) {
      lines[lines.length - 1] = {
        blockStart: Math.min(current.blockStart, rect.blockStart),
        blockEnd: Math.max(current.blockEnd, rect.blockEnd),
        inlineStart: Math.min(current.inlineStart, rect.inlineStart),
        inlineEnd: Math.max(current.inlineEnd, rect.inlineEnd),
      };
    } else {
      lines.push({ ...rect });
    }
  }
  return lines;
}

/**
 * Is `a`'s vertical middle inside `b`? Asked both ways round, because the
 * fragment that happens to sort first on a line may be a superscript, whose
 * own extent is too small to hold the text's middle.
 */
function within(a: Rect, b: Rect, tolerance: number): boolean {
  const middle = (a.blockStart + a.blockEnd) / 2;
  return middle >= b.blockStart - tolerance && middle <= b.blockEnd + tolerance;
}
