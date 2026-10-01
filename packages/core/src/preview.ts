/**
 * The Paged.js compatibility layer (`doc/milestones.md` M5.1).
 *
 * "A real Paged.js project runs unchanged, with its script tag swapped." That
 * is the exit check, and it decides the shape of this file: the names, the
 * call signatures and the DOM a project's CSS is written against are Paged.js's
 * (MIT, and studied directly — the clean-room rule is Vivliostyle's alone),
 * while everything under them is stages 1–5.
 *
 * `Previewer` is also the answer to a duplication this repo already had: every
 * browser spec and both corpus runners hand-rolled the same nine lines —
 * normalize, make the frame, inject the author CSS, await fonts, paginate.
 * That sequence *is* the previewer, and it belongs in one place.
 *
 * **Hooks are typed and few** (§M5.1: "not 30 hooks that can change any DOM at
 * any time"). Paged.js's hooks fire inside its layout loop and hand out live
 * DOM mid-decision; ours fire at stage boundaries and hand out the data the
 * stage produced. What that costs is written down in `doc/compat.md`, which is
 * the promise M5.1 makes in place of the hooks it does not have.
 */
import { createEngineFrame, normalize, sizeFrameToPage } from "./source.js";
import { contentArea, resolvePageSpec } from "./page-model.js";
import { rootFlow } from "./flow.js";
import { viewportDeclarations } from "./css/viewport.js";
import { guardConditionalRules, resolveFeatureQueries } from "./css/media.js";
import { paginate } from "./settle.js";
import { userAgentPageRules } from "./css/page-rules.js";
import type { PageRule } from "./css/page-rules.js";
import { MARGIN_BOXES } from "./page-template.js";
import { relayoutAfterImages } from "./margin-boxes.js";
import type { SourceDoc } from "./source.js";
import type { PageRecord } from "./types.js";

/** Where the pages go, and what a Paged.js project's CSS calls it. */
export const PAGES_CLASS = "pagedjs_pages";
/** Paged.js parks the original body content here; so do we. */
export const CONTENT_REF = "pagedjs-content";
/** Marks the ancestors of the pages, which are all that print (`insertPrintCss`). */
const PRINT_PATH = "data-folio-print-path";

/**
 * A hook at a stage boundary.
 *
 * Registered as a *class*, as Paged.js registers them, and instantiated once
 * per preview. Every method is optional and may return a promise.
 */
export interface Handler {
  /**
   * The previewer the handler was constructed with.
   *
   * Declared here because every method below is optional, and TypeScript will
   * not accept a class whose members are *all* absent as this interface — a
   * subclass that implements no hook would otherwise not be a `Handler`.
   */
  readonly previewer?: unknown;
  /** Before stage 1, with the element about to be paginated. */
  beforeParsed?(content: Element, previewer: Previewer): void | Promise<void>;
  /** After stage 1, with the parsed page rules and the rewritten CSS. */
  afterParsed?(source: SourceDoc, previewer: Previewer): void | Promise<void>;
  /**
   * Once per page, with the page as it will be shown and its record.
   *
   * The third parameter is Paged.js's `breakToken` and is always undefined
   * here, which is not an oversight: we have no break token to give. A break
   * is a `Position` in the record, decided before the page was composed,
   * where Paged.js's is a live cursor into a layout still in progress.
   *
   * It holds the position anyway because the most-copied Paged.js handler in
   * existence — the repeating-table-headers recipe, which the corpus carries
   * as `tables/copy-column-widths` — opens with `if (breakToken)`. Shifting
   * our own third argument into that slot made the test truthy and the recipe
   * throw, and a compatibility layer that rearranges a documented signature is
   * not one.
   */
  afterPageLayout?(
    page: HTMLElement,
    record: PageRecord,
    breakToken: undefined,
    previewer: Previewer,
  ): void;
  /** After every page is in the document. */
  afterRendered?(pages: HTMLElement[], previewer: Previewer): void | Promise<void>;
}

type HandlerClass = new (previewer: Previewer) => Handler;

const registered: HandlerClass[] = [];

/**
 * Register handler classes, as `Paged.registerHandlers` does.
 *
 * Module-global because that is the API a project is written against: a
 * script tag registers its handlers at load time, long before anything makes
 * a previewer.
 */
export function registerHandlers(...classes: HandlerClass[]): void {
  registered.push(...classes);
}

export function registeredHandlers(): readonly HandlerClass[] {
  return registered;
}

