/**
 * What the package takes out of a formula before Temml sees it (`doc/tex.md`
 * §4).
 *
 * Temml numbers equations itself — a 100%-wide `mtable` with a tag column,
 * counted by its own CSS — and mangles labels (`eq:ab` becomes `eqab`), and
 * its `\eqref` is an empty link its post-processor fills. None of it knows
 * the page. So numbering, labels, tags and references are taken out here and
 * handed to the core, which numbers against the page, and Temml gets a
 * formula with nothing to number.
 *
 * Pure string work: no DOM, no Temml.
 */
import { DISPLAY_ENVIRONMENTS } from "./find.js";

/** Which displays are numbered: AMS's rule, every display, or none. */
export type Tags = "ams" | "all" | "none";

export type PrepareOptions = {
  display: boolean;
  tags?: Tags;
};

export type Prepared = {
  /** What Temml is given. */
  tex: string;
  numbered: boolean;
  /** The first `\label`, verbatim. */
  label: string | null;
  /** `\tag{7a}` prints `(7a)`; `\tag*{7a}` prints `7a`, bare. */
  tag: { text: string; bare: boolean } | null;
  /** In order: `\ref{texref<i>}` in `tex` stands for `refs[i]`. */
  refs: { key: string; eq: boolean }[];
  /** A second `\label` or `\tag` in one formula: one number per display. */
  dropped: string[];
};

/** Placeholders Temml passes through untouched: letters and digits only. */
export const REF_PLACEHOLDER = "texref";

/**
 * Environments unwrapped into their inner forms, which Temml renders with no
 * tag column. `multline` has no inner form in Temml (no `multlined`), so it
 * becomes its starred self; `render.ts` takes the 100% width off.
 */
const UNWRAP: Record<string, string> = {
  equation: "",
  align: "aligned",
  flalign: "aligned",
  alignat: "alignedat",
  gather: "gathered",
  multline: "multline*",
};

const ENVIRONMENT = /^\s*\\begin\s*\{([a-zA-Z]+)(\*?)\}([\s\S]*)\\end\s*\{\1\2\}\s*$/;

/** Prepare one formula for Temml, and say how the core should number it. */
export function prepareTeX(source: string, { display, tags = "ams" }: PrepareOptions): Prepared {
  const out: Prepared = { tex: source, numbered: false, label: null, tag: null, refs: [], dropped: [] };

  let body = source;
  let env: { name: string; starred: boolean } | null = null;
  const m = ENVIRONMENT.exec(source);
  if (m !== null && DISPLAY_ENVIRONMENTS.includes(`${m[1] ?? ""}${m[2] ?? ""}`)) {
    env = { name: m[1] ?? "", starred: m[2] === "*" };
    body = m[3] ?? "";
  }

  // Row by row, because AMS numbers a row unless it says `\notag`, and one
  // number per display means "numbered if any row is".
  let anyRowNumbered = false;
  const rows = splitRows(body).map((row) => {
    const { text, notag } = extract(row, out);
    if (!notag) anyRowNumbered = true;
    return text;
  });
  body = rows.join("\\\\");

  let tex = body;
  if (env !== null) {
    const inner = UNWRAP[env.name] ?? "";
    if (inner === "") {
      tex = body;
    } else if (env.name === "alignat") {
      // `\begin{alignat}{2}`: the column count is the body's first group.
      const cols = /^\s*\{[^{}]*\}/.exec(body);
      const count = cols?.[0] ?? "{1}";
      tex = `\\begin{${inner}}${count}${body.slice(count.length)}\\end{${inner}}`;
    } else {
      tex = `\\begin{${inner}}${body}\\end{${inner}}`;
    }
  }
  out.tex = rewriteDefinitions(tex);

  if (!display) {
    // An inline formula is never numbered. A tag there has nowhere to go.
    if (out.tag !== null) out.dropped.push(`\\tag{${out.tag.text}}`);
    out.tag = null;
    return out;
  }
  if (out.tag !== null) out.numbered = true;
  else if (tags === "all") out.numbered = env?.starred !== true && anyRowNumbered;
  else if (tags === "ams") out.numbered = env !== null && !env.starred && anyRowNumbered;
  return out;
}

/**
 * Split at the `\\` that ends a row of *this* formula: not one inside braces,
 * nor one inside a nested environment such as `cases`.
 */
export function splitRows(tex: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\\") {
      const word = controlWord(tex, i);
      if (word === "begin") depth++;
      else if (word === "end") depth--;
      else if (word === "\\" && depth === 0) {
        rows.push(tex.slice(from, i));
        from = i + 2;
      }
      i += word.length;
    }
  }
  rows.push(tex.slice(from));
  return rows;
}

/** The control sequence at `i` (a backslash): its name, without the backslash. */
function controlWord(tex: string, i: number): string {
  const letters = /^[a-zA-Z]+/.exec(tex.slice(i + 1, i + 64));
  return letters?.[0] ?? tex[i + 1] ?? "";
}

