# eng.traineddata — the OCR language model behind image-to-text

| file | bytes | sha256 |
|---|---|---|
| `eng.traineddata.gz` (what this origin serves) | 1967599 | `f1c22599ed6fd3eb821d87fdb43e09f98b61179a4abe38c43cfca2cdcb9f5ec2` |
| the raw model it decompresses to | 4113088 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |

- **Upstream:** `eng.traineddata` from
  `https://github.com/tesseract-ocr/tessdata_fast` (branch `main`), the LSTM
  "fast" integerised model line.
- **Licence:** Apache-2.0, the same licence as Tesseract itself and as the
  `tesseract.js` / `tesseract.js-core` packages that read it. Named by hand on
  `/licenses`, because — like the FFmpeg core and the qpdf artifacts — this is
  a file this origin serves rather than an npm dependency the notices
  generator can walk.
- **Compressed with:** `gzip -9 -n`. The `-n` is load-bearing: without it gzip
  writes the source filename and the mtime into the header, and the artifact
  stops being reproducible. With it, re-compressing the same input on any
  machine yields these exact 1967599 bytes.

`src/__tests__/unit/data/tesseract-artifact.test.ts` re-derives both hashes on
every `npm test` — including gunzipping this file and hashing the result — so a
model swapped for a different line (or a re-gzip that quietly changed the
bytes) fails the suite instead of shipping.

## Why the `fast` model rather than `best`

Measured, not assumed. The three published English models:

| line | raw | served (.gz) |
|---|---|---|
| `tessdata_fast` | 4,113,088 | **1,967,599** |
| `tessdata_best` | 15,400,601 | 12,821,300 |
| `tessdata` (legacy+LSTM) | 23,466,654 | 10,923,060 |

`best` is 6.5× the wire cost of `fast` for an accuracy difference that does not
show up at all on the clean, high-contrast text these tools are pointed at, and
this site already asks visitors to think about a 30.8 MB FFmpeg core. `fast` is
also the only one of the three that is purely LSTM, which is what lets us serve
the LSTM-only engine core (2.86 MB) instead of the full one (3.45 MB): the
legacy Tesseract engine those other lines carry has nothing to drive here.

## Why it is checked in rather than fetched

`copy:wasm` stages every other engine out of `node_modules`. There is no npm
package for this file — `tesseract.js` expects to pull it from
`tessdata.projectnaptha.com` at runtime, which is precisely the behaviour this
repo overrides. Checking it in is also what `offline.test.ts` requires: that
test `statSync`s the SOURCE of every `cp` step to derive the bundle's byte
count, and CI runs the unit suite without ever running `copy:wasm`, so a source
that only exists under the gitignored `public/` could not be measured on a
clean checkout.

## It must stay a sibling of the engine core

`copy:wasm` puts this file in `public/tesseract/` alongside `worker.min.js`,
`tesseract-core-simd-lstm.js` and `tesseract-core-simd-lstm.wasm`. That is not
tidiness. `tesseract.js` never passes Emscripten a `locateFile`, so the core
glue resolves its `.wasm` against `self.location.href` — the URL of
**`worker.min.js`**, not of the glue — and splitting the directory 404s the
binary with a misleading `CompileError: expected 4 bytes, fell off end`.
