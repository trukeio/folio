/**
 * Stage 3, driven (`doc/plan.md` §2, §3).
 *
 * Enumerate, choose, compose, repeat. Each page is measured in the engine's
 * own frame and recorded as `(spec, start, end)` — positions in the source,
 * never nodes — so any page can be laid out again on its own later.
 *
 * The loop is small on purpose. Everything it does is in a tested piece
 * elsewhere: candidates in `candidates.ts`, the decision in `select.ts`, the
 * page's DOM in `compose.ts`, its geometry in `page-model.ts`. What is left
 * here is the order they happen in, and the one thing none of them can do
 * alone: carry a break found in a composed page back to the source it came
 * from. The pages either side of a break are `pages.ts`, and the stage 5 loop
 * that runs this again is `settle.ts`.
 */
import { composePage, SLICED, SOURCE_PATH, sourceRootIn, TEXT_START } from "./compose.js";
import { chunkFrom } from "./chunk.js";
import { counterWalk } from "./counters.js";
import { domMeasurer, scratchRange } from "./dom-measurer.js";
import { domTextRanges } from "./text.js";
import { enumerateCandidates } from "./candidates.js";
import { chooseBreak } from "./select.js";
import { FORCED } from "./penalties.js";
import { comparePositions, positionOf } from "./position.js";
import { contentArea, footnoteAreaFor, marginBoxesFor, resolvePageSpec } from "./page-model.js";
import { renderPageTemplate } from "./page-template.js";
import { CONTINUED, ensureFragmentRules, finishFragments } from "./fragments.js";
import { fillFragments, sizeFragments } from "./extents.js";
import { flowArea, rootFlow } from "./flow.js";
import type { Flow } from "./flow.js";
import type { Consumed } from "./extents.js";
import { collectPageState, takeRunningElements } from "./strings.js";
import { applyReferences } from "./references.js";
import {
  ensureFootnoteRules,
  extractFootnotes,
  footnotesBefore,
  lowerFootnoteArea,
  OUT_OF_FLOW,
  capOf,
  measureNotes,
  notesFitting,
  placeFootnotes,
} from "./footnotes.js";
import { extractFloats, planFloats, takeFloats } from "./page-floats.js";
import { fragmentIndex } from "./nth-fragment.js";
import type { PageFloat } from "./page-floats.js";
import { addBlankPages, addNotePages, contentValues, emptySequence, finishPages, placeMath, record, sideOf } from "./pages.js";
import { breakEquations } from "./math/compose.js";
import { ensureMathRules, numberEquations } from "./math/number.js";
import type { CounterValues } from "./counters.js";
import type { Reference } from "./references.js";
import type { Candidate } from "./penalties.js";
import type { PageRule } from "./css/page-rules.js";
import type { Footnote } from "./footnotes.js";
import type { PageRecord, Position } from "./types.js";

/**
 * The most of a page a footnote area may take.
 *
 * GCPM's answer to notes that do not fit is `footnote-policy` and splitting a
 * note across pages, which is M6. Until then this keeps the failure bounded:
 * the text always has somewhere to go, so the fragmenter always has a break to
 * choose, and the notes that cannot fit travel with their calls.
 */
const MAX_FOOTNOTE_SHARE = 0.7;

/**
 * How many times a page may be composed again because it came out too tall.
 *
 * Each attempt takes a strictly earlier break, so this terminates; the number
 * is how much work a bad first guess is allowed to cost. Two was not enough
 * for a page whose note area shrinks only when a call moves off it.
 */
const MAX_RECOMPOSE = 5;

/**
 * How much text the first measuring box of a document guesses at.
 *
 * Only the first: every page after it is estimated from the density the last
 * one measured, which is `plan.md` §3's "characters per page" read off the
 * page rather than assumed about it. A seed that is too small costs one extra
 * layout of a bounded box; one that is too large costs a page of wasted
 * measurement, so it errs small.
 */
const SEED_CHUNK = 4000;

/**
 * The least a chunk may ask for. A page measured absurdly long for its text
 * — one character and a 999in margin, WPT `page-name-orthogonal-writing-002`'s
 * reference — set the estimate near zero. The budget rounded to 0, and
 * doubling 0 grew nothing, forever.
 */
const MIN_CHUNK = 256;

/** How many pages' worth of characters to put in the box, by the estimate. */
const CHUNK_OVERSHOOT = 2.5;

/**
 * How far past the page the box must reach before its breaks are believed.
 *
 * A chunk that does not overflow the page proves nothing — the break may be
 * past its end — and a chunk that only just overflows can still lie about the
 * *lines* below the limit, which is what widows and orphans are counted from.
 * Half a page of clearance, and never less than this many pixels: on the 76px
 * pages of `infinite-loop` half a page is two lines.
 */
