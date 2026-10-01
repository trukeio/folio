/**
 * `::nth-fragment()` on rung P+ (`doc/review.md` §8, `plan.md` §6).
 *
 * Stage 1 rewrites `X::nth-fragment(an+b)` to an attribute test on `X`, and
 * pagination stamps every element on a page, and in the box a page is
 * measured in, with the formulas its fragment index satisfies. The index is
 * known before the page is measured — a page begins inside exactly the
 * elements composition marks as continued — so a stamp that changes a size
 * is measured from the start, and nothing is laid out twice.
 *
 * **Delete when** a browser parses `::nth-fragment()` and paginates.
 */
import { CHAIN, SOURCE_PATH, SPLIT_FROM } from "./compose.js";
import type { Deletion } from "./native.js";

export const NTH = "data-folio-nth";

/** An+b, normalized: `2n+1`, `n+0`, `0n+3`. Null if it is not one. */
export function normalizeAnB(arg: string): string | null {
  const s = arg.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "odd") return "2n+1";
  if (s === "even") return "2n+0";
  const m = /^([+-]?\d*)?(n)?([+-]\d+)?$/.exec(s);
  if (m === null || s === "") return null;
  const [, rawA = "", n, rawB] = m;
  if (n === undefined) {
    // A lone integer: `3`, `+3`.
    return rawB === undefined && /^[+-]?\d+$/.test(rawA) ? `0n+${String(Number(rawA))}` : null;
  }
  const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : Number(rawA);
  const b = rawB === undefined ? 0 : Number(rawB);
  return `${String(a)}n${b < 0 ? "" : "+"}${String(b)}`;
}

/** Whether index `k` (from 1) satisfies a normalized formula. */
export function matchesAnB(formula: string, k: number): boolean {
  const m = /^(-?\d+)n([+-]\d+)$/.exec(formula);
  if (m === null) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0) return k === b;
  const n = (k - b) / a;
  return Number.isInteger(n) && n >= 0;
}

/**
 * Rewrite every `::nth-fragment(…)` in `css` to the attribute test pagination
 * stamps. It weighs one type selector, as a pseudo-element does. An argument
 * that is not an+b is left as it was, so the browser drops that rule, as it
 * would have. Strings and comments are copied through.
 */
export function rewriteNthFragment(css: string): string {
  const pattern = /::nth-fragment\(([^)]*)\)/giy;
  let out = "";
  let at = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
    } else if (c === '"' || c === "'") {
      const end = css.indexOf(c, i + 1);
      if (end === -1) break;
      i = end;
    } else if (c === ":") {
      pattern.lastIndex = i;
      const m = pattern.exec(css);
      const formula = m === null ? null : normalizeAnB(m[1] ?? "");
      if (m === null || formula === null) continue;
      out += `${css.slice(at, i)}:where([${NTH}~="${formula}"]):is(*, folio-nth)`;
      at = i + m[0].length;
      i = at - 1;
    }
  }
  return out + css.slice(at);
}

/**
 * The formulas the frame's sheets ask about, read back out of the rewritten
 * selectors. Empty, and nothing is stamped, for a document that has none.
 */
function formulasIn(target: Document): string[] {
  const found = new Set<string>();
  const token = new RegExp(`${NTH}~="([^"]+)"`, "g");
  const visit = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if ("selectorText" in rule) for (const m of String(rule.selectorText).matchAll(token)) found.add(m[1] as string);
      if ("cssRules" in rule) visit(rule.cssRules as CSSRuleList);
    }
  };
  for (const sheet of target.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A cross-origin sheet cannot be read, and is not the author CSS we injected.
    }
  }
  return [...found];
}

/** Which fragment each element is, page to page. */
export type FragmentIndex = {
  /** Stamp a page, or the box it is measured in, before it is measured. */
  stamp: (content: Element) => void;
  /** After a page is kept: its elements that go on are one fragment further. */
  advance: (content: Element) => void;
};

/** Null when the document never asks. */
export function fragmentIndex(target: Document): FragmentIndex | null {
  const formulas = formulasIn(target);
  if (formulas.length === 0) return null;
  let next = new Map<string, number>();
  // The root chain has no source path: a clone's depth in it stands in.
  const keyOf = (el: Element): string | null =>
    el.getAttribute(SOURCE_PATH) ?? (el.hasAttribute(CHAIN) ? `chain:${String(depth(el))}` : null);
  const indexOf = (el: Element, key: string): number =>
    el.hasAttribute(SPLIT_FROM) || el.hasAttribute("data-folio-repeated") ? (next.get(key) ?? 1) : 1;
  const each = (content: Element, fn: (el: Element, key: string) => void): void => {
    for (const el of content.querySelectorAll(`[${SOURCE_PATH}], [${CHAIN}]`)) {
      const key = keyOf(el);
      if (key !== null) fn(el, key);
    }
  };
  return {
    stamp: (content) =>
      each(content, (el, key) => {
        const k = indexOf(el, key);
        const tokens = formulas.filter((f) => matchesAnB(f, k));
        if (tokens.length > 0) el.setAttribute(NTH, tokens.join(" "));
        else el.removeAttribute(NTH);
      }),
    advance: (content) => {
      const after = new Map<string, number>();
      each(content, (el, key) => after.set(key, indexOf(el, key) + 1));
      next = after;
    },
  };
}

function depth(el: Element): number {
  let d = 0;
  for (let p = el.parentElement; p?.hasAttribute(CHAIN) === true; p = p.parentElement) d++;
  return d;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "nth-fragment",
  files: ["nth-fragment.ts"],
  feature: "`::nth-fragment()` (rung P+)",
  when: "A browser parses `::nth-fragment()` and paginates",
  tests: [],
  untested: "The pinned WPT set has no `::nth-fragment` test; `nth-fragment.spec.ts` is the check",
  // The selector half; no script can ask whether a browser paginates.
  native: () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("selector(p::nth-fragment(1))"),
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
