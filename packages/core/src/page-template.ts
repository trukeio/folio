/**
 * The page template and its margin boxes (`doc/plan.md` §4).
 *
 * The page box is a grid whose outer tracks are the page margins, and the
 * content area is its middle cell: the browser keeps that right when the page
 * size changes, and nothing has to compute it. The margin boxes are *not*
 * grid cells. They were, and a grid gives each of three boxes on an edge a
 * third of it, which is not what css-page-3 §5.3 says; their geometry is
 * `margin-boxes.ts`, computed once their content is in.
 *
 *     ┌──────────┬────────────────────────────────────────┬───────────┐
 *     │ corner   │ top: top-left, top-center, top-right    │ corner    │
 *     ├──────────┼────────────────────────────────────────┼───────────┤
 *     │ left:    │                                        │ right:    │
 *     │ left-top │            the content area            │ right-top │
 *     │ …        │                                        │ …         │
 *     ├──────────┼────────────────────────────────────────┼───────────┤
 *     │ corner   │ bottom: …                              │ corner    │
 *     └──────────┴────────────────────────────────────────┴───────────┘
 *
 * Each area is its boxes' containing block. This is not part of the
 * fragmenter and makes no break decisions.
 */
import { resolveString } from "./strings.js";
import { resolveCarriedElement } from "./carry.js";
import type { CarriedElements } from "./carry.js";
import type { PageStrings, StringScope } from "./strings.js";
import type { Declarations } from "./css/page-rules.js";
import type { Box, PageSpec } from "./types.js";
import { CONTINUED, ensureFragmentRules } from "./fragments.js";
import { PAINT_ORDER, appliesToMarginBox, defaultAlignment, layoutMarginBoxes } from "./margin-boxes.js";
import { marginCounters } from "./page-counters.js";

/** The sixteen margin boxes, each with the area that is its containing block. */
export const MARGIN_BOXES: Record<string, string> = Object.fromEntries(
  PAINT_ORDER.flatMap(({ area, boxes }) => boxes.map((box) => [box, area])),
);

export type PageElements = {
  /** The whole page, at the paper's size. */
  page: HTMLElement;
  /** Where the flow goes. */
  content: HTMLElement;
  /** The margin boxes that were asked for, by name. */
  boxes: Map<string, HTMLElement>;
};

export type TemplateOptions = {
  spec: PageSpec;
  /** Declarations per margin box, from `marginBoxesFor`. */
  marginBoxes?: Record<string, Declarations>;
  target: Document;
  /** The break before this page was forced (`margin-break: auto`). */
  afterForced?: boolean;
  /**
   * The root's flow, which margin boxes inherit through the page context
   * where they do not set their own (`review.md` §5): the page box is
   * `horizontal-tb`, and they would inherit that.
   */
  flow?: { writingMode: string; direction: string };
};