const MIN_CLEARANCE = 300;

/** A position past everything: the end of the document. */
const DOCUMENT_END: Position = { path: [Number.MAX_SAFE_INTEGER], offset: 0, after: false };

export type PaginateOptions = {
  /** The unchanging source subtree. */
  source: Element;
  pageRules: readonly PageRule[];
  /** Where pages are built and measured — the engine's own document. */
  target: Document;
  /** A hard stop, so a bug cannot paginate forever. */
  maxPages?: number;
  /** `target-counter()` calls to resolve, from `normalize`. */
  references?: readonly Reference[];
  /**
   * How many times stage 5 may send us back to stage 3.
   *
   * A page number written into the text can make the page longer, which moves
   * the break, which changes the page number (§11). The limit is what stops
   * that oscillating; the last layout is kept.
   */
  maxPasses?: number;
};

export type PaginateResult = {
  records: PageRecord[];
  /** The content areas, in order — where the flow was measured. */
  pages: HTMLElement[];
  /** The whole pages: paper, margin boxes and content. */
  sheets: HTMLElement[];
  /** Pages whose content did not fit: a bug upstream, reported not hidden. */
  overflowed: number[];
  /**
   * Elements taken out of the flow by `position: running()`, by name.
   *
   * Reported because they are the one lawful exception to "every source
   * character appears exactly once across the pages": they appear in margin
   * boxes instead, possibly on every page. A checker that does not know which
   * elements left the flow cannot tell that exception from lost content.
   */
  running: Map<string, Element>;
  /** Notes moved to the foot of a page, the other lawful reordering. */
  footnotes: Element[];
  /**
   * Every counter's value at each element that has an id: the author's own,
   * walked across the pages (`counters.ts`), plus `equation` from M4.
   * `target-counter(#chapter-3, chapter)` is answered from here, and the M4
   * exit check reads the `equation` entries to prove the numbering has no
   * gaps.
   */
  counters: Map<string, CounterValues>;
};

