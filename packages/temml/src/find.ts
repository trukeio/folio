/**
 * Finding TeX in a document's text (`doc/tex.md` §3).
 *
 * The behaviour is MathJax's `FindTeX` and `HTMLDomStrings`, taken from their
 * documentation: the text under the root is read as *strings* — runs of text
 * nodes that may be joined by `<br>`, `<wbr>` and comments but by no other
 * element — and each string is searched for delimiters. A formula never
 * crosses an element, so `\( a <em>b</em> \)` is not one, and an opening
 * delimiter with nothing to close it in its string is text, and reported.
 *
 * This file only finds. It returns where each formula starts and ends as a
 * text node and an offset, and changes nothing; `render.ts` replaces.
 */

/** An opening and a closing delimiter, as plain strings. */
export type Delimiters = readonly [open: string, close: string];

export type FindOptions = {
  inline?: readonly Delimiters[];
  display?: readonly Delimiters[];
  /** Bare `\begin{equation} … \end{equation}` in text is a display formula. */
  environments?: boolean;
  /** `\ref{…}` and `\eqref{…}` in text, outside any formula. */
  refs?: boolean;
  /** Subtrees not searched. */
  ignore?: string;
  /** Subtrees searched even inside an ignored one. */
  process?: string | null;
};

export const DEFAULT_FIND: Required<FindOptions> = {
  inline: [["\\(", "\\)"]],
  display: [["\\[", "\\]"]],
  environments: true,
  refs: true,
  ignore: "script, style, textarea, pre, code, math, svg, .tex-ignore",
  process: null,
};

/**
 * The environments that are a display formula on their own. Each is also what
 * `tex.ts` knows how to unwrap, and the two lists must stay one list.
 */
export const DISPLAY_ENVIRONMENTS = ["equation", "align", "gather", "multline", "alignat", "flalign"].flatMap(
  (name) => [name, `${name}*`],
);

/** A place in the text: a text node and an offset into its data. */
export type Boundary = { node: Text; offset: number };

export type Found =
  | {
      kind: "math";
      /** The TeX between the delimiters; for an environment, the whole of it. */
      tex: string;
      display: boolean;
      /** The environment's name, when the formula is a bare environment. */
      environment?: string;
      start: Boundary;
      end: Boundary;
    }
  | { kind: "ref"; key: string; eq: boolean; start: Boundary; end: Boundary }
  /** `\$` when a delimiter starts with `$`: a dollar sign, not math. */
  | { kind: "escape"; text: string; start: Boundary; end: Boundary };

export type Unclosed = { open: string; at: Boundary };

export type FindResult = { found: Found[]; unclosed: Unclosed[] };

/** Joined into a string, with no node of their own to put a boundary in. */
const JOINERS: Record<string, string> = { br: "\n", wbr: "" };

type Segment = { node: Text; from: number };

/** Find every formula under `root`, in document order. */
export function findTeX(root: Element, options: FindOptions = {}): FindResult {
  const opts = { ...DEFAULT_FIND, ...options };
  const result: FindResult = { found: [], unclosed: [] };
  for (const run of strings(root, opts)) scanString(run, opts, result);
  return result;
}

/** The strings under `root`: text joined across `<br>` and comments only. */
function strings(root: Element, opts: Required<FindOptions>): Segment[][] {
  const out: Segment[][] = [];
  let current: Segment[] = [];
  let length = 0;
  const flush = (): void => {
    if (current.length > 0) out.push(current);
    current = [];
    length = 0;
  };

  const walk = (parent: Node, ignored: boolean): void => {
    for (let child = parent.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === 3) {
        if (ignored) continue;
        const text = child as Text;
        current.push({ node: text, from: length });
        length += text.data.length;
      } else if (child.nodeType === 1) {
        const el = child as Element;
        const name = el.localName.toLowerCase();
        const joiner = JOINERS[name];
        if (joiner !== undefined && !ignored) {
          // A join has no text node to hold a boundary; it only shifts the
          // offsets after it, so it is recorded as the length it adds.
          length += joiner.length;
          continue;
        }
        flush();
        let skip = ignored;
        if (opts.process !== null && el.matches(opts.process)) skip = false;
        else if (el.matches(opts.ignore)) skip = true;
        walk(el, skip);
        flush();
      }
      // Comments and processing instructions are neither text nor a break.
    }
  };
  walk(root, false);
  flush();
  return out;
}

/** The text of a string, with each `<br>` as the newline it stands for. */
function joined(run: Segment[]): string {
  let text = "";
  for (const seg of run) {
    // Anything between the end of the text so far and this segment's start
    // was a join.
    text += "\n".repeat(seg.from - text.length) + seg.node.data;
  }
  return text;
}

