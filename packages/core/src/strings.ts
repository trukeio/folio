/**
 * Named strings and running elements (`doc/plan.md` §4, GCPM 3).
 *
 * `string-set: title content()` on a heading, `string(title)` in a margin box:
 * the running head that names the chapter you are reading. Both properties are
 * dropped by browsers, so both arrive here through the carriers of §5 — the
 * engine never cascades them, it only reads what the browser decided.
 *
 * The part that is ours is the part that is about pages. A named string has a
 * different value at the start of a page, at its first assignment on that page
 * and at its last, and which one a margin box wants is an argument to
 * `string()`. Nothing in a stylesheet can compute that, because nothing in a
 * stylesheet knows where the page ended.
 */
import { carrierName } from "./css/rewrite.js";
import { collectCarriedElements } from "./carry.js";
import type { CarriedElements } from "./carry.js";
import { counterOps } from "./counters.js";
import type { CounterValues, CounterWalk } from "./counters.js";
import { formatCounter } from "./page-template.js";
import { supports } from "./native.js";
import type { Deletion } from "./native.js";

/** Which value of a named string a `string()` call asks for. */
export type StringScope = "first" | "last" | "start" | "first-except";

/** The values a named string takes over one page. */
export type PageStrings = {
  /** In effect when the page began — the last value from earlier pages. */
  start: Map<string, string>;
  /** First assignment on this page, if any. */
  first: Map<string, string>;
  /** Last assignment on this page, if any. */
  last: Map<string, string>;
};

/**
 * Parse `string-set: title content(), subtitle "x"` into name/value pairs.
 *
 * `content()` means the element's own text — which is why this takes the
 * element: `textContent` is the value the author asked for, and the reason
 * §7 notes that carrying *math* into a running head needs `content(element)`
 * instead, since text content destroys a formula.
 */
export function parseStringSet(
  value: string,
  el: Element,
  generated: { before?: string; after?: string } = {},
): [string, string][] {
  const out: [string, string][] = [];

  for (const part of splitTopLevel(value, ",")) {
    const trimmed = part.trim();
    if (trimmed === "" || trimmed === "none") continue;

    const space = trimmed.search(/\s/);
    if (space === -1) continue;
    const name = trimmed.slice(0, space).trim();
    const expression = trimmed.slice(space + 1).trim();
    if (name === "") continue;

    out.push([name, evaluateStringValue(expression, el, generated)]);
  }
  return out;
}

function evaluateStringValue(
  expression: string,
  el: Element,
  generated: { before?: string; after?: string },
): string {
  let out = "";
  const re = /"([^"]*)"|'([^']*)'|content\(\s*([\w-]*)\s*\)|attr\(\s*([\w-]+)\s*\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(expression)) !== null) {
    if (m[1] !== undefined) out += m[1];
    else if (m[2] !== undefined) out += m[2];
    else if (m[3] !== undefined) {
      // content(), content(text) and content(contents) are the element's text;
      // content(before) and content(after) the pseudo-elements' generated
      // text, which is not in the DOM and is worked out by `generatedText`.
      out += m[3] === "before" || m[3] === "after" ? (generated[m[3]] ?? "") : el.textContent;
    } else if (m[4] !== undefined) {
      out += el.getAttribute(m[4]) ?? "";
    }
  }
  return out.trim();
}

/** Does a `string-set` value need a pseudo-element's generated text? */
const GENERATED = /content\(\s*(before|after)\s*\)/;

/**
 * The text a `::before` or `::after` generates, from its computed `content`.
 *
 * Strings, `attr()` and `counter()` — the last from `counters`, the engine's
 * own count at the element (`countPage`), because the browser gives back
 * `counter(chapter)` rather than `3`. The pseudo-element's own
 * `counter-reset` and `counter-increment` apply first, as they do to what it
 * prints: `h2::before { counter-increment: sec; content: counter(sec) }`.
 * Quotes, images and anything else contribute nothing, which is what they
 * contribute to a running head's text.
 */
export function generatedText(
  content: string,
  el: Element,
  counters: CounterValues,
  own: { reset?: string; increment?: string } = {},
): string {
  if (content === "none" || content === "normal" || content === "") return "";
  const values = new Map(counters);
  for (const [name, value] of counterOps(own.reset ?? "", 0)) values.set(name, value);
  for (const [name, step] of counterOps(own.increment ?? "", 1)) values.set(name, (values.get(name) ?? 0) + step);

  let out = "";
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)|counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== undefined || m[2] !== undefined) out += unescape(m[1] ?? m[2] ?? "");
    else if (m[3] !== undefined) out += el.getAttribute(m[3]) ?? "";
    else if (m[4] !== undefined) out += formatCounter(values.get(m[4]) ?? 0, m[5] ?? "decimal");
  }
  return out;
}

