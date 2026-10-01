import { describe, expect, it } from "vitest";
import { REF_ATTRIBUTE_PREFIX, rewriteReferences, targetIdOf } from "./references.js";

const el = (attrs: Record<string, string>): Element =>
  ({ getAttribute: (n: string) => attrs[n] ?? null }) as unknown as Element;

describe("rewriteReferences", () => {
  it("turns target-counter into an attribute the engine can fill", () => {
    // The rule keeps its selector and its place in the cascade; only the
    // function changes. That is what keeps this on rung P: the browser still
    // decides which elements the rule matches.
    const { css, references } = rewriteReferences(
      'a::after { content: " (page " target-counter(attr(href), page) ")" }',
    );

    expect(css).toContain(`attr(${REF_ATTRIBUTE_PREFIX}0)`);
    expect(css).toContain('a::after { content: " (page "');
    expect(references).toHaveLength(1);
    expect(references[0]?.target).toEqual({ kind: "attr", name: "href" });
    expect(references[0]?.wants).toBe("page");
  });

  it("keeps the counter style asked for", () => {
    const { references } = rewriteReferences(
      "a::after { content: target-counter(attr(href), page, lower-roman) }",
    );
    expect(references[0]?.style).toBe("lower-roman");
  });

  it("reads attr(href url), css-gcpm's own spelling", () => {
    const { css, references } = rewriteReferences(
      "a::after { content: target-counter(attr(href url), page) target-text(attr( href url ), content) }",
    );
    expect(css).toBe(`a::after { content: attr(${REF_ATTRIBUTE_PREFIX}0) attr(${REF_ATTRIBUTE_PREFIX}1) }`);
    expect(references.map((r) => r.target)).toEqual([
      { kind: "attr", name: "href" },
      { kind: "attr", name: "href" },
    ]);
  });

  it("handles a literal target", () => {
    const { references } = rewriteReferences('h1::after { content: target-counter("#end", page) }');
    expect(references[0]?.target).toEqual({ kind: "literal", value: "#end" });
  });

  it("rewrites target-text too", () => {
    const { css, references } = rewriteReferences(
      'a::after { content: " — " target-text(attr(href)) }',
    );
    expect(css).toContain(`attr(${REF_ATTRIBUTE_PREFIX}0)`);
    expect(references[0]?.wants).toBe("text");
  });

  it("numbers several references separately", () => {
    const { references } = rewriteReferences(`
      a::after { content: target-counter(attr(href), page) }
      .x::after { content: target-text(attr(data-for)) }
    `);
    expect(references.map((r) => r.attribute)).toEqual([
      `${REF_ATTRIBUTE_PREFIX}0`,
      `${REF_ATTRIBUTE_PREFIX}1`,
    ]);
  });

  it("asks for a counter the engine keeps, by name", () => {
    // `equation` is counted by the engine itself (M4, `math.md` §5), so it is
    // not a page-level fact and not a dropped one either.
    const { css, references } = rewriteReferences(
      "a.eqref::after { content: target-counter(attr(href), equation) }",
    );
    expect(references).toHaveLength(1);
    expect(references[0]?.wants).toBe("counter");
    expect(references[0]?.counter).toBe("equation");
    expect(css).toContain(`attr(${REF_ATTRIBUTE_PREFIX}0)`);
  });

  it("keeps the author's rule for a counter nothing counted", () => {
    // It resolves to an empty attribute rather than a deleted declaration:
    // the same nothing on the page, and the rule starts working the day the
    // engine learns to count that counter (M6).
    const { css, references } = rewriteReferences(
      "a::after { content: target-counter(attr(href), chapter) }",
    );
    expect(references[0]?.counter).toBe("chapter");
    expect(css).not.toContain("target-counter");
    expect(css).toContain("attr(");
  });

  it("leaves a stylesheet without references alone", () => {
    const css = "a { color: red } @page { margin: 1in }";
    expect(rewriteReferences(css).css).toBe(css);
  });
});

describe("targetIdOf", () => {
  const reference = () => {
    const { references } = rewriteReferences(
      "a::after { content: target-counter(attr(href), page) }",
    );
    const first = references[0];
    if (first === undefined) throw new Error("no reference was extracted");
    return first;
  };

  it("reads the fragment from the referring element", () => {
    expect(targetIdOf(reference(), el({ href: "#figure-3" }))).toBe("figure-3");
  });

  it("ignores a link that does not point inside the document", () => {
    expect(targetIdOf(reference(), el({ href: "https://example.com" }))).toBeNull();
    expect(targetIdOf(reference(), el({}))).toBeNull();
  });
});
