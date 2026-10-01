// Content built in script so every engine gets byte-identical text, and so the
// spike can say which element it is asking about.
globalThis.buildSpikeContent = (flow) => {
  const para = (id, sentences, cls = "") =>
    `<p id="${id}" class="${cls}">${("Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor. ").repeat(sentences)}</p>`;

  flow.innerHTML = [
    para("p1", 6),
    para("p2", 6),
    // A block that must not be split.
    // Sized so it straddles a column boundary when nothing prevents it.
    `<div class="avoid" id="avoid1">${para("p-in-avoid", 9)}</div>`,
    para("p3", 4),
    // Widows and orphans: a paragraph long enough to straddle a break.
    // Long enough that it must straddle a break, or the widows test asks
    // nothing at all.
    para("wo1", 14, "wo"),
    // A forced break.
    `<h2 id="forced1">Forced break before this heading</h2>`,
    para("p4", 4),
    // Display equation as an mtable, the composition math.md §4 uses: can the
    // browser fragment it inside a column? (math.md §10 Q1)
    `<math id="eq1" display="block"><mtable>${
      // Taller than a column on purpose: an equation that fits is not a test
      // of whether an equation can be fragmented (math.md §10 Q1).
      Array.from({ length: 20 }, (_, i) =>
        `<mtr><mtd><mi>x</mi><mo>=</mo><mn>${i}</mn><mo>+</mo><mfrac><mn>${i + 1}</mn><mn>${i + 2}</mn></mfrac></mtd></mtr>`,
      ).join("")
    }</mtable></math>`,
    para("p5", 6),
  ].join("");
};
