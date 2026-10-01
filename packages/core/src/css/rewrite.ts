/**
 * Cascade by proxy (`doc/plan.md` §5).
 *
 * A browser drops properties it does not know — `string-set`, `float:
 * footnote`, `footnote-policy` — which is the usual reason paged engines build
 * their own cascade. But *custom properties accept any value* and go through
 * the browser's cascade: specificity, `@layer`, nesting, `!important`, media
 * queries, all of it. So rename the property and read the result back.
 *
 * The cost is this file instead of a cascade engine, and author CSS keeps
 * working as the browser gains features nobody here has heard of.
 *
 * Two rules about the rewrite, both learned from what it would break:
 *
 *  - The carrier is *added*, never substituted. `page: chapter` stays, so
 *    Chromium's native named pages still work in print; the browser ignores
 *    the value it cannot use and we read the carrier.
 *  - A property with an ordinary meaning is only carried when its value is
 *    the one we care about. Rewriting every `float` would capture the whole
 *    web's left and right floats.
 */

import { rewriteViewportUnits } from "./viewport.js";

export const CARRIER_PREFIX = "--x-";

export type Carrier = {
  property: string;
  /** Carry only these values. Absent means carry any value. */
  values?: readonly string[];
  /** Custom properties inherit by default; most of these should not. */
  inherits?: boolean;
};

/** What the engine carries. Every entry is a feature in the map of §4. */
export const CARRIERS: readonly Carrier[] = [
  // `page` is an inherited property: a named page applies to descendants.
  { property: "page", inherits: true }, // named pages (M2)
  { property: "string-set" }, // string() (M2)
  // Footnotes (M3), and page floats (M6, `page-floats.ts`), which are
  // floats only with a page reference.
  { property: "float", values: ["footnote", "top", "bottom", "block-start", "block-end", "snap-block"] },
  { property: "float-reference" },
  { property: "float-defer" },
  { property: "footnote-display" },
  // GCPM makes footnote-policy inherited; footnote-display is not.
  { property: "footnote-policy", inherits: true },
  { property: "position", values: ["running"] }, // running elements (M2)
  { property: "bleed" },
  { property: "marks" },
  // Read by `fragments.ts` (M6). `box-decoration-break` is a real property,
  // but the browser applies it to the fragments *it* makes, and the engine
  // makes these; Safari still knows it only by its prefixed name.
  { property: "box-decoration-break" },
  { property: "-webkit-box-decoration-break" },
  { property: "margin-break" },
  // Which equations are numbered (`math.md` §5). Not a real CSS property, so
  // the carrier is the only form; it is here so that the author selects them
  // with a selector and a cascade rather than with a class we invented.
  { property: "math-number" },
];

export const carrierName = (property: string): string => `${CARRIER_PREFIX}${property}`;

/**
 * `@property` registrations, so a carrier does not inherit where the property
 * it stands for does not. Without this, `string-set` on `<body>` would appear
 * on every element in the document.
 */
export function carrierRegistrations(carriers: readonly Carrier[] = CARRIERS): string {
  return carriers
    .map(
      (c) =>
        `@property ${carrierName(c.property)} { syntax: "*"; inherits: ${
          c.inherits === true ? "true" : "false"
        }; }`,
    )
    .join("\n");
}

/** Does this declaration's value mean what the carrier is for? */
function carries(carrier: Carrier, value: string): boolean {
  if (carrier.values === undefined) return true;
  const first = value.trim().toLowerCase().split(/[\s(]/)[0] ?? "";
  return carrier.values.includes(first);
}

/**
 * Add a carrier declaration beside every declaration of a carried property.
 *
 * This is a scan, not a parse: everything it does not recognise is copied
 * through byte for byte, which is what lets author CSS keep its `@layer`,
 * its nesting and its `:has()`.
 */
export function rewriteCarriers(css: string, carriers: readonly Carrier[] = CARRIERS): string {
  const byName = new Map(carriers.map((c) => [c.property, c]));
  let out = "";
  let i = 0;
  let declarationStart = 0;
  let depth = 0;

  const flush = (to: number): void => {
    out += css.slice(declarationStart, to);
    declarationStart = to;
  };

  while (i < css.length) {
    const ch = css[i];

    // Comments and strings are copied whole: a `;` inside either ends nothing.
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i);
      continue;
    }

    if (ch === "{") {
      depth++;
      flush(i + 1);
      i++;
      continue;
    }
    if (ch === "}" || ch === ";") {
      if (depth > 0) {
        const text = css.slice(declarationStart, i);
        out += carrierFor(text, byName) + text;
      } else {
        out += css.slice(declarationStart, i);
      }
      out += ch;
      i++;
      declarationStart = i;
      if (ch === "}") depth--;
      continue;
    }
    i++;
  }
  out += css.slice(declarationStart);
  return out;
}

