/**
 * `@media` for a document that is being printed (`doc/plan.md` §5).
 *
 * The pages are built in an iframe, and an iframe is a screen. So the browser
 * applies every `@media screen` block in the author's CSS and none of their
 * `@media print` blocks — the exact inverse of what a paged-media engine is
 * for. Stage 1 already drops a *sheet* whose `media` attribute says `screen`;
 * this is the other half, the queries written inside the sheets, and it is the
 * half that matters more, because that is where print styles are usually put.
 *
 * There is no way to ask for it instead. A document's media type is fixed when
 * it is created; `emulateMedia` is a devtools protocol, not a web API. So the
 * CSS is rewritten before it reaches the frame:
 *
 *   | Written                          | Becomes                  |
 *   | -------------------------------- | ------------------------ |
 *   | `@media print { … }`             | the rules, unwrapped     |
 *   | `@media screen { … }`            | nothing                  |
 *   | `@media print and (…) { … }`     | `@media (…) { … }`       |
 *   | `@media screen, print { … }`     | the rules, unwrapped     |
 *   | `@media (min-width: 40em) { … }` | itself                   |
 *
 * Only the media *type* is decided here. A feature query is left for the
 * browser to evaluate, where it belongs — and where, for now, it evaluates
 * against the frame rather than against the page box, which is a difference
 * this transform deliberately does not paper over.
 *
 * This runs before `@page` is extracted, so an `@page` rule inside
 * `@media print` — which is where a document that also renders on screen puts
 * it — is found by the extractor rather than left buried in a block it never
 * looks inside.
 *
 * **Delete when** the engine can build pages in a print-media context.
 */

import type { Deletion } from "../native.js";

/**
 * Does a media condition apply to the printed document?
 *
 * The part that decides whether a sheet or a block is read at all is its media
 * type, which is a word, so the word is what this looks at. Feature conditions
 * (`(orientation: landscape)`) are left to the browser inside the block.
 *
 * Anything unrecognised is kept. Dropping a stylesheet the author wrote is the
 * worse failure of the two.
 */
export function mediaApplies(condition: string | null): boolean {
  const media = (condition ?? "").trim().toLowerCase();
  if (media === "") return true;
  return splitQueries(media).some(queryApplies);
}

/** Resolve every `@media` block in `css` against the printed medium. */
export function resolvePrintMedia(css: string): string {
  let out = "";
  let at = 0;

  for (;;) {
    const start = findAtMedia(css, at);
    if (start === -1) return out + css.slice(at);

    const open = css.indexOf("{", start);
    const close = open === -1 ? -1 : matchingBrace(css, open);
    // An `@media` with no block is malformed; copying it through unchanged is
    // what the rest of stage 1 does with anything it does not understand.
    if (close === -1) return out + css.slice(at);

    out += css.slice(at, start);
    const condition = css.slice(start + "@media".length, open).trim();
    const body = resolvePrintMedia(css.slice(open + 1, close));

    if (mediaApplies(condition)) {
      const features = featuresOf(condition);
      out += features === null ? body : `@media ${features} {${body}}`;
    }
    at = close + 1;
  }
}

/**
 * Settle the feature queries stage 1 left, as `matches` answers them.
 *
 * The pages are shown in the host document but were measured in the frame,
 * and the two answer `(max-width: 40em)` differently: the frame is the width
 * of the page area and the host is a window. So the copy of the CSS the host
 * gets is resolved against the frame first — true blocks unwrapped, false ones
 * dropped — and the page shown is the page measured. Run it after
 * `resolvePrintMedia`, which has already settled every media type.
 */
export function resolveFeatureQueries(css: string, matches: (query: string) => boolean): string {
  let out = "";
  let at = 0;

  for (;;) {
    const start = findAtMedia(css, at);
    if (start === -1) return out + css.slice(at);

    const open = css.indexOf("{", start);
    const close = open === -1 ? -1 : matchingBrace(css, open);
    if (close === -1) return out + css.slice(at);

    out += css.slice(at, start);
    const condition = css.slice(start + "@media".length, open).trim();
    if (matches(condition)) out += resolveFeatureQueries(css.slice(open + 1, close), matches);
    at = close + 1;
  }
}

