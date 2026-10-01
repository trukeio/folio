/**
 * The TeX front end as a stage-boundary hook (`doc/tex.md` §2).
 *
 * `beforeParsed` is awaited before stage 1 reads anything, so every formula
 * is MathML before the engine measures one. The handler is a class because
 * that is what `registerHandlers` and `Previewer({ handlers })` take, as in
 * Paged.js; it imports nothing from the core but its types, so the bundle
 * that carries it does not carry a second engine.
 */
import type { Handler, Previewer } from "@truke/folio";
import { renderTeX } from "./render.js";
import type { TeXOptions, TeXReport } from "./render.js";

export type TeXHandlerOptions = TeXOptions & {
  /** Called with what each run found; unset, problems go to the console. */
  onReport?: (report: TeXReport) => void;
};

export type TeXHandlerClass = new (previewer: Previewer) => Handler;

/**
 * A handler class converting with `options`. A function is read when the
 * preview runs rather than when the class is made, so a page can set its
 * options after the script that registered the handler.
 */
export function createTeXHandler(options: TeXHandlerOptions | (() => TeXHandlerOptions) = {}): TeXHandlerClass {
  return class TeXHandler implements Handler {
    readonly previewer: Previewer;
    constructor(previewer: Previewer) {
      this.previewer = previewer;
    }
    beforeParsed(content: Element): void {
      const { onReport, ...opts } = typeof options === "function" ? options() : options;
      const report = renderTeX(content, opts);
      if (onReport !== undefined) onReport(report);
      else warn(report);
    }
  };
}

/** One console line per kind of problem, so a broken formula is not silent. */
export function warn(report: TeXReport): void {
  const problems: [string, unknown[]][] = [
    ["formulas that did not parse", report.errors],
    ["opening delimiters with no close", report.unclosed],
    ["labels used twice", report.duplicateLabels],
    ["labels or tags beyond one per display", report.dropped],
    ["references to no label", report.unresolved],
  ];
  for (const [what, list] of problems) {
    if (list.length > 0) console.warn(`folio TeX: ${list.length} ${what}`, list);
  }
}
