/**
 * Footnotes (`doc/plan.md` §4, GCPM 3).
 *
 * A footnote is the clearest case of why a paged engine cannot be a stylesheet.
 * `float: footnote` takes an element out of the text and puts it at the foot of
 * *the page the call landed on* — so the note area's height depends on where
 * the page breaks, and where the page breaks depends on the note area's
 * height. Nothing in CSS can close that loop; the fragmenter can, by measuring
 * and trying again.
 *
 * The property arrives through the carrier of §5, and the two pseudo-elements
 * GCPM defines — `::footnote-call` and `::footnote-marker` — become real
 * elements with classes, which is what §5 prescribes for pseudo-elements the
 * browser has never heard of.
 */
import { carrierName } from "./css/rewrite.js";
import { domMeasurer, scratchRange } from "./dom-measurer.js";
import { domTextRanges, offsetAtLine } from "./text.js";
import { supports } from "./native.js";
import type { Deletion } from "./native.js";

export const CALL_CLASS = "folio-footnote-call";
export const MARKER_CLASS = "folio-footnote-marker";
export const AREA_CLASS = "folio-footnote-area";
export const NOTE_CLASS = "folio-footnote";
/** On what an element left in the flow (a note's call): the source path of the element. */
export const OUT_OF_FLOW = "data-folio-out-of-flow";

const AREA_STYLE_ID = "folio-footnote-rules";

/** A footnote taken out of the flow, with the call left in its place. */
export type Footnote = {
  number: number;
  /** The note itself, ready for the area. */
  note: HTMLElement;
  /** The call left behind in the text. */
  call: HTMLElement;
  /**
   * `footnote-policy`: what to do when the note will not fit on the page its
   * call is on. `line` moves the line holding the call to the next page,
   * `block` moves the whole block, `auto` leaves it to the engine.
   */
  policy: "auto" | "line" | "block";
  /** `footnote-display`: how the note sits in the area. */
  display: "block" | "inline" | "compact";
};

/**
 * Default presentation for the parts we generate.
 *
 * Deliberately thin: the author styles `.folio-footnote-call` and friends,
 * and everything here is what a reader would expect if they styled nothing.
 */
export function ensureFootnoteRules(target: Document): void {
  if (target.getElementById(AREA_STYLE_ID) !== null) return;

  const style = target.createElement("style");
  style.id = AREA_STYLE_ID;
  style.textContent = `
.${CALL_CLASS}, .${MARKER_CLASS} {
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
}
.${MARKER_CLASS} { margin-inline-end: 0.35em }
.${AREA_CLASS} {
  border-block-start: 1px solid currentColor;
  margin-block-start: 0.5em;
  padding-block-start: 0.35em;
  font-size: 0.85em;
}
.${NOTE_CLASS} { margin-block-end: 0.25em }
.${NOTE_CLASS}[data-display="inline"] { display: inline; margin-inline-end: 0.75em }
.${AREA_CLASS}[data-display="compact"] { display: flex; flex-wrap: wrap; gap: 0 0.75em }
`;
  target.head.append(style);
}

/**
 * Take the footnotes out of a composed fragment, leaving calls behind.
 *
 * Numbering continues from `from`, because a footnote's number is a property
 * of the document, not of the page it happens to land on.
 */