/** The carrier declaration for one `property: value` text, or "". */
function carrierFor(raw: string, carriers: Map<string, Carrier>): string {
  // The scan above copies comments through without ending a declaration,
  // which is right — a `;` inside one ends nothing — but it leaves them in
  // front of the declaration that follows. Parsing that text as
  // `property: value` then reads the comment as part of the property name,
  // and an ordinary stylesheet full of ordinary comments quietly loses every
  // carrier: `/* why */ string-set: title content()` stopped being a
  // `string-set` at all, and the running head it fed came out empty.
  //
  // Stripped from the copy that is parsed, never from the copy that is
  // emitted: the author's CSS is passed through byte for byte (§5).
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, " ");
  const colon = text.indexOf(":");
  if (colon === -1) return "";

  const property = text.slice(0, colon).trim().toLowerCase();
  const carrier = carriers.get(property);
  if (carrier === undefined) return "";

  const value = text.slice(colon + 1).trim();
  if (value === "" || !carries(carrier, value)) return "";

  // Keep the author's whitespace out of it: the carrier is generated, and
  // generated text that mimics hand-written text is harder to recognise.
  return `${carrierName(property)}:${value};`;
}

function skipString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === "\\") i += 2;
    else if (css[i] === quote) return i + 1;
    else i++;
  }
  return css.length;
}

/** Read a carrier back off an element. Empty string when it was not set. */
export function readCarrier(el: Element, property: string, view: Window): string {
  return view.getComputedStyle(el).getPropertyValue(carrierName(property)).trim();
}

const inlineCache = new Map<string, string>();

/**
 * The same two rewrites stage 1 gives a stylesheet, for a `style` attribute.
 *
 * `<div style="page: a">` is as much a named page as a rule that says so,
 * and it was invisible: carriers were only ever added to stylesheets, so the
 * engine read no `--x-page` and WPT's `pseudo-first-margin-*-print` came out
 * on one page where Chromium prints two. Composition applies this to each
 * clone (`compose.ts`) — the source keeps the author's attribute — and style
 * strings repeat, so each one is rewritten once.
 */
export function rewriteInlineStyle(style: string): string {
  const cached = inlineCache.get(style);
  if (cached !== undefined) return cached;
  const block = rewriteViewportUnits(rewriteCarriers(`x{${style}}`));
  const out = block.slice(2, -1);
  inlineCache.set(style, out);
  return out;
}

/** What `:root` becomes: the frame's root, and the root on every page. */
const ROOT_SELECTOR = ":is(:root, [data-folio-root])";

/**
 * Make `:root` match the root on the page as well as the frame's.
 *
 * The page holds a clone of the document's root element (`compose.ts`,
 * `doc/review.md` §3.3), and `:root` never matches a clone: it is not the
 * root of the document it is in. `html` does, being a type selector, and so
 * do `html.dark` and `html[lang]`; `:root { background }` and `:root {
 * margin }` did not. The frame's own root keeps matching, which `rem` and the
 * margin boxes' custom properties need, and its box is pinned (`source.ts`).
 * Strings and comments are copied through untouched.
 */
export function rewriteRootSelector(css: string): string {
  let out = "";
  let at = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
    } else if (c === '"' || c === "'") {
      i = skipString(css, i) - 1;
    } else if (c === ":" && css[i - 1] !== ":" && /^:root(?![\w-])/i.test(css.slice(i, i + 6))) {
      out += css.slice(at, i) + ROOT_SELECTOR;
      at = i + ":root".length;
      i = at - 1;
    }
  }
  return out + css.slice(at);
}
