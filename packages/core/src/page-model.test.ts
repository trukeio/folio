import { describe, expect, it } from "vitest";
import { compareLayers, extractPageRules, parseNth, parsePageSelector, resolvePageFontUnits, userAgentPageRules } from "./css/page-rules.js";
import type { PageRule } from "./css/page-rules.js";
import { parseMarginShorthand, parseSize, resolveFontRelative, toPx } from "./css/length.js";
import { cascadeFor, contentArea, marginBoxesFor, resolvePageSpec, selectorMatches } from "./page-model.js";
import type { PageContext } from "./page-model.js";

const page = (over: Partial<PageContext> = {}): PageContext => ({
  index: 1,
  name: null,
  side: "right",
  blank: false,
  ...over,
});

describe("toPx", () => {
  it("converts the absolute units", () => {
    expect(toPx("1in")).toBe(96);
    expect(toPx("72pt")).toBe(96);
    expect(toPx("25.4mm")).toBeCloseTo(96, 6);
    expect(toPx("2.54cm")).toBeCloseTo(96, 6);
    expect(toPx("1pc")).toBe(16);
    expect(toPx("10px")).toBe(10);
  });

  it("accepts unitless zero and nothing else unitless", () => {
    expect(toPx("0")).toBe(0);
    expect(toPx("10")).toBeNull();
  });

  it("refuses units that need a cascade or a viewport", () => {
    // The engine does not own a cascade (§6), so it cannot resolve these.
    expect(toPx("2em")).toBeNull();
    expect(toPx("50%")).toBeNull();
    expect(toPx("10vh")).toBeNull();
  });
});

describe("parseSize", () => {
  it("resolves named sizes", () => {
    const [w, h] = parseSize("A4") as [number, number];
    expect(w).toBeCloseTo(210 * (96 / 25.4), 4);
    expect(h).toBeCloseTo(297 * (96 / 25.4), 4);
  });

  it("applies orientation to a named size", () => {
    const portrait = parseSize("A4") as [number, number];
    const landscape = parseSize("A4 landscape") as [number, number];
    expect(landscape[0]).toBeCloseTo(portrait[1], 6);
    expect(landscape[1]).toBeCloseTo(portrait[0], 6);
  });

  it("takes two lengths, and one length as a square", () => {
    expect(parseSize("5in 3in")).toEqual([480, 288]);
    expect(parseSize("4in")).toEqual([384, 384]);
  });

  it("leaves an already-portrait size alone when asked for portrait", () => {
    expect(parseSize("A4 portrait")).toEqual(parseSize("A4"));
  });
});

describe("parseMarginShorthand", () => {
  it("expands one to four values like CSS", () => {
    expect(parseMarginShorthand("10px")).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
    expect(parseMarginShorthand("10px 20px")).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
    expect(parseMarginShorthand("1px 2px 3px")).toEqual({ top: 1, right: 2, bottom: 3, left: 2 });
    expect(parseMarginShorthand("1px 2px 3px 4px")).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });
});

describe("extractPageRules", () => {
  it("returns every other rule verbatim, which is the whole point", () => {
    // §5: we extract the paged-media parts and let the browser cascade the
    // rest. Anything this scanner rewrites is a feature we have to maintain.
    const css = `
      @layer base { h1:has(+ p) { color: red } }
      @page { size: A4; margin: 20mm }
      .x { content: "@page { not a rule }" }
    `;
    const { rules, rest } = extractPageRules(css);

    expect(rules).toHaveLength(1);
    expect(rest).toContain("@layer base");
    expect(rest).toContain(':has(+ p)');
    expect(rest).toContain('content: "@page { not a rule }"');
    expect(rest).not.toContain("size: A4");
  });

  it("reads declarations and margin boxes", () => {
    const { rules } = extractPageRules(`
      @page :first {
        size: letter;
        margin: 1in;
        @top-center { content: "Title"; font-weight: bold }
        @bottom-right-corner { content: counter(page) }
      }
    `);

    expect(rules[0]?.declarations).toEqual({ size: "letter", margin: "1in" });
    expect(rules[0]?.marginBoxes["top-center"]).toEqual({
      content: '"Title"',
      "font-weight": "bold",
    });
    expect(rules[0]?.marginBoxes["bottom-right-corner"]).toEqual({ content: "counter(page)" });
  });

  it("is not fooled by braces or @page inside strings and comments", () => {
    const { rules, rest } = extractPageRules(
      `/* @page { size: A3 } */ .a { content: "}" } @page { margin: 1in }`,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations["margin"]).toBe("1in");
    expect(rest).toContain('content: "}"');
  });

  it("parses a selector list", () => {
    const { rules } = extractPageRules(`@page chapter:left, :blank { margin: 0 }`);
    expect(rules[0]?.selectors).toEqual([
      { name: "chapter", pseudos: [{ type: "left" }] },
      { name: null, pseudos: [{ type: "blank" }] },
    ]);
  });
});

