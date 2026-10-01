/**
 * The engine-neutral half of the snapshot (`doc/plan.md` §9, layer 4).
 *
 * `snapshot.ts` serializes our own `PageRecord`s. This one describes a
 * *rendered result* — which source element put how much text on which page —
 * and it is deliberately expressed in terms no engine owns, because the
 * differential test has to ask Paged.js and ourselves the same question.
 *
 * A source element is identified by its path of child indices from the body,
 * the same identity `Position` uses. Not by id: most corpus elements have
 * none, and Paged.js rewrites `#id` to `[data-id]` anyway.
 */

/** What one source element contributed to one page. */
export type Placement = {
  /** Child indices from the body: `0.2.1`. */
  path: string;
  /**
   * Non-whitespace characters of this element's *own* text on this page,
   * descendants excluded.
   *
   * Whitespace is excluded deliberately (found in M0.2). Source indentation
   * between block elements is collapsible whitespace that no paginator carries
   * through cloning, so counting it flags all but a handful of corpus fixtures
   * and says nothing about where a break fell.
   */
  chars: number;
};

export type PagePlacement = {
  index: number;
  items: Placement[];
};

export type CorpusResult = {
  /** Fixture path, relative to the corpus root. */
  spec: string;
  pageCount: number;
  pages: PagePlacement[];
  /** Characters per source path in the unpaginated source, for the content check. */
  source: Record<string, number>;
};

/**
 * Every source character appears exactly once across all pages (`plan.md` §9).
 *
 * Run against a baseline this is a statement about Paged.js, not about us —
 * which is the point of having a baseline before having an engine. Returns the
 * paths that fail, with what was lost or duplicated.
 */
export function contentCheck(
  result: CorpusResult,
): { path: string; source: number; paginated: number }[] {
  const paginated = new Map<string, number>();
  for (const page of result.pages) {
    for (const item of page.items) {
      paginated.set(item.path, (paginated.get(item.path) ?? 0) + item.chars);
    }
  }

  const failures: { path: string; source: number; paginated: number }[] = [];
  for (const [path, chars] of Object.entries(result.source)) {
    const got = paginated.get(path) ?? 0;
    if (got !== chars) failures.push({ path, source: chars, paginated: got });
  }
  for (const [path, chars] of paginated) {
    if (!(path in result.source)) {
      failures.push({ path, source: 0, paginated: chars });
    }
  }
  return failures;
}

/** Page counts alone, the coarsest differential signal and the first to check. */
export function pageCounts(results: readonly CorpusResult[]): Record<string, number> {
  return Object.fromEntries(results.map((r) => [r.spec, r.pageCount]));
}
