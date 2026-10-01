/**
 * Extracting `@page` (`doc/plan.md` §2 stage 2, §5, §6).
 *
 * This is the whole of the engine's CSS parsing, and its most important
 * property is what it does *not* do: everything that is not `@page` comes back
 * untouched, to be handed to the browser and cascaded by it. That is the rung-P
 * bargain of §5 — a small, testable extractor instead of a cascade engine, and
 * author CSS that keeps working as the browser gains features we have never
 * heard of.
 *
 * So this is a scanner, not a CSS parser. It finds `@page` blocks, understands
 * what is inside them, and copies the rest of the stylesheet through verbatim.
 * Nesting, `:has()` and whatever comes next pass straight through because
 * nothing here inspects them. `@layer` is the one block it opens, because an
 * `@page` inside one is still a page rule, ranked by its layer.
 */

import { resolveFontRelative, toPx } from "./length.js";

export type Declarations = Record<string, string>;

export type PagePseudo =
  | { type: "first" | "left" | "right" | "blank" }
  | { type: "nth"; a: number; b: number };

export type PageSelector = {
  /** A named page (`@page chapter`), or null for the anonymous page. */
  name: string | null;
  pseudos: PagePseudo[];
};

export type PageRule = {
  selectors: PageSelector[];
  declarations: Declarations;
  /** `@top-center`, `@bottom-left-corner`, … by name, without the `@`. */
  marginBoxes: Record<string, Declarations>;
  /** Source order, for resolving ties between equally specific rules. */
  order: number;
  /**
   * A user-agent rule: what "the default page" means to whoever is running
   * the engine — a print pipeline's paper, WPT's 5in by 3in. It loses to
   * every author rule whatever the specificity, and it is what `size:
   * landscape` alone rotates (css-page-3 §7.1: "the UA default size").
   */
  ua?: boolean;
  /**
   * The rule's cascade layer as a rank (`compareLayers`), or absent when it
   * is in no layer, which beats every layer.
   */
  layer?: number[];
};

/** Page rules from a user-agent stylesheet (`PageRule.ua`). */
export function userAgentPageRules(css: string): PageRule[] {
  return extractPageRules(css).rules.map((rule) => ({ ...rule, ua: true }));
}

export type Extracted = {
  rules: PageRule[];
  /** The author's stylesheet with `@page` removed and nothing else changed. */
  rest: string;
};

/** Scan past a comment or a quoted string; returns the index after it. */
function skipInert(css: string, i: number): number {
  if (css.startsWith("/*", i)) {
    const end = css.indexOf("*/", i + 2);
    return end === -1 ? css.length : end + 2;
  }
  const quote = css[i];
  if (quote === '"' || quote === "'") {
    let j = i + 1;
    while (j < css.length) {
      if (css[j] === "\\") j += 2;
      else if (css[j] === quote) return j + 1;
      else j++;
    }
    return css.length;
  }
  return i;
}

/** The index just past the block that starts at `open` (a `{`). */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const skipped = skipInert(css, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

function parseDeclarations(body: string): { declarations: Declarations; marginBoxes: Record<string, Declarations> } {
  const declarations: Declarations = {};
  const marginBoxes: Record<string, Declarations> = {};

  let i = 0;
  let token = "";
  while (i < body.length) {
    const skipped = skipInert(body, i);
    if (skipped !== i) {
      // A string is part of the value — `content: "Title"` is the whole point
      // of a margin box — while a comment is not. Skipping both alike silently
      // empties every declaration whose value is quoted.
      const isString = body[i] === '"' || body[i] === "'";
      if (isString) token += body.slice(i, skipped);
      i = skipped;
      continue;
    }
    const ch = body[i] as string;

    if (ch === "{") {
      // A nested at-rule: a margin box such as `@top-center { … }`.
      const end = blockEnd(body, i);
      const name = token.trim().replace(/^@/, "").toLowerCase();
      if (name !== "") {
        marginBoxes[name] = parseDeclarations(body.slice(i + 1, end - 1)).declarations;
      }
      token = "";
      i = end;
      continue;
    }

    if (ch === ";") {
      addDeclaration(declarations, token);
      token = "";
      i++;
      continue;
    }

    token += ch;
    i++;
  }
  addDeclaration(declarations, token);
  return { declarations, marginBoxes };
}

function addDeclaration(into: Declarations, text: string): void {
  const colon = text.indexOf(":");
  if (colon === -1) return;
  const property = text.slice(0, colon).trim().toLowerCase();
  const value = text.slice(colon + 1).trim();
  if (property !== "" && value !== "") into[property] = value;
}

/** `chapter:first`, `:nth(2n+1)`, `:left`, or empty for the anonymous page. */
export function parsePageSelector(text: string): PageSelector {
  const trimmed = text.trim();
  const nameMatch = /^([A-Za-z_][\w-]*)?/.exec(trimmed);
  const name = nameMatch?.[1] ?? null;

  const pseudos: PagePseudo[] = [];
  const pseudoText = trimmed.slice(name?.length ?? 0);
  const re = /:([a-z-]+)(?:\(\s*([^)]*)\s*\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pseudoText)) !== null) {
    const kind = (m[1] ?? "").toLowerCase();
    if (kind === "first" || kind === "left" || kind === "right" || kind === "blank") {
      pseudos.push({ type: kind });
    } else if (kind === "nth") {
      const nth = parseNth(m[2] ?? "");
      if (nth !== null) pseudos.push({ type: "nth", ...nth });
    }
  }
  return { name: name ?? null, pseudos };
}

