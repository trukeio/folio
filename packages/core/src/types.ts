/**
 * The core data model of `doc/plan.md` §2.
 *
 * These are the types every stage passes to the next. They land in M0.0 with no
 * implementation behind them on purpose: the harness (M0.1) and the fake
 * measurer are written against them before there is an engine, so the break
 * logic of M1 can be unit-tested against synthetic boxes.
 */

/** A rectangle read from the browser, in CSS pixels. */
export type Rect = {
  blockStart: number;
  blockEnd: number;
  inlineStart: number;
  inlineEnd: number;
};

/** Resolved edge widths (margins, padding, borders). */
export type Box = {
  blockStart: number;
  blockEnd: number;
  inlineStart: number;
  inlineEnd: number;
};

/**
 * The axis a break is taken on (§3, "one machine, two axes").
 *
 * `block` fragments a page; `inline` fragments a display equation wider than
 * the measure. Same candidates, same penalties, same cheapest-that-fits rule.
 * The parameter exists from M1 because retrofitting it means rewriting the
 * selector with math already depending on it.
 */
export type Axis = "block" | "inline";

/** A position in the unchanging source tree: child indices from the root. */
export type Position = {
  path: number[];
  offset: number;
  after: boolean;
  /**
   * A break inside the box at `path`, this many pixels into its border box:
   * content taller than the page, drawn whole on every page it crosses and
   * shifted up by what earlier pages showed (`doc/review.md` §4). Past all
   * of the box's content in document order, and before the box's end.
   */
  slice?: number;
  /**
   * How much of each split box's border box the pages up to here used, by
   * source path (`extents.ts`). Not part of where the position is: two
   * positions that differ only in this compare equal.
   */
  consumed?: Record<string, number>;
};

/**
 * Printer's marks, from `@page { marks: crop cross }` (css-page-3 §11).
 *
 * Crop marks say where the paper is trimmed; cross marks are the registration
 * targets a press lines its plates up against. Both are drawn outside the
 * bleed area, so asking for them makes the *sheet* bigger without changing
 * the page.
 */
export type PageMarks = {
  crop: boolean;
  cross: boolean;
};

export type PageSpec = {
  index: number;
  /** Named page (`page: chapter`), or null. */
  name: string | null;
  side: "left" | "right";
  blank: boolean;
  /** The trim size, resolved from `@page` rules, in CSS pixels. */
  size: [number, number];
  margins: Box;
  /**
   * How far the painting area reaches past the trim edge, per side.
   *
   * An image meant to run off the edge of a printed page is drawn into this
   * so that a trim a millimetre out still leaves no white strip. It is not
   * part of the page: `contentArea` never sees it, so a bleed cannot move a
   * single break.
   */
  bleed: Box;
  marks: PageMarks;
  /**
   * The page's own `background` and `background-*` declarations: the bottom
   * of css-page-3 §3.1's painting order, beneath the document canvas, over
   * the whole page box, margins included. Absent is none.
   */
  background?: Record<string, string>;
  /** The page box's border and padding widths (`css/page-box.ts`). Absent is zero. */
  border?: Box;
  padding?: Box;
  /**
   * Its `border-*`, `outline-*`, `color` and `visibility` declarations, for
   * painting the border — and `visibility` for the page background as well:
   * `@page { visibility: hidden }` hides what the page box paints and none of
   * what is on it (WPT `page-visibility-hidden-001`).
   */
  decoration?: Record<string, string>;
};

/**
 * A page, fully described by `(spec, start)` — which is what makes laying out
 * page *n* again a function call rather than a stop and restart, and what
 * removes the bug class behind Paged.js's `specs/infinite-loop` test.
 */
export type PageRecord = {
  spec: PageSpec;
  start: Position;
  end: Position;
  /** Ids this page reads, e.g. through `target-counter()`. */
  refs: Set<string>;
  /** Ids whose page number this page defines. */
  provides: Set<string>;
  /**
   * What `counter(page)` prints on it, which is not always its index:
   * `counter-reset: page 1` on the body of a book, `@page { counter-increment:
   * page 2 }` (`page-counters.ts`). Set once the page's margin boxes are filled.
   */
  number?: number;
};

/**
 * Every read of layout goes through this interface, so break logic can be
 * unit-tested with fake boxes and no browser.
 */
export interface Measurer {
  box(el: Element): Rect;
  /** One batched read. Math candidates (§7) depend on this being batched. */
  boxes(els: Element[]): Rect[];
  /** `getClientRects()`, grouped into lines. */
  lineBoxes(range: Range): Rect[];
  styleOf(el: Element, props: string[]): Record<string, string>;
}
