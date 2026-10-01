/**
 * Stage 2: the page model (`doc/plan.md` §2).
 *
 * `@page` rules in, a `PageSpec` per page out. The cascade here is the small,
 * closed one CSS Paged Media 3 defines over page selectors — not a general CSS
 * cascade, which §6 argues at length we should not own.
 */
import { parseMarginShorthand, parseSize, resolveViewportLengths, toPx } from "./css/length.js";
import { autoSides, resolveBorderWidths, resolveSides } from "./css/page-box.js";
import type { Declarations, PageRule, PageSelector } from "./css/page-rules.js";
import { compareLayers } from "./css/page-rules.js";
import type { Box, PageMarks, PageSpec } from "./types.js";
import type { Deletion } from "./native.js";

/** What we know about a page before its style is resolved. */
export type PageContext = {
  /** 1-based, as the `page` counter is. */
  index: number;
  name: string | null;
  side: "left" | "right";
  blank: boolean;
  /** The root's flow, which logical page margins and padding follow. */
  flow?: { writingMode: string; direction: string };
};

const DEFAULT_SIZE: [number, number] = [8.5 * 96, 11 * 96];
const DEFAULT_MARGIN = 0.5 * 96;

/** Does a selector apply to this page? */
export function selectorMatches(selector: PageSelector, page: PageContext): boolean {
  if (selector.name !== null && selector.name !== page.name) return false;

  return selector.pseudos.every((p) => {
    switch (p.type) {
      case "first":
        return page.index === 1;
      case "left":
        return page.side === "left";
      case "right":
        return page.side === "right";
      case "blank":
        return page.blank;
      case "nth": {
        // An+B, 1-based, matching the CSS definition: some n >= 0 gives index.
        if (p.a === 0) return page.index === p.b;
        const n = (page.index - p.b) / p.a;
        return Number.isInteger(n) && n >= 0;
      }
    }
  });
}

/**
 * Specificity for page selectors, as CSS Paged Media 3 defines it: a named
 * page beats pseudo-classes, `:first`/`:blank` beat `:left`/`:right`, and
 * ties go to source order.
 */
function specificity(selector: PageSelector): number {
  let score = selector.name === null ? 0 : 1000;
  for (const p of selector.pseudos) {
    if (p.type === "first" || p.type === "blank" || p.type === "nth") score += 10;
    else score += 1;
  }
  return score;
}

/**
 * The rules that apply to a page, lowest priority first: origin (a
 * user-agent rule loses to every author rule, css-cascade §6.4), then cascade
 * layer (§6.4, unlayered last), then specificity, then source order.
 */
function matchingRules(rules: readonly PageRule[], page: PageContext): PageRule[] {
  const matching: { rule: PageRule; specificity: number }[] = [];
  for (const rule of rules) {
    let best = -1;
    for (const selector of rule.selectors) {
      if (selectorMatches(selector, page)) best = Math.max(best, specificity(selector));
    }
    if (best >= 0) matching.push({ rule, specificity: best });
  }
  const origin = (rule: PageRule): number => (rule.ua === true ? 0 : 1);
  return matching
    .sort(
      (a, b) =>
        origin(a.rule) - origin(b.rule) ||
        compareLayers(a.rule.layer, b.rule.layer) ||
        a.specificity - b.specificity ||
        a.rule.order - b.rule.order,
    )
    .map((m) => m.rule);
}

/** Declarations that apply to a page, cascaded (`matchingRules`). */
export function cascadeFor(rules: readonly PageRule[], page: PageContext): Declarations {
  return Object.assign({}, ...matchingRules(rules, page).map((r) => r.declarations)) as Declarations;
}

/**
 * The `@footnote` rule's declarations for a page: `@page { @footnote { … } }`,
 * cascaded as the page's own are. Only its own declarations: the note area
 * sits in the page's flow, and inherits from there, not from the page
 * context as a margin box does.
 */
export function footnoteAreaFor(rules: readonly PageRule[], page: PageContext): Declarations {
  return Object.assign({}, ...matchingRules(rules, page).map((r) => r.marginBoxes["footnote"] ?? {})) as Declarations;
}

/**
 * What a margin box inherits from the page context (css-page-3 §6): the
 * inherited properties of CSS 2.1's Appendix A list, and their newer
 * longhands. `text-align` is inherited too but not here, because every box
 * has a user-agent value of its own (§6.2) and that beats an inherited one.
 */
const INHERITED =
  /^(color|font(-.*)?|line-height|letter-spacing|word-spacing|white-space(-collapse)?|text-wrap(-.*)?|quotes|direction|text-transform|text-indent|visibility|hyphens|(-webkit-)?print-color-adjust)$/;

