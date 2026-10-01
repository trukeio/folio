/**
 * The sequence of pages, around the breaks (`doc/review.md` §2.5).
 *
 * Which pages exist once a break is chosen — the blank one a `break-before:
 * left` demands, the side each falls on — what each one records, and what is
 * placed on it after its content is decided: equations numbered and broken,
 * margin boxes filled once the last page is known. None of it chooses a
 * break, which is the test for being outside the fragmenter's budget: the
 * fragmenter decides, given a measured box, where the page ends; this is
 * what happens to the pages on either side of that decision.
 */
import { domMeasurer } from "./dom-measurer.js";
import { contentArea, footnoteAreaFor, marginBoxesFor, resolvePageSpec } from "./page-model.js";
import { renderMarginBoxes, renderPageTemplate } from "./page-template.js";
import { pageCounters } from "./page-counters.js";
import { breakEquations } from "./math/compose.js";
import { numberEquations } from "./math/number.js";
import { paintCanvas } from "./page-paint.js";
import type { CarriedElements } from "./carry.js";
import type { CounterWalk } from "./counters.js";
import { appendNoteArea, capOf, fillArea } from "./footnotes.js";
import { flowArea } from "./flow.js";
import type { Flow } from "./flow.js";
import { placeFloats, planFloats } from "./page-floats.js";
import type { PageFloat } from "./page-floats.js";
import type { Declarations, PageRule } from "./css/page-rules.js";
import type { PageStrings } from "./strings.js";
import type { PageRecord, Position } from "./types.js";

/** Everything the page loop keeps per page, in page order. */
export type Sequence = {
  records: PageRecord[];
  /** The content areas — where the flow was measured. */
  pages: HTMLElement[];
  /** The whole pages: paper, margin boxes and content. */
  sheets: HTMLElement[];
  boxesPerPage: Map<string, HTMLElement>[];
  /** Each margin box's `content`, filled in once the last page is known. */
  contentDeclarations: Record<string, string>[];
  stringsPerPage: PageStrings[];
  carriedPerPage: CarriedElements[];
};

export function emptySequence(): Sequence {
  return {
    records: [],
    pages: [],
    sheets: [],
    boxesPerPage: [],
    contentDeclarations: [],
    stringsPerPage: [],
    carriedPerPage: [],
  };
}

/** The `content` of each margin box a page asked for. */
export function contentValues(marginBoxes: Record<string, Declarations>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(marginBoxes)
      .map(([name, d]) => [name, d["content"]])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * Page sides alternate, and page 1 is the recto: a right page where the
 * root's direction is left-to-right, and a left page where it is
 * right-to-left, since pages then progress leftwards (css-page-3 §4.1; WPT
 * `page-left-right-002`).
 */
export function sideOf(index: number, rtl = false): "left" | "right" {
  return (index % 2 === 1) !== rtl ? "right" : "left";
}

/** Which side a forced break demands, if it demands one. */
function sideWantedBy(breakValue: string | undefined, rtl: boolean): "left" | "right" | null {
  const recto = rtl ? "left" : "right";
  const verso = rtl ? "right" : "left";
  switch (breakValue) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "recto":
      return recto;
    case "verso":
      return verso;
    default:
      return null;
  }
}

export function record(
  spec: PageRecord["spec"],
  start: Position,
  end: Position,
): PageRecord {
  return { spec, start, end, refs: new Set(), provides: new Set() };
}

/**
 * One page with nothing of the flow on it: a blank page for a side, or a page
 * of carried notes. It starts and ends where the next page starts, so the
 * content check still sees every character once.
 */
function emptyPage(
  seq: Sequence,
  context: { index: number; name: string | null; side: "left" | "right"; blank: boolean; flow: { writingMode: string; direction: string } },
  end: Position,
  pageRules: readonly PageRule[],
  target: Document,
  carried: { carriedStrings: Map<string, string>; carriedNodes: Map<string, Element> },
  counters: CounterWalk,
): { content: HTMLElement; spec: PageRecord["spec"] } {
  const spec = resolvePageSpec(pageRules, context);
  const boxes = marginBoxesFor(pageRules, context);
  const page = renderPageTemplate({ spec, marginBoxes: boxes, target, flow: context.flow });
  target.body.append(page.page);
  page.content.style.writingMode = context.flow.writingMode;
  page.content.style.direction = context.flow.direction;

  seq.sheets.push(page.page);
  seq.boxesPerPage.push(page.boxes);
  seq.contentDeclarations.push(contentValues(boxes));
  seq.stringsPerPage.push({ start: new Map(carried.carriedStrings), first: new Map(), last: new Map() });
  seq.carriedPerPage.push({ start: new Map(carried.carriedNodes), first: new Map(), last: new Map() });
  // Nothing of the flow on it to count, but the record is indexed by page.
  counters.blank();
  seq.records.push(record(spec, end, end));
  seq.pages.push(page.content);
  return { content: page.content, spec };
}

