/**
 * `@truke/folio-temml`: TeX in, MathML out, before stage 1 (`doc/tex.md`).
 *
 * The core accepts MathML only (`math.md` §8). This package is how a document
 * written for MathJax — `\( … \)` inline, `\[ … \]` display — reaches it.
 */
export { DEFAULT_FIND, DISPLAY_ENVIRONMENTS, findTeX } from "./find.js";
export type { Boundary, Delimiters, FindOptions, FindResult, Found, Unclosed } from "./find.js";
export { prepareTeX, rewriteDefinitions, splitRows } from "./tex.js";
export type { PrepareOptions, Prepared, Tags } from "./tex.js";
export { LABEL_ATTR, NUMBERED_CLASS, renderTeX, STYLE_ID, TEX_CSS } from "./render.js";
export type { TeXOptions, TeXReport } from "./render.js";
export { createTeXHandler, warn } from "./handler.js";
export type { TeXHandlerClass, TeXHandlerOptions } from "./handler.js";