/** Forget every registered handler. For tests, which must not leak into each other. */
export function clearHandlers(): void {
  registered.length = 0;
}

export type PreviewerSettings = {
  /**
   * The default page, as `@page` declarations — `"size: 5in 3in; margin:
   * 0.5in"`. It is the user agent's page rather than an author rule, so any
   * author `@page` overrides it and `size: landscape` alone rotates it.
   * Unset, the default is Letter with half-inch margins.
   */
  pageDefaults?: string;
  /** A hard stop, so a bug cannot paginate forever. */
  maxPages?: number;
  /** Fail loudly if this family has no `MATH` table (`math.md` §3). */
  mathFont?: string;
  /** Handlers for this previewer, on top of the registered ones. */
  handlers?: HandlerClass[];
};

/**
 * What `preview()` resolves to.
 *
 * Paged.js calls this a "flow" and a project reads `total`, `pages` and
 * `performance` off it; `records` is ours, and is what makes re-laying-out one
 * page a function call rather than a re-run.
 */
export type Flow = {
  total: number;
  pages: HTMLElement[];
  records: PageRecord[];
  /** Milliseconds, as Paged.js reports them. */
  performance: number;
  size: { width: number; height: number };
  /** Pages whose content did not fit: a bug upstream, reported not hidden. */
  overflowed: number[];
};

export class Previewer {
  readonly settings: PreviewerSettings;
  /** The engine's frame, kept so a page can be laid out again from its record. */
  private frame: HTMLIFrameElement | null = null;
  private handlers: Handler[] = [];
  /** The unchanging source, parked in a template once the pages are in. */
  source: Element | null = null;

  constructor(settings: PreviewerSettings = {}) {
    this.settings = settings;
  }