describe("parseNth", () => {
  it("reads An+B, odd and even", () => {
    expect(parseNth("2n+1")).toEqual({ a: 2, b: 1 });
    expect(parseNth("odd")).toEqual({ a: 2, b: 1 });
    expect(parseNth("even")).toEqual({ a: 2, b: 0 });
    expect(parseNth("n")).toEqual({ a: 1, b: 0 });
    expect(parseNth("-n+3")).toEqual({ a: -1, b: 3 });
    expect(parseNth("4")).toEqual({ a: 0, b: 4 });
  });
});

describe("selectorMatches", () => {
  it("matches :first only on page 1", () => {
    const s = parsePageSelector(":first");
    expect(selectorMatches(s, page({ index: 1 }))).toBe(true);
    expect(selectorMatches(s, page({ index: 2 }))).toBe(false);
  });

  it("matches sides and blanks", () => {
    expect(selectorMatches(parsePageSelector(":left"), page({ side: "left" }))).toBe(true);
    expect(selectorMatches(parsePageSelector(":right"), page({ side: "left" }))).toBe(false);
    expect(selectorMatches(parsePageSelector(":blank"), page({ blank: true }))).toBe(true);
  });

  it("matches a named page only by that name", () => {
    const s = parsePageSelector("chapter");
    expect(selectorMatches(s, page({ name: "chapter" }))).toBe(true);
    expect(selectorMatches(s, page({ name: null }))).toBe(false);
  });

  it("matches :nth() from 1, and never at a negative n", () => {
    const s = parsePageSelector(":nth(2n+1)");
    expect([1, 2, 3, 4, 5].map((index) => selectorMatches(s, page({ index })))).toEqual([
      true, false, true, false, true,
    ]);
    // -n+3 selects pages 1..3 and must not wrap round to page 4.
    const first3 = parsePageSelector(":nth(-n+3)");
    expect([1, 2, 3, 4].map((index) => selectorMatches(first3, page({ index })))).toEqual([
      true, true, true, false,
    ]);
  });

  it("requires every pseudo to match", () => {
    const s = parsePageSelector("chapter:first:right");
    expect(selectorMatches(s, page({ name: "chapter", index: 1, side: "right" }))).toBe(true);
    expect(selectorMatches(s, page({ name: "chapter", index: 1, side: "left" }))).toBe(false);
  });
});

describe("cascadeFor", () => {
  const { rules } = extractPageRules(`
    @page { size: A4; margin: 20mm }
    @page :left { margin-left: 30mm }
    @page :first { margin-top: 40mm }
  `);

  it("lets a more specific selector win", () => {
    const d = cascadeFor(rules, page({ index: 1, side: "left" }));
    expect(d["margin-left"]).toBe("30mm");
    expect(d["margin-top"]).toBe("40mm");
    expect(d["size"]).toBe("A4");
  });

  it("applies only what matches", () => {
    const d = cascadeFor(rules, page({ index: 2, side: "right" }));
    expect(d["margin-left"]).toBeUndefined();
    expect(d["margin-top"]).toBeUndefined();
  });

  it("breaks ties by source order", () => {
    const { rules: pair } = extractPageRules(`@page { margin: 1in } @page { margin: 2in }`);
    expect(cascadeFor(pair, page())["margin"]).toBe("2in");
  });
});