export function extractFootnotes(
  root: HTMLElement,
  view: Window,
  from: number,
): Footnote[] {
  const doc = root.ownerDocument;
  const property = carrierName("float");
  const found: Footnote[] = [];
  let next = from;

  for (const el of [...root.querySelectorAll("*")]) {
    if (view.getComputedStyle(el).getPropertyValue(property).trim() !== "footnote") continue;

    const number = next++;
    const style = view.getComputedStyle(el);
    const policy = keyword(style.getPropertyValue(carrierName("footnote-policy")), [
      "line",
      "block",
    ]) as "line" | "block" | undefined;
    const display = keyword(style.getPropertyValue(carrierName("footnote-display")), [
      "inline",
      "compact",
    ]) as "inline" | "compact" | undefined;

    const call = doc.createElement("folio-footnote-call");
    call.className = CALL_CLASS;
    call.dataset["footnote"] = String(number);
    call.textContent = String(number);
    // Which source element the note was: a break's offset is counted in the
    // box, where the note's text is not, and found in the source, where it is.
    const stamp = el.getAttribute("data-folio-path");
    if (stamp !== null) call.setAttribute(OUT_OF_FLOW, stamp);
    el.replaceWith(call);

    const note = doc.createElement("folio-footnote");
    note.className = NOTE_CLASS;
    note.dataset["footnote"] = String(number);
    // Carry the source stamp onto the note. A footnote is the one case where
    // text legitimately leaves the place it was written and appears further
    // down the page, so anything checking that the flow matches the source
    // needs to know which source element went where.
    const path = el.getAttribute("data-folio-path");
    if (path !== null) note.setAttribute("data-folio-path", path);

    const marker = doc.createElement("folio-footnote-marker");
    marker.className = MARKER_CLASS;
    marker.textContent = String(number);
    note.append(marker);
    while (el.firstChild !== null) note.append(el.firstChild);

    if (display !== undefined) note.dataset["display"] = display;
    // What may happen to it when it does not fit (`fillArea`).
    note.dataset["policy"] = policy ?? "auto";

    found.push({
      number,
      note,
      call,
      policy: policy ?? "auto",
      display: display ?? "block",
    });
  }

  return found;
}

/** Build the area that sits at the foot of a page. */
export function buildFootnoteArea(
  footnotes: readonly Footnote[],
  target: Document,
  style: AreaStyle = {},
): HTMLElement | null {
  return buildArea(
    footnotes.map((f) => f.note),
    target,
    style,
  );
}

/**
 * The `@footnote` rule's declarations for one page (`page-model.ts`), less
 * `max-height`, which is the area's cap (`capOf`) and not a style: the area
 * is split, not clipped (`review.md` §6).
 */
export type AreaStyle = Record<string, string>;

/** The area holding these note elements, styled by `@footnote`. */
function buildArea(notes: readonly HTMLElement[], target: Document, style: AreaStyle): HTMLElement | null {
  if (notes.length === 0) return null;
  const area = target.createElement("folio-footnotes");
  area.className = AREA_CLASS;
  for (const [property, value] of Object.entries(style)) {
    if (property !== "max-height" && property !== "max-block-size") area.style.setProperty(property, value);
  }
  // `compact` is a property of the area, not of one note: it means "run them
  // together if they fit". One compact note makes the area compact.
  if (notes.some((n) => n.dataset["display"] === "compact")) area.dataset["display"] = "compact";
  for (const note of notes) area.append(note);
  return area;
}

/** Put an area of these notes at the end of a page's content. */
export function appendNoteArea(content: HTMLElement, notes: readonly HTMLElement[], target: Document, style: AreaStyle): void {
  const area = buildArea(notes, target, style);
  if (area !== null) content.append(area);
}

/** How many of these note elements, from the first, fit whole in `cap`. */
export function notesFitting(notes: readonly HTMLElement[], cap: number, inlineSize: number, target: Document, style: AreaStyle): number {
  for (let n = notes.length; n > 0; n--) {
    if (measureNotes(notes.slice(0, n), inlineSize, target, style) <= cap) return n;
  }
  return 0;
}

/** The block size notes may take on a page: `@footnote`'s `max-height`, or the UA's 70%. */
export function capOf(style: AreaStyle, block: number, fallback: number): number {
  const value = (style["max-height"] ?? style["max-block-size"] ?? "").trim();
  const pct = /^([\d.]+)%$/.exec(value)?.[1];
  if (pct !== undefined) return (parseFloat(pct) / 100) * block;
  const px = /^([\d.]+)px$/.exec(value)?.[1];
  return px !== undefined ? parseFloat(px) : fallback;
}

/** The block size an area of these note elements takes, measured on clones. */
export function measureNotes(notes: readonly HTMLElement[], inlineSize: number, target: Document, style: AreaStyle): number {
  const area = buildArea(
    notes.map((n) => n.cloneNode(true) as HTMLElement),
    target,
    style,
  );
  if (area === null) return 0;
  const holder = target.createElement("folio-measure");
  holder.style.cssText = `display:block;inline-size:${inlineSize}px;position:absolute;visibility:hidden`;
  holder.append(area);
  target.body.append(holder);
  const height = holder.getBoundingClientRect().height;
  holder.remove();
  return height;
}