/** What an author rule must not reach in the host: anything on a page. */
const OFF_THE_PAGES = ":where(:not(.pagedjs_page *))";
/** Rules already guarded, so a second preview does not guard them twice. */
const guarded = new WeakSet<CSSStyleRule>();

/**
 * Keep the author's media-conditional rules off the pages in the host.
 *
 * The host document keeps the author's original sheets, because that is
 * where the screen chrome lives (`preview.ts`, `insertRewrittenCss`). But on a
 * screen those sheets' `@media not print` and width queries also apply to the
 * pages, which were measured without them: `.print-only { display: none }`
 * hid a block its page had been broken around (WPT
 * `background-image-only-for-print`). Unconditional rules are the same in
 * both documents, and the rewritten copy appended after them carries every
 * conditional rule as the frame resolved it; so a conditional rule in the
 * original is given a guard that stops it matching inside a page, and still
 * matches the chrome around them.
 *
 * `:where` so the guard adds no specificity and an author's screen rule wins
 * or loses against their other rules exactly as it did. Edited through the
 * CSSOM, which a second `normalize` does not read: it takes `<style>` text
 * and fetches `<link>`s. A sheet whose rules cannot be read — cross-origin —
 * is left alone; stage 1 could not read it either.
 *
 * **Delete when** the engine can build pages in a print-media context, with
 * `resolvePrintMedia`.
 */
export function guardConditionalRules(doc: Document): void {
  for (const sheet of doc.styleSheets) {
    const owner = sheet.ownerNode;
    // The engine's own sheets: the print CSS is `@media print` and means it.
    if (owner instanceof Element && owner.id.startsWith("folio-")) continue;
    guardRules(sheet, sheet.media.length > 0);
  }
}

/**
 * A sheet or a rule with rules inside it. Optional because a style rule has
 * none below CSS nesting (Chromium 112, Firefox 117), which is above the floor.
 */
type RuleParent = { readonly cssRules?: CSSRuleList };

function guardRules(parent: RuleParent, conditional: boolean): void {
  // Reading a cross-origin sheet's rules throws.
  let rules: CSSRuleList | undefined;
  try {
    rules = parent.cssRules;
  } catch {
    return;
  }
  for (const rule of rules ?? []) {
    if (rule instanceof CSSStyleRule) {
      if (conditional && !guarded.has(rule)) {
        rule.selectorText = guardSelector(rule.selectorText);
        guarded.add(rule);
      }
      // A nested rule can reach into a page from a parent that is not on one.
      guardRules(rule, conditional);
    } else if (rule instanceof CSSMediaRule) {
      guardRules(rule, true);
    } else if (rule instanceof CSSImportRule) {
      if (rule.styleSheet !== null) guardRules(rule.styleSheet, conditional || rule.media.length > 0);
    } else if (rule instanceof CSSGroupingRule) {
      // `@supports`, `@layer` and `@container` blocks: conditional only if
      // something around them is.
      guardRules(rule, conditional);
    }
  }
}

/**
 * `a, p::before` → each selector in the list with the guard on its subject,
 * ahead of any pseudo-element, which must come last.
 */
export function guardSelector(list: string): string {
  return splitTopLevel(list)
    .map((selector) => {
      const s = selector.trim();
      const at = pseudoElementAt(s);
      return at === -1 ? s + OFF_THE_PAGES : s.slice(0, at) + OFF_THE_PAGES + s.slice(at);
    })
    .join(", ");
}

/** The commas of a selector list, not those inside `:is(a, b)` or `[x="a,b"]`. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '"' || c === "'") {
      const end = endOfString(list, i);
      if (end === -1) break;
      i = end;
    } else if (c === "\\") i++;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(list.slice(from));
  return parts;
}

/** The four pseudo-elements CSS 2 wrote with one colon, which still parse. */
const LEGACY_PSEUDO = /^:(before|after|first-line|first-letter)(?![\w-])/i;