describe("auto page margins", () => {
  const spec = (css: string) => resolvePageSpec(extractPageRules(css).rules, page());

  it("centre a page area smaller than size (WPT page-margin-auto)", () => {
    const s = spec(`@page { size: 320px 112px; width: 192px; height: 48px; margin: auto }`);
    expect(s.size).toEqual([320, 112]);
    expect(s.margins).toEqual({ blockStart: 32, blockEnd: 32, inlineStart: 64, inlineEnd: 64 });
  });

  it("give one auto margin all the rest", () => {
    const s = spec(`@page { size: 320px 112px; width: 192px; height: 48px; margin: auto; margin-top: 0 }`);
    expect(s.margins.blockStart).toBe(0);
    expect(s.margins.blockEnd).toBe(64);
  });

  it("go negative when the area is larger than size (WPT page-margin-auto-negative)", () => {
    const s = spec(`@page { size: 300px; width: 340px; height: 340px; margin: auto }`);
    expect(s.size).toEqual([300, 300]);
    expect(s.margins.inlineStart).toBe(-20);
    expect(contentArea(s)).toEqual({ inline: 340, block: 340 });
  });

  it("are 0 with no page area to leave room around (WPT page-margin-auto-and-non-zero)", () => {
    const s = spec(`@page { size: 320px 112px; margin: 30px; margin-top: auto }`);
    expect(s.margins).toEqual({ blockStart: 0, blockEnd: 30, inlineStart: 30, inlineEnd: 30 });
  });
});

describe("@page width and height as percentages", () => {
  it("are of the page's size, on their own axes (WPT page-size-014)", () => {
    const { rules } = extractPageRules(`@page { size: 500px; margin: 10%; width: 40%; height: 60% }`);
    const spec = resolvePageSpec(rules, page());
    expect(spec.size).toEqual([300, 400]);
    expect(contentArea(spec)).toEqual({ inline: 200, block: 300 });
  });
});

describe("resolvePageSpec", () => {
  it("takes the page box's border and padding out of the page area (WPT page-box-004)", () => {
    const { rules } = extractPageRules(
      `@page { size: 500px; margin: 5% 10% 15% 20%; padding: 20% 15% 10% 5%; border: 10px solid lightblue }`,
    );
    const spec = resolvePageSpec(rules, page());
    // 500 - (25 + 75) margins - (100 + 50) padding - 20 border, and
    // 500 - (100 + 50) - (25 + 75) - 20 across: the reference's 230 × 230.
    expect(contentArea(spec)).toEqual({ inline: 230, block: 230 });
    expect(spec.border).toEqual({ blockStart: 10, blockEnd: 10, inlineStart: 10, inlineEnd: 10 });
  });

  it("builds width and height outwards from the page area, through border and padding", () => {
    const { rules } = extractPageRules(`@page { width: 200px; height: 100px; margin: 10px; padding: 5px; border: 2px solid }`);
    const spec = resolvePageSpec(rules, page());
    expect(spec.size).toEqual([234, 134]);
    expect(contentArea(spec)).toEqual({ inline: 200, block: 100 });
  });

  it("carries the page's background by the page cascade (WPT page-box-006)", () => {
    const { rules } = extractPageRules(
      `@page { background: blue; margin: 50px } @page :first { background-color: white }`,
    );
    expect(resolvePageSpec(rules, page()).background).toEqual({
      background: "blue",
      "background-color": "white",
    });
    expect(resolvePageSpec(rules, page({ index: 2, side: "left" })).background).toEqual({ background: "blue" });
    expect(resolvePageSpec(extractPageRules(`@page { margin: 0 }`).rules, page()).background).toBeUndefined();
  });

  it("resolves size and margins into geometry, logically", () => {
    const { rules } = extractPageRules(`@page { size: 5in 3in; margin: 0.5in }`);
    const spec = resolvePageSpec(rules, page());

    expect(spec.size).toEqual([480, 288]);
    expect(spec.margins).toEqual({
      blockStart: 48,
      blockEnd: 48,
      inlineStart: 48,
      inlineEnd: 48,
    });
    expect(contentArea(spec)).toEqual({ inline: 384, block: 192 });
  });

  it("lets a longhand override the shorthand", () => {
    const { rules } = extractPageRules(`@page { margin: 1in; margin-left: 2in }`);
    const spec = resolvePageSpec(rules, page());
    expect(spec.margins.inlineStart).toBe(192);
    expect(spec.margins.inlineEnd).toBe(96);
  });

  it("falls back to a default page when the author says nothing", () => {
    const spec = resolvePageSpec([], page());
    expect(spec.size).toEqual([816, 1056]);
    expect(spec.margins.blockStart).toBe(48);
  });

  it("ignores a size it cannot resolve rather than guessing", () => {
    const { rules } = extractPageRules(`@page { size: 50% }`);
    expect(resolvePageSpec(rules, page()).size).toEqual([816, 1056]);
  });
});

