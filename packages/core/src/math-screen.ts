/**
 * The engine's mathematics on a screen, with no pages (`doc/math-drop-in.md`).
 *
 * The same source that paginates can be read in a browser window: the same
 * MathML, numbered by the same walk (`math/number.ts`), broken by the same
 * selector against the width it has (`math/compose.ts`), with references
 * filled from the same numbers (`references.ts`). What is missing is only
 * what pages are: no frame, no measuring box, no composition, and a
 * `target-counter(…, page)` resolves to nothing, as there is no page.
 *
 * Two things differ from stage 1, because this runs in the live document
 * rather than on copies of it:
 *
 * - **The author's CSS is copied, not moved.** The engine's carriers
 *   (`math-number`) and the `attr()` a reference is rewritten to exist only
 *   in the rewritten text, so a rewritten copy goes after the author's own
 *   sheets, as the `Previewer` puts one on the host. Only when the CSS has
 *   something to rewrite: a page with plain MathML and no numbers gets none.
 * - **A window changes width; a page does not.** Each display keeps the
 *   MathML it had before it was broken, and is broken again from that when
 *   its container's width changes.
 */
import { breakEquations, MATH_ROWS } from "./math/compose.js";
import { ensureMathFont } from "./math/font.js";
import { EQ_CLASS, ensureMathRules, numberEquations } from "./math/number.js";
import { counterOps, countPage } from "./counters.js";
import type { CounterValues } from "./counters.js";
import { carrierRegistrations, rewriteCarriers } from "./css/rewrite.js";
import { domMeasurer } from "./dom-measurer.js";
import { applyReferences, rewriteReferences } from "./references.js";
import type { Reference } from "./references.js";
import { collectCss, settle } from "./source.js";

/** The rewritten copy of the author's CSS on the page. */
export const SCREEN_CSS_ID = "folio-math-css";

export type MathOptions = {
  /** Check this family has a `MATH` table before anything is measured. */
  mathFont?: string;
  /** Break displays again when their container's width changes. Default true. */
  reflow?: boolean;
};

export type MathOnScreen = {
  /** Each numbered equation's id and number, as `numberEquations` gives. */
  equations: Map<string, number>;
  /** Displays composed into more than one row. */
  broken: Element[];
  /** Displays still wider than their measure. */
  overflowed: Element[];
  /** Stop breaking again on resize. */
  disconnect(): void;
};

/**
 * Number, break and resolve every formula under `root`, in place.
 *
 * Called twice on the same root, it starts again: the rewritten CSS is
 * replaced, the numbers counted from the top, and each display broken from
 * the MathML it had the first time.
 */
export async function folioMath(root: Element = document.body, options: MathOptions = {}): Promise<MathOnScreen> {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (view === null) throw new Error("folio: the math is not in a rendered document");
  await settle(doc);
  if (options.mathFont !== undefined) await ensureMathFont(options.mathFont, doc);

  const displays = [...root.querySelectorAll("math[display='block']")];
  for (const math of displays) restore(math);
  const references = await insertScreenCss(doc, view);
  rewriteInlineCarriers(root);
  ensureMathRules(doc);

  const { numbers } = numberEquations(root, view);
  resolveReferences(root, view, references, numbers);

  // After the references: a `\eqref` inside a formula is filled in the copy
  // too, so breaking again does not empty it.
  for (const math of displays) originals.set(math, math.cloneNode(true) as Element);
  const measurer = domMeasurer(root);
  const { broken, overflowed } = breakEquations(root, { measurer });

  const disconnect = options.reflow === false ? () => {} : reflow(displays, root);
  return { equations: numbers, broken, overflowed, disconnect };
}

/**
 * Put a rewritten copy of the author's CSS after the original, and return the
 * references it asks the engine to fill. Screen media, as the reader sees.
 */
async function insertScreenCss(doc: Document, view: Window): Promise<Reference[]> {
  doc.getElementById(SCREEN_CSS_ID)?.remove();
  const css = await collectCss(doc, (media) => media === null || media.trim() === "" || view.matchMedia(media).matches);
  const { css: rewritten, references } = rewriteReferences(css);
  if (references.length === 0 && !/math-number/.test(css)) return references;

  const style = doc.createElement("style");
  style.id = SCREEN_CSS_ID;
  style.textContent = `${carrierRegistrations()}\n${rewriteCarriers(rewritten)}`;
  doc.head.append(style);
  return references;
}

/** `<math style="math-number: yes">`, which a sheet's rewrite cannot see. */
function rewriteInlineCarriers(root: Element): void {
  for (const el of root.querySelectorAll("[style*='math-number']")) {
    const style = el.getAttribute("style") ?? "";
    if (style.includes("--x-math-number")) continue;
    el.setAttribute("style", rewriteCarriers(`x{${style}}`).slice(2, -1));
  }
}

/**
 * Fill every reference under `root`. Equations come from M4's count, every
 * other counter from one walk of the document, as stage 5 has them per page;
 * the walk is paid for only when a reference asks for another counter.
 */
