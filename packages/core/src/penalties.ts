/**
 * The penalty table (`doc/plan.md` §3, §11).
 *
 * One exported object, because §11 says so: our breaking is greedy where TeX's
 * is optimal, we accept that, and the mitigation is that the costs live in one
 * place and can be tuned when fixtures show bad breaks. A penalty scattered
 * across the fragmenter cannot be tuned, only hunted.
 *
 * Lower is better. Two values are special, in TeX's sense:
 *
 *   FORCED      must break here; cost is irrelevant
 *   PROHIBITED  never break here, whatever it costs to go on
 */

import type { Position } from "./types.js";

export const FORCED = -Infinity;
export const PROHIBITED = Infinity;

export const PENALTIES = {
  /** Between two block siblings: the break we are always happy to take. */
  betweenBlocks: 0,
  /** Between two lines of the same paragraph: mildly worse than between blocks. */
  betweenLines: 10,
  /** Inside an element that asked us not to (`break-inside: avoid`). */
  insideAvoid: 1000,
  /** Between a heading and the block it introduces. */
  afterHeading: 800,
  /** Per line by which `widows` is unmet. */
  perWidow: 500,
  /** Per line by which `orphans` is unmet. */
  perOrphan: 500,
  /**
   * Per pixel of the page left empty.
   *
   * Without this, "the cheapest candidate that fits" (§3) reads literally as
   * "stop at the first free break", and a page ends after one paragraph
   * because breaking between blocks costs nothing while breaking between
   * lines costs ten. Pages came out 40% empty.
   *
   * At 1 per pixel the hierarchy is the one a typesetter would recognise: on a
   * 260px page, wasting the whole page costs 260, so an orphan (500), a
   * heading left at the foot (800) and splitting an `avoid` block (1000) are
   * each worth more than any amount of white space — but between two
   * acceptable breaks, the fuller page wins.
   */
  wastePerPixel: 1,
  /**
   * Through monolithic content taller than the space left: an image, a
   * `contain: size` box. Only where nothing before it on the page is a break,
   * because a box that does not fit goes to the next page if it can
   * (`doc/review.md` §4) — so more than any page's worth of waste.
   */
  sliceMonolithic: 100000,
} as const;

export type BreakKind = "block" | "line" | "forced" | "prohibited" | "slice";

/**
 * What the fragmenter knows about one possible break. `extent` is in the axis
 * being fragmented — block for pages, inline for a display equation (§3, §7) —
 * which is why nothing here names a direction.
 */
export type Candidate = {
  position: Position;
  kind: BreakKind;
  /** Where content ends in the fragmentation axis if we break here. */
  extent: number;
  penalty: number;
  /**
   * For a `line` candidate: how many lines of the element stay behind.
   *
   * It is deliberately *not* folded into `position.offset`, which is a
   * character offset. Turning "after line 3" into "after character 214" is a
   * measurement, not arithmetic — it is M1.4's job — and storing a line index
   * where a character offset is expected would be a silent lie that composition
   * would later read as truth.
   */
  line?: number;
  /**
   * For a forced break: the value that forced it (`page`, `left`, `recto`…).
   *
   * `left`, `right`, `recto` and `verso` do not merely break — they break *to
   * a side*, which can mean leaving a blank page behind. Without the value the
   * loop cannot tell those apart from a plain `page`.
   */
  breakValue?: string;
  /** The named page the content after this break is on; "" for none. */
  page?: string;
};

/**
 * Widows and orphans reduce to counting lines once text is split at line boxes
 * (§3), so this is arithmetic rather than layout.
 *
 * @param linesBefore lines of the paragraph left on this page
 * @param linesAfter  lines carried to the next
 */
export function widowOrphanPenalty(
  linesBefore: number,
  linesAfter: number,
  { widows = 2, orphans = 2 }: { widows?: number; orphans?: number } = {},
): number {
  // A block too short to satisfy both constraints is *not* exempt. Every break
  // inside it violates one, so charging for all of them is what makes the
  // fragmenter prefer the break before the block and move it whole — which is
  // the behaviour math.md §9 asks for by name: a 3-line equation is never
  // split 1 + 2. Exempting it instead makes every bad split free.
  const orphaned = Math.max(0, orphans - linesBefore);
  const widowed = Math.max(0, widows - linesAfter);
  return orphaned * PENALTIES.perOrphan + widowed * PENALTIES.perWidow;
}
