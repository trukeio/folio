/**
 * Named strings that hold an element (`doc/math.md` §6, M4.5).
 *
 * It lives here rather than in `src/math/` — where `math.md` §2 files it —
 * because `content(element)` is a GCPM carrier like the rest of `strings.ts`,
 * and nothing in it is about mathematics except the reason it exists.
 *
 * `string-set` stringifies, and `textContent` on a formula yields a row of
 * stray letters and digits — `a2+b2=c2` — which is worse than omitting it. So
 * `content(element)` clones the subtree instead, and a named string can hold a
 * node rather than a string.
 *
 * The clone is deep, keeps `alttext`, `annotation` and `intent` — the three
 * attributes §7 says must survive every stage — and loses its ids, so the
 * original stays the unique target of every reference. The same mechanism
 * serves `target-text()` on a chapter title that contains math.
 *
 * Deletion condition: none. `content(element)` is a GCPM feature browsers do
 * not implement and show no sign of implementing; this is the polyfill.
 */
import { carrierName } from "./css/rewrite.js";
import type { StringScope } from "./strings.js";
import { supports } from "./native.js";
import type { Deletion } from "./native.js";

/** The clones a page assigns, in the three scopes `string()` can ask for. */
export type CarriedElements = {
  start: Map<string, Element>;
  first: Map<string, Element>;
  last: Map<string, Element>;
};

/** Does this `string-set` value ask for the element rather than its text? */
const WANTS_ELEMENT = /content\(\s*element\s*\)/;

/**
 * A deep clone safe to place in a margin box. Ids go: the original is the
 * reference target, and a running head on forty pages would otherwise put
 * forty elements with one id in the document — which is how `target-counter()`
 * starts resolving to a margin box.
 */
export function cloneForCarry(el: Element): Element {
  const clone = el.cloneNode(true) as Element;
  clone.removeAttribute("id");
  for (const nested of clone.querySelectorAll("[id]")) nested.removeAttribute("id");
  // A carried formula sits in running-head text; one `math-depth` step down
  // keeps it from towering over it (§6).
  for (const math of clone.querySelectorAll("math")) {
    math.setAttribute("style", `${math.getAttribute("style") ?? ""};math-depth: add(1)`);
  }
  return clone;
}

/**
 * Collect the elements a page carries into named strings. `carried` is updated
 * in place, as `collectPageStrings` does with text, so a carried element
 * survives the pages between one chapter heading and the next.
 */
export function collectCarriedElements(
  page: Element,
  carried: Map<string, Element>,
  view: Window,
): CarriedElements {
  const start = new Map(carried);
  const first = new Map<string, Element>();
  const last = new Map<string, Element>();
  const property = carrierName("string-set");

  for (const el of page.querySelectorAll("*")) {
    const declaration = view.getComputedStyle(el).getPropertyValue(property).trim();
    if (declaration === "" || !WANTS_ELEMENT.test(declaration)) continue;

    for (const name of namesWantingElement(declaration)) {
      const clone = cloneForCarry(el);
      if (!first.has(name)) first.set(name, clone);
      last.set(name, clone);
      carried.set(name, clone);
    }
  }

  return { start, first, last };
}

/** Which names in a `string-set` declaration were assigned `content(element)`;
 * the rest are ordinary strings and `strings.ts` has them. */
function namesWantingElement(declaration: string): string[] {
  const out: string[] = [];
  for (const part of declaration.split(",")) {
    const trimmed = part.trim();
    const space = trimmed.search(/\s/);
    if (space === -1) continue;
    if (!WANTS_ELEMENT.test(trimmed.slice(space + 1))) continue;
    out.push(trimmed.slice(0, space).trim());
  }
  return out;
}

/**
 * One `string(name, scope)` as an element, if that name holds one. The scopes
 * mean what they do for text, so `string(title, first-except)` behaves the
 * same whether the title contains math or not.
 */
export function resolveCarriedElement(
  name: string,
  scope: StringScope,
  carried: CarriedElements,
): Element | undefined {
  switch (scope) {
    case "start":
      return carried.start.get(name);
    case "last":
      return carried.last.get(name) ?? carried.start.get(name);
    case "first-except":
      return carried.first.has(name) ? undefined : carried.start.get(name);
    default:
      return carried.first.get(name) ?? carried.start.get(name);
  }
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "content(element)",
  files: ["carry.ts"],
  feature: "`content(element)` carried into margin boxes",
  when: "Never planned by any browser: this is the implementation",
  tests: [],
  untested: "No browser implements or plans `content(element)`, and WPT has no test of it",
  native: () => supports("string-set", "title content(element)"),
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