/** One layout of the whole document: stage 3 and 4, page by page. */
export function layoutOnce(
  options: PaginateOptions,
  pageOf: Map<string, number>,
  counterOf: Map<string, CounterValues>,
  references: readonly Reference[],
): PaginateResult {
  const { source, pageRules, target, maxPages = 2000 } = options;

  const seq = emptySequence();
  const { records, pages, sheets, boxesPerPage, contentDeclarations, stringsPerPage, carriedPerPage } = seq;
  // Named strings and running elements persist until something reassigns
  // them, which is what makes a running head survive the pages between one
  // chapter heading and the next.
  const carriedStrings = new Map<string, string>();
  // The same, for names assigned `content(element)`: a heading with a formula
  // in it reaches a running head as a clone, not as its text (`math.md` §6).
  const carriedNodes = new Map<string, Element>();
  const runningElements = new Map<string, Element>();
  // A footnote's number belongs to the document, not to the page it lands on.
  let nextFootnote = 1;
  // The same is true of an equation's, and for the same reason.
  let nextEquation = 0;
  const equationNumbers = new Map<string, number>();
  // The author's counters, carried from page to page (`counters.ts`). One
  // walk for the whole document: a counter does not restart because a page
  // did.
  // Ids are recorded only when a reference will ask for one; see `counterWalk`.
  const counters = counterWalk(references.some((r) => r.wants === "counter"), source);
  const placedFootnotes: Element[] = [];
  // The tail of a split note, and the notes after it, for the next page's
  // area (`review.md` §6).
  let carriedNotes: HTMLElement[] = [];
  // Page floats waiting for a page (`review.md` §7).
  let carriedFloats: PageFloat[] = [];
  const overflowed: number[] = [];

  const state = { carriedStrings, carriedNodes, stringsPerPage, carriedPerPage };

  let start: Position = { path: [], offset: 0, after: false };
  let index = 1;
  let name: string | null = null;
  // `margin-break: auto` keeps the margin after a forced break (`fragments.ts`).
  let afterForced = false;
  // Characters that fill one page, learned from the last one measured (§3).
  let charsPerPage = 0;

  // The rules the engine generates are part of what a page measures, so they
  // are in place before the first box rather than after it: a box measured
  // without them is measured against a page that will not exist.
  ensureFootnoteRules(target);
  ensureMathRules(target);
  // Which fragment each element is, when a stylesheet asks (`nth-fragment.ts`).
  const nth = fragmentIndex(target);
  const view = target.defaultView;
  // Pages progress the way the root's text does (`sideOf`).
  // The root's flow: what the content area and the measuring box take, and
  // which way pages progress (`flow.ts`, `review.md` §5).
  const flow = rootFlow(source.ownerDocument);
  const rtl = flow.leftward;

  while (index <= maxPages) {
    const side = sideOf(index, rtl);

    // A page takes its name from the content that starts it, which the break
    // before it said (`Candidate.page`); page one's is found below.
    let spec = resolvePageSpec(pageRules, { index, name, side, blank: false, flow });
    let box: HTMLElement;
    let area: { inline: number; block: number };

    // The box holds a chunk of what remains, not all of it (§3). Measuring
    // the whole remainder on every page is what makes pagination quadratic:
    // page 1 of a 300-page book lays out 300 pages to find one break.
    let budget = charsPerPage > 0 ? Math.max(MIN_CHUNK, Math.round(charsPerPage * CHUNK_OVERSHOOT)) : SEED_CHUNK;
    let chunk = chunkFrom(source, start, budget);
    let height: number;
    let candidateNotes: Footnote[];
    let boxFloats: PageFloat[];
    let startPage: string | null = null;

    for (;;) {
      area = flowArea(contentArea(spec), flow);
      box = makeMeasuringBox(target, area.inline, index > 1, afterForced, flow);
      box.append(
        composePage({ source, start, end: chunk.end ?? DOCUMENT_END, target, stampPaths: true }),
      );
      // A repeated header takes space: a break chosen against a layout without
      // it is a break chosen against a page that will not exist.
      finishFragments(box, source, nth);
      sizeFragments(box, start.consumed, null);

      // Both kinds of content that leave the flow leave it before anything is
      // measured: a running element is not in the flow at all, and a footnote
      // leaves a call behind. Measuring with either still in place measures a
      // page that will not exist — and measuring the *chunk* with them in
      // place would let a box of running heads pass for a box of text.
      if (view !== null) takeRunningElements(box, view, runningElements);
      candidateNotes = view === null ? [] : extractFootnotes(box, view, nextFootnote);
      boxFloats = view === null ? [] : extractFloats(box, view);
      height = usedHeight(box);

      // Too little left in the box to trust it: grow and measure again. This
      // terminates because the budget doubles and a chunk that reaches the end
      // of the document reports `end: null`, which is the whole remainder and
      // the case the rest of this loop was always written against.
      if (chunk.end !== null && height < area.block + Math.max(area.block / 2, MIN_CLEARANCE)) {
        budget = Math.max(MIN_CHUNK, budget * 2);
        chunk = chunkFrom(source, start, budget);
        box.remove();
        continue;
      }

      // What one page of this document costs, in characters — read off the
      // box just measured rather than assumed, and smoothed so that one
      // unusual page does not set the estimate for the next.
      if (chunk.characters > 0 && height > 0) {
        const perPage = (chunk.characters / height) * area.block;
        charsPerPage = charsPerPage > 0 ? (charsPerPage + perPage) / 2 : perPage;
      }
      break;
    }
    // Breaks are between the source root's children, whatever chain of the
    // root's ancestors the page holds around them (`compose.ts`).
    const root = sourceRootIn(box);
    const measurer = domMeasurer(box);
    const origin = measurer.box(box).blockStart;
    // Math before candidates: an equation too wide for the measure becomes a
    // stack of rows, which is taller than the single line the page would
    // otherwise have been measured against (`math.md` §4). The numbers here
    // are provisional — the box holds everything that remains — and only
    // their width matters, because the gutter they sit in takes room from the
    // formula.
    if (view !== null) {
      const until = { measurer, limit: origin + area.block };
      numberEquations(box, view, { from: nextEquation, resets: false, until });
      breakEquations(box, { measurer, limit: until.limit });
    }
    const all = enumerateCandidates(root, {
      measurer,
      fragmentainer: area.block,
      rangeFor: (el) => {
        const range = scratchRange(target);
        range.selectNodeContents(el);
        return range;
      },
      textRanges: domTextRanges(),
      onStartPage: (page) => (startPage = page === "" ? null : page),
      limit: origin + area.block,
    });

    // Page one is named by what it starts with, known only now. A name that
    // changes the page's area means measuring again under it; that cannot
    // cycle, because the second measurement starts with the name.
    if (records.length === 0 && startPage !== name) {
      name = startPage;
      spec = resolvePageSpec(pageRules, { index, name, side, blank: false, flow });
      const next = flowArea(contentArea(spec), flow);
      if (next.inline !== area.inline || next.block !== area.block) {
        box.remove();
        continue;
      }
    }

    const marginBoxes = marginBoxesFor(pageRules, {
      index,
      name,
      side: spec.side,
      blank: false,
    });

    const { page, content, boxes } = renderPageTemplate({ spec, marginBoxes, target, afterForced, flow });
    // A page that begins inside a box shows it shifted up (`compose.ts`); what
    // rises above the page area is the pages before's.
    content.style.writingMode = flow.writingMode;
    content.style.direction = flow.direction;
    if (start.slice !== undefined) content.style.clipPath = clipBefore(flow);
    target.body.append(page);
    sheets.push(page);
    boxesPerPage.push(boxes);
    contentDeclarations.push(contentValues(marginBoxes));


    // A page exists if a box starts on it, and not otherwise (`review.md` §2
    // §4). A break at or before the first box would put nothing on the page:
    // it stalls the loop, and a forced break there is at the start of the
    // fragmentainer, which CSS Break 3 ignores — a document whose named page
    // begins at its first element is `named-page/no-forced-page-break`. A
    // break after it leaves that box, even an empty one, and WPT's
    // `zero-height-page-break-001` says an empty box is a page. Positions, not
    // extents: a first box that paints nothing is still the first box.
    const firstBox = firstBoxIn(root);
    const candidates =
      firstBox === null ? [] : all.filter((c) => comparePositions(c.position, firstBox) > 0);

    // The note area takes its space from the same page the text wants, so
    // which breaks fit depends on which notes are called above them. A page's
    // text and its notes both grow as the break moves down, so the breaks
    // whose page fits are a prefix of the candidates, and the last of them is
    // found by bisection (`review.md` §6.3). Notes carried from the
    // page before come first. An `auto` note that does not fit whole is split
    // and the area takes its cap, `@footnote`'s `max-height` or 70%: the text
    // keeps a share of the page, which fourteen notes once wanted 994px of.
    // A `line` or `block` note goes with its call, so no break after the call
    // fits.
    const footStyle = footnoteAreaFor(pageRules, { index, name, side: spec.side, blank: false });
    const cap = capOf(footStyle, area.block, area.block * MAX_FOOTNOTE_SHARE);
    const blockEnd = origin + area.block;
    // Page floats take their space the same way (`review.md` §7).
    const geometry = { origin, block: area.block, inline: area.inline, writingMode: flow.writingMode };
    const floats = planFloats([...carriedFloats, ...boxFloats], geometry, target, (el) => measurer.box(el).blockStart);
    const notesFor = (extent: number): number | null => {
      const all = [...carriedNotes, ...footnotesBefore(candidateNotes, extent).map((f) => f.note)];
      if (all.length === 0) return 0;
      const height = measureNotes(all, area.inline, target, footStyle);
      if (height <= cap) return height;
      const out = notesFitting(all, cap, area.inline, target, footStyle);
      const policy = all[out]?.dataset["policy"];
      return out >= carriedNotes.length && (policy === "line" || policy === "block") ? null : cap;
    };
    const reserve = (extent: number): number | null => {
      const notes = notesFor(extent);
      return notes === null ? null : notes + floats.above(extent);
    };
    let limit = blockEnd;
    let allowed = candidates;
    if (candidateNotes.length > 0 || carriedNotes.length > 0 || floats.edges.size > 0) {
      const extents = [...new Set(candidates.map((c) => c.extent))].filter((e) => e <= blockEnd).sort((x, y) => x - y);
      let best = -1;
      for (let lo = 0, hi = extents.length - 1; lo <= hi; ) {
        const mid = (lo + hi) >> 1;
        const extent = extents[mid] as number;
        const reserved = reserve(extent);
        if (reserved !== null && extent + reserved <= blockEnd) {
          best = mid;
          limit = blockEnd - reserved;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      // Nothing fits: a note too tall for the page, at its first line. It is
      // placed whole (`fillArea`) rather than lost.
      if (best >= 0) allowed = candidates.filter((c) => c.extent <= (extents[best] as number));
      else limit = blockEnd - cap;
    }
    const choice = chooseBreak(allowed, limit);

    // The box, not its ink, was the old test here — and the box of an
    // absolutely positioned measuring div includes the last paragraph's
    // bottom margin, because nothing collapses through a formatting context.
    // A document whose ink ended at 402px in a 408px area measured 420 and
    // was split in two (`page-rules/size/landscape`). A margin adjoining the
    // end of a fragmentainer does not have to fit in it.
    //
    // And it can only be said of a box that holds everything that is left: a
    // chunk that fits fits because it was cut, not because the document ended.
    // The growth loop above makes that state unreachable; saying it here as
    // well is what keeps it unreachable when the growth rule is next tuned.
    const fits = chunk.end === null && origin + usedHeight(box) <= limit;

    // "The rest fits" is not enough to stop. A forced break is an instruction,
    // not a preference about space (§9 makes honouring it an invariant), so a
    // document whose remainder fits on one page must still be split where it
    // says to split. Stopping on fit alone turned a 39-page fixture into two.
    const isForced = choice !== null && choice.candidate.penalty === FORCED;

    // "Everything that is left fits on this page" is a claim about a page
    // that has not been composed yet, and the measuring box's estimate of the
    // note area is not the note area. So the last page has to prove it: if it
    // comes out too tall and a break was available, it was not the last page.
    if (choice === null || (fits && !isForced)) {
      const lastPage = target.createElement("folio-flow");
      lastPage.append(composePage({ source, start, end: DOCUMENT_END, target, stampPaths: true }));
      content.append(lastPage);
      finishFragments(content, source, nth);
      sizeFragments(content, start.consumed, pageEnd(content, area));
      const trialNotes: Element[] = [];
      const trialFloats = view === null ? [] : takeFloats(content, view, carriedFloats, floats, target);
      const trial = placeFootnotes(content, target, nextFootnote, trialNotes, { carried: carriedNotes, cap, inline: area.inline, style: footStyle });
      const pageView = target.defaultView;
      if (pageView !== null) takeRunningElements(content, pageView, runningElements);
      lastPage.replaceWith(...lastPage.childNodes);
      // Before the height is read: a broken equation is a stack of rows, and
      // a page whose last equation breaks is taller than this trial thought.
      // The count is not carried on: this is the last page, and nothing
      // reads it again — but the numbers it writes are what is printed.
      placeMath(content, target, nextEquation, equationNumbers);

      // A page nothing starts on is not a page. `break-after: page` on the
      // last visible block, with only `display: none` siblings and a
      // `<script>` after it, is two corpus fixtures, and neither engine prints
      // a page for it; an empty `<div>` after it would be one.
      if (records.length > 0 && firstBoxIn(sourceRootIn(content)) === null) {
        page.remove();
        sheets.pop();
        boxesPerPage.pop();
        contentDeclarations.pop();
        box.remove();
        break;
      }

      const excess = usedHeight(content) - area.block;
      if (excess <= 1 || choice === null) {
        // The footnote counter is not advanced here: this is the last page
        // and nothing reads it again.
        placedFootnotes.push(...trialNotes);
        carriedNotes = trial.carried;
        carriedFloats = trialFloats;
        box.remove();
        lowerFootnoteArea(content, area.block - usedHeight(content));
        applyReferences(content, references, pageOf, counterOf, source);
        collectPageState(content, target, state, runningElements, counters);
        if (excess > 1) overflowed.push(index);
        records.push(record(spec, start, DOCUMENT_END));
        pages.push(content);
        break;
      }
      // Not the last page after all: undo and take the break.
      content.replaceChildren();
    }

    let end = toSourcePosition(choice.candidate, root, source, start);
    if (end === null || comparePositions(end, start) <= 0) {
      // A break that does not advance would paginate forever. Stop and say so
      // rather than spin: plan.md §11's oscillation risk, in its simplest form.
      box.remove();
      content.append(composePage({ source, start, end: DOCUMENT_END, target, stampPaths: true }));
      finishFragments(content, source, nth);
      sizeFragments(content, start.consumed, pageEnd(content, area));
      if (view !== null) carriedFloats = takeFloats(content, view, carriedFloats, floats, target);
      carriedNotes = placeFootnotes(content, target, nextFootnote, placedFootnotes, { carried: carriedNotes, cap, inline: area.inline, style: footStyle }).carried;
      placeMath(content, target, nextEquation, equationNumbers);
      applyReferences(content, references, pageOf, counterOf, source);
      collectPageState(content, target, state, runningElements, counters);
      // Measured, not assumed: a break that could not be chosen does not mean
      // the page that resulted is too tall, and reporting it as overflow
      // names pages that fit.
      if (usedHeight(content) - area.block > 1) overflowed.push(index);
      records.push(record(spec, start, DOCUMENT_END));
      pages.push(content);
      break;
    }
    // The measuring box held everything that remained so the fragmenter could
    // see where to cut. The page holds only this page.
    box.remove();

    // Compose the page, then *measure the page*, rather than trusting the
    // decision that produced it. The notes actually placed can differ from the
    // ones the measuring box predicted — it holds everything that remains, so
    // its guess is contradicted by the very break that follows from it — and a
    // taller note area than reserved makes the page overflow. §9 says no page
    // overflows: this is where that is checked rather than inferred.
    let placedHere: Element[];
    let taken: number;
    let carriedOn: HTMLElement[];
    let floatsOn: PageFloat[] = [];
    let lastEquation: number;
    let consumed: Consumed;
    let chosenExtent = choice.candidate.extent;
    let chosenPage = choice.candidate.page;

    for (let attempt = 0; ; attempt++) {
      placedHere = [];
      content.replaceChildren();
      content.append(composePage({ source, start, end, target, stampPaths: true }));
      finishFragments(content, source, nth);
      // A split box's share of this page, carried to the next (`extents.ts`).
      consumed = sizeFragments(content, start.consumed, pageEnd(content, area));
      // Advance by what was actually placed, not by what the measurement
      // predicted; every over-count became a gap in the numbering.
      if (view !== null) floatsOn = takeFloats(content, view, carriedFloats, floats, target);
      ({ taken, carried: carriedOn } = placeFootnotes(content, target, nextFootnote, placedHere, { carried: carriedNotes, cap, inline: area.inline, style: footStyle }));
      // Each attempt composes the page again from the source, so each one
      // numbers from the same place; only the attempt that is kept advances
      // the count.
      lastEquation = placeMath(content, target, nextEquation, equationNumbers);
      // And out of the page before the page is measured, exactly as they went
      // out of the measuring box before the candidates were enumerated. A
      // running element is not in the flow; measured with one still in it, a
      // page that fits looks too tall, and the loop below takes a tighter
      // break to make room for something that will not be there. On
      // `issues/duplicate-headers` that cost a break at 630px of a 643px
      // area, fell back to 547, and left each chapter a 65px page of its own
      // — two extra pages in eight. The last-page path opposite has always
      // done this; this one had not.
      if (view !== null) takeRunningElements(content, view, runningElements);

      const excess = usedHeight(content) - area.block;
      if (excess <= 1 || attempt >= MAX_RECOMPOSE) {
        if (excess > 1) overflowed.push(index);
        break;
      }

      // Too tall: take an earlier break and compose again.
      const tighter = chooseBreak(
        candidates.filter((c) => c.extent < chosenExtent),
        limit - excess,
      );
      if (tighter === null) {
        overflowed.push(index);
        break;
      }
      const tighterEnd = toSourcePosition(tighter.candidate, root, source, start);
      if (tighterEnd === null || comparePositions(tighterEnd, start) <= 0) {
        overflowed.push(index);
        break;
      }
      end = tighterEnd;
      chosenExtent = tighter.candidate.extent;
      chosenPage = tighter.candidate.page;
    }

    nextFootnote += taken;
    carriedNotes = carriedOn;
    carriedFloats = floatsOn;
    nextEquation = lastEquation;
    placedFootnotes.push(...placedHere);
    nth?.advance(content);
    applyReferences(content, references, pageOf, counterOf, source);
    collectPageState(content, target, state, runningElements, counters);

    if (Object.keys(consumed).length > 0) end = { ...end, consumed };
    fillFragments(content, area.block - usedHeight(content));
    lowerFootnoteArea(content, area.block - usedHeight(content));
    records.push(record(spec, start, end));
    pages.push(content);

    start = end;
    index++;
    afterForced = isForced;

    index = addBlankPages(
      seq,
      { index, name, end, breakValue: choice.candidate.breakValue, maxPages, rtl, flow },
      pageRules,
      target,
      state,
      counters,
    );
    // After the blank pages, which keep the name of the page before them.
    if (chosenPage !== undefined) name = chosenPage === "" ? null : chosenPage;
  }

  // The text ran out before its notes or floats did.
  if (carriedNotes.length > 0 || carriedFloats.length > 0) {
    const at = { index: records.length + 1, name, end: DOCUMENT_END, maxPages, rtl, flow };
    addNotePages(seq, at, { notes: carriedNotes, floats: carriedFloats }, pageRules, target, state, counters, placedFootnotes);
  }

  finishPages(seq, pageRules, counters, runningElements);

  return {
    records,
    pages,
    sheets,
    overflowed,
    running: runningElements,
    footnotes: placedFootnotes,
    counters: counters.resolve(equationNumbers),
  };
}

/**
 * Where the first box on a page is: the first element with a client rect, or
 * the first text that renders. Null if nothing generates a box at all.
 */
function firstBoxIn(root: Element): Position | null {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 0x1 | 0x4); // elements and text
  const range = scratchRange(doc);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      if ((n.textContent ?? "").trim() === "") continue;
      range.selectNodeContents(n);
    }
    if ((n.nodeType === 3 ? range : (n as Element)).getClientRects().length > 0) {
      return positionOf(n, root);
    }
  }
  return null;
}