/**
 * Fill one page's area from `notes`, in order, up to `cap`.
 *
 * What fits is kept whole. The first note that does not fit is split after
 * its last line that does, when its policy is `auto` or it is already a
 * continuation (`review.md` §6). Its tail, and everything after it,
 * is carried to the next page. A note that cannot give even one line goes
 * whole to the next page. On a page with nothing else in its area, it is
 * kept whole even so, or it would travel forever.
 */
export function fillArea(
  notes: readonly HTMLElement[],
  cap: number,
  inlineSize: number,
  target: Document,
  style: AreaStyle,
): { kept: HTMLElement[]; carried: HTMLElement[] } {
  const kept: HTMLElement[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i] as HTMLElement;
    if (measureNotes([...kept, note], inlineSize, target, style) <= cap) {
      kept.push(note);
      continue;
    }
    const rest = notes.slice(i + 1);
    const splittable = note.dataset["policy"] !== "line" && note.dataset["policy"] !== "block";
    const parts = splittable ? splitToFit(note, kept, cap, inlineSize, target, style) : null;
    if (parts !== null) return { kept: [...kept, parts[0]], carried: [parts[1], ...rest] };
    if (kept.length === 0) return { kept: [note], carried: [...rest] };
    return { kept, carried: [note, ...rest] };
  }
  return { kept, carried: [] };
}

/** The note cut after its last line that still fits the area, or null. */
function splitToFit(
  note: HTMLElement,
  before: readonly HTMLElement[],
  cap: number,
  inlineSize: number,
  target: Document,
  style: AreaStyle,
): [HTMLElement, HTMLElement] | null {
  // Laid out where it will be: in an area of this width and style, after the
  // notes that fit, so its lines are the lines it will have.
  const area = buildArea(
    [...before.map((n) => n.cloneNode(true) as HTMLElement), note.cloneNode(true) as HTMLElement],
    target,
    style,
  );
  if (area === null) return null;
  const holder = target.createElement("folio-measure");
  holder.style.cssText = `display:block;inline-size:${inlineSize}px;position:absolute;visibility:hidden`;
  holder.append(area);
  target.body.append(holder);
  try {
    const laid = area.lastElementChild as HTMLElement;
    const measurer = domMeasurer(holder);
    const range = scratchRange(target);
    range.selectNodeContents(laid);
    const lines = measurer.lineBoxes(range).length;
    for (let k = lines - 1; k >= 1; k--) {
      const offset = offsetAtLine(laid, k, { measurer, ranges: domTextRanges() });
      if (offset === null || offset <= 0) continue;
      const [head, tail] = splitAt(note, offset);
      if (measureNotes([...before, head], inlineSize, target, style) <= cap) return [head, tail];
    }
    return null;
  } finally {
    holder.remove();
  }
}

/**
 * Cut an element at a character offset into two clones: everything before
 * it, and everything after. The tail is a continuation: no marker, and
 * `data-continued` for styling. Nothing is repeated or lost.
 */
export function splitAt(el: HTMLElement, offset: number): [HTMLElement, HTMLElement] {
  const head = el.cloneNode(false) as HTMLElement;
  const tail = el.cloneNode(false) as HTMLElement;
  let remaining = offset;
  const copy = (from: Node, into: [Node, Node]): void => {
    for (const child of [...from.childNodes]) {
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (remaining >= text.length) into[0].appendChild(child.cloneNode());
        else if (remaining <= 0) into[1].appendChild(child.cloneNode());
        else {
          into[0].appendChild(el.ownerDocument.createTextNode(text.slice(0, remaining)));
          into[1].appendChild(el.ownerDocument.createTextNode(text.slice(remaining)));
        }
        remaining -= text.length;
      } else if (remaining <= 0) {
        into[1].appendChild(child.cloneNode(true));
      } else {
        const a = child.cloneNode(false);
        const b = child.cloneNode(false);
        into[0].appendChild(a);
        copy(child, [a, b]);
        // An element the cut went through appears on both sides, as a split
        // box does; one wholly before it stays on the head's side only.
        if (b.childNodes.length > 0) into[1].appendChild(b);
      }
    }
  };
  copy(el, [head, tail]);
  tail.querySelector(`.${MARKER_CLASS}`)?.remove();
  tail.dataset["continued"] = "";
  return [head, tail];
}

/**
 * How much block space a set of footnotes needs, measured rather than guessed.
 *
 * The area is measured where the page is measured — same width, same
 * stylesheet — because a note that wraps to two lines takes two lines' worth
 * of the page away from the text.
 */
