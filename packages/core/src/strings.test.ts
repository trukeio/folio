import { describe, expect, it } from "vitest";
import { generatedText, parseStringSet, resolveString } from "./strings.js";
import { resolveContent } from "./page-template.js";
import type { PageStrings } from "./strings.js";

/** A stand-in element: parseStringSet only reads text and attributes. */
const el = (text: string, attrs: Record<string, string> = {}): Element =>
  ({
    textContent: text,
    getAttribute: (name: string) => attrs[name] ?? null,
  }) as unknown as Element;

describe("parseStringSet", () => {
  it("takes the element's text for content()", () => {
    expect(parseStringSet("title content()", el("Chapter One"))).toEqual([["title", "Chapter One"]]);
  });

  it("takes a quoted string", () => {
    expect(parseStringSet('title "Fixed"', el("ignored"))).toEqual([["title", "Fixed"]]);
  });

  it("joins parts in order", () => {
    expect(parseStringSet('title "§ " content()', el("Three"))).toEqual([["title", "§ Three"]]);
  });

  it("sets several strings from one declaration", () => {
    expect(parseStringSet("title content(), slug attr(id)", el("T", { id: "ch1" }))).toEqual([
      ["title", "T"],
      ["slug", "ch1"],
    ]);
  });

  it("is not confused by a comma inside a function", () => {
    expect(parseStringSet('title content(), sub "a, b"', el("T"))).toEqual([
      ["title", "T"],
      ["sub", "a, b"],
    ]);
  });

  it("takes content(before) and content(after) from the generated text it is given", () => {
    const generated = { before: "Chapter 3. ", after: " ¶" };
    expect(parseStringSet("title content(before) content() content(after)", el("Tides"), generated)).toEqual([
      ["title", "Chapter 3. Tides ¶"],
    ]);
    expect(parseStringSet("title content(before)", el("Body text"))).toEqual([["title", ""]]);
  });

  it("ignores `none`", () => {
    expect(parseStringSet("none", el("x"))).toEqual([]);
  });
});

describe("resolveString", () => {
  const strings: PageStrings = {
    start: new Map([["title", "Chapter One"]]),
    first: new Map([["title", "Chapter Two"]]),
    last: new Map([["title", "Chapter Three"]]),
  };

  it("defaults to the first assignment on the page", () => {
    expect(resolveString("title", "first", strings)).toBe("Chapter Two");
  });

  it("can ask for the last, or for the value the page began with", () => {
    expect(resolveString("title", "last", strings)).toBe("Chapter Three");
    expect(resolveString("title", "start", strings)).toBe("Chapter One");
  });

  it("falls back to the carried value when the page assigns nothing", () => {
    const quiet: PageStrings = {
      start: new Map([["title", "Chapter One"]]),
      first: new Map(),
      last: new Map(),
    };
    expect(resolveString("title", "first", quiet)).toBe("Chapter One");
    expect(resolveString("title", "last", quiet)).toBe("Chapter One");
  });

  it("first-except blanks the page where the value appears", () => {
    // A running head that does not repeat the chapter title on the page where
    // the chapter opens.
    expect(resolveString("title", "first-except", strings)).toBe("");
    const quiet: PageStrings = {
      start: new Map([["title", "Chapter One"]]),
      first: new Map(),
      last: new Map(),
    };
    expect(resolveString("title", "first-except", quiet)).toBe("Chapter One");
  });

  it("is empty for a string nobody set", () => {
    expect(resolveString("nothing", "first", strings)).toBe("");
  });
});

describe("resolveContent with strings", () => {
  const strings: PageStrings = {
    start: new Map([["title", "One"]]),
    first: new Map([["title", "Two"]]),
    last: new Map([["title", "Three"]]),
  };

  it("mixes strings, counters and literals", () => {
    expect(
      resolveContent('string(title) " — " counter(page)', { page: 7, pages: 9 }, strings),
    ).toBe("Two — 7");
  });

  it("passes the scope through", () => {
    expect(resolveContent("string(title, last)", { page: 1, pages: 1 }, strings)).toBe("Three");
  });

  it("leaves element() to the renderer rather than printing it", () => {
    expect(resolveContent("element(header)", { page: 1, pages: 1 }, strings)).toBe("");
  });
});

describe("generatedText", () => {
  const counters = new Map([["chapter", 3]]);

  it("evaluates strings, attr() and counter() in a computed content value", () => {
    expect(generatedText('"Chapter " counter(chapter) ". "', el("x"), counters)).toBe("Chapter 3. ");
    expect(generatedText('attr(data-n) ": "', el("x", { "data-n": "IV" }), counters)).toBe("IV: ");
    expect(generatedText("counter(chapter, upper-roman)", el("x"), counters)).toBe("III");
  });

  it("is empty for none and normal, and skips what is not text", () => {
    expect(generatedText("none", el("x"), counters)).toBe("");
    expect(generatedText("normal", el("x"), counters)).toBe("");
    expect(generatedText('open-quote "a" close-quote', el("x"), counters)).toBe("a");
  });

  it("applies the pseudo-element's own reset and increment first", () => {
    expect(generatedText("counter(sec)", el("x"), counters, { increment: "sec 1" })).toBe("1");
    expect(generatedText("counter(chapter)", el("x"), counters, { increment: "chapter 1" })).toBe("4");
    expect(generatedText("counter(chapter)", el("x"), counters, { reset: "chapter 7", increment: "none" })).toBe("7");
  });

  it("reads CSS escapes in strings", () => {
    expect(generatedText('"\\A7  " "\\"q\\""', el("x"), counters)).toBe('§ "q"');
  });
});