/**
 * How much block space a page's content really uses.
 *
 * Not the content box's rect: it is a grid item with a fixed track, so its
 * height is the cell's however much is inside. Not `scrollHeight` either —
 * that is an integer, and a page 0.4px inside its area comes back a pixel
 * over, which is how a page that fits gets reported as overflowing. The
 * children's own rects are fractional and are not clipped.
 */
/** How far the content reaches in the block axis, from the area's start. */
function usedHeight(content: HTMLElement): number {
  const measurer = domMeasurer(content);
  const top = measurer.box(content).blockStart;
  let bottom = top;
  const range = scratchRange(content.ownerDocument);
  for (const child of [...content.childNodes, ...sourceRootIn(content).childNodes]) {
    // Text directly in the page is content too: a sentence after the last
    // block overflowed unreported (`subpixel-page-size-002`).
    if (child.nodeType === 3) {
      range.selectNode(child);
      for (const line of measurer.lineBoxes(range)) bottom = Math.max(bottom, line.blockEnd);
    } else if (child.nodeType === 1) bottom = Math.max(bottom, measurer.box(child as Element).blockEnd);
  }
  // A sliced box's ink is the page's too, where it overflows the box.
  const view = content.ownerDocument.defaultView;
  for (const sliced of content.querySelectorAll(`[${SLICED}]`)) {
    const style = view?.getComputedStyle(sliced);
    if (style === undefined || style.overflowBlock !== "visible" || /paint|strict|content/.test(style.contain)) continue;
    bottom = Math.max(bottom, ...measurer.boxes([...sliced.querySelectorAll("*")]).map((r) => r.blockEnd));
  }
  return bottom - top;
}