  /**
   * Paginate `content` and put the pages in the document.
   *
   * The argument order is Paged.js's, and so is the behaviour when they are
   * left out: the body's own content, the document's own stylesheets, and the
   * body as the place to render.
   */
  async preview(
    content?: Element | string | null,
    stylesheets?: readonly string[] | null,
    renderTo?: Element | string | null,
  ): Promise<Flow> {
    const started = Date.now();
    const doc = document;
    const source = resolveElement(doc, content) ?? doc.body;
    const into = resolveElement(doc, renderTo) ?? doc.body;

    this.handlers = [...registered, ...(this.settings.handlers ?? [])].map(
      (Class) => new Class(this),
    );
    await this.run((h) => h.beforeParsed?.(source, this));

    const parsed = await normalize(doc, {
      ...(this.settings.mathFont === undefined ? {} : { mathFont: this.settings.mathFont }),
    });
    await this.run((h) => h.afterParsed?.(parsed, this));

    const pageRules =
      this.settings.pageDefaults === undefined
        ? parsed.pageRules
        : [...userAgentPageRules(`@page { ${this.settings.pageDefaults} }`), ...parsed.pageRules];
    // The host's own `html` and `body` hold the engine's frame, and then the
    // pages. An author's `html { display: none }` is about the root, and the
    // root on each page has it (`html'`, `compose.ts`); on the host it hid
    // the frame, and Firefox gives a hidden frame no layout at all — every
    // computed style read back empty — and then it hid the pages (WPT
    // `root-element-display-none`). Only `none`, and only these two: the rest
    // of the host is the application's. A rule, not an inline style:
    // composition copies the host's `<html>` and `<body>` onto every page,
    // style attribute and all, and the page's root must keep the author's
    // `none`; `:root` and `:root > body` are the host's own and nothing else.
    if ([doc.documentElement, doc.body].some((el) => getComputedStyle(el).display === "none")) {
      const guard = doc.getElementById("folio-host-shown") ?? doc.createElement("style");
      guard.id = "folio-host-shown";
      guard.textContent = ":root, :root > body { display: block !important }";
      doc.head.append(guard);
    }
    const frame = createEngineFrame(doc);
    this.frame = frame;
    const flow = rootFlow(doc);
    const first = resolvePageSpec(pageRules, { index: 1, name: null, side: flow.leftward ? "left" : "right", blank: false, flow });
    const area = contentArea(first);
    // Width and height queries in print are answered against the user
    // agent's page area, not the author's `@page` (WPT `media-queries-001`,
    // whose comment says every engine does this). So they are settled here,
    // against a frame that size, for the frame and the host alike — and the
    // page shown is the page measured.
    const uaPage = resolvePageSpec(
      pageRules.filter((r) => r.ua === true),
      { index: 1, name: null, side: "right", blank: false },
    );
    sizeFrameToPage(frame, contentArea(uaPage));
    const uaWindow = frame.contentWindow;
    void uaWindow?.innerWidth;
    const authorCss =
      uaWindow === null ? parsed.authorCss : resolveFeatureQueries(parsed.authorCss, (q) => uaWindow.matchMedia(q).matches);
    sizeFrameToPage(frame, area);
    // What the rewritten viewport units read (`css/viewport.ts`): here, and
    // on every page when it reaches the host, whose own viewport is a window.
    let viewport = viewportDeclarations(area, flow.vertical);
    const root = frame.contentDocument?.documentElement;
    if (root !== undefined) root.style.cssText += `;${viewport}`;
    const target = frame.contentDocument;
    if (target === null) throw new Error("the engine frame has no document");

    const style = target.createElement("style");
    // Extra sheets a project names in `PagedConfig.stylesheets` come after the
    // document's own, which is where the author put them in the cascade.
    const extra = await fetchAll(stylesheets ?? []);
    // No `body { margin: 0 }` here any more: the frame's own body is pinned
    // (`createEngineFrame`) and the page's is the root chain's
    // (`furniture.ts`).
    style.textContent = `${authorCss}\n${extra}`;
    target.head.append(style);
    await loadPageFonts(target, pageRules);
    await target.fonts.ready;

    const run = () =>
      paginate({
        source,
        pageRules,
        target,
        references: parsed.references,
        ...(this.settings.maxPages === undefined ? {} : { maxPages: this.settings.maxPages }),
      });
    let result = run();
    // The viewport is the first page's area, and the first page is named by
    // what it starts with — `page: smaller` makes `100vw` 200px on every page
    // after it too (WPT `page-size-009`). Known only now; a second layout
    // under it cannot change the first page's name, which is the content's.
    const opening = result.records[0] === undefined ? area : contentArea(result.records[0].spec);
    if (opening.inline !== area.inline || opening.block !== area.block) {
      for (const sheet of result.sheets) sheet.remove();
      viewport = viewportDeclarations(opening, flow.vertical);
      if (root !== undefined) root.style.cssText += `;${viewport}`;
      sizeFrameToPage(frame, opening);
      result = run();
    }

    // Pagination is over before the source moves: measuring needs it rendered,
    // and a `<template>`'s contents have no layout at all — `chunk.ts` reads
    // computed styles off source elements to find the containers it must not
    // cut, and would see none of them from inside one.
    // On the page itself rather than on a container: the viewer moves pages
    // into holders of its own, and a variable on what they left behind would
    // stay behind with it.
    for (const sheet of result.sheets) sheet.style.cssText += `;${viewport}`;
    await relayoutAfterImages(result.sheets);
    const pages = this.render(result.sheets, result.records, doc, into, source, authorCss);

    await this.run((h) => h.afterRendered?.(pages, this));

    const [width, height] = result.records[0]?.spec.size ?? [0, 0];
    return {
      total: result.records.length,
      pages,
      records: result.records,
      performance: Date.now() - started,
      size: { width, height },
      overflowed: result.overflowed,
    };
  }

  /** Take the frame down. The records stay valid; the source does not. */
  destroy(): void {
    this.frame?.remove();
    this.frame = null;
  }

  private render(
    sheets: readonly HTMLElement[],
    records: readonly PageRecord[],
    doc: Document,
    into: Element,
    source: Element,
    authorCss: string,
  ): HTMLElement[] {
    const engine = this.frame?.contentDocument ?? null;
    carryEngineStyles(doc, engine);
    // Feature queries are settled already, as the frame answered them where
    // the pages were measured.
    insertRewrittenCss(doc, authorCss);
    guardConditionalRules(doc);

    const area = doc.createElement("folio-pages");
    area.className = PAGES_CLASS;

    const pages = sheets.map((sheet, i) => {
      const page = doc.importNode(sheet, true);
      area.append(page);
      const record = records[i];
      if (record !== undefined) {
        for (const handler of this.handlers) {
          this.guard(() => handler.afterPageLayout?.(page, record, undefined, this));
        }
      }
      return page;
    });

    // The source is parked rather than thrown away: it is what every page is
    // composed from, and `PageRecord` refers to it by position. A template's
    // contents are inert, so the book is not laid out twice.
    if (source.parentNode !== null || source === doc.body) {
      const template = doc.createElement("template");
      template.dataset["ref"] = CONTENT_REF;
      template.content.append(...source.childNodes);
      source.append(template);
    }
    this.source = source;

    into.append(area);
    insertPrintCss(doc, area, pages);
    // The pages are in the document now; the frame's copies are not needed and
    // a book's worth of them is not free.
    for (const sheet of sheets) sheet.remove();
    return pages;
  }