/** A `{…}` group starting at `i` after spaces: its content and where it ends. */
function group(tex: string, i: number): { content: string; to: number } | null {
  let at = i;
  while (tex[at] === " " || tex[at] === "\n" || tex[at] === "\t") at++;
  if (tex[at] !== "{") return null;
  let depth = 0;
  for (let j = at; j < tex.length; j++) {
    const c = tex[j];
    if (c === "\\") j++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { content: tex.slice(at + 1, j), to: j + 1 };
  }
  return null;
}

/** Take the numbering commands out of one row, and put placeholders for refs. */
function extract(row: string, out: Prepared): { text: string; notag: boolean } {
  let text = "";
  let notag = false;
  let i = 0;
  while (i < row.length) {
    if (row[i] !== "\\") {
      text += row[i];
      i++;
      continue;
    }
    const word = controlWord(row, i);
    const after = i + 1 + word.length;
    if (word === "notag" || word === "nonumber") {
      notag = true;
      i = after;
      continue;
    }
    if (word === "label" || word === "ref" || word === "eqref") {
      const arg = group(row, after);
      if (arg !== null) {
        const key = arg.content.trim();
        if (word === "label") {
          if (out.label === null) out.label = key;
          else out.dropped.push(`\\label{${key}}`);
        } else {
          text += `\\ref{${REF_PLACEHOLDER}${out.refs.length}}`;
          out.refs.push({ key, eq: word === "eqref" });
        }
        i = arg.to;
        continue;
      }
    }
    if (word === "tag") {
      const bare = row[after] === "*";
      const arg = group(row, bare ? after + 1 : after);
      if (arg !== null) {
        if (out.tag === null) out.tag = { text: arg.content.trim(), bare };
        else out.dropped.push(`\\tag{${arg.content.trim()}}`);
        i = arg.to;
        continue;
      }
    }
    text += row.slice(i, after);
    i = after;
  }
  return { text, notag };
}

const DEFINERS = new Set(["newcommand", "renewcommand", "providecommand"]);

/**
 * Definitions Temml keeps from one formula to the next, as MathJax keeps
 * them for the document.
 *
 * Temml 0.13.5 keeps `\gdef` in the shared `macros` object and drops
 * `\newcommand`, even with `globalGroup` (probed, `doc/tex.md` §4). So
 * `\newcommand{\pd}[2]{…}` becomes `\gdef\pd#1#2{…}`, `\def` becomes `\gdef`,
 * and `\DeclareMathOperator` a `\gdef` of an `\operatorname`. A command with
 * an optional argument has no `\gdef` form and is left as written.
 */
export function rewriteDefinitions(tex: string): string {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    if (tex[i] !== "\\") {
      out += tex[i];
      i++;
      continue;
    }
    const word = controlWord(tex, i);
    const after = i + 1 + word.length;
    if (word === "def") {
      out += "\\gdef";
      i = after;
      continue;
    }
    const rewritten = DEFINERS.has(word)
      ? newcommand(tex, after)
      : word === "DeclareMathOperator"
        ? declareOperator(tex, after)
        : null;
    if (rewritten !== null) {
      out += rewritten.text;
      i = rewritten.to;
      continue;
    }
    out += tex.slice(i, after);
    i = after;
  }
  return out;
}

/** The name being defined: `{\foo}` or `\foo`. */
function definedName(tex: string, i: number): { name: string; to: number } | null {
  const braced = group(tex, i);
  if (braced !== null) {
    const name = braced.content.trim();
    return /^\\([a-zA-Z]+|.)$/.test(name) ? { name, to: braced.to } : null;
  }
  const m = /^\s*(\\(?:[a-zA-Z]+|.))/.exec(tex.slice(i, i + 64));
  return m === null ? null : { name: m[1] ?? "", to: i + m[0].length };
}

function newcommand(tex: string, i: number): { text: string; to: number } | null {
  let at = tex[i] === "*" ? i + 1 : i;
  const name = definedName(tex, at);
  if (name === null) return null;
  at = name.to;
  let params = "";
  const count = /^\s*\[(\d)\]/.exec(tex.slice(at, at + 16));
  if (count !== null) {
    for (let n = 1; n <= Number(count[1]); n++) params += `#${n}`;
    at += count[0].length;
    if (/^\s*\[/.test(tex.slice(at, at + 16))) return null;
  }
  const body = group(tex, at);
  if (body === null) return null;
  return { text: `\\gdef${name.name}${params}{${body.content}}`, to: body.to };
}

function declareOperator(tex: string, i: number): { text: string; to: number } | null {
  const star = tex[i] === "*";
  const name = definedName(tex, star ? i + 1 : i);
  if (name === null) return null;
  const body = group(tex, name.to);
  if (body === null) return null;
  const op = star ? "\\operatorname*" : "\\operatorname";
  return { text: `\\gdef${name.name}{${op}{${body.content}}}`, to: body.to };
}
