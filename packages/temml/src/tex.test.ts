import { describe, expect, it } from "vitest";
import { prepareTeX, rewriteDefinitions, splitRows } from "./tex.js";

const raw = String.raw;
const display = { display: true };

describe("prepareTeX", () => {
  it("takes the label out, verbatim, colons included", () => {
    const p = prepareTeX(raw`E = mc^2 \label{eq:ab}`, display);
    expect(p.tex).toBe("E = mc^2 ");
    expect(p.label).toBe("eq:ab");
  });

  it("numbers AMS's way by default: unstarred environments, not \\[ \\]", () => {
    expect(prepareTeX("x", display).numbered).toBe(false);
    expect(prepareTeX(raw`\begin{equation}x\end{equation}`, display).numbered).toBe(true);
    expect(prepareTeX(raw`\begin{equation*}x\end{equation*}`, display).numbered).toBe(false);
    expect(prepareTeX(raw`\begin{equation}x\notag\end{equation}`, display).numbered).toBe(false);
  });

  it("numbers every display under 'all', and none under 'none'", () => {
    expect(prepareTeX("x", { display: true, tags: "all" }).numbered).toBe(true);
    expect(prepareTeX("x", { display: false, tags: "all" }).numbered).toBe(false);
    expect(prepareTeX(raw`\begin{align*}x\end{align*}`, { display: true, tags: "all" }).numbered).toBe(false);
    expect(prepareTeX(raw`\begin{equation}x\end{equation}`, { display: true, tags: "none" }).numbered).toBe(false);
  });

  it("unwraps environments so Temml emits no tag column", () => {
    expect(prepareTeX(raw`\begin{equation} a = b \end{equation}`, display).tex).toBe(" a = b ");
    expect(prepareTeX(raw`\begin{align}a&=b\\c&=d\end{align}`, display).tex).toBe(
      raw`\begin{aligned}a&=b\\c&=d\end{aligned}`,
    );
    expect(prepareTeX(raw`\begin{gather*}a\\b\end{gather*}`, display).tex).toBe(
      raw`\begin{gathered}a\\b\end{gathered}`,
    );
    expect(prepareTeX(raw`\begin{multline}a\\b\end{multline}`, display).tex).toBe(
      raw`\begin{multline*}a\\b\end{multline*}`,
    );
    expect(prepareTeX(raw`\begin{alignat}{2}a&=b&c&=d\end{alignat}`, display).tex).toBe(
      raw`\begin{alignedat}{2}a&=b&c&=d\end{alignedat}`,
    );
  });

  it("numbers a multi-row environment if any row is numbered, once", () => {
    const some = prepareTeX(raw`\begin{align}a&=b\notag\\c&=d\label{x}\end{align}`, display);
    expect(some.numbered).toBe(true);
    expect(some.label).toBe("x");
    expect(some.tex).toBe(raw`\begin{aligned}a&=b\\c&=d\end{aligned}`);
    const none = prepareTeX(raw`\begin{align}a\nonumber\\b\notag\end{align}`, display);
    expect(none.numbered).toBe(false);
  });

  it("reports a second label, since a display has one number", () => {
    const p = prepareTeX(raw`\begin{align}a\label{one}\\b\label{two}\end{align}`, display);
    expect(p.label).toBe("one");
    expect(p.dropped).toEqual([raw`\label{two}`]);
  });

  it("takes a tag, which numbers even a \\[ \\] display", () => {
    expect(prepareTeX(raw`x \tag{7a}`, display)).toMatchObject({ tex: "x ", numbered: true, tag: { text: "7a", bare: false } });
    expect(prepareTeX(raw`x \tag*{A}`, display).tag).toEqual({ text: "A", bare: true });
    const inline = prepareTeX(raw`x \tag{1}`, { display: false });
    expect(inline.tag).toBeNull();
    expect(inline.dropped).toEqual([raw`\tag{1}`]);
  });

  it("puts placeholders Temml cannot mangle where references were", () => {
    const p = prepareTeX(raw`\text{by } \eqref{eq:a} \text{ and } \ref{b}`, display);
    expect(p.tex).toBe(raw`\text{by } \ref{texref0} \text{ and } \ref{texref1}`);
    expect(p.refs).toEqual([
      { key: "eq:a", eq: true },
      { key: "b", eq: false },
    ]);
  });

  it("does not mistake \\labelx or a \\\\ before 'label' for a label", () => {
    expect(prepareTeX(raw`\labelx{a}`, display).label).toBeNull();
    expect(prepareTeX(raw`a\\label`, display).tex).toBe(raw`a\\label`);
  });
});

describe("splitRows", () => {
  it("splits at the rows of this formula only", () => {
    expect(splitRows(raw`a\\b{c\\d}\begin{cases}e\\f\end{cases}\\g`)).toEqual([
      "a",
      raw`b{c\\d}\begin{cases}e\\f\end{cases}`,
      "g",
    ]);
  });
});

describe("rewriteDefinitions", () => {
  it("turns \\newcommand and friends into \\gdef, which Temml keeps", () => {
    expect(rewriteDefinitions(raw`\newcommand{\RR}{\mathbb{R}}`)).toBe(raw`\gdef\RR{\mathbb{R}}`);
    expect(rewriteDefinitions(raw`\renewcommand\pd[2]{\frac{\partial #1}{\partial #2}}`)).toBe(
      raw`\gdef\pd#1#2{\frac{\partial #1}{\partial #2}}`,
    );
    expect(rewriteDefinitions(raw`\def\x{y}`)).toBe(raw`\gdef\x{y}`);
    expect(rewriteDefinitions(raw`\DeclareMathOperator*{\argmax}{arg\,max}`)).toBe(
      raw`\gdef\argmax{\operatorname*{arg\,max}}`,
    );
  });

  it("leaves what it cannot express alone", () => {
    const optional = raw`\newcommand{\f}[1][x]{#1}`;
    expect(rewriteDefinitions(optional)).toBe(optional);
    expect(rewriteDefinitions(raw`\gdef\a{b} \define`)).toBe(raw`\gdef\a{b} \define`);
  });
});
