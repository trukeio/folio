/**
 * Equation numbers and the references that point at them (`doc/math.md` §5).
 *
 * `mlabeledtr` is not in MathML Core and is not coming, so the number goes
 * beside the math, in a three-column grid that keeps the formula optically
 * centred however wide the number gets. A right-floated number centres the
 * *remaining* space instead, so equations visibly shift left as numbers reach
 * two digits.
 *
 * Who counts, and why it is us. §5 writes the number with `counter(equation)`
 * and lets the browser count. That breaks on a book: a formula carried into a
 * running head (§6) is a *clone*, and a clone carrying `counter-increment`
 * advances the counter in the document the pages are built in, shifting every
 * number after it. So the engine counts — by reading the author's own
 * `counter-reset` and `counter-increment` back through the browser's cascade
 * (rung P, `plan.md` §5), not by inventing a rule. The reset point still comes
 * from the stylesheet, which is `math.md` §10 Q4's answer, and what is printed
 * is what a reference resolves to, because both read the same attribute.
 */
import { SOURCE_PATH, SPLIT_FROM } from "../compose.js";
import { readCarrier } from "../css/rewrite.js";
import type { Measurer } from "../types.js";
import type { Deletion } from "../native.js";

export const EQ_CLASS = "x-eq";
export const EQ_NUM_CLASS = "x-eq-num";
/** Where the engine's count lands. `target-counter()` resolves from this. */
export const COUNTER_ATTR_PREFIX = "data-x-counter-";
export const EQ_COUNTER = "equation";
/** `math-number: "(7a)"`: a label the author gives, printed whole, not counted. */
export const EQ_LABEL = "data-x-eq-label";

const STYLE_ID = "folio-math-rules";

/** The attribute a counter's value is written into. */
export const counterAttribute = (name: string): string => `${COUNTER_ATTR_PREFIX}${name}`;

/** Default presentation for the parts we generate, thin on purpose: this is
 * what a reader gets if the author styles nothing. */
export function ensureMathRules(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.${EQ_CLASS} {
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  counter-increment: ${EQ_COUNTER}; break-inside: avoid;
}
/* nowrap: Firefox underestimates a display formula's max-content width (a
   large operator measured at text size) and then wraps the formula inside its
   own grid track — the fraction after a sum lands on a second line. */
.${EQ_CLASS} > math { grid-column: 2; white-space: nowrap }
.${EQ_CLASS}[data-rows] { align-items: end }
/* The gutters are 1fr tracks, so they take half the free space each; the
   number inside sits at the margin and keeps its own width. Without that, the
   *track* is what a measurement of the gutter returns, and the formula is
   judged against the room left after two tracks that only exist because it is
   narrow — which broke a three-symbol equation in two. */
.${EQ_NUM_CLASS} { white-space: nowrap; inline-size: max-content }
.${EQ_NUM_CLASS}:first-child { justify-self: start }
.${EQ_NUM_CLASS}:last-child { justify-self: end }
.${EQ_NUM_CLASS}:last-child::after { content: "(" attr(${counterAttribute(EQ_COUNTER)}) ")" }
.${EQ_CLASS}[${EQ_LABEL}] { counter-increment: none }
.${EQ_CLASS}[${EQ_LABEL}] > .${EQ_NUM_CLASS}:last-child::after { content: attr(${counterAttribute(EQ_COUNTER)}) }
.${EQ_CLASS}[data-num-side="left"] .${EQ_NUM_CLASS}:first-child::after {
  content: "(" attr(${counterAttribute(EQ_COUNTER)}) ")";
}
.${EQ_CLASS}[data-num-side="left"] .${EQ_NUM_CLASS}:last-child::after { content: none }
.${EQ_CLASS}[${EQ_LABEL}][data-num-side="left"] > .${EQ_NUM_CLASS}:first-child::after {
  content: attr(${counterAttribute(EQ_COUNTER)});
}
`;
  doc.head.append(style);
}

export type NumberOptions = {
  /** The count this page continues from. */
  from?: number;
  /**
   * Honour `counter-reset` and `counter-increment` from the author's cascade:
   * exact, at one computed-style read per element, and what a page that will
   * be kept gets. The measuring box — everything that remains, on every page —
   * takes the provisional count, because it needs the number's *width* and
   * `(7)` is as wide as `(8)`.
   */
  resets?: boolean;
  /**
   * Stop at the first equation that starts below this block position.
   *
   * The measuring box holds everything that remains, on every page, and
   * asking the browser for a computed style per equation in it is §11's O(n²)
   * with a large constant — four times the cost of the whole rest of the
   * engine on a sixty-section book. Nothing below the page can change where
   * the page breaks, so the walk stops there; the next page starts higher up
   * and sees what this one skipped.
   */
  until?: { measurer: Measurer; limit: number };
};

/** Wrap every equation the author marked for numbering. Idempotent. */
export function prepareEquations(
  root: Element,
  view: Window,
  until?: { measurer: Measurer; limit: number },
): Element[] {
  const wrappers: Element[] = [];
  for (const math of root.querySelectorAll("math")) {
    if (until !== undefined && until.measurer.box(math).blockStart > until.limit) break;
    const value = readCarrier(math, "math-number", view);
    if (!["", "no", "none"].includes(value.toLowerCase())) wrappers.push(wrap(math, /^(["'])(.*)\1$/.exec(value)?.[2]));
  }
  return wrappers;
}

/**
 * Number the equations in `root`, continuing from `from`, and write the count
 * where CSS and stage 5 can both read it. Returns each numbered equation's id
 * and number — what the M4 exit check reads — and where the next page
 * continues from.
 */
export function numberEquations(
  root: Element,
  view: Window,
  { from = 0, resets = true, until }: NumberOptions = {},
): { numbers: Map<string, number>; last: number } {
  const wrappers = new Set(prepareEquations(root, view, until));
  const numbers = new Map<string, number>();
  if (wrappers.size === 0) return { numbers, last: from };

  let value = from;
  // One walk of the page in order, carrying the counter. Scoping is flat: a
  // reset anywhere sets the value from there on, which is what CSS does for
  // the shallow uses that number equations (a reset on each chapter) and not
  // for nested scopes, which wait for custom counters in M6. A reset on an
  // earlier page is not in this page's DOM, and does not need to be: `from`
  // already carries its effect.
  for (const el of resets ? root.querySelectorAll("*") : wrappers) {
    if (resets) {
      const style = view.getComputedStyle(el);
      // A continuation carries its reset, as `counters.ts` has it: a `body'`
      // or a `<section>` continued on this page did not open a new scope here.
      const reset = el.hasAttribute(SPLIT_FROM) ? null : counterValue(style.counterReset, EQ_COUNTER, 0);
      if (reset !== null) value = reset;
      const set = counterValue(style.counterSet, EQ_COUNTER, 0);
      if (set !== null) value = set;
      const step = counterValue(style.counterIncrement, EQ_COUNTER, 1);
      const isWrapper = wrappers.has(el);
      // Our own stylesheet increments on the wrapper. If it is missing — a
      // document composed before `ensureMathRules` ran — every equation would
      // otherwise take the same number, which is the one failure here that
      // produces confidently wrong output rather than none.
      value += step ?? (isWrapper && !el.hasAttribute(EQ_LABEL) ? 1 : 0);
      if (!isWrapper) continue;
    } else if (!el.hasAttribute(EQ_LABEL)) {
      value += 1;
    }

    const shown = el.getAttribute(EQ_LABEL) ?? String(value);
    el.setAttribute(counterAttribute(EQ_COUNTER), shown);
    // On the gutters too: `attr()` reads the element it is on, and the number
    // is drawn by the gutter's `::after`. Without this it printed "()".
    for (const gutter of el.querySelectorAll(`:scope > .${EQ_NUM_CLASS}`)) {
      gutter.setAttribute(counterAttribute(EQ_COUNTER), shown);
    }
    const math = el.querySelector("math");
    math?.setAttribute(counterAttribute(EQ_COUNTER), shown);
    for (const id of [el.id, math?.id]) {
      if (id !== undefined && id !== "" && shown === String(value)) numbers.set(id, value);
    }
  }

  return { numbers, last: value };
}

