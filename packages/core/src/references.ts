/**
 * Stage 5: resolve references (`doc/plan.md` §2, §4).
 *
 * "Equation (3.4) on page 128" is the capability §7 says MathJax cannot have
 * at any price, and it is the same machinery as "see page 12": a reference
 * whose value is a *page number*, which nothing knows until the document has
 * been paginated — and which, once written in, can make a page longer and move
 * the very break it was measured against.
 *
 * So references are resolved in a pass after pagination, and pages whose size
 * changed are laid out again, under a limit (§11).
 *
 * The trick that keeps this on rung P (§5): `target-counter()` in a `content`
 * declaration is rewritten to `attr()`, and the engine writes the answer into
 * that attribute. The browser still does the generated content, still cascades
 * the rule, still applies the author's selector — we only supply a number.
 */

import { fillLeaders, rewriteLeaders } from "./leaders.js";
import { formatCounter } from "./page-template.js";
import type { Leader } from "./leaders.js";
import type { CounterValues } from "./counters.js";
import { supports } from "./native.js";
import type { Deletion } from "./native.js";

export const REF_ATTRIBUTE_PREFIX = "data-x-ref-";

export type Reference = {
  /** Which attribute carries the answer. */
  attribute: string;
  /** How the target is named: an `attr()` on the referring element, or a literal. */
  target: { kind: "attr"; name: string } | { kind: "literal"; value: string };
  /**
   * What to report about the target. A `leader` has no target: it is here
   * because it is filled at the same moment, after the page number beside it
   * is known (`leaders.ts`).
   */
  wants: "page" | "text" | "counter" | "leader";
  /** For `wants: "counter"`: which counter was asked for. */
  counter?: string;
  /** Counter style for the number. */
  style: string;
  /** For `wants: "leader"`: what it repeats, and where. */
  leader?: Leader;
};

export type RewrittenReferences = {
  css: string;
  references: Reference[];
};

/**
 * Rewrite `target-counter()` and `target-text()` inside `content` values.
 *
 * The rule keeps its selector and its place in the cascade; only the function
 * is replaced, by an `attr()` reading an attribute the engine will set. That
 * is why this needs no knowledge of which elements the rule matches — the
 * browser already knows.
 */