/**
 * The boundary for offset `at` of the string. A start belongs to the segment
 * it begins, an end to the segment it finishes, so a formula that ends where
 * a text node ends does not reach into the next one.
 */
function boundary(run: Segment[], at: number, isEnd: boolean): Boundary {
  for (const seg of run) {
    const to = seg.from + seg.node.data.length;
    if (isEnd ? at > seg.from && at <= to : at >= seg.from && at < to) {
      return { node: seg.node, offset: at - seg.from };
    }
  }
  // Delimiters are text, so a formula always starts and ends inside a node.
  throw new Error(`no text node at offset ${at}`);
}

type Opener = { open: string; close: string; display: boolean };

function scanString(run: Segment[], opts: Required<FindOptions>, result: FindResult): void {
  const text = joined(run);
  // Longest first, so `$$` is tried before `$`.
  const openers: Opener[] = [
    ...opts.display.map(([open, close]) => ({ open, close, display: true })),
    ...opts.inline.map(([open, close]) => ({ open, close, display: false })),
  ].sort((a, b) => b.open.length - a.open.length);
  const dollars = openers.some((o) => o.open.startsWith("$"));
  const push = (found: Found): void => {
    result.found.push(found);
  };
  const span = (from: number, to: number) => ({ start: boundary(run, from, false), end: boundary(run, to, true) });

  let i = 0;
  while (i < text.length) {
    const opener = openers.find((o) => text.startsWith(o.open, i));
    if (opener !== undefined) {
      const bodyFrom = i + opener.open.length;
      const close = findClose(text, bodyFrom, opener.close);
      if (close === -1) {
        result.unclosed.push({ open: opener.open, at: boundary(run, i, false) });
        i = bodyFrom;
        continue;
      }
      const to = close + opener.close.length;
      push({ kind: "math", tex: text.slice(bodyFrom, close), display: opener.display, ...span(i, to) });
      i = to;
      continue;
    }
    if (text[i] !== "\\") {
      i++;
      continue;
    }
    const next = text[i + 1];
    if (next === "\\") {
      // An escaped backslash: `\\(` does not open.
      i += 2;
      continue;
    }
    if (next === "$" && dollars) {
      push({ kind: "escape", text: "$", ...span(i, i + 2) });
      i += 2;
      continue;
    }
    const env = opts.environments ? environmentAt(text, i) : null;
    if (env !== null) {
      push({ kind: "math", tex: text.slice(i, env.to), display: true, environment: env.name, ...span(i, env.to) });
      i = env.to;
      continue;
    }
    const ref = opts.refs ? refAt(text, i) : null;
    if (ref !== null) {
      push({ kind: "ref", key: ref.key, eq: ref.eq, ...span(i, ref.to) });
      i = ref.to;
      continue;
    }
    i++;
  }
}

/**
 * Where `close` closes a formula whose body starts at `from`, or -1.
 *
 * Braces must balance first, as in MathJax: `\( \text{\)} \)` closes at the
 * second. A backslash takes the character after it, so `\\]` is a line break
 * and `]`, never a close — unless the close itself starts with a backslash
 * and the braces are balanced, which is checked first.
 */
export function findClose(text: string, from: number, close: string): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (depth === 0 && text.startsWith(close, i)) return i;
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    // A stray `}` is Temml's error to report; clamping keeps the close findable.
    else if (c === "}") depth = Math.max(0, depth - 1);
  }
  return -1;
}

const BEGIN = /^\\begin\s*\{([a-zA-Z]+\*?)\}/;

/** A display environment starting at `i`, and where its matching end is. */
function environmentAt(text: string, i: number): { name: string; to: number } | null {
  const m = BEGIN.exec(text.slice(i, i + 40));
  if (m === null) return null;
  const name = m[1] ?? "";
  if (!DISPLAY_ENVIRONMENTS.includes(name)) return null;
  const begin = `\\begin{${name}}`;
  const end = `\\end{${name}}`;
  let depth = 1;
  let at = i + m[0].length;
  while (at < text.length) {
    const nextEnd = text.indexOf(end, at);
    if (nextEnd === -1) return null;
    const nextBegin = text.indexOf(begin, at);
    if (nextBegin !== -1 && nextBegin < nextEnd) {
      depth++;
      at = nextBegin + begin.length;
      continue;
    }
    depth--;
    at = nextEnd + end.length;
    if (depth === 0) return { name, to: at };
  }
  return null;
}

const REF = /^\\(eqref|ref)\s*\{([^{}]*)\}/;

function refAt(text: string, i: number): { key: string; eq: boolean; to: number } | null {
  const m = REF.exec(text.slice(i, i + 200));
  if (m === null) return null;
  return { key: (m[2] ?? "").trim(), eq: m[1] === "eqref", to: i + m[0].length };
}
