import { describe, expect, it } from "vitest";
import { extractPageRules } from "./css/page-rules.js";
import { resolvePageSpec } from "./page-model.js";
import { byNumber, marginCounters, pageCounters } from "./page-counters.js";
import { resolveContent } from "./page-template.js";
import type { ContentCounters } from "./page-template.js";
import type { PageRecord } from "./types.js";

/** Four pages, as WPT's `margin-boxes/content-008` to `013` lay them out. */
function pages(css: string, options: { resets?: (number | undefined)[]; foo?: number } = {}) {
  const rules = extractPageRules(css).rules;
  const specs = [1, 2, 3, 4].map((index) =>
    resolvePageSpec(rules, {
      index,
      name: index === 1 ? null : "something",
      side: index % 2 === 1 ? "right" : "left",
      blank: false,
    }),
  );
  const document = specs.map(() => new Map(options.foo === undefined ? [] : [["foo", options.foo]]));
  return pageCounters(rules, specs, options.resets ?? [], document);
}

const show = (counters: ContentCounters[], content: string, own: Parameters<typeof marginCounters>[1] = {}) =>
  counters.map((c) => resolveContent(content, marginCounters(c, own)));

describe("the page counter", () => {
  it("counts from 1 by default", () => {
    expect(pages("").map((c) => c.page)).toEqual([1, 2, 3, 4]);
  });

  it("steps by the page context's increment (WPT content-008)", () => {
    expect(pages("@page { counter-increment: page 2 }").map((c) => c.page)).toEqual([2, 4, 6, 8]);
  });

  it("takes left and right increments, zero included (WPT content-009)", () => {
    const css = "@page :left { counter-increment: page 3 } @page :right { counter-increment: page 0 }";
    expect(pages(css).map((c) => c.page)).toEqual([0, 3, 3, 6]);
  });

  it("is set outright on the page where an element resets it, as in Paged.js", () => {
    expect(pages("", { resets: [undefined, undefined, 1] }).map((c) => c.page)).toEqual([1, 2, 1, 2]);
  });

  it("is carried on from a page-context reset", () => {
    const css = "@page :nth(2) { counter-reset: page 10 }";
    expect(pages(css).map((c) => c.page)).toEqual([1, 11, 12, 13]);
  });

  it("is never pages, which nothing changes (WPT content-013)", () => {
    const counters = pages("@page { counter-increment: pages 2 }");
    expect(show(counters, "counters(pages, '.')", { reset: "pages 2", increment: "pages" })).toEqual([
      "4", "4", "4", "4",
    ]);
  });
});

describe("page-context counters", () => {
  it("are carried from page to page, from the document's value (WPT content-010)", () => {
    expect(show(pages("@page { counter-increment: foo }", { foo: 10 }), "counter(foo)")).toEqual([
      "11", "12", "13", "14",
    ]);
  });

  it("hide the page's in a margin box that resets its own (WPT content-011)", () => {
    const counters = pages("@page { counter-increment: foo }", { foo: 10 });
    expect(show(counters, "counters(foo, '.')")).toEqual(["11", "12", "13", "14"]);
    expect(show(counters, "counters(foo, '.')", { reset: "foo 2", increment: "foo" })).toEqual([
      "3", "3", "3", "3",
    ]);
  });

  it("are the page's alone when the page context resets them (WPT content-012)", () => {
    const css = `@page { counter-reset: foo 5; counter-increment: foo }
      @page :right { counter-reset: none }`;
    const counters = pages(css, { foo: 10 });
    expect(show(counters, "counters(foo, '.')")).toEqual(["11", "6", "12", "6"]);
    expect(show(counters, "counters(foo, '.')", { increment: "foo" })).toEqual(["12", "7", "13", "7"]);
    // `counter-reset: inherit` on a box is the page context's value: `none` on
    // right pages, `foo 5` on left ones.
    const bottom = { reset: "inherit", increment: "foo foo foo" };
    expect(show(counters, "counters(foo, '.')", bottom)).toEqual(["14", "8", "15", "8"]);
  });
});

describe("byNumber", () => {
  it("gives a reference the page's number, not its index", () => {
    const records = [{ number: 7 }, { number: 1 }] as PageRecord[];
    expect(byNumber(new Map([["a", 1], ["b", 2], ["c", 3]]), records)).toEqual(
      new Map([["a", 7], ["b", 1], ["c", 3]]),
    );
  });
});
