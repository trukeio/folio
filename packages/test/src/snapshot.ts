/**
 * The structural snapshot format (`doc/plan.md` §9, layer 2).
 *
 * Which element and which text offset lands on which page — stored as JSON,
 * compared between runs, between engines, and against Paged.js (layer 4).
 * Screenshots are for margin boxes and marks only; everything else is decided
 * here, because a pixel diff cannot tell a moved break from a moved glyph.
 *
 * Two properties this format has to have. It must be **stable**: key order
 * cannot depend on iteration order, or every run diffs against itself. And it
 * must be **readable in a diff**: when a break moves, the reviewer needs to see
 * which one and by how much, not a wall of coordinates.
 */
import type { PageRecord, Position } from "@truke/folio";

/** A position as one comparable string: `0.3.1+12`, or `0.3.1+12^` for after. */
export function positionKey(p: Position): string {
  return `${p.path.join(".")}+${p.offset}${p.after ? "^" : ""}`;
}

export type PageSnapshot = {
  index: number;
  name: string | null;
  side: "left" | "right";
  blank: boolean;
  size: [number, number];
  start: string;
  end: string;
  /** Sorted, so the snapshot does not depend on Set iteration order. */
  refs: string[];
  provides: string[];
};

export type DocumentSnapshot = {
  pages: PageSnapshot[];
  pageCount: number;
};

export function snapshotPages(records: readonly PageRecord[]): DocumentSnapshot {
  return {
    pageCount: records.length,
    pages: records.map((r) => ({
      index: r.spec.index,
      name: r.spec.name,
      side: r.spec.side,
      blank: r.spec.blank,
      size: r.spec.size,
      start: positionKey(r.start),
      end: positionKey(r.end),
      refs: [...r.refs].sort(),
      provides: [...r.provides].sort(),
    })),
  };
}

/** One difference between two snapshots, named so a reviewer can act on it. */
export type SnapshotDiff =
  | { kind: "page-count"; expected: number; actual: number }
  | { kind: "missing-page"; index: number }
  | { kind: "extra-page"; index: number }
  | { kind: "field"; index: number; field: string; expected: unknown; actual: unknown };

/**
 * Compare two snapshots. Layer 4 runs this over the Paged.js corpus, where
 * every difference is either a bug or a documented improvement — so the output
 * is a list to be triaged, not a boolean.
 */
export function diffSnapshots(
  expected: DocumentSnapshot,
  actual: DocumentSnapshot,
): SnapshotDiff[] {
  const diffs: SnapshotDiff[] = [];
  if (expected.pageCount !== actual.pageCount) {
    diffs.push({
      kind: "page-count",
      expected: expected.pageCount,
      actual: actual.pageCount,
    });
  }

  const byIndex = (s: DocumentSnapshot): Map<number, PageSnapshot> =>
    new Map(s.pages.map((p) => [p.index, p]));
  const e = byIndex(expected);
  const a = byIndex(actual);

  for (const index of [...new Set([...e.keys(), ...a.keys()])].sort((x, y) => x - y)) {
    const ep = e.get(index);
    const ap = a.get(index);
    if (ep === undefined) {
      diffs.push({ kind: "extra-page", index });
      continue;
    }
    if (ap === undefined) {
      diffs.push({ kind: "missing-page", index });
      continue;
    }
    for (const field of Object.keys(ep) as (keyof PageSnapshot)[]) {
      const ev = ep[field];
      const av = ap[field];
      if (JSON.stringify(ev) !== JSON.stringify(av)) {
        diffs.push({ kind: "field", index, field, expected: ev, actual: av });
      }
    }
  }
  return diffs;
}

/** Deterministic JSON, so a snapshot file diffs against itself cleanly. */
export function serialize(snapshot: DocumentSnapshot): string {
  return JSON.stringify(snapshot, null, 2) + "\n";
}
