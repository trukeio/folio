/**
 * The root's flow: its writing mode and direction (`doc/review.md` §5).
 *
 * Everything that holds the page's content takes it — the content area and
 * the measuring box — so the measurer reads logical rectangles, and the rest
 * of the engine speaks block and inline. The page box itself stays physical.
 */
export type Flow = {
  writingMode: string;
  direction: string;
  /** The block axis is horizontal. */
  vertical: boolean;
  /**
   * Pages progress right to left, so page 1 is a left page: the block
   * direction in vertical writing, the inline direction in horizontal
   * (css-page-3 §4.1).
   */
  leftward: boolean;
};

export const HORIZONTAL: Flow = { writingMode: "horizontal-tb", direction: "ltr", vertical: false, leftward: false };

/** The flow of the document's root element, as its own window computes it. */
export function rootFlow(doc: Document): Flow {
  const style = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (style === undefined) return HORIZONTAL;
  const writingMode = style.writingMode || "horizontal-tb";
  const direction = style.direction || "ltr";
  const vertical = /^(vertical|sideways)/.test(writingMode);
  const leftward = vertical ? /-rl$/.test(writingMode) : direction === "rtl";
  return { writingMode, direction, vertical, leftward };
}

/** A page area's physical size as the flow's inline and block extents. */
export function flowArea(area: { inline: number; block: number }, flow: Flow): { inline: number; block: number } {
  return flow.vertical ? { inline: area.block, block: area.inline } : area;
}