/**
 * Insert blank pages so the next one lands on the side a forced break asked
 * for. `break-before: left` does not merely break — it breaks *to* a left page.
 */
export function addBlankPages(
  seq: Sequence,
  at: {
    index: number;
    name: string | null;
    end: Position;
    breakValue: string | undefined;
    maxPages: number;
    rtl: boolean;
    flow: { writingMode: string; direction: string };
  },
  pageRules: readonly PageRule[],
  target: Document,
  carried: { carriedStrings: Map<string, string>; carriedNodes: Map<string, Element> },
  counters: CounterWalk,
): number {
  const wanted = sideWantedBy(at.breakValue, at.rtl);
  let index = at.index;
  while (wanted !== null && sideOf(index, at.rtl) !== wanted && index <= at.maxPages) {
    const context = { index, name: at.name, side: sideOf(index, at.rtl), blank: true, flow: at.flow };
    emptyPage(seq, context, at.end, pageRules, target, carried, counters);
    index++;
  }
  return index;
}

/**
 * Pages of notes and floats alone, once the text has run out with some still
 * carried (`review.md` §6, §7). Floats first, as
 * many as fit, then notes in what is left: with no text to share the page,
 * they may take all of it, unless `@footnote` gives a `max-height`.
 */
export function addNotePages(
  seq: Sequence,
  at: { index: number; name: string | null; end: Position; maxPages: number; rtl: boolean; flow: Flow },
  carried: { notes: readonly HTMLElement[]; floats: readonly PageFloat[] },
  pageRules: readonly PageRule[],
  target: Document,
  strings: { carriedStrings: Map<string, string>; carriedNodes: Map<string, Element> },
  counters: CounterWalk,
  placed: Element[],
): number {
  let index = at.index;
  let notes = [...carried.notes];
  let floats = [...carried.floats];
  while ((notes.length > 0 || floats.length > 0) && index <= at.maxPages) {
    const context = { index, name: at.name, side: sideOf(index, at.rtl), blank: false, flow: at.flow };
    const { content, spec } = emptyPage(seq, context, at.end, pageRules, target, strings, counters);
    const area = flowArea(contentArea(spec), at.flow);

    const geometry = { origin: 0, block: area.block, inline: area.inline, writingMode: at.flow.writingMode };
    const plan = planFloats(floats, geometry, target, () => 0);
    placeFloats(content, [...plan.edges].map(([i, edge]) => ({ el: (floats[i] as PageFloat).el, edge })), target);
    floats = floats.filter((_, i) => !plan.edges.has(i)).map((f) => ({ ...f, defer: Math.max(0, f.defer - 1) }));

    const room = area.block - plan.above(0);
    if (plan.edges.size === 0 || room > 0) {
      const style = footnoteAreaFor(pageRules, context);
      const { kept, carried: next } = fillArea(notes, Math.min(capOf(style, area.block, area.block), room), area.inline, target, style);
      appendNoteArea(content, kept, target, style);
      placed.push(...kept);
      notes = next;
    }
    index++;
  }
  return index;
}
/**
 * Number the pages and fill every margin box, once the last page exists.
 *
 * `counter(pages)` is only knowable after the last page, which is the extra
 * pass `plan.md` §4 predicts — not a loop, just an ending.
 */
export function finishPages(
  seq: Sequence,
  pageRules: readonly PageRule[],
  counters: CounterWalk,
  runningElements: Map<string, Element>,
): void {
  const { records, boxesPerPage, contentDeclarations, stringsPerPage, carriedPerPage } = seq;
  const numbers = pageCounters(pageRules, records.map((r) => r.spec), counters.pageResets, counters.perPage);
  records.forEach((r, i) => (r.number = numbers[i]?.page ?? i + 1));
  renderMarginBoxes(
    boxesPerPage.map((boxes, i) => ({
      boxes,
      values: contentDeclarations[i] ?? {},
      ctx: {
        counters: numbers[i] ?? { page: i + 1, pages: records.length },
        ...(stringsPerPage[i] === undefined ? {} : { strings: stringsPerPage[i] }),
        ...(carriedPerPage[i] === undefined ? {} : { carried: carriedPerPage[i] }),
        elements: runningElements,
      },
    })),
  );
  paintCanvas(seq.pages);
}

/**
 * Number and break the equations on a page that will be kept.
 *
 * The measuring box had this done provisionally; this is the page that will
 * be shown, so the numbers here are the ones the author's `counter-reset`
 * asked for, and they are what `target-counter(#eq, equation)` resolves to.
 * Numbering comes before breaking because the number's gutter takes room from
 * the formula, and how much room is left decides where it breaks. Not in
 * `math/`, which is at 972 of its 1,000 lines.
 */
export function placeMath(
  content: HTMLElement,
  target: Document,
  from: number,
  into: Map<string, number>,
): number {
  const view = target.defaultView;
  if (view === null) return from;
  const { numbers, last } = numberEquations(content, view, { from });
  for (const [id, value] of numbers) into.set(id, value);
  breakEquations(content, { measurer: domMeasurer(content) });
  return last;
}
