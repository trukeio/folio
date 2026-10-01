# Golden images (M4.6)

Thirty formulas, one PNG per formula per engine, recorded from
`fixtures/math-gallery.html`. What they catch is "it changed" — positioning is
the browser's and the font's (`doc/math.md` §1), and the regression this
project can own is a fraction going flat, a fence that stopped stretching or a
script that stopped shifting, each of which moves a large share of the pixels
in its box.

**These are host-specific, like `packages/test/baselines/*.json`.** They were
recorded on:

| | |
| --- | --- |
| Platform | linux 7.2.4-200.fc44.x86_64 (Fedora 44) |
| Engines | Playwright chromium and firefox, `deviceScaleFactor: 1` |
| WebKit | recorded by CI (ubuntu-latest, run 35875450091, 2026-09-23), since WebKit does not launch locally; reviewed side by side with the other two before committing |
| Math font | `fixtures/fonts/STIXTwoMath-Regular.otf`, unsubsetted |

A host that renders text differently — a different Linux distribution is enough
— will differ in antialiasing. `playwright.config.ts` sets
`updateSnapshots: "missing"`, so a platform with no baseline records its own —
and the test still fails on that run, because Playwright counts a written
snapshot as a failure; the recorded images are in the job's
`playwright-report-*` artifact, to be looked at and committed. A platform that
*has* a baseline and disagrees fails, which is the point. The Linux baselines
from Fedora pass on ubuntu-latest in CI. The comparison is loose on colour (`threshold: 0.35`) and tight on area
(`maxDiffPixelRatio: 0.02`) for the same reason.

To re-record after a deliberate change:

```
pnpm exec playwright test packages/test/browser/math-golden.spec.ts --update-snapshots
```

WebKit differs from both others in places, as the engines differ from each
other: tighter `mtable` column spacing (`cases`, `fence-matrix-*`), the
contour integral set close to its integrand, and the bars of `underover`
slightly off-centre. None was judged a fault when the images were reviewed.

Read the diff before committing it. A golden image updated without looking is a
golden image that proves nothing.