/**
 * The margin boxes that apply to a page, resolved the same way.
 *
 * Each box starts from what the page context gives it to inherit — `@page {
 * font-family: monospace }` sets the type of every header — and its own
 * declarations override that. Written onto the box rather than inherited
 * through the DOM, because the page box's DOM parent is the document the
 * pages are shown in, whose `body` font is the author's text face.
 */
export function marginBoxesFor(
  rules: readonly PageRule[],
  page: PageContext,
): Record<string, Declarations> {
  const context = Object.entries(cascadeFor(rules, page)).filter(([p]) => INHERITED.test(p));
  // `@top-left { width: 20vw }` is a fifth of the default page, as it is in
  // `@page` itself (WPT `dimensions-015`); left as written it would be a
  // fifth of whatever window the pages are shown in.
  const initial = defaultPageSize(rules, page);
  const out: Record<string, Declarations> = {};
  // Cascaded like the page's own declarations, box by box: a later `@page {
  // @top-left }` does not beat an earlier `@page :first { @top-left }`.
  for (const rule of matchingRules(rules, page)) {
    for (const [name, declarations] of Object.entries(rule.marginBoxes)) {
      const resolved: Declarations = {};
      for (const [p, v] of Object.entries(declarations)) {
        resolved[p] = p === "content" ? v : resolveViewportLengths(v, initial);
      }
      out[name] = { ...Object.fromEntries(context), ...out[name], ...resolved };
    }
  }
  return out;
}

/**
 * The default page: the user agent's, a `ua` rule's size if there is one and
 * this engine's own otherwise. `size: landscape` alone rotates it, and it is
 * what viewport units in a page or margin context are relative to.
 */
function defaultPageSize(rules: readonly PageRule[], page: PageContext): [number, number] {
  const ua = cascadeFor(
    rules.filter((r) => r.ua === true),
    page,
  )["size"];
  return (ua === undefined ? null : parseSize(ua, DEFAULT_SIZE)) ?? DEFAULT_SIZE;
}

/** Resolve one page's geometry. */
export function resolvePageSpec(rules: readonly PageRule[], page: PageContext): PageSpec {
  const cascaded = cascadeFor(rules, page);

  const initial = defaultPageSize(rules, page);
  const declarations = Object.fromEntries(
    Object.entries(cascaded).map(([p, v]) => [p, resolveViewportLengths(v, initial)]),
  );
  // Percentages are of the page box (`css/page-box.ts`), which `width` and
  // `height` then build outwards from the page area: resolved against the
  // size the page would have without them.
  const base = (declarations["size"] === undefined ? null : parseSize(declarations["size"], initial)) ?? initial;
  // Logical sides are the page's own writing mode where `@page` sets one
  // (WPT `page-box-009`, a vertical page in a horizontal document), and the
  // root's where it does not.
  const flow = {
    writingMode: declarations["writing-mode"] ?? page.flow?.writingMode ?? "horizontal-tb",
    direction: declarations["direction"] ?? page.flow?.direction ?? "ltr",
  };
  const margins = resolveSides(declarations, "margin", DEFAULT_MARGIN, base, flow);
  const border = resolveBorderWidths(declarations, flow);
  const padding = resolveSides(declarations, "padding", 0, base, flow);
  const area = pageArea(declarations, base);
  const auto = autoSides(declarations, flow);
  // `width` and `height` are the page area, and the page box is built out from
  // it — unless a margin on that axis is `auto`. Then the page box is `size`,
  // and the auto margins take what the area leaves, split evenly, negative if
  // the area is the larger (WPT `page-margin-auto*`). With no area to leave
  // room around, an auto margin is 0.
  if (area !== null) {
    for (const [axis, start, end] of [[0, "inlineStart", "inlineEnd"], [1, "blockStart", "blockEnd"]] as const) {
      const autos = [start, end].filter((side) => auto[side]);
      if (autos.length === 0) continue;
      const rest = base[axis] - area[axis] - border[start] - border[end] - padding[start] - padding[end] -
        (auto[start] ? 0 : margins[start]) - (auto[end] ? 0 : margins[end]);
      for (const side of autos) margins[side] = rest / autos.length;
    }
  }
  const size = pageBoxSize(area, [margins, border, padding]) ?? base;
  const marks = resolveMarks(declarations);
  const background = Object.fromEntries(
    Object.entries(declarations).filter(([p]) => /^background(-|$)/.test(p)),
  );
  const decoration = Object.fromEntries(
    Object.entries(declarations).filter(([p]) => /^(border|outline)(-|$)|^(color|visibility)$/.test(p)),
  );

  return {
    index: page.index,
    name: page.name,
    side: page.side,
    blank: page.blank,
    size,
    margins,
    border,
    padding,
    bleed: resolveBleed(declarations, marks),
    marks,
    ...(Object.keys(background).length === 0 ? {} : { background }),
    ...(Object.keys(decoration).length === 0 ? {} : { decoration }),
  };
}

