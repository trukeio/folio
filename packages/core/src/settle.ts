/**
 * Stage 5 feeds stage 3 (`doc/plan.md` §2).
 *
 * Each pass lays the document out with the page numbers and counters the last
 * pass found; when they stop moving, it has settled. Nothing here decides a
 * break — it runs the fragmenter again, which is why it is outside its budget
 * (`doc/review.md` §2.5) — and nothing here is clever about *which*
 * pages changed: a re-run is a function call over positions, which is what
 * made that affordable.
 */
import { layoutOnce } from "./paginate.js";
import { byNumber } from "./page-counters.js";
import { indexPages } from "./references.js";
import type { CounterValues } from "./counters.js";
import type { PaginateOptions, PaginateResult } from "./paginate.js";

export function paginate(options: PaginateOptions): PaginateResult {
  const { references = [], maxPasses = 4 } = options;

  let pageOf = new Map<string, number>();
  // Counters — the author's and M4's alike — are known only once the pages
  // have been built, exactly as page numbers are, so they settle in the same
  // loop rather than in one of their own.
  let counterOf = new Map<string, CounterValues>();
  let result = layoutOnce(options, pageOf, counterOf, references);

  for (let pass = 1; pass < maxPasses; pass++) {
    const next = byNumber(indexPages(result.pages, references).provides, result.records);
    if (sameNumbers(pageOf, next) && sameCounters(counterOf, result.counters)) break;
    pageOf = next;
    counterOf = result.counters;
    for (const sheet of result.sheets) sheet.remove();
    result = layoutOnce(options, pageOf, counterOf, references);
  }

  const { provides, refs } = indexPages(result.pages, references);
  result.records.forEach((record, i) => {
    record.refs = refs[i] ?? new Set();
    record.provides = new Set(
      [...provides.entries()].filter(([, page]) => page === i + 1).map(([id]) => id),
    );
  });

  return result;
}

function sameNumbers(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

/** The same test one level down: every id's counters, unchanged. */
function sameCounters(
  a: Map<string, CounterValues>,
  b: Map<string, CounterValues>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, values] of a) {
    const other = b.get(id);
    if (other === undefined || !sameNumbers(values, other)) return false;
  }
  return true;
}
