/**
 * The viewer (`doc/plan.md` §4, tier V; `doc/milestones.md` M5.2).
 *
 * A separate package that consumes pages and knows nothing about how they were
 * decided — no measuring, no breaking, no CSS parsing. Spreads, zoom, page
 * navigation and a virtualized list, over elements someone else produced.
 *
 * **Virtualized because a book is not a page.** M5.2's exit check is a
 * 300-page book, and a viewer that puts three hundred pages in the document
 * makes the browser lay out three hundred pages on every scroll. Each page
 * here is a placeholder at the page's own size, and the page itself is mounted
 * only while it is near the viewport. What that buys is a number that does not
 * grow with the book: the count of mounted pages is bounded by the window,
 * which is what `viewer.spec.ts` asserts rather than a time.
 *
 * The one thing it knows about the engine is that a page carries its size as
 * an inline style, which is how a placeholder can stand in for a page it has
 * not rendered yet. That is a smaller coupling than measuring one would be.
 */

/** A page's record, as `@truke/folio` produces it. Only the side is read. */
export type ViewerRecord = {
  spec: { index: number; side: "left" | "right"; blank: boolean };
};

export type ViewerOptions = {
  /** Where to render, in the host document. */
  host: HTMLElement;
  /** The pages, as `paginate` returned them. They are not moved or changed. */
  sheets: readonly HTMLElement[];
  /** Records, for spreads. Without them every page is treated as a recto. */
  records?: readonly ViewerRecord[];
  /** Space between pages, in CSS pixels. */
  gap?: number;
  /** 1 is actual size. */
  zoom?: number;
  /** Show left and right pages side by side. */
  spreads?: boolean;
  /**
   * How many screens either side of the viewport to keep mounted.
   *
   * One is enough that a scroll never shows a blank page on any machine this
   * has been tried on, and small enough that the mounted count stays flat.
   */
  overscan?: number;
  /** Called when the page most in view changes. */
  onPage?: (page: number) => void;
};

export type Viewer = {
  /** Scroll a page into view. 1-based, as the page counter is. */
  goTo(page: number): void;
  next(): void;
  previous(): void;
  /** The page most in view. */
  readonly current: number;
  readonly total: number;
  setZoom(zoom: number): void;
  setSpreads(on: boolean): void;
  /** How many pages are mounted. The virtualization, in one number. */
  readonly mounted: number;
  destroy(): void;
};

const STYLE_ID = "folio-viewer-style";
const PRINT_ID = "folio-viewer-print";
/** Marks the viewer's ancestors, which are all that print (`preparePrint`). */
const PATH = "data-folio-viewer-path";

/** The sixteen margin boxes of css-page-3, which the browser draws itself. */
const MARGIN_BOXES = ["top-left-corner", "top-left", "top-center", "top-right",
  "top-right-corner", "left-top", "left-middle", "left-bottom", "right-top", "right-middle",
  "right-bottom", "bottom-left-corner", "bottom-left", "bottom-center", "bottom-right",
  "bottom-right-corner"];

