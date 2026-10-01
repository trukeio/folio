/**
 * `leader()` (GCPM 3 §6, `doc/plan.md` §4, M6).
 *
 *     a::after { content: leader(dotted) target-counter(attr(href), page) }
 *
 * is the table of contents every book has: the title, a run of dots, and the
 * page number flush with the end of the line. No browser implements
 * `leader()`, so the whole declaration is dropped and the entry has no number
 * either — the leader costs the author the part that did work.
 *
 * It is done the way `target-counter()` is (`references.ts`): the function is
 * rewritten to an `attr()` the engine fills, so the author's selector, cascade
 * and `::after` still do everything else, and the fill is written in stage 5,
 * after the page number it sits beside is known.
 *
 * "Fills to the line end; one measurement" (§4) is almost true. The browser
 * will not say how much of a line is left after a pseudo-element's text, so
 * the fill is found by asking whether the line still holds it: the longest run
 * of the pattern that leaves the element exactly as tall as it was empty. That
 * is a binary search, but a batched one — every leader on the page takes its
 * next guess together — so a page costs about ten layouts however many entries
 * it holds. The run can end up to one copy of the pattern short of the line
 * end, so a column of page numbers is ragged by at most that much.
 *
 * The same rule is what keeps it out of the fragmenter: a leader never changes
 * an element's height, by construction, so it never changes where a page
 * breaks and does not need to be in the measuring box at all.
 *
 * **Delete when** a browser implements `leader()`. None does. WPT's tests for
 * it (`css/css-gcpm/leader-00*`) are manual — "test passes if…", with no
 * reference — so the runner lists them and a person reads them.
 */

import { supports } from "./native.js";
import type { Deletion } from "./native.js";

export const LEADER_ATTRIBUTE_PREFIX = "data-x-leader-";

export type Leader = {
  /** Which attribute carries the fill. */
  attribute: string;
  /**
   * The elements whose generated content holds the leader: the rule's
   * selector with its pseudo-elements taken off. `null` when the rule could
   * not be read back as one — a nested rule's `&` — and the leader is left
   * empty rather than guessed at.
   */
  selector: string | null;
  /** What is repeated, with its spaces made unbreakable. */
  pattern: string;
};

const NBSP = " ";

/** The three keywords GCPM defines, and what each one repeats. */
const KEYWORDS: Record<string, string> = { dotted: ". ", solid: "_", space: " " };

/**
 * Rewrite every `leader()` into an `attr()` the engine will fill.
 *
 * `leader()` can only appear in a `content` value, and a `content` value is
 * only ever inside a rule, so the selector is the text between the last
 * delimiter and the `{` before the call.
 */
export function rewriteLeaders(css: string): { css: string; leaders: Leader[] } {
  const leaders: Leader[] = [];
  const re = /leader\(\s*(?:"([^"]*)"|'([^']*)'|(dotted|solid|space))\s*\)/g;

  const out = css.replace(re, (_match, dq: string | undefined, sq: string | undefined, keyword: string | undefined, offset: number) => {
    const raw = dq ?? sq ?? KEYWORDS[keyword ?? ""] ?? ".";
    const attribute = `${LEADER_ATTRIBUTE_PREFIX}${leaders.length}`;
    leaders.push({
      attribute,
      selector: selectorBefore(css, offset),
      pattern: raw === "" ? " " : raw.replaceAll(" ", NBSP),
    });
    return `attr(${attribute})`;
  });

  return { css: out, leaders };
}

/** The selector of the rule that `offset` is inside, pseudo-elements removed. */
function selectorBefore(css: string, offset: number): string | null {
  const open = css.lastIndexOf("{", offset);
  if (open === -1) return null;
  const before = css.slice(0, open);
  const start = Math.max(before.lastIndexOf("}"), before.lastIndexOf("{"), before.lastIndexOf(";"));
  const text = css
    .slice(start + 1, open)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  if (text === "" || text.startsWith("@") || text.includes("&")) return null;

  return text
    .split(",")
    .map((part) => part.replace(/::?(before|after|marker)\b/gi, "").trim() || "*")
    .join(", ");
}

