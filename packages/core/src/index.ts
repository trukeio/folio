export type {
  Axis,
  Box,
  Measurer,
  PageRecord,
  PageSpec,
  Position,
  Rect,
} from "./types.js";

export { ensureMathFont, hasMathTable, loadMathFont, mathDepthScales } from "./math/font.js";
export { classifyOperator, MATH_PENALTIES, penaltyAfter } from "./math/penalties.js";
export type { OperatorClass } from "./math/penalties.js";
export { isFenced, mathCandidates, topRow } from "./math/candidates.js";
export type { MathCandidate, MathCandidateOptions } from "./math/candidates.js";
export { breakEquation, breakEquations, MATH_ROWS, planBreaks } from "./math/compose.js";
export type { BreakEquationOptions, BreakEquationsResult, BreakResult } from "./math/compose.js";
export {
  counterAttribute,
  ensureMathRules,
  EQ_CLASS,
  EQ_LABEL,
  EQ_COUNTER,
  EQ_NUM_CLASS,
  numberEquations,
  prepareEquations,
} from "./math/number.js";
export type { NumberOptions } from "./math/number.js";
export { installMath, folioMath } from "./math-screen.js";
export type { MathConfig, MathOnScreen, MathOptions } from "./math-screen.js";
export { cloneForCarry, collectCarriedElements, resolveCarriedElement } from "./carry.js";
export type { CarriedElements } from "./carry.js";
export {
  comparePositions,
  elementPath,
  isAfter,
  isBefore,
  isSame,
  positionKey,
  positionOf,
  resolve,
  START,
} from "./position.js";
export { chooseBreak } from "./select.js";
export type { Choice } from "./select.js";
export { FORCED, PENALTIES, PROHIBITED, widowOrphanPenalty } from "./penalties.js";
export type { BreakKind, Candidate } from "./penalties.js";
export { collectCss, createEngineFrame, mediaApplies, normalize, settle, sizeFrameToPage } from "./source.js";
export { resolvePrintMedia } from "./css/media.js";
export type { SourceDoc } from "./source.js";
export {
  cascadeFor,
  contentArea,
  marginBoxesFor,
  resolvePageSpec,
  selectorMatches,
} from "./page-model.js";
export type { PageContext } from "./page-model.js";
export {
  extractPageRules,
  parseNth,
  parsePageSelector,
  userAgentPageRules,
} from "./css/page-rules.js";
export type { Declarations, PageRule, PageSelector } from "./css/page-rules.js";
export { PAGE_SIZES, parseMarginShorthand, parseSize, toPx } from "./css/length.js";
export { enumerateCandidates } from "./candidates.js";
export type { EnumerateOptions } from "./candidates.js";
export { domMeasurer, groupIntoLines } from "./dom-measurer.js";
export { domTextRanges, offsetAtLine } from "./text.js";
export type { TextRanges } from "./text.js";
export {
  composePage,
  composeStats,
  ENGINE_FRAME,
  isInsideSubtree,
  overlap,
  SOURCE_PATH,
  sourceRootIn,
  SPLIT_FROM,
  SPLIT_TO,
  TEXT_START,
} from "./compose.js";
export type { ComposeOptions, Overlap } from "./compose.js";
export { chunkFrom } from "./chunk.js";
export { counterOps, counterWalk, countPage } from "./counters.js";
export type { CounterValues, CounterWalk, PageCounters } from "./counters.js";
export type { Chunk } from "./chunk.js";
export { toSourcePosition } from "./paginate.js";
export { paginate } from "./settle.js";
export {
  clearHandlers,
  CONTENT_REF,
  PAGES_CLASS,
  Previewer,
  registeredHandlers,
  registerHandlers,
} from "./preview.js";
export type { Flow, Handler, PreviewerSettings } from "./preview.js";
export type { PaginateOptions, PaginateResult } from "./paginate.js";
export {
  MARGIN_BOXES,
  renderContent,
  renderMarginBoxes,
  renderPageTemplate,
  resolveContent,
} from "./page-template.js";
export { layoutMarginBoxes, resolveEdge, resolveFixed } from "./margin-boxes.js";
export type { ContentContext, MarginBoxPage, PageElements, TemplateOptions } from "./page-template.js";
export { collectPageStrings, parseStringSet, resolveString } from "./strings.js";
export type { PageStrings, StringScope } from "./strings.js";
export {
  CARRIER_PREFIX,
  CARRIERS,
  carrierName,
  carrierRegistrations,
  readCarrier,
  rewriteCarriers,
} from "./css/rewrite.js";
export type { Carrier } from "./css/rewrite.js";
export { indexPages, REF_ATTRIBUTE_PREFIX, rewriteReferences, targetIdOf } from "./references.js";
export type { Reference, RewrittenReferences } from "./references.js";
export {
  AREA_CLASS,
  buildFootnoteArea,
  CALL_CLASS,
  ensureFootnoteRules,
  extractFootnotes,
  footnotesBefore,
  MARKER_CLASS,
  measureFootnoteArea,
  NOTE_CLASS,
} from "./footnotes.js";
export type { Footnote } from "./footnotes.js";
export { REPEATED, repeatTableParts } from "./tables.js";
export { CONTINUED, decorateFragments, finishFragments, FRAGMENT, MARGIN_BREAK } from "./fragments.js";
export { fillLeaders, LEADER_ATTRIBUTE_PREFIX, rewriteLeaders } from "./leaders.js";
export type { Leader } from "./leaders.js";
export { engine, polyfills } from "./deletion.js";
export type { Deletion } from "./deletion.js";