/** Where a page area ends in the block axis. */
function pageEnd(content: HTMLElement, area: { block: number }): number {
  return domMeasurer(content).box(content).blockStart + area.block;
}

/** A clip that hides only what rises before the block-start edge. */
function clipBefore(flow: Flow): string {
  if (!flow.vertical) return "inset(0 -100vw -100vw -100vw)";
  return /-rl$/.test(flow.writingMode) ? "inset(-100vw 0 -100vw -100vw)" : "inset(-100vw -100vw -100vw 0)";
}

function makeMeasuringBox(
  target: Document,
  inlineSize: number,
  continued: boolean,
  afterForced: boolean,
  flow: Flow,
): HTMLElement {
  ensureFragmentRules(target);
  const box = target.createElement("folio-measure");
  // The measuring box must fragment like the page it stands in for, or the
  // break is chosen against a layout the page will not have.
  if (continued) box.setAttribute(CONTINUED, afterForced ? "forced" : "");
  box.style.cssText = [
    `inline-size:${inlineSize}px`,
    // The root's flow, so the measurer reads its rectangles logically.
    `writing-mode:${flow.writingMode}`,
    `direction:${flow.direction}`,
    // No block-size and nothing clipping: the box grows to whatever it holds,
    // which is what makes overflow visible to a measurement.
    "display:block",
    "position:absolute",
    "inset-block-start:0",
    "visibility:hidden",
  ].join(";");
  target.body.append(box);
  return box;
}

