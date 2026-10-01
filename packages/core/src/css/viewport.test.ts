import { describe, expect, it } from "vitest";
import { rewriteViewportUnits, viewportDeclarations } from "./viewport.js";

describe("rewriteViewportUnits", () => {
  it("turns viewport lengths into the page's, with the unit as the fallback", () => {
    expect(rewriteViewportUnits(".a { width: 100vw; height: calc(100vh - 40px) }")).toBe(
      ".a { width: calc(100 * var(--folio-vw, 1vw)); " +
        "height: calc(calc(100 * var(--folio-vh, 1vh)) - 40px) }",
    );
  });

  it("knows the small, large and dynamic units, and vmin/vmax", () => {
    const out = rewriteViewportUnits("a{b:1.5svh;c:-2dvw;d:3vmin;e:.5vmax}");
    expect(out).toContain("calc(1.5 * var(--folio-vh, 1vh))");
    expect(out).toContain("calc(-2 * var(--folio-vw, 1vw))");
    expect(out).toContain("calc(3 * min(var(--folio-vw, 1vw), var(--folio-vh, 1vh)))");
    expect(out).toContain("calc(.5 * max(var(--folio-vw, 1vw), var(--folio-vh, 1vh)))");
  });

  it("leaves strings, comments, urls, selectors and other units alone", () => {
    const css =
      '.col-2vw, h1vh { content: "10vh"; /* 5vw */ background: url(img-3vh.png); margin: 1em 2px 3% }';
    expect(rewriteViewportUnits(css)).toBe(css);
  });
});

describe("viewportDeclarations", () => {
  it("is one percent of the page area per unit", () => {
    expect(viewportDeclarations({ inline: 420, block: 248 })).toBe(
      "--folio-vw:4.2px;--folio-vh:2.48px;--folio-vi:4.2px;--folio-vb:2.48px",
    );
  });

  it("gives vi and vb the root's axes in vertical writing (WPT page-box-008)", () => {
    expect(viewportDeclarations({ inline: 420, block: 248 }, true)).toBe(
      "--folio-vw:4.2px;--folio-vh:2.48px;--folio-vi:2.48px;--folio-vb:4.2px",
    );
  });
});