/** The grid of §5, or the one already there. Whether an equation is numbered
 * is the author's, through the §5 carrier, so any selector the browser can
 * cascade chooses, and we never parse one. */
function wrap(math: Element, label: string | undefined): Element {
  const parent = math.parentElement;
  if (parent !== null && parent.classList.contains(EQ_CLASS)) return parent;

  const doc = math.ownerDocument;
  const wrapper = doc.createElement("folio-equation");
  wrapper.className = EQ_CLASS;
  if (label !== undefined) wrapper.setAttribute(EQ_LABEL, label);
  const left = doc.createElement("folio-equation-number");
  left.className = EQ_NUM_CLASS;
  // Only one of the two gutters is ever filled, and the empty one must not be
  // announced. Both exist at all times so the geometry does not change when
  // the side does.
  left.setAttribute("aria-hidden", "true");
  const right = doc.createElement("folio-equation-number");
  right.className = EQ_NUM_CLASS;

  // The wrapper stands where the equation stood, so it answers for it: a break
  // on an element with no source stamp maps back through its nearest stamped
  // *ancestor* — the article, a position before everything — so the page could
  // not advance and the rest of the book landed on one page.
  const stamp = math.getAttribute(SOURCE_PATH);
  if (stamp !== null) wrapper.setAttribute(SOURCE_PATH, stamp);

  math.replaceWith(wrapper);
  wrapper.append(left, math, right);
  return wrapper;
}

/** One counter's value out of a computed `counter-*` list (`name value …`), or
 * null when the list does not mention it. */
function counterValue(list: string, name: string, fallback: number): number | null {
  if (list === "" || list === "none") return null;
  const parts = list.trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== name) continue;
    const next = Number.parseInt(parts[i + 1] ?? "", 10);
    return Number.isFinite(next) ? next : fallback;
  }
  return null;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "equation numbers",
  files: ["math/number.ts"],
  feature: "Equation numbers in a gutter, standing in for `mlabeledtr`",
  when: "An `mlabeledtr` replacement is specified and shipped",
  tests: [],
  untested: "No specification to test against yet (`math.md` §5)",
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
