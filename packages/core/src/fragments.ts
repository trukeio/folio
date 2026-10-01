/**
 * What a fragment of an element looks like (`doc/plan.md` §4, M6).
 *
 * Composition cuts an element in two and clones it onto both pages
 * (`compose.ts`). A clone is a whole element to the browser: it has both its
 * borders, both its paddings, its `::before`, its `::after`, its list marker
 * and its first-line indent — on *both* pages. CSS Break 3 says a fragment has
 * none of that at the break. This file is the difference, applied as rules the
 * browser cascades plus a few stamps it cannot compute for itself.
 *
 * **`box-decoration-break`** (CSS Break 3 §5.4). The initial value is `slice`:
 * the box is laid out as if unbroken and cut, so the fragment before a break
 * has no block-end margin, padding or border and the one after it has none at
 * its block start. `clone` wraps every fragment in all three, and a cloned
 * margin at the top of a page is then `margin-break`'s to keep or truncate. The
 * clone *was* the behaviour until now, for every element, which is wrong for
 * the default and was also a way to overflow: a candidate measures to where
 * the ink stops (`candidates.ts`), and a split box that then draws its
 * block-end padding and border under that ink is taller than the break that
 * chose it. Inline boxes slice on the inline axis, for the same reason.
 *
 * **Generated content and first-fragment pseudo-elements** (§5.4 again, and
 * CSS Pseudo 4). `::before` belongs to the first fragment and `::after` to the
 * last; `::first-line`, `::first-letter`, the list marker and `text-indent`
 * belong to the first line, which is on an earlier page. A continued paragraph
 * that indents its first line on the new page reads as a new paragraph, and a
 * drop cap on its second half is plainly wrong. Paged.js hard-codes the same
 * rules (`paged.polyfill.js:28388`–`28426`).
 *
 * **`margin-break`** (CSS Break 4 §5.2). `auto` truncates a margin adjoining an
 * unforced break and *keeps* one after a forced break; `keep` never truncates
 * and `discard` always does. The engine truncated after every break, forced or
 * not, which is what Paged.js does too and is not what either spec or
 * Chromium's own print layout does: a chapter heading that opens a new page
 * with 3em above it is the author asking for 3em of white space.
 *
 * None of this decides a break. Every rule here is applied to the measuring
 * box as well as to the page, so a break is chosen against the fragment that
 * will be shown; the one thing the measuring box cannot know — which elements
 * the break it has not yet chosen will cut — only ever removes decoration, so
 * the page comes out shorter than measured, never taller. `clone` is the
 * exception, and the page is re-measured and re-broken for it the same way a
 * footnote area that grew is (`paginate.ts`).
 *
 * **Delete when** browsers fragment paged media natively. The WPT tests that
 * say so are the `css/css-break/*-print` ones, which `wpt.mjs --folio` runs
 * against this engine; the multicol `box-decoration-break-*` reftests exercise
 * the browser's own fragmenter, and are what `native-support.md` measures.
 */
import { CHAIN, SPLIT_FROM, SPLIT_TO } from "./compose.js";
import { carrierName } from "./css/rewrite.js";
import { ensureFurnitureRules } from "./furniture.js";
import { repeatTableParts, sourceOf } from "./tables.js";
import type { Deletion } from "./native.js";
import type { FragmentIndex } from "./nth-fragment.js";

const FRAGMENT_STYLE_ID = "folio-fragment-rules";

/**
 * On a content area or measuring box: the page does not start the flow. The
 * value says how it started — `""` after an unforced break, `"forced"` after
 * a forced one — because `margin-break: auto` treats the two differently.
 */
export const CONTINUED = "data-folio-continued";
/** Which edges of a fragment lose their decoration, as tokens. */
export const FRAGMENT = "data-folio-fragment";
/** An element's `margin-break`, where it is not `auto`. */
export const MARGIN_BREAK = "data-folio-margin-break";

