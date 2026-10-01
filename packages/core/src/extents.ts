/**
 * The block size of a box split across pages (`doc/review.md` §4.7).
 *
 * A split box is composed again on every page it crosses, and a box with a
 * definite height — `height: 8in`, a minimum — came back at that height on
 * every one of them: the page's end was inside it again, and a clipping box
 * never clipped. WPT `monolithic-overflow-028` made twelve pages of four.
 * CSS Break 3 gives the fragments of one box one block size between them.
 *
 * So each page's end records, per split box, how much of its border box the
 * pages so far have used (`Position.consumed`, by source path), and each page
 * gives a split box the rest, cut at the page's end if it goes on. A page is
 * still `(spec, start)`: the record is in the start.
 *
 * Only a box whose height is not its content's is touched. That is measured,
 * not read — a computed `height` is always a length — as the box whole (the
 * fragment rules off) against the same box at `block-size: auto`. A box its
 * content sizes is laid out again from its content on every page, as before.
 *
 * **Delete when** browsers fragment paged media themselves.
 */
import { SOURCE_PATH, SPLIT_FROM, SPLIT_TO } from "./compose.js";
import { FRAGMENT } from "./fragments.js";
import { domMeasurer } from "./dom-measurer.js";
import type { Measurer } from "./types.js";
import type { Deletion } from "./native.js";

/** Used border box per split box, by source path (`2.1.0`). */
export type Consumed = Record<string, number>;

/**
 * Size the split boxes under `root` and say what the page uses of each.
 *
 * @param consumed what the pages before used, from the page's start
 * @param pageEnd  where the page area ends, in client coordinates; null for a
 *   measuring box, which has no end yet and must show each box's whole rest
 */
export function sizeFragments(root: Element, consumed: Consumed | undefined, pageEnd: number | null): Consumed {
  const out: Consumed = {};
  // Block-axis positions, whichever axis that is (`review.md` §5).
  const measurer = domMeasurer(root);
  const pageTop = measurer.box(root).blockStart;
  // Outermost first, so a box is sized before what it holds is measured.
  for (const el of root.querySelectorAll<HTMLElement>(`[${SPLIT_FROM}][${SOURCE_PATH}], [${SPLIT_TO}][${SOURCE_PATH}]`)) {
    const whole = wholeHeight(el, measurer);
    if (whole === null) continue;
    const key = el.getAttribute(SOURCE_PATH) ?? "";
    const used = el.hasAttribute(SPLIT_FROM) ? (consumed?.[key] ?? 0) : 0;
    // A slice inside it shifts it up by what the pages before showed: its
    // margin collapses through this box (`showSlice`). What is above the
    // page is theirs, and this box is that much taller than its rest.
    const top = measurer.box(el).blockStart;
    const above = Math.max(0, pageTop - top);
    let size = Math.max(0, whole - used) + above;
    if (el.hasAttribute(SPLIT_TO) && pageEnd !== null) {
      size = Math.max(0, Math.min(size, pageEnd - top));
      out[key] = used + Math.max(0, size - above);
    }
    for (const [property, value] of [
      ["box-sizing", "border-box"],
      ["block-size", `${String(size)}px`],
      ["min-block-size", "0"],
      ["max-block-size", "none"],
    ]) {
      el.style.setProperty(property as string, value as string, "important");
    }
  }
  return out;
}

/**
 * The box's border-box height as one unsplit box, or null when that height
 * is its content's: with the fragment rules off, against `block-size: auto`.
 */
function wholeHeight(el: HTMLElement, measurer: Measurer): number | null {
  const size = (): number => {
    const r = measurer.box(el);
    return r.blockEnd - r.blockStart;
  };
  const saved = [FRAGMENT, SPLIT_FROM, SPLIT_TO].map((name) => [name, el.getAttribute(name)] as const);
  for (const [name] of saved) el.removeAttribute(name);
  const whole = size();
  // The `style` attribute as it was, not merely its value: a box that turns
  // out not to be sized must not gain an empty one. Chromium writes a CSSOM
  // change back to the attribute lazily, after a `removeAttribute`, and left
  // `style=""`; reading the attribute first makes it write back now.
  const style = el.getAttribute("style");
  el.style.setProperty("block-size", "auto", "important");
  const natural = size();
  el.style.removeProperty("block-size");
  el.getAttribute("style");
  if (style === null) el.removeAttribute("style");
  else el.setAttribute("style", style);
  for (const [name, value] of saved) if (value !== null) el.setAttribute(name, value);
  return whole - natural > 1 ? whole : null;
}

/**
 * Stretch a page's last fragments to the page's end.
 *
 * A box broken by a page break ends, on that page, where the page does, not
 * where its content does: Chromium prints a split box's background and side
 * borders down to the foot of the page, and WPT `page-margin-004`'s reference
 * draws exactly that with a 250px block. The innermost split boxes grow by
 * the space left at the page's foot, and every split box around them, whose
 * height is theirs, grows with them; a note area below moves down by as much.
 * Run on a finished page only — it paints, and moves no break.
 */
export function fillFragments(content: Element, slack: number): void {
  if (slack <= 0.5) return;
  const view = content.ownerDocument.defaultView;
  if (view === null) return;
  const split = [...content.querySelectorAll<HTMLElement>(`[${SPLIT_TO}][${SOURCE_PATH}]`)];
  const measurer = domMeasurer(content);
  for (const el of split) {
    if (el.querySelector(`[${SPLIT_TO}]`) !== null) continue;
    const parent = el.parentElement;
    const own = view.getComputedStyle(el).display;
    const around = parent === null ? "" : view.getComputedStyle(parent).display;
    // Stacked blocks only: a cell or a flex item has a row, and a table
    // repeats its footer below the rows (`tables.ts`).
    if (!/^(block|list-item|flow-root)$/.test(own) || !/^(block|list-item|flow-root)$/.test(around)) continue;
    if (el.closest("table") !== null) continue;
    const r = measurer.box(el);
    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("min-block-size", `${String(r.blockEnd - r.blockStart + slack)}px`, "important");
  }
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "extents",
  files: ["extents.ts"],
  feature: "Content taller than a page: split boxes' set heights, fragments to the page's foot",
  when: "Browsers fragment paged media themselves",
  tests: [/^css\/css-page\/monolithic-overflow-/, /^css\/css-break\/(overflowing-block|transform-0|underflow-from-next-page)/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
