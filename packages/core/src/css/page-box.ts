/**
 * The page box's margins, border and padding (css-page-3 §3, §7).
 *
 * A page box is a box: margins outside, then a border, then padding, and the
 * page area inside all three. The page area is what the fragmenter fills, so
 * these three are not decoration — each one moves every break on the page —
 * and they are resolved here, as numbers, rather than left to the browser to
 * paint: a border the browser draws 10px wide and the page area took as 3px
 * would be a page measured against one size and shown at another.
 *
 * Two things are not as in an ordinary box. **Percentages** resolve against
 * the page box's own size on the axis they are on — `margin-top: 5%` is 5% of
 * the height, not of the width (WPT `page-box-004`, which says so in a
 * comment). And logical sides map as horizontal-tb does, because the page
 * model is logical from the start and vertical writing is not implemented.
 *
 * Pure: no DOM, unit-tested beside it.
 */
import { toPx } from "./length.js";
import type { Declarations } from "./page-rules.js";
import type { Box } from "../types.js";

type Side = "top" | "right" | "bottom" | "left";
const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
/** Logical sides as physical ones, for the root's flow (css-page-3 §3: a
 * page's logical properties are the root's). Horizontal left-to-right when
 * no flow is given. */
function logicalSides(flow: { writingMode: string; direction: string } | undefined): Record<string, Side> {
  const writingMode = flow?.writingMode ?? "horizontal-tb";
  const rtl = flow?.direction === "rtl";
  if (/^(vertical|sideways)/.test(writingMode)) {
    const rl = /-rl$/.test(writingMode);
    return {
      "block-start": rl ? "right" : "left",
      "block-end": rl ? "left" : "right",
      "inline-start": rtl ? "bottom" : "top",
      "inline-end": rtl ? "top" : "bottom",
    };
  }
  return { "block-start": "top", "block-end": "bottom", "inline-start": rtl ? "right" : "left", "inline-end": rtl ? "left" : "right" };
}

type Flow = { writingMode: string; direction: string } | undefined;
const STYLES = new Set(["none", "hidden", "dotted", "dashed", "solid", "double", "groove", "ridge", "inset", "outset"]);
const WIDTHS: Record<string, number> = { thin: 1, medium: 3, thick: 5 };

/**
 * `margin` or `padding`, with its longhands, physical and logical: a length or
 * a percentage of the page box's width (left, right) or height (top, bottom).
 * A value that does not parse leaves the side as it was.
 */
export function resolveSides(
  declarations: Declarations,
  property: "margin" | "padding",
  fallback: number,
  [width, height]: readonly [number, number],
  flow?: Flow,
): Box {
  const map = logicalSides(flow);
  const px = (value: string, side: Side): number | null => {
    const v = value.trim();
    // Zero here; what an `auto` page margin takes is `autoSides`' business.
    if (v === "auto" && property === "margin") return 0;
    const percent = /^(-?\d*\.?\d+)%$/.exec(v)?.[1];
    if (percent !== undefined) return (Number(percent) / 100) * (side === "left" || side === "right" ? width : height);
    return toPx(v);
  };
  const sides: Record<Side, number> = { top: fallback, right: fallback, bottom: fallback, left: fallback };

  const shorthand = declarations[property];
  if (shorthand !== undefined) {
    const values = fourSides(shorthand).map((v, i) => px(v, SIDES[i] as Side));
    if (values.every((v) => v !== null)) SIDES.forEach((s, i) => (sides[s] = values[i] as number));
  }
  for (const [name, value] of Object.entries(declarations)) {
    const side = sideOf(name, property, "", map);
    if (side === null) continue;
    const resolved = px(value, side);
    if (resolved !== null) sides[side] = resolved;
  }
  return logical(sides);
}

