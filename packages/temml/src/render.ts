/**
 * TeX in the document, MathML out (`doc/tex.md`).
 *
 * `renderTeX` finds each formula (`find.ts`), takes out what the core should
 * number (`tex.ts`), converts the rest with Temml and puts the MathML where
 * the TeX was. It runs before stage 1 and changes the element it is given,
 * which is the one thing the engine itself never does: this is the author's
 * preprocessor, done in the open, not a stage.
 *
 * Every formula is converted in document order, because a `\newcommand` in
 * one is in force in the next, and replaced in reverse order, because a
 * replacement splits text nodes and the boundaries before it must stay valid.
 */
import temml from "temml";
import { DEFAULT_FIND, findTeX } from "./find.js";
import type { Boundary, FindOptions, Found } from "./find.js";
import { prepareTeX, REF_PLACEHOLDER } from "./tex.js";
import type { Prepared, Tags } from "./tex.js";
import { TEMML_CSS } from "./temml-css.js";

export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
/** The package's stylesheet. Not a `folio-` id: those are the engine's own
 * sheets, which it carries into the host; this one is author input. */
export const STYLE_ID = "tex-front-end";
/** A display the core numbers, through `math-number: yes`. */
export const NUMBERED_CLASS = "tex-numbered";
/** On a reference whose target has a `\tag`: the label to print. */
export const LABEL_ATTR = "data-tex-label";

export type TeXOptions = FindOptions & {
  tags?: Tags;
  /** `{ "\\RR": "\\mathbb{R}" }`, in force in every formula. */
  macros?: Record<string, string>;
  /** Keep the TeX as `<annotation encoding="application/x-tex">`. */
  annotate?: boolean;
  /** Show a formula that does not parse as its source, or throw. */
  onError?: "show" | "throw";
};

export type TeXReport = {
  /** Formulas converted, errors included. */
  formulas: number;
  errors: { tex: string; message: string }[];
  /** Opening delimiters with nothing to close them, and the text they are in. */
  unclosed: { open: string; context: string }[];
  /** A `\label` used twice, or an id the document already had. */
  duplicateLabels: string[];
  /** A second `\label` or `\tag` in one display, or a tag on inline math. */
  dropped: string[];
  /** `\ref` and `\eqref` to a key nothing in the document has as its id. */
  unresolved: string[];
};

/** The package's rules: the core's markers, the references, Temml's layout. */
export const TEX_CSS = `
:where(math.${NUMBERED_CLASS}) { math-number: yes }
a.tex-eqref::after { content: "(" target-counter(attr(href url), equation) ")" }
a.tex-ref::after { content: target-counter(attr(href url), equation) }
a.tex-eqref[${LABEL_ATTR}]::after { content: "(" attr(${LABEL_ATTR}) ")" }
a.tex-ref[${LABEL_ATTR}]::after { content: attr(${LABEL_ATTR}) }
${TEMML_CSS}`;

type Converted = { found: Found; node: Node | null };

/**
 * Convert the TeX under `root`. Idempotent: a second run finds nothing,
 * because the delimiters are gone and `math` is ignored.
 */
export function renderTeX(root: Element, options: TeXOptions = {}): TeXReport {
  const opts = { ...DEFAULT_FIND, tags: "ams" as Tags, annotate: true, onError: "show", ...options };
  const doc = root.ownerDocument;
  ensureStyles(doc);
  const report: TeXReport = { formulas: 0, errors: [], unclosed: [], duplicateLabels: [], dropped: [], unresolved: [] };
  const { found, unclosed } = findTeX(root, opts);
  for (const u of unclosed) report.unclosed.push({ open: u.open, context: u.at.node.data.trim().slice(0, 80) });

  // Shared by every formula, so a definition in one is in force in the next.
  const macros: Record<string, unknown> = { ...opts.macros };
  const labels = new Map<string, Prepared>();
  const refs: HTMLAnchorElement[] = [];
  const converted: Converted[] = found.map((f) => {
    if (f.kind === "escape") return { found: f, node: doc.createTextNode(f.text) };
    if (f.kind === "ref") {
      const a = anchor(doc, f.key, f.eq);
      refs.push(a);
      return { found: f, node: a };
    }
    report.formulas++;
    const prepared = prepareTeX(f.tex, { display: f.display, tags: opts.tags });
    report.dropped.push(...prepared.dropped);
    const math = convert(doc, f.tex, prepared, f.display, macros, opts, report);
    if (math === null) return { found: f, node: null };
    for (const a of math.querySelectorAll(`a.tex-ref, a.tex-eqref`)) refs.push(a as HTMLAnchorElement);
    if (prepared.label !== null) {
      if (labels.has(prepared.label) || doc.getElementById(prepared.label) !== null) {
        report.duplicateLabels.push(prepared.label);
      } else {
        labels.set(prepared.label, prepared);
        math.id = prepared.label;
      }
    }
    return { found: f, node: math };
  });

  for (let i = converted.length - 1; i >= 0; i--) {
    const c = converted[i];
    if (c !== undefined) replace(c.found.start, c.found.end, c.node);
  }

  // A reference to a `\tag`ged equation prints the tag. The core cannot: it
  // resolves `target-counter()` to numbers, and a tag is not one.
  for (const a of refs) {
    const key = a.getAttribute("href")?.slice(1) ?? "";
    const tag = labels.get(key)?.tag;
    if (tag !== undefined && tag !== null) a.setAttribute(LABEL_ATTR, tag.text);
    if (!labels.has(key) && doc.getElementById(key) === null) report.unresolved.push(key);
  }
  return report;
}