/** Build one page: paper, margin-box grid, and an empty content area. */
export function renderPageTemplate(options: TemplateOptions): PageElements {
  const { spec, marginBoxes = {}, target, afterForced = false, flow } = options;
  const { margins, size } = spec;

  const pageBox = target.createElement("folio-page");
  // Paged.js's class names travel with ours (`doc/plan.md` §4, M5.1): author
  // CSS in a real project styles `.pagedjs_pagebox` and
  // `.pagedjs_margin-top-center`, and "runs unchanged with its script tag
  // swapped" means those selectors have to keep matching. Ours stay too, so
  // nothing here depends on the compatibility layer being wanted.
  pageBox.className = "folio-page folio-pagebox pagedjs_pagebox";
  pageBox.style.cssText = [
    // Physical: a page is paper, whatever the document's writing mode. In a
    // vertical host, `inline-size` turned the page (WPT `dimensions-014`).
    `width:${size[0]}px`,
    `height:${size[1]}px`,
    "writing-mode:horizontal-tb",
    "display:grid",
    // The margins *are* the outer tracks: no box geometry is computed here.
    // A track is not negative: a negative page margin is a zero track, and the
    // page area reaches past it (below).
    `grid-template-columns:${Math.max(0, margins.inlineStart)}px 1fr 1fr 1fr ${Math.max(0, margins.inlineEnd)}px`,
    `grid-template-rows:${Math.max(0, margins.blockStart)}px 1fr 1fr 1fr ${Math.max(0, margins.blockEnd)}px`,
    "box-sizing:border-box",
    "position:relative",
    "overflow:hidden",
    // The grid's tracks are physical — left margin, area, right margin — and
    // an inherited `direction: rtl` mirrored them in Chromium (WPT
    // `page-left-right-002`). The content keeps the author's direction:
    // `html'` carries it.
    "direction:ltr",
    // Each page a stacking context of its own: a margin box's `z-index: -1`
    // puts it under the page's content (WPT `paint-order-003`), not under
    // every page in the document.
    "isolation:isolate",
  ].join(";");
  const pageBackground = backgroundLayer(spec, target);
  if (pageBackground !== null) pageBox.append(pageBackground);

  // With no bleed and no marks the sheet *is* the page, and the DOM is the
  // one element it has always been. A document that asks for either gets a
  // sheet around it; nothing else in the engine changes, because neither is
  // part of the page and `contentArea` never sees them.
  const page = wrapForBleedAndMarks(pageBox, spec, target);
  page.dataset["pageNumber"] = String(spec.index);
  page.dataset["pageSide"] = spec.side;
  if (spec.blank) page.dataset["pageBlank"] = "";
  if (spec.name !== null) page.dataset["pageName"] = spec.name;
  namePagedjs(page, pageBox, spec);

  ensureFragmentRules(target);

  const content = target.createElement("folio-content");
  content.className = "folio-content pagedjs_area pagedjs_page_content";
  // Every page but the first begins in the middle of the flow, and how it
  // came to begin there decides its first margin (`fragments.ts`).
  if (spec.index > 1) content.setAttribute(CONTINUED, afterForced ? "forced" : "");
  // The grid cell is the page box's border box; the page's border and
  // padding are this element's margins inside it, so its content box is
  // the page area `contentArea` measured (`css/page-box.ts`).
  // A negative page margin is the page area reaching past the page box's edge
  // (WPT `page-margin-negative`, `page-margin-auto-negative`), which the page
  // box then clips: a negative margin on the cell's content.
  const inset = sum(sum(spec.border, spec.padding), {
    blockStart: Math.min(0, spec.margins.blockStart),
    blockEnd: Math.min(0, spec.margins.blockEnd),
    inlineStart: Math.min(0, spec.margins.inlineStart),
    inlineEnd: Math.min(0, spec.margins.inlineEnd),
  });
  content.style.cssText = [
    "grid-row:2 / span 3",
    "grid-column:2 / span 3",
    "position:relative",
    `margin:${inset.blockStart}px ${inset.inlineEnd}px ${inset.blockEnd}px ${inset.inlineStart}px`,
  ].join(";");
  pageBox.append(content);

  const boxes = new Map<string, HTMLElement>();
  // In paint order, whatever order the author declared them in: clockwise
  // from the top left corner, so a box with a negative margin overlaps the
  // right neighbour (WPT `paint-order-*`).
  for (const { area: areaName, boxes: names } of PAINT_ORDER) {
    let area: HTMLElement | null = null;
    for (const name of names) {
      const declarations = marginBoxes[name];
      if (declarations === undefined) continue;

      // A margin box is generated only when its `content` is something
      // (css-page-3 §4.2): absent, `none` and `normal` all mean no box — not
      // an empty one wearing the author's background and border. `""` is
      // content.
      const value = declarations["content"]?.trim().toLowerCase();
      if (value === undefined || value === "none" || value === "normal") continue;

      area ??= marginArea(areaName, spec, target);
      const box = target.createElement("folio-margin");
      box.className = `folio-margin folio-margin-${name} pagedjs_margin pagedjs_margin-${name}`;
      // The user agent's alignment (§6.2), which the author's overrides.
      const [textAlign, verticalAlign] = defaultAlignment(name);
      box.style.setProperty("text-align", textAlign);
      box.style.setProperty("vertical-align", verticalAlign);
      box.style.setProperty("position", "absolute");
      if (flow !== undefined) {
        box.style.setProperty("writing-mode", flow.writingMode);
        box.style.setProperty("direction", flow.direction);
      }

      for (const [property, v] of Object.entries(declarations)) {
        if (property === "content") continue; // handled by the caller's counters
      // Counted by the engine, never by the browser: on the element they
      // would advance the document's counters for every later page.
      const counter = /^counter-(reset|set|increment)$/.exec(property)?.[1];
      if (counter !== undefined) {
        box.dataset[`counter${counter[0]?.toUpperCase() ?? ""}${counter.slice(1)}`] = v;
        continue;
      }
        if (appliesToMarginBox(property)) box.style.setProperty(property, v);
      }

      // Paged.js puts the text in an inner `.pagedjs_margin-content`, and
      // author CSS styles that as often as it styles the box. The content
      // goes there, so a project that targets either one finds what it
      // expects. The box is a column that places it (`vertical-align`), which
      // stretches it to the box's width, so `text-align` has a line to align
      // on and a running head too wide for its box overflows at the end, not
      // the start. An author's `overflow: hidden; text-overflow: ellipsis`
      // on the box reaches the line it is about, which is in here.
      const inner = target.createElement("folio-margin-content");
      inner.className = "folio-margin-content pagedjs_margin-content";
      inner.style.cssText = "overflow:inherit;text-overflow:inherit";
      box.append(inner);

      area.append(box);
      boxes.set(name, inner);
    }
    if (area !== null) pageBox.append(area);
  }

  // The page's border, last: above the canvas, which `page-paint.ts` puts in
  // front of it, and beneath the content (css-page-3 §3.1).
  const border = borderLayer(spec, target);
  if (border !== null) pageBox.append(border);

  return { page, content, boxes };
}

