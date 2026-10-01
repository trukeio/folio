/**
 * Stage 1: normalize source (`doc/plan.md` §2).
 *
 * Parse the HTML into a document that is never changed, and wait for fonts and
 * image decoding before anything is measured. Pages are generated *from* this
 * document, the way Vivliostyle does it and unlike Paged.js, which carries
 * extracted DOM from page to page.
 *
 * The waiting is not a detail. A paragraph measured against a fallback font is
 * wrong by a large margin and every page after it moves; for math the same
 * mistake is worse (`math.md` §3). Stage 1 is where that is made impossible.
 */
import { ENGINE_FRAME } from "./compose.js";
import { BOX_PINS } from "./furniture.js";
import { ensureMathFont } from "./math/font.js";
import { extractPageRules, resolvePageFontUnits } from "./css/page-rules.js";
import { mediaApplies, resolvePrintMedia } from "./css/media.js";
import { carrierRegistrations, rewriteCarriers, rewriteRootSelector } from "./css/rewrite.js";
import { rewriteNthFragment } from "./nth-fragment.js";
import { rewriteViewportUnits } from "./css/viewport.js";
import { rewriteReferences } from "./references.js";
import type { Reference } from "./references.js";
import type { PageRule } from "./css/page-rules.js";

// Whether a sheet applies is the same question as whether an `@media` block
// inside it does, so `css/media.ts` answers both; stage 1 keeps the name it
// has always exported.
export { mediaApplies } from "./css/media.js";

export type SourceDoc = {
  /** Never mutated after this function returns. */
  readonly document: Document;
  readonly root: Element;
  /** Every `@page` rule found, in source order. */
  readonly pageRules: readonly PageRule[];
  /**
   * Author CSS with `@page` removed, carriers added, and nothing else touched.
   *
   * The carriers are what let the browser cascade properties it would
   * otherwise drop (§5). Everything the rewrite does not recognise is copied
   * through byte for byte.
   */
  readonly authorCss: string;
  /** `target-counter()` and `target-text()` calls found in that CSS (§2 stage 5). */
  readonly references: readonly Reference[];
};

/**
 * The engine's own iframe: author CSS never collides with the viewer UI, and
 * nothing in the host page is taken over (§2).
 *
 * It hangs off the root element, not off `body`, because `body` is usually the
 * root that gets paginated. A frame appended there is a child of the source:
 * the fragmenter enumerates a break before it, composition copies it into a
 * page, and the document acquires a trailing page holding nothing but the
 * engine's own measuring apparatus. It measures the same either way — an
 * iframe outside `body` is still laid out, and still gets a standards-mode
 * document — and out here it cannot be mistaken for content.
 */
export function createEngineFrame(host: Document = document): HTMLIFrameElement {
  const frame = host.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute(ENGINE_FRAME, "");
  frame.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;border:0";
  host.documentElement.append(frame);

  // A blank iframe's document has no doctype, so it is in quirks mode while
  // the source document is in standards mode. Author CSS then means something
  // different in the frame than it does on the page it came from — and every
  // measurement the fragmenter takes is of that different thing.
  const doc = frame.contentDocument;
  if (doc !== null) {
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    // Furniture that inherits (`BOX_PINS`): the author's `html` and `body`
    // rules reach the pages' inherited values through these, and their box
    // is the root's on each page, not the frame's.
    doc.documentElement.style.cssText = BOX_PINS;
    doc.body.style.cssText = BOX_PINS;
  }
  return frame;
}


/**
 * Give the frame the first page's page area as its viewport.
 *
 * In paged media the initial containing block is the page area of the first
 * page (css-page-3 §3.1), so that is what `100vh`, `50vw` and a percentage
 * height on the root resolve against — and what a media query's `width`
 * reads. The frame is where every page is measured, and at 0×0 it made
 * `100vh` zero: WPT's `page-margin-*-print` tests are three `100vh` blocks
 * that Chromium prints on three pages and this engine put on one.
 */
export function sizeFrameToPage(frame: HTMLIFrameElement, area: { inline: number; block: number }): void {
  frame.style.width = `${area.inline}px`;
  frame.style.height = `${area.block}px`;
}

/** How deep `@import` chains are followed. CSS allows any depth; a book does
 * not need one, and a cycle must not hang stage 1. */
const MAX_IMPORT_DEPTH = 8;

/**
 * Collect author CSS from `<style>` and same-origin `<link rel=stylesheet>`,
 * following `@import`.
 *
 * `@import` is not a detail: the corpus's `issues/imports` fixture keeps its
 * `@page { size: A5 }` and its forced breaks in an imported file, and without
 * following it the document paginates at the default page size — six pages
 * became two.
 *
 * `applies` says which `media` a sheet may name: print, as the pages are, by
 * default; the screen for the math drop-in (`math-screen.ts`), which puts a
 * rewritten copy of the author's CSS beside the original in a live document.
 */