export function measureFootnoteArea(
  footnotes: readonly Footnote[],
  inlineSize: number,
  target: Document,
): number {
  const area = buildFootnoteArea(
    footnotes.map((f) => ({ ...f, note: f.note.cloneNode(true) as HTMLElement })),
    target,
  );
  if (area === null) return 0;

  const holder = target.createElement("folio-measure");
  holder.style.cssText = `display:block;inline-size:${inlineSize}px;position:absolute;visibility:hidden`;
  holder.append(area);
  target.body.append(holder);
  const height = holder.getBoundingClientRect().height;
  holder.remove();
  return height;
}

/** Read a keyword we understand, or nothing. */
function keyword(value: string, allowed: readonly string[]): string | undefined {
  const trimmed = value.trim().toLowerCase();
  return allowed.includes(trimmed) ? trimmed : undefined;
}

/** The nearest ancestor that starts its own block, for policy `block`. */
function blockAncestor(call: Element): Element | null {
  const view = call.ownerDocument.defaultView;
  if (view === null) return null;

  let node: Element | null = call.parentElement;
  while (node !== null) {
    const display = view.getComputedStyle(node).display;
    if (!display.startsWith("inline") && display !== "contents") return node;
    node = node.parentElement;
  }
  return null;
}

/** Which footnotes belong to a page: the ones whose call is above the break, or whose block starts above it for `block`. */
export function footnotesBefore(
  footnotes: readonly Footnote[],
  limit: number,
): Footnote[] {
  return footnotes.filter((f) => {
    const rect = f.call.getBoundingClientRect();
    // A call with no box has not been laid out; keeping it would reserve space
    // for a note whose call is not on this page.
    if (rect.height === 0) return false;
    // `footnote-policy: block`: the note is on every page its call's block
    // is on, so no break inside the block can leave it behind.
    const block = f.policy === "block" ? blockAncestor(f.call) : null;
    return rect.bottom <= limit || (block !== null && block.getBoundingClientRect().top < limit);
  });
}

/**
 * Take the footnotes out of the page's own composition and put them at its
 * foot. The page was measured with them already gone, so this is the same
 * transformation applied to the copy that will actually be shown. Returns how
 * many were placed, which is what the document's note count advances by.
 */
export function placeFootnotes(
  content: HTMLElement,
  target: Document,
  from: number,
  placed: Element[],
  room?: { carried: readonly HTMLElement[]; cap: number; inline: number; style: AreaStyle },
): { taken: number; carried: HTMLElement[] } {
  const view = target.defaultView;
  if (view === null) return { taken: 0, carried: [] };

  const footnotes = extractFootnotes(content, view, from);
  // Notes carried from the page before come first, and what does not fit
  // this page's cap is carried on (`fillArea`).
  const all = [...(room?.carried ?? []), ...footnotes.map((f) => f.note)];
  const { kept, carried } =
    room === undefined ? { kept: all, carried: [] } : fillArea(all, room.cap, room.inline, target, room.style);
  const area = buildArea(kept, target, room?.style ?? {});
  if (area !== null) content.append(area);
  placed.push(...kept);
  return { taken: footnotes.length, carried };
}

/**
 * Put a finished page's note area at the page's foot, where GCPM's footnote
 * area is and Paged.js puts it. It was appended after the text and so sat
 * wherever the text ended; `fillFragments` then took it down on pages that
 * end inside a split box and left it where it was on the rest.
 */
export function lowerFootnoteArea(content: Element, slack: number): void {
  // The end edge's page floats sit on the note area, and go down with it.
  const area = content.querySelector<HTMLElement>(`:scope > [data-edge="end"], :scope > .${AREA_CLASS}`);
  if (area === null || slack <= 0.5) return;
  const view = content.ownerDocument.defaultView;
  const margin = parseFloat(view?.getComputedStyle(area).marginBlockStart ?? "") || 0;
  area.style.setProperty("margin-block-start", `${String(margin + slack)}px`, "important");
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "footnotes",
  files: ["footnotes.ts"],
  feature: "`float: footnote` and the footnote area (GCPM 3)",
  when: "Every target browser implements `float: footnote`",
  tests: [],
  untested: "The pinned WPT set has no footnote test; `footnotes.spec.ts` is the check",
  native: () => supports("float", "footnote"),
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
