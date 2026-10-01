# Third-party licences

Folio is MIT (`LICENSE`). This file lists the third-party work the
repository or its built files contain, and the licence each is under.
Development dependencies (TypeScript, esbuild, Vitest, Playwright, pdf.js,
ESLint and the rest of `devDependencies`) are used to build and test, are
not redistributed, and are not listed.

## In the built files (`dist/`)

| Work | Version | Licence | In |
| --- | --- | --- | --- |
| Temml | 0.13.5 | MIT | `folio-tex.js`, `folio-math-tex.js` and their `.min.js` |

The other bundles (`folio`, `folio-viewer`, `folio-math`,
`folio.polyfill`) contain only this project's code. `paged.polyfill.js` is a
copy of `folio.polyfill.js` named after the file it replaces, and holds none
of Paged.js's code.

The TeX bundles leave out Temml's mhchem extension and its fonts
(`scripts/temml-without-mhchem.mjs`, `packages/temml/src/temml-css.ts`).

### Temml

<https://github.com/ronkok/Temml>. Also the source of the rules in
`packages/temml/src/temml-css.ts`, taken from `dist/Temml-Local.css`.

```
The MIT License (MIT)

Copyright (c) 2020 Ron Kok

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## In the repository only

None of these is in `dist/`. Each one's licence text is next to it.

| Work | Where | Licence | Licence text |
| --- | --- | --- | --- |
| Paged.js 0.5.0-beta.2, the published build | `packages/test/fixtures/vendor/paged.polyfill.js` | MIT, © 2018 Adam Hyde | its `@license` header; full text below |
| Paged.js spec corpus, commit `6b0ff80` | `packages/test/fixtures/corpus/` | MIT, © 2018 Adam Hyde | `packages/test/fixtures/corpus/LICENSE.md` |
| STIX Two Math, STIX Two Text | `packages/test/fixtures/fonts/` | SIL OFL 1.1, © 2001-2021 The STIX Fonts Project Authors | `packages/test/fixtures/fonts/OFL.txt` |
| IBM Plex Sans (fontsource 5.3.0, latin subset) | `examples/fonts/` | SIL OFL 1.1, © 2019 IBM Corp. | `examples/fonts/OFL-IBM-Plex.txt` |
| Noto Sans (fontsource 5.3.0, latin subset) | `examples/fonts/` | SIL OFL 1.1, © 2022 The Noto Project Authors | `examples/fonts/OFL-Noto-Sans.txt` |
| Noto Sans Math (fontsource 5.3.0) | `examples/fonts/` | SIL OFL 1.1, © 2022 Google LLC | `examples/fonts/OFL-Noto-Sans-Math.txt` |

The fonts are fixtures and examples. The engine ships no font (`doc/math.md`
§3). STIX's Reserved Font Name and trademark notice are in its `OFL.txt`.

The web-platform-tests (BSD-3-Clause) that `packages/test/wpt.mjs` runs are
fetched at a pinned commit into `packages/test/.wpt-cache/`, which is not
committed. Only the manifest of test names is in the repository.

### Paged.js

<https://gitlab.coko.foundation/pagedjs/pagedjs>

```
The MIT License (MIT)

Copyright (c) 2018 Adam Hyde

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