/** The page's own layers, stacked in the page box by `z-index` and tree order. */
export const PAGE_LAYER = "folio-page-layer";
/** Which of the page's layers it is: `background` or `border`. */
export const LAYER = "data-folio-layer";

/**
 * The page background, bottom of §3.1's order: painted over the whole page,
 * margins included, and positioned within the page box's padding box by
 * default. One element has three boxes to offer — border, padding, content —
 * and the page has four, so which of the page's boxes the layer's padding box
 * stands for follows the author's `background-origin`: the page's border box
 * for `border-box`, its padding box otherwise, and the page area for
 * `content-box` (WPT `page-background-005`).
 */
function backgroundLayer(spec: PageSpec, target: Document): HTMLElement | null {
  const declarations = Object.entries(spec.background ?? {});
  if (declarations.length === 0) return null;
  // Shorthand before longhands, so `@page :first { background-color }`
  // refines an `@page { background }`.
  declarations.sort(([a], [b]) => Number(a !== "background") - Number(b !== "background"));
  const layer = target.createElement(PAGE_LAYER);
  layer.setAttribute(LAYER, "background");
  for (const [property, value] of declarations) layer.style.setProperty(property, value);
  const visibility = spec.decoration?.["visibility"];
  if (visibility !== undefined) layer.style.setProperty("visibility", visibility);
  const origin = layer.style.getPropertyValue("background-origin").split(",")[0]?.trim() ?? "";
  const zero = { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 };
  const border = origin === "border-box" ? spec.margins : sum(spec.margins, spec.border);
  const padding = origin === "border-box" ? sum(spec.border, spec.padding) : spec.padding ?? zero;
  layer.style.setProperty("background-origin", origin === "content-box" ? "content-box" : "padding-box");
  layer.style.cssText += [
    "",
    "position:absolute",
    "inset:0",
    "z-index:-1",
    "box-sizing:border-box",
    "border-style:solid",
    "border-color:transparent",
    `border-width:${edges(border)}`,
    `padding:${edges(padding)}`,
    // Last, and not left to the shorthand: `cssText` serializes the layers
    // back as `background: … padding-box`, and one box keyword there sets the
    // clip as well as the origin — the margins went unpainted.
    "background-clip:border-box",
  ].join(";");
  return layer;
}

