/**
 * The engine's own elements (`doc/plan.md` §2: the engine's furniture is never
 * in the source tree — and never styled as if it were).
 */
const FURNITURE_STYLE_ID = "folio-furniture-rules";

/**
 * The one rule every one of the engine's elements needs.
 *
 * None of them is a `<div>`. A page box, a content area, a margin box, the
 * box the fragmenter measures in: if any of these is a `div`, the author's
 * `div { … }` styles it — and author CSS says `div` all the time, because to
 * the author a `div` is part of the document. The first WPT test run with the
 * engine loaded (`css-page/basic-pagination-003-print`) was a reference whose
 * `div { height: 283px }` sized the engine's content areas. `break-before:
 * page` on `div` would have put a forced break before every numbered
 * equation, whose grid is ours too.
 *
 * So each has a name of its own. The Paged.js class names stay on them
 * (`.pagedjs_page`, `.pagedjs_area`, …), which is what a project's CSS
 * actually selects. A custom element is `display: inline` until told
 * otherwise, and this is where it is told — by type selector, the weakest
 * there is, so an author's `.pagedjs_pages { display: flex }` still wins.
 */
export const FURNITURE = [
  "folio-pages",
  "folio-sheet",
  "folio-page",
  "folio-content",
  "folio-margin",
  "folio-margin-area",
  "folio-margin-content",
  "folio-mark",
  "folio-measure",
  "folio-flow",
  "folio-root",
  "folio-canvas",
  "folio-page-layer",
  "folio-footnotes",
  "folio-footnote",
  "folio-page-floats",
  "folio-equation",
] as const;

export function ensureFurnitureRules(target: Document): void {
  if (target.getElementById(FURNITURE_STYLE_ID) !== null) return;
  const style = target.createElement("style");
  style.id = FURNITURE_STYLE_ID;
  // Nothing here touches the root chain's `body`: the UA's `body { margin:
  // 8px }` is on the page, as CSS says and as Chromium prints it
  // (`doc/review.md` §3.6, reversed). A page is paper: white where
  // nothing paints it, rather than a window onto whatever the host document
  // is behind it — an author's `body { background: yellow }` showed in every
  // page's margins, where print has white (WPT `basic-pagination-003`,
  // `page-left-right-*`).
  style.textContent =
    `${FURNITURE.join(", ")} { display: block }\n` +
    `:where(folio-page) { background-color: white }`;
  target.head.append(style);
}

/**
 * Furniture that inherits: an element that passes on what the author's rules
 * say it inherits, and nothing about its box. Two kinds (`doc/review.md` §3
 * §3): the frame's own `html` and `body`, and the root chain above a source
 * root that is not `body`, which is the application's layout.
 *
 * The frame's own `html` and `body` hold the pages and the measuring box.
 * They still match the author's `html`, `body` and `:root` rules, and must:
 * `rem` is the real root's font
 * size, and `:root`'s custom properties reach the margin boxes through it.
 * But what those rules say about a *box* is for the root on the page, not
 * for the frame: `html { display: none }` hid every page and the box they
 * were measured in (WPT `root-element-display-none`), and `body { display:
 * grid }` made the pages grid items. So the box properties are pinned —
 * inline and important, which an author's important rule cannot beat — and
 * the inherited ones are left alone.
 */
export const BOX_PINS = [
  "display:block",
  "position:static",
  "float:none",
  "margin:0",
  "padding:0",
  "border:0",
  "background:none",
  "width:auto",
  "height:auto",
  "min-width:0",
  "min-height:0",
  "max-width:none",
  "max-height:none",
  "overflow:visible",
  "transform:none",
  "columns:auto",
  "contain:none",
  "visibility:visible",
  // Counted on `html'` and `body'` on the page; counted here as well, the
  // browser would advance a counter twice for one declaration.
  "counter-reset:none",
  "counter-increment:none",
  "counter-set:none",
]
  .map((d) => `${d} !important`)
  .join(";");
