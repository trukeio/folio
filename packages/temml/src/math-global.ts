/**
 * The TeX drop-in's script tag (`dist/folio-math-tex.js`,
 * `doc/math-drop-in.md`): `\( … \)` and `\[ … \]` to MathML, as before
 * pagination, and then the engine's numbering, breaking and references on a
 * page with no pages. Reads `window.FolioTeX` as `folio-tex.js` does, so
 * one source and one configuration serve the screen and the book, and
 * `window.FolioMath` for the rest.
 */
import { installMath } from "@truke/folio/math";
import type { TeXHandlerOptions } from "./handler.js";
import { warn } from "./handler.js";
import { renderTeX } from "./render.js";

declare global {
  interface Window {
    FolioTeX?: TeXHandlerOptions;
  }
}

export { installMath, folioMath } from "@truke/folio/math";
export { renderTeX } from "./render.js";

export const ready = installMath(window, (root) => {
  const { onReport, ...options } = window.FolioTeX ?? {};
  const report = renderTeX(root, options);
  if (onReport !== undefined) onReport(report);
  else warn(report);
});