/**
 * `@page { width: 7.5in; height: 6in }`: the page *area*, with the margins
 * outside it, as Chromium implements and WPT's `page-size-01x` and
 * `margin-boxes/dimensions-*` expect. Both given, they win over `size`; one
 * alone does not make a page, since the other side would have to come from a
 * `size` that says something else. A percentage is of that `size`, on its
 * own axis (WPT `page-size-014`).
 */
function pageArea(declarations: Declarations, base: [number, number]): [number, number] | null {
  const length = (value: string | undefined, of: number): number | null => {
    const pct = /^(-?[\d.]+)%$/.exec((value ?? "").trim())?.[1];
    return pct === undefined ? toPx(value ?? "") : (parseFloat(pct) / 100) * of;
  };
  const width = length(declarations["width"], base[0]);
  const height = length(declarations["height"], base[1]);
  return width === null || height === null ? null : [width, height];
}

/** The page box around a page area: the area and what surrounds it. */
function pageBoxSize(area: [number, number] | null, around: readonly Box[]): [number, number] | null {
  if (area === null) return null;
  return [
    around.reduce((w, b) => w + b.inlineStart + b.inlineEnd, area[0]),
    around.reduce((h, b) => h + b.blockStart + b.blockEnd, area[1]),
  ];
}

/** `marks: none | [ crop || cross ]` (css-page-3 §11). */
function resolveMarks(declarations: Declarations): PageMarks {
  const value = (declarations["marks"] ?? "").trim().toLowerCase();
  const words = value.split(/\s+/);
  return { crop: words.includes("crop"), cross: words.includes("cross") };
}

/**
 * `bleed: auto | <length>{1,4}`.
 *
 * `auto` is 6pt when crop marks were asked for and zero otherwise — the
 * spec's own default, and the reason this needs to know about `marks`. Six
 * points is 8px at 96dpi, and the CSS pixel is what the rest of the engine
 * measures in.
 */
function resolveBleed(declarations: Declarations, marks: PageMarks): Box {
  // `auto` is the initial value, so an absent `bleed` is `auto` and not zero:
  // asking for crop marks alone is asking for the 6pt the marks are drawn
  // around, which is what every press sheet expects.
  const value = (declarations["bleed"] ?? "auto").trim().toLowerCase();
  if (value === "" || value === "none") return NO_BLEED;

  if (value === "auto") {
    const px = marks.crop ? AUTO_BLEED : 0;
    return { blockStart: px, blockEnd: px, inlineStart: px, inlineEnd: px };
  }

  const physical = parseMarginShorthand(value);
  if (physical === null) return NO_BLEED;
  // Logical, as margins are: horizontal-tb here, and one place to change.
  return {
    blockStart: physical.top,
    blockEnd: physical.bottom,
    inlineStart: physical.left,
    inlineEnd: physical.right,
  };
}

const NO_BLEED: Box = { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 };
/** 6pt, css-page-3's `bleed: auto` when crop marks are drawn. */
const AUTO_BLEED = 8;

/**
 * The page area: the page box less its margins, border and padding — what
 * the fragmenter fills, so every one of the three moves the breaks.
 */
export function contentArea(spec: PageSpec): { inline: number; block: number } {
  const around = [spec.margins, spec.border ?? ZERO, spec.padding ?? ZERO];
  return {
    inline: around.reduce((w, b) => w - b.inlineStart - b.inlineEnd, spec.size[0]),
    block: around.reduce((h, b) => h - b.blockStart - b.blockEnd, spec.size[1]),
  };
}

const ZERO: Box = { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 };

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "page model",
  files: ["page-model.ts", "page-template.ts", "css/page-box.ts", "css/page-rules.ts"],
  feature: "`@page`: sizes, margins, border and padding, named pages, page selectors, `@layer`",
  when: "Pages are built in a print context that applies `@page` and a script can read the result",
  tests: [/^css\/css-page\/(page-name|page-size-|page-margin|pseudo-first-margin|page-rule-specificity|page-left-right|layers-|page-orientation|page-visibility|subpixel-page-size|page-box-|basic-pagination|root-element-display-none)/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
