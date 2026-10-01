import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { LABEL_ATTR, NUMBERED_CLASS, renderTeX, STYLE_ID } from "./render.js";
import type { TeXOptions } from "./render.js";

const raw = String.raw;

function render(html: string, options?: TeXOptions) {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
  const doc = document;
  const report = renderTeX(doc.body, options);
  return { doc, body: doc.body, report };
}

describe("renderTeX", () => {
  it("puts MathML where the TeX was, and keeps the text around it", () => {
    const { body, report } = render(raw`<p>Let \(x^2\) be \[ y \] here.</p>`);
    expect(report.formulas).toBe(2);
    const p = body.querySelector("p");
    expect(p?.textContent.startsWith("Let ")).toBe(true);
    expect(p?.textContent.endsWith(" here.")).toBe(true);
    const maths = body.querySelectorAll("math");
    expect(maths.length).toBe(2);
    expect(maths[0]?.hasAttribute("display")).toBe(false);
    expect(maths[1]?.getAttribute("display")).toBe("block");
    expect(body.innerHTML).not.toContain("\\(");
  });

  it("keeps the author's TeX as the annotation", () => {
    const { body } = render(raw`<p>\[ E = mc^2 \label{eq:e} \]</p>`);
    expect(body.querySelector("annotation")?.textContent).toBe(raw` E = mc^2 \label{eq:e} `);
  });

  it("gives the core a numbered display with its label as the id", () => {
    const { body } = render(raw`<p>\begin{equation} a = b \label{eq:ab} \end{equation}</p>`);
    const math = body.querySelector("math");
    expect(math?.id).toBe("eq:ab");
    expect(math?.classList.contains(NUMBERED_CLASS)).toBe(true);
    // No numbering of Temml's own: no tag column, no counter span.
    expect(body.innerHTML).not.toContain("tml-eqn");
    expect(body.innerHTML).not.toContain("width:100%");
  });

  it("does not number \\[ \\] under AMS, and numbers it under 'all'", () => {
    expect(render(raw`<p>\[x\]</p>`).body.querySelector(`.${NUMBERED_CLASS}`)).toBeNull();
    expect(render(raw`<p>\[x\]</p>`, { tags: "all" }).body.querySelector(`.${NUMBERED_CLASS}`)).not.toBeNull();
  });

  it("hands a tag to the core as a label, and to its references", () => {
    const { body } = render(raw`<p>\[ x \tag{7a} \label{t} \] by \eqref{t}</p>`);
    const math = body.querySelector("math");
    expect(math?.getAttribute("style")).toContain(`math-number: "(7a)"`);
    expect(math?.classList.contains(NUMBERED_CLASS)).toBe(false);
    expect(body.querySelector("a.tex-eqref")?.getAttribute(LABEL_ATTR)).toBe("7a");
  });

  it("turns references in text and in formulas into links the engine fills", () => {
    const { body, report } = render(
      raw`<p>\begin{equation}a\label{eq:a}\end{equation} see \eqref{eq:a} and \( x = \ref{eq:a} \)</p>`,
    );
    const links = [...body.querySelectorAll("a")];
    expect(links.map((a) => [a.className, a.getAttribute("href")])).toEqual([
      ["tex-eqref", "#eq:a"],
      ["tex-ref", "#eq:a"],
    ]);
    // Inside a formula the link is HTML in an <mtext>.
    expect(links[1]?.parentElement?.localName).toBe("mtext");
    expect(report.unresolved).toEqual([]);
  });

  it("reports references to nothing, and labels used twice", () => {
    const { report, body } = render(raw`<p>\[a\label{x}\] \[b\label{x}\] \eqref{nope}</p>`);
    expect(report.unresolved).toEqual(["nope"]);
    expect(report.duplicateLabels).toEqual(["x"]);
    expect(body.querySelectorAll("#x").length).toBe(1);
  });

  it("keeps a \\newcommand for the formulas after it, and shows nothing for it", () => {
    const { body, report } = render(raw`<p>\(\newcommand{\RR}{\mathbb{R}}\)x \(\RR\)</p>`);
    expect(report.errors).toEqual([]);
    expect(body.querySelectorAll("math").length).toBe(1);
    expect(body.querySelector("mi")?.textContent).toBe("ℝ");
  });

  it("takes macros from the options", () => {
    const { body } = render(raw`<p>\(\RR\)</p>`, { macros: { "\\RR": "\\mathbb{R}" } });
    expect(body.querySelector("mi")?.textContent).toBe("ℝ");
  });

  it("shows a formula that does not parse as its source, in an merror", () => {
    const { body, report } = render(raw`<p>\( \nosuch{a} \)</p>`);
    expect(report.errors.length).toBe(1);
    expect(body.querySelector("merror")?.textContent).toBe(raw` \nosuch{a} `);
    expect(() => render(raw`<p>\( \nosuch{a} \)</p>`, { onError: "throw" })).toThrow();
  });

  it("replaces a formula that spans a <br> and several formulas in one text node", () => {
    const { body } = render(raw`<p>\(a\)\(b\) \[ c +<br>d \] \(e\)</p>`);
    expect(body.querySelectorAll("math").length).toBe(4);
    expect(body.querySelector("br")).toBeNull();
    expect(body.querySelector("p")?.textContent.replace(/\s/g, "")).not.toContain("\\");
  });

  it("turns an escaped dollar into a dollar when dollars are delimiters", () => {
    const { body } = render(raw`<p>\$5 and $a$</p>`, { inline: [["$", "$"]] });
    expect(body.querySelector("p")?.textContent.startsWith("$5 and ")).toBe(true);
    expect(body.querySelectorAll("math").length).toBe(1);
  });

  it("is idempotent, and adds its stylesheet once", () => {
    const { doc, body } = render(raw`<p>\(a\) \[b\]</p>`);
    const before = body.innerHTML;
    const again = renderTeX(body);
    expect(again.formulas).toBe(0);
    expect(body.innerHTML).toBe(before);
    expect(doc.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
  });
});