/** One formula to one `<math>`, or null when it only defined macros. */
function convert(
  doc: Document,
  source: string,
  prepared: Prepared,
  display: boolean,
  macros: Record<string, unknown>,
  opts: { annotate: boolean; onError: string },
  report: TeXReport,
): Element | null {
  let html: string;
  try {
    html = temml.renderToString(prepared.tex, {
      displayMode: display,
      annotate: opts.annotate,
      macros,
      throwOnError: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.onError === "throw") throw error;
    report.errors.push({ tex: source, message });
    return errorMath(doc, source, display);
  }

  const template = doc.createElement("template");
  template.innerHTML = html;
  const math = template.content.firstElementChild;
  if (math === null) return null;
  if (isEmpty(math)) return null;

  // The annotation is the author's TeX, not what Temml was given.
  const annotation = math.querySelector("annotation");
  if (annotation !== null) annotation.textContent = source;

  // `multline` has no inner form in Temml and comes back 100% wide, which
  // would fill the core's grid track rather than size it.
  for (const table of math.querySelectorAll("mtable")) {
    const style = table.getAttribute("style");
    if (style !== null) table.setAttribute("style", style.replace(/width:\s*100%;?/, ""));
  }

  for (const placeholder of math.querySelectorAll(`[href^="#${REF_PLACEHOLDER}"]`)) {
    const index = Number(placeholder.getAttribute("href")?.slice(REF_PLACEHOLDER.length + 1));
    const ref = prepared.refs[index];
    if (ref === undefined) continue;
    // An HTML link inside `<mtext>`, which is where MathML Core allows HTML;
    // Temml's is a MathML `a`, which Core does not have.
    const mtext = doc.createElementNS(MATHML_NS, "mtext");
    mtext.append(anchor(doc, ref.key, ref.eq));
    placeholder.replaceWith(mtext);
  }

  if (prepared.numbered) {
    if (prepared.tag === null) {
      math.classList.add(NUMBERED_CLASS);
    } else {
      const text = prepared.tag.bare ? prepared.tag.text : `(${prepared.tag.text})`;
      const style = math.getAttribute("style") ?? "";
      math.setAttribute("style", `${style}${style.endsWith(";") || style === "" ? "" : ";"}math-number: ${cssString(text)}`);
    }
  }
  return math;
}

/** A formula that only defined macros has nothing to show, as in MathJax. */
function isEmpty(math: Element): boolean {
  for (const el of math.querySelectorAll("*")) {
    if (!["semantics", "annotation", "annotation-xml"].includes(el.localName)) return false;
  }
  return true;
}

/** The source, shown where the formula was. */
function errorMath(doc: Document, source: string, display: boolean): Element {
  const math = doc.createElementNS(MATHML_NS, "math");
  if (display) math.setAttribute("display", "block");
  const merror = doc.createElementNS(MATHML_NS, "merror");
  const mtext = doc.createElementNS(MATHML_NS, "mtext");
  mtext.textContent = source;
  merror.append(mtext);
  math.append(merror);
  return math;
}

function anchor(doc: Document, key: string, eq: boolean): HTMLAnchorElement {
  const a = doc.createElement("a");
  a.className = eq ? "tex-eqref" : "tex-ref";
  a.setAttribute("href", `#${key}`);
  return a;
}

function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\s+/g, " ")}"`;
}

/**
 * Replace the text from `start` to `end` with `node`.
 *
 * Both ends are in text nodes of one string, and a string's text nodes are
 * siblings (`find.ts`: any element other than a join ends a string), so what
 * lies between them is siblings too.
 */
function replace(start: Boundary, end: Boundary, node: Node | null): void {
  if (start.node === end.node) {
    // Not `splitText`: the prefix must stay in the original node, where the
    // boundaries of the formulas before this one still point.
    const text = start.node.data;
    start.node.data = text.slice(0, start.offset);
    const after = start.node.ownerDocument.createTextNode(text.slice(end.offset));
    start.node.after(...(node === null ? [] : [node]), after);
    return;
  }
  let between = start.node.nextSibling;
  while (between !== null && between !== end.node) {
    const next = between.nextSibling;
    between.remove();
    between = next;
  }
  start.node.data = start.node.data.slice(0, start.offset);
  end.node.data = end.node.data.slice(end.offset);
  if (node !== null) end.node.before(node);
}

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TEX_CSS;
  // First, so that an author's rule of the same specificity — a reference
  // printed as "(3) in chapter 2" — comes later and wins. A document parsed
  // from a fragment can have no head, whatever `doc.head`'s type says.
  (doc.querySelector("head") ?? doc.documentElement).prepend(style);
}
