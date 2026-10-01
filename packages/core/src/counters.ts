/**
 * Author counters across pages (`doc/milestones.md` M2.3).
 *
 * Half of this is free and was free from the start: every page is built in the
 * same document, in order, so the browser's own counting carries a counter
 * from page to page. `counter(chapter)` on page 40 sees the increments on
 * pages 1 to 39 because they are all still above it, and `counters/nested`
 * numbered its headings correctly before a line of this file existed.
 *
 * The other half is what composition breaks, and it breaks it twice.
 *
 * **A fragment is not a new element.** A page continuing inside a `<section>`
 * clones that section, and the clone brings the author's `counter-reset` with
 * it — so the count restarts on every page. `splits/numbering` renumbered its
 * paragraphs 1, 2, then 1, 2, 3 overleaf. Suppressing the reset is not the
 * fix: the instance page 1 created belongs to page 1's clone and is not in
 * scope on page 2, so the counter would begin again from the implicit zero.
 * The value has to be *carried* — which is why this module counts at all.
 * `ensureFragmentRules` suppresses `counter-increment` and `counter-set` on a
 * continuation, because a paragraph split across a break is one paragraph;
 * this writes the carried value back as an inline `counter-reset`, so the
 * browser and the engine agree on the number that is printed.
 *
 * **Nothing can read a rendered counter.** `getComputedStyle(el, "::before")`
 * gives back `counter(chapter)`, not `3`, and a pseudo-element's text is not
 * in the DOM. So `target-counter(#id, chapter)` and `counter(chapter)` in a
 * margin box can only be answered by a count the engine did itself — the same
 * conclusion `math.md` §5 reached for equations, for a different reason.
 *
 * **Scoping is flat**, as it is in `math/number.ts`: a reset anywhere sets the
 * value from there on. That is what CSS does for the shallow uses that number
 * a book — a reset per chapter, a reset per section — and not for a counter
 * reset inside one sibling subtree and expected to be untouched in the next.
 * `counters(name, sep)`, whose whole meaning is the nesting, is therefore not
 * implemented rather than implemented wrongly.
 *
 * **Delete when** browsers fragment paged media themselves; the carrying is
 * only needed because we are the ones cutting the tree.
 */
import { SPLIT_FROM } from "./compose.js";
import { REPEATED } from "./tables.js";
import type { Deletion } from "./native.js";

/** Every counter's value at one point in the document. */
export type CounterValues = Map<string, number>;

export type PageCounters = {
  /**
   * Every counter's value at each element that has an id.
   *
   * Snapshotted *after* the element's own increment, because that is what
   * `target-counter(#chapter-3, chapter)` means: the number printed on that
   * element, not the one before it.
   */
  atId: Map<string, CounterValues>;
  /**
   * `counter-reset: page N` on an element that *starts* on this page — the
   * last one, as the cascade would have it. Paged.js's way to number the body
   * of a book from 1 after its front matter (`main { counter-reset: page 1
   * }`), and a page counter is the page's, so it is `page-counters.ts` that
   * applies it. A continuation carries its reset rather than making one.
   */
  pageReset?: number;
  /**
   * Every counter's value at each watched element: at its `::before`, after
   * its own increments, and at its `::after`, after its last descendant's.
   */
  atElement: Map<Element, { before: CounterValues; after: CounterValues }>;
};

/**
 * Count the author's counters over one composed page, carrying `state`.
 *
 * `state` is the value each counter reached on the page before, and is left
 * holding the values this page ends with — so the caller threads one map
 * through the document and nothing here needs to know about pages.
 */
export function countPage(
  content: Element,
  view: Window,
  state: CounterValues,
  trackIds = true,
  watch: ReadonlySet<Element> = new Set(),
): PageCounters {
  const atId = new Map<string, CounterValues>();
  const atElement: PageCounters["atElement"] = new Map();
  let pageReset: number | undefined;
  // A watched element's `::after` is counted when its last descendant is.
  const closing = new Map<Element, Element[]>();
  for (const el of watch) {
    let last: Element = el;
    while (last.lastElementChild !== null) last = last.lastElementChild;
    closing.set(last, [...(closing.get(last) ?? []), el]);
  }

  for (const el of content.querySelectorAll("*")) {
    const style = view.getComputedStyle(el);
    // A repeated table header is the same source row put back on a later
    // fragment, so it continues exactly as a split element does.
    const continued = el.hasAttribute(SPLIT_FROM) || el.hasAttribute(REPEATED);

    const resets = counterOps(style.counterReset, 0);
    if (resets.length > 0) {
      if (continued) {
        // Reopened, not created. The author's value would restart the count;
        // the carried one continues it, and writing it back inline is what
        // makes the browser print the same number this walk computed.
        //
        // Not `list-item`: no engine reports its implicit increments, so this
        // walk cannot count it, and `fragments.ts` continues a list by its
        // `start` attribute instead — which an inline reset would override.
        const carried = resets
          .filter(([name]) => name !== "list-item")
          .map(([name, value]): [string, number] => [name, state.get(name) ?? value]);
        if (carried.length > 0) {
          (el as HTMLElement).style.counterReset = carried
            .map(([name, value]) => `${name} ${value}`)
            .join(" ");
        }
        for (const [name, value] of carried) state.set(name, value);
      } else {
        for (const [name, value] of resets) state.set(name, value);
        for (const [name, value] of resets) if (name === "page") pageReset = value;
      }
    }

    // `counter-set` and `counter-increment` read `none` on a continuation:
    // `ensureFragmentRules` suppresses them there, so this walk sees the same
    // declarations the browser is applying rather than a second opinion.
    for (const [name, value] of counterOps(style.counterSet, 0)) state.set(name, value);
    for (const [name, step] of counterOps(style.counterIncrement, 1)) {
      state.set(name, (state.get(name) ?? 0) + step);
    }

    if (trackIds && el.id !== "") atId.set(el.id, new Map(state));
    if (watch.has(el)) atElement.set(el, { before: new Map(state), after: new Map(state) });
    for (const w of closing.get(el) ?? []) {
      const entry = atElement.get(w);
      if (entry !== undefined) entry.after = new Map(state);
    }
  }

  return pageReset === undefined ? { atId, atElement } : { atId, pageReset, atElement };
}

