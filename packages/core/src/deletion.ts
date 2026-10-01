/**
 * Build it so code can be deleted (`doc/plan.md` §8).
 *
 * Every polyfill module exports a `deletion` — the feature it stands in for,
 * the condition under which it goes, and the WPT tests that decide it — and
 * a `nativeSupport()`. This file gathers them, and names the rest of core as
 * the engine, which §8 exempts: it goes only if browsers ever let a script
 * read their own print fragmentation, and then all of it goes at once.
 *
 * `packages/test/deletion.mjs` reads the registry against native WPT runs
 * and says, per module, whether every target browser passes every test it
 * names. `deletion.test.ts` keeps the registry honest: every pattern matches
 * a test in the pinned manifest, and every file in core is either a
 * polyfill's or the engine's, so a new module cannot slip past the gate.
 */
import { deletion as fragments } from "./fragments.js";
import { deletion as counters } from "./counters.js";
import { deletion as extents } from "./extents.js";
import { deletion as media } from "./css/media.js";
import { deletion as viewport } from "./css/viewport.js";
import { deletion as paint } from "./page-paint.js";
import { deletion as leaders } from "./leaders.js";
import { deletion as marginBoxes } from "./margin-boxes.js";
import { deletion as pageCounters } from "./page-counters.js";
import { deletion as pageModel } from "./page-model.js";
import { deletion as strings } from "./strings.js";
import { deletion as carry } from "./carry.js";
import { deletion as references } from "./references.js";
import { deletion as footnotes } from "./footnotes.js";
import { deletion as tables } from "./tables.js";
import { deletion as pageFloats } from "./page-floats.js";
import { deletion as nthFragment } from "./nth-fragment.js";
import { deletion as mathBreaking } from "./math/candidates.js";
import { deletion as mathNumbers } from "./math/number.js";
import type { Deletion } from "./native.js";

export type { Deletion } from "./native.js";

/** Every polyfill module's deletion condition. */
export const polyfills: readonly Deletion[] = [
  fragments,
  counters,
  extents,
  media,
  viewport,
  paint,
  leaders,
  marginBoxes,
  pageCounters,
  pageModel,
  strings,
  carry,
  references,
  footnotes,
  pageFloats,
  nthFragment,
  tables,
  mathBreaking,
  mathNumbers,
];

/**
 * The engine: §8's exemption. None of these stands in for a browser feature
 * a browser could ship; they are what builds pages from a document at all.
 */
export const engine: { files: readonly string[]; why: string } = {
  why:
    "The engine itself: the fragmenter, composition, measurement, stage 1 and 5, the " +
    "furniture and the application layers. It goes only if browsers let a script read their " +
    "own print fragmentation (`plan.md` §8, \"the big one\"), and then as a whole.",
  files: [
    "candidates.ts",
    "select.ts",
    "penalties.ts",
    "paginate.ts",
    "text.ts",
    "position.ts",
    "chunk.ts",
    "compose.ts",
    "dom-measurer.ts",
    "source.ts",
    "settle.ts",
    "pages.ts",
    "furniture.ts",
    "types.ts",
    "index.ts",
    "deletion.ts",
    "native.ts",
    "flow.ts",
    "css/length.ts",
    "css/rewrite.ts",
    "preview.ts",
    "polyfill.ts",
    "math/font.ts",
    "math-screen.ts",
    "math-global.ts",
  ],
};