/** The page box's border and outline, on its border box: the grid's middle. */
function borderLayer(spec: PageSpec, target: Document): HTMLElement | null {
  const decoration = Object.entries(spec.decoration ?? {});
  if (decoration.length === 0) return null;
  decoration.sort(([a], [b]) => a.split("-").length - b.split("-").length);
  const layer = target.createElement(PAGE_LAYER);
  layer.setAttribute(LAYER, "border");
  for (const [property, value] of decoration) layer.style.setProperty(property, value);
  const width = spec.border ?? { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 };
  layer.style.cssText += [
    "",
    "position:absolute",
    "grid-row:2 / span 3",
    "grid-column:2 / span 3",
    "inset:0",
    "z-index:-1",
    "box-sizing:border-box",
    // The widths `contentArea` took, so the border drawn is the border the
    // page area was measured inside.
    `border-width:${edges(width)}`,
  ].join(";");
  return layer;
}

function sum(...boxes: (Box | undefined)[]): Box {
  const out = { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 };
  for (const b of boxes) {
    if (b === undefined) continue;
    out.blockStart += b.blockStart;
    out.blockEnd += b.blockEnd;
    out.inlineStart += b.inlineStart;
    out.inlineEnd += b.inlineEnd;
  }
  return out;
}

/** A logical box as a physical `top right bottom left`, horizontal-tb. */
function edges(b: Box): string {
  return `${b.blockStart}px ${b.inlineEnd}px ${b.blockEnd}px ${b.inlineStart}px`;
}

/**
 * The class names a Paged.js project's CSS is written against.
 *
 * Only names, never behaviour: the structure underneath is ours, and where it
 * differs the difference is written down in `doc/compat.md` rather than
 * papered over. A page with no bleed is one element, so it is the sheet and
 * the page box at once — which is what they are.
 */
function namePagedjs(page: HTMLElement, pageBox: HTMLElement, spec: PageSpec): void {
  page.id = `page-${spec.index}`;
  page.classList.add("pagedjs_page", "pagedjs_sheet");
  page.classList.add(spec.side === "left" ? "pagedjs_left_page" : "pagedjs_right_page");
  if (spec.index === 1) page.classList.add("pagedjs_first_page");
  if (spec.blank) page.classList.add("pagedjs_blank_page");
  if (spec.name !== null) page.classList.add(`pagedjs_${spec.name}_page`);
  // When they are the same element it already carries both names.
  if (page !== pageBox) pageBox.classList.add("pagedjs_pagebox");
}

/**
 * The containing block of the margin boxes on one edge, or of one corner box
 * (css-page-3 §5.3.1): the page margin, less the corners for an edge. Paged.js
 * calls these `.pagedjs_margin-top` and `.pagedjs_margin-top-left-corner-holder`,
 * and the names travel as the others do.
 */
function marginArea(name: string, spec: PageSpec, target: Document): HTMLElement {
  const [width, height] = spec.size;
  const { blockStart: top, blockEnd: bottom, inlineStart: left, inlineEnd: right } = spec.margins;
  const middleX = width - left - right;
  const middleY = height - top - bottom;
  const rects: Record<string, [number, number, number, number]> = {
    "top-left-corner": [0, 0, left, top],
    top: [left, 0, middleX, top],
    "top-right-corner": [width - right, 0, right, top],
    right: [width - right, top, right, middleY],
    "bottom-right-corner": [width - right, height - bottom, right, bottom],
    bottom: [left, height - bottom, middleX, bottom],
    "bottom-left-corner": [0, height - bottom, left, bottom],
    left: [0, top, left, middleY],
  };
  const [x, y, w, h] = rects[name] ?? [0, 0, 0, 0];

  const area = target.createElement("folio-margin-area");
  const pagedjs = name.endsWith("-corner") ? `pagedjs_margin-${name}-holder` : `pagedjs_margin-${name}`;
  area.className = `folio-margin-area ${pagedjs}`;
  area.style.cssText = [
    "position:absolute",
    `left:${String(x)}px`,
    `top:${String(y)}px`,
    `width:${String(w)}px`,
    `height:${String(h)}px`,
  ].join(";");
  return area;
}