describe("marginBoxesFor", () => {
  it("merges boxes from every matching rule, later winning", () => {
    const { rules } = extractPageRules(`
      @page { @top-center { content: "book" } @top-left { content: "x" } }
      @page :first { @top-center { content: "title" } }
    `);
    const boxes = marginBoxesFor(rules, page({ index: 1 }));
    expect(boxes["top-center"]).toEqual({ content: '"title"' });
    expect(boxes["top-left"]).toEqual({ content: '"x"' });

    expect(marginBoxesFor(rules, page({ index: 2 }))["top-center"]).toEqual({ content: '"book"' });
  });

  it("cascades by specificity, not by source order alone", () => {
    const { rules } = extractPageRules(`
      @page :first { @top-left { content: "first" } }
      @page { @top-left { content: "any"; color: red } }
    `);
    expect(marginBoxesFor(rules, page({ index: 1 }))["top-left"]).toEqual({ content: '"first"', color: "red" });
    expect(marginBoxesFor(rules, page({ index: 2 }))["top-left"]).toEqual({ content: '"any"', color: "red" });
  });

  it("cascades by layer before specificity", () => {
    const { rules } = extractPageRules(`
      @layer base { @page :first { @top-left { content: "layered" } } }
      @page { @top-left { content: "unlayered" } }
    `);
    expect(marginBoxesFor(rules, page({ index: 1 }))["top-left"]).toEqual({ content: '"unlayered"' });
  });
});

describe("cascade layers", () => {
  it("finds @page inside @layer and leaves the rest of the layer", () => {
    const { rules, rest } = extractPageRules(`@layer a { @page { margin: 1cm } p { color: red } }`);
    expect(rules).toHaveLength(1);
    expect(rest).toContain("p { color: red }");
    expect(rest).not.toContain("@page");
    expect(rest).toContain("@layer a {");
  });

  it("orders layers by first mention, and unlayered rules last (WPT layers-001, -002)", () => {
    const css = (order: string) => `
      @layer ${order};
      @page b { margin: 0 }
      @layer layer1 { @page { margin: 1cm } }
      @layer layer2 { @page { margin: 0 } }`;
    expect(cascadeFor(extractPageRules(css("layer1, layer2")).rules, page())["margin"]).toBe("0");
    expect(cascadeFor(extractPageRules(css("layer2, layer1")).rules, page())["margin"]).toBe("1cm");
    expect(cascadeFor(extractPageRules(css("layer2, layer1")).rules, page({ name: "b" }))["margin"]).toBe("0");
  });

  it("puts layer before specificity (WPT layers-003)", () => {
    const { rules } = extractPageRules(`
      @layer layer1, layer2;
      @page b { margin: 3cm }
      @layer layer1 { @page b { margin: 1cm } @page :first { margin: 0 } }
      @layer layer2 { @page b { margin: 0 } @page a:first { margin: 2cm } }`);
    expect(cascadeFor(rules, page({ name: "a", index: 1 }))["margin"]).toBe("2cm");
    expect(cascadeFor(rules, page({ name: "b", index: 2 }))["margin"]).toBe("3cm");
  });

  it("ranks a layer's own rules after its sublayers, and dotted names as nesting", () => {
    const { rules } = extractPageRules(`
      @layer a { @page { margin: 1in } @layer b { @page { margin: 2in } } }
      @layer a.c { @page { margin: 3in } }`);
    expect(cascadeFor(rules, page())["margin"]).toBe("1in");
    expect(compareLayers(rules[1]?.layer, rules[2]?.layer)).toBe(-1);
  });

  it("gives each anonymous layer a place of its own", () => {
    const { rules } = extractPageRules(`@layer { @page { margin: 1in } } @layer { @page { margin: 2in } }`);
    expect(cascadeFor(rules, page())["margin"]).toBe("2in");
  });
});