/**
 * A break found in the composed page, as a position in the source.
 *
 * This is the only place the two trees meet. The composed page is missing
 * everything before `start`, so its paths are its own; the stamps put there by
 * composition are what make the journey back possible.
 */
export function toSourcePosition(
  candidate: Candidate,
  box: Element,
  source?: Element,
  start?: Position,
): Position | null {
  const node = resolveInBox(box, candidate.position.path);
  if (node === null) return null;
  // Before a text node, or — a line of text no element holds — inside one.
  if (node.nodeType === 3) return textInSource(node, box, source, start, candidate.position.offset);

  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (element === null) return null;

  const stamped = element.closest(`[${SOURCE_PATH}]`);
  if (stamped === null) return null;

  const path = stampOf(stamped);
  if (path === null) return null;

  if (candidate.kind !== "line") {
    const { slice } = candidate.position;
    return slice === undefined ? { path, offset: 0, after: false } : { path, offset: 0, after: false, slice };
  }

  // A line break is an offset into this element's text *as a whole*, counted
  // across its descendants, and the clone's text may start part-way into the
  // source's. Turning that into a position means finding which text node holds
  // that character — the first one only works for a paragraph with no markup
  // inside it, and prose usually has some.
  const textStart = Number(stamped.getAttribute(TEXT_START) ?? "0");
  const holder = source === undefined ? stamped : resolveInSource(source, path);
  if (holder === null) return { path, offset: 0, after: false };

  // Counted outside notes on both sides: the box has each note's call, and
  // the source its text. Counting either as text put breaks inside notes,
  // and a note cut in two was numbered twice.
  const range = scratchRange(stamped.ownerDocument);
  let offset = candidate.position.offset;
  const notes = new Set<Node>();
  for (const call of stamped.querySelectorAll(`[${OUT_OF_FLOW}]`)) {
    range.setStart(stamped, 0);
    range.setEndBefore(call);
    const at = range.toString().length;
    if (at < candidate.position.offset) offset -= Math.min(call.textContent.length, candidate.position.offset - at);
    const notePath = (call.getAttribute(OUT_OF_FLOW) ?? "").split(".").filter((p) => p !== "").map(Number);
    const note = source === undefined ? null : resolveInSource(source, notePath);
    if (note !== null) notes.add(note);
  }
  const hit = textNodeAt(holder, textStart, offset, notes);
  if (hit === null) return { path, offset: 0, after: false };

  return { path: [...path, ...hit.path], offset: hit.offset, after: false };
}

