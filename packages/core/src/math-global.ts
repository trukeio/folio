/**
 * The MathML drop-in's script tag (`dist/folio-math.js`,
 * `doc/math-drop-in.md`): the engine's numbering, breaking and references on
 * a page with no pages. Reads `window.FolioMath`; `folioMath.ready`
 * resolves when the formulas are done.
 */
import { installMath } from "./math-screen.js";

export { installMath, folioMath } from "./math-screen.js";
export type { MathConfig, MathOnScreen, MathOptions } from "./math-screen.js";

export const ready = installMath(window);
