import { describe, expect, it } from "vitest";
import { classifyOperator, MATH_PENALTIES, penaltyAfter } from "./penalties.js";

describe("classifyOperator", () => {
  it("knows TeX's three break classes apart", () => {
    expect(classifyOperator("=")).toBe("relation");
    expect(classifyOperator("≤")).toBe("relation");
    expect(classifyOperator("∈")).toBe("relation");
    expect(classifyOperator("+")).toBe("binary");
    expect(classifyOperator("−")).toBe("binary");
    expect(classifyOperator("×")).toBe("binary");
    expect(classifyOperator(",")).toBe("separator");
  });

  it("reads an arrow as a relation, whichever arrow it is", () => {
    // There are too many arrows to list, and TeX gives them all class 3.
    for (const arrow of ["→", "←", "↔", "⇒", "⟶", "⤳"]) {
      expect(classifyOperator(arrow), arrow).toBe("relation");
    }
  });

  it("ignores the whitespace a pretty-printer leaves around an operator", () => {
    expect(classifyOperator(" = ")).toBe("relation");
    expect(classifyOperator("\n  +\n")).toBe("binary");
  });

  it("classifies a composed operator by its first character", () => {
    expect(classifyOperator(":=")).toBe("relation");
    expect(classifyOperator("+=")).toBe("binary");
  });

  it("calls a delimiter a fence, which is not a break position", () => {
    for (const fence of ["(", ")", "[", "]", "{", "}", "⟨", "⟩"]) {
      expect(classifyOperator(fence), fence).toBe("fence");
    }
  });

  it("has nothing to say about an operator it does not know", () => {
    expect(classifyOperator("∑")).toBe("other");
    expect(classifyOperator("")).toBe("other");
  });
});

describe("penaltyAfter", () => {
  it("orders the classes as TeX does: relation, operator, separator", () => {
    const relation = penaltyAfter("relation") ?? Infinity;
    const binary = penaltyAfter("binary") ?? Infinity;
    const separator = penaltyAfter("separator") ?? Infinity;
    expect(relation).toBeLessThan(binary);
    expect(binary).toBeLessThan(separator);
  });

  it("refuses a fence outright rather than pricing it", () => {
    // Not `PROHIBITED`: null keeps it out of the candidate list entirely, so
    // nothing downstream has to filter it.
    expect(penaltyAfter("fence")).toBeNull();
    expect(penaltyAfter("other")).toBeNull();
  });

  it("charges a descent more than any top-level break is worth", () => {
    expect(MATH_PENALTIES.perDescent).toBeGreaterThan(MATH_PENALTIES.afterSeparator);
  });
});
