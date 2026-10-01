/**
 * CSS lengths, in the absolute units a page model needs (`doc/plan.md` §4:
 * "`@page` size, margins, orientation ... mm/in/pt and named sizes").
 *
 * Absolute units only. `em`, `%` and `vh` depend on a cascade and a viewport,
 * and the engine does not own either — a page size in `em` is resolved by the
 * browser, not by us.
 */

/** CSS reference pixels per unit. */
const UNITS: Record<string, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};

/**
 * Rewrite the font-relative lengths in a page descriptor to pixels.
 *
 * The exception to "absolute units only": `@page { margin: 4em }` is common,
 * and the page context's `em` has a definite answer that needs no cascade of
 * ours — css-page-3 §6 has the page context inherit from the root element, so
 * `rem` is the root's font size and `em` is the page's own, which is the
 * root's unless the page rule sets one. The caller reads the root's from the
 * browser. Before this, `4em` was not a length at all, and the margin it
 * named silently became the default one (WPT `margin-boxes/content-*`).
 */
export function resolveFontRelative(value: string, em: number, rem: number): string {
  return value.replace(/([+-]?(?:\d+\.?\d*|\.\d+))(r?em)\b/gi, (_, n: string, unit: string) =>
    `${String(Number(n) * (unit.toLowerCase() === "rem" ? rem : em))}px`,
  );
}

/**
 * Rewrite viewport units in a page descriptor to pixels, against the page
 * they are relative to: the user agent's default page, since the one being
 * resolved does not exist yet (WPT `page-size-016`: `width: 150vw` on a 5in
 * default page is 7.5in).
 */
export function resolveViewportLengths(value: string, [width, height]: readonly [number, number]): string {
  return value.replace(/([+-]?(?:\d+\.?\d*|\.\d+))(vw|vh|vmin|vmax)\b/gi, (_, n: string, unit: string) => {
    const u = unit.toLowerCase();
    const base =
      u === "vw" ? width : u === "vh" ? height : u === "vmin" ? Math.min(width, height) : Math.max(width, height);
    return `${String((Number(n) * base) / 100)}px`;
  });
}

/** Parse an absolute length to CSS pixels, or null if it is not one. */
export function toPx(value: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z]*)$/i.exec(value.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "") return n === 0 ? 0 : null; // unitless is only valid for zero
  const factor = UNITS[unit];
  return factor === undefined ? null : n * factor;
}

/**
 * The named page sizes of CSS Paged Media 3, in portrait, as [width, height]
 * in CSS pixels.
 */
export const PAGE_SIZES: Record<string, [number, number]> = {
  // The ten CSS Paged Media 3 §3.1 requires.
  a5: [148, 210],
  a4: [210, 297],
  a3: [297, 420],
  b5: [176, 250],
  b4: [250, 353],
  "jis-b5": [182, 257],
  "jis-b4": [257, 364],
  letter: [8.5 * 25.4, 11 * 25.4],
  legal: [8.5 * 25.4, 14 * 25.4],
  ledger: [11 * 25.4, 17 * 25.4],
  // The rest of the ISO series, which the spec does not require and authors
  // use anyway: `size: A6` is a corpus fixture, Paged.js supports A0–A10, and
  // an unknown name silently becomes the default page — a booklet laid out on
  // US Letter, which is how `splits/text-align-last` came out four pages on
  // one engine and two on the other.
  a0: [841, 1189],
  a1: [594, 841],
  a2: [420, 594],
  a6: [105, 148],
  a7: [74, 105],
  a8: [52, 74],
  b0: [1000, 1414],
  b1: [707, 1000],
  b2: [500, 707],
  b3: [353, 500],
  b6: [125, 176],
};

const mmToPx = (mm: number): number => mm * (96 / 25.4);

/**
 * Resolve the `size` property: a named size, one or two lengths, either with
 * an orientation keyword. Returns [width, height] in CSS pixels.
 */
export function parseSize(
  value: string,
  initial: readonly [number, number] = [mmToPx(210), mmToPx(297)],
): [number, number] | null {
  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  // An explicit loop, not filter() with a captured variable: TypeScript's
  // control flow does not follow assignments made inside a callback, so it
  // narrows `orientation` to null and everything downstream reads as dead code.
  let orientation: "portrait" | "landscape" | null = null;
  const rest: string[] = [];
  for (const p of parts) {
    if (p === "portrait" || p === "landscape") orientation = p;
    else rest.push(p);
  }

  let size: [number, number] | null = null;
  if (rest.length === 0) {
    // `size: landscape` alone means the UA's default page size, rotated —
    // whatever the caller says that is (`page-model.ts`). Until it said, this
    // was A4 while a page with no `size` at all was Letter: two defaults.
    size = orientation === null ? null : [initial[0], initial[1]];
  } else if (rest.length === 1) {
    const named = PAGE_SIZES[rest[0] as string];
    if (named !== undefined) size = [mmToPx(named[0]), mmToPx(named[1])];
    else {
      const px = toPx(rest[0] as string);
      if (px !== null) size = [px, px]; // one length means a square page
    }
  } else if (rest.length === 2) {
    const named = PAGE_SIZES[rest[0] as string];
    if (named !== undefined) {
      size = [mmToPx(named[0]), mmToPx(named[1])];
    } else {
      const w = toPx(rest[0] as string);
      const h = toPx(rest[1] as string);
      if (w !== null && h !== null) size = [w, h];
    }
  }
  if (size === null) return null;

  if (orientation === "landscape" && size[0] < size[1]) return [size[1], size[0]];
  if (orientation === "portrait" && size[0] > size[1]) return [size[1], size[0]];
  return size;
}

/** The four margins from a `margin` shorthand, in CSS pixels. */
export function parseMarginShorthand(
  value: string,
): { top: number; right: number; bottom: number; left: number } | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 4) return null;

  const px = parts.map(toPx);
  if (px.some((p) => p === null)) return null;
  const [a, b, c, d] = px as number[];

  switch (parts.length) {
    case 1:
      return { top: a as number, right: a as number, bottom: a as number, left: a as number };
    case 2:
      return { top: a as number, right: b as number, bottom: a as number, left: b as number };
    case 3:
      return { top: a as number, right: b as number, bottom: c as number, left: b as number };
    default:
      return { top: a as number, right: b as number, bottom: c as number, left: d as number };
  }
}