/**
 * How long a crop or cross mark is, and therefore how much room it needs
 * outside the bleed. About 4.8mm, which is the usual length on a press sheet.
 */
const MARK_LENGTH = 18;

/**
 * Put the page box on a sheet big enough for its bleed and its marks.
 *
 * The page box is the *trim* size and does not change: css-page-3 §11 makes
 * bleed and marks properties of the sheet the page is printed on, not of the
 * page. So a bleed can never move a break, which is the property worth
 * keeping — it is why this lives here and not anywhere the fragmenter reads.
 *
 * Marks are drawn from the trim edge outwards, starting past the bleed, so
 * that ink running into the bleed never touches them.
 */
function wrapForBleedAndMarks(
  pageBox: HTMLElement,
  spec: PageSpec,
  target: Document,
): HTMLElement {
  const { bleed, marks } = spec;
  const room = marks.crop || marks.cross ? MARK_LENGTH : 0;
  const inset = {
    top: bleed.blockStart + room,
    bottom: bleed.blockEnd + room,
    left: bleed.inlineStart + room,
    right: bleed.inlineEnd + room,
  };
  if (inset.top === 0 && inset.bottom === 0 && inset.left === 0 && inset.right === 0) {
    return pageBox;
  }

  const sheet = target.createElement("folio-sheet");
  sheet.className = "folio-page folio-sheet";
  sheet.style.cssText = [
    `width:${spec.size[0] + inset.left + inset.right}px`,
    `height:${spec.size[1] + inset.top + inset.bottom}px`,
    "writing-mode:horizontal-tb",
    "box-sizing:border-box",
    "position:relative",
    "overflow:hidden",
  ].join(";");

  pageBox.style.position = "absolute";
  pageBox.style.insetBlockStart = `${inset.top}px`;
  pageBox.style.insetInlineStart = `${inset.left}px`;
  sheet.append(pageBox);

  if (marks.crop) appendCropMarks(sheet, spec, inset, target);
  if (marks.cross) appendCrossMarks(sheet, spec, inset, target);
  return sheet;
}

type Inset = { top: number; bottom: number; left: number; right: number };

/**
 * Eight lines, two at each corner of the trim box.
 *
 * Each runs from the media edge inwards to the bleed edge, on the trim
 * corner's own row or column — so the four they define, extended, are exactly
 * where the guillotine goes.
 */
function appendCropMarks(sheet: HTMLElement, spec: PageSpec, inset: Inset, target: Document): void {
  const { bleed } = spec;
  const [width, height] = spec.size;
  const xs = [inset.left, inset.left + width];
  const ys = [inset.top, inset.top + height];

  for (const x of xs) {
    mark(sheet, target, { left: x, top: 0, width: 0, height: inset.top - bleed.blockStart });
    mark(sheet, target, {
      left: x,
      top: inset.top + height + bleed.blockEnd,
      width: 0,
      height: inset.bottom - bleed.blockEnd,
    });
  }
  for (const y of ys) {
    mark(sheet, target, { left: 0, top: y, width: inset.left - bleed.inlineStart, height: 0 });
    mark(sheet, target, {
      left: inset.left + width + bleed.inlineEnd,
      top: y,
      width: inset.right - bleed.inlineEnd,
      height: 0,
    });
  }
}