  private async run(call: (h: Handler) => void | Promise<void>): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await call(handler);
      } catch (error) {
        report(error);
      }
    }
  }

  private guard(call: () => void): void {
    try {
      call();
    } catch (error) {
      report(error);
    }
  }
}

/**
 * Put the CSS the pages were measured against into the document showing them.
 *
 * The pages are built in the frame, against CSS stage 1 rewrote: `@media
 * print` unwrapped, `target-counter()` turned into the `attr()` the engine
 * fills in, unknown properties renamed to `--x-*` carriers. The host document
 * has only the author's *original* sheets, where `target-counter(attr(href),
 * page)` is a function no browser implements — so a cross-reference that the
 * engine resolved correctly, and wrote onto the element as `data-x-ref-0="2"`,
 * rendered as nothing at all. The page was right and the picture of it was
 * wrong, which is the same failure the viewer had.
 *
 * Appended rather than swapped in. Paged.js removes the author's sheets and
 * re-adds processed ones; we leave them, because they are also where the
 * author's `@media screen` preview chrome lives — the frame drops those and
 * should, but the document showing the pages on a screen still wants them.
 * Later in the cascade means the rewritten rule wins where the two disagree,
 * which is the whole point, and the screen chrome survives, which is the rest
 * of it.
 *
 * Winning where they disagree is not enough where the original *adds* a rule
 * the frame never applied — `@media not print { .print-only { display: none }
 * }` — so the original's conditional rules are kept off the pages
 * (`guardConditionalRules`), and the copy here has its width queries settled
 * as the frame answered them (`resolveFeatureQueries`), not as the window does.
 */
function insertRewrittenCss(doc: Document, css: string): void {
  const id = "folio-author-css";
  doc.getElementById(id)?.remove();

  const style = doc.createElement("style");
  style.id = id;
  style.textContent = css;
  doc.head.append(style);
}

/**
 * Make "Print to PDF" print the pages as they were laid out.
 *
 * The host keeps the author's original sheets (`insertRewrittenCss`), `@page`
 * rules included, and Chromium has applied those natively since 131: each of
 * our sheets was printed inside a second page box of the browser's own, which
 * drew its own `@bottom-center { content: counter(page) }` beside ours and
 * shrank our sheet to fit inside the author's margins (`print.spec.ts`).
 *
 * So in print media the browser's page is made to be our sheet and nothing
 * more: no margins, no margin boxes, and exactly the sheet's size — a named
 * page per distinct size, since a named page can change it. `!important`
 * because the author's `@page :first` or `@page chapter` outranks a plain
 * `@page` by specificity, and an important declaration outranks it outright;
 * the author's sheets are not edited, because a second preview reads them
 * again. The author's own `page:` values would force breaks inside a sheet,
 * so they are set back to `auto` in there. Deleted when the host document
 * stops carrying the author's `@page` rules, which nothing plans to do.
 *
 * And only the pages print. The source stays in the document as an empty box
 * with its content parked in a `<template>`, usually just before the pages,
 * and an empty box is still a box: Chromium gave it a page of its own, with
 * no name, and broke to `folio-sheet-0` after it — a blank sheet in front
 * of page 1 of every document not paginated from `body`. So in print the
 * pages' ancestors are the only elements shown, with nothing around them,
 * which is the viewer's rule for the same reason (`preparePrint`).
 */
