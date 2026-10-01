import { describe, expect, it } from "vitest";
import { chooseBreak } from "./select.js";
import { FORCED, PENALTIES, PROHIBITED, widowOrphanPenalty } from "./penalties.js";
import type { Candidate } from "./penalties.js";

const at = (extent: number, penalty: number, kind: Candidate["kind"] = "block"): Candidate => ({
  position: { path: [extent], offset: 0, after: false },
  kind,
  extent,
  penalty,
});

describe("chooseBreak", () => {
  it("takes the cheapest candidate that fits", () => {
    const choice = chooseBreak(
      [at(100, PENALTIES.betweenLines), at(200, PENALTIES.betweenBlocks), at(400, 0)],
      300,
    );
    expect(choice?.candidate.extent).toBe(200);
    expect(choice?.overflowed).toBe(false);
  });

  it("fills the page rather than stopping at the first free break", () => {
    // The block break is free and the line break costs ten, but stopping at
    // the block break leaves 200px of the page empty. Judging a break only by
    // what it does to the text, and not by what it leaves on the floor, is how
    // a page ends after one paragraph.
    const choice = chooseBreak([at(100, PENALTIES.betweenBlocks), at(290, PENALTIES.betweenLines, "line")], 300);
    expect(choice?.candidate.extent).toBe(290);
  });

  it("still leaves the page short rather than orphan a line", () => {
    // Same shape, but now the fuller break orphans a line. White space is
    // cheaper than bad typography: on a 300px page the whole page is worth
    // 300, and an orphan is worth 500.
    const choice = chooseBreak(
      [
        at(100, PENALTIES.betweenBlocks),
        at(290, PENALTIES.betweenLines + PENALTIES.perOrphan, "line"),
      ],
      300,
    );
    expect(choice?.candidate.extent).toBe(100);
  });

  it("prefers the later break when two cost the same", () => {
    // Equally good typography, and the later one puts more on the page.
    const choice = chooseBreak([at(100, 0), at(250, 0)], 300);
    expect(choice?.candidate.extent).toBe(250);
  });

  it("pays a higher penalty only when the cheap break does not fit", () => {
    const choice = chooseBreak(
      [at(150, PENALTIES.insideAvoid), at(500, PENALTIES.betweenBlocks)],
      300,
    );
    expect(choice?.candidate.extent).toBe(150);
    expect(choice?.candidate.penalty).toBe(PENALTIES.insideAvoid);
  });

  it("honours a forced break over any cheaper candidate", () => {
    // plan.md §9: every forced break is honoured. Not a preference to weigh.
    const choice = chooseBreak([at(120, FORCED), at(280, PENALTIES.betweenBlocks)], 300);
    expect(choice?.candidate.extent).toBe(120);
  });

  it("ignores a forced break that does not fit, leaving it to the next page", () => {
    const choice = chooseBreak([at(200, PENALTIES.betweenBlocks), at(900, FORCED)], 300);
    expect(choice?.candidate.extent).toBe(200);
  });

  it("takes the first forced break when there are several", () => {
    const choice = chooseBreak([at(100, FORCED), at(200, FORCED)], 300);
    expect(choice?.candidate.extent).toBe(100);
  });

  it("never breaks where it is prohibited", () => {
    const choice = chooseBreak([at(100, PROHIBITED), at(250, PENALTIES.betweenLines)], 300);
    expect(choice?.candidate.extent).toBe(250);
  });

  it("overflows with the least-bad break rather than dropping content", () => {
    const choice = chooseBreak([at(500, PENALTIES.insideAvoid), at(600, 0)], 300);
    expect(choice?.overflowed).toBe(true);
    expect(choice?.candidate.extent).toBe(600);
  });

  it("has no answer when every candidate is prohibited", () => {
    expect(chooseBreak([at(100, PROHIBITED)], 300)).toBeNull();
    expect(chooseBreak([], 300)).toBeNull();
  });
});

describe("widowOrphanPenalty", () => {
  it("is free when the constraint is met", () => {
    expect(widowOrphanPenalty(5, 5, { widows: 3, orphans: 3 })).toBe(0);
  });

  it("charges per missing line", () => {
    expect(widowOrphanPenalty(1, 9, { widows: 3, orphans: 3 })).toBe(2 * PENALTIES.perOrphan);
    expect(widowOrphanPenalty(9, 1, { widows: 3, orphans: 3 })).toBe(2 * PENALTIES.perWidow);
  });

  it("charges a block too short to satisfy both constraints, so it moves whole", () => {
    // Four lines cannot give three to each side, so every interior break is
    // bad. Charging for all of them makes the cheaper break *before* the block
    // win, which moves it to the next page intact.
    expect(widowOrphanPenalty(2, 2, { widows: 3, orphans: 3 })).toBe(
      PENALTIES.perOrphan + PENALTIES.perWidow,
    );
  });

  it("defaults to the CSS initial values of 2", () => {
    expect(widowOrphanPenalty(1, 5)).toBe(PENALTIES.perOrphan);
  });

  it("makes a 3-line equation never split 1 + 2 against a 2-line widow rule", () => {
    // math.md §9 asks for exactly this property. Both possible splits of a
    // 3-line block cost something, so the break before it wins and it moves
    // whole.
    expect(widowOrphanPenalty(1, 2, { widows: 2, orphans: 2 })).toBe(PENALTIES.perOrphan);
    expect(widowOrphanPenalty(2, 1, { widows: 2, orphans: 2 })).toBe(PENALTIES.perWidow);

    const keepTogether = chooseBreak(
      [
        // before the equation
        { position: { path: [0], offset: 0, after: true }, kind: "block", extent: 100, penalty: PENALTIES.betweenBlocks },
        // after its first line
        { position: { path: [1, 0], offset: 0, after: true }, kind: "line", extent: 140, penalty: PENALTIES.betweenLines + PENALTIES.perOrphan },
      ],
      200,
    );
    expect(keepTogether?.candidate.extent).toBe(100);
  });
});