/** Render pages into the host document. */
export function renderViewer(options: ViewerOptions): Viewer {
  const { host, sheets, records, gap = 24, overscan = 1, onPage } = options;
  const doc = host.ownerDocument;
  const hostView = doc.defaultView;
  if (hostView === null) throw new Error("the host element is not in a rendered document");
  // Declared non-null, not merely narrowed: the closures below capture it, and
  // control-flow narrowing does not reliably cross a function boundary.
  const view: Window & typeof globalThis = hostView;

  let zoom = options.zoom ?? 1;
  let spreads = options.spreads ?? false;
  let current = 1;

  ensureStyle(doc);
  carryEngineStyles(doc, sheets[0]?.ownerDocument);

  const list = doc.createElement("folio-viewer");
  list.className = "folio-viewer";
  list.style.setProperty("--folio-gap", `${gap}px`);

  // A placeholder per page, at the page's own size, so the list has its full
  // height before a single page is rendered and the scrollbar does not move
  // under the reader as pages mount.
  const holders = sheets.map((sheet, i) => {
    const holder = doc.createElement("folio-viewer-page");
    holder.className = "folio-viewer-page";
    holder.dataset["page"] = String(i + 1);
    const [w, h] = sizeOf(sheet);
    // Physical, as the pages are: a vertical host must not turn a holder.
    holder.style.width = `${w}px`;
    holder.style.height = `${h}px`;
    // Page 1 is a recto and stands alone, so a spread of two starts at page 2.
    const side = records?.[i]?.spec.side ?? (i % 2 === 0 ? "right" : "left");
    holder.dataset["side"] = side;
    list.append(holder);
    return holder;
  });

  host.append(list);
  applyZoom();
  applySpreads();

  // `rootMargin` in screens, not pixels: the useful distance is "about to be
  // scrolled to", which is a property of the window rather than of the paper.
  const margin = `${Math.round(overscan * 100)}%`;
  const observer = new view.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const holder = entry.target as HTMLElement;
        // An entry is the state when it was computed, which can be before a
        // `goTo`: the first batch reports every page but the first few as out
        // of view, and arriving after `goTo(120)` it unmounted page 120 — a
        // blank page where the reader had just asked to be. Ask again.
        if (entry.isIntersecting) mount(holder);
        else if (!printing && !near(holder)) unmount(holder);
      }
      report();
    },
    { root: null, rootMargin: margin, threshold: 0 },
  );
  for (const holder of holders) observer.observe(holder);

  // The observer does not report until the next frame, so a viewer that waited
  // for it would paint blank and fill in afterwards. A screenful is mounted up
  // front instead — arithmetic, not measurement: the page's own height and the
  // window's, which are both known before anything is laid out.
  const perScreen = Math.max(1, Math.ceil(view.innerHeight / (sizeOf(sheets[0])[1] || 1)));
  for (const holder of holders.slice(0, perScreen + 1)) mount(holder);

  function mount(holder: HTMLElement): void {
    if (holder.firstChild !== null) return;
    const index = Number(holder.dataset["page"] ?? "1") - 1;
    const sheet = sheets[index];
    if (sheet === undefined) return;
    // Imported, never moved: the engine keeps the pages, and a viewer that
    // took them away would stop `(spec, start)` from being re-layoutable.
    holder.append(doc.importNode(sheet, true));
  }

  function unmount(holder: HTMLElement): void {
    holder.replaceChildren();
  }

  /** Within the observer's margin of the viewport, measured now. */
  function near(holder: HTMLElement): boolean {
    const slack = view.innerHeight * overscan;
    const rect = holder.getBoundingClientRect();
    return rect.bottom >= -slack && rect.top <= view.innerHeight + slack;
  }

  // Printing prints what is in the document, and a virtualized list has three
  // pages in it: the rest printed as blank placeholders. So every page is
  // mounted for the print and the far ones let go after it. Both events fire
  // for the print dialogue and for Chromium's print-to-PDF alike.
  // Nothing is let go while a print is being made: a preview can stay open
  // and lay the page out again, and in print media the list is a different
  // height, so the observer would report most pages as gone.
  let printing = false;
  const beforePrint = (): void => {
    printing = true;
    preparePrint(doc, list, holders);
    for (const holder of holders) mount(holder);
  };
  // After printing the observer saw nothing change, so it will not say which
  // pages have left; the far ones are let go by hand.
  const afterPrint = (): void => {
    printing = false;
    for (const holder of holders) if (!near(holder)) unmount(holder);
  };
  view.addEventListener("beforeprint", beforePrint);
  view.addEventListener("afterprint", afterPrint);

  /** The page most in view, which is the first one the viewport touches. */
  function report(): void {
    if (onPage === undefined) return;

    let best = current;
    let bestTop = Infinity;
    for (const holder of holders) {
      const rect = holder.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= view.innerHeight) continue;
      const top = Math.abs(rect.top);
      if (top < bestTop) {
        bestTop = top;
        best = Number(holder.dataset["page"] ?? "1");
      }
    }
    if (best !== current) {
      current = best;
      onPage(current);
    }
  }

  function applyZoom(): void {
    list.style.setProperty("--folio-zoom", String(zoom));
  }

  function applySpreads(): void {
    list.classList.toggle("folio-viewer-spreads", spreads);
  }

  return {
    goTo(page) {
      const holder = holders[page - 1];
      if (holder === undefined) return;
      current = page;
      // Mount before scrolling: an empty placeholder scrolled to is a blank
      // page for as long as the observer takes to notice.
      mount(holder);
      holder.scrollIntoView({ block: "start" });
    },
    next() {
      this.goTo(Math.min(current + (spreads ? 2 : 1), holders.length));
    },
    previous() {
      this.goTo(Math.max(current - (spreads ? 2 : 1), 1));
    },
    get current() {
      return current;
    },
    get total() {
      return holders.length;
    },
    setZoom(next) {
      zoom = next;
      applyZoom();
    },
    setSpreads(on) {
      spreads = on;
      applySpreads();
    },
    get mounted() {
      return holders.filter((h) => h.firstChild !== null).length;
    },
    destroy() {
      observer.disconnect();
      view.removeEventListener("beforeprint", beforePrint);
      view.removeEventListener("afterprint", afterPrint);
      for (const el of doc.querySelectorAll(`[${PATH}]`)) el.removeAttribute(PATH);
      doc.getElementById(PRINT_ID)?.remove();
      list.remove();
    },
  };
}

/**
 * A page's size, from the inline style the engine wrote on it.
 *
 * Not `getBoundingClientRect`: a page still in the engine's frame is in a
 * document the host cannot always measure, and a placeholder has to be the
 * right size *before* anything is mounted or the scrollbar jumps on every
 * mount. Falls back to US Letter, which is what `page-model.ts` defaults to.
 */
