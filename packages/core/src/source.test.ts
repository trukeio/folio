import { describe, expect, it } from "vitest";
import { mediaApplies } from "./source.js";

describe("mediaApplies", () => {
  it("keeps a sheet with no media condition", () => {
    expect(mediaApplies(null)).toBe(true);
    expect(mediaApplies("")).toBe(true);
  });

  it("keeps print and all, drops screen", () => {
    // We are laying out for print in a browser that thinks it is a screen, so
    // the browser cannot answer this: `matchMedia("print")` is false in the
    // very document the pages are built in.
    expect(mediaApplies("print")).toBe(true);
    expect(mediaApplies("all")).toBe(true);
    expect(mediaApplies("screen")).toBe(false);
  });

  it("reads `not`", () => {
    expect(mediaApplies("not print")).toBe(false);
    expect(mediaApplies("not screen")).toBe(true);
  });

  it("keeps a print sheet with a feature condition on it", () => {
    // The feature test is inside the sheet, where the browser evaluates it.
    expect(mediaApplies("print and (orientation: landscape)")).toBe(true);
  });

  it("keeps a list if any query in it applies", () => {
    expect(mediaApplies("screen, print")).toBe(true);
    expect(mediaApplies("screen, projection")).toBe(true);
  });

  it("keeps what it does not understand", () => {
    // Dropping a stylesheet the author wrote is the worse failure of the two.
    expect(mediaApplies("(min-width: 20em)")).toBe(true);
    expect(mediaApplies("weird")).toBe(true);
  });
});