/**
 * Fill every leader on a finished page.
 *
 * Called after the references are written, because the page number beside a
 * leader is part of what has to fit on its line.
 */
export function fillLeaders(content: HTMLElement, leaders: readonly Leader[]): void {
  const view = content.ownerDocument.defaultView;
  if (view === null || leaders.length === 0) return;

  type Slot = {
    el: Element;
    leader: Leader;
    height: number;
    /** Where the line ends, for an inline element; null for a block. */
    lineEnd: number | null;
    lo: number;
    hi: number;
  };
  const slots: Slot[] = [];
  const width = content.getBoundingClientRect().width;

  for (const leader of leaders) {
    if (leader.selector === null) continue;
    let matched: Element[];
    try {
      matched = [...content.querySelectorAll(leader.selector)];
    } catch {
      // A selector this engine cannot run is one the browser could; the
      // leader stays empty, which is what it was before this file existed.
      continue;
    }
    for (const el of matched) {
      el.setAttribute(leader.attribute, "");
      // No glyph is narrower than about a sixth of an em, so no line holds
      // more copies than this; the search starts from a bound it can prove.
      const em = Number.parseFloat(view.getComputedStyle(el).fontSize) || 16;
      const hi = Math.ceil(width / (em / 6) / leader.pattern.length) + 1;
      slots.push({ el, leader, height: 0, lineEnd: null, lo: 0, hi });
    }
  }

  for (const slot of slots) {
    slot.height = slot.el.getBoundingClientRect().height;
    slot.lineEnd = lineEndOf(slot.el, view);
  }

  // `lo` always fits and `hi` never does, for every slot at once: set every
  // guess, then read every height, so each round is one layout.
  for (;;) {
    const open = slots.filter((s) => s.hi - s.lo > 1);
    if (open.length === 0) break;
    const guesses = open.map((s) => (s.lo + s.hi) >> 1);
    open.forEach((s, i) => s.el.setAttribute(s.leader.attribute, s.leader.pattern.repeat(guesses[i] as number)));
    open.forEach((s, i) => {
      const fits = s.el.getBoundingClientRect().height <= s.height + 0.5 && withinLine(s.el, s.lineEnd);
      if (fits) s.lo = guesses[i] as number;
      else s.hi = guesses[i] as number;
    });
  }

  for (const slot of slots) {
    slot.el.setAttribute(slot.leader.attribute, slot.leader.pattern.repeat(slot.lo));
  }
}

/**
 * Height is not the whole test. A pattern with no break opportunity in it —
 * `leader(solid)` is a row of underscores — glued to a title with none either
 * makes one word, and a word that cannot wrap overflows the line sideways and
 * leaves the height exactly as it was. So the fill must also stay inside the
 * line: for an inline element, its last fragment must end before the line
 * does; for a block, nothing may overflow it.
 */
function withinLine(el: Element, lineEnd: number | null): boolean {
  if (lineEnd === null) return el.scrollWidth <= el.clientWidth;
  const last = [...el.getClientRects()].at(-1);
  return last === undefined || last.right <= lineEnd + 0.5;
}

/** The content edge an inline element's lines end at; null for a block. */
function lineEndOf(el: Element, view: Window): number | null {
  if (!view.getComputedStyle(el).display.startsWith("inline")) return null;
  let block = el.parentElement;
  while (block !== null && view.getComputedStyle(block).display.startsWith("inline")) {
    block = block.parentElement;
  }
  if (block === null) return null;
  const style = view.getComputedStyle(block);
  return (
    block.getBoundingClientRect().right -
    Number.parseFloat(style.paddingRight) -
    Number.parseFloat(style.borderRightWidth)
  );
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "leader()",
  files: ["leaders.ts"],
  feature: "`leader()` in generated content",
  when: "A browser implements `leader()`",
  tests: [/^css\/css-gcpm\/leader-/],
  native: () => supports("content", "leader('.')"),
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