export async function collectCss(
  doc: Document,
  applies: (media: string | null) => boolean = mediaApplies,
): Promise<string> {
  const parts: string[] = [];
  const seen = new Set<string>();

  const fetchSheet = async (url: string, depth: number): Promise<string> => {
    if (depth > MAX_IMPORT_DEPTH || seen.has(url)) return "";
    seen.add(url);
    try {
      const res = await fetch(url);
      if (!res.ok) return "";
      return await resolveImports(rebaseUrls(await res.text(), url), url, depth);
    } catch {
      // A stylesheet we cannot read is one the browser will still apply to the
      // rendered pages; we only lose its @page rules, so carry on rather than
      // failing the whole document.
      return "";
    }
  };

  /** Replace every `@import` with the sheet it names, in place. */
  const resolveImports = async (css: string, base: string, depth: number): Promise<string> => {
    const rule = /@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)([^;]*);/g;
    const matches = [...css.matchAll(rule)];
    if (matches.length === 0) return css;

    const texts = await Promise.all(
      matches.map(async (m) => {
        const href = m[2] ?? m[4] ?? "";
        if (!applies(m[5] ?? "")) return "";
        return fetchSheet(new URL(href, base).href, depth + 1);
      }),
    );

    let out = "";
    let at = 0;
    matches.forEach((m, i) => {
      out += css.slice(at, m.index) + (texts[i] ?? "");
      at = m.index + m[0].length;
    });
    return out + css.slice(at);
  };

  for (const node of doc.querySelectorAll("style, link[rel~=stylesheet]")) {
    // A sheet the author marked `screen` is not part of the printed document.
    // Ours is the only engine that has to be told: the frame the pages are
    // built in is a screen, so the browser would apply it.
    if (!applies(node.getAttribute("media"))) continue;

    if (node instanceof HTMLStyleElement) {
      parts.push(await resolveImports(node.textContent, doc.baseURI, 0));
      continue;
    }
    const href = node.getAttribute("href");
    if (href === null) continue;
    parts.push(await fetchSheet(new URL(href, doc.baseURI).href, 0));
  }
  return parts.join("\n");
}

/**
 * Make a fetched sheet's relative `url()`s absolute, against the sheet.
 *
 * Its text is used in a `<style>`, where a relative URL resolves against the
 * document instead: a linked `css/book.css` asking for `../fonts/x.woff2`
 * loaded nothing. On the host the copy is a second, later `@font-face` for
 * the same face, which can shadow the working original, and a later
 * `background` whose image is not there.
 */
function rebaseUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/g, (whole, quote: string, href: string) => {
    if (href === "" || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return whole;
    try {
      return `url(${quote}${new URL(href, base).href}${quote})`;
    } catch {
      return whole;
    }
  });
}

/**
 * Wait until measurement means something: fonts loaded, images decoded.
 * Images that fail are not an error here — a broken image still has a box.
 */
export async function settle(doc: Document): Promise<void> {
  await doc.fonts.ready;
  const images = [...doc.images].filter((img) => !img.complete);
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
}

/**
 * Stage 1. The returned document is the source of truth and stays unchanged.
 *
 * `mathFont` is the one option here that can fail the run: a document set in a
 * family with no `MATH` table lays its formulas out wrongly and silently
 * (`math.md` §3), so naming the family is also asking to be told. Left out,
 * nothing is checked — which is what the Paged.js corpus needs, since its math
 * fixtures ship pre-rendered MathJax and no math font at all.
 */
export async function normalize(
  doc: Document,
  { mathFont }: { mathFont?: string } = {},
): Promise<SourceDoc> {
  await settle(doc);
  if (mathFont !== undefined) await ensureMathFont(mathFont, doc);

  // Before `@page` is extracted: a document that also renders on screen puts
  // its `@page` rule inside `@media print`, and the extractor does not look
  // inside blocks.
  const css = resolvePrintMedia(await collectCss(doc));
  const { rules: extracted, rest } = extractPageRules(css);
  const rootFontSize = parseFloat(getComputedStyle(doc.documentElement).fontSize) || 16;
  const rules = resolvePageFontUnits(extracted, rootFontSize);

  const { css: withReferences, references } = rewriteReferences(rest);

  return {
    document: doc,
    root: doc.body,
    pageRules: rules,
    authorCss: `${carrierRegistrations()}\n${rewriteViewportUnits(rewriteCarriers(rewriteRootSelector(rewriteNthFragment(withReferences))))}`,
    references,
  };
}