/** A registration cross at the middle of each edge, outside the bleed. */
function appendCrossMarks(sheet: HTMLElement, spec: PageSpec, inset: Inset, target: Document): void {
  const [width, height] = spec.size;
  const arm = MARK_LENGTH / 2;
  const centres = [
    { x: inset.left + width / 2, y: (inset.top - spec.bleed.blockStart) / 2 },
    { x: inset.left + width / 2, y: inset.top + height + spec.bleed.blockEnd + (inset.bottom - spec.bleed.blockEnd) / 2 },
    { x: (inset.left - spec.bleed.inlineStart) / 2, y: inset.top + height / 2 },
    { x: inset.left + width + spec.bleed.inlineEnd + (inset.right - spec.bleed.inlineEnd) / 2, y: inset.top + height / 2 },
  ];

  for (const { x, y } of centres) {
    mark(sheet, target, { left: x - arm, top: y, width: arm * 2, height: 0 });
    mark(sheet, target, { left: x, top: y - arm, width: 0, height: arm * 2 });
  }
}

/** One hairline. Zero in an axis means a rule rather than a box. */
function mark(
  sheet: HTMLElement,
  target: Document,
  at: { left: number; top: number; width: number; height: number },
): void {
  if (at.width <= 0 && at.height <= 0) return;

  const line = target.createElement("folio-mark");
  line.className = "folio-mark";
  line.style.cssText = [
    "position:absolute",
    `left:${at.left}px`,
    `top:${at.top}px`,
    `width:${Math.max(at.width, 1)}px`,
    `height:${Math.max(at.height, 1)}px`,
    "background:#000",
  ].join(";");
  sheet.append(line);
}

/**
 * What `counter()` in a margin box can name.
 *
 * `document` is the author's own counters as they stand at the *end* of the
 * page, which is what css-page-3 §5.1 says a margin box sees: a footer
 * reading `counter(chapter)` names the chapter the page finishes in. A header
 * that wants the one it *starts* in asks for `string(chapter, first)`, which
 * is the mechanism GCPM gives for that distinction and is already here.
 */
export type ContentCounters = {
  /** The page counter's value, which is not always the page's index (`page-counters.ts`). */
  page: number;
  pages: number;
  document?: ReadonlyMap<string, number>;
  /**
   * Counters the page context or the box keeps, which hide the document's of
   * the same name (css-page-3 §6.1).
   */
  context?: ReadonlyMap<string, number>;
  /** The page context's own `counter-reset`, for a box that says `inherit`. */
  contextReset?: string;
};

/** What a margin box's `content` can refer to on this page. */
export type ContentContext = {
  counters: ContentCounters;
  /** Named strings, as they stand on this page. */
  strings?: PageStrings;
  /** Running elements by name, for `element()`. */
  elements?: Map<string, Element>;
  /**
   * Named strings that hold an *element* rather than text, from
   * `string-set: title content(element)` (`math.md` §6). A running head whose
   * chapter title contains a formula reaches the margin box through here;
   * through the text above it would arrive as `a2+b2=c2`.
   */
  carried?: CarriedElements;
};

/**
 * Where a box's quotation marks stand: the author's `quotes` pairs, and how
 * deeply nested the next `open-quote` is. One per box, carried across the
 * parts `renderContent` splits a value into.
 */
export type QuoteState = { pairs: [string, string][]; depth: number };

/**
 * `quotes: auto` for text with no language, as Chromium and Firefox both
 * resolve it: double quotes outside, single inside.
 */
const DEFAULT_QUOTES: [string, string][] = [
  ["\u201c", "\u201d"],
  ["\u2018", "\u2019"],
];

/** The pairs a computed `quotes` value names. */
export function quotePairs(computed: string): [string, string][] {
  const value = computed.trim();
  if (value === "" || value === "auto") return DEFAULT_QUOTES;
  if (value === "none") return [];
  const strings = tokens(value).flatMap((t) => (t.kind === "string" ? [t.text] : []));
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < strings.length; i += 2) pairs.push([strings[i] ?? "", strings[i + 1] ?? ""]);
  return pairs;
}

type Token =
  | { kind: "string"; text: string }
  | { kind: "ident"; name: string }
  | { kind: "function"; name: string; args: string[] };

/**
 * Split a `content` value into strings, keywords and function calls.
 *
 * A tokenizer rather than a regular expression over the value, because a CSS
 * string has escapes: `"Line 1\aLine 2"` is two lines (WPT
 * `inapplicable-properties`), `"\201C"` is a quotation mark, and `"say
 * \"no\""` does not end at the second quote.
 */
