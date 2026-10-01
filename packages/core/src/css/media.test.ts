import { describe, expect, it } from "vitest";
import { guardSelector, mediaApplies, resolveFeatureQueries, resolvePrintMedia } from "./media.js";

/** Whitespace is not the point of any of these. */
const tidy = (css: string): string => css.replace(/\s+/g, " ").trim();

describe("mediaApplies", () => {
  it("keeps print and all, drops screen", () => {
    expect(mediaApplies("print")).toBe(true);
    expect(mediaApplies("all")).toBe(true);
    expect(mediaApplies("screen")).toBe(false);
    expect(mediaApplies(null)).toBe(true);
    expect(mediaApplies("")).toBe(true);
  });

  it("reads `not` as the inversion it is", () => {
    expect(mediaApplies("not screen")).toBe(true);
    expect(mediaApplies("not print")).toBe(false);
  });

  it("keeps a list if any of its queries applies", () => {
    expect(mediaApplies("screen, print")).toBe(true);
    expect(mediaApplies("screen, projection")).toBe(true);
  });

  it("keeps what it does not recognise", () => {
    expect(mediaApplies("(min-width: 40em)")).toBe(true);
    expect(mediaApplies("speech")).toBe(true);
  });
});

describe("resolvePrintMedia", () => {
  it("unwraps a print block", () => {
    expect(tidy(resolvePrintMedia("a{color:red}@media print{a{color:green}}"))).toBe(
      "a{color:red}a{color:green}",
    );
  });

  it("drops a screen block", () => {
    expect(tidy(resolvePrintMedia("a{color:red}@media screen{a{color:blue}}"))).toBe(
      "a{color:red}",
    );
  });

  it("keeps the feature and loses the type", () => {
    expect(tidy(resolvePrintMedia("@media print and (min-width: 40em){a{color:green}}"))).toBe(
      "@media (min-width: 40em) {a{color:green}}",
    );
  });

  it("does not choke on the range syntax", () => {
    // `media/print` in the corpus writes exactly this, in a class it named
    // `dont-choke-on-this`.
    expect(tidy(resolvePrintMedia("@media print and (min-width <= 600px){a{color:red}}"))).toBe(
      "@media (min-width <= 600px) {a{color:red}}",
    );
  });

  it("unwraps a list where a bare print query applies", () => {
    expect(tidy(resolvePrintMedia("@media screen, print{a{color:green}}"))).toBe(
      "a{color:green}",
    );
  });

  it("drops the screen half of a list and keeps the print half's feature", () => {
    expect(
      tidy(resolvePrintMedia("@media screen and (min-width: 10px), print and (min-width: 20px){a{b:c}}")),
    ).toBe("@media (min-width: 20px) {a{b:c}}");
  });

  it("resolves nested blocks", () => {
    expect(tidy(resolvePrintMedia("@media print{@media screen{a{b:c}} d{e:f}}"))).toBe("d{e:f}");
  });

  it("reaches a block inside @supports", () => {
    expect(tidy(resolvePrintMedia("@supports (display:grid){@media print{a{b:c}}}"))).toBe(
      "@supports (display:grid){a{b:c}}",
    );
  });

  it("brings an @page out of a print block, where the extractor can see it", () => {
    expect(tidy(resolvePrintMedia("@media print{@page{size:A4}}"))).toBe("@page{size:A4}");
  });

  it("does not mistake a brace in a string or a comment for the end", () => {
    expect(tidy(resolvePrintMedia('@media print{a[x="{"]{b:c} /* } */ d{e:f}}'))).toBe(
      'a[x="{"]{b:c} /* } */ d{e:f}',
    );
  });

  it("copies a malformed block through rather than losing the rest", () => {
    expect(tidy(resolvePrintMedia("a{b:c}@media print{d{e:f}"))).toBe("a{b:c}@media print{d{e:f}");
  });

  it("leaves css with no @media alone", () => {
    const css = "a{color:red} @page{size:A4} .x::before{content:'@media print'}";
    expect(resolvePrintMedia(css)).toBe(css);
  });

  it("does not read an at-rule out of a string or a comment", () => {
    // The dangerous shape: text that looks like the start of a block, with a
    // real block after it for the brace matcher to run into.
    const css = ".x::before{content:'@media print'} a{b:c}";
    expect(resolvePrintMedia(css)).toBe(css);
    expect(resolvePrintMedia("/* @media print { */ a{b:c}")).toBe("/* @media print { */ a{b:c}");
  });
});

describe("resolveFeatureQueries", () => {
  const narrow = (q: string): boolean => q.includes("max-width");

  it("unwraps what matches and drops what does not", () => {
    const css = "@media (max-width: 40em) { p { a: 1 } } @media (min-width: 40em) { p { b: 2 } } q { c: 3 }";
    expect(tidy(resolveFeatureQueries(css, narrow))).toBe("p { a: 1 } q { c: 3 }");
  });

  it("settles nested blocks, and reads no @media inside a string", () => {
    const css = '@media (max-width: 1px) { @media (min-width: 1px) { x { } } y { content: "@media (min-width: 1px) {" } }';
    expect(tidy(resolveFeatureQueries(css, narrow))).toBe('y { content: "@media (min-width: 1px) {" }');
  });
});

describe("guardSelector", () => {
  const G = ":where(:not(.pagedjs_page *))";

  it("guards each selector in a list, on its subject", () => {
    expect(guardSelector(".print-only")).toBe(`.print-only${G}`);
    expect(guardSelector("nav > a, body")).toBe(`nav > a${G}, body${G}`);
  });

  it("puts the guard before a pseudo-element, either spelling", () => {
    expect(guardSelector("p::before")).toBe(`p${G}::before`);
    expect(guardSelector("p:first-line")).toBe(`p${G}:first-line`);
    expect(guardSelector("a:hover::after")).toBe(`a:hover${G}::after`);
    expect(guardSelector("li:first-child")).toBe(`li:first-child${G}`);
  });

  it("does not split or cut inside brackets, parentheses or strings", () => {
    expect(guardSelector(":is(h1, h2)")).toBe(`:is(h1, h2)${G}`);
    expect(guardSelector('[title="a, b::c"]')).toBe(`[title="a, b::c"]${G}`);
  });
});