/**
 * How deep the chain of first children runs.
 *
 * A margin at the start of a fragmentainer is truncated, and it is the whole
 * chain of first children, not the outermost box, because margins collapse.
 * Zeroing the margin of a continued `<section>` does nothing while the `<p>`
 * inside it still has 18px: that margin collapses *through* the section and
 * reappears above it. A corpus page lost 18px at the top and two lines at the
 * foot to exactly this, on every page of eight fixtures. The chain is as deep
 * as `candidates.ts` walks, for the same reason: past that depth the engine
 * has already stopped reasoning about the boxes — eight levels of content,
 * and four for the root chain above it (`folio-root > html > body`, and a
 * source root below `body`).
 */
const FIRST_CHAIN_DEPTH = 12;

const chain = (continued: string, last: string): string =>
  Array.from(
    { length: FIRST_CHAIN_DEPTH },
    (_, i) => `[${CONTINUED}=${continued}]${" > :first-child".repeat(i)} > :first-child${last}`,
  ).join(",\n");

const has = (token: string): string => `[${FRAGMENT}~="${token}"]`;

/**
 * The fragmentation rules the browser cannot apply for us.
 *
 * The counter rule is the whole of "custom counters across pages" for content
 * the browser renders. Every page is built in the same document, in order, so
 * the browser's own counting already carries a counter from page to page —
 * `counter(chapter)` on page 40 sees the increments on pages 1 to 39, because
 * they are all still there above it. What composition breaks is the other
 * half: a fragment is not a new element. A paragraph split across a break is
 * one paragraph, and incrementing on the continuation numbers it twice. So
 * does a repeated table header (`tables.ts`), which is the same source row put
 * back on a later fragment. `counter-reset` is *not* suppressed here, because
 * suppressing it only moves the restart — the instance page 1 created is not
 * in scope on page 2 either way. `counters.ts` rewrites it to the value the
 * counter had when the page broke, which is the only thing that continues it.
 */
export function ensureFragmentRules(target: Document): void {
  // First, because it is the first thing any measurement calls: a custom
  // element with no display is inline, and a page measured inline is wrong.
  ensureFurnitureRules(target);
  if (target.getElementById(FRAGMENT_STYLE_ID) !== null) return;

  const style = target.createElement("style");
  style.id = FRAGMENT_STYLE_ID;
  style.textContent = `
${chain('""', `:not([${MARGIN_BREAK}="keep"])`)} { margin-block-start: 0 !important }
${chain('"forced"', `[${MARGIN_BREAK}="discard"]`)} { margin-block-start: 0 !important }

[${SPLIT_FROM}],
[data-folio-repeated],
[data-folio-repeated] * {
  counter-set: none !important;
  counter-increment: none !important;
}

${has("block-start")} {
  margin-block-start: 0 !important;
  padding-block-start: 0 !important;
  border-block-start-width: 0 !important;
  border-start-start-radius: 0 !important;
  border-start-end-radius: 0 !important;
}
${has("block-end")} {
  margin-block-end: 0 !important;
  padding-block-end: 0 !important;
  border-block-end-width: 0 !important;
  border-end-start-radius: 0 !important;
  border-end-end-radius: 0 !important;
}
${has("inline-start")} {
  margin-inline-start: 0 !important;
  padding-inline-start: 0 !important;
  border-inline-start-width: 0 !important;
  border-start-start-radius: 0 !important;
  border-end-start-radius: 0 !important;
}
${has("inline-end")} {
  margin-inline-end: 0 !important;
  padding-inline-end: 0 !important;
  border-inline-end-width: 0 !important;
  border-start-end-radius: 0 !important;
  border-end-end-radius: 0 !important;
}
${has("text")} { text-indent: 0 !important }

[${SPLIT_FROM}]::before { content: none !important }
[${SPLIT_TO}]::after { content: none !important }
li[${SPLIT_FROM}] { list-style: none !important }
/* Not on the root chain (compose.ts), continued on every page after the
   first: a ::first-line or ::first-letter box there, even one that changes
   nothing, moved the first line's glyphs by a pixel in Chromium (WPT
   page-rule-specificity-001, page-name-002). */
[${SPLIT_FROM}]:not([${CHAIN}])::first-line,
[${SPLIT_FROM}]:not([${CHAIN}])::first-letter {
  font: inherit !important;
  color: inherit !important;
  background: none !important;
  letter-spacing: inherit !important;
  word-spacing: inherit !important;
  text-transform: inherit !important;
  text-decoration: inherit !important;
}
[${SPLIT_FROM}]:not([${CHAIN}])::first-letter {
  float: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  line-height: inherit !important;
  vertical-align: baseline !important;
  initial-letter: normal !important;
}
`;
  target.head.append(style);
}