/** Which sides of `margin` are `auto`, after the shorthand and longhands. */
export function autoSides(declarations: Declarations, flow?: Flow): Record<keyof Box, boolean> {
  const map = logicalSides(flow);
  const sides: Record<Side, boolean> = { top: false, right: false, bottom: false, left: false };
  const shorthand = declarations["margin"];
  if (shorthand !== undefined) fourSides(shorthand).forEach((v, i) => (sides[SIDES[i] as Side] = v === "auto"));
  for (const [name, value] of Object.entries(declarations)) {
    const side = sideOf(name, "margin", "", map);
    if (side !== null) sides[side] = value.trim() === "auto";
  }
  return { blockStart: sides.top, blockEnd: sides.bottom, inlineStart: sides.left, inlineEnd: sides.right };
}

/**
 * The border's widths, as the browser will draw them: a side whose style is
 * `none` or `hidden` — the initial style — is zero however wide it says it is,
 * and a side with a style and no width is `medium`.
 */
export function resolveBorderWidths(declarations: Declarations, flow?: Flow): Box {
  const map = logicalSides(flow);
  const width: Record<Side, number> = { top: 3, right: 3, bottom: 3, left: 3 };
  const style: Record<Side, string> = { top: "none", right: "none", bottom: "none", left: "none" };

  const shorthandOn = (value: string, sides: readonly Side[]): void => {
    // A shorthand resets what it leaves out: `border: solid` is medium.
    for (const s of sides) {
      width[s] = 3;
      style[s] = "none";
    }
    for (const token of value.trim().toLowerCase().split(/\s+/)) {
      const w = WIDTHS[token] ?? toPx(token);
      if (w !== null) for (const s of sides) width[s] = w;
      else if (STYLES.has(token)) for (const s of sides) style[s] = token;
    }
  };

  // Least specific first, as the cascade has already made each one a single
  // value and the order they were written in is gone.
  const border = declarations["border"];
  if (border !== undefined) shorthandOn(border, SIDES);
  for (const s of SIDES) {
    const side = declarations[`border-${s}`];
    if (side !== undefined) shorthandOn(side, [s]);
  }
  for (const [logicalName, s] of Object.entries(map)) {
    const side = declarations[`border-${logicalName}`];
    if (side !== undefined) shorthandOn(side, [s]);
  }
  const widths = declarations["border-width"];
  if (widths !== undefined) {
    fourSides(widths).forEach((v, i) => {
      const w = WIDTHS[v.toLowerCase()] ?? toPx(v);
      if (w !== null) width[SIDES[i] as Side] = w;
    });
  }
  const styles = declarations["border-style"];
  if (styles !== undefined) {
    fourSides(styles).forEach((v, i) => {
      if (STYLES.has(v.toLowerCase())) style[SIDES[i] as Side] = v.toLowerCase();
    });
  }
  for (const [name, value] of Object.entries(declarations)) {
    const w = sideOf(name, "border", "-width", map);
    if (w !== null) width[w] = WIDTHS[value.trim().toLowerCase()] ?? toPx(value.trim()) ?? width[w];
    const st = sideOf(name, "border", "-style", map);
    if (st !== null && STYLES.has(value.trim().toLowerCase())) style[st] = value.trim().toLowerCase();
  }

  const out = { ...width };
  for (const s of SIDES) if (style[s] === "none" || style[s] === "hidden") out[s] = 0;
  return logical(out);
}

/** The side a longhand like `padding-top` or `border-inline-start-width` names. */
function sideOf(name: string, property: string, suffix: string, map: Record<string, Side>): Side | null {
  if (!name.startsWith(`${property}-`) || !name.endsWith(suffix)) return null;
  const middle = name.slice(property.length + 1, name.length - suffix.length);
  if ((SIDES as readonly string[]).includes(middle)) return middle as Side;
  return map[middle] ?? null;
}

/** One to four values, spread over top, right, bottom, left. */
function fourSides(value: string): string[] {
  const v = value.trim().split(/\s+/);
  const [a = "", b = a, c = a, d = b] = v;
  return [a, b, c, d];
}

function logical(sides: Record<Side, number>): Box {
  return { blockStart: sides.top, blockEnd: sides.bottom, inlineStart: sides.left, inlineEnd: sides.right };
}