/** Where the selector's first top-level pseudo-element starts, or -1. */
function pseudoElementAt(selector: string): number {
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '"' || c === "'") {
      const end = endOfString(selector, i);
      if (end === -1) return -1;
      i = end;
    } else if (c === "\\") i++;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === ":" && depth === 0) {
      if (selector[i + 1] === ":" || LEGACY_PSEUDO.test(selector.slice(i))) return i;
    }
  }
  return -1;
}

/**
 * The next `@media` that is really an at-rule.
 *
 * `content: "@media print"` is not one, and neither is a commented-out block.
 * Without this the scan would take the next `{` after the quoted text as the
 * start of a block and rewrite from inside a string outwards, which is the
 * one way this transform could damage a stylesheet rather than merely fail
 * to improve it.
 */
function findAtMedia(css: string, from: number): number {
  for (let i = from; i < css.length; i++) {
    const c = css[i];

    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = endOfString(css, i);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (c === "@" && css.startsWith("@media", i)) return i;
  }
  return -1;
}

/**
 * What is left of a condition once the media types are settled, or null when
 * nothing is left and the block can be unwrapped.
 *
 * `print and (min-width: 40em)` keeps its feature and loses its type; `print`
 * keeps nothing. Queries that do not apply are dropped, so
 * `screen and (min-width: 40em), print` unwraps rather than keeping a feature
 * the printed document was never asked to satisfy.
 */
function featuresOf(condition: string): string | null {
  const kept: string[] = [];

  for (const query of splitQueries(condition.toLowerCase())) {
    if (!queryApplies(query)) continue;
    const features = query
      .replace(/^\s*not\s+/, "")
      .replace(/^\s*(print|screen|all)\b/, "")
      .replace(/^\s*and\s+/, "")
      .trim();
    if (features === "") return null;
    kept.push(features);
  }

  return kept.length === 0 ? null : kept.join(", ");
}

/** A media query list, split on the commas that separate its queries. */
function splitQueries(list: string): string[] {
  return list.split(",").map((q) => q.trim());
}

function queryApplies(query: string): boolean {
  const words = query.split(/\s+/);
  const negated = words[0] === "not";
  const type = (negated ? words[1] : words[0]) ?? "";
  // `print and (orientation: landscape)` is a print query; the feature test
  // survives into the rewritten block and the browser evaluates it there.
  if (type === "print" || type === "all") return !negated;
  if (type === "screen") return negated;
  // A query that opens with a feature — `(min-width: 20em)` — has the
  // implicit type `all`.
  return !negated;
}

/**
 * The `}` that closes the `{` at `open`.
 *
 * Braces inside strings and comments are not braces. A selector like
 * `[data-x="{"]` is rare and a comment holding one is not, and either would
 * otherwise end the block early and take the rest of the stylesheet with it.
 */
function matchingBrace(css: string, open: number): number {
  let depth = 0;

  for (let i = open; i < css.length; i++) {
    const c = css[i];

    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      i = endOfString(css, i);
      if (i === -1) return -1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The index of the quote closing the one at `start`. */
function endOfString(css: string, start: number): number {
  const quote = css[start];
  for (let i = start + 1; i < css.length; i++) {
    if (css[i] === "\\") {
      i++;
      continue;
    }
    if (css[i] === quote) return i;
  }
  return -1;
}

/** Deletion condition (`plan.md` §8, `deletion.ts`). */
export const deletion: Deletion = {
  name: "print media",
  files: ["css/media.ts"],
  feature: "`@media print` in a frame that is a screen",
  when: "The engine can build pages in a print-media context",
  tests: [/^css\/css-page\/(media-queries-|background-image-only-for-print)/],
  native: () => false,
};

/** Whether this browser supports the feature natively, as far as a script can tell. */
export function nativeSupport(): boolean {
  return deletion.native();
}