function insertPrintCss(doc: Document, area: HTMLElement, pages: readonly HTMLElement[]): void {
  const id = "folio-print-css";
  doc.getElementById(id)?.remove();
  for (const el of doc.querySelectorAll(`[${PRINT_PATH}]`)) el.removeAttribute(PRINT_PATH);
  for (let el = area.parentElement; el !== null; el = el.parentElement) {
    el.setAttribute(PRINT_PATH, "");
  }

  const names = new Map<string, string>();
  for (const page of pages) {
    const size = `${page.style.width} ${page.style.height}`;
    if (!names.has(size)) names.set(size, `folio-sheet-${String(names.size)}`);
    page.dataset["printPage"] = names.get(size);
  }
  const boxes = Object.keys(MARGIN_BOXES)
    .map((box) => `@${box} { content: none !important }`)
    .join(" ");
  const sizes = [...names].map(
    ([size, name]) =>
      `@page ${name} { size: ${size} !important; margin: 0 !important }\n` +
      `[data-print-page="${name}"] { page: ${name} !important }`,
  );

  const style = doc.createElement("style");
  style.id = id;
  style.textContent = `@media print {
@page { margin: 0 !important; ${boxes} }
${sizes.join("\n")}
body :not([${PRINT_PATH}], .${PAGES_CLASS}, .${PAGES_CLASS} *) { display: none !important }
[${PRINT_PATH}] {
  display: block !important; position: static !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
}
.${PAGES_CLASS} { margin: 0 !important; padding: 0 !important }
.pagedjs_page { margin: 0 !important; box-shadow: none !important; break-after: page }
.pagedjs_page:last-child { break-after: auto }
.pagedjs_page * { page: auto !important }
}`;
  doc.head.append(style);
}

/**
 * Bring the engine's own stylesheets into the document the pages now live in.
 *
 * The same reasoning as the viewer's copy of this, and deliberately a second
 * copy: `@truke/folio-viewer` consumes pages and knows nothing about the engine
 * (`plan.md` §4), so it cannot import this one without acquiring a dependency
 * the package exists not to have. Ten lines is the cheaper of the two prices.
 */
function carryEngineStyles(doc: Document, from: Document | null): void {
  if (from === null || from === doc) return;
  for (const style of from.querySelectorAll("style[id^='folio-']")) {
    if (doc.getElementById(style.id) !== null) continue;
    doc.head.append(doc.importNode(style, true));
  }
}

/**
 * A handler that throws does not take the document with it.
 *
 * Handlers are a project's own code running at a stage boundary, and the
 * pages are already correct without them — Paged.js's hooks *are* the layout,
 * so a throw there is fatal by construction; ours are not. Reported rather
 * than swallowed: a silent hook is worse than a noisy one.
 */
/**
 * Load the faces `@page` and its margin boxes name, before anything is laid
 * out.
 *
 * `fonts.ready` waits only for faces already *loading*, and a face starts to
 * load when text first uses it. Margin-box text is written after the last
 * page, and measured at once (`layoutMarginBoxes`), so a family only the
 * margin boxes use was measured in the fallback font and drawn in its own:
 * WPT `dimensions-003`'s boxes were sized for an 8px "x" and painted a 16px
 * one. Asking for the family by name loads it without loading every face the
 * stylesheet declares.
 */
async function loadPageFonts(target: Document, pageRules: readonly PageRule[]): Promise<void> {
  const fonts = new Set<string>();
  for (const rule of pageRules) {
    for (const declarations of [rule.declarations, ...Object.values(rule.marginBoxes)]) {
      const family = declarations["font-family"] ?? /(?:^|\s)(?:[\d.]+\w*%?)(?:\/\S+)?\s+(.+)$/.exec(declarations["font"] ?? "")?.[1];
      if (family === undefined) continue;
      const weight = declarations["font-weight"] ?? (/\bbold\b/.test(declarations["font"] ?? "") ? "bold" : "normal");
      const italic = /\bitalic\b/.test(`${declarations["font-style"] ?? ""} ${declarations["font"] ?? ""}`);
      fonts.add(`${italic ? "italic " : ""}${weight} 16px ${family}`);
    }
  }
  // A family nothing declares a face for loads nothing; a malformed one throws.
  await Promise.all([...fonts].map((font) => target.fonts.load(font).catch(() => [])));
}

function report(error: unknown): void {
  console.error("folio: a handler threw and was skipped", error);
}

function resolveElement(doc: Document, what: Element | string | null | undefined): Element | null {
  if (what === null || what === undefined) return null;
  return typeof what === "string" ? doc.querySelector(what) : what;
}

/** Fetch the extra stylesheets a project named, in order. */
async function fetchAll(hrefs: readonly string[]): Promise<string> {
  const texts = await Promise.all(
    hrefs.map(async (href) => {
      try {
        const res = await fetch(href);
        return res.ok ? await res.text() : "";
      } catch {
        // A sheet we cannot read is one the browser may still apply to the
        // rendered pages; stage 1 takes the same view of a broken `@import`.
        return "";
      }
    }),
  );
  return texts.join("\n");
}