/** `2n+1`, `odd`, `even`, `3` → { a, b }. */
export function parseNth(text: string): { a: number; b: number } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (t === "odd") return { a: 2, b: 1 };
  if (t === "even") return { a: 2, b: 0 };

  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(t);
  if (m !== null) {
    const rawA = m[1] ?? "";
    const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : Number(rawA);
    return { a, b: m[2] === undefined ? 0 : Number(m[2]) };
  }

  const plain = /^[+-]?\d+$/.exec(t);
  if (plain !== null) return { a: 0, b: Number(t) };
  return null;
}

/**
 * Cascade layers (css-cascade-5 §6.4), as far as `@page` needs them.
 *
 * A layer is ranked by where its name first appears — in a statement
 * (`@layer a, b;`) or a block — among its siblings, and a layer's own rules
 * come after all of its sublayers'. A rule's rank is that path, compared
 * position by position, so `[0]` < `[1, 0]` < `[1, ∞]` < `[∞]`: unlayered
 * rules beat every layer. Only normal declarations are ranked; `@page` has
 * no `!important` here to reverse it.
 */
type Layer = { index: number; children: Map<string, Layer> };

/** Compare two layer ranks (`PageRule.layer`); an absent rank is unlayered. */
export function compareLayers(a: readonly number[] | undefined, b: readonly number[] | undefined): number {
  const x = a ?? [Infinity];
  const y = b ?? [Infinity];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    // A path that ends first is the layer's own rules: after its sublayers.
    const p = x[i] ?? Infinity;
    const q = y[i] ?? Infinity;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Pull every `@page` rule out of a stylesheet, leaving the rest verbatim. */
export function extractPageRules(css: string): Extracted {
  const rules: PageRule[] = [];
  const root: Layer = { index: 0, children: new Map() };
  let order = 0;
  let anonymous = 0;

  /** The layer a dotted name means under `parent`, declared if new. */
  const declare = (parent: Layer, name: string): Layer => {
    let layer = parent;
    for (const part of name.split(".")) {
      const key = part.trim();
      let child = layer.children.get(key);
      if (child === undefined) {
        child = { index: layer.children.size, children: new Map() };
        layer.children.set(key, child);
      }
      layer = child;
    }
    return layer;
  };

  const scan = (css: string, layer: Layer, path: number[]): string => {
    let rest = "";
    let i = 0;
    while (i < css.length) {
      const skipped = skipInert(css, i);
      if (skipped !== i) {
        rest += css.slice(i, skipped);
        i = skipped;
        continue;
      }

      if (/^@page\b/i.test(css.slice(i))) {
        const open = css.indexOf("{", i);
        if (open === -1) break;
        const end = blockEnd(css, open);
        const prelude = css.slice(i + "@page".length, open);
        const { declarations, marginBoxes } = parseDeclarations(css.slice(open + 1, end - 1));

        rules.push({
          selectors: prelude.split(",").map(parsePageSelector),
          declarations,
          marginBoxes,
          order: order++,
          ...(path.length > 0 ? { layer: [...path, Infinity] } : {}),
        });
        i = end;
        continue;
      }

      if (/^@layer\b/i.test(css.slice(i))) {
        const semi = css.indexOf(";", i);
        const open = css.indexOf("{", i);
        const prelude = css.slice(i + "@layer".length, open === -1 ? semi : semi === -1 ? open : Math.min(open, semi));
        if (open === -1 || (semi !== -1 && semi < open)) {
          // A statement: it only fixes the order of the names it lists.
          for (const name of prelude.split(",")) if (name.trim() !== "") declare(layer, name);
          rest += css.slice(i, semi === -1 ? css.length : semi + 1);
          i = semi === -1 ? css.length : semi + 1;
          continue;
        }
        const end = blockEnd(css, open);
        const name = prelude.trim();
        const inner = declare(layer, name === "" ? `\u0000anonymous-${anonymous++}` : name);
        const innerPath = [...path, ...indexPath(layer, inner)];
        rest += css.slice(i, open + 1) + scan(css.slice(open + 1, end - 1), inner, innerPath) + "}";
        i = end;
        continue;
      }

      rest += css[i];
      i++;
    }
    return rest;
  };

  return { rest: scan(css, root, []), rules };
}

/** The sibling indices from `from` down to `to`, which `declare` just made. */
function indexPath(from: Layer, to: Layer): number[] {
  for (const child of from.children.values()) {
    if (child === to) return [child.index];
    const below = indexPath(child, to);
    if (below.length > 0) return [child.index, ...below];
  }
  return [];
}

/** The descriptors of the page box itself whose lengths are resolved in stage 1. */
const PAGE_LENGTHS = /^(size|width|height|margin(-(top|right|bottom|left))?|bleed)$/;

/**
 * Resolve `em` and `rem` in the page box's own descriptors, given the root
 * element's font size (`resolveFontRelative`). A rule's `em` is its own
 * `font-size` when it sets an absolute one — `font-size: 10pt; margin: 2em` —
 * and the root's otherwise.
 */
export function resolvePageFontUnits(rules: readonly PageRule[], rootFontSize: number): PageRule[] {
  return rules.map((rule) => {
    const own = rule.declarations["font-size"];
    const em =
      own === undefined ? rootFontSize : (toPx(resolveFontRelative(own, rootFontSize, rootFontSize)) ?? rootFontSize);
    const declarations: Declarations = {};
    for (const [property, value] of Object.entries(rule.declarations)) {
      declarations[property] = PAGE_LENGTHS.test(property)
        ? resolveFontRelative(value, em, rootFontSize)
        : value;
    }
    return { ...rule, declarations };
  });
}