function tokens(value: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < value.length) {
    const ch = value[i] ?? "";
    if (ch === '"' || ch === "'") {
      let text = "";
      i++;
      while (i < value.length && value[i] !== ch) {
        if (value[i] === "\\") {
          const hex = /^[0-9a-fA-F]{1,6}[ \t\n]?/.exec(value.slice(i + 1));
          if (hex !== null) {
            const code = parseInt(hex[0], 16);
            text += String.fromCodePoint(code === 0 || code > 0x10ffff ? 0xfffd : code);
            i += 1 + hex[0].length;
          } else {
            // An escaped newline continues the string; anything else is itself.
            if (value[i + 1] !== "\n") text += value[i + 1] ?? "";
            i += 2;
          }
        } else text += value[i++];
      }
      i++;
      out.push({ kind: "string", text });
      continue;
    }
    const word = /^[\w-]+/.exec(value.slice(i));
    if (word === null) {
      i++;
      continue;
    }
    i += word[0].length;
    if (value[i] !== "(") {
      out.push({ kind: "ident", name: word[0].toLowerCase() });
      continue;
    }
    const close = value.indexOf(")", i);
    const inside = value.slice(i + 1, close === -1 ? value.length : close);
    i = close === -1 ? value.length : close + 1;
    out.push({ kind: "function", name: word[0].toLowerCase(), args: inside.split(",").map((a) => a.trim()) });
  }
  return out;
}

/**
 * Resolve a margin box's `content` value to text.
 *
 * `element()` is not text and is handled by `renderContent`; here it
 * contributes nothing, which is better than contributing the literal words
 * "element(header)". So does anything else not understood.
 */
export function resolveContent(
  value: string,
  counters: ContentCounters,
  strings?: PageStrings,
  quotes: QuoteState = { pairs: DEFAULT_QUOTES, depth: 0 },
): string {
  let out = "";
  for (const token of tokens(value)) {
    if (token.kind === "string") out += token.text;
    else if (token.kind === "ident") out += quote(token.name, quotes);
    else if (token.name === "counter" || token.name === "counters") {
      // `page` and `pages` are pagination's to answer and nothing else knows
      // them; every other name is an author counter the engine walked
      // (`counters.ts`). One that nothing counted prints nothing, which is
      // what the author's rule rendered before it was answerable at all.
      // `counters(name, ".")` is the innermost value alone: a margin box's
      // counter hides the page's rather than nesting in it (WPT
      // `content-011`), and the document's are counted flat (`counters.ts`).
      const n = counterIn(token.args[0] ?? "", counters);
      const style = token.name === "counters" ? token.args[2] : token.args[1];
      if (n !== undefined) out += formatCounter(n, style || "decimal");
    } else if (token.name === "string" && strings !== undefined) {
      out += resolveString(token.args[0] ?? "", (token.args[1] || "first") as StringScope, strings);
    }
  }
  return out;
}

/** What a quote keyword prints, and what it does to the nesting (CSS Content 3 §4). */
function quote(keyword: string, state: QuoteState): string {
  const pair = (depth: number): [string, string] | undefined =>
    state.pairs[Math.min(depth, state.pairs.length - 1)];
  switch (keyword) {
    case "open-quote":
      return pair(state.depth++)?.[0] ?? "";
    case "no-open-quote":
      state.depth++;
      return "";
    case "close-quote":
      if (state.depth === 0) return "";
      return pair(--state.depth)?.[1] ?? "";
    case "no-close-quote":
      if (state.depth > 0) state.depth--;
      return "";
    default:
      return "";
  }
}

/**
 * Fill a margin box from its `content` value.
 *
 * Text goes in as text; `element(name)` puts a *clone of the element* in.
 * That distinction is §7's point about running heads: `textContent` would
 * destroy a formula, so math reaches a running head only if the element
 * itself travels.
 */