/** The source path composition stamped on a clone, or null. */
function stampOf(el: Element): number[] | null {
  const path = (el.getAttribute(SOURCE_PATH) ?? "").split(".").filter((p) => p !== "").map(Number);
  return path.some(Number.isNaN) ? null : path;
}

/**
 * A break before text beside blocks, in the source: the same text node, found
 * after the nearest element before it that composition stamped, or in its
 * parent. Text directly in the measuring box has no stamped element above it
 * at all — the box stands in for the source root — which is why this does not
 * go through `closest`. The text is compared rather than counted, because
 * running elements and notes leave the box and not the source.
 */
function textInSource(node: Node, box: Element, source?: Element, start?: Position, offset = 0): Position | null {
  // `nodeType`, not `instanceof`: the box is in the engine's frame, another realm.
  const stamped = (n: Node | null): n is Element =>
    n?.nodeType === 1 && (n as Element).hasAttribute(SOURCE_PATH);
  let anchor = node.previousSibling;
  while (anchor !== null && !stamped(anchor)) anchor = anchor.previousSibling;
  const from = anchor ?? node.parentElement;
  const at = from === box ? [] : stamped(from) ? stampOf(from) : null;
  if (source === undefined || at === null) return null;

  const parentPath = anchor === null ? at : at.slice(0, -1);
  const parent = parentPath.length === 0 ? source : resolveInSource(source, parentPath);
  // The clone is the source text less what the page began past, if the page
  // began inside it, and less what the measuring box's chunk cut off its end.
  for (let i = anchor === null ? 0 : (at.at(-1) ?? -1) + 1; i < (parent?.childNodes.length ?? 0); i++) {
    const n = parent?.childNodes[i];
    const path = [...parentPath, i];
    const from = start !== undefined && start.path.join() === path.join() ? start.offset : 0;
    if (n?.nodeType === 3 && (n.textContent ?? "").slice(from).startsWith(node.textContent ?? "")) {
      return { path, offset: from + offset, after: false };
    }
  }
  return null;
}