/** CSS string escapes: `\"`, `\\`, and `\A`-style code points. */
function unescape(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6}\s?|[^])/g, (_, esc: string) =>
    /^[0-9a-fA-F]/.test(esc) ? String.fromCodePoint(Number.parseInt(esc.trim(), 16)) : esc,
  );
}

/**
 * Collect the named strings assigned on one page, given the state it began in.
 *
 * `carried` is updated, so the caller passes the same map from page to page and
 * a string keeps its value until something reassigns it. `count` counts the
 * page, given the elements whose counters `content(before)` and
 * `content(after)` will need (`CounterWalk.page`).
 */
export function collectPageStrings(
  page: Element,
  carried: Map<string, string>,
  view: Window,
  count: (watch: ReadonlySet<Element>) => ReadonlyMap<Element, { before: CounterValues; after: CounterValues }> = () =>
    new Map(),
): PageStrings {
  const start = new Map(carried);
  const first = new Map<string, string>();
  const last = new Map<string, string>();
  const property = carrierName("string-set");

  const setters: [Element, string][] = [];
  for (const el of page.querySelectorAll("*")) {
    const declaration = view.getComputedStyle(el).getPropertyValue(property).trim();
    if (declaration !== "") setters.push([el, declaration]);
  }
  const at = count(new Set(setters.filter(([, d]) => GENERATED.test(d)).map(([el]) => el)));

  for (const [el, declaration] of setters) {
    const generated: { before?: string; after?: string } = {};
    const counters = at.get(el);
    if (counters !== undefined) {
      for (const which of ["before", "after"] as const) {
        const style = view.getComputedStyle(el, `::${which}`);
        generated[which] = generatedText(style.content, el, counters[which], {
          reset: style.counterReset,
          increment: style.counterIncrement,
        });
      }
    }
    for (const [name, value] of parseStringSet(declaration, el, generated)) {
      if (!first.has(name)) first.set(name, value);
      last.set(name, value);
      carried.set(name, value);
    }
  }

  return { start, first, last };
}

/** Resolve one `string(name, scope)` against a page's values. */
export function resolveString(
  name: string,
  scope: StringScope,
  strings: PageStrings,
): string {
  switch (scope) {
    case "start":
      return strings.start.get(name) ?? "";
    case "last":
      return strings.last.get(name) ?? strings.start.get(name) ?? "";
    case "first-except":
      // Blank on the page where the value first appears — a running head that
      // does not repeat the chapter title on the chapter's opening page.
      return strings.first.has(name) ? "" : (strings.start.get(name) ?? "");
    default:
      return strings.first.get(name) ?? strings.start.get(name) ?? "";
  }
}

/** Split on a separator that is not inside brackets or quotes. */
function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;

  for (const ch of value) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Read what a composed page says about named strings and running elements.
 *
 * A running element is taken *out of the flow* — that is what `position:
 * running()` means — so it no longer affects where the page breaks, and it is
 * kept for the margin boxes to clone. Leaving it in place would put the
 * running head in the text as well as at the top of the page.
 */
export function collectPageState(
  content: HTMLElement,
  target: Document,
  state: {
    carriedStrings: Map<string, string>;
    carriedNodes: Map<string, Element>;
    stringsPerPage: PageStrings[];
    carriedPerPage: CarriedElements[];
  },
  running: Map<string, Element>,
  counters: CounterWalk,
): void {
  const view = target.defaultView;
  if (view === null) return void counters.page(content, null);

  // Counted after the running elements are out, and before the strings are
  // read, which may need the count at an element (`content(before)`).
  takeRunningElements(content, view, running);
  state.stringsPerPage.push(
    collectPageStrings(content, state.carriedStrings, view, (watch) => counters.page(content, view, watch)),
  );
  state.carriedPerPage.push(collectCarriedElements(content, state.carriedNodes, view));
}

/**
 * Remove `position: running()` elements, keeping a copy for the margin boxes.
 *
 * This has to happen before anything is measured. A running element is not in
 * the flow — that is what the property means — so leaving it in place while
 * choosing a break measures a page that will not exist, and measuring the
 * composed page before taking it out reports an overflow that removing it
 * will fix.
 */
export function takeRunningElements(
  root: HTMLElement,
  view: Window,
  running: Map<string, Element>,
): void {
  for (const el of [...root.querySelectorAll("*")]) {
    const value = view.getComputedStyle(el).getPropertyValue(carrierName("position")).trim();
    const name = /^running\(\s*([\w-]+)\s*\)$/.exec(value)?.[1];
    if (name === undefined) continue;
    running.set(name, el.cloneNode(true) as Element);
    el.remove();
  }
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "named strings",
  files: ["strings.ts"],
  feature: "`string-set`, `string()` and running elements (GCPM 3)",
  when: "Every target browser implements `string-set` in print",
  tests: [/^css\/css-gcpm\/(string-set|using-strings)-/],
  native: () => supports("string-set", "title content()"),
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
