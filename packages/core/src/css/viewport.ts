/**
 * Viewport units in paged media (css-page-3 §3.1, M6).
 *
 * On paper the viewport is the page area of the first page, so `100vh` is a
 * page tall. Here there are two viewports and neither is the page: the frame
 * the pages are measured in, and the host document they are shown in. The
 * frame can be sized to the page area (`sizeFrameToPage`), and was; the host
 * cannot, and a page measured with `100vw` of 420px and shown with `100vw` of
 * the reader's window is a page that was never measured. WPT's
 * `page-margin-001-print` showed it: the right height on the right number of
 * pages, and every block 60px too wide.
 *
 * So the units are rewritten, as `target-counter()` is: `50vh` becomes
 * `calc(50 * var(--folio-vh, 1vh))`, and whoever shows the pages sets the
 * variable — the `Previewer` sets it on the frame's root and on each page.
 * Unset, the fallback is the unit it replaced, so a caller who never heard of
 * this measures exactly what it measured before.
 *
 * `vi` and `vb` follow the root's writing mode: in a vertical root `vb` is a
 * width and `vi` a height (WPT `page-box-008`'s `block-size: 100vb`). They
 * have variables of their own, set with the others from the root's flow,
 * because a `style` attribute is rewritten where the flow is not known.
 *
 * **Delete when** the engine lays pages out in a context whose viewport is the
 * page, which a screen never is.
 */

import type { Deletion } from "../native.js";

const WIDTH = new Set(["vw", "svw", "lvw", "dvw"]);
const HEIGHT = new Set(["vh", "svh", "lvh", "dvh"]);
const INLINE = new Set(["vi", "svi", "lvi", "dvi"]);
const BLOCK = new Set(["vb", "svb", "lvb", "dvb"]);
const MIN = new Set(["vmin", "svmin", "lvmin", "dvmin"]);
const MAX = new Set(["vmax", "svmax", "lvmax", "dvmax"]);

export const VW = "--folio-vw";
export const VH = "--folio-vh";
export const VI = "--folio-vi";
export const VB = "--folio-vb";

const vw = `var(${VW}, 1vw)`;
const vh = `var(${VH}, 1vh)`;
const vi = `var(${VI}, 1vi)`;
const vb = `var(${VB}, 1vb)`;

/** The value of one unit, as CSS. */
function unitValue(unit: string): string | null {
  if (WIDTH.has(unit)) return vw;
  if (HEIGHT.has(unit)) return vh;
  if (INLINE.has(unit)) return vi;
  if (BLOCK.has(unit)) return vb;
  if (MIN.has(unit)) return `min(${vw}, ${vh})`;
  if (MAX.has(unit)) return `max(${vw}, ${vh})`;
  return null;
}

/**
 * Rewrite every viewport-relative length in a stylesheet.
 *
 * A scan, like `rewriteCarriers`: strings, comments and `url()` are copied
 * through untouched, and so is everything that is not a number followed by
 * one of the units above.
 */
export function rewriteViewportUnits(css: string): string {
  let out = "";
  let i = 0;
  const number = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([a-z]+)/i;

  while (i < css.length) {
    const ch = css[i] as string;

    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const to = end === -1 ? css.length : end + 2;
      out += css.slice(i, to);
      i = to;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const to = skipString(css, i);
      out += css.slice(i, to);
      i = to;
      continue;
    }
    if (/url\(/iy.test(css.slice(i, i + 4))) {
      const end = css.indexOf(")", i);
      const to = end === -1 ? css.length : end + 1;
      out += css.slice(i, to);
      i = to;
      continue;
    }

    // A number starts a token only where an identifier does not continue:
    // `h1vh` is a selector, not one viewport height.
    const previous = i === 0 ? "" : (css[i - 1] as string);
    if (/[\d.+-]/.test(ch) && !/[\w-]/.test(previous)) {
      const m = number.exec(css.slice(i));
      if (m !== null) {
        const unit = (m[3] as string).toLowerCase();
        const value = unitValue(unit);
        if (value !== null) {
          const magnitude = m[0].slice(0, m[0].length - unit.length);
          out += `calc(${magnitude} * ${value})`;
        } else {
          out += m[0];
        }
        i += m[0].length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** The declarations that give the variables their values, for one page area. */
export function viewportDeclarations(area: { inline: number; block: number }, vertical = false): string {
  const [width, height] = [area.inline / 100, area.block / 100];
  const [i, b] = vertical ? [height, width] : [width, height];
  return `${VW}:${width}px;${VH}:${height}px;${VI}:${i}px;${VB}:${b}px`;
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === "\\") i += 2;
    else if (css[i] === quote) return i + 1;
    else i++;
  }
  return css.length;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "viewport units",
  files: ["css/viewport.ts"],
  feature: "`vw` and `vh` as the first page's area",
  when: "The engine lays pages out in a context whose viewport is the page area",
  tests: [/^css\/css-page\/(page-margin-00[12]-|page-size-009-|margin-boxes\/dimensions-015)/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
