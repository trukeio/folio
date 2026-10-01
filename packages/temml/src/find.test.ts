import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { findTeX } from "./find.js";
import type { FindOptions, Found } from "./find.js";

/** The body of a document holding `html`. */
function body(html: string): Element {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return document.body;
}

/** What was found, as the text each match covers. */
function found(html: string, options?: FindOptions): { kind: string; tex: string; display?: boolean }[] {
  return findTeX(body(html), options).found.map((f: Found) =>
    f.kind === "math"
      ? { kind: f.kind, tex: f.tex, display: f.display }
      : { kind: f.kind, tex: f.kind === "ref" ? `${f.eq ? "eq" : ""}${f.key}` : f.text },
  );
}

describe("findTeX", () => {
  it("finds \\( … \\) inline and \\[ … \\] display by default", () => {
    expect(found(String.raw`<p>Let \(x^2\) be \[ y = 1 \] done</p>`)).toEqual([
      { kind: "math", tex: "x^2", display: false },
      { kind: "math", tex: " y = 1 ", display: true },
    ]);
  });

  it("leaves dollars alone unless they are configured", () => {
    expect(found("<p>costs $5 and $6</p>")).toEqual([]);
    const dollars = { inline: [["$", "$"]] as const, display: [["$$", "$$"]] as const };
    expect(found("<p>$a$ and $$b$$</p>", dollars)).toEqual([
      { kind: "math", tex: "a", display: false },
      { kind: "math", tex: "b", display: true },
    ]);
    expect(found(String.raw`<p>\$5 and $a$</p>`, dollars)).toEqual([
      { kind: "escape", tex: "$" },
      { kind: "math", tex: "a", display: false },
    ]);
  });

  it("does not open at an escaped backslash", () => {
    expect(found(String.raw`<p>a \\(b) c</p>`)).toEqual([]);
  });

  it("closes only when braces balance, and a \\\\ is a line break, not a close", () => {
    expect(found(String.raw`<p>\( \text{\)} \)</p>`)).toEqual([
      { kind: "math", tex: String.raw` \text{\)} `, display: false },
    ]);
    expect(found(String.raw`<p>\[ a \\ b \\\]</p>`)).toEqual([
      { kind: "math", tex: String.raw` a \\ b \\`, display: true },
    ]);
  });

  it("joins text across <br> and comments, but not across other elements", () => {
    expect(found(String.raw`<p>\[ a <!-- c --> +<br>b \]</p>`)).toEqual([
      { kind: "math", tex: " a  +\nb ", display: true },
    ]);
    const root = body(String.raw`<p>\( a <em>b</em> \)</p>`);
    const result = findTeX(root);
    expect(result.found).toEqual([]);
    expect(result.unclosed.map((u) => u.open)).toEqual(["\\("]);
  });

  it("gives boundaries in the text nodes the formula starts and ends in", () => {
    const root = body(String.raw`<p>see \( a <!-- x --> b \) here</p>`);
    const [f] = findTeX(root).found;
    expect(f?.start.node.data).toBe("see \\( a ");
    expect(f?.start.offset).toBe(4);
    expect(f?.end.node.data).toBe(" b \\) here");
    expect(f?.end.offset).toBe(5);
  });

  it("skips ignored subtrees, and re-enters a processed one", () => {
    const html = String.raw`<pre>\(a\)</pre><code>\(b\)</code><div class="tex-ignore">\(c\)<span class="go">\(d\)</span></div>`;
    expect(found(html, { process: ".go" }).map((f) => f.tex)).toEqual(["d"]);
  });

  it("finds bare display environments, nested ones whole", () => {
    const tex = String.raw`\begin{align} a &= b \begin{align} \end{align} \end{align}`;
    expect(found(`<p>${tex} after</p>`)).toEqual([{ kind: "math", tex, display: true }]);
    expect(found(String.raw`<p>\begin{itemize} x \end{itemize}</p>`)).toEqual([]);
    expect(found(String.raw`<p>\begin{equation} x </p>`)).toEqual([]);
    expect(found(String.raw`<p>\begin{equation}x\end{equation}</p>`, { environments: false })).toEqual([]);
  });

  it("finds \\ref and \\eqref in text", () => {
    expect(found(String.raw`<p>by \eqref{eq:euler}, see \ref{ sec }</p>`)).toEqual([
      { kind: "ref", tex: "eqeq:euler" },
      { kind: "ref", tex: "sec" },
    ]);
  });

  it("does not find a delimiter inside a formula that is already MathML", () => {
    expect(found(String.raw`<p><math><mtext>\(x\)</mtext></math></p>`)).toEqual([]);
  });
});