export function rewriteReferences(css: string): RewrittenReferences {
  const references: Reference[] = [];

  // `attr(href url)` is css-gcpm's own spelling, and Paged.js's documentation
  // writes it that way; `url` is the attribute's type, not part of its name.
  // Unread, a rule spelled so printed nothing at all.
  const targetCounter =
    /target-counter\(\s*(attr\(\s*([\w-]+)(?:\s+url)?\s*\)|"[^"]*"|'[^']*')\s*,\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)/g;
  const targetText =
    /target-text\(\s*(attr\(\s*([\w-]+)(?:\s+url)?\s*\)|"[^"]*"|'[^']*')\s*(?:,\s*([\w-]+)\s*)?\)/g;

  let out = css.replace(targetCounter, (_match, target: string, attrName: string | undefined, counter: string, style: string | undefined) => {
    // `page` is a page-level fact and only pagination knows it. Any other
    // counter is one the engine has to have counted itself: `equation` is,
    // from M4 (`math.md` §5), and a counter nothing counted resolves to an
    // empty attribute — the same nothing the rule used to be deleted for,
    // but without deleting the author's rule.
    if (counter === "page") {
      return attrFor(references, target, attrName, "page", style ?? "decimal");
    }
    return attrFor(references, target, attrName, "counter", style ?? "decimal", counter);
  });

  out = out.replace(targetText, (_match, target: string, attrName: string | undefined) =>
    attrFor(references, target, attrName, "text", "decimal"),
  );

  const { css: withLeaders, leaders } = rewriteLeaders(out);
  for (const leader of leaders) {
    references.push({
      attribute: leader.attribute,
      target: { kind: "literal", value: "" },
      wants: "leader",
      style: "",
      leader,
    });
  }

  return { css: withLeaders, references };
}

function attrFor(
  references: Reference[],
  target: string,
  attrName: string | undefined,
  wants: "page" | "text" | "counter",
  style: string,
  counter?: string,
): string {
  const attribute = `${REF_ATTRIBUTE_PREFIX}${references.length}`;
  references.push({
    attribute,
    target:
      attrName === undefined
        ? { kind: "literal", value: target.slice(1, -1) }
        : { kind: "attr", name: attrName },
    wants,
    ...(counter === undefined ? {} : { counter }),
    style,
  });
  return `attr(${attribute})`;
}

/** The id a reference points at, from the referring element. */
export function targetIdOf(reference: Reference, el: Element): string | null {
  const raw =
    reference.target.kind === "attr"
      ? el.getAttribute(reference.target.name)
      : reference.target.value;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.startsWith("#") ? trimmed.slice(1) : null;
}

/**
 * Which page each id is on, and which ids each page refers to.
 *
 * These are `PageRecord.provides` and `refs`. They exist so stage 5 can tell
 * *which* pages a change affects: when a reference resolves to a different
 * number, only the pages that read it need looking at again.
 */
export function indexPages(
  pages: readonly Element[],
  references: readonly Reference[],
): { provides: Map<string, number>; refs: Set<string>[] } {
  const provides = new Map<string, number>();
  const refs: Set<string>[] = [];

  pages.forEach((page, index) => {
    for (const el of page.querySelectorAll("[id]")) {
      const id = el.id;
      if (id !== "" && !provides.has(id)) provides.set(id, index + 1);
    }
  });

  for (const page of pages) {
    const used = new Set<string>();
    for (const reference of references) {
      if (reference.wants === "leader") continue;
      const selector =
        reference.target.kind === "attr" ? `[${reference.target.name}]` : "*";
      for (const el of page.querySelectorAll(selector)) {
        const id = targetIdOf(reference, el);
        if (id !== null) used.add(id);
      }
    }
    refs.push(used);
  }

  return { provides, refs };
}

/**
 * Write the answers to a page's references into the attributes the rewrite
 * put in their place.
 *
 * Writing an attribute is all it takes: the browser's own generated content
 * reads it through `attr()`, so the author's selector, cascade and
 * `::after` still do the work. On the first pass the answers are unknown and
 * the attribute is left empty, which is why there is a second pass.
 */
export function applyReferences(
  content: HTMLElement,
  references: readonly Reference[],
  pageOf: Map<string, number>,
  counterOf: Map<string, CounterValues>,
  source: Element,
): void {
  for (const reference of references) {
    if (reference.wants === "leader") continue;
    const selector = reference.target.kind === "attr" ? `[${reference.target.name}]` : "*";
    for (const el of content.querySelectorAll(selector)) {
      const id = targetIdOf(reference, el);
      if (id === null) continue;

      if (reference.wants === "counter") {
        // The engine counts the author's counters and M4's alike
        // (`counters.ts`), so an empty attribute now means the id is not in
        // the document or that counter never reached it — which is the same
        // nothing the author's rule rendered before, and not a gap in what
        // can be asked.
        const value = counterOf.get(id)?.get(reference.counter ?? "");
        if (value !== undefined) {
          el.setAttribute(reference.attribute, formatCounter(value, reference.style));
        }
        continue;
      }

      if (reference.wants === "text") {
        const target = source.querySelector(`#${CSS.escape(id)}`);
        if (target !== null) el.setAttribute(reference.attribute, target.textContent);
        continue;
      }

      const page = pageOf.get(id);
      if (page !== undefined) {
        el.setAttribute(reference.attribute, formatCounter(page, reference.style));
      }
    }
  }

  // Last: a leader fills what the line has left, and the numbers just written
  // are on the same line.
  fillLeaders(
    content,
    references.flatMap((r) => (r.leader === undefined ? [] : [r.leader])),
  );
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "cross-references",
  files: ["references.ts"],
  feature: "`target-counter()` and `target-text()`",
  when: "Every target browser implements `target-counter()` in print",
  tests: [],
  untested: "The pinned WPT set has no `target-counter()` test; `cross-ref.spec.ts` is the check",
  native: () => supports("content", "target-counter(attr(href url), page)"),
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
