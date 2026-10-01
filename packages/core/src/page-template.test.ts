import { describe, expect, it } from "vitest";
import { MARGIN_BOXES, quotePairs, resolveContent } from "./page-template.js";

describe("MARGIN_BOXES", () => {
  it("has the sixteen boxes of CSS Paged Media 3", () => {
    expect(Object.keys(MARGIN_BOXES)).toHaveLength(16);
  });

  it("puts each box in its edge, and a corner in a corner of its own", () => {
    expect(MARGIN_BOXES["top-center"]).toBe("top");
    expect(MARGIN_BOXES["left-bottom"]).toBe("left");
    expect(MARGIN_BOXES["bottom-right-corner"]).toBe("bottom-right-corner");
  });

  it("lists them in paint order, clockwise from the top left corner", () => {
    expect(Object.keys(MARGIN_BOXES).slice(0, 6)).toEqual([
      "top-left-corner", "top-left", "top-center", "top-right", "top-right-corner", "right-top",
    ]);
    expect(Object.keys(MARGIN_BOXES).slice(-3)).toEqual(["left-bottom", "left-middle", "left-top"]);
  });
});

describe("resolveContent", () => {
  const counters = { page: 7, pages: 12 };

  it("reads a quoted string", () => {
    expect(resolveContent('"Chapter"', counters)).toBe("Chapter");
    expect(resolveContent("'Chapter'", counters)).toBe("Chapter");
  });

  it("resolves the page counters", () => {
    expect(resolveContent("counter(page)", counters)).toBe("7");
    expect(resolveContent("counter(pages)", counters)).toBe("12");
  });

  it("joins strings and counters in order", () => {
    expect(resolveContent('"page " counter(page) " of " counter(pages)', counters)).toBe(
      "page 7 of 12",
    );
  });

  it("formats a counter in the style asked for", () => {
    expect(resolveContent("counter(page, lower-roman)", counters)).toBe("vii");
    expect(resolveContent("counter(page, upper-roman)", counters)).toBe("VII");
    expect(resolveContent("counter(page, lower-alpha)", counters)).toBe("g");
    expect(resolveContent("counter(page, upper-alpha)", counters)).toBe("G");
  });

  it("counts roman numerals past the easy ones", () => {
    const at = (page: number) => resolveContent("counter(page, lower-roman)", { page, pages: page });
    expect(at(4)).toBe("iv");
    expect(at(9)).toBe("ix");
    expect(at(14)).toBe("xiv");
    expect(at(40)).toBe("xl");
    expect(at(1990)).toBe("mcmxc");
  });

  it("counts letters past z", () => {
    const at = (page: number) => resolveContent("counter(page, lower-alpha)", { page, pages: page });
    expect(at(26)).toBe("z");
    expect(at(27)).toBe("aa");
    expect(at(52)).toBe("az");
    expect(at(53)).toBe("ba");
  });

  it("reads the escapes in a string", () => {
    expect(resolveContent('"Line 1\\aLine 2"', counters)).toBe("Line 1\nLine 2");
    expect(resolveContent('"\\201C x\\201D"', counters)).toBe("\u201cx\u201d");
    expect(resolveContent('"say \\"no\\""', counters)).toBe('say "no"');
  });

  it("nests quotation marks, and a close without an open prints nothing", () => {
    const quotes = () => ({ pairs: quotePairs('"[" "]" "{" "}"'), depth: 0 });
    expect(resolveContent('open-quote "a" open-quote "b" close-quote close-quote', counters, undefined, quotes()))
      .toBe("[a{b}]");
    expect(resolveContent("close-quote open-quote open-quote open-quote", counters, undefined, quotes()))
      .toBe("[{{");
    expect(resolveContent('no-open-quote open-quote "x" close-quote', counters, undefined, quotes()))
      .toBe("{x}");
  });

  it("ignores what it does not understand rather than printing it", () => {
    // string() and target-counter() are M2. Until then a margin box that asks
    // for one gets nothing, not the literal text of the function call.
    expect(resolveContent("string(title)", counters)).toBe("");
    expect(resolveContent('"x" string(title)', counters)).toBe("x");
  });
});