/**
 * Everything a composed fragment needs before it is measured.
 *
 * One entry point, so that the measuring box and the page are finished by the
 * same code: a rule applied to one and not the other is a break chosen against
 * a page that will not exist, which is the mistake this engine has made most
 * often.
 */
export function finishFragments(root: HTMLElement, source: Element, nth: FragmentIndex | null = null): void {
  repeatTableParts(root, source);
  // After the repeated table parts, which are fragments too (`nth-fragment.ts`).
  nth?.stamp(root);
  continueLists(root, source);
  decorateFragments(root);
}

/**
 * Number a continued ordered list from where it broke.
 *
 * A list's numbers are not counters the engine can carry (`counters.ts`):
 * Chromium numbers `<li>` by its own ordinal and does not report the list's
 * implicit `counter-reset` at all, and neither engine reports the implicit
 * `list-item` increment. So the clone of a list continued on a later page
 * began again at 1 on both. The `start` attribute is what both number from,
 * and the source says what it should be: the ordinal of the first item on
 * this page — the split one, whose marker is hidden but which still counts.
 */
function continueLists(root: HTMLElement, source: Element): void {
  for (const list of root.querySelectorAll(`ol[${SPLIT_FROM}]`)) {
    const first = list.querySelector(":scope > li");
    const original = first === null ? null : sourceOf(first, source);
    if (original === null) continue;
    list.setAttribute("start", String(ordinalOf(original)));
  }
}

/** The number HTML gives an `<li>`: `start`, `reversed` and `value` included. */
function ordinalOf(item: Element): number {
  const list = item.parentElement;
  if (list === null) return 1;
  const items = [...list.children].filter((c) => c.localName === "li");
  const reversed = list.hasAttribute("reversed");
  const start = Number.parseInt(list.getAttribute("start") ?? "", 10);
  let n = Number.isFinite(start) ? start : reversed ? items.length : 1;
  n += reversed ? 1 : -1;
  for (const li of items) {
    const value = Number.parseInt(li.getAttribute("value") ?? "", 10);
    n = Number.isFinite(value) ? value : n + (reversed ? -1 : 1);
    if (li === item) break;
  }
  return n;
}

/**
 * Stamp the fragments the rules above apply to.
 *
 * Which edge loses its decoration depends on the computed `display` and on
 * `box-decoration-break`, and neither can be selected on in CSS; the stamps
 * are the answer written where a selector can see it. The reads come first
 * and the writes after, so the stamps cost one style resolution per page
 * rather than one per element.
 */
export function decorateFragments(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  if (view === null) return;

  const split = [...root.querySelectorAll(`[${SPLIT_FROM}],[${SPLIT_TO}]`)];
  const reads = split.map((el) => {
    const style = view.getComputedStyle(el);
    return { display: style.display, slice: !clones(style) };
  });

  // The paragraph whose text runs on is the deepest split block: the split
  // elements are the ancestors of one position, so the last block among them
  // in document order is the innermost.
  // A loop, not `forEach`: TypeScript does not follow an assignment made in a
  // callback, and reads `text` as permanently null after one.
  let text: Element | null = null;
  const tokens: string[][] = [];
  for (let i = 0; i < split.length; i++) {
    const el = split[i] as Element;
    const { display, slice } = reads[i] as { display: string; slice: boolean };
    const own: string[] = [];
    tokens.push(own);
    const kind = kindOf(display);
    if (kind === null) continue;
    const from = el.hasAttribute(SPLIT_FROM);
    if (slice && from) own.push(`${kind}-start`);
    if (slice && el.hasAttribute(SPLIT_TO)) own.push(`${kind}-end`);
    if (kind === "block" && from) text = el;
  }
  if (text !== null && continuesText(text, view)) tokens[split.indexOf(text)]?.push("text");

  split.forEach((el, i) => {
    const own = tokens[i] ?? [];
    if (own.length > 0) el.setAttribute(FRAGMENT, own.join(" "));
  });

  if (root.hasAttribute(CONTINUED)) stampMarginBreak(root, view);
}

