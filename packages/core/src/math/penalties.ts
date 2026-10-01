/**
 * The math penalty table (`doc/math.md` §4).
 *
 * One exported object, for the reason `penalties.ts` gives: a cost scattered
 * across the code cannot be tuned from fixtures, only hunted. The ordering is
 * TeX's — relation, then binary operator, then separator — and the numbers sit
 * inside the scale of §3's table, because one `chooseBreak` weighs both.
 *
 * Nothing here knows about fonts, glyphs or spacing. An `<mo>` is classified
 * by the character it holds, as the operator dictionary does; MathML Core does
 * not expose its copy of that dictionary to script.
 */

/**
 * Which kind of operator an `<mo>` holds. `fence` is not a break position: it
 * is how a fenced `<mrow>` is recognised, so the walk can refuse to enter one.
 */
export type OperatorClass = "relation" | "binary" | "separator" | "fence" | "other";

export const MATH_PENALTIES = {
  /** After a relation: TeX's preferred display break. */
  afterRelation: 0,
  /** After a binary operator: second choice; the operator stays on the upper line. */
  afterBinary: 40,
  /** After a comma or semicolon: useful in long tuples and conditions. */
  afterSeparator: 60,
  /**
   * Added once per level of descent below the top row. §4's "descend only when
   * nothing at the top level fits" is enforced by offering one depth at a
   * time; the cost is still charged, so a top-level break and a nested one
   * competing at the same limit are not judged equal.
   */
  perDescent: 200,
  /**
   * Leaving one line of a three-line equation on its own. The vertical
   * fragmenter charges widows and orphans once the equation is a stack of rows
   * (`penalties.ts`); this is the *inline* decision that makes the stack.
   */
  lonelyLine: 150,
  /** How wide a continuation row is indented when there is no relation to align on. */
  indent: "2em",
} as const;

/** Characters that mean "this is a relation". */
const RELATIONS = new Set([
  "=", "≠", "≡", "≢", "≈", "≅", "≃", "≄", "∼", "≺", "≻", "≼", "≽",
  "<", ">", "≤", "≥", "≦", "≧", "≪", "≫", "⩽", "⩾",
  "∈", "∉", "∋", "⊂", "⊃", "⊆", "⊇", "⊄", "⊅", "⊊", "⊋",
  "≔", "≕", "≜", "≝", "≟", "∝", "⊢", "⊣", "⊨", "⊥", "∣", "≍",
  // TeX makes a colon a relation (`\mathrel`), which is also what makes the
  // composed `:=` classify as one.
  ":",
]);

/** Characters that mean "this is a binary operator". */
const BINARY = new Set([
  "+", "−", "-", "±", "∓", "×", "⋅", "·", "∗", "*", "÷", "/", "∘", "⊙",
  "⊕", "⊖", "⊗", "⊘", "∪", "∩", "⊎", "⊓", "⊔", "∖", "\\", "∧", "∨", "⋆", "†",
]);

const SEPARATORS = new Set([",", ";"]);

const OPENERS = new Set(["(", "[", "{", "⟨", "⌈", "⌊", "|", "‖", "〈"]);
const CLOSERS = new Set([")", "]", "}", "⟩", "⌉", "⌋", "|", "‖", "〉"]);

/** Arrows are relations — TeX gives `\to` class 3 — and there are too many to
 * list: U+2190–21FF is the block, U+27F0–27FF and U+2900–297F the supplements. */
function isArrow(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x2190 && c <= 0x21ff) ||
    (c >= 0x27f0 && c <= 0x27ff) ||
    (c >= 0x2900 && c <= 0x297f)
  );
}

/**
 * What an `<mo>` is, from its content. Whitespace is stripped first — MathML
 * from a TeX converter is full of it, and `<mo> = </mo>` is the same operator
 * as `<mo>=</mo>` — and a composed form (`:=`, `<=`) is classified by its
 * first character, as the operator dictionary treats the ones it lists.
 */
export function classifyOperator(text: string): OperatorClass {
  const op = text.trim();
  if (op === "") return "other";
  const first = [...op][0] as string;

  if (RELATIONS.has(op) || RELATIONS.has(first) || isArrow(first)) return "relation";
  if (SEPARATORS.has(op)) return "separator";
  if (BINARY.has(op) || BINARY.has(first)) return "binary";
  if (OPENERS.has(first) || CLOSERS.has(first)) return "fence";
  return "other";
}

/** The cost of breaking after an operator of this class, before descent. */
export function penaltyAfter(kind: OperatorClass): number | null {
  switch (kind) {
    case "relation":
      return MATH_PENALTIES.afterRelation;
    case "binary":
      return MATH_PENALTIES.afterBinary;
    case "separator":
      return MATH_PENALTIES.afterSeparator;
    default:
      // A fence, an accent or an unclassifiable symbol is not a break
      // position. Returning null rather than PROHIBITED keeps it out of the
      // candidate list entirely, so nothing has to filter it later.
      return null;
  }
}
