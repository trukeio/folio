import { describe, expect, it } from "vitest";
import { capOf } from "./footnotes.js";

describe("capOf", () => {
  // `@footnote { max-height }` is the area's cap (`review.md` §6.1).
  it("reads a percentage of the page area's block size", () => {
    expect(capOf({ "max-height": "30%" }, 600, 420)).toBe(180);
  });
  it("reads pixels, and the logical name too", () => {
    expect(capOf({ "max-height": "120px" }, 600, 420)).toBe(120);
    expect(capOf({ "max-block-size": "50%" }, 600, 420)).toBe(300);
  });
  it("falls back to the default without one, or for a value it cannot read", () => {
    expect(capOf({}, 600, 420)).toBe(420);
    expect(capOf({ "max-height": "none" }, 600, 420)).toBe(420);
  });
});