describe("the user agent's default page", () => {
  const first = page();
  const ua = userAgentPageRules("@page { size: 5in 3in; margin: 0.5in }");

  it("is what a page with no size gets", () => {
    expect(resolvePageSpec([...ua], first).size).toEqual([480, 288]);
  });

  it("is what `size: landscape` alone rotates, not a size of the engine's own", () => {
    const author = extractPageRules("@page { size: portrait }").rules;
    expect(resolvePageSpec([...ua, ...author], first).size).toEqual([288, 480]);
    // With no UA rule, the engine's own default is the one rotated: Letter.
    expect(resolvePageSpec(author, first).size).toEqual([816, 1056]);
    expect(resolvePageSpec(extractPageRules("@page { size: landscape }").rules, first).size).toEqual([
      1056, 816,
    ]);
  });

  it("loses to any author rule, however unspecific", () => {
    const uaFirst = userAgentPageRules("@page :first { margin: 1in }");
    const author = extractPageRules("@page { margin: 10px }").rules;
    expect(resolvePageSpec([...uaFirst, ...author], first).margins.blockStart).toBe(10);
  });
});

describe("font-relative page lengths", () => {
  it("rewrites em and rem to pixels and leaves the rest alone", () => {
    expect(resolveFontRelative("4em", 16, 16)).toBe("64px");
    expect(resolveFontRelative("1.5rem 2em 10mm", 10, 20)).toBe("30px 20px 10mm");
    expect(resolveFontRelative("A5 landscape", 16, 16)).toBe("A5 landscape");
  });

  it("gives a page rule's margins the root's em, or the rule's own font size", () => {
    const [plain, sized] = resolvePageFontUnits(
      extractPageRules("@page { margin: 4em } @page :first { font-size: 10px; margin-top: 2em }").rules,
      16,
    );
    expect(resolvePageSpec([plain as PageRule], { index: 2, name: null, side: "left", blank: false }).margins)
      .toEqual({ blockStart: 64, blockEnd: 64, inlineStart: 64, inlineEnd: 64 });
    expect(sized?.declarations["margin-top"]).toBe("20px");
  });
});

describe("@page width, height and viewport units", () => {
  const wpt = userAgentPageRules("@page { size: 5in 3in; margin: 0.5in }");
  const spec = (css: string) =>
    resolvePageSpec([...wpt, ...extractPageRules(css).rules], page({ index: 2, side: "left" }));

  it("makes width and height the page area, with the margins outside it", () => {
    expect(spec("@page { margin: 96px; width: 320px; height: 256px }").size).toEqual([512, 448]);
  });

  it("lets width and height win over size, and needs both", () => {
    expect(spec("@page { margin: 0; width: 100px; height: 50px; size: 1234px }").size).toEqual([100, 50]);
    expect(spec("@page { margin: 0; width: 100px; size: 300px 200px }").size).toEqual([300, 200]);
  });

  it("resolves viewport units against the default page (WPT page-size-016, -017)", () => {
    const a = spec("@page { width: 150vw; height: 200vh; margin: 0; margin-top: 20vw; size: 1234px }");
    expect(a.size).toEqual([720, 672]);
    expect(a.margins.blockStart).toBe(96);
    expect(spec("@page { size: 200vh 100vw; margin: 10vw }").size).toEqual([576, 480]);
  });
});

describe("viewport units in a margin box", () => {
  it("are relative to the default page, as in the page context (WPT dimensions-015)", () => {
    const rules = [
      ...userAgentPageRules("@page { size: 5in 3in; margin: 0.5in }"),
      ...extractPageRules("@page { @top-left { width: 20vw; height: 50vh; content: '' } }").rules,
    ];
    const box = marginBoxesFor(rules, page())["top-left"];
    expect(box?.["width"]).toBe("96px");
    expect(box?.["height"]).toBe("144px");
    expect(box?.["content"]).toBe("''");
  });
});
