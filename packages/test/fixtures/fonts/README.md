# Fixture fonts

Both SIL Open Font License 1.1 (`OFL.txt`), and both **test fixtures, not the
engine's default**. Which family the engine ships, and in what format, was left
to M4.1 by `doc/math.md` §3: the default math font is chosen to match the
default text font, and there is no default text face yet.

**M4.1 decided to ship none**, for that reason — see `math.md` §3. The author
names the family and `normalize({ mathFont })` proves its `MATH` table is in
use, throwing if it is not. These two stay unsubsetted OTFs because they are
fixtures; a woff2 belongs with the default, whenever there is one.

| File | Role |
| --- | --- |
| `STIXTwoMath-Regular.otf` | Has a `MATH` table (14 tables). The positive case: M0.4 needs a real MATH font to prove the probe can see one. |
| `STIXTwoText-Regular.otf` | No `MATH` table (13 tables). The negative control. |

The negative control is shipped rather than requested by name. It first used
`local("DejaVu Sans")`, which passes on a machine that has DejaVu and inverts
on one that does not: an unresolvable family falls back to something
math-capable, so the control silently starts asserting the opposite of what it
means. CI found this; see `math-probe.spec.ts`.
