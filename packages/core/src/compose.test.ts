import { describe, expect, it } from "vitest";
import { isInsideSubtree, overlap } from "./compose.js";
import type { Position } from "./types.js";

const pos = (path: number[], offset = 0, after = false): Position => ({ path, offset, after });

describe("isInsideSubtree", () => {
  it("is true only for positions strictly below the path", () => {
    expect(isInsideSubtree([1], pos([1, 0]))).toBe(true);
    expect(isInsideSubtree([1], pos([1, 3, 2]))).toBe(true);
    expect(isInsideSubtree([1], pos([1]))).toBe(false);
    expect(isInsideSubtree([1], pos([2, 0]))).toBe(false);
    expect(isInsideSubtree([], pos([0]))).toBe(true);
  });
});

describe("overlap", () => {
  // A page running from the middle of block 1 to the middle of block 3.
  const start = pos([1, 0], 20);
  const end = pos([3, 0], 10);

  it("excludes subtrees that finish before the page starts", () => {
    expect(overlap([0], start, end)).toBe("before");
  });

  it("excludes subtrees that begin after the page ends", () => {
    expect(overlap([4], start, end)).toBe("after");
    expect(overlap([9, 2], start, end)).toBe("after");
  });

  it("includes whole subtrees in the middle", () => {
    expect(overlap([2], start, end)).toBe("inside");
  });

  it("includes the subtrees the boundaries fall inside", () => {
    // Block 1 is half on the previous page but still contributes to this one.
    expect(overlap([1], start, end)).toBe("inside");
    expect(overlap([3], start, end)).toBe("inside");
  });

  it("includes the text node a boundary lands in", () => {
    expect(overlap([1, 0], start, end)).toBe("inside");
    expect(overlap([3, 0], start, end)).toBe("inside");
  });

  it("excludes a sibling before the start inside the same parent", () => {
    // The paragraph is split at its second child, so its first is on the
    // previous page even though the paragraph itself is on this one.
    const from = pos([1, 1], 0);
    expect(overlap([1, 0], from, end)).toBe("before");
    expect(overlap([1, 1], from, end)).toBe("inside");
  });

  it("treats a page that ends exactly at a boundary as excluding it", () => {
    // `end` is exclusive: content starting exactly there belongs to the next
    // page, or every boundary element would appear on both.
    expect(overlap([3], start, pos([3]))).toBe("after");
  });
});
