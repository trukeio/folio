# Vendored Paged.js

`paged.polyfill.js`, Paged.js 0.5.0-beta.2, MIT — the build the baseline is
measured against, and the version `doc/plan.md` cites throughout.

Taken from the published npm package rather than built from the checkout in
`../corpus/PROVENANCE.json`, so the baseline measures a release rather than
whatever happens to be on a developer's disk.

The runner serves it by intercepting `**/paged.polyfill.js`, which is how the
corpus fixtures can keep their upstream `<script src="../../../dist/...">` at
whatever depth they sit, unmodified.