/**
 * The descendant text node holding character `offset`, and where in it.
 *
 * Written as a plain recursion returning a value rather than a closure setting
 * an outer variable: TypeScript cannot follow the latter, and reads everything
 * after the assignment as unreachable.
 */
function textNodeAt(
  element: Node,
  skip: number,
  offset: number,
  notes: ReadonlySet<Node>,
): { path: number[]; offset: number } | null {
  // `skip` characters of any text, then `offset` of text outside `notes`.
  const walker = element.ownerDocument?.createTreeWalker(element, 0x4);
  for (let t = walker?.nextNode() ?? null; t !== null; t = walker?.nextNode() ?? null) {
    const length = (t.textContent ?? "").length;
    const start = Math.min(skip, length);
    skip -= start;
    if (skip > 0 || [...notes].some((n) => n.contains(t))) continue;
    if (offset <= length - start) {
      // At a text's end, a `<br>` after it ended this line: the next page
      // starts at the text after it, or it starts with an empty line.
      let n = start + offset === length && length > 0 ? t.nextSibling : null;
      while (n !== null && /^(br|wbr)$/i.test(n.nodeName)) n = n.nextSibling;
      const next = n?.nodeType === 3 && n !== t.nextSibling;
      const path: number[] = [];
      for (let p: Node = next ? (n as Node) : t; p !== element && p.parentNode !== null; p = p.parentNode) {
        path.unshift([...p.parentNode.childNodes].indexOf(p as ChildNode));
      }
      return { path, offset: next ? 0 : start + offset };
    }
    offset -= length - start;
  }
  return null;
}

function resolveInSource(source: Element, path: readonly number[]): Element | null {
  let node: Node = source;
  for (const index of path) {
    const next: Node | undefined = node.childNodes[index];
    if (next === undefined) return null;
    node = next;
  }
  return node.nodeType === 1 ? (node as Element) : null;
}

function resolveInBox(box: Element, path: readonly number[]): Node | null {
  let node: Node = box;
  for (const index of path) {
    const next = node.childNodes[index];
    if (next === undefined) return null;
    node = next;
  }
  return node;
}
