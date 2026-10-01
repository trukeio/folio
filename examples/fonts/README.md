# Fonts for the examples

Served from the repository so the examples need no network. All three
families are under the SIL Open Font License 1.1; the licence texts are beside
them.

| File | Family | From |
| --- | --- | --- |
| `IBMPlexSans-{400,600}-{normal,italic}.woff2` | IBM Plex Sans, regular and semibold | `@fontsource/ibm-plex-sans` 5.3.0, latin subset |
| `NotoSans-{400,600}-{normal,italic}.woff2` | Noto Sans, regular and semibold | `@fontsource/noto-sans` 5.3.0, latin subset |
| `NotoSansMath-Regular.woff2` | Noto Sans Math | `@fontsource/noto-sans-math` 5.3.0 |

Noto Sans Math is a math font in the sense the engine needs: it has an
OpenType `MATH` table, which the fontsource file keeps (checked with fontTools,
along with the mathematical italic letters MathML draws single-letter `<mi>`
with). Plex's figures are tabular by default — every digit is 600 units wide —
so numeric table columns line up without `font-variant-numeric`.

Noto Sans (used by `report-noto/`) shares Noto Sans Math's x-height, 536
units, so the formulas there are set at the text's size rather than a step
below it as beside Plex. Its figures are tabular by default too (572 units),
and so is its minus sign. The latin subset has no Greek; the only Greek in the
report is inside `<math>`, which Noto Sans Math draws.