function resolveReferences(
  root: Element,
  view: Window,
  references: readonly Reference[],
  equations: Map<string, number>,
): void {
  if (references.length === 0) return;
  const counterOf = new Map<string, CounterValues>();
  if (references.some((r) => r.wants === "counter" && r.counter !== "equation")) {
    const state: CounterValues = new Map();
    // What holds the root is in scope for all of it: `body { counter-reset:
    // chapter }` numbers every chapter below.
    const chain: Element[] = [];
    for (let el: Element | null = root; el !== null; el = el.parentElement) chain.unshift(el);
    for (const el of chain) {
      const style = view.getComputedStyle(el);
      for (const [name, value] of counterOps(style.counterReset, 0)) state.set(name, value);
      for (const [name, value] of counterOps(style.counterSet, 0)) state.set(name, value);
      for (const [name, step] of counterOps(style.counterIncrement, 1)) state.set(name, (state.get(name) ?? 0) + step);
    }
    for (const [id, values] of countPage(root, view, state).atId) counterOf.set(id, values);
  }
  for (const [id, value] of equations) counterOf.set(id, new Map(counterOf.get(id)).set("equation", value));
  applyReferences(root as HTMLElement, references, new Map(), counterOf, root);
}

/** Each display as it was before it was first broken. */
const originals = new WeakMap<Element, Element>();

/** Put a display back as it was before it was broken, if it ever was. */
function restore(math: Element): void {
  const original = originals.get(math);
  if (original === undefined) return;
  math.replaceChildren(...[...original.cloneNode(true).childNodes]);
  math.removeAttribute(MATH_ROWS);
  const wrapper = math.parentElement;
  if (wrapper?.classList.contains(EQ_CLASS) === true) wrapper.removeAttribute("data-rows");
}

/**
 * Break displays again when what holds them changes width.
 *
 * One observer, on each display's container; a change is handled once per
 * frame, all the displays in a container together. Breaking cannot change a
 * container's width unless the container is sized by its content, and then
 * the display is laid out again to the same result, so this settles.
 */
function reflow(displays: readonly Element[], root: Element): () => void {
  const view = root.ownerDocument.defaultView;
  if (view === null || typeof view.ResizeObserver === "undefined") return () => {};

  const byContainer = new Map<Element, Element[]>();
  for (const math of displays) {
    const container = math.parentElement;
    if (container === null) continue;
    byContainer.set(container, [...(byContainer.get(container) ?? []), math]);
  }
  const widths = new Map<Element, number>();
  const changed = new Set<Element>();
  let frame = 0;

  const rebreak = (): void => {
    frame = 0;
    const measurer = domMeasurer(root);
    for (const container of changed) {
      if (!container.isConnected) continue;
      for (const math of byContainer.get(container) ?? []) restore(math);
      breakEquations(container, { measurer });
    }
    changed.clear();
  };

  const observer = new view.ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentBoxSize[0]?.inlineSize ?? entry.contentRect.width;
      const before = widths.get(entry.target);
      widths.set(entry.target, width);
      // The first report is the width the displays were just broken for.
      if (before === undefined || Math.abs(before - width) < 0.5) continue;
      changed.add(entry.target);
    }
    if (changed.size > 0 && frame === 0) frame = view.requestAnimationFrame(rebreak);
  });
  for (const container of byContainer.keys()) observer.observe(container);

  return () => {
    observer.disconnect();
    if (frame !== 0) view.cancelAnimationFrame(frame);
  };
}

/** `window.FolioMath`: what the script tag reads (`doc/math-drop-in.md`). */
export type MathConfig = MathOptions & {
  /** Typeset on load. Default true. */
  auto?: boolean;
  /** The element, or a selector for it. Default `body`. */
  content?: Element | string;
  after?: (result: MathOnScreen) => void | Promise<void>;
};

declare global {
  interface Window {
    FolioMath?: MathConfig;
  }
}

/**
 * What the script tag does: wait for the document, then `prepare` the root
 * (the TeX drop-in converts its TeX there) and typeset it.
 *
 * Not beside the paginator: that numbers and breaks the same formulas, and
 * a second count on top of it is wrong where it is not merely wasted.
 */
export function installMath(
  win: Window,
  prepare: (root: Element) => void | Promise<void> = () => {},
): Promise<MathOnScreen | null> {
  const config = win.FolioMath ?? {};
  if (config.auto === false) return Promise.resolve(null);
  const doc = win.document;
  const loaded =
    doc.readyState === "loading"
      ? new Promise<void>((resolve) => doc.addEventListener("DOMContentLoaded", () => resolve(), { once: true }))
      : Promise.resolve();
  return loaded.then(async () => {
    if ((win as { Paged?: unknown }).Paged !== undefined) {
      console.warn("folio: the math drop-in does nothing beside the paginator, which does its work");
      return null;
    }
    const content = config.content ?? doc.body;
    const root = typeof content === "string" ? doc.querySelector(content) : content;
    if (root === null) throw new Error(`folio: no element matches ${content as string}`);
    await prepare(root);
    const options: MathOptions = {};
    if (config.mathFont !== undefined) options.mathFont = config.mathFont;
    if (config.reflow !== undefined) options.reflow = config.reflow;
    const result = await folioMath(root, options);
    await config.after?.(result);
    return result;
  });
}
