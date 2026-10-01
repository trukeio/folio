/**
 * The document canvas (css-page-3 §3.1, `doc/review.md` §3.4.2).
 *
 * The root's background is not the root's to paint. It propagates to the
 * canvas — from `html`, or from `body` when `html` has none (css-backgrounds-3
 * §2.11.2) — and in paged media the canvas is "drawn as the page box's
 * background: by default its background painting area covers the page box's
 * border box", which is the page area while `@page` has no border or padding.
 * It "remains, however, positioned with respect to the root element": one
 * background, cut across the pages, so a `repeat-y` image on page 2 carries on
 * from where page 1 cut it (WPT `page-background-003`), and a `no-repeat` one
 * is on page 1 only (`-001`).
 *
 * So each page gets a canvas layer on its page area, clipped, with the
 * colour on it, and in it one box for the image layers whose *padding box* is
 * the root's whole box — its width, and its fragments' heights on every page
 * added up — placed where that box sits on this page, and whose transparent
 * *border* reaches the rest of the page area. Positioning is against the
 * padding box and painting against the border box, so a percentage in
 * `background-position` or `background-size` resolves against the root as if
 * it had never been cut, a repeating image or a gradient still fills the page
 * (`page-box-003`), and no value is rewritten.
 *
 * After the last page, because the root's whole height is known only then;
 * and it cannot move a break, because nothing here is in the flow. The layer
 * is the page box's last child at `z-index: -1`, on the page area's grid
 * cell: above the page's own background, beneath the content, and above a
 * margin box that is at `z-index: -1` too, which tree order decides
 * (`paint-order-003`) — §3.1's order.
 *
 * **Delete when** the pages are built in a print context that paints the
 * canvas itself — the same condition as `css/media.ts`.
 */
import { ROOT, SPLIT_TO } from "./compose.js";
import { LAYER, PAGE_LAYER } from "./page-template.js";
import type { Deletion } from "./native.js";

/** The root's origin and clip are not copied: the layer's own say where the
 * root's box is and how far the painting reaches. */
const IMAGE_LAYERS = ["background-image", "background-position", "background-size", "background-repeat"] as const;

/**
 * The root's box as CSS has it, where its margins do not collapse. Its clone
 * is a plain block, and `review.md` §3 keeps it one: a block formatting
 * context counted the bottom margin at every break and cost corpus pages
 * Chromium does not print. So `body`'s 8px top margin collapses up through
 * it and moves its rect down. The root starts at the content area's top plus
 * its own margin — the content area is a grid item, which nothing collapses
 * through — and ends below a last child's margin that collapsed out of it.
 */
function rootBox(
  root: HTMLElement,
  content: HTMLElement,
  view: Window,
): { top: number; left: number; width: number; height: number } {
  const rect = root.getBoundingClientRect();
  // Below the start edge's page floats, when the page has some.
  const above = content.querySelector(':scope > [data-edge="start"]');
  const edge = above === null ? content.getBoundingClientRect().top : above.getBoundingClientRect().bottom;
  const top = edge + (parseFloat(view.getComputedStyle(root).marginTop) || 0);
  const last = root.lastElementChild;
  const bottom =
    last === null
      ? rect.bottom
      : Math.max(rect.bottom, last.getBoundingClientRect().bottom + (parseFloat(view.getComputedStyle(last).marginBottom) || 0));
  return { top, left: rect.left, width: rect.width, height: bottom - top };
}

