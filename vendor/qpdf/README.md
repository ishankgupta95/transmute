# qpdf 12.4.1 — WebAssembly build

The engine behind protect-pdf, unlock-pdf, pdf-permissions and repair-pdf.

| file | bytes | sha256 |
|---|---|---|
| `qpdf.js` (Emscripten glue, ES module) | 63089 | `9e37993512a42ad69c3daedf310f58ff1ac71037206ffe75ea40666d7511bd07` |
| `qpdf.wasm` | 2340730 | `9c85419773af72b1883533225f63dc3c609f305a610944a27a954cd0d9159e1a` |

- **Upstream:** qpdf 12.4.1, from the official release tarball
  (`https://github.com/qpdf/qpdf/releases/download/v12.4.1/qpdf-12.4.1.tar.gz`).
- **Licence:** Apache-2.0. Built with `-DUSE_IMPLICIT_CRYPTO=OFF
  -DREQUIRE_CRYPTO_NATIVE=ON`, so the only crypto provider linked in is qpdf's
  own Apache-2.0 `native` one — GnuTLS (LGPL) and OpenSSL cannot be picked up
  from the host even if they are installed. zlib and libjpeg come from
  Emscripten's own ports (zlib licence / IJG licence, both permissive).
- **Built by:** `scripts/build-qpdf-wasm.sh` on this machine (macOS, emsdk).
  That script re-runs the licensing gate at build time;
  `src/__tests__/unit/data/qpdf-artifact.test.ts` re-runs it against these
  exact bytes on every `npm test`, so a swapped or re-linked artifact fails the
  suite rather than shipping quietly.

## Why these two files are checked in

qpdf is not an npm package, so `copy:wasm` has nothing in `node_modules` to
copy from — every other engine it stages comes from a dependency. Checking the
two web artifacts in (2.4 MB, private repo) is what lets CI build the site
without an Emscripten toolchain. `copy:wasm` copies them to the origin root
(`public/qpdf.js`, `public/qpdf.wasm`, gitignored) beside `ffmpeg-core.*`;
they must stay siblings, because the glue locates the wasm as
`new URL("qpdf.wasm", import.meta.url)`.

`qpdf-node.js` / `qpdf-node.wasm` — the same object files linked for Node, used
only to verify the build headlessly — are deliberately NOT here and are never
shipped.

## `-fwasm-exceptions` is mandatory

qpdf signals every error condition (wrong password, damaged xref) by throwing
`QPDFExc`. Emscripten disables C++ exceptions by default, which turns each of
those into a bare wasm `abort()` with no message — measured during the build:
an encrypted file opened with the wrong password aborted the module instead of
reporting `invalid password`. A security tool must report. If this artifact is
ever rebuilt, `-fwasm-exceptions` has to be on the compile *and* link lines.