/**
 * The `name value` pairs in a `counter-reset`-shaped value.
 *
 * A name with no number takes `fallback`, which is 0 for `counter-reset` and
 * `counter-set` and 1 for `counter-increment` — the three defaults CSS gives
 * them. `none` and the empty string yield nothing.
 */
export function counterOps(list: string, fallback: number): [string, number][] {
  if (list === "" || list === "none") return [];

  const out: [string, number][] = [];
  const parts = list.trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i] as string;
    // A number here belongs to the name before it, which has been taken.
    if (/^-?\d+$/.test(name)) continue;
    const next = Number.parseInt(parts[i + 1] ?? "", 10);
    out.push([name, Number.isFinite(next) ? next : fallback]);
  }
  return out;
}

/**
 * One walk over a whole document, page by page.
 *
 * The state is here rather than in `paginate.ts` because none of it is a
 * break decision: the fragmenter's budget is for the part that decides where
 * pages end, and a counter has never moved a break.
 */
export type CounterWalk = {
  /**
   * Count a finished page. `view` may be null in a document with no window.
   * Returns the counters at each `watch`ed element (`PageCounters.atElement`).
   */
  page(content: Element, view: Window | null, watch?: ReadonlySet<Element>): PageCounters["atElement"];
  /** Record a blank page, which holds nothing but still has an index. */
  blank(): void;
  /** Each page's counters as it ends — what its margin boxes see. */
  readonly perPage: CounterValues[];
  /** Each page's element reset of `page`, if one starts on it (`PageCounters`). */
  readonly pageResets: (number | undefined)[];
  /** Every id's counters, with M4's equation numbers written over the walk's. */
  resolve(equations: Map<string, number>): Map<string, CounterValues>;
};

/**
 * @param trackIds record every id's counters, for `target-counter()`.
 * @param root the element whose children are paginated; it and its ancestors
 *   are counted before the first page.
 *
 * Off unless something asks: the snapshot is a copy of the whole state per id
 * per page, and — worse — a non-empty answer is a change from the pass
 * before, which sends stage 5 round again. A document with ids and no
 * counter references would have paid for a second layout of the whole book to
 * learn nothing.
 */
export function counterWalk(trackIds = true, root?: Element): CounterWalk {
  const state: CounterValues = new Map();
  // What the pages are composed inside counts too — `html { counter-reset:
  // chapter }` puts every page in its scope — and it is on the pages now, as
  // the root chain (`compose.ts`): counted on page 1 like anything else, and
  // carried on the continuations after it. A source outside any document
  // has no chain, and its own ancestors are counted here instead.
  const view = root?.ownerDocument.defaultView ?? null;
  const chain: Element[] = [];
  if (root !== undefined && !root.ownerDocument.documentElement.contains(root)) {
    for (let el: Element | null = root; el !== null; el = el.parentElement) chain.unshift(el);
  }
  for (const el of chain) {
    if (view === null) break;
    const style = view.getComputedStyle(el);
    for (const [name, value] of counterOps(style.counterReset, 0)) state.set(name, value);
    for (const [name, value] of counterOps(style.counterSet, 0)) state.set(name, value);
    for (const [name, step] of counterOps(style.counterIncrement, 1)) {
      state.set(name, (state.get(name) ?? 0) + step);
    }
  }
  const atId = new Map<string, CounterValues>();
  const perPage: CounterValues[] = [];
  const pageResets: (number | undefined)[] = [];

  return {
    page(content, view, watch) {
      // After the running elements are out: one is not in the flow, and a
      // running head that increments a counter should no more do so here than
      // it should take space on the page.
      let atElement: PageCounters["atElement"] = new Map();
      if (view !== null) {
        const counted = countPage(content, view, state, trackIds, watch);
        for (const [id, values] of counted.atId) atId.set(id, values);
        pageResets[perPage.length] = counted.pageReset;
        atElement = counted.atElement;
      }
      perPage.push(new Map(state));
      return atElement;
    },

    blank() {
      perPage.push(new Map(state));
    },

    perPage,
    pageResets,

    /**
     * M4 counts `equation` itself and has to (`math.md` §5: a formula cloned
     * into a running head would advance an ordinary counter), so its answer is
     * written over this walk's rather than beside it.
     */
    resolve(equations) {
      const out = new Map<string, CounterValues>();
      for (const [id, values] of atId) out.set(id, new Map(values));
      for (const [id, value] of equations) {
        const values = out.get(id) ?? new Map<string, number>();
        values.set("equation", value);
        out.set(id, values);
      }
      return out;
    },
  };
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "counters",
  files: ["counters.ts"],
  feature: "Author counters carried across a split element's pages",
  when: "Browsers fragment paged media themselves",
  tests: [],
  untested: "The pinned WPT set has no test of a counter across a split box; `counters.spec.ts` is the check",
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
