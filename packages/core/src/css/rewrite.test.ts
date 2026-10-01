import { describe, expect, it } from "vitest";
import { carrierName, carrierRegistrations, rewriteCarriers, rewriteInlineStyle, rewriteRootSelector } from "./rewrite.js";

describe("rewriteCarriers", () => {
  it("adds a carrier beside a property the browser will drop", () => {
    const out = rewriteCarriers("h1 { string-set: title content() }");
    expect(out).toContain("--x-string-set:title content()");
    // The original stays: the browser ignores what it cannot use, and native
    // support (Chromium's named pages) keeps working where it exists.
    expect(out).toContain("string-set: title content()");
  });

  it("carries a property with an ordinary meaning only for the value we want", () => {
    const out = rewriteCarriers(".fn { float: footnote } .col { float: left }");
    expect(out).toContain("--x-float:footnote");
    expect(out).not.toContain("--x-float:left");
    expect(out).toContain("float: left");
  });

  it("leaves everything it does not carry byte for byte", () => {
    // §5's whole bargain: what this rewrites becomes ours to maintain forever.
    const css = `@layer base { h1:has(+ p) { color: red } }
@supports (display: grid) { .g { display: grid; gap: 1rem } }
.a { background: url("x;y.png"); content: "a { float: footnote }" }`;
    expect(rewriteCarriers(css)).toBe(css);
  });

  it("is not fooled by a carried property named inside a string or comment", () => {
    const css = `.a { content: "string-set: x" } /* float: footnote */`;
    expect(rewriteCarriers(css)).toBe(css);
  });

  it("handles a declaration without a trailing semicolon", () => {
    expect(rewriteCarriers("p { page: chapter }")).toContain("--x-page:chapter");
  });

  it("carries several declarations in one rule", () => {
    const out = rewriteCarriers("p { page: chapter; string-set: t content(); color: red }");
    expect(out).toContain("--x-page:chapter");
    expect(out).toContain("--x-string-set:t content()");
    expect(out).toContain("color: red");
  });

  it("works inside nested and conditional rules, because it does not parse them", () => {
    const out = rewriteCarriers("@media print { .x { page: notes } }");
    expect(out).toContain("@media print");
    expect(out).toContain("--x-page:notes");
  });

  it("ignores a carried name used as a selector or at-rule", () => {
    const css = "@page { margin: 1in }\n.page { color: red }";
    expect(rewriteCarriers(css)).toBe(css);
  });
});

describe("carrierRegistrations", () => {
  it("registers every carrier as non-inheriting by default", () => {
    const css = carrierRegistrations([{ property: "string-set" }]);
    expect(css).toContain(`@property ${carrierName("string-set")}`);
    expect(css).toContain("inherits: false");
  });

  it("can register an inheriting carrier", () => {
    // `page` inherits in CSS: a named page applies to descendants.
    expect(carrierRegistrations([{ property: "page", inherits: true }])).toContain("inherits: true");
  });
});

describe("rewriteCarriers and comments", () => {
  it("carries a declaration that a comment precedes", () => {
    // The scan copies comments through whole, so they arrive in front of the
    // declaration after them. Reading that as `property: value` made the
    // comment part of the property name and dropped the carrier — which is
    // most declarations in most real stylesheets.
    const css = rewriteCarriers("h2 { /* the running head */ string-set: title content(); }");
    expect(css).toContain("--x-string-set:title content()");
    // And the author's own text survives byte for byte.
    expect(css).toContain("/* the running head */");
    expect(css).toContain("string-set: title content()");
  });

  it("is not fooled by a colon inside the comment", () => {
    const css = rewriteCarriers("p { /* see: nothing */ float: footnote; }");
    expect(css).toContain("--x-float:footnote");
  });

  it("still ignores a property it does not carry", () => {
    const css = rewriteCarriers("p { /* a note */ color: red; }");
    expect(css).not.toContain("--x-color");
  });
});

describe("rewriteInlineStyle", () => {
  it("gives a style attribute the carriers a stylesheet would get", () => {
    expect(rewriteInlineStyle("page: a; border-color: pink")).toBe(
      "--x-page:a;page: a; border-color: pink",
    );
  });

  it("rewrites its viewport units", () => {
    expect(rewriteInlineStyle("height: 100vh")).toBe("height: calc(100 * var(--folio-vh, 1vh))");
  });

  it("leaves a style with nothing to rewrite as it was", () => {
    expect(rewriteInlineStyle("color: red")).toBe("color: red");
  });
});

describe("rewriteRootSelector", () => {
  const R = ":is(:root, [data-folio-root])";

  it("makes :root match the root on the page too", () => {
    expect(rewriteRootSelector(":root { --a: 1 }")).toBe(`${R} { --a: 1 }`);
    expect(rewriteRootSelector(":root.dark p, :ROOT > body {}")).toBe(`${R}.dark p, ${R} > body {}`);
    expect(rewriteRootSelector("p:not(:root) {}")).toBe(`p:not(${R}) {}`);
  });

  it("leaves strings, comments and longer names alone", () => {
    const css = `/* :root */ a { content: ":root" } :root-ish {} a::root {}`;
    expect(rewriteRootSelector(css)).toBe(css);
  });
});
