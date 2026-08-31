# Licensing posture — third-party engines shipped by transmute.tools

> **Engineering analysis, NOT legal advice.** Researched by automation agents from primary
> sources; facts verified against the working tree and the built `out/` on 2026-08-31.
> Consult counsel before commercializing the site or if any conclusion here is load-bearing.

## OWNER DECISION — 2026-08-31

**The repo stays private and the app stays closed-source.** Option A (AGPL the app, public
repo) is REJECTED. That forces the posture below: the shipped product must converge on a
**permissive + LGPL-only stack** — AGPL components removed, GPL conveyance limited to an
arm's-length separate program with a full source offer, LGPL libraries made genuinely
replaceable, and a /licenses notices page. This is the remediation plan the next wave
executes (plan.md "Wave 2 — REVISED").

## TL;DR under the closed posture

| Component | Shipped as | License | Compliant today? | Cure (closed posture) |
|---|---|---|---|---|
| MuPDF (`mupdf` 1.27.0) | `public/mupdf-wasm.wasm` (10 MB) + AGPL JS glue bundled into `public/workers/mupdf-*.js` | **AGPL-3.0-or-later** | **No** | **REMOVE.** Its 7 ops port to pdf-lib (MIT); compress-pdf is the one real regression — qpdf-wasm (Apache-2.0) is the replacement spike. No commercial Artifex license planned. |
| FFmpeg core (`@ffmpeg/core` 0.12.10) | `public/ffmpeg-core.{js,wasm}` | **GPL-2.0-or-later** (verified `--enable-gpl --enable-libx264 --enable-libx265 …` in the binary; FFmpeg 5.1 line) | **No** (no notice/source offer) | Keep under the **separate-program posture** + full source offer on /licenses (details below). Belt-and-braces follow-up: spike a custom LGPL core build (nothing shipped today uses x264/x265 — H.264 encode is WebCodecs). |
| lamejs (`@breezystack/lamejs` 1.2.7) | Minified into `public/workers/audio-encode.worker.js` **and two Next client chunks** | LGPL-3.0 | **No** (bundled, not replaceable, no notice) | Vendor `dist/lamejs.js` to `public/vendor/`, load via runtime `import()` of the stable URL (LGPL §4(d)(1) replaceability); notice + texts on /licenses. One change cures all three ship vectors. |
| **heic2any 0.0.4 — found 2026-08-31** | Isolated 1.35 MB client chunk (the homepage's "1.3 MB" row) | MIT wrapper **embedding an Emscripten libheif build (LGPL-3.0-or-later), almost certainly with libde265 (LGPL) for HEVC decode** | **No** (same §4 problem, live today — the earlier draft wrongly called libheif "prospective, Wave 4") | Same vendoring cure: serve `heic2any.js` from `/vendor/` at a stable URL via runtime `import()`; libheif + libde265 notices + LGPL text. |
| exifreader 4.37.0 | client chunk | MPL-2.0 | Needs notice | /licenses entry linking the MPL source + license text. |
| Everything else that ships | client/worker chunks, fonts | MIT / Apache-2.0 / BSD / ISC / OFL / Zlib / MPL-or-Apache dual | Attribution only | One /licenses inventory (elect MIT for jszip, Apache-2.0 for dompurify; pako, diff BSD-3, pdfjs Apache text, OFL font notices). |

## Why removal, not licensing, for MuPDF

- Serving the WASM + JS glue to browsers is conveying; the app bundles MuPDF's own AGPL JS
  bindings into its worker chunks — that is linking, and both the FSF FAQ and Artifex read
  the combination as AGPL-scoped. Closed source and shipped MuPDF cannot coexist without a
  commercial license, which the owner is not pursuing.
- Blast radius is modest and fully mapped (audit 2026-08-31): **one import site**
  (`pdf-engine-core.ts`), 7 ops, 6 tools (merge-pdf, split-pdf, rotate-pdf,
  pdf-page-reorder, add-page-numbers, compress-pdf) + page-count preflights. pdf-lib
  (already bundled, MIT) covers merge/split/reorder (`copyPages`), rotate
  (`setRotation` — handles the inherited-/Rotate case natively), page counts, and
  add-page-numbers (`StandardFonts.Helvetica` + `widthOfTextAtSize`; port the
  rotation-compensation matrix from pdf-engine-core.ts:250–281). Behavioral parity notes:
  MuPDF's graft already dropped `/Outlines`, so bookmarks are not a regression; pdf-lib is
  less tolerant of damaged xrefs (MuPDF silently repaired) — error copy must stay honest.
- **compress-pdf is the one real loss**: MuPDF's `compress,garbage` GC + stream re-deflate
  has no pdf-lib equivalent (`useObjectStreams` only). Replacement spike: **qpdf compiled
  to WASM (qpdf is Apache-2.0)** — also brings encrypt/decrypt/repair for the Wave-2
  survivors. Verify the specific wasm package's own license and provenance before adopting;
  if the spike fails, the tool keeps the never-grow guarantee and its copy gets weaker,
  honestly.
- Killed by this decision (record; stop re-proposing while the repo is closed):
  encrypt/unlock/permissions via MuPDF, true redaction, pdf-to-html/svg via MuPDF
  DocumentWriter, EPUB/MOBI/CBZ readers, docx-to-pdf (Wave 5 item), MuPDF compress upgrade,
  outline editor. qpdf may honestly resurrect encrypt/decrypt/repair; redaction has no
  honest permissive client-side path today — do not fake it.

## FFmpeg core — the separate-program posture (kept, documented)

The app never links the GPL core: the MIT `@ffmpeg/ffmpeg` wrapper spawns its own worker
which `importScripts` the core and exposes a CLI-shaped `exec(args)`; all traffic is
postMessage across the worker boundary. That is the strongest available version of the
"separate program at arm's length" argument, and it is the standard posture of closed
ffmpeg.wasm users. Residual risk: an FSF-conservative reading could still call it a
combined work — flagged for counsel; mitigation queued (LGPL core spike, feasible because
every shipped encode path is WebCodecs/lame, none is x264/x265).

Source offer the /licenses page must carry (GPLv2 §3 / v3 §6(d)):
core version **0.12.10**; link the ffmpegwasm/ffmpeg.wasm release tag for it (Dockerfile +
`build/*.sh` are the build config, FFmpeg pinned on the n5.1 line); reproduce the configure
line (verifiable inside the shipped .wasm); link FFmpeg 5.1 source; name the statically
linked libs (x264 GPL-2.0, x265 GPL-2.0, libvpx BSD-3, LAME LGPL, theora/vorbis/opus BSD,
libwebp BSD-3, freetype, fribidi LGPL-2.1+, libass ISC, zimg, zlib). Conservative
hardening: mirror the exact-tag source archive under owner control so the offer cannot rot.
Also FFmpeg's required credit line: "This software uses code of FFmpeg licensed under the
GPLv2 or later." Patent note (H.264/HEVC pools) stands — counsel question if the site ever
commercializes.

## /licenses page — placement and consistency (audited)

- `src/app/licenses/page.tsx` mirroring `privacy/page.tsx` (canonical `/licenses`, same
  wrapper/type classes, data-driven sections). Long license texts as static files under
  `public/licenses/*.txt`, linked. Footer `SITE_LINKS` entry + `sitemap.ts` entry.
- Copy that must move in lockstep with MuPDF removal: homepage ENGINES table
  (`app/page.tsx:107–118`, incl. the MuPDF row and pdf-lib row scope),
  `LiveEngine.tsx:34`, `CompressPdfUI.tsx` MUPDF badge, `about/page.tsx:76`,
  `privacy/page.tsx:31`, six `workspace.ts` rows labeled `MUPDF WASM`,
  `src/content/blog/how-to-merge-pdfs-in-browser.mdx:23`, `CLAUDE.md`.
- The privacy page's "no third-party requests" claim survives ONLY with same-origin
  `/vendor/` cures — never a CDN.
- `pdf-engine.test.ts` is a mupdf-mock harness — rewrite against real pdf-lib (runs in
  jsdom, a strict upgrade); retune `golden-paths.spec.ts:102`'s compress expectation.

## Sources

- https://www.gnu.org/licenses/gpl-faq.en.html (#UnreleasedMods, #IfLibraryIsGPL, #GPLStaticVsDynamic, #MereAggregation)
- https://www.gnu.org/licenses/agpl-3.0.en.html · https://www.gnu.org/licenses/lgpl-3.0.en.html
- https://artifex.com/licensing/agpl/ · https://mupdf.readthedocs.io/en/1.27.0/license.html
- https://ffmpeg.org/legal.html · https://qpdf.sourceforge.io (Apache-2.0)
- Local verification: `strings` on shipped wasm binaries; npm `license` fields; chunk-level
  inspection of `out/_next/static/chunks/` and `public/workers/` (audits 2026-08-31).
