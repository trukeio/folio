import { describe, expect, it } from "vitest";
import { matchesAnB, normalizeAnB, rewriteNthFragment } from "./nth-fragment.js";

describe("normalizeAnB", () => {
  it("reads every form of an+b, and the keywords", () => {
    expect(normalizeAnB("odd")).toBe("2n+1");
    expect(normalizeAnB("even")).toBe("2n+0");
    expect(normalizeAnB("3")).toBe("0n+3");
    expect(normalizeAnB("n")).toBe("1n+0");
    expect(normalizeAnB("-n + 3")).toBe("-1n+3");
    expect(normalizeAnB("2n-1")).toBe("2n-1");
    expect(normalizeAnB(" +n+2 ")).toBe("1n+2");
  });
  it("refuses what is not one", () => {
    expect(normalizeAnB("")).toBeNull();
    expect(normalizeAnB("3+1")).toBeNull();
    expect(normalizeAnB("first")).toBeNull();
  });
});

describe("matchesAnB", () => {
  const which = (f: string) => [1, 2, 3, 4, 5, 6].filter((k) => matchesAnB(f, k));
  it("matches as :nth-child does", () => {
    expect(which("2n+1")).toEqual([1, 3, 5]);
    expect(which("0n+2")).toEqual([2]);
    expect(which("1n+3")).toEqual([3, 4, 5, 6]);
    expect(which("-1n+2")).toEqual([1, 2]);
    expect(which("2n-1")).toEqual([1, 3, 5]);
  });
});

describe("rewriteNthFragment", () => {
  it("becomes an attribute test that weighs one type selector", () => {
    expect(rewriteNthFragment("p::nth-fragment(1) { color: red }")).toBe(
      'p:where([data-folio-nth~="0n+1"]):is(*, folio-nth) { color: red }',
    );
  });
  it("keeps what follows it, and every selector in a list", () => {
    expect(rewriteNthFragment("a::nth-fragment(odd)::before, b::NTH-FRAGMENT(n+2) {}")).toBe(
      'a:where([data-folio-nth~="2n+1"]):is(*, folio-nth)::before, b:where([data-folio-nth~="1n+2"]):is(*, folio-nth) {}',
    );
  });
  it("leaves strings, comments and a bad argument alone", () => {
    const css = `/* p::nth-fragment(1) */ p::after { content: "::nth-fragment(1)" } q::nth-fragment(x) {}`;
    expect(rewriteNthFragment(css)).toBe(css);
  });
});
