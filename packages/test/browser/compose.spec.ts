/**
 * M1.2: composing a page from (start, end).
 *
 * The source document is never touched and pages do not depend on each other,
 * so the properties worth asserting are about content: every character appears
 * exactly once across the pages, in order, and an element the page cuts
 * through says so.
 */
import { expect, test } from "@playwright/test";
import type * as Folio from "@truke/folio";
import { injectEngine } from "./inject.js";

const FIXTURE = "http://127.0.0.1:5177/compose.html";

declare global {
  interface Window {
    folio: typeof Folio;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(FIXTURE);
  await injectEngine(page);
});

test("composes a whole document as one page, unchanged", async ({ page }) => {
  const result = await page.evaluate(() => {
    const src = document.getElementById("src") as Element;
    const before = src.innerHTML;
    const frame = window.folio.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    const fragment = window.folio.composePage({
      source: src,
      start: { path: [], offset: 0, after: false },
      end: { path: [999], offset: 0, after: false },
      target,
    });

    const box = target.createElement("div");
    box.append(fragment);
    // Inside the root chain (`review.md` §3): the page holds the root, and
    // what is composed from the source is the source root's clone's content.
    const composed = window.folio.sourceRootIn(box).innerHTML;
    return { composed, sourceBefore: before, sourceAfter: src.innerHTML };
  });

  expect(result.composed).toBe(result.sourceBefore);
  expect(result.sourceAfter, "composition mutated the source").toBe(result.sourceBefore);
});

test("splits a paragraph and marks both halves", async ({ page }) => {
  const result = await page.evaluate(() => {
    const src = document.getElementById("src") as Element;
    const frame = window.folio.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    // #p1 is child 1 of the article; cut in the middle of its text.
    const cut = { path: [1, 0], offset: 6, after: false };
    const compose = (start: Folio.Position, end: Folio.Position) => {
      const box = target.createElement("div");
      box.append(window.folio.composePage({ source: src, start, end, target }));
      return box;
    };

    const first = compose({ path: [], offset: 0, after: false }, cut);
    const second = compose(cut, { path: [2], offset: 0, after: false });

    return {
      firstText: first.textContent,
      secondText: second.textContent,
      firstP: first.querySelector("#p1")?.outerHTML,
      secondP: second.querySelector("#p1")?.outerHTML,
      sourceText: (document.getElementById("p1") as Element).textContent,
    };
  });

  // Offset 6 of "First paragraph text." keeps the space: the break leaves the
  // trailing space behind, as M1.4's line offsets do.
  expect(result.firstText).toBe("HeadingFirst ");
  expect(result.secondText).toBe("paragraph text.");
  // The half that continues is marked, the half that resumes is marked, and
  // each says only what is true of it.
  expect(result.firstP).toContain("data-folio-split-to");
  expect(result.firstP).not.toContain("data-folio-split-from");
  expect(result.secondP).toContain("data-folio-split-from");
  expect(result.secondP).not.toContain("data-folio-split-to");
  // Together they are the source paragraph, exactly once.
  expect("First " + "paragraph text.").toBe(result.sourceText);
});

test("keeps ancestors of a split, and marks them too", async ({ page }) => {
  const result = await page.evaluate(() => {
    const src = document.getElementById("src") as Element;
    const frame = window.folio.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    // Cut inside #p3, which lives inside #sect: the section is split as well.
    const box = target.createElement("div");
    box.append(
      window.folio.composePage({
        source: src,
        start: { path: [2, 1, 0], offset: 7, after: false },
        end: { path: [3], offset: 0, after: false },
        target,
      }),
    );

    return {
      html: box.innerHTML,
      text: box.textContent,
      hasP2: box.querySelector("#p2") !== null,
      sectionSplit: box.querySelector("#sect")?.hasAttribute("data-folio-split-from"),
    };
  });

  // The earlier sibling belongs to the previous page and must not reappear.
  expect(result.hasP2).toBe(false);
  expect(result.text).toBe("paragraph two.");
  expect(result.sectionSplit).toBe(true);
});

test("every character appears exactly once across a sequence of pages", async ({ page }) => {
  const result = await page.evaluate(() => {
    const src = document.getElementById("src") as Element;
    const frame = window.folio.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    // Four arbitrary cuts, including two inside text and one between blocks.
    const cuts: Folio.Position[] = [
      { path: [], offset: 0, after: false },
      { path: [1, 0], offset: 6, after: false },
      { path: [2, 0, 0], offset: 3, after: false },
      { path: [3], offset: 0, after: false },
      { path: [999], offset: 0, after: false },
    ];

    const pages = cuts.slice(0, -1).map((start, i) => {
      const box = target.createElement("div");
      box.append(
        window.folio.composePage({
          source: src,
          start,
          end: cuts[i + 1] as Folio.Position,
          target,
        }),
      );
      return box.textContent;
    });

    return { pages, source: src.textContent };
  });

  // plan.md §9's first property, on composition alone: concatenating the
  // pages reproduces the source exactly — nothing lost, nothing duplicated,
  // nothing reordered.
  expect(result.pages.join("")).toBe(result.source);
  expect(result.pages.every((p) => p.length > 0)).toBe(true);
});

test("keeps the engine's own frame out of the source and out of the page", async ({ page }) => {
  // The measuring frame used to be appended to `document.body`, which is the
  // element the corpus paginates. It became a child of the source: a forced
  // break before it (its page name differs from the section's), a page ending
  // there, and a trailing page holding nothing but the frame. On
  // `generate-content/content-none` that forced break sat at the top of page
  // 3, so a 1702px section had to fit a 680px area.
  const result = await page.evaluate(() => {
    const frame = window.folio.createEngineFrame(document);
    const target = frame.contentDocument as Document;

    // A source that does contain a frame — a caller paginating a root the
    // engine's furniture happens to sit in — must still compose without it.
    const src = document.createElement("div");
    src.innerHTML = "<p>one</p><p>two</p>";
    const stray = window.folio.createEngineFrame(document);
    src.append(stray);
    document.body.append(src);

    const box = target.createElement("div");
    box.append(
      window.folio.composePage({
        source: src,
        start: { path: [], offset: 0, after: false },
        end: { path: [999], offset: 0, after: false },
        target,
      }),
    );

    return {
      frameInBody: document.body.contains(frame),
      frameParent: frame.parentElement?.tagName ?? null,
      composed: window.folio.sourceRootIn(box).innerHTML,
      measures: (() => {
        const p = target.createElement("p");
        p.textContent = "measurable";
        target.body.append(p);
        const h = p.getBoundingClientRect().height;
        p.remove();
        return h;
      })(),
    };
  });

  expect(result.frameInBody, "the engine frame is part of the source").toBe(false);
  expect(result.frameParent).toBe("HTML");
  expect(result.composed).toBe("<p>one</p><p>two</p>");
  // Out of `body` it is still laid out, so it is still a place to measure in.
  expect(result.measures).toBeGreaterThan(0);
});
