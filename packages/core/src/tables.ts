/**
 * Splitting tables (`doc/plan.md` §4).
 *
 * "Repeated `thead`/`tfoot`: cheap once composition works from positions."
 * This is the test of that claim. Paged.js rebuilds rows and copies column
 * widths (§1); here a split table is already a table — composition kept the
 * ancestors of the break — so the only thing missing on a continuation is the
 * header, and the only thing missing before a break is the footer.
 *
 * They are put back from the *source*, not carried from the previous page,
 * because carrying DOM between pages is the thing §2 set out not to do.
 */
import { SOURCE_PATH, SPLIT_FROM, SPLIT_TO } from "./compose.js";
import type { Deletion } from "./native.js";

/**
 * Marks a part put back on a fragment rather than composed into it.
 *
 * A repeated header is the same source characters appearing on several pages
 * on purpose — the one thing that looks exactly like duplicated content to
 * anything checking that every character appears once. Saying so lets a
 * checker tell the intended repetition from the accidental kind.
 */
export const REPEATED = "data-folio-repeated";

/**
 * Give every split table fragment its header and footer.
 *
 * Applied to the measuring box as well as to the page: a repeated header takes
 * space, and a break chosen against a layout without it is a break chosen
 * against a page that will not exist.
 */
export function repeatTableParts(root: HTMLElement, source: Element): void {
  for (const table of root.querySelectorAll("table")) {
    const isFragment = table.hasAttribute(SPLIT_FROM) || table.hasAttribute(SPLIT_TO);
    if (!isFragment) continue;

    const original = sourceOf(table, source);
    if (original === null) continue;

    // Whichever part a fragment lacks, it gets — not only the continuations.
    // `tfoot` is allowed *before* `tbody` in the source (and often is), so the
    // final fragment, which starts mid-body, has no footer either: the rule
    // "repeat on continuations" leaves the one page that most obviously needs
    // a footer without one.
    if (table.querySelector("thead") === null) {
      const head = original.querySelector("thead");
      if (head !== null) {
        const clone = head.cloneNode(true) as Element;
        clone.setAttribute(REPEATED, "");
        table.prepend(clone);
      }
    }

    if (table.querySelector("tfoot") === null) {
      const foot = original.querySelector("tfoot");
      if (foot !== null) {
        const clone = foot.cloneNode(true) as Element;
        clone.setAttribute(REPEATED, "");
        table.append(clone);
      }
    }

    restoreColumns(table, source);
  }
}

/**
 * Put back the cells a row lost at the top of the page.
 *
 * A page that begins inside a row begins inside one of its *cells*: the cells
 * before it are on the previous page, and the row arrives here one or two
 * cells short. The browser then lays the table out from the cells it can see
 * — on a corpus fixture whose columns are 5.7% and 94.2%, the fragment came
 * out 575px and 69px, and every row was 336px tall instead of 125.
 *
 * Empty cells, not measured widths. Paged.js copies the resolved column
 * widths (`layout.js`); keeping the column *count* right lets the browser
 * resolve the author's own widths, which is the same answer without carrying
 * pixels from page to page.
 */
function restoreColumns(table: Element, source: Element): void {
  for (const row of table.querySelectorAll("tr[" + SPLIT_FROM + "]")) {
    const first = row.firstElementChild;
    if (first === null) continue;

    const original = sourceOf(row, source);
    if (original === null) continue;

    // Which cell of the source row this fragment starts at: its own path's
    // last step, counted in element terms.
    const kept = sourceOf(first, source);
    if (kept === null) continue;
    const missing = [...original.children].indexOf(kept);
    if (missing <= 0) continue;

    for (let i = 0; i < missing; i++) {
      const cell = (original.children[i] as Element).cloneNode(false) as Element;
      cell.setAttribute(REPEATED, "");
      row.prepend(cell);
    }
  }
}

/** The source element a composed clone came from, by its stamp. */
export function sourceOf(clone: Element, source: Element): Element | null {
  const raw = clone.getAttribute(SOURCE_PATH);
  if (raw === null) return null;

  let node: Node = source;
  for (const index of raw.split(".").filter((p) => p !== "").map(Number)) {
    const next: Node | undefined = node.childNodes[index];
    if (next === undefined) return null;
    node = next;
  }
  return node.nodeType === 1 ? (node as Element) : null;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "table headers",
  files: ["tables.ts"],
  feature: "Table headers and footers repeated on each page a table crosses",
  when: "Browsers fragment paged media themselves",
  tests: [],
  untested: "The pinned WPT set has no repeated-header test; `table-split.spec.ts` is the check",
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
