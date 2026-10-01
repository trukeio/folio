import { describe, expect, it } from "vitest";
import { LEADER_ATTRIBUTE_PREFIX, rewriteLeaders } from "./leaders.js";
import { rewriteReferences } from "./references.js";

const NBSP = " ";

describe("rewriteLeaders", () => {
  it("turns leader() into an attribute, and remembers whose it is", () => {
    const { css, leaders } = rewriteLeaders(
      "nav a::after { content: leader('.') attr(data-x-ref-0) }",
    );
    expect(css).toBe(`nav a::after { content: attr(${LEADER_ATTRIBUTE_PREFIX}0) attr(data-x-ref-0) }`);
    expect(leaders).toEqual([
      { attribute: `${LEADER_ATTRIBUTE_PREFIX}0`, selector: "nav a", pattern: "." },
    ]);
  });

  it("knows the three keywords, and keeps a pattern's spaces from breaking", () => {
    const { leaders } = rewriteLeaders(`
      .a::after { content: leader(dotted) }
      .b::after { content: leader(solid) }
      .c::after { content: leader(space) }
      .d::after { content: leader(" - ") }
    `);
    expect(leaders.map((l) => l.pattern)).toEqual([`.${NBSP}`, "_", NBSP, `${NBSP}-${NBSP}`]);
  });

  it("reads the selector of the rule it is in, not the one before", () => {
    const { leaders } = rewriteLeaders(`
      h1 { color: red }
      /* the table of contents */
      @media print {
        .toc li:not(.x)::before, .toc dt:after { color: blue; content: leader(dotted) }
      }
    `);
    expect(leaders[0]?.selector).toBe(".toc li:not(.x), .toc dt");
  });

  it("gives up on a nested rule rather than guessing what & means", () => {
    const { leaders } = rewriteLeaders(".toc { & a::after { content: leader(dotted) } }");
    expect(leaders[0]?.selector).toBeNull();
  });
});

describe("rewriteReferences", () => {
  it("carries leaders alongside the references they sit beside", () => {
    const { css, references } = rewriteReferences(
      "a::after { content: leader(dotted) target-counter(attr(href), page) }",
    );
    expect(css).toBe(
      `a::after { content: attr(${LEADER_ATTRIBUTE_PREFIX}0) attr(data-x-ref-0) }`,
    );
    expect(references.map((r) => r.wants)).toEqual(["page", "leader"]);
    expect(references[1]?.leader?.selector).toBe("a");
  });
});