function sizeOf(sheet: HTMLElement | undefined): [number, number] {
  if (sheet === undefined) return [816, 1056];
  return sizeOfSheet(sheet);
}

function sizeOfSheet(sheet: HTMLElement): [number, number] {
  const w = Number.parseFloat(sheet.style.width);
  const h = Number.parseFloat(sheet.style.height);
  return [Number.isFinite(w) ? w : 816, Number.isFinite(h) ? h : 1056];
}

/**
 * Make the printed document this viewer's pages, one to a sheet of paper.
 *
 * On screen the pages sit in an application: a toolbar above them, a gap
 * between them, a zoom, a shadow. On paper each page has to be exactly one
 * sheet, or the first is pushed down by the toolbar and every one after it
 * straddles two sheets. And the host usually carries the author's `@page`
 * rules, which Chromium (131+) applies itself: its own margin boxes printed a
 * second page number, counted in sheets rather than pages, and its margins
 * shrank each page. So in print media, and only there: the viewer's ancestors
 * are the only elements shown, with nothing around them; each page is a
 * named `@page` of its own size with no margins and no margin boxes —
 * `!important`, because an author's `@page :first` outranks a plain `@page` —
 * and an author's `page:` inside a page is set back to `auto`, which would
 * otherwise force breaks mid-page. The same rules as the engine's
 * `insertPrintCss`, restated because the viewer depends on nothing.
 */
function preparePrint(doc: Document, list: HTMLElement, holders: readonly HTMLElement[]): void {
  for (const el of doc.querySelectorAll(`[${PATH}]`)) el.removeAttribute(PATH);
  for (let el = list.parentElement; el !== null; el = el.parentElement) el.setAttribute(PATH, "");

  const names = new Map<string, string>();
  for (const holder of holders) {
    const size = `${holder.style.width} ${holder.style.height}`;
    if (!names.has(size)) names.set(size, `folio-viewer-${String(names.size)}`);
    holder.dataset["printPage"] = names.get(size);
  }
  const boxes = MARGIN_BOXES.map((box) => `@${box} { content: none !important }`).join(" ");
  const sizes = [...names].map(
    ([size, name]) =>
      `@page ${name} { size: ${size} !important; margin: 0 !important }\n` +
      `.folio-viewer-page[data-print-page="${name}"] { page: ${name} !important }`,
  );

  doc.getElementById(PRINT_ID)?.remove();
  const style = doc.createElement("style");
  style.id = PRINT_ID;
  style.textContent = `@media print {
@page { margin: 0 !important; ${boxes} }
${sizes.join("\n")}
body :not([${PATH}], .folio-viewer, .folio-viewer *) { display: none !important }
[${PATH}] {
  display: block !important; position: static !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important;
}
.folio-viewer.folio-viewer { display: block; padding: 0; gap: 0 }
.folio-viewer-page {
  zoom: 1 !important; box-shadow: none; break-after: page; break-inside: avoid;
}
.folio-viewer-page:last-child { break-after: auto }
.folio-viewer-page * { page: auto !important }
}`;
  doc.head.append(style);
}

/**
 * Bring the engine's own stylesheets along with the pages.
 *
 * A page is not self-contained: margins truncated at the top of a
 * continuation, counters that do not restart on a fragment, the footnote area
 * and the equation grid are all rules the engine put in the document it built
 * the pages in. Imported into a host that lacks them, the pages render as
 * something that was never measured — which is worse than looking wrong,
 * because it looks plausible. Reading `splits/numbering` in this viewer said
 * its paragraphs were numbered 3, 4, 5 when the engine had numbered them
 * 2, 3, 4.
 *
 * Only the engine's own sheets travel, and they are the ones it gave an id
 * beginning `folio-`. The author's CSS is deliberately left where it is: a
 * viewer that copied it would restyle the application around it.
 */
function carryEngineStyles(doc: Document, from: Document | null | undefined): void {
  if (from === undefined || from === null || from === doc) return;

  for (const style of from.querySelectorAll("style[id^='folio-']")) {
    if (doc.getElementById(style.id) !== null) continue;
    doc.head.append(doc.importNode(style, true));
  }
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;

  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.folio-viewer {
  --folio-zoom: 1;
  --folio-gap: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--folio-gap);
  padding: var(--folio-gap);
}
.folio-viewer-page {
  display: block;
  zoom: var(--folio-zoom);
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
  background: #fff;
}
/* Spreads: a verso and the recto after it on one row, and page 1 alone on
   the right of the first row, which is where a book's first page sits. */
.folio-viewer.folio-viewer-spreads {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: center;
  align-items: start;
}
.folio-viewer.folio-viewer-spreads > [data-side="right"] { grid-column: 2 }
.folio-viewer.folio-viewer-spreads > [data-side="left"] { grid-column: 1 }
@media (prefers-color-scheme: dark) {
  .folio-viewer-page { box-shadow: 0 1px 4px rgb(0 0 0 / 0.8); }
}
`;
  doc.head.append(style);
}