export function renderContent(box: HTMLElement, value: string, ctx: ContentContext): void {
  box.replaceChildren();
  const view = box.ownerDocument.defaultView;
  const quotes: QuoteState = {
    pairs: quotePairs(view === null ? "auto" : view.getComputedStyle(box).quotes),
    depth: 0,
  };

  // One capture, so `split` returns the calls themselves and nothing else.
  const parts = value.split(
    /((?:element|string)\(\s*[\w-]+\s*(?:,\s*[\w-]+\s*)?\)|url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\))/,
  );
  for (const part of parts) {
    // An image is a replaced element in the line, as it is in `::before`.
    const url = /^url\(\s*["']?([^"')]*)["']?\s*\)$/.exec(part);
    if (url !== null) {
      const image = box.ownerDocument.createElement("img");
      image.src = url[1] ?? "";
      image.alt = "";
      box.append(image);
      continue;
    }
    const running = /^element\(\s*([\w-]+)/.exec(part);
    if (running !== null) {
      const element = ctx.elements?.get(running[1] ?? "");
      if (element !== undefined) box.append(element.cloneNode(true));
      continue;
    }
    const named = /^string\(\s*([\w-]+)\s*(?:,\s*([\w-]+))?/.exec(part);
    if (named !== null && ctx.carried !== undefined) {
      const element = resolveCarriedElement(
        named[1] ?? "",
        (named[2] ?? "first") as StringScope,
        ctx.carried,
      );
      // Only when that name holds an element. Otherwise it is an ordinary
      // named string and the text path below is the right one.
      if (element !== undefined) {
        box.append(element.cloneNode(true));
        continue;
      }
    }
    const text = resolveContent(part, ctx.counters, ctx.strings, quotes);
    if (text !== "") box.append(box.ownerDocument.createTextNode(text));
  }
}

/** One page's margin boxes, what fills them, and what that can refer to. */
export type MarginBoxPage = {
  boxes: ReadonlyMap<string, HTMLElement>;
  values: Readonly<Record<string, string>>;
  ctx: ContentContext;
};

/**
 * Fill the margin boxes of every page, and then lay them all out.
 *
 * Filled first because a box's geometry depends on its neighbours' content
 * (css-page-3 §5.3): the three boxes on an edge share it in proportion to
 * what is in them. Laid out together because layout is measurement, and a
 * measurement is a forced layout of the whole document: once for the book
 * rather than once a page (`layoutMarginBoxes`).
 */
export function renderMarginBoxes(pages: readonly MarginBoxPage[]): void {
  for (const { boxes, values, ctx } of pages) {
    for (const [name, value] of Object.entries(values)) {
      const box = boxes.get(name);
      if (box === undefined) continue;
      const own = box.parentElement?.dataset ?? {};
      const counters = marginCounters(ctx.counters, {
        reset: own["counterReset"],
        set: own["counterSet"],
        increment: own["counterIncrement"],
      });
      renderContent(box, value, { ...ctx, counters });
    }
  }
  layoutMarginBoxes(pages.map((page) => page.boxes));
}

function counterIn(name: string, counters: ContentCounters): number | undefined {
  if (name === "page") return counters.page;
  if (name === "pages") return counters.pages;
  return counters.context?.get(name) ?? counters.document?.get(name);
}

/** The counter styles a page number actually uses. */
export function formatCounter(n: number, style: string): string {
  switch (style) {
    case "upper-roman":
      return roman(n).toUpperCase();
    case "lower-roman":
      return roman(n);
    case "upper-alpha":
      return alpha(n).toUpperCase();
    case "lower-alpha":
      return alpha(n);
    default:
      return String(n);
  }
}

function roman(n: number): string {
  if (n <= 0) return String(n);
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"],
    [100, "c"], [90, "xc"], [50, "l"], [40, "xl"],
    [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  let left = n;
  for (const [value, numeral] of table) {
    while (left >= value) {
      out += numeral;
      left -= value;
    }
  }
  return out;
}

function alpha(n: number): string {
  if (n <= 0) return String(n);
  let out = "";
  let left = n;
  while (left > 0) {
    const rem = (left - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    left = Math.floor((left - 1) / 26);
  }
  return out;
}
