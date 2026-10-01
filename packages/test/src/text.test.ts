/**
 * M1.4: line number to character offset.
 *
 * Tested against a model of wrapping with known break points, so the search
 * can be checked exactly — including that it finds the *last* offset on a
 * line, and how many measurements it takes to get there.
 */
import { describe, expect, it } from "vitest";
import { offsetAtLine } from "@truke/folio";
import type { Measurer, TextRanges } from "@truke/folio";
import { blockRect } from "./fake-measurer.js";

/**
 * A paragraph that wraps every `perLine` characters. `prefix` hands back the
 * character count; the measurer turns it into that many line boxes.
 */
function wrappingText(total: number, perLine: number) {
  let measurements = 0;

  const ranges: TextRanges = {
    length: () => total,
    prefix: (_el, chars) => ({ chars }) as unknown as Range,
  };

  const measurer: Measurer = {
    box: () => blockRect(0, 0),
    boxes: () => [],
    lineBoxes: (range) => {
      measurements++;
      const { chars } = range as unknown as { chars: number };
      const lines = Math.ceil(chars / perLine);
      return Array.from({ length: lines }, (_, i) => blockRect(i * 20, (i + 1) * 20));
    },
    styleOf: () => ({}),
  };

  return { ranges, measurer, measurements: () => measurements };
}

const el = {} as Element;

describe("offsetAtLine", () => {
  it("finds the last character that still sits on the given line", () => {
    const { ranges, measurer } = wrappingText(100, 10);

    expect(offsetAtLine(el, 1, { measurer, ranges })).toBe(10);
    expect(offsetAtLine(el, 3, { measurer, ranges })).toBe(30);
    expect(offsetAtLine(el, 9, { measurer, ranges })).toBe(90);
  });

  it("has no answer for a line the element does not reach", () => {
    const { ranges, measurer } = wrappingText(100, 10);
    // Ten lines exist, so there is no break that leaves ten behind — the
    // whole paragraph fits before it.
    expect(offsetAtLine(el, 10, { measurer, ranges })).toBeNull();
    expect(offsetAtLine(el, 99, { measurer, ranges })).toBeNull();
  });

  it("refuses a line number below one", () => {
    const { ranges, measurer } = wrappingText(100, 10);
    expect(offsetAtLine(el, 0, { measurer, ranges })).toBeNull();
  });

  it("has no answer for an empty element", () => {
    const { ranges, measurer } = wrappingText(0, 10);
    expect(offsetAtLine(el, 1, { measurer, ranges })).toBeNull();
  });

  it("searches rather than walks", () => {
    // §1 drops Paged.js's word-then-letter measuring. For 2,000 characters
    // that is thousands of measurements where a search needs about eleven.
    const { ranges, measurer, measurements } = wrappingText(2000, 60);

    offsetAtLine(el, 5, { measurer, ranges });

    expect(measurements()).toBeLessThan(20);
  });

  it("is exact on an uneven wrap", () => {
    // Lines of 7 characters: line 2 ends at 14, not at a rounded number.
    const { ranges, measurer } = wrappingText(50, 7);
    expect(offsetAtLine(el, 2, { measurer, ranges })).toBe(14);
  });

  it("agrees with the line count it is derived from", () => {
    const { ranges, measurer } = wrappingText(83, 9);
    for (let line = 1; line <= 8; line++) {
      const offset = offsetAtLine(el, line, { measurer, ranges }) as number;
      // The prefix ending here occupies exactly `line` lines...
      expect(measurer.lineBoxes(ranges.prefix(el, offset)).length).toBe(line);
      // ...and one character more spills onto the next.
      expect(measurer.lineBoxes(ranges.prefix(el, offset + 1)).length).toBe(line + 1);
    }
  });
});

/** A wrap where one line is much longer than the others, as a long word does. */
describe("offsetAtLine with irregular lines", () => {
  const breaks = [0, 12, 19, 55, 70];

  const ranges: TextRanges = {
    length: () => 70,
    prefix: (_el, chars) => ({ chars }) as unknown as Range,
  };
  const measurer: Measurer = {
    box: () => blockRect(0, 0),
    boxes: () => [],
    lineBoxes: (range) => {
      const { chars } = range as unknown as { chars: number };
      const lines = breaks.filter((_, i) => i > 0 && chars > (breaks[i - 1] as number)).length;
      return Array.from({ length: lines }, (_, i) => blockRect(i * 20, (i + 1) * 20));
    },
    styleOf: () => ({}),
  };

  it("finds each irregular boundary", () => {
    expect(offsetAtLine(el, 1, { measurer, ranges })).toBe(12);
    expect(offsetAtLine(el, 2, { measurer, ranges })).toBe(19);
    expect(offsetAtLine(el, 3, { measurer, ranges })).toBe(55);
  });
});
