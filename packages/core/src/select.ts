/**
 * Choosing a break (`doc/plan.md` §3).
 *
 * "On overflow, take the cheapest candidate that fits, and allow costlier ones
 * only if nothing else works."
 *
 * This function is the whole of the break decision, and it is deliberately
 * arithmetic: candidates in, one candidate out, no DOM and no measurement. It
 * is also axis-agnostic — `extent` and `limit` are numbers in whichever axis is
 * being fragmented, so §7's display-equation breaking is this same function
 * turned ninety degrees, not a second implementation of it.
 */
import { FORCED, PENALTIES, PROHIBITED } from "./penalties.js";
import type { Candidate } from "./penalties.js";

export type Choice = {
  candidate: Candidate;
  /** True when nothing fit and we took the least-bad overflowing break. */
  overflowed: boolean;
};

/**
 * @param candidates in document order
 * @param limit      the available extent in the fragmentation axis
 * @param wastePerPixel cost of leaving the page short, per pixel
 */
export function chooseBreak(
  candidates: readonly Candidate[],
  limit: number,
  wastePerPixel = PENALTIES.wastePerPixel,
): Choice | null {
  if (candidates.length === 0) return null;

  const allowed = candidates.filter((c) => c.penalty !== PROHIBITED);
  if (allowed.length === 0) return null;

  // A forced break is not a preference to be weighed. The first one that fits
  // wins outright; a forced break past the limit is the next page's problem.
  const forced = allowed.find((c) => c.penalty === FORCED && c.extent <= limit);
  if (forced !== undefined) return { candidate: forced, overflowed: false };

  const fitting = allowed.filter((c) => c.extent <= limit);
  if (fitting.length === 0) {
    // Nothing fits: take the least-bad break rather than dropping content, and
    // say so, because a page that overflows is a bug somewhere upstream.
    const best = leastBad(allowed);
    return { candidate: best, overflowed: true };
  }

  // The cost of a break is what it does to the text *and* what it leaves on
  // the floor. Judging only the first fills a page to its first free break and
  // stops, however much room is left.
  const cost = (c: Candidate): number => c.penalty + wastePerPixel * (limit - c.extent);

  let best = fitting[0] as Candidate;
  for (const c of fitting) {
    const d = cost(c) - cost(best);
    // Equal cost: the later break, which puts more on the page.
    if (d < 0 || (d === 0 && c.extent > best.extent)) best = c;
  }
  return { candidate: best, overflowed: false };
}

/** The cheapest candidate, earliest wins, used only when nothing fits. */
function leastBad(candidates: readonly Candidate[]): Candidate {
  let best = candidates[0] as Candidate;
  for (const c of candidates) {
    if (c.penalty < best.penalty) best = c;
  }
  return best;
}