/** Does this element ask for its decoration on every fragment? */
function clones(style: CSSStyleDeclaration): boolean {
  const value = (property: string): string =>
    style.getPropertyValue(carrierName(property)).trim().toLowerCase();
  return value("box-decoration-break") === "clone" || value("-webkit-box-decoration-break") === "clone";
}

/**
 * Which axis a split box is cut on. A table's internal boxes are not cut by
 * this — a row split across a page is `tables.ts`'s — and a box with no box of
 * its own has nothing to slice.
 */
function kindOf(display: string): "block" | "inline" | null {
  if (display === "inline") return "inline";
  if (display === "none" || display === "contents" || display.startsWith("table-")) return null;
  return "block";
}

/**
 * Does the page begin in the middle of this block's text, rather than at a
 * block child of it? Only then is the first line on the page not a first
 * line: a `<section>` continued at its third `<p>` begins a fresh paragraph,
 * and that paragraph's indent is the author's.
 *
 * `text-indent` is inherited, which is why the answer matters: stamping the
 * section would take the indent off every paragraph in it.
 */
function continuesText(block: Element, view: Window): boolean {
  for (const child of block.childNodes) {
    if (child.nodeType === 3) {
      if ((child.textContent ?? "").trim() !== "") return true;
      continue;
    }
    if (child.nodeType !== 1) continue;
    return view.getComputedStyle(child as Element).display.startsWith("inline");
  }
  return false;
}

/**
 * Write `margin-break` where the chain of first children can see it.
 *
 * A running element or a footnote at the head of the chain leaves the flow
 * after this runs, and the chain then continues at its next sibling — so the
 * siblings are stamped too, until one stays.
 */
function stampMarginBreak(root: Element, view: Window): void {
  let level: Element | null = root;
  // Below a box that its first child's margin cannot collapse through, the
  // chain no longer adjoins the break, and its margins are ordinary ones.
  let sealed = false;
  for (let depth = 0; level !== null && depth < FIRST_CHAIN_DEPTH; depth++) {
    let next: Element | null = null;
    for (let child: Element | null = level.firstElementChild; child !== null; child = child.nextElementSibling) {
      const style = view.getComputedStyle(child);
      const value = style.getPropertyValue(carrierName("margin-break")).trim().toLowerCase();
      if (sealed) child.setAttribute(MARGIN_BREAK, "keep");
      else if (value === "keep" || value === "discard") child.setAttribute(MARGIN_BREAK, value);
      const leaves =
        style.getPropertyValue(carrierName("position")).trim() === "running" ||
        style.getPropertyValue(carrierName("float")).trim() === "footnote";
      if (!leaves) {
        next = child;
        sealed ||= seals(style);
        break;
      }
    }
    level = next;
  }
}

/**
 * Does a box keep its first child's top margin from collapsing through it?
 *
 * A new block formatting context does, and so does a top border or padding
 * on this page (a sliced continuation has neither). Truncating past one took
 * the margin off a `flow-root`'s first child at the top of a page, where
 * Chromium prints it (WPT `page-margin-007`'s reference).
 */
function seals(style: CSSStyleDeclaration): boolean {
  const display = style.display;
  return (
    /(^|\s)(flow-root|flex|grid|table|inline-block|inline-flex|inline-grid)(\s|$)/.test(display) ||
    !/^(visible|clip)$/.test(style.overflowY) ||
    style.float !== "none" ||
    /^(absolute|fixed)$/.test(style.position) ||
    /\b(layout|paint|strict|content)\b/.test(style.contain) ||
    style.columnCount !== "auto" ||
    style.columnWidth !== "auto" ||
    parseFloat(style.paddingBlockStart) > 0 ||
    parseFloat(style.borderBlockStartWidth) > 0
  );
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "fragments",
  files: ["fragments.ts"],
  feature: "The rules of a fragment: `box-decoration-break`, `margin-break`, what a continuation draws",
  when: "Browsers fragment paged media natively, and the `box-decoration-break` reftests pass in print",
  tests: [/^css\/css-break\/box-decoration-break-/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