/** A vertical root's piece on a page: all of the page when it continues. */
function verticalBox(root: HTMLElement, content: HTMLElement): { top: number; left: number; width: number; height: number } {
  const r = (root.hasAttribute(SPLIT_TO) ? content : root).getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Paint the canvas on every page. `pages` are the content areas, in order. */
export function paintCanvas(pages: readonly HTMLElement[]): void {
  const view = pages[0]?.ownerDocument.defaultView ?? null;
  if (view === null) return;
  const roots = pages.map((p) => p.querySelector<HTMLElement>(`[${ROOT}]`));
  const first = roots.find((r) => r !== null) ?? null;
  if (first === null) return;

  // No root box, no canvas — and no page decoration either: Chromium prints
  // `html { display: none }` as a blank sheet, `@page { background }` and all
  // (WPT `root-element-display-none`).
  if (view.getComputedStyle(first).display === "none") {
    for (const page of pages) {
      for (const layer of page.parentElement?.querySelectorAll(`:scope > ${PAGE_LAYER}`) ?? []) layer.remove();
    }
    return;
  }

  // The root's own background, or body's when the root's is empty.
  const fromBody = isEmpty(view.getComputedStyle(first));
  const sourceOf = (root: HTMLElement | null): HTMLElement | null =>
    root === null || !fromBody
      ? root
      : ([...root.children].find((c) => c.localName === "body") as HTMLElement | undefined) ?? null;
  const firstSource = sourceOf(first);
  if (firstSource === null) return;
  const style = view.getComputedStyle(firstSource);
  if (isEmpty(style)) return;

  const color = style.backgroundColor;
  const layers = IMAGE_LAYERS.map((p) => `${p}:${style.getPropertyValue(p)}`).join(";");
  const fixed = style.backgroundAttachment.split(",").every((a) => a.trim() === "fixed");
  // A root box that continues fills its fragmentainer: its fragment on a page
  // it continues from reaches the page area's foot, however early the page
  // broke. So a `no-repeat` image taller than page one's text is still whole
  // on page one, and not carried over (WPT `page-background-001`).
  // In vertical writing the root's pieces lie along x, one page after the
  // next (`review.md` §5; WPT `body-background-v*`): a piece is the
  // fragment's width, and a fragment that continues fills its page.
  const vertical = /^(vertical|sideways)/.test(view.getComputedStyle(pages[0] as HTMLElement).writingMode);
  const heights = roots.map((r, i) => {
    if (r === null) return 0;
    const content = pages[i] as HTMLElement;
    if (vertical) return r.hasAttribute(SPLIT_TO) ? content.getBoundingClientRect().width : r.getBoundingClientRect().width;
    const box = rootBox(r, content, view);
    const foot = content.getBoundingClientRect().bottom;
    return r.hasAttribute(SPLIT_TO) ? foot - box.top : box.height;
  });
  const whole = heights.reduce((a, b) => a + b, 0);

  let placed = 0;
  pages.forEach((content, i) => {
    const root = roots[i] ?? null;
    const box =
      root === null
        ? null
        : vertical
          ? verticalBox(root, content)
          : rootBox(root, content, view);
    const doc = content.ownerDocument;
    const pageBox = content.parentElement;
    if (pageBox === null) return;

    const canvas = doc.createElement("folio-canvas");
    canvas.style.cssText = [
      "position:absolute",
      // The page area's cell of the page box's grid (`page-template.ts`).
      "grid-row:2 / span 3",
      "grid-column:2 / span 3",
      "inset:0",
      "overflow:hidden",
      "z-index:-1",
      "pointer-events:none",
      `background-color:${color}`,
    ].join(";");

    // In front of the page's border (`page-template.ts`), which §3.1 paints
    // above the canvas; after everything else in the page box.
    const border = pageBox.querySelector(`:scope > [${LAYER}="border"]`);
    pageBox.insertBefore(canvas, border);
    // The root's whole box, in the canvas's coordinates — the page box's
    // border box, which is the page area only while the page has no border
    // or padding; `fixed` is the canvas itself (§3.1).
    const area = canvas.getBoundingClientRect();
    const x = fixed || box === null ? 0 : box.left - area.left - (vertical ? placed : 0);
    const y = fixed || box === null ? 0 : box.top - area.top - (vertical ? 0 : placed);
    const w = fixed || box === null ? area.width : vertical ? whole : box.width;
    const h = fixed ? area.height : vertical ? (box?.height ?? area.height) : whole;
    const edge = {
      top: Math.max(0, y),
      left: Math.max(0, x),
      bottom: Math.max(0, area.height - (y + h)),
      right: Math.max(0, area.width - (x + w)),
    };
    const image = doc.createElement("folio-canvas");
    image.style.cssText = [
      "position:absolute",
      "box-sizing:content-box",
      `left:${x - edge.left}px`,
      `top:${y - edge.top}px`,
      `width:${w}px`,
      `height:${h}px`,
      "border-style:solid",
      "border-color:transparent",
      `border-width:${edge.top}px ${edge.right}px ${edge.bottom}px ${edge.left}px`,
      layers,
      "background-origin:padding-box",
      "background-clip:border-box",
    ].join(";");
    canvas.append(image);

    sourceOf(root)?.style.setProperty("background", "none", "important");
    placed += heights[i] ?? 0;
  });
}

/** Transparent and no image: the background that propagates past itself. */
function isEmpty(style: CSSStyleDeclaration): boolean {
  const color = style.backgroundColor.replace(/\s+/g, "");
  const transparent = color === "transparent" || /^rgba\(\d+,\d+,\d+,0\)$/.test(color);
  return transparent && style.backgroundImage === "none";
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "page painting",
  files: ["page-paint.ts"],
  feature: "The canvas: the root's background on the page area",
  when: "The pages are built in a print context that paints the canvas per page",
  tests: [/^css\/css-page\/(page-background|body-background-)/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
