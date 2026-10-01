/**
 * Counters in the page and margin contexts (css-page-3 §6.1).
 *
 * `counter(page)` used to be the page's index. It is a counter: `@page {
 * counter-increment: page 2 }` numbers the pages 2, 4, 6, and `main {
 * counter-reset: page 1 }` numbers the body of a book from 1 after its front
 * matter, which is how Paged.js projects do it. Other counters can be kept by
 * the page context too, and by a margin box for itself.
 *
 * None of it is the browser's to count. The page context is not an element,
 * and a margin box is one only in our frame: an author's `counter-increment`
 * left on it would advance the *document's* counter for every page after it.
 * So the page context's declarations are read from the `@page` cascade here,
 * and a box's are kept on it as data (`page-template.ts`) and applied by
 * `marginCounters`. What each rule means comes from WPT's
 * `css-page/margin-boxes/content-008` to `013`, whose references settle what
 * the prose leaves open:
 *
 * - `page` starts at 0 and each page adds 1 to it, or what its page context's
 *   `counter-increment` says for `page` — `page 0` included. An element reset
 *   on the page sets it outright for that page instead, as Paged.js does.
 * - A counter the page context increments is the page context's from then on,
 *   carried from page to page, and starts from the document's value. It hides
 *   the document's counter of that name.
 * - A counter the page context *resets* is that page's alone: the next page
 *   continues the carried one, not the reset one (`content-012`: 11, 6, 12).
 * - A margin box's resets and increments are the box's alone, and hide the
 *   page context's and the document's (`content-011`: `3`, not `11.3`).
 * - `pages` cannot be changed by anything (`content-013`).
 *
 * `page` is carried when the page context resets it — `@page chapter:first {
 * counter-reset: page 1 }` means "number from here", which a reset that
 * lasted one page would not. That is a choice; no WPT test covers it.
 */
import { counterOps } from "./counters.js";
import { cascadeFor } from "./page-model.js";
import type { CounterValues } from "./counters.js";
import type { PageRule } from "./css/page-rules.js";
import type { ContentCounters } from "./page-template.js";
import type { PageRecord, PageSpec } from "./types.js";
import type { Deletion } from "./native.js";

/**
 * What every page's margin boxes can count with, in page order.
 *
 * `specs` are the pages as laid out, `resets` the walk's element resets of
 * `page` per page, and `document` the author's counters per page
 * (`counterWalk`).
 */
export function pageCounters(
  rules: readonly PageRule[],
  specs: readonly PageSpec[],
  resets: readonly (number | undefined)[],
  document: readonly CounterValues[],
): ContentCounters[] {
  let page = 0;
  const carried = new Map<string, number>();

  return specs.map((spec, i) => {
    const declarations = cascadeFor(rules, spec);
    const reset = counterOps(declarations["counter-reset"] ?? "", 0);
    const set = counterOps(declarations["counter-set"] ?? "", 0);
    const increment = counterOps(declarations["counter-increment"] ?? "", 1);
    const doc = document[i] ?? new Map<string, number>();

    const elementReset = resets[i];
    if (elementReset !== undefined) page = elementReset;
    else {
      for (const [name, value] of [...reset, ...set]) if (name === "page") page = value;
      const own = increment.filter(([name]) => name === "page");
      page += own.length === 0 ? 1 : own.reduce((sum, [, step]) => sum + step, 0);
    }

    const local = new Map<string, number>();
    for (const [name, value] of reset) if (!FIXED.has(name)) local.set(name, value);
    for (const [name, value] of set) {
      if (FIXED.has(name)) continue;
      (local.has(name) ? local : carried).set(name, value);
    }
    for (const [name, step] of increment) {
      if (FIXED.has(name)) continue;
      const into = local.has(name) ? local : carried;
      into.set(name, (into.get(name) ?? doc.get(name) ?? 0) + step);
    }

    return {
      page,
      pages: specs.length,
      document: doc,
      context: new Map([...carried, ...local]),
      contextReset: declarations["counter-reset"] ?? "none",
    };
  });
}

/** Counters only pagination can change: `page` is handled above, `pages` never. */
const FIXED = new Set(["page", "pages"]);

/**
 * A margin box's counters: its page's, with the box's own `counter-reset`,
 * `counter-set` and `counter-increment` applied in a scope of its own.
 *
 * `counter-reset: inherit` is the page context's value, since a margin box
 * inherits from the page context (`content-012`).
 */
export function marginCounters(
  counters: ContentCounters,
  own: { reset?: string | undefined; set?: string | undefined; increment?: string | undefined },
): ContentCounters {
  const reset = own.reset?.trim() === "inherit" ? (counters.contextReset ?? "none") : own.reset;
  const ops = {
    reset: counterOps(reset ?? "", 0),
    set: counterOps(own.set ?? "", 0),
    increment: counterOps(own.increment ?? "", 1),
  };
  if (ops.reset.length + ops.set.length + ops.increment.length === 0) return counters;

  const box = new Map<string, number>();
  const visible = (name: string): number =>
    box.get(name) ??
    (name === "page" ? counters.page : (counters.context?.get(name) ?? counters.document?.get(name) ?? 0));
  for (const [name, value] of [...ops.reset, ...ops.set]) if (name !== "pages") box.set(name, value);
  for (const [name, step] of ops.increment) if (name !== "pages") box.set(name, visible(name) + step);

  const page = box.get("page") ?? counters.page;
  box.delete("page");
  return { ...counters, page, context: new Map([...(counters.context ?? []), ...box]) };
}

/**
 * Where each id is, as the page counter numbers it rather than by index: what
 * `target-counter(#x, page)` prints, so that a table of contents agrees with
 * the footers when the body is numbered from 1 after the front matter.
 */
export function byNumber(
  pageOf: ReadonlyMap<string, number>,
  records: readonly PageRecord[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, index] of pageOf) out.set(id, records[index - 1]?.number ?? index);
  return out;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "page counters",
  files: ["page-counters.ts"],
  feature: "`counter(page)` and page-context counters (css-page-3 §6.1)",
  when: "The margin boxes go, with the page model",
  tests: [/^css\/css-page\/margin-boxes\/content-0(0[89]|1[0-3])-/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
