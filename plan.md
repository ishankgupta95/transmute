# Transmute — Tool Gap Execution Plan

> **Rewritten 2026-08-31** at the owner's direction. The previous plan (Phases 1–8: design
> fidelity, WASM hardening, worker pool, workspace-real, test honesty, canvas geometry, design
> docs) is fully landed and verified; its history is removed. This plan is the execution of the
> 2026-08-30 tool-gap research: **427 candidates** from 13 agents (competitor menus, keyword
> demand, client-side capability), independently verified for feasibility, then the load-bearing
> claims **re-verified locally against the shipped binaries** — including runtime round-trips run
> 2026-08-31 (see "Engine facts").
>
> Full report: https://claude.ai/code/artifact/991aca28-5ba2-46f9-9456-d5aa40f64e36
>
> **The one-line thesis:** the biggest gaps are not missing engines. They are engines already in
> `public/` that have no pages (MuPDF ~10% used, FFmpeg ~15% used), plus queries served by pages
> named after the engine instead of the query.

---

## Context carried forward (hard-won — do not re-derive)

- **Stack:** Next.js 16.2.2 (App Router, `output: "export"`, Turbopack), React 19, TS strict,
  Tailwind v4. GitHub Pages, apex `transmute.tools`, **no basePath**. 67 pages / 54 tool types in
  `src/data/tools.ts`; every UI count derives from `tools.length`.
- **The test blind spot:** jsdom has no canvas/WASM — green unit tests say nothing about
  conversion correctness. `npm run test:e2e:conversion` (real fixtures, byte-level + decoded
  assertions) is the gate that matters after any `lib/tools/` or tool-UI change.
- **Dual image pipeline:** `src/lib/workers/image.worker.ts` re-implements
  `lib/tools/image-{convert,compress,resize}.ts` and is what actually ships for those tools.
  New image ops must land in the **worker** (and its protocol), not just `lib/tools/`.
- **Turbopack worker trap:** `next build` does NOT bundle `new Worker(new URL(...))` — workers
  are esbuild-prebundled to `public/workers/` via `npm run copy:wasm`
  (`scripts/build-workers.mjs`). Worker entrypoints import **leaf modules only**; a chain that
  reaches a module naming the worker's own URL hangs the build at ~0% CPU. After editing worker
  code or its imports, re-run `copy:wasm` — `next dev` does not watch the esbuild bundles.
- **Other traps:** `@ffmpeg/core-mt` deadlocked in many browsers (emscripten pthreads) — see
  Wave 3 before believing any "just enable threads" advice. Don't run `next build` while
  `next dev` is up (shared `.next`). `public/**` is ESLint-ignored. No state-setting in effects —
  use `useIsClient()` / `useSyncExternalStore` patterns. FFmpeg core is self-hosted
  (`copy:wasm` → `public/`, gitignored); the conversion suite's `forbidCdnCore` fails the run on
  any CDN regression. E2E quirks: cold-`.next` 404 spec 500s alone; `<details>` counts include
  the mobile rail; ImageCropperUI SE handle needs a scroll at 720px.
- **Deliberate copy/UX deviations from the design docs stand** (Copy/Copied! casing, readonly
  textarea outputs, MarkdownToPdfUI editor+preview, AudioMerger join-order list, live-vs-click
  dev-tool split). Do not "fix" them back; the list lives in git history of this file
  (pre-2026-08-31 version).
- **Verified baseline (2026-08-19, all green):** tsc · lint 0 err/2 warn · unit 1629 ·
  e2e 231/231 · conversion 111 pass/2 designed skips · export 87 routes. The redesign tree is
  **merged and deployed** (PR #2, `3de521a` on master, 2026-08-31); only the Wave 0 fix set
  below is uncommitted.

---

## Engine facts — measured 2026-08-31, not assumed

### MuPDF — HISTORICAL, REMOVED 2026-08-31 (Wave 2). Do not reason from this as current.

> The whole section below describes an engine this app **no longer ships**. It is kept because
> it is the record of what was measured and what was compiled OUT, so nobody re-proposes an
> OCR or DOCX-writer feature on the strength of a MuPDF capability list. Under the closed-source
> decision MuPDF is gone (AGPL); the seven PDF operations run on pdf-lib. Anything below marked
> "verified present" is verified present *in a dependency that is no longer installed*.

**Runtime-verified this session** (Node round-trips against the exact npm build we copy):

| Capability | Test result |
|---|---|
| Encrypt | `saveToBuffer("encrypt=aes-256,user-password=…,owner-password=…,permissions=-print")` → reopen: `needsPassword()===true`, auth OK, `"Standard V5 R6 256-bit AES"` |
| Redact | `createAnnotation("Redact")` + `applyRedactions()` → redacted string **absent from extracted text**, neighboring text intact. True glyph destruction, not a black box. |
| Office reader | Minimal real DOCX opens via `Document.openDocument(buf, "x.docx")`, paginates, extracts text |
| Text extraction | `toStructuredText().asText()` / `.asHTML()` both correct |

**Symbol-verified** (present in the WASM): full `pdf_annot_*` surface + `bake()` (watermark /
annotate / sign / flatten), `getWidgets()` + `resetForm()` (forms), `setPageBox` (crop / page
size), outline mutation + page labels, `DocumentWriter('html'|'svg'|'cbz')`, EPUB/MOBI/FB2/CBZ
readers, PSD/JP2 as document types, xref auto-repair, `garbage/compress/sanitize` save options.

**Compiled OUT — record permanently, stop re-proposing:**
- OCR (`"No OCR support in this build"`; `DocumentWriter('pdfocr')` throws)
- DOCX/ODT **writer** (`"DOCX/ODT writer not enabled"`) → no client-side `pdf-to-word`/`pdf-to-epub`
- Linearization (`"Linearisation is no longer supported"`) → no `optimize-pdf-web`
- No EPS/PostScript *document* handler (research claimed it; only FreeType font symbols exist)

### FFmpeg core (`public/ffmpeg-core.wasm`, 31 MB, self-hosted, single-threaded)

- **Present:** libx264, libx265, libvpx/-vp9, libmp3lame, aac, flac, libopus, libvorbis, libwebp,
  matroska/avi/asf(wmv)/flv demuxers, mov/mp4 muxer family, apng, `loudnorm` + `ebur128`.
- **Absent:** libaom (no AV1/animated-AVIF encode), vidstab (no stabilization).

### Repo facts (found locally; NOT in the research doc — the 3 extra findings)

1. **The PWA is 90% built and 10% missing.** `public/` already has `icon-192.png`,
   `icon-512.png`, `icon-maskable-512.png`. There is **no manifest and no service worker** — the
   two files that would make the site installable and provably offline. Since FFmpeg + MuPDF are
   vendored, full offline operation is genuinely achievable; no upload-based competitor can copy it.
2. **Exactly one third-party script loads: GA4** (googletagmanager in `layout.tsx`). No AdSense,
   no `ads.txt`, no CSP anywhere. This makes cross-origin isolation (Wave 3) a one-script
   problem, and makes the "prove zero-upload in-product" work (Platform track) honest to ship.
3. **CLAUDE.md is stale:** it says FFmpeg "fetches ~25 MB from unpkg CDN on first use"; it is
   vendored at `public/ffmpeg-core.wasm` and `ffmpeg-loader.ts` documents why. Fix so future
   sessions don't reason from it.

### Live correctness bugs (found while verifying, fix before widening blast radius)

- **Animated WebP/GIF → frame 0 only, silently.** `image-convert.ts` routes WebP/GIF/AVIF through
  `<img>` decode (worker: `createImageBitmap`), which takes the first frame. `webp-to-jpg`
  returns a still from an animation with no warning.
- **Multi-page TIFF → page 1 only, silently.** `decodeTiff()` uses `ifds[0]` and discards the
  rest. Multi-page TIFFs are the *normal* case in scan/fax workflows — exactly what
  `tiff-to-jpg` attracts.

---

## Research caveats (how much to trust what)

- **All search-volume figures are agent-sourced and unverified** (some cite Ahrefs, some are
  estimates). The *rankings* hold on structural grounds (7/7 competitor coverage, nav placement);
  do not quote the numbers.
- The raw candidate list has ~25 duplicate pairs with conflicting recommendations; the
  deduplicated count is ~390. This plan is the deduplication.
- **Corrections made to the research** (verified locally, recorded here so they stick):
  - "MuPDF renders EPS" — false for this build.
  - "protect-pdf may be unavailable" — false; runtime-verified above.
  - "COOP/COEP impossible because of the ad stack" — there is no ad stack; only GA4.
  - "Threading is a free 4–8× win" — ignores this repo's **recorded core-mt pthread deadlocks**
    and Safari. Owner-gated spike, not a freebie (Wave 3).
  - "TTS is a one-afternoon build" — false: `speechSynthesis` exposes no audio stream, so a
    *downloadable* TTS file needs a WASM TTS model (a large build). Dropped from the plan.
  - "compress-video-to-size = multi-minute FFmpeg pain" — our `compress-video` is **WebCodecs**
    (hardware-fast); size presets build on that path, not FFmpeg.
  - "resize-image-to-NKB pages are trivial, engine exists" — half-true: the KB targeter
    binary-searches **quality only and never downscales** (`image.worker.ts` draws at source
    dimensions). The "resize" phrasing needs real dimension-stepping or the pages lie (the exact
    class of copy-dishonesty Phase 8 spent a week purging).
  - tesseract.js size claims conflict (2.7 MB vs 15–30 MB) — depends on traineddata variant;
    measure at build time (Wave 5).

---

## Wave 0 — decisions and fixes before any new pages

- [x] **Owner: commit/review the outstanding redesign tree.** *(Done — merged to master and
  pushed as PR #2, `3de521a`; transmute.tools now serves the redesign. The only uncommitted
  work is the Wave 0 fix set below.)*
- [x] **Owner: page architecture for variant pages.** *(2026-08-31, decided under the owner's
  "do what's best" delegation — **hub-and-spoke with honesty gates**, revisitable on evidence:
  (1) one canonical engine page per job; (2) a variant page ships as its own indexable page ONLY
  if it clears all three gates — distinct user intent, copy that is mostly variant-specific and
  honest without padding, and behavior that differs at least by defaults (preset KB target,
  pre-picked format, format-specific caveats); (3) pure synonyms get `rel=canonical` to the
  engine page or are simply not built — no page exists only to catch a query; (4) every variant
  mounts the SAME engine component via registry config — no forked logic; (5) a crawlable
  `/all-tools` index ships with Wave 1 (this also closes the carried "all-tools route" call);
  (6) discipline: ~120 indexable pages max through Wave 4, Search Console reviewed after every
  wave, and the rollback lever is canonicalizing variants back to their engine page at the first
  doorway-style demotion signal. Applied to Wave 1: the KB ladder and image→PDF/PDF→image format
  children clear the gates (distinct defaults + real format facts); the GIF container aliases
  (`mp4-to-gif` etc.) mostly do NOT — canonical or skip, per their own item's note.)*
- [x] **Fix: animated WebP/GIF frame-0 bug.** *(2026-08-31: warn-everywhere shipped in BOTH
  pipelines — byte-sniff leaf `image-frames.ts` (RIFF/VP8X/ANIM walk + real GIF block walk,
  magic-based so a renamed file still warns), `warnings` threaded worker-protocol →
  `ProcessedResult` → new `WarningMessage` in converter/compressor/resizer UIs; loss warnings
  attach only to re-encoded outputs (a never-grow original keeps all frames, so it carries no
  warning). Programmatic animated WebP + GIF fixtures, `frames.spec.ts` green in Chromium AND
  WebKit. DEFERRED pending owner call: "all frames as ZIP" mode (jszip ready); animated AVIF
  still converts frame 0 silently — detection needs ISOBMFF parsing, recorded not built.)*
- [x] **Fix: multi-page TIFF page-0 bug.** *(2026-08-31: warns "This TIFF has N pages — only
  the first page was kept."; decode restructured into an exported page-count + decode-any-page
  API in `image-convert.ts` so Wave 1 `tiff-to-pdf` can decode ALL pages; 3-page fixture built
  via `UTIF.encode` multi-IFD + e2e in both browser projects. ZIP-of-pages deferred with the
  same owner call as above.)*
- [x] **Fix: CLAUDE.md stale FFmpeg-CDN paragraph** (say: vendored via `copy:wasm`, no CDN,
  `forbidCdnCore` guards it). *(2026-08-31: rewritten to match `ffmpeg-loader.ts` — self-hosted
  ~31 MB core from the `@ffmpeg/core` devDependency, gitignored copies, `forbidCdnCore` guard.)*
- [x] **Fix: `compress-video`/`webm-to-mp4` raw internal error on Safari/Firefox** — show the
  friendly "needs WebCodecs" guard (carried from the 2026-08-19 audit; Wave 3 multiplies the
  number of pages hitting this path). *(2026-08-31: shared leaf `lib/utils/webcodecs-support.ts`
  predicate + message naming WebCodecs; pre-flight banner + disabled primary in both UIs
  (no-setState-in-effect, `useIsClient`); the real raw-error path was modern Firefox — has
  `AudioEncoder`, can't AAC — closed by an `isConfigSupported` probe that now runs BEFORE the
  video encode (fails in seconds, not minutes) with the identical config later given to
  `configure`. Predicate is encode-specific on purpose: `video-to-gif` needs only rVFC and stays
  ungated. DEFERRED owner call: video-only MP4 fallback when H.264 works but AAC doesn't.)*

### Wave 0 addendum — 2026-08-31 delegated decisions (owner said "do whatever you think is best"; each is revisitable)

- **Frames/pages ZIP:** warn-only STANDS for Waves 0–1. ZIP-of-frames lands with the Wave 4 GIF
  cluster (where `split-gif` = frames→ZIP anyway and decode infra is shared); multi-page TIFF's
  real answer is Wave 1 `tiff-to-pdf` (decode-any-page API already built). No ZIP mode bolted
  onto the converters before then.
- **AAC-less browsers (Firefox):** the fast friendly error STANDS. A silent video-only MP4 is
  exactly the silent-loss class Wave 0 purged. When Wave 3's `mute-video` ships, point the error
  copy at it as the explicit "convert without audio" path.
- **`compress-image` accepts `.gif` now** (aligns with resize-image; the animated warning becomes
  reachable there; registry copy updated honestly).
- **Animation category:** open as the 6th category WHEN the Wave 4 GIF cluster ships, not before.
  Archive tools file under developer until the category has ≥5 real pages.
- **Wave 5 go/no-go (background-remover, Whisper):** decided AT BUILD TIME, not now — the model /
  license landscape moves too fast for a quarter-ahead paper decision to stay true. The gates
  checklists in the Wave 5 items are the decision criteria when the time comes.
- **i18n:** deferred until after Wave 2 — translating 60 tools' copy that Waves 1–2 will churn is
  double work; revisit with real Search Console geo data in hand.
- **`crop-image`:** stays PNG-only until the Wave 4 image-edit-verbs cluster adds a shared format
  picker; its copy must keep saying PNG plainly.
- **GA4 goes cookieless** (`client_storage: 'none'`): makes the no-cookies claim true in-product;
  accepted cost: user-count continuity resets.
- **Beta badge:** comes off with this change set — the redesign is live and every gate is green;
  "beta" now communicates an instability that does not exist.
- **FAQ pass (~90 entries / 45 thin tools):** DONE 2026-08-31. The carried premise was stale —
  every tool already had ≥3 entries; the real gap was the 45 tools sitting at 3. Each got 2 new
  code-grounded entries (90 total; every factual claim verified against the implementation by an
  honesty reviewer, then a voice/dedupe pass across the whole set). All 67 tools now have 4–5
  entries plus the standing privacy FAQ. Gates: unit 1703, default e2e 231/231.
- **Licensing posture (MuPDF AGPL / FFmpeg-with-x264 GPL / libheif LGPL):** drafted analysis in
  `licensing-posture.md` at the repo root — owner signs off before Wave 2 builds past the
  security trio.

---

## Wave 1 — naming/alias layer (near-zero new engine code; ~days)

Engines exist; the queries don't resolve to them. Every page below needs genuinely
format-specific copy (per Wave 0 architecture decision), a registry entry in `tools.ts`
(auto-covered by `all-tools.spec.ts`), and a conversion-suite fixture where bytes change.

> **Wave 1 LANDED 2026-08-31** (uncommitted, awaiting owner review): 16 new tool pages
> (83 total, well under the 120 cap) + `/all-tools`; GIF aliases skipped with reasons
> (see item). Built multi-agent: 4 scout → 4 implementation → integrator → 6-finder/
> 3-refuter adversarial review, which confirmed 5 defects — all fixed (TIFF per-page
> memory retention in `openTiff`, png-to-pdf 16-bit "lossless" overclaim → qualified copy
> + new byte-sniffed warning, object-URL leak on unmount mid-prep, pdf-to-jpg-family
> how-to steps promising controls that don't exist ×2). Gates: tsc clean · lint 0 err /
> 2 standing warnings · unit 1908 · conversion e2e 153/153 + 2 designed skips (both
> projects) · default e2e 249/249. Side discovery: the Wave-0 FAQ top-up had silently
> broken 5 e2e locators (FAQ copy quoting UI strings → strict-mode collisions; the
> conversion suite was never re-run after that pass) — fixed by scoping the locators to
> `[data-tool-surface]`/anchored names, product behavior was always correct.

- [x] **Image→PDF format children** over the existing `imagesToPdf()` engine:
  `jpg-to-pdf`, `png-to-pdf` (transparency note), `heic-to-pdf` (iPhone angle),
  `webp-to-pdf`, `tiff-to-pdf` (multi-page → multi-page, after the Wave 0 TIFF fix).
  *(2026-08-31: all five shipped. New main-thread prep leaf `images-to-pdf-prep.ts` —
  byte-sniffed routing: JPEG/PNG pass through byte-for-byte; TIFF decodes EVERY page via
  `openTiff` (one at a time — `openTiff.page()` now drops utif2's memoized native bitmap
  after each page, found by the adversarial review: the closure otherwise retained ALL
  pages' bitmaps, ~780 MB for a 30-page color scan); WebP/HEIC decode via
  `toDecodableSource` then re-encode PNG-if-transparent / JPEG-q0.92-if-opaque. Prep runs
  at ADD time so page counts + animated/16-bit warnings land on the strip before Create
  PDF; `ImagesToPdfUI` takes `acceptFormats` from the registry; parent `images-to-pdf`
  widened to the 8-ext family and ceded "jpg to pdf"/"png to pdf" keywords to the
  children. png-to-pdf copy qualified after review: 16-bit PNGs are truncated to 8-bit by
  pdf-lib, so "lossless" is claimed for 8-bit only and a byte-sniffed warning discloses
  the reduction. tiff-to-pdf byte-level e2e (3-page TIFF → assertPdf pages:3) green in
  BOTH conversion projects; heic-to-pdf has no Node-buildable fixture — page-smoke via the
  all-tools sweep only, shared decode path covered by the webp specs.)*
- [x] **PDF→image children** over `pdf-to-jpg`'s renderer: `pdf-to-png` (one `toBlob` argument),
  `pdf-to-webp`. *(2026-08-31: shipped. `pdfToImages` format union widened to webp;
  `PdfToJpgUI` gained `defaultFormat` (seeded from registry `targetFormat`) + a WEBP
  toggle; quality slider covers both lossy formats. The Safari trap is guarded by BYTES,
  not `blob.type` — the worker stamps the REQUESTED mime onto the returned buffer, so
  after Safari's silent PNG fallback the blob lies; pdf-engine now sniffs the RIFF/WEBP
  container on page 1 and fails fast with a friendly "use PDF to PNG or Chrome/Edge"
  error. E2E branches on in-page encode capability: Chromium asserts real WebP bytes per
  ZIP entry, WebKit asserts the honest refusal. Parent ceded "pdf to png" keyword. The
  shared pdf-to-jpg how-to steps were rewritten (review finding): the old step promised a
  page-selection control that never existed and a JPG-only quality slider that is absent
  on the PNG child — now format-neutral and true on all three pages.)*
- [x] **GIF aliases** over `video-to-gif`: `mp4-to-gif`, `webm-to-gif`, `mov-to-gif`
  (canonical → the engine page unless copy is truly distinct).
  *(2026-08-31: SKIPPED — not built, not even as canonical stubs. Applying the Wave-0
  gates honestly: the intent of "mp4 to gif" IS video-to-gif's job (gate 1 fails), the
  copy would be the engine page's copy with the container name swapped (gate 2 fails),
  and the only default that could differ — a narrower accept list — adds nothing when
  `video-to-gif` already accepts `.mp4,.webm,.mov` and holds "mp4 to gif" in its
  keywords. A canonicalized page passes no ranking signal worth the crawl budget, and
  building the alias-canonical machinery (registry field + metadata/og/JSON-LD/sitemap
  exclusions) for pages with zero user value is complexity without a customer.
  OWNER ACCEPTED 2026-08-31: the skip is final — no standing question. Revisit is
  policy-automatic, not a decision: only if Search Console ever shows "mp4/webm/mov to
  gif" impressions that /video-to-gif fails to serve, and then only through the full
  three-gate test like any other variant.)*
- [x] **KB-ladder extensions (compress phrasing — engine already honest):**
  `compress-image-to-20kb`, `-50kb`, `-500kb`, and a free-input `compress-image-to-target-size`.
  *(2026-08-31: shipped as pure registry data over `defaultTargetSizeKb` — zero new code,
  exactly the compress-image-to-100kb mechanism. target-size preloads 200 KB and its copy
  says so ("just the preloaded default"). FAQ fact families rotated across siblings per
  the house precedent; e2e proves the preset wiring end-to-end: /compress-image-to-50kb
  preselects target-size mode with 50 in the field and lands ≤ 50 KB.)*
- [x] **KB-ladder "resize" phrasing — DONE; box ticked 2026-09-10.** Both halves shipped and
  are annotated below: the engine (dimension-stepping in `target-size.ts`) on 2026-08-31, and
  all four pages the same day. Verified in the registry: `resize-image-to-20kb`, `-50kb`,
  `-100kb` and `photo-resizer-in-kb` are all present.
  ORIGINAL ITEM: add dimension-stepping to the
  worker's target-size search (scale down when quality floor still misses target), THEN ship
  `resize-image-to-20kb`, `-50kb`, `-100kb`, `photo-resizer-in-kb`. Without the engine change
  these pages make the exact false promise Phase 8 removed from the compressor variants.
  *(2026-08-31: the ENGINE half landed in Wave 0 — shared leaf `lib/tools/target-size.ts`
  policy (sqrt-heuristic steps clamped [0.5,0.9], 64-px floor, max 6 steps) mirrored in both
  pipelines, "Scaled to W×H" disclosure via the warnings channel, degenerate ≤0 targets guarded,
  e2e proves a 4000×3000 photo actually lands ≤20 KB in Chromium and WebKit. The
  `compress-image-to-100kb/200kb` aboutTexts were rewritten to stop claiming dimensions are
  never touched. Only the PAGES remain, gated on the Wave-0 architecture decision.)*
  *(2026-08-31: PAGES SHIPPED — `resize-image-to-20kb`, `-50kb`, `-100kb`,
  `photo-resizer-in-kb` (default 100 KB — the exam/government-form cluster's most common
  ceiling), all toolType `image-compress` + `defaultTargetSizeKb`. Every one says plainly,
  in description AND aboutText AND a dedicated dimensions-FAQ, that quality drops first
  and dimensions step down in bounded stages only when needed, with the "Scaled to W×H"
  disclosure. Workspace rows keep the compressor's true `IMG → JPG · WEBP` route, not
  resize-image's. E2E: /resize-image-to-20kb takes a 4000×3000 noise JPEG to ≤ 20 KB and
  shows the scaling disclosure, both browser projects.)*
- [x] **PDF size ladder** over `compress-pdf`: `compress-pdf-to-100kb`, `-200kb`, `-500kb`,
  `-1mb`. Hard requirement: text-heavy PDFs have a compression floor — **report the closest
  achievable size**, never silently overshoot. (Do after the Wave 2 compress-pdf upgrade so the
  ladder inherits the stronger engine.)
  *(**2026-09-02: EXECUTED as the decision below prescribed — `recompress-pdf-images` SHIPPED
  (89 → 90 tools). The four `-to-NNkb` variant pages were deliberately NOT built**; the KB target
  is a MODE of the one tool, not four doorway pages, and a variant layer over it is a cheap
  Wave-1-style follow-on if the queries justify it.
  What shipped: a DOM-free engine `lib/tools/pdf-image-core.ts` that takes the pixel work as an
  injected `recode` callback, its own DOM-capable pool worker `workers/pdf-image.worker.ts`
  (createImageBitmap + OffscreenCanvas + convertToBlob), a leaf protocol module, and a
  main-thread wrapper that — where neither Worker nor OffscreenCanvas exists — **throws** rather
  than no-opping. The injection is what makes the unit suite real: 14 tests drive the trap-dense
  PDF-rewriting half directly with a stub codec, which is genuine coverage rather than green-over-
  nothing, while the canvas half is covered by the conversion e2e.
  Verified by a real Node round-trip against installed pdf-lib, not by reading docs: on a fixture
  with 8 image XObjects, `/Width /Height /Length /ColorSpace /BitsPerComponent /Filter` all move
  TOGETHER on the replaced object and `/DecodeParms` + `/Decode` are absent from it; every skip
  class fires and the counts sum to `imagesFound`; **an XObject drawn on two pages is re-encoded
  exactly once** (iteration is over indirect objects, not pages); the per-image never-grow guard
  leaves the stream byte-identical; a 20 KB target is met in 6 passes and the output re-parses as
  a 4-page `%PDF-`; an unreachable target returns the smallest build with `targetMet: false` and
  does not throw.
  **Deliberate v1 non-goal, recorded so it is not mistaken for an oversight: NO DPI-AWARENESS.**
  The trap note says effective DPI comes from the on-page CTM, which needs a content-stream
  `q`/`Q`/`cm`/`Do` operator parse. v1 scales by a uniform factor instead, so no copy anywhere is
  allowed to say "DPI" — the blog post's old "resample to 150/300 DPI" teaching was rewritten for
  the same reason. Also skipped by design, each COUNTED and NAMED on screen: /SMask or /Mask in
  either direction, non-DCTDecode filters, /DecodeParms, /Decode arrays, anything outside
  DeviceRGB/DeviceGray (**DeviceCMYK is refused, not guessed at** — createImageBitmap's handling
  of Adobe-APP14 inverted CMYK is unverified across engines), and BitsPerComponent ≠ 8.
  **A finding worth carrying into Wave 3: Safari's JPEG encoder is roughly 2× less aggressive
  than Chromium's at the same quality number.** On the checked-in fixture the `high` preset (0.75)
  re-encodes an already-q0.9 photo to 58,847 B against a 54,591 B source, so on WebKit the
  never-grow guard fires and the user honestly gets their original bytes back plus "NOTHING IN
  THIS PDF COULD BE RE-ENCODED". The e2e therefore never runs the high preset and says why —
  a later high-preset case would pass on Chromium and fail on WebKit.
  **The adversarial review's headline find — a NEW trap for this repo's list, and the one worth
  carrying forward: `createImageBitmap` APPLIES EXIF Orientation, and a PDF reader does not.**
  A reader never looks at EXIF inside a `/DCTDecode` stream — the image IS the `/Width` × `/Height`
  sample grid, placed by the content stream's CTM. So re-encoding what the decoder hands back
  writes rotated or mirrored samples into a dictionary that still describes the original grid, and
  for Orientations 5–8 the bitmap comes back TRANSPOSED, so `/Width` and `/Height` get swapped
  while the `cm` matrix does not — the photo is drawn turned 90° AND stretched to the wrong aspect
  ratio. Orientation 3 is quieter and worse: same dimensions, page simply upside down. In every
  case the engine reported a clean success with nothing skipped. This is reachable in production
  by the ordinary path, not a corner: a phone photo routinely carries a non-1 orientation and
  "JPG to PDF" tools embed the original bytes verbatim. The checked-in `sample-photo-portrait.jpg`
  is Orientation 6.
  Measured directly in this repo's own dev server (Chromium): a 400 × 200 JPEG carrying
  Orientation 6 decodes to a **200 × 400** bitmap with the corner marker displaced; after the tag
  is rewritten it decodes to **400 × 200** with the marker back in place. **`imageOrientation:
  "none"` does NOT suppress it** — the current spec defines only `"from-image"` and `"flipY"`, so
  `"none"` is invalid, is ignored, and leaves the honour-EXIF default in force. Two refuters
  reproduced that independently in WebKit and Firefox too.
  Fixed in `lib/tools/jpeg-orientation.ts`: rewrite the Orientation tag to 1 in the bytes BEFORE
  the decoder sees them, rather than undoing the rotation with a canvas transform (eight cases,
  half of them not self-inverse, all easy to get subtly wrong). A TIFF SHORT lives in the first
  two bytes of the 4-byte value field, so the segment length never moves and no other offset is
  disturbed. An orientation outside 1–8 returns null and the image is skipped rather than guessed
  at. Note `image.worker.ts` deliberately passes `imageOrientation: "from-image"` for STANDALONE
  images, where honouring EXIF is correct — inside a PDF it is the exact opposite. The two must
  not be "made consistent".
  **Review shape:** 8 dimension finders → 42 candidate findings → 3 refuters each (126 verdicts,
  majority-refuted dropped) → 7 confirmed, all fixed. The engine, worker, registry and robustness
  dimensions came back nearly clean; everything confirmed was in the UI's state machine, the
  copy, the test coverage, and — three of them — in the build scripts written this session. Two of
  those were unfalsifiable licensing gates: `strings BIG.wasm | grep -q PATTERN` under
  `set -o pipefail` gives grep an early exit, `strings` a SIGPIPE, and the pipeline a status of
  141, so an `if` around it takes the ELSE branch and announces "no GPL flag found" **on a binary
  that contains one**. Reproduced on a 5 MB file with an early match. Both gates now read the
  strings into a variable once, and both were proven to fire.
  Two pre-existing copy lies were found and fixed while building, which is now the pattern:
  `HOW_TO_STEPS_BY_TOOL_TYPE["compress-pdf"]` step 2 promised "Pick a compression level" on a tool
  that ships **no controls at all** and renders those steps as visible copy; and
  `reduce-pdf-file-size-for-email.mdx` still told readers image re-encoding "is harder to automate
  cleanly in a browser-based tool" and routed them through a text-layer-destroying
  pdf-to-jpg → images-to-pdf workaround.)*
  *(2026-09-02: **NOT BUILT — measured NO-GO on the shipped engine. STANDING OWNER QUESTION.**
  The item's premise was a compressor with image downsampling. What shipped in Wave 2 is
  structural only — mark-and-sweep GC, a `CompressionStream("deflate")` pass over streams that
  arrived with NO `/Filter`, and an object-stream rewrite. It never re-encodes or downsamples
  images and has no quality knob, and `deflateRawStreams` skips every stream that already
  declares a `/Filter` (pdf-engine-core.ts:633) — which is every DCTDecode and every Flate image
  in a real document. Image XObjects are **99.4–99.98%** of a photo PDF's bytes, so there is
  nothing left to move. Measured twice, independently, through the shipped `compressPdf`:
  a 4.74 MB 6-page photo PDF → **−0.031%** (1,486 bytes); an 18.7 MB photo PDF → **−0.008%**
  (1,511 bytes, i.e. 1.0001× against the 182.8× that 100 KB would need); a 16 MB scan →
  −0.006%; macOS sips/Quartz photo PDFs → −0.023%. 100 KB / 200 KB / 500 KB / 1 MB are all
  unreachable by three to four orders of magnitude. A ladder page over this engine fails on the
  first photo PDF a user drops on it and contradicts live copy (tools.ts "The compression is
  lossless").
  The engine is not bad — it is honest and fast (1–27 ms), and its structural wins are real and
  large: −83.1% on a document with undeflated streams, −50.0% on one carrying orphaned objects,
  −97.0% on a filterless raw image, −38.8% on a plain-xref text PDF. Keep it, keep its copy.
  **The honest path to a ladder is a SEPARATE, explicitly lossy tool**, and it is feasible:
  replacing the DCTDecode XObjects in that same 4.74 MB file reaches 1.47 MB at q75, 654 KB at
  q50, 351 KB at 0.75×/q60, **107 KB at 0.5×/q60** and 28 KB at 0.25×/q45, in 47–112 ms per
  full-document rebuild. pdf-lib 1.17.1 exposes everything needed (`PDFDocument.context`,
  `enumerateIndirectObjects`, `context.assign`, `PDFRawStream.of` — the replacement was performed
  against the installed build, not read from docs), and the binary-search-plus-dimension-stepping
  policy already exists in `image.worker.ts` + `target-size.ts`. Scope: a DCTDecode-only v1
  (skip any image with `/SMask`, `/Mask`, `/DecodeParms`, a non-Device colour space, or
  BitsPerComponent ≠ 8, and report how many were skipped) ≈ 1–1.5 weeks and covers most consumer
  photo PDFs; full coverage (SMask resampling, Indexed/ICCBased/Separation flattening, CMYK,
  1/16-bpc, effective-DPI-aware scaling, shared-XObject dedup) ≈ 3–4 weeks and pulls in decoder
  mass — openjpeg.wasm at 250 KB for JPX, which no browser can decode — that the MuPDF removal
  was specifically meant to shed. **Owner decides: v1 lossy tool, or drop the ladder.**)*
  *(**DECIDED 2026-09-02: build the LOSSY v1 as a SEPARATE tool.** `compress-pdf` stays exactly
  as it is — lossless, structural, honestly named — and the ladder does NOT go on it. The new
  tool re-encodes images and its copy must say so in the first sentence, everywhere.
  **v1 scope, deliberately narrow:** walk image XObjects; handle `/DCTDecode` only; decode,
  re-encode at a lower quality/scale, replace the object via `context.assign` +
  `PDFRawStream.of`. SKIP (and COUNT, and REPORT on screen) any image with `/SMask`, `/Mask`,
  `/DecodeParms`, a non-Device colour space, or `BitsPerComponent !== 8`. Reuse the existing
  target-size policy — `lib/tools/target-size.ts` + the binary-search-then-dimension-step loop in
  `image.worker.ts` — rather than inventing a second one, and reuse its "Scaled to W×H"
  disclosure. Report the CLOSEST ACHIEVABLE size and never silently overshoot; a file whose
  images are all skipped must say the target could not be met and why.
  **Architecture constraint that decides where the code lives:** `pdf-engine-core.ts` is DOM-free
  by contract (it runs in `pdf.worker.ts` AND inline under jsdom), and `createImageBitmap` /
  `OffscreenCanvas` do not exist on the jsdom inline path. So the image pass CANNOT go in the
  core as-is — it needs its own DOM-capable worker, or a capability check with a documented
  no-op fallback. A silent no-op would make the unit suite green over an engine that never ran;
  do not take that route.
  **Traps carried from the measurement pass:** when replacing a `/FlateDecode` image's bytes with
  JPEG bytes you must DELETE `/DecodeParms` as well as fix `/Filter`, `/Width`, `/Height`,
  `/Length`, `/BitsPerComponent`, `/ColorSpace` and any `/Decode` array; a canvas round-trip
  normalises to sRGB so Indexed/Separation/DeviceN/ICCBased must be rewritten to DeviceRGB;
  an image referenced by several pages must be replaced ONCE and sized for its largest on-page
  rendered size; and effective DPI comes from the on-page CTM, not the page box. Full coverage
  (SMask resampling, CMYK, 1/16-bpc, JPX via openjpeg.wasm) is explicitly NOT v1.)*
- [x] `pdf-resizer` as a genuine dual-purpose page (file size + page dimensions via
  `setPageBox`), not a synonym doorway.
  *(2026-09-02: shipped as a real two-mode page, not a doorway. A "What to resize" switch picks
  **Page size** (→ the new `changePdfPageSize`, sharing `PdfPageSizeTool` with
  `change-pdf-page-size` rather than forking it) or **File size** (→ the existing structural
  `compressPdf`). Both halves work on one dropped file — switching modes keeps the PDF and drops
  only that half's settings and output. The file-size copy states outright that the compressor is
  structural, never re-encodes images, has no target-size mode, and barely moves photo-heavy
  PDFs; it deliberately does NOT offer a KB field, because the measurements above say it could
  not honour one. Note the engine is `changePdfPageSize`, not the `setPageBox` this item
  imagined — see the Wave 2 page-ops entry for why the page boxes alone are not enough.)*
- [x] `jfif-to-jpg` — `.jfif` is Windows-saved JPEG; the "conversion" is a rename/re-wrap.
  Trivial and weirdly high-demand; the validators that reject `.jfif` are the demand source.
  *(2026-08-31: shipped as a NEW toolType with a slim UI — verifies the JPEG SOI bytes,
  returns the IDENTICAL bytes as image/jpeg named `.jpg`; no canvas, no re-encode, EXIF
  untouched, "BYTES CHANGED: 0" stat on screen. Copy says outright that renaming the file
  yourself does the same thing. Workspace engine label "BYTE COPY". E2E asserts the
  download equals the input buffer byte-for-byte in both projects, plus a PNG-in-.jfif
  rejection path; 12 jsdom unit tests on the byte logic.)*
- [x] **`/all-tools` index** (the Wave-0 architecture decision's crawlable index).
  *(2026-08-31: `src/app/all-tools/page.tsx` — server component, registry-driven groups
  per category, one link per tool with its hubLine, derived counts only; footer "All
  tools" link on every page, sitemap entry, self-canonical. The responsive-sweep ROUTES
  arithmetic includes it, and a new meta spec asserts exactly `tools.length` tool links.)*
- [ ] **Post-deploy verification — 2 of 3 CLOSED LOCALLY 2026-09-01; only Search Console is
  genuinely deploy-blocked.** `master` is one commit ahead of `origin/master` (Wave 0+1 is
  committed at `c828b0b` but NOT pushed), so transmute.tools still serves the **67-tool**
  build. That blocks less than it first appeared:
  - **(2) Lighthouse CLS — DONE, no deploy needed.** CLS is a layout metric and measures fine
    against the built `out/`. Measured at a 375x812 mobile viewport with a full-page scroll
    (shifts below the fold count), on the real static export: home **0.0001**, a Wave-1
    variant (`/compress-image-to-20kb`) **0.0000**, `/all-tools` **0.0000**, the new
    `/licenses` **0.0000**. The <= 0.1 gate holds with three orders of magnitude to spare.
    Home LCP stays the known separate item — that one IS network-sensitive and worth a real
    run post-deploy.
  - **(3) /all-tools crawlability — DONE, no deploy needed.** Verified in the built output:
    present in `sitemap.xml`, self-canonical to `https://transmute.tools/all-tools`, no
    `robots` meta (so indexable), linked from the footer on every page, and `robots.txt` is
    `Allow: /`. Nothing in the configuration can stop a crawler. Whether Google HAS crawled
    it is the only part that needs the deploy.
  - **(1) Search Console — genuinely blocked.** Doorway-style demotion signals on the 16
    variant pages need Google to crawl the live pages and accumulate impressions, which is
    days-to-weeks of real-world data that cannot be synthesised. Re-check after the push.
    Rollback lever unchanged: canonicalize variants back to their engine page.
  *(Original wording, kept for the record:)* **(FIRST THING in the next session's preflight,
  once the owner has committed and CI has deployed Wave 1):** (1) Search Console — look for
  doorway-style demotion signals on the 16 variant pages; the rollback lever is
  canonicalizing variants back to their engine page. (2) Re-run Lighthouse (mobile)
  on home + one variant page — CLS must hold ≤ 0.1 (the reservation map covers all 83
  tools); the home LCP 4.8 s item from the Wave-0 audit is still open and separate.
  (3) Confirm /all-tools is indexed/crawled.

---

## Wave 2 — the MuPDF harvest (~20 pages, zero new bytes; weeks 2–4)

> **REVISED 2026-08-31 — OWNER DECISION: repo stays private, app stays closed-source.**
> The MuPDF harvest as planned below is OFF: shipping AGPL MuPDF in a closed app is
> non-compliant TODAY (see `licensing-posture.md`, rewritten for the closed posture with
> the 2026-08-31 dependency audits). **The next wave is licensing remediation + the
> permissive PDF ports:**
>
> **WAVE 2 LANDED 2026-08-31** (uncommitted, awaiting owner review). Built multi-agent:
> 6 scouts → 3 implementation agents on disjoint file sets (one killed by a content
> filter for reproducing licence text; re-run split in two with the texts pre-generated)
> → orchestrator integration → a 6-finder / 3-refuter-per-finding adversarial review over
> the full diff (81 agents). Gates: tsc clean · lint 0 err / 2 standing warnings ·
> unit **1910** pass (75 files, 83 pre-existing `describe.skip`) · conversion e2e 153 pass
> + 2 designed skips in BOTH projects · default e2e 250 pass · `npm run build` succeeds and
> the output is verifiably AGPL-free · a real merge driven through the BUILT static export
> returns the right pages, carries the first document's title, and issues no mupdf request.
>
> **The review found 25 candidates; 14 survived three refuters and ALL were fixed.** The six
> that mattered, each now covered by a regression test proven to fail without its fix:
> 1. **compress corrupted images carrying a stale `/DecodeParms`.** The deflate pass checked
>    only for `/Filter`. A `/DecodeParms << /Predictor 12 … >>` left behind by a tool that
>    stripped the filter but not its parameters is inert *until* something writes
>    `/FlateDecode` beside it — then a conforming reader applies PNG un-filtering to bytes
>    that were never predictor-coded. Reproduced against pdfjs: the image failed to decode
>    and was dropped from the page, under copy promising the pixels come out byte-identical.
>    Such streams are now left exactly as found.
> 2. **The vendor-loader retry was inert.** Clearing the memo is NOT enough: a browser
>    records a failed module fetch in the realm's module map, and re-importing the same
>    specifier rejects without touching the network. Measured in Chromium and WebKit — the
>    same-URL retry made no request at all. Retries now carry a `?retry=N` cache-buster; the
>    base `/vendor/x.js` URL, which is what the LGPL replaceability argument rests on, is
>    unchanged.
> 3. **add-page-numbers stamped off-page on a reversed-corner MediaBox.** `[0 792 612 0]` is
>    a legal spelling (PDF 32000-1 7.9.5, readers must normalise); pdf-lib reports the raw
>    numbers, so the number landed 20pt above the top edge. The rect is normalised now.
> 4. **copyPages left an orphan page object behind every annotation's `/P`.** Split/merge/
>    reorder produced twice as many `/Type /Page` objects as pages — renders fine, fails
>    preflight and PDF/A. `/P` is repointed at the real page and the sweep collects the
>    duplicate.
> 5. **The compress footnote lied on the equal-size case,** which is now the ORDINARY no-win
>    outcome (MuPDF used to genuinely inflate; pdf-lib does not). It said "would make it
>    larger — your original is already smaller" while the readout above it showed two
>    identical numbers. Split into the two real outcomes.
> 6. **/licenses overstated its own coverage.** The generated notices walked only DIRECT
>    dependencies while the page claimed a superset of what the browser receives — pako and
>    `@pdf-lib/standard-fonts` execute in the tab and had no notice. The generator is now
>    transitive (239 of 245 runtime packages, the 6 that publish no licence file named by
>    hand on the page), typefaces get per-face copyright lines instead of one font's OFL
>    file standing in for six, and a new unit test regenerates and diffs so the page's
>    "cannot quietly drift" claim is now enforced rather than asserted.
>
> - [x] **Remove MuPDF** (one import site: `pdf-engine-core.ts`; 10 MB wasm + AGPL glue
>   chunk out of `public/`): port its 7 ops to pdf-lib — merge/split/reorder via
>   `copyPages`, rotate via `setRotation` (native inherited-/Rotate handling),
>   page counts, add-page-numbers via `StandardFonts.Helvetica` +
>   `widthOfTextAtSize` (port the rotation-compensation matrix,
>   pdf-engine-core.ts:250–281). Rewrite `pdf-engine.test.ts` against real pdf-lib
>   (mupdf-mock harness today); retune `golden-paths.spec.ts:102`.
>   *(2026-08-31: done. The `mupdf` dependency is uninstalled, `public/mupdf-wasm.wasm`
>   is gone, and the `module`/`node:fs` → `empty-module.js` aliases in `next.config.ts`
>   and `build-workers.mjs` went with it — verified those two aliases existed ONLY for
>   mupdf's glue (`mupdf-wasm.js:1` `import("module")`, `mupdf.js:26` `import("node:fs")`;
>   nothing else in the dependency set imports either), so `empty-module.js` is deleted
>   and `next.config.ts` has no `turbopack` block at all now.
>   Findings that changed the plan, each proven not guessed: `updateMetadata:false` is a
>   pdf-lib **Load**Option, not a SaveOption (it stamps /Producer + /ModDate at load);
>   `addDefaultPage` defaults TRUE, so `splitPdf(data, [])` would have invented a blank
>   page — every op deriving from a user file now passes `addDefaultPage:false`;
>   pdf-lib 1.17.1 is ES5-compiled so `err instanceof EncryptedPDFError` is ALWAYS false
>   (tslib `__extends` over native Error) — error matching is on message text, with a
>   comment saying not to "fix" it; and `page.drawText()` emits `Tm`, which would have
>   broken `pdf.spec.ts:291`'s literal `/418\.\d+ 20 Td/`, so the stamp is composed from
>   pdf-lib's low-level ops (`beginText`/`setFontAndSize`/`moveText`/`showText`/`endText`)
>   and the emitted operator bytes stay parity-identical with MuPDF's. `golden-paths.spec.ts`
>   needed NO retune. `resolveInherited()` is deleted — `page.getRotation()` is already
>   inheritance-aware — and the manual /Resources+/Font plumbing went too, because
>   pdf-lib's `PDFPageLeaf.normalize()` does both natively. `pdf-engine.test.ts` is now
>   83 REAL round-trip tests (build a PDF, run the op, reparse, assert document state)
>   in place of 971 lines of mock-shape assertions.)*
> - [x] **compress-pdf**: qpdf-wasm spike (qpdf is Apache-2.0 — verify the wasm
>   package's own license) for GC/recompress + repair + encrypt/decrypt; fallback is
>   pdf-lib `useObjectStreams` with honestly weakened copy (never-grow already holds).
>   *(2026-08-31: **no qpdf needed, and the copy got STRONGER, not weaker** — the premise
>   that pdf-lib is the weaker engine was measured and is false. MuPDF saved with
>   `"compress,garbage"`, which writes a plain xref table and NO object streams, so it
>   INFLATED already-optimised PDFs by 74–88%; the never-grow guard was hiding that.
>   The replacement is three passes in `pdf-engine-core.ts`: a real mark-and-sweep GC over
>   `PDFContext` (roots = trailer Root/Info/Encrypt/ID), a re-deflate of streams that
>   arrived with NO /Filter using the platform's own `CompressionStream("deflate")`
>   (zlib format, magic 78 9c — zero added bytes), then `save({useObjectStreams:true})`.
>   Measured through the shipped function: already-optimal 0.0% (byte-identical) vs
>   MuPDF −74%/−88%; uncompressed-streams 83.8% vs 83.5%; plain-xref 50.5% vs 7.3%;
>   orphan-heavy 73.7%. It matches or beats MuPDF on every corpus tested. The GC is
>   mark-and-sweep, NOT a `copyPages` rebuild, so form field values, checkbox state,
>   outlines, page labels, named destinations, annotations and /Info all survive —
>   each covered by its own unit test. qpdf remains an OPEN OWNER QUESTION for
>   protect/unlock/repair only; see the standing question below.)*
> - [x] **lamejs LGPL cure**: vendor `dist/lamejs.js` → `public/vendor/` (copy:wasm
>   step), runtime `import()` of the stable URL (non-analyzable specifier so no
>   bundler inlines it); cures the worker bundle + both Next client chunks at once.
>   *(2026-08-31: done. `encodePcmToMp3` is async now; both shipped callers were already
>   async. THE SPECIFIER TRAP IS REAL: esbuild `define`s `__NEXT_ROUTER_BASEPATH` to `""`,
>   so a bare template literal folds to a resolvable literal and gets inlined straight
>   back — the specifier goes through a `vendorUrl(name)` function call, and the emitted
>   bundle shows `import(k("lamejs.js"))`, unfolded. `audio-encode.worker.js` went
>   171 005 B → 2 117 B (−98.8%) with zero lamejs fingerprints. Proven in a real browser,
>   not assumed: the BUILT worker loaded in a same-origin `{type:"module"}` Worker encoded
>   1 s of 44.1 kHz stereo to a real MP3 (frame sync `FF FB`), with exactly one
>   `/vendor/lamejs.js` request in the network log.)*
> - [x] **heic2any LGPL cure (found 2026-08-31: it embeds libheif/libde265 TODAY)**:
>   same `/vendor/` treatment for its 1.35 MB chunk.
>   *(2026-08-31: done. GOTCHA worth keeping: heic2any's dist is UMD, and executed as an
>   ES module its namespace comes back EMPTY — `default` is undefined. Its UMD fallback
>   branch `(global = global || self, global.heic2any = factory())` fires instead, so the
>   loader awaits the import for its SIDE EFFECT and reads `globalThis.heic2any`, throwing
>   a clear error if absent. Verified in both Chromium and WebKit. Behaviour unchanged:
>   main-thread decode, PNG out, same warnings; `image-convert.ts` is still unreachable
>   from every worker entrypoint.)*
> - [x] **/licenses page** (`src/app/licenses/page.tsx` mirroring privacy; footer
>   SITE_LINKS + sitemap): full inventory incl. FFmpeg GPL source offer (core 0.12.10,
>   release tag, configure line, static libs, credit line), lamejs/libheif/libde265
>   LGPL notices + replaceable-file pointers, exifreader MPL, pdfjs Apache text,
>   jszip-elect-MIT, dompurify-elect-Apache, diff BSD-3, pako, OFL fonts. Texts as
>   `public/licenses/*.txt`.
>   *(2026-08-31: shipped, 7 sections + footer link + sitemap + responsive-sweep ROUTES
>   (+1, arithmetic guard updated) + a `static-pages.spec.ts` case that asserts the exact
>   FFmpeg credit line, real HTTP 200s for the linked `.txt` files, and that the page
>   contains no `/mupdf/i`. The configure line is reproduced VERBATIM from `strings` on
>   the shipped `ffmpeg-core.wasm`, not from memory; the source offer pins FFmpeg
>   **n5.1.4** from the `v0.12.10` Dockerfile rather than a vague "5.1 line".
>   `public/licenses/third-party-notices.txt` is GENERATED by the new
>   `scripts/generate-license-notices.mjs` — it reproduces each installed dependency's own
>   licence file verbatim (31 of 33) and PRINTS the ones that ship none, which today is
>   `@ffmpeg/ffmpeg` and `@ffmpeg/util` (both MIT, covered by hand on the page). Re-run it
>   after ANY dependency change. One correctness fix made during integration: a shared
>   `mit.txt` was being linked for jszip/mp4-muxer/heic2any, i.e. pdf-lib's copyright line
>   presented as theirs — those now point at the generated per-package notices and the
>   misattributed file is deleted.)*
> - [x] **Copy consistency sweep with MuPDF removal**: homepage ENGINES table +
>   LiveEngine + CompressPdfUI badge + about + privacy + six `MUPDF WASM` workspace
>   rows + `how-to-merge-pdfs-in-browser.mdx` + CLAUDE.md.
>   *(2026-08-31: done, plus the 16 extra sites the licensing-posture checklist missed.
>   Four pre-existing copy lies were found and fixed while sweeping, none of which were
>   about MuPDF: the homepage POPULAR line claimed compress-pdf "strips metadata and
>   deduplicates objects" (false under BOTH engines); `posts.ts` indexBlurb claimed
>   "image downsampling" (never true); the compress-pdf FAQs said metadata is stripped
>   while aboutText said it is carried through (the code carries it); and
>   `how-to-merge-pdfs-in-browser.mdx` promised bookmarks survive a merge (they never
>   did — MuPDF's graft dropped /Outlines too). LiveEngine's `~1.2 s / 100 p` was a MuPDF
>   measurement and was replaced with a re-measured claim. The homepage ENGINES table
>   loses the 10 MB MuPDF row and gains a lamejs row, because lamejs is now a real
>   runtime `/vendor/` fetch that "Web Audio · 0 KB · BUILT IN" was concealing. The
>   privacy page's "no third-party requests" sentence is UNTOUCHED and still true —
>   `/vendor/` is same-origin.)*
> - [x] **FFmpeg posture**: keep GPL core under the separate-program argument
>   (MIT wrapper worker, postMessage, CLI-shaped exec) + the /licenses source offer;
>   belt-and-braces spike later: custom LGPL core (`--disable-gpl` — nothing shipped
>   encodes via x264/x265; H.264 encode is WebCodecs).
>   *(2026-08-31: the /licenses half is shipped — credit line, verbatim configure line,
>   pinned source links, static-lib inventory. The LGPL-core spike is NOT done and is an
>   open owner question below.)*
>   *(**DECIDED 2026-09-02: DO the LGPL-core spike.** Reasoning, recorded so it is not
>   re-litigated: the separate-program posture is the WEAKEST of the three licensing threads,
>   because the argument that a WASM module loaded into the page and driven through a JS API is
>   an arm's-length separate program is genuinely contested — the FSF reading is dynamic linking,
>   i.e. one combined work, and the /licenses source offer does not cure that for a closed app
>   carrying ads. A `--disable-gpl` core removes the question rather than arguing it, and the
>   replaceability pattern it lands in (`/vendor/`, stable URL, runtime `import()`) is already
>   proven here twice, for lamejs and heic2any. Nothing shipped encodes via x264/x265 — H.264
>   encode is WebCodecs — so the functional delta should be nil; VERIFY that against the tool
>   list before believing it, and expect a smaller core as a side benefit.
>   Exit criteria: a core that passes the whole conversion suite in both browser projects, a
>   configure line reproducible from `strings` on the artifact we ship, and the /licenses page
>   rewritten from GPL-with-source-offer to LGPL-with-replaceability. If the spike fails, the
>   current posture stands and stays documented — it is a risk reduction, not a blocker.)*
>   *(**2026-09-02: the PREMISE IS NOW VERIFIED; the build is DEFERRED with a runnable recipe at
>   `scripts/build-ffmpeg-core-lgpl.sh`.** "Expect no functional delta — VERIFY that against the
>   actual tool list" is done, and the answer is a clean no-delta. The app issues exactly THREE
>   ffmpeg command lines: `video-trim.ts:48-55` passes `-c copy` (a stream copy, which pre-empts
>   every muxer default); `mp4-to-mp3.ts:36-41` passes `-vn` to an audio-only muxer, and the only
>   MP3 *encoder* in the binary is libmp3lame — there is no libshine; `audio-decode.ts:228` passes
>   an explicit `pcm_s16le` with `-f wav`. The "an .mp4 output with no `-c:v` silently defaults to
>   libx264" trap does NOT fire, because the only video-capable output is the trimmer's and it is a
>   stream copy. No filtergraph is ever built — `-vf`/`-af`/`-filter`/`-lavfi`/`-map` appear
>   nowhere in `src/`. H.264 *encoding* is WebCodecs (`compress-video`, `webm-to-mp4`), never
>   FFmpeg. The only `libx264`/`libx265` strings in `src/` are on the /licenses page describing the
>   build. So `--enable-gpl --enable-libx264 --enable-libx265` are the only three flags to drop.
>   **Why the build itself was deferred rather than run:** ffmpeg.wasm's build is Docker-only, its
>   pinned base image `emscripten/emsdk:3.1.40` is published for **linux/amd64 only**, and this is
>   an arm64 Mac — so it compiles 18 dependency libraries plus FFmpeg under emulation after a
>   ~622 MB image pull, with the Docker daemon not even running. Hours of machine time for a change
>   with zero functional delta, while the qpdf cluster was the greenlit work. The recipe carries the
>   four exit criteria and does the `strings`-based verification automatically.)*
>   *(**⚠⚠ 2026-09-05: THE PREMISE ABOVE IS FALSE, AND WAS ALREADY FALSE WHEN IT WAS WRITTEN DOWN
>   AS VERIFIED. The LGPL spike is no longer a zero-cost risk reduction — it is a product
>   trade-off, and that makes it an OWNER DECISION rather than a queued chore.**
>   Three facts, each verified twice this session (once by a scout, once by the orchestrator):
>   1. **The "no filtergraph is ever built" claim was a COMMENT, not a gate.**
>      `scripts/build-ffmpeg-core-lgpl.sh:33-35` asserted that `-vf`/`-af`/`-filter`/`-lavfi`/`-map`
>      appear nowhere in `src/`, and **nothing in that script ever read `src/`**. Its only `grep`
>      runs over the cloned ffmpeg.wasm tree. The claim could not fail, so it did not fail — it
>      rotted quietly for three days while the work that falsified it shipped. This is
>      `feedback_verification_gates_must_fail` in a new costume: not a gate that cannot fail, but a
>      claim with no gate behind it at all.
>   2. **`-map` already shipped in 4 production sites** (`audio-convert.ts:135`,
>      `extract-audio.ts:237/:266/:267`) with the 2026-09-04 audio matrix, and it is load-bearing
>      for correctness (see that item), so it cannot be deleted to restore the sentence.
>   3. **THE ONE THAT REVERSES THE CONCLUSION: `-c:v libx264` is a live argv today.**
>      `video-remux.ts:346` (`transcodeArgs`) builds it, and it is user-reachable from the
>      "Re-encode to H.264" toggle at `VideoRemuxUI.tsx:475-491` — shipped 2026-09-03 with the
>      remux cluster, on six container pages. So "the functional delta of dropping the GPL flags is
>      nil" is **false**: `--disable-gpl` would remove the HEVC→H.264 transcode arm, which is the
>      whole reason that toggle exists (an iPhone `.mov` that a naive remux leaves unplayable).
>      x265 is genuinely unused and safe to drop; x264 is not.
>   Also stale in the retired evidence: all three cited line ranges. `mp4-to-mp3.ts` is 28 lines and
>   builds no argv at all (it delegates to `extract-audio.ts`), and the audio-decode fallback moved
>   from `:228` to `:347`.
>   **What was done about it, since a better-worded claim would rot the same way:** the inventory is
>   now an EXECUTABLE GATE — `src/__tests__/unit/lib/ffmpeg-argv-inventory.test.ts`, which runs on
>   every `npm test`, strips comments with a hand-written scanner (this tree's comments discuss the
>   very names the scan looks for — `video-remux.ts` names libx264/libx265 four times and exactly
>   one is argv), and pins which files may build an FFmpeg argv, where the GPL encoders may appear
>   and how often, that every video-codec selection is an explicit vetted literal, which files may
>   build a filtergraph and with which filters, and where `-map` may appear. It also asserts that
>   this document's successor and the build script both name the GPL-reachable file, and bans three
>   retired phrasings. `build-ffmpeg-core-lgpl.sh` now RUNS it as a pre-flight before the Docker
>   check, with `npx --no-install`, so a dead premise costs seconds instead of hours of emulated
>   compiling. **Proven failable in three independent directions** (a GPL encoder in an unreviewed
>   file; an `-af` in an unreviewed file; a retired phrase reinstated in `licensing-posture.md`) —
>   each goes red with a message telling the next person which two documents to rewrite.
>   **The audio filters this session adds do NOT affect the conclusion:** `loudnorm`,
>   `silenceremove` and `areverse` are libavfilter's own and reach no GPL component. It is libx264
>   that moved the answer.
>   **Owner's call, stated neutrally and NOT decided here:** keep the GPL core under the existing
>   separate-program posture + source offer (which `/licenses` already documents accurately, and
>   which is compliant today); or drop the H.264 transcode arm and take the LGPL core; or move that
>   one transcode to WebCodecs, as `compress-video` and `webm-to-mp4` already do, and then take the
>   LGPL core for free. The third is the only option that costs the user nothing, and it is a real
>   build, not a flag change.)*
>
> **Disposition of the original items below** — pdf-lib/pdfjs-portable survivors move to
> a later wave: `delete-pdf-pages`/`extract-pdf-pages` (existing split machinery),
> `crop-pdf`/`change-pdf-page-size` (pdf-lib page boxes), `watermark-pdf`/`sign-pdf`
> (visual)/`add-image-to-pdf`, `fill-pdf-form`/`flatten-pdf` (pdf-lib forms API),
> `pdf-to-text` (pdfjs `getTextContent`). qpdf may honestly resurrect
> `protect-pdf`/`unlock-pdf`/`repair-pdf`. **DEAD while the repo is closed** (record;
> stop re-proposing): `redact-pdf` (no honest permissive client-side glyph destruction),
> `pdf-to-html`/`pdf-to-svg` (MuPDF DocumentWriter), EPUB/MOBI/CBZ readers, the MuPDF
> compress upgrade, outline editor, and Wave 5's `docx-to-pdf`/`ocr-pdf`-via-MuPDF-render
> (ocr-pdf can re-spike on pdfjs render if Wave 5's OCR lands).

All engine work goes through `pdf-engine-core.ts` → `pdf.worker.js` (leaf-import rule +
`copy:wasm` after edits). Group by shared UI shell, not by slug.

- [x] **Security trio (one engine, three pages):** `protect-pdf` (encrypt options above),
  `unlock-pdf` (user-supplied known password → `authenticatePassword` + decrypted re-save;
  frame as "remove a password you know" — no cracking), `pdf-permissions` (owner-password /
  permission flags editor). *The privacy story is sharpest here: competitors upload the
  confidential file to a server to password-protect it.*
  *(**UNBLOCKED 2026-09-02: qpdf GREENLIT as the next page cluster, and we COMPILE IT OURSELVES.**
  The encrypt options in the struck-through MuPDF block above are gone with MuPDF; qpdf
  (Apache-2.0) is the replacement engine. Building rather than depending: this sits directly in
  the path of password handling, so a young single-author binary is the wrong supply-chain risk
  to take for a security-facing feature — and compiling it ourselves means we control and can
  prove the static-link set (last session's audit found no GPL/LGPL/AGPL in it; re-verify against
  OUR artifact, not theirs), pin it the way `ffmpeg-core` is pinned, and reproduce the configure
  line from `strings` on the shipped wasm. Reference point: ~2.1 MB, single-threaded.
  **Two gotchas already on record — do not rediscover them:** `addPageNumbers` CANNOT move to
  qpdf (it has no text drawing), and qpdf's `merge` via `--empty --pages` DROPS the trailer
  `/Info`. Both of those ops stay on the pdf-lib graft; qpdf is additive, for
  encrypt/decrypt/permissions/repair only.
  Note `repair-pdf` comes nearly free with it, and is worth taking: `loadDocument`'s honest
  DAMAGED message exists precisely because pdf-lib will not reconstruct a broken xref where
  MuPDF silently did.)*
  *(**2026-09-02: ENGINE BUILT AND VERIFIED. The four tool pages are NOT written yet** — this is
  the next cluster, and it is now unblocked in the only way that mattered.
  The toolchain was missing entirely (no emcc, no cmake) and is now installed: emsdk 6.0.9 at
  `~/emsdk`, cmake + ninja from Homebrew, and a Python 3.12 from `uv` — **emsdk refuses to run on
  the system Python**, which is Xcode's 3.9.6, and that is the first thing that will stop anyone
  reproducing this. Build recipe checked in at `scripts/build-qpdf-wasm.sh`, pinned to qpdf 12.4.1
  from the official release tarball. We do NOT depend on `pdfstudio`.
  Artifact: **2,340,730 B wasm + 63,089 B glue**, against the ~2.14 MB reference.
  **Licensing re-verified against OUR artifact rather than theirs**, which was the whole point of
  self-compiling: zero `gnutls` / `openssl` / `libgcrypt` / `nettle` strings, and the only crypto
  provider string in the binary is `native` — qpdf's own Apache-2.0 implementation. Built with
  `-DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON`, zlib and libjpeg from Emscripten's own
  ports so no host library can be picked up.
  **The one real finding, and it is a silent-failure bug of exactly the Wave-0 class: Emscripten
  disables C++ exceptions by default, and qpdf signals EVERY error by throwing `QPDFExc`.** A
  default build therefore turns "wrong password" and "damaged xref" into a bare `abort()` with no
  message. Measured here before the fix: an AES-256 file opened with the wrong password killed the
  module instead of reporting, and a repair produced no output at all. The build now passes
  `-fwasm-exceptions` at compile AND link (+307 KB, non-negotiable — the comment in the script
  says so).
  All four operations verified on the shipped artifact: encrypt (exit 0, `/Encrypt` present),
  decrypt with the known password (exit 0, `/Encrypt` gone), **wrong password → exit 2, a clean
  reportable failure**, permissions (exit 0), and **repair of a corrupted `startxref` → exit 3
  with a PDF that re-parses**.
  **Trap for whoever writes the wrapper: exit 3 is qpdf's "completed with warnings" and is a
  SUCCESS.** Any wrapper that collapses "non-zero means failed" breaks `repair-pdf` on the very
  files it exists to fix. Exit 2 is the genuine error.
  Still to do: the four pages, the `/licenses` Apache-2.0 NOTICE entry, a `forbidCdnCore`-style
  guard proving the wasm is same-origin, and a `generate-license-notices.mjs` regeneration.)*
  *(**2026-09-03: ALL FOUR PAGES SHIPPED — 90 → 94 tools.** `protect-pdf`, `unlock-pdf`,
  `pdf-permissions`, `repair-pdf`, over the qpdf artifact built last session. Gates: tsc clean ·
  lint 0 err / 2 standing warnings · unit **2272** pass / 94 skip · default e2e **285** ·
  conversion e2e **199 + 2 designed skips in BOTH projects** · build 117 HTML · `out/` verified
  free of `mupdf`, lamejs/libheif/libde265 still unbundled, and the qpdf glue NOT bundled into any
  chunk (the worker's specifier survives esbuild as `import(x("qpdf.js", D++))`).

  **Artifact placement:** `vendor/qpdf/{qpdf.js,qpdf.wasm}` is CHECKED IN (2.4 MB; the repo is
  private) because qpdf is not an npm package and `copy:wasm` had no non-`node_modules` source.
  `copy:wasm` stages it to the ORIGIN ROOT beside `ffmpeg-core.*` — not `public/vendor/`, which
  exists for the LGPL replaceability cure. `.gitignore` covers the two copies; `eslint.config.mjs`
  ignores `vendor/**` so the minified Emscripten glue stays byte-identical to the pinned SHA-256.

  **`-fwasm-exceptions` works in WebKit and Firefox as well as Chromium** — measured this session,
  wrong password → exit 2 with a clean message, repair → exit 3 with output, identically in all
  three. So the conversion specs run in BOTH projects; no `testIgnore` was needed. That was the
  cluster's biggest open risk and it is closed.

  **A `--requires-password` pre-flight classifies every input with ONE no-password call** —
  rc 2 = not encrypted, rc 3 = encrypted but opens freely, rc 0 = a password is required. It is
  what stops `--decrypt` reporting a successful unlock of a file that never had a password.

  **Review: 8 dimension finders → 40 candidates → 3 diverse refuters each (120 verdicts,
  majority-refuted dropped) → 21 confirmed, all fixed.** The three worth carrying forward:
  1. **The password byte limit DEPENDS ON THE MODE.** 127 bytes is the R=6/AES-256 figure. At
     `--bits=128` qpdf writes R=4, whose handler truncates the password to **32 bytes** — measured:
     a 60-character password set at AES-128 opens with its first 32 characters followed by ANY
     tail, at rc 0 with empty stderr. A single mode-blind constant promised four times the password
     strength the format actually delivers. `maxPasswordBytes(bits)` now drives both the guard and
     the on-screen copy.
  2. **`--requires-password` cannot separate "not encrypted" from "not a readable PDF" by exit code
     alone** — both give rc 2; the discriminator is stderr (`can't find PDF header` /
     `unable to find trailer dictionary` / `file is damaged`), and a valid unencrypted PDF gives
     rc 2 with EMPTY stderr. Classifying on the code alone made unlock-pdf tell the owner of a
     corrupt file it "has no password and no usage restrictions". `QpdfProtection` gained an
     `"unreadable"` member.
  3. **No gate CI runs ever loaded the engine.** The only functional coverage lived in the opt-in
     conversion project, so a `copy:wasm` regression or a 404 on the wasm would have shipped green
     — the all-tools sweep passes on a page whose engine never loads. A 1.6 s smoke test now sits
     in the DEFAULT project and was proven to go red in 714 ms with `public/qpdf.wasm` moved aside.

  Copy that these four tools made FALSE, found and fixed: `/privacy`'s closed list of fetched
  libraries plus its flat "the PDF tools no longer pull a WebAssembly engine at all"; the homepage
  ENGINES table, framed as exhaustive, with no qpdf row for a 2.3 MB first-use download; the
  privacy blog post's verify-it-yourself paragraph; and `PASSWORD_MESSAGE`/`DAMAGED_MESSAGE`, whose
  "nothing here can decrypt a protected document" / "Nothing here repairs a broken PDF" now point
  at the two tools that do. A new `engine-disclosure.test.ts` derives its expected byte counts from
  `statSync(vendor/qpdf/*)`, so a rebuild at a different size turns that copy red rather than
  letting it drift.

  A pre-existing bug fixed in passing: two pdfjs `getDocument` call sites had no error mapping, so
  `pdf-to-jpg`/`-png`/`-webp` and the page-picker leaked pdfjs's raw English ("No password given")
  as if it were our copy. Both now go through one `openPdfjsDocument()`.

  **`pdf-permissions` carries the honest line no competitor writes:** permission flags are
  advisory, and our own `unlock-pdf` strips them with no password at all — measured, not inferred.)*
- [x] ~~**`redact-pdf`**~~ — **DEAD. Tombstone ticked 2026-09-10** so it stops reading as queued
  work. It needed MuPDF's `applyRedactions()`, which is true glyph destruction; MuPDF is AGPL and
  was REMOVED under the closed-source posture, and there is no honest permissive client-side
  equivalent — pdf-lib can draw a black box over text that a reader can still select and copy,
  which is the one thing a redaction tool must never ship. ORIGINAL ITEM:
  communicate this is true content removal (verified), not a visual box. Include image redaction
  mode (`REDACT_IMAGE_REMOVE`).
- [x] **Extraction set — DONE; box ticked 2026-09-10.** Both live halves shipped:
  `pdf-to-text` (2026-09-02) and `extract-images-from-pdf`, both present in the registry. The
  other two named below died with MuPDF.
  ORIGINAL ITEM: `pdf-to-text` shipped; `extract-images-from-pdf` shipped;
  ~~`pdf-to-html`, `pdf-to-svg`~~ DEAD with MuPDF.
  *(2026-09-02: **`pdf-to-text` SHIPPED** on pdfjs `getTextContent()` — no `asText`, no MuPDF, no
  new dependency, main thread (pdfjs brings its own worker). New leaf `lib/tools/pdf-text.ts`.
  Line reconstruction is driven by `item.hasEOL`, NOT geometry: `transform[5]` is UNROTATED user
  space with y growing upward and page `/Rotate` is not applied, so a naive y-sort emits the page
  bottom-first, while `hasEOL` is computed in text space and is rotation-immune. Paragraph breaks
  come from a MEDIAN inter-line Δy (median, not mean — headings and figure gaps are outliers)
  with a 1.6× threshold. Facts pinned in code because they cost time: `normalizeWhitespace` and
  `disableCombineTextItems` are GONE in pdfjs 5.x and are SILENTLY IGNORED if passed, so any
  v2/v3 snippet looks right and does nothing; `doc.destroy()` during an in-flight
  `getTextContent()` leaves that promise PENDING FOREVER (never resolves, never rejects), so
  cancellation is cooperative between pages; `PasswordException` is `instanceof Error`, so the
  stock catch would leak pdfjs's raw wording — matched on `err.name` instead.
  Honesty: an image-only page returns `items: []`, and that is surfaced — a document with no text
  layer gets a warning naming OCR's absence and a pointer to pdf-to-jpg, and **no download**.
  A defect found by the e2e pass and fixed: `joinPdfPages` deliberately emits a bare
  `--- Page N ---` for an empty page so a scan inside a digital document leaves a trace, but when
  EVERY page was empty that folded to a non-empty string of pure separators, and the footer —
  which gates the download on that string — offered a 30-byte `scanned-pages.txt`. `text` is now
  emptied at the single place every gate reads it. Partial scans still deliver, with a warning
  naming the empty pages. `extract-images-from-pdf` NOT built — no engine work was done for it.)*
- [x] **Page ops:** `delete-pdf-pages`, `extract-pdf-pages` (both thin over existing split/reorder
  machinery), `crop-pdf` + `change-pdf-page-size` (`setPageBox`; shared UI).
  *(2026-09-02: all four shipped, plus a **confirmed regression fixed in `addPageNumbers`** that
  building `crop-pdf` made reachable in-product.*
  - ***The carried CropBox watch item is CONFIRMED, not dismissed.** The two refuters who waved it
    away last session were wrong. `addPageNumbers` read `getMediaBox()`, but every viewer clips to
    intersect(CropBox, MediaBox) — that is pdfjs's literal `get view()`. Measured: on MediaBox
    `[0 0 842 1191]` + CropBox `[100 100 742 1091]`, bottom-center stamped at `418.22, 20` on a
    page whose visible area starts at y=100, and the repo's own pdfjs maps it to canvas y=1071 on
    a 991 px-tall canvas. **All six positions missed**, and the counter-rotation matrix carried
    the media width too (`0 1 -1 0 842 0 cm` where it should be `0 1 -1 0 742 100 cm`). This was a
    pdf-lib-port regression: MuPDF's `getBounds()` returned the CROP box. Fixed via a new shared
    `visiblePageRect(page)` = normalised intersect, with a try/catch because pdf-lib's
    `asRectangle()` THROWS on a `/CropBox` whose array length ≠ 4 where pdfjs merely warns. Zero
    behavioural delta on any file without a CropBox; regression tests proven to fail without the
    fix (2 failed / 125 on revert) and the existing pinned operator assertions needed no retune.*
  - *`extract-pdf-pages` needed a real differentiator to clear the Wave-0 gates: `splitPdf` was
    ALREADY "selected indices → one PDF" and split-pdf's own button already read "Extract N
    pages", so a bare synonym would have failed all three gates. It ships with an output-mode
    control split-pdf does not have — one combined PDF (default) vs **one PDF per page, zipped**
    (the industry-standard shape; new `splitPdfToPages` parses once and emits N documents).
    `delete-pdf-pages` is distinct on its own: inverted selection, complement computed INSIDE the
    engine from `src.getPageIndices()` so a stale UI page count can never reach pdf-lib's
    bounds-check-free `copyPages`, and a hard UI block on emptying the document.*
  - ***`setPageBox` was the wrong mental model for `change-pdf-page-size`** and this is the item's
    honesty trap: changing `/MediaBox` alone does NOT rescale content, it crops or pads it. The
    tool SCALES by default — uniform `s = min(tw/w, th/h)` plus a centring translate folded into
    ONE matrix via `node.normalize()` + `wrapContentStreams` (pdf-lib's own `scaleContent(s,s)`
    cannot express the centring: it scales about content-space (0,0), so a non-zero-origin box
    drifts) — with an explicit "change the page box only" option whose copy says it crops or pads.
    Both boxes are written UNCONDITIONALLY, because `setSize()` only propagates to CropBox when it
    float-equals the MediaBox, so a page with a real CropBox would have kept its old one and the
    resize would have been INVISIBLE. Disclosed in copy: `scaleAnnotations` moves annotation
    geometry but not `/AP` appearance-stream BBox/Matrix, so form-field appearances are not
    rescaled. `crop-pdf` is the opposite call and does NOT scale — it writes both boxes and leaves
    the content stream alone, clamped per page. The four `/Rotate` inversions were proven at
    pixel level through the repo's own pdfjs (100.00% match on all four; the first table drafted
    for the implementers had R=90 and R=270 swapped and the measurement caught it).*
  - *Honesty (P1): the crop copy says plainly that cropping HIDES rather than deletes — the
    cropped-away bytes stay in the file and are recoverable. That is the honest line between
    cropping and redaction, and this app has no redaction tool.*
  - *Shared UI as the item asks: `PdfPagePicker.tsx` (`usePdfPageThumbnails` + `PdfPageDeck`)
    extracted from `SplitPdfUI`, which is refactored onto it with a byte-identical observable
    surface (the pinned e2e locators — "Extract N pages", `split.pdf`, `/^Page 1(,|$)/` — all
    still hold). `ChangePdfPageSizeUI` shares `PdfPageSizeTool` with `pdf-resizer`.)*
  - ***Adversarial review (7 finders → 3 diverse refuters per finding, 142 agents): 45
    candidates, 21 survived, all 21 fixed.** The five that mattered most, each now pinned by a
    mutation-proven regression test:*
    1. ***`changePdfPageSize` re-exposed content the source's CropBox was hiding.** The scaling
       prefix carried no clip, so a mark living in the MediaBox-only margin — bleed, printer's
       marks, or anything **our own `crop-pdf` had just cropped away** — was scaled onto the new
       sheet. The crop → resize chain reproduced it with a plain page. Now clipped to the source's
       visible rect. The clip is emitted AFTER the `cm` (in the source's own coordinates); the
       reviewer's suggested before-`cm` ordering describes a rect in the NEW sheet's space and
       halves the content — that ordering is pinned by its own mutant. No-op proven for the
       ordinary CropBox==MediaBox page (poppler at 150 dpi, 4 rotations × 3 targets, 0 differing
       subpixels bar antialiasing on one boundary row).*
    2. ***`deletePdfPages` did not actually delete.** A kept page's internal link — the ordinary
       output of Word/InDesign/Acrobat — held the dropped page's dictionary, content stream and
       resources alive past the sweep: a 4-page cross-linked report came back reporting 2 pages
       while still carrying 4 page objects and `CONFIDENTIAL SALARY TABLE` inflatable out of the
       delivered file. `fixAnnotationPageRefs` is mapping-aware now (`/Dest` and `/A /GoTo`, plus
       a catch-all for a `/P` naming a page outside the tree, which a form field's `/Parent`→
       `/Kids` chain reached around the `/Annots` walk). 4 page objects/1452 B → 2/997 B; a
       100-page ToC case 100 objects/81 KB → 1/56 KB.*
    3. ***Every internal cross-reference in merge/extract/delete/reorder/split output resolved to
       page 1** — a pre-existing bug the destination work surfaced and fixed (pdf-lib's
       `copyPDFPage` clones the leaf before consulting `traversedObjects`, so a destination makes
       a SECOND copy outside the page tree that no reader can locate). Links whose target survives
       are repointed; links whose target left are removed rather than dangling.*
    4. ***The destination fix then had its own bug, found while verifying it and fixed here:**
       `PDFRef.tag` is unique only WITHIN a document, and `mergePdfs` shares one map across every
       input — so two files from the same producer, numbering their pages identically, cross-linked
       (merging two copies of a 4-page file sent A's link to page 8). The map is per graft now;
       the mutant reproduces `[7,6,…]` where `[3,2,…]` is correct.*
    5. ***Annotations were landing up to 372 pt (131 mm) from what they annotate** —
       `scaleAnnotations` scales about content-space (0,0) and never got the centring translate.
       Replaced by `transformAnnotations`, which gives `/Rect`, `/QuadPoints`, `/Vertices`, `/L`
       and `/InkList` the full affine while `/RD`/`/CL` (margins, not points) take the scale only.
       Measured drift → **0.00 pt** on all nine pairs tested, including a non-zero-origin MediaBox
       and `/Rotate` 90/270.*
    *Copy honesty caught two real lies and one overstatement: the extract/delete copy claimed form
    fields survive, but `copyPages` drops `/AcroForm` outright (measured — the widget still DRAWS
    and keeps its value, but `getFields()` is empty and the field is no longer fillable; `/Names`
    and `/PageLabels` go the same way, and merge-pdf carried the same pre-existing false claim,
    fixed too); `pdf-to-text` offered a 30-byte `.txt` of nothing but page markers for a scanned
    PDF; and the `/AP` caveat was too strong in both directions — readers fit `/BBox` onto `/Rect`
    per 32000-1 12.5.5 and this engine only scales uniformly, so the real residue is just the `/DA`
    point size a redrawing reader would use. **REFUTED and deliberately not "fixed":** the six new
    tools looked like a closed clique in `relatedTools`, but the rail is not built from that field
    — all six are linked twice from every established PDF page in the built output; and
    `splitPdfToPages`' per-file size growth is inherent to "N standalone PDFs", not bloat.*
- [x] **`watermark-pdf`, `annotate-pdf`, `sign-pdf`, `add-image-to-pdf` — SHIPPED 2026-09-10.**
  The item text above named `bake()`, a MuPDF API that has not existed here since Wave 2; these
  are pdf-lib builds with zero new engine bytes, as the REVISED disposition note said.
  **ONE engine op serves all four**: `stampPdf` takes text, image and rectangle stamps, each with
  its own page selector (`"all" | "first" | "last" | number[]`), so the four tools are the same
  operation with different defaults rather than four copies of the page geometry — which is the
  half that is actually hard, because a CropBox that differs from the MediaBox, a non-zero origin
  and a `/Rotate` all move where "the top-left of the page" is. All placement arrives as
  FRACTIONS of the displayed page so a preview overlay can report a drag without knowing anything
  about PDF user space; `pdf-stamp-core.ts` converts.
  **`annotate-pdf` v1 is scoped exactly as asked and says what it cannot do**: a highlight
  rectangle, a box outline and a text note. It does NOT select text — pdf-lib has no
  text-selection model — so a highlight is a rectangle you place, and the marks are drawn INTO
  the page content rather than being annotation objects a reader can click and delete. Both
  limits are in the description, the aboutText and an FAQ.
  **`sign-pdf` is labelled a drawn/visual signature throughout.** No eIDAS, ESIGN, "legally
  binding" or "certified" claim appears anywhere in its copy.
  **⚠ THE REVIEW FINDING THAT MATTERED, and it was the orchestrator's bug.** `drawStamp`
  anchored an image and a rectangle with `y: origin.y - height` — a top-left-to-bottom-left
  correction along the UNROTATED y axis, which only means "down the page" at `/Rotate 0`.
  **Three build agents measured it independently**, converged on the same one-line cure, and all
  three correctly REFUSED to compensate in their UI (a page that silently corrects for an engine
  bug double-corrects the day the engine is fixed). Measured before the fix, a request for
  (25%, 25%) landed at (15.0%, 10.9%) at 90°, (25.0%, 10.9%) at 180° and (35.0%, 10.9%) at 270°;
  a 30%-tall mark at 180° ended up entirely off the top of the page. Text stamps were never
  affected — `drawText` rotates about its own origin and needs no correction.
  The cure is `displayedDownUnit`, which **asks `fractionToUserSpace` where the top and bottom of
  the displayed page are rather than tabulating four vectors that could drift from it**, and
  returns exactly `(0, -1)` at rotation 0 so the old behaviour is a special case of the new one.
  Pinned by an `it.each` over all four rotations, mutation-proven by restoring the old line. The
  two UIs that had shipped honest warnings about it had those warnings, their FAQs and their
  aboutText sentences removed in the same change.
- [x] **`fill-pdf-form` and `flatten-pdf` — SHIPPED 2026-09-10.** `getWidgets()` is MuPDF; these
  use pdf-lib's own forms API. Four measured facts shaped them, none of which is in any doc:
  * **`getForm()` MUTATES a form-less document** — it lazily creates an `/AcroForm` in the
    catalog (measured: undefined before the call, defined after, on this repo's own fixtures). So
    both tools read `catalog.get(/AcroForm)` FIRST and refuse with a real sentence; otherwise
    saving would add a form dictionary the user never had.
  * **`flatten()` bakes the `/AP` appearance stream, not the `/V` value.** A field whose value
    says one thing and whose appearance draws another flattens to what the appearance draws. The
    high-level setters mark the field dirty so the ordinary fill path is safe; `/NeedAppearances`
    (the producer saying "my appearances may not match my values") triggers a full regenerate.
  * **`flatten()` throws `Unexpected N type: undefined` on a widget with no resolvable `/AP`** —
    radio groups and signature fields are the two kinds pdf-lib will not regenerate — **and the
    throw leaves the document half-flattened and unsaveable.** So it is DETECTED before leaping,
    and `flattenBlockedBy` names the fields rather than the user meeting pdf-lib's own message.
  * **An already-flattened document still has an `/AcroForm`** with zero fields, so "has a form"
    and "has fields" are different questions and both tools branch on both.
- [x] **The e2e title trap does NOT bite this cluster**, unlike the GIF one: `conversion-webkit`'s
  `grepInvert: /gif|FFmpeg|MP4/i` is matched against project name + file path + describe titles +
  test title joined, and none of `watermark`, `sign`, `annotate`, `flatten`, `fill` or
  `metadata` contains any of those substrings.
- [x] **`repair-pdf`** — xref reconstruction fires automatically on open+resave; best-in-class
  for free. *(2026-09-03: SHIPPED with the security trio — one qpdf pass, `["in.pdf","out.pdf"]`,
  no flags. See the trio's annotation below.)*
- [x] **Metadata consolidation — `remove-metadata` SHIPPED 2026-09-10**, covering images AND PDF
  in one tool, one action. (`setMetaData` + `sanitize` are MuPDF and do not exist here.)
  **THE FACT THAT MAKES IT HONEST, and it is the whole reason the tool is worth having:
  clearing `/Info` does NOT remove XMP.** Measured — after clearing every pdf-lib setter the XMP
  packet still carried the document title, and pdf-lib's setters write `<FEFF>` (a lone
  byte-order mark) for an empty value rather than removing the key at all. XMP lives on the
  catalog, on pages, AND on image XObjects, because a photo placed into a PDF brings its camera
  XMP with it. `removePdfMetadata` deletes the `/Info` keys outright and every XMP stream it
  finds, and `readPdfMetadata` reports the count so the page can state what was there.
  A tool that had only called the setters would have reported success over a document still
  naming its author — which is exactly the class of lie this repo gates against.
  ⚠ **The trailer `/ID` deliberately survives**, and `sweepUnreachableObjects` roots its walk at
  it. It is a file identifier, not a statement about a person.
  **The image arm re-uses `stripExifData`, which is a canvas re-encode**, so it also drops the
  ICC profile, any bit depth above 8, and animation, and a JPEG is recompressed at quality 0.92 —
  all disclosed on the page. It is also the one new tool that reaches an origin-root engine
  (heic2any, for `.heic`/`.heif`), which is why that bundle's `toolCount` went 5 → 6.
  **⚠ The `exifreader`-off-the-main-thread half of this item is NOT done, and should probably
  never be done as written.** Moving it into a worker **SILENTLY LOSES XMP TAGS**: exifreader
  parses XMP with the global `DOMParser`, which exists in `lib.dom.d.ts` and NOT in
  `lib.webworker.d.ts`; in a worker `getDocument` throws, `readTags` swallows it, and the `xmp`
  group comes back empty with no error. The only in-library escape is passing a `domParser`,
  which means shipping `@xmldom/xmldom` — itself 16 high-severity advisories. **What WAS done is
  the thing that actually removes the risk**: exifreader was bumped past its advisory range
  (a lockfile-only change; `package.json` already declared a compatible caret), clearing all
  three HIGH findings. Revisit the worker move only if a DOM-free XMP parser appears.
- [x] ~~**Ebook/comic converts**~~ — **DEAD. Tombstone ticked 2026-09-10.** "Readers verified
  present" was verified IN MUPDF, which is gone. Nothing in the dependency set reads EPUB, MOBI,
  FB2 or CBZ. ORIGINAL ITEM: `epub-to-pdf`, `mobi-to-pdf`,
  `cbz-to-pdf`, `pdf-to-cbz`. Surface DRM detection honestly (refuse DRM'd files with a clear
  message).
- [x] **`compress-pdf` engine upgrade — DONE 2026-09-10, but NOT the upgrade this item asked
  for.** The item named `garbage=compact,compress-images,compress-fonts,sanitize` +
  `subsetFonts()`: those are **MuPDF APIs and MuPDF is gone**. Both levers it does name turn out
  to be dead, and the lever that pays is one nobody proposed. Measured before deciding, exactly
  as the item's own warning asked.
  **WHAT WAS DROPPED, each with evidence:**
  * **Font subsetting — dead twice over.** pdf-lib has no API that touches a font already
    embedded in a loaded document (the only subset path is `embedFont(bytes,{subset:true})`,
    which takes bytes the caller supplies), and `@pdf-lib/fontkit` is not installed, so even
    that throws `FontkitNotRegisteredError`. And there is almost nothing to subset: across
    **400 real PDFs**, 205 carry embedded font programs and exactly **ONE** has a non-subset
    face — 88,862 non-subset bytes against 9,534,131 already-subset, **0.92%**.
  * **Object-stream rewriting — already done.** `useObjectStreams: true` is pdf-lib's own
    default (`PDFDocument.js:1248`), so the explicit flag was always documentation, never a
    switch. Every other op in the file already writes object streams and an xref stream.
  * **Dropping `/Info` + XMP — 0.444%** (16,005 B of 3,608,546 B) and it would contradict the
    shipped promise that "the document's own metadata such as title and author survives
    unchanged". It belongs in `remove-metadata`, and that is where it went.
  * **pako/zlib level 9 over `CompressionStream`** — +2.21 pp on the best file, ~0 elsewhere.
  **WHAT SHIPPED INSTEAD — two changes, both measured on the real engine:**
  1. **A SHIPPED BUG: `deflateRawStreams` could make a file BIGGER.** Its guard compared stream
     PAYLOADS (`packed.length >= obj.contents.length`) and ignored the `/Filter /FlateDecode` it
     writes into the dictionary two lines later — **21 serialised bytes**, now derived exactly
     the way `PDFDict.sizeInBytes()` derives it rather than hardcoded. On a 60-page document
     whose content streams arrive raw: **11,032 → 11,192 bytes, a 1.45% LOSS**, from a
     compressor. It never reached a user because the object-stream rewrite carries the file and
     `CompressPdfUI` hands back the original when the result is not smaller — the pass was
     simply losing money on that shape.
  2. **RE-DEFLATING STREAMS THAT ARRIVED ALREADY `/FlateDecode`.** Producers differ enormously
     in how hard they compress, and pdf-lib writes back a stream it did not create exactly as it
     found it. Before → after on the real engine: Xcode's Acknowledgments.pdf **5.68% → 31.05%**,
     its en.lproj/License.pdf **4.83% → 21.74%**, the repo's own `sample-doc.pdf` 0.00% → 1.96%,
     aggregate over the corpus **5.35% → 26.10%**. An independently-written 400-file harness got
     **10.88% → 19.23%** aggregate and the identical 5.68% → 31.05% on Acknowledgments.pdf.
     No new dependency: `DecompressionStream` is the platform's, as `CompressionStream` already
     was. Time cost on a 924-page 1.4 MB document: 69 ms → 166 ms.
     ⚠ **It is PRODUCER-DEPENDENT** — biggest on macOS Quartz output, and a Word-produced file
     gained 0.06 pp. The copy must not promise a number, and does not.
     `/DecodeParms` is deliberately NOT skipped here, unlike in the raw-stream pass, and the
     asymmetry is the point: there, writing `/FlateDecode` beside a STALE `/DecodeParms` brings
     inert parameters to life and corrupts the stream; here the dictionary is untouched and
     inflate→deflate reproduces the identical post-filter bytes, so a `/Predictor` keeps
     describing exactly what it described before.
  **Losslessness proven two ways, each with a positive control**: `pdftotext` output is
  SHA-identical for all six corpus files (control: one flipped byte changes 520 characters and
  the hash), and every DECODED stream survives byte-identically (control: one corrupted stream
  byte is detected as lost).
  **⚠ THE PROCESS FINDING, worth more than the numbers: TWO OF THE THREE NEW TESTS WERE VACUOUS
  ON FIRST WRITING** and only mutation-testing found it. Two independent causes, both now
  written into the test comments: (a) **the object-stream rewrite subsidises the assertion** —
  with a source saved `useObjectStreams: false`, `out.length < source.length` holds with the
  pass under test DELETED, so both size tests now build an already-packed source; and (b) **the
  growth bug has a narrow window** — it only bites where deflate saves more than 0 and fewer
  than 21 bytes, so repeated text (71+ bytes saved per stream) and very short streams (84 raw
  bytes deflate to 86, which even the old guard declined) both hide it. The fixture is one line
  of 16–32 high-entropy characters, from a fixed LCG so it is deterministic.
  Mutations now red: reverting the guard (`expected 13549 to be <= 12932`), deleting the
  re-deflate call (`expected 8773 to be less than 8773`), corrupting the payload.
  **Copy corrected in the same pass:** the `aboutText` led with the mark-and-sweep GC, which is
  worth **462 bytes across a 4,538,825-byte corpus (0.010%)** — correct and cheap, but not a
  compression lever, and presenting it as the leading reason PDFs are big was misleading.
- [x] ~~**PDF bookmarks/outline editor**~~ — **DEAD. Tombstone ticked 2026-09-10.**
  `OutlineIterator` is a MuPDF API and MuPDF is gone. pdf-lib exposes no outline mutation, so
  this would be a from-scratch `/Outlines` tree writer — a real build, not a port, and one
  nobody has asked for. If it is ever wanted it should be re-scoped from zero, not resumed.
- [x] ⚠ **Owner: AGPL posture — SETTLED 2026-08-31; box ticked 2026-09-10.** Decided: the repo
  stays private, the app stays closed, MuPDF was REMOVED rather than licensed, and AGPL is
  disqualifying for any future dependency. `licensing-posture.md` carries the reasoning and the
  verification. Nothing here is open. ORIGINAL ITEM:
  the backbone of ~20 more pages. Get a settled answer (client-side use of unmodified WASM ≠
  network service of MuPDF, but record the reasoning) before building past the security trio.
  *(2026-08-31: drafted analysis in `licensing-posture.md` (repo root) — READ IT, the facts are
  worse than "AGPL question": the repo is PRIVATE with no LICENSE file; the shipped
  `ffmpeg-core.wasm` was verified built `--enable-gpl --enable-libx264 --enable-libx265`, i.e.
  effectively GPL, not LGPL; and `@breezystack/lamejs` (LGPL-3.0) already ships minified in
  `audio-encode.worker.js` with no notice — so conveyance obligations are live TODAY, not a
  Wave 2 problem. Recommended cure (option A in the memo): license the app AGPL-3.0-or-later,
  make the repo public, add LICENSE + a footer-linked /licenses attribution page with
  exact-version source links. Making the repo public is the owner's call — sign off before
  Wave 2 proceeds.)* *(DECIDED 2026-08-31: **repo stays private, app stays closed** —
  option A rejected. Consequence: MuPDF must be REMOVED, not licensed; see the REVISED
  Wave 2 block and the rewritten `licensing-posture.md`.)*

---

## Wave 3 — audio/video matrix over paid-for infrastructure (weeks 4–8)

> **WAVE 3 IS COMPLETE — 2026-09-05 (uncommitted). 116 → 126 tools.** The last ten pages landed in
> three clusters: audio effects (`normalize-audio`, `change-audio-volume`, `reverse-audio`,
> `remove-silence`, `audio-recorder`), the unbuilt half of the video verbs (`video-to-images`,
> `video-thumbnail`, `split-video`, `merge-video`), and `webcam-recorder`. Every remaining Wave 3
> box above is now ticked; the two ⚠ owner items are the coi-serviceworker spike (never a
> prerequisite — everything here ships single-threaded) and the page cap, retired 2026-09-04.
>
> **Gates, all green:** tsc clean · lint 0 errors / 2 standing `no-img-element` warnings ·
> unit **3732 passed / 126 skipped** (was 3282/116) · default e2e **321** (was 311) ·
> conversion e2e **261 passed + 4 designed skips in BOTH projects** (was 239+2; the two new skips
> are the recorder specs, which need Chromium's fake-device flags exactly as `screen-recorder`
> does) · `npm run build` succeeds, **152 HTML files** in `out/` (was 142) · `out/` re-verified
> free of `mupdf`, lamejs/heic2any still unbundled and served from `/vendor/`, and the qpdf glue
> still absent from every chunk — each of those greps run with a positive control alongside it, so
> a silent zero cannot be mistaken for a pass.
>
> **Built multi-agent:** 8 read-only scouts → 6 implementation agents on disjoint file sets against
> a written contract → 9 dimension finders → **3 diverse refuters per finding (correctness /
> reachability / reproduction), majority-refuted dropped** → 5 fix agents + a copy-integration
> agent. The review put up **63 candidates and confirmed 42** (13 P1). Two things that says about
> the process, both worth carrying:
> * **The refuters earned their keep in both directions.** 21 candidates died — including several
>   confident P1s. But several that SURVIVED came back with the reporter's arithmetic corrected and
>   the defect *widened*: the change-audio-volume finding was filed as an 8.6 dB error on a
>   contrived input and is really a ~2 dB error that also fires at **gain = 0 dB**, which the
>   original finding never mentioned. Read refuter notes as part of the finding, not as a verdict.
> * **The e2e pass found a defect no reader would have.** An assertion on the frame-cap sentence
>   failed, and the reflex is to relax the assertion. The DOM actually contained
>   `One run saves at most 300frames.` — JSX had eaten the space between an expression and the next
>   word, while a structurally identical block two components over rendered its space correctly.
>   Both the fix and the comment above it are in `VideoToImagesUI.tsx`. **Do not reason about that
>   whitespace rule from memory; make the space explicit.**
>
> **The five measurements that shaped the cluster** (harness and logs recorded in the session
> scratchpad; each is spelled out in the item it belongs to): `loudnorm` silently resamples to
> **192 kHz** unless `-ar` pins the rate, and the in-filtergraph `aresample` cure **exits 1**;
> two-pass `loudnorm` is reliable at ≈22.5 ms per second of audio and its `Aborted()` log line is
> benign; FFmpeg's concat demuxer **exits 0 while dropping clips**, including for `.mp4`+`.mkv`
> which match on every stream property; `-c copy` cuts only at keyframes (a requested 1.000 s
> segment measures 1.022 s); and the browser's `<video>` **cannot open AVI at all**, which is why
> the two frame tools ship the same `.mp4,.webm,.mov` list `video-to-gif` already had.
>
> **⚠ One deliberate scope reduction, and one recorded reversal.** `merge-video` ships
> lossless-concat-only — the transcode fallback this plan asked for is deferred, with reasons, in
> that item. And the LGPL-core spike's premise turned out to have been false since 2026-09-03; see
> the reversal recorded against the Wave 2 FFmpeg-posture item. Neither is a blocker; both are the
> owner's call.


> **WAVE 3 CLUSTER 1 LANDED 2026-09-03** (uncommitted). The remux-first container tools plus the
> two video verbs. **Before any of it, a SHIPPED BUG was fixed:** any wasm trap permanently
> poisoned the FFmpeg singleton — after one trap every later `exec`, even `-version`, threw
> `memory access out of bounds`, and because that string is in `OOM_SIGNATURES` the user was told
> *"Ran out of memory. A browser tab can hold about 1795 MB in one file"* **for a 350 KB WAV**,
> after which every FFmpeg tool in the tab was dead until a page reload. The loader now terminates
> the instance on a genuine trap so the next job reloads a clean core.
>
> **Measured crashers in the shipped core — never emit these** (all reproduced in a real browser
> against `public/ffmpeg-core.wasm`):
> - **`-c:v libx265` DEADLOCKS** — initialises, then nothing for 80 s+ on ONE 320×240 frame. Any
>   HEVC transcode must target `libx264`. The `hevc` DECODER is fine, which is what the probe uses.
> - **`-c:v libvpx-vp9` TRAPS** after ~25 frames, at 0.0075× realtime. `libvpx` (VP8) is fine.
> - **stereo `libopus` TRAPS at `compression_level >= 5`** — and the default is 10. Safe form:
>   `-c:a libopus -compression_level 4`. Mono is fine at any level. **This one lands squarely on
>   the deferred audio matrix below.**
> - **`exec`'s `timeout` parameter is inert** (10 s timeout, still hung at 48 s) — single-threaded
>   wasm blocks the worker event loop, so the only watchdog is `terminateFFmpeg()`.
> - **`ffprobe` returns `-1` unconditionally**, on valid and missing inputs alike — detect failure
>   by the JSON lacking `format`, never by the exit code. It writes to a MEMFS file via `-o`, so it
>   needs no log hook, which is why the probe uses it instead of scraping stderr.
> - **`-display_rotation` does not exist** in this build; `-metadata:s:v:0 rotate=N` is the one
>   that works and survives the mux.
>
> **DEFERRED out of this cluster, and why:** the audio format matrix, `extract-audio`, the audio
> effects set, `compress-video-to-size`, `subtitle-converter` and `webcam-recorder` are untouched.
> Nothing blocks them — the cluster was scoped to the plan's own highest-value item plus the two
> verbs that share its engine, so that one shared shell could be built and reviewed properly rather
> than eight shells built thinly. The Opus finding above is the one measured fact that changes the
> audio matrix's shape before it starts.
>
> **Two carried obligations from this cluster remain OPEN** — see the two ⚠ items at the end of
> this Wave.

- [ ] ⚠ **Owner: revisit the 2026-08-09 "no coi-serviceworker" decision.** Recorded facts have
  changed: the only third-party script is GA4 (no ad stack), and `COEP: credentialless` +
  self-hosted or proxied analytics covers Chrome/Firefox. BUT this repo *also* recorded real
  `@ffmpeg/core-mt` pthread deadlocks, and Safari gets no `credentialless`. Treat as a spike
  with exit criteria (deadlock repro suite across 3 browsers, GA data continuity), not a Wave
  prerequisite. **Everything below ships single-threaded regardless; nothing waits on this.**
- [x] **Remux-first container tools** (`-c copy` where codecs allow — sub-second, lossless;
  surface "no re-encode needed" in the UI): `mov-to-mp4`, `mp4-to-mov`, `mkv-to-mp4`,
  `mp4-to-mkv`, `avi-to-mp4`, plus a `video-to-mp4` hub page.
  **HEVC branch is mandatory:** iPhone `.mov` is often H.265; a naive remux emits an .mp4 that
  still won't play where the user needs it. Probe codec → offer remux (fast) vs H.264 transcode
  (slow, honest time estimate).
  *(**2026-09-03: SHIPPED, with `mute-video` and `rotate-video` alongside — 94 → 102 tools.**
  One engine (`lib/tools/video-remux.ts` + `video-probe.ts`) and one UI shell behind all six
  container slugs; `planRemux` holds the codec×container matrix and every cell carries the
  measurement that decided it. `RemuxResult.streamCopied` is the ONLY source of the "nothing was
  re-encoded" claim, so the page cannot make it about a run that transcoded.
  Measured argv: remux 12 ms into `.mov` (`speed=774x`) and 4 ms into `.mkv`; mute
  (`-an -c copy`) 7 ms; rotate (`-metadata:s:v:0 rotate=N`) 6 ms against **7,579 ms** for the
  `-vf transpose=1` re-encode of the same clip — about 1000×, and lossless. All eight declare
  `maxSizeMB: 1536`, which is the cap `validateFFmpegInput` genuinely enforces for a stream copy.)*
- [x] **`extract-audio`** — generalize `mp4-to-mp3` to all demuxable containers (MKV/AVI/WebM/
  MOV) and to WAV output (`video-to-wav`, `mp4-to-wav` as children).
- [x] **Audio format matrix** (decoders verified present): `flac-to-mp3`, `ogg-to-mp3`,
  `aac-to-mp3`, `wma-to-mp3`, `opus-to-mp3` ("convert WhatsApp voice notes" is the real query),
  `m4a-to-wav`, `wav-to-flac`, + `mp3-converter` hub.
  *(**2026-09-04: BOTH SHIPPED — 102 → 113 tools.** `flac-to-mp3`, `ogg-to-mp3`, `aac-to-mp3`,
  `opus-to-mp3`, `wma-to-mp3`, `m4a-to-wav`, `wav-to-flac`, an `mp3-converter` hub, plus
  `extract-audio` with `video-to-wav` and `mp4-to-wav`. `AudioConverterUI` was widened rather than
  forked, and the output format now comes from the registry as a SEED the user can change — the
  same seam the image and PDF tools use. New `lib/tools/audio-format.ts` (a zero-import leaf),
  `audio-convert.ts` (Web Audio for mp3/wav, FFmpeg for FLAC) and `extract-audio.ts`; the old
  `mp4ToMp3` / `convertToMp3` / `convertToWav` keep their exact signatures as one-line delegations.
  No new pool worker — FFmpeg already has one, and `build-workers.mjs` + the lamejs `vendorUrl` trap
  + the leaf-import rule are three separate ways a new one breaks the production build.

  **Three measured findings that changed the design:**
  1. **Opus does not ship at all, and "safe at `compression_level 4`" was WRONG.** The exact
     boundary reproduces on a fresh core (default and 5 trap, 4 and below work) — but **after six
     unrelated jobs in the same core instance, level 4 traps too**, reproduced twice. So no format
     emits Opus. `OPUS_SAFE_COMPRESSION_LEVEL` + an `assertSafeFFmpegAudioArgs` guard now run on
     EVERY FFmpeg argv both new modules build, so a future Opus path cannot skip the flag.
  2. **FFmpeg will write a lie, exit 0, and Chromium will "decode" it.** On a clean core,
     `-i in.mp4 -map 0:a:0 -vn -c:a copy lie.wav` exits **0** with 10,486 bytes, and
     `decodeAudioData` ACCEPTS that file — reporting **0.139 s** for a 2.09 s source. So the copy
     container is never the user's requested extension: it is looked up from the probed codec, and
     **WAV output never stream-copies**.
  3. **`-map 0:a:0` is required for the `streamCopied` claim to be honest** — FFmpeg's default
     selection picks the "best" audio stream, not the first, while the probe describes the first.
     Taking a different track than the one probed is how a copy lands in a container that cannot
     hold it.

  **WMA was measured before it was built, and it works:** a real `wmav2`-in-ASF file decodes through
  `audio-decode.ts`'s existing argv to real audio (peak 0.369, 16 ms), and **no browser decodes WMA
  natively** in Chromium, WebKit or Firefox — so the self-hosted core is the only path there is.
  `"wma"` joined `FFMPEG_FALLBACK_EXTS` with that measurement in the comment. Had it failed, the
  slug was to be dropped rather than shipped.

  22 mutations run against the new tests, 22 red. Gates: tsc clean · lint 0 err / 2 standing
  warnings · unit **2912** · default e2e **307** · conversion **239 + 2 designed skips** ·
  build **138** HTML.)*

- [x] **Audio effects (Web Audio / FFmpeg filters verified):** `normalize-audio` (loudnorm —
  broadcast LUFS while free rivals do peak-only; say so), `change-audio-volume`,
  `reverse-audio`, `remove-silence`, `audio-recorder` (mic, MediaRecorder).
  *(**2026-09-05: ALL FIVE SHIPPED** with the rest of Wave 3 — 116 → 126 tools. New engine
  `lib/tools/audio-effects.ts`; the split the plan predicted held exactly — `reverse-audio` and
  `change-audio-volume` are pure Web Audio on the already-decoded `AudioBuffer` and never touch
  FFmpeg, while `normalize-audio` (`loudnorm`) and `remove-silence` (`silenceremove`) are the
  repo's FIRST `-af` filtergraphs.

  **`normalize-audio` runs TWO passes, and that needed new infrastructure.** `loudnorm`'s
  `print_format=json` writes its measurement to stderr and nowhere else — there is no output file
  to read it out of the way `ffprobe -o` gives the probe one — and `ffmpeg-loader.ts` swallowed
  logs in production. The cure is an 8-line scoped log sink that mirrors the existing
  `currentOnProgress` slot EXACTLY: one registration for the instance's lifetime, routed to
  whichever task holds the queue, released in a `finally` under an identity guard. So there is no
  per-job listener leak, and `terminateFFmpeg` clears it. Measured before committing to it: pass 1
  is reliable across 2 s → 120 s (8 durations, every one exit 0 with parseable JSON) at
  **≈22.5 ms per second of audio** — a 5-minute podcast analyses in 6.8 s. When the stats are
  missing or unparseable the tool falls back to single-pass and **says which mode ran**, derived
  from the result the way `RemuxResult.streamCopied` is.
  Note `Aborted()` is printed as the last log line of EVERY `-f null -` run and is BENIGN: exit 0,
  JSON present, instance healthy 15 jobs later. Do not add it to `WASM_TRAP_SIGNATURES`.

  **⚠ THE TRAP, and it is the cluster's headline: `loudnorm` SILENTLY RESAMPLES TO 192 kHz.**
  Measured on a 44 100 Hz stereo source: `-af loudnorm=… -c:a pcm_s16le` returns **192 000 Hz and
  1 536 102 bytes** against the source's 352 844 — a **4.35× inflation and a resample nobody
  asked for**. The in-filtergraph fix does NOT work: `loudnorm,aresample=44100` **exits 1**. The
  only cure is the output option `-ar <sourceRate>`, and every loudnorm argv now carries it, with
  a mutation-proven test. This is the exact silent-loss class Wave 0 was spent purging and nothing
  in the plan had recorded it.

  `silenceremove` needed no such care — it preserves the source rate. Both recipes measured
  against a purpose-built 5.500 s fixture (1 s silence + 1 s tone + 1.5 s silence + 1 s tone + 1 s
  silence): "ends" → **3.4997 s**, "all gaps over 0.5 s" → **2.0397 s**. `areverse` is how
  `silenceremove` reaches the trailing end at all, since its detector only looks forwards.)*
- [x] **Video verbs — DONE.** ~~`mute-video`~~, ~~`rotate-video`~~ shipped 2026-09-03 with the
  remux cluster (they share its engine and shell). ~~`video-to-images`~~ / ~~`video-thumbnail`~~,
  ~~`split-video`~~, ~~`merge-video`~~ shipped 2026-09-05.
  *(**Frame extraction** reuses `playAndExtractFrames` as the plan said — but note it lives in
  `lib/tools/video-utils.ts:171`, NOT in `video-to-gif.ts`, and was already exported, so
  `video-to-gif.ts` did not have to be touched at all. New leaf `lib/tools/video-frames.ts`; ZIP
  via the already-bundled `jszip` using the specifier copied verbatim from
  `lib/utils/download.ts:46`, so it stays a code-split chunk.

  **⚠ Their accept list is NARROWER than it first looks, and this cost a P1.** Both frame tools
  originally declared `.mp4,.webm,.mov,.avi,.mkv`. Their engine is the browser's own `<video>`
  element, and measured in headless Chromium against this repo's own fixtures:
  `.mp4`/`.webm`/`.mov` load, **`.avi` fails outright with
  `PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN`**, and `.mkv` loads in Chromium ONLY. The
  decisive precedent was already in the registry: `video-to-gif`, on the SAME walk, accepts
  exactly `.mp4,.webm,.mov`. Both frame tools now match it. (Playwright's WebKit build cannot
  decode H.264 at all, so it is not a usable proxy for real Safari on these tools — do not
  conclude anything about Safari from a WebKit run of them.)

  **`split-video`** cuts with one `-ss S -i IN -t D -c copy` run per segment rather than the
  `-f segment` muxer, whose outputs have to be enumerated by trial-and-error on `ErrnoError`.
  **Keyframe drift is real, measured, and disclosed in visible copy:** on the 2.090 s fixture a
  requested 1.000 s cut produces **1.022 s**, and `-ss 0.5 -t 1` produces **1.510 s** because the
  seek snaps back to the keyframe at 0. Every segment row shows its ACTUAL probed duration, never
  the requested one.

  **⚠⚠ `merge-video` — READ THIS BEFORE TOUCHING ANY CONCAT CODE. The plan's own measurement was
  taken on matching inputs only and is dangerously incomplete.** FFmpeg's concat demuxer
  **exits 0 while silently dropping clips**. Measured against the repo's checked-in fixtures:

  | inputs | EXIT | expected | actual | |
  |---|---|---|---|---|
  | `.mp4` + a `-c copy` clone | 0 | 4.180 | 4.180 | ok |
  | `.mp4` + `.mov` | 0 | 4.180 | 4.180 | ok |
  | **`.mp4` + `.mkv`** | **0** | 4.180 | **2.090** | **second clip vanished** |
  | **`.mp4` + `.avi`** | **0** | 4.180 | **2.090** | **second clip vanished** |
  | `.mp4` + `hevc.mov` | 0 | 4.132 | **5.234** | garbage, and LONGER |

  The `.mp4`/`.mkv` pair is **identical in codec, resolution, pix_fmt and every audio parameter**
  — the discriminators are `format_name` and `time_base` (`.mp4` 1/57600, `.mkv` 1/1000,
  `.avi` 1/48; `.mov` shares `.mp4`'s, which is exactly why that one cross-container pair works).
  So the tool probes every input, refuses a mismatched set with a message naming the file and the
  property, AND probes the output afterwards, failing on a **two-sided** duration check — the
  HEVC row proves a one-sided "did it come up short" guard passes garbage.

  **DEFERRED, deliberately, from this item's own wording: the transcode fallback.** v1 is
  lossless concat ONLY. Three reasons, recorded so it is not re-litigated as an oversight:
  (1) an FFmpeg `-filter_complex concat` fallback selects **libx264** on an `.mp4` output, and
  libx264 is today reachable from exactly ONE place (`video-remux.ts:346`) — adding a second, on
  a tool whose entire pitch is "nothing is re-encoded", deepens the GPL entanglement the
  checked-in LGPL cure exists to remove, for a fallback this repo could build on WebCodecs
  instead (`video-compress.ts` already encodes H.264 with `VideoEncoder` + `mp4-muxer`);
  (2) the measured alternative is better product — a mismatch report naming the file and the
  property beats a silent 15×-realtime re-encode the user did not ask for; (3) a WebCodecs merge
  needs cross-input audio concatenation and AAC encode, which Firefox cannot do (recorded), i.e.
  a materially larger build. **If it is ever built, build it on WebCodecs, not on `-filter_complex`.**)*
- [x] **`compress-video-to-size`** — presets (25 MB email / 16 MB WhatsApp / 10 MB Discord) as a
  bitrate solver over the **existing WebCodecs compress path**, not FFmpeg. Honest duration
  estimate + the existing WebCodecs-guard fix from Wave 0.
  *(**2026-09-04/05: both SHIPPED, plus `extract-images-from-pdf` — 113 → 116 tools.**
  `compress-video-to-size` is a bitrate solver on the EXISTING WebCodecs path, not FFmpeg, with the
  25/16/10 MB presets seeding an editable field. `subtitle-converter` is pure JS over
  `TextPane`/`TextPanes` — a text tool wearing a video-tool name — doing conversion, offset shift
  and PAL/NTSC re-timing with exact NTSC fractions rather than rounded decimals.
  `extract-images-from-pdf` writes `/DCTDecode` bytes out VERBATIM as `.jpg`: no decode, no
  re-encode, which is a true extraction and also sidesteps the EXIF trap entirely.)*

- [x] **`webcam-recorder`** — sibling of the existing screen recorder, mostly shared UI.
  *(2026-09-05: shipped WITH `audio-recorder`, over one new `MediaRecorderShell.tsx` refactored
  out of `ScreenRecorderUI`, which fell 385 → 113 lines and whose observable surface is UNCHANGED
  — proved, not asserted: the implementing agent diffed `container.innerHTML` against
  `git show HEAD:…/ScreenRecorderUI.tsx` in the same jsdom, and the string-level regression net
  that remains goes red when one word of the idle copy changes. Its measured
  `tool-surface-heights` entry is pinned, so a silent reflow would fail a gate too.
  The genuinely new UI is the live `<video srcObject>` preview, which the screen recorder has no
  need for; the rest is the device picker, the `facingMode` control, and three error cases the
  screen path never hits (`NotFoundError`, `NotReadableError`, and a camera-specific
  `NotAllowedError`).)*
- [x] **Honest limits copy:** MEMFS ceiling means multi-GB inputs fail — publish the real limit
  on every FFmpeg page (feeds the Platform-track OPFS work; do not claim "no cap" until it's true).
  *(2026-09-04: DONE — see the annotated "Honest limits" item below. The nine stream-copy tools
  declare the 1536 MB `validateFFmpegInput` genuinely enforces; the memory-bound paths that enforce
  nothing carry a `practicalLimitNote` instead of a fake cap; and a gate walks each UI's import
  closure so a new tool cannot quietly claim "NO SIZE CAP" again.)*
- [x] `subtitle-converter` (SRT/VTT/ASS + offset shift + framerate re-timing — pure JS, no
  FFmpeg needed; the offset/retime features are what the query actually wants).

- [x] ⚠ **Owner: the ~120-page cap — DECIDED 2026-09-04, retire the number, keep the gates.**
  *(Owner asked "what will be the best?" — decided under that delegation, and revisitable like every
  other call in this plan. **Reasoning, recorded so it is not re-litigated:** the `~120` was a paper
  estimate made when the site was 67 tools with ZERO crawl data, and the Wave-0 decision that set it
  says in its own text that it is revisitable on evidence. We still have no evidence — because
  nothing has been pushed, the "Search Console reviewed after every wave" half of that same decision
  has never once happened. So the count was standing in for evidence we do not have, and blocking
  gate-passing work on a 2.5% overshoot of an approximate number would be enforcing the proxy
  instead of the thing it proxied.
  **What replaces it, and it is stricter where it matters:** (1) the three Wave-0 gates are applied
  per page and are the real test — distinct user intent, copy that is mostly variant-specific and
  honest without padding, and behaviour differing at least by defaults; (2) **a Search Console
  review is now a HARD PREREQUISITE for Wave 4's GIF cluster**, not for Wave 3 — that cluster is
  where the next ~10 pages are thin by nature, and by then the 102-tool build will have real
  impression data behind it; (3) the rollback lever is unchanged and still cheap — canonicalise
  variants back to their engine page at the first doorway-style demotion signal.
  The count is no longer a gate. A page that fails the three gates is still not built.)*
- [x] ⚠ **Owner (SUPERSEDED — retired 2026-09-04; tombstone ticked 2026-09-10): the ~120-page
  cap.** The tree is at 178 tools and the cap is not a live constraint. Kept below for the
  record only. ORIGINAL: The Wave-0 architecture decision set "~120
  indexable pages max through Wave 4". After this cluster the sitemap is 1 home + 5 categories +
  `/all-tools` + **102** tools + `/workspace` + `/blog` + **10** posts + about/privacy/licenses =
  **123**. Every remaining Wave 3 item (the audio matrix alone is ~10 pages) pushes further past
  it. This is a real decision — raise the cap on evidence, or start canonicalising variants — and
  it is now blocking, not theoretical. Note the rollback lever is unchanged and still cheap.
- [x] ⚠ **Honest limits — DONE 2026-09-04. The audit AND the fix.**
  *(**A new registry field, `practicalLimitNote`, carries the ceiling a tool HAS but does not
  ENFORCE.** `maxSizeMB` keeps its documented meaning — the limit the tool actually enforces — and
  nothing in the new field is ever compared against `file.size`; a tool that sets it accepts exactly
  what it accepted before. What changes is the copy: "NO SIZE CAP" and "MAX SIZE / NONE" are
  absolute claims, and a tool that holds the whole file in memory and then expands it cannot make
  them. Those two surfaces now print "MEMORY-BOUND" plus one sentence naming the MECHANISM that
  binds — the decode, the copy, the buffer — never a bare number, because a bare number reads as a
  cap and this is not one.
  Seven notes written, each derived from a cited line of engine code rather than from other copy:
  the four audio tools (32-bit float decode, ~20 MB per minute of 44.1 kHz stereo — and for
  `m4a-to-mp3` the FFmpeg fallback's ~10× WAV expansion, the one FFmpeg caller on the site that
  writes rather than mounts and that `validateFFmpegInput` never sees), `merge-audio` (decodes
  every queued file CONCURRENTLY, then resamples, then copies again — the heaviest job here),
  `audio-trimmer` (decodes TWICE, once to draw the waveform and once to cut), and
  `compress-video`/`webm-to-mp4` (the whole file in one ArrayBuffer plus a float32 AudioBuffer plus
  the muxer output).
  **`DropZone`'s `sizeCapReason` prop was dead code** — declared, rendered, and passed by no caller
  anywhere. It is wired now, so the 1536 MB number carries its reason.
  **The homepage's `∞ file size ceiling — your RAM is the only limit` tile is gone.** It was wrong
  twice over: nine tools do cap, and the wall is V8's single-buffer limit rather than RAM. It is now
  COUNTED from the registry — 86 tools take a file of any size, the other 16 name their ceiling.
  Four FAQs that softened the real failure mode ("may take longer", "may be slower") now name it as
  memory; two others were already honest and it was the spec row contradicting THEM.
  **The gate derives the truth from the code, not from a list:** `size-claims.test.ts` walks each
  UI's `lib/tools/*` import closure, static and dynamic, for an in-tab decode — so a future
  memory-bound tool that claims no ceiling goes red without anyone remembering to add it.)*
- [x] ⚠ **Honest limits (SUPERSEDED — tombstone ticked 2026-09-10).** Kept for the record; the
  live version of this item is in the Platform track, where it is assessed against the gate that
  now enforces it. ORIGINAL: The eight new tools declare
  `maxSizeMB: 1536`, which `validateFFmpegInput` genuinely enforces. But the audit found three
  UNDECLARED ceilings that make "NO SIZE CAP" false where it renders today: `compress-video` and
  `webm-to-mp4` copy the whole file into ONE ArrayBuffer (the measured wall is ~2 GB, and the
  site's own FAQ says ~100 MB); the audio tools decode to a float32 AudioBuffer at ~2× a 16-bit
  WAV; and `merge-audio` decodes N inputs concurrently. None of them can honestly take a
  `maxSizeMB` — that field is documented as *the limit the tool actually enforces*, and those
  paths enforce nothing. The missing piece is `DropZone`'s `sizeCapReason` prop, which is
  **declared and rendered but passed by no caller** — dead code today, and the natural home for
  "why this number". Also `src/app/page.tsx`'s stats tile still reads
  `"∞ file size ceiling — your RAM is the only limit"`, which the 1536 MB caps now contradict.

---

## Wave 4 — cheap-dependency categories + PWA (weeks 8–12)

- [ ] **GIF/animation cluster** — enable decode via native `ImageDecoder` + `omggif` fallback
  (~38 KB); `gifenc` already bundled for encode. Pages: `gif-maker` (images→GIF),
  `compress-gif` (gifsicle-wasm-browser, 0.34 MB), `resize-gif`, `split-gif` (frames→ZIP),
  `gif-speed-changer`, `gif-to-mp4` (WebCodecs), `webp-to-gif` / `gif-to-webp`,
  `reverse-gif`. **Owner: open "Animation" as a 6th category in `categories.ts`, or file under
  video?** (Research says 6th category; ezgif's ~250 pages prove the space.)
- [x] **Image edit verbs** (all Canvas2D, both pipelines per the dual-pipeline trap):
  `rotate-image`, `flip-image`, `watermark-image`, `pixelate-image` (region select),
  `crop-circle`, `add-border`, `social-media-image-resizer` (preset crop matrix),
  `image-splitter` (3×3 grid). Missing-half fills: `ico-to-png`, `base64-to-image`,
  `svg-to-jpg`/`svg-to-webp`, `tiff-to-png`, `avif-to-png`/`avif-to-webp`, `bmp-to-png`,
  `heic-to-webp`, `change-image-dpi` (header rewrite, not resample).
- [x] **PNG/JPEG real compression:** `@jsquash/oxipng` (0.16 MB, single-thread build ONLY) for
  `compress-png` — canvas re-encode is a no-op for PNG, this is the only honest path. Optional:
  mozjpeg (0.24 MB) upgrade for every existing compress page. Measure before/after on fixtures.
  *(**2026-09-06: BOTH ITEMS SHIPPED TOGETHER — 152 → 171 tools.** Taken as ONE batch, as the plan
  asked, because both land in `image.worker.ts` and splitting them pays the worker-rebuild and
  surface-measurement cost twice. The mozjpeg half is NOT done and is NOT recommended on this
  evidence — see the measurement note below.
  **Seven of the nineteen needed no code at all.** `tiff-to-png`, `avif-to-png`, `avif-to-webp`,
  `bmp-to-png`, `svg-to-jpg`, `svg-to-webp` and `heic-to-webp` are pure registry data on the
  existing `image-convert` toolType with `sourceFormat`/`targetFormat` — the shipped
  `avif-to-jpg` / `svg-to-png` precedent — so twelve components carry nineteen pages.
  **One shared leaf owns every verb's geometry.** `src/lib/tools/image-edit-core.ts` is DOM-free
  with zero runtime imports, and BOTH pipelines call it, so the dual-pipeline duplication that
  `project_dual_image_impl` records did not get eight more instances. `image-edit.ts` (main
  thread) and the worker's `edit` op are canvas wrappers with no arithmetic of their own.
  **oxipng, measured first-hand rather than taken from a README** (full report in the session
  scratchpad): the deep single-thread import is 164,172 B of wasm + 2,455 B of glue, gzip 75,666 B,
  and it is an ENGINES row because the wasm is served from the origin root. Apache-2.0 wrapper over
  an MIT codec (oxipng 9.1.1); a byte scan of both artifacts found none of 16 copyleft markers with
  8 positive controls proving the scan live, so no vendoring-for-replaceability was needed. **The
  honest saving is 20–35% on browser-exported PNGs** (31.5% at level 2 / 35.2% at level 4 on this
  site's own Chromium-rendered og-image), **0–3% on an already-optimised file** — where it hands
  back the byte-identical input, which the page renders as success — and **8.5–9.6% on a
  photograph**, where the page says so and points at WebP/JPEG instead. Levels 5 and 6 were
  measured returning BYTE-IDENTICAL output to level 4 at 1.9×/2.3× the time, so only 1–4 ship.
  **Three traps worth carrying.** (1) esbuild leaves `new URL(x, import.meta.url)` verbatim and
  ignores `webpackIgnore`, so the glue's default would have resolved to `/workers/…` and 404'd —
  the loader passes the URL explicitly, `?retry=N` buster included. (2) The parallel oxipng build
  needs SharedArrayBuffer, which this origin can never have; an ESLint `no-restricted-imports` rule
  now makes that unimportable rather than merely discouraged. (3) A PNG `eXIf` chunk **outranks
  `pHYs`** — measured, and re-verified independently: writing pHYs alone left the density at 96
  where writing both gave 300. `change-image-dpi` writes both, and the copy that said otherwise was
  corrected before it shipped.
  **`crop-image`'s PNG-only deferral is CLOSED**, as Wave 0's addendum said it would be: a shared
  `OutputFormatPicker` now serves the cropper and every edit verb, PNG stays the default so no
  existing user's bytes change, and all 13 PNG-only sites — two in code, six in tests, five in
  user-facing copy including three whole FAQs — were rewritten.
  **Built and reviewed multi-agent:** 10 read-only scouts → a written contract → 9 build agents on
  disjoint NEW files returning registry JSON → 5 integrators on disjoint SHARED files → an
  adversarial review → 5 fix agents. **The review is where this batch earned its keep, and it also
  produced the process finding below.**
  **⚠ A REVIEW HARNESS THAT COULD NOT FAIL, and it was mine.** The first review fan-out lost 58 of
  61 agents to a quota limit, including 7 of 10 finders. The orchestration script classified a
  finding as surviving with `votes.length > 0 && refutedCount < 2`, so when every refuter died the
  17 findings it HAD produced were all reported as "killed" — a clean "0 findings survived" over a
  verification that never ran. Same disease as `feedback_verification_gates_must_fail`, in the
  harness built to enforce it. Judged by hand instead, **the first four were all real**, including
  two P1s. **If you write a voting harness, assert the vote COUNT before reading the verdict.**
  **What the review found once it actually ran** (7 self-verifying dimensions, every finding
  carrying a reproduction the reporter constructed): **34 findings — 7 P1, 12 P2, 15 P3.** The five
  worth carrying because each is a class rather than an incident:
  1. **The canvas ceiling clamped width and height INDEPENDENTLY at 8192**, so any source with one
     edge past it was silently squashed (flip/watermark/pixelate) or cropped (rotate/border, which
     also lost its right and bottom edges). Reachable with ordinary camera files, not contrived
     ones: a 61 MP full-frame frame flipped came out **13.8% squashed**, a 50 MP photo **5.7%**.
     Now one uniform `canvasFitScale` with a disclosed `canvasCeilingWarning` derived from a
     `scaled` flag on the plan. **The existing ceiling test used a 20000×20000 SQUARE source — the
     one shape where the bug is invisible.**
  2. **`pixelate` painted its blocks in source coordinates onto a ceiling-scaled canvas**, so the
     selected region came out in the clear — a redaction-shaped tool that does not redact. The
     mapping is now a pure exported function, rounded OUTWARD so no sliver survives at the edge,
     and tested.
  3. **The `convert` op was the one encode site with no `blob.type` check.** `canvas.toBlob`
     substitutes PNG for a type it cannot write, so on WebKit `/svg-to-webp` handed back 42,399
     bytes of PNG named `.webp` — and `image-client.ts` then relabelled them with the REQUESTED
     mime. This session had added that guard to three other sites and missed the one all three new
     WebP-target pages take. The fix split deliberately: convert REFUSES (the format is the user's
     choice), compress and resize FOLLOW the encoder and rename (the format was ours).
  4. **`ico-decode` trusted DIB dimensions unsigned**, so one corrupt header fabricated a
     4,294,967,280 × 2,147,483,632 icon the page stated as fact; and one failing entry discarded
     every PNG already extracted in the same run.
  5. **Three fixes landed earlier in the same session had NO test** — deleting each left everything
     green. Fixes now gated.
  **`aboutText`'s word-count gate is UN-SKIPPED.** It had been `describe.skip`ped on a
  justification this session's own copy work falsified, and was hiding 8 real violations. It now
  enforces the 400-word ceiling with a recorded waiver list and tracks the sub-200 backlog as a
  budget that can only shrink — **not** a widened bound.
  **Gates, all green:** tsc clean · lint 0 errors / 2 standing `no-img-element` warnings · unit
  **6156 passed / 0 skipped (181 files)** — was 5373 / 152 skipped / 161 files, and the skips are
  gone because the aboutText gate now runs · default e2e **368** (was 347) · conversion e2e
  **273 + 4 designed skips in BOTH projects** (was 269+4; collection 146/131, verified nothing was
  dropped by `conversion-webkit`'s `grepInvert`) · `npm run build` **198 HTML files** (was 178) ·
  `tool-surface-heights` regenerated at 171 entries, tallest still `barcode-generator` 1558 ·
  `out/` re-verified free of `mupdf`, lamejs/heic2any still unbundled at `/vendor/`, qpdf glue
  still absent from every chunk, no `require("fs")` in any client chunk, no `pkg-parallel` or
  `SharedArrayBuffer` anywhere, and `squoosh_oxipng_bg.wasm` served from the origin root at its
  exact 164,172 bytes — each grep run beside a live positive control.
  **One pre-existing item closed in passing:** `CropPdfUI.test.tsx`'s flake. The briefing suggested
  raising its timeout; the actual race is that `loadPreview` awaited the `<img>` while every test
  depended on the Cropper being CONSTRUCTED in a later effect. It now awaits the real precondition,
  which removes the race rather than widening the window it happens in.
  **NOT done, deliberately:** the mozjpeg upgrade. It is a second engine download for the existing
  compress pages, and unlike PNG — where a canvas re-encode is a genuine no-op and oxipng is the
  only honest path — those pages already re-encode JPEG through a canvas that works. It should be
  measured against the shipped compressor on this repo's own fixtures before anyone adopts it.)*
- [x] **Developer fills:** YAML block (`yaml-to-json`, `json-to-yaml`, `yaml-formatter`;
  js-yaml ~40 KB — the only tool on all 7 surveyed dev sites, we have zero), `jwt-encoder`
  (missing half of decoder), `hmac-generator`, `json-minify`, `sort-dedupe-lines`,
  `charset-converter` + `crlf-lf` (TextDecoder), `chmod-calculator`, `http-status-codes`,
  `timezone-converter`, `byte-converter`, `aspect-ratio-calculator`, `url-parser`,
  `har-viewer` (HAR files hold auth tokens — textbook never-upload tool), `file-checksum`
  (existing hash worker over arbitrary files), `wifi-qr-code` (preset over existing QR gen).
  *(**2026-09-05: ALL EIGHTEEN SHIPPED, with `xlsx-to-csv` below — 126 → 145 tools.** One new
  dependency, `js-yaml` (MIT, ~40 KB, static import so it code-splits with the tool chunk). It was
  already on disk as a transitive at **4.3.2** but absent from `package.json`, so every YAML page
  would have worked here and broken on a clean `npm ci`; it is now a real dependency and
  `npm audit --omit=dev` is unchanged at the 8 build-time `next`/`sharp` findings.
  `yaml-to-json` and `json-to-yaml` share one toolType and one component with the direction seeded
  from the registry — the `image-convert`/`audio-convert` precedent; every other slug has its own
  type because no two share a component.
  **Category `download` stays `"0 KB"` and js-yaml gets NO homepage ENGINES row**, deliberately:
  it is a code-split text-parsing library in exactly the class of the already-shipped
  `sql-formatter`, `marked`, `turndown`, `diff` and `qrcode`, none of which has a row either. The
  ENGINES table's scope is the media/document engines. Adding one row would have reddened
  `category-hub-claims.test.tsx` and singled out one library of six identical ones. Recorded here
  because it is a judgement, not an oversight — if the owner wants that table widened to every
  code-split library, it is six rows and a `CEILING` edit, not one.
  **Copy-honesty calls made per tool, each derived from the implementation rather than asserted:**
  `jwt-encoder` offers HS256/384/512 only and says on the page that RS/ES are absent because this
  site will not ask anyone to paste a private key into a web page — and says in the subtitle, the
  aboutText and an FAQ that a JWT is **signed, not encrypted**. `charset-converter` writes UTF-8
  only, because `TextEncoder` cannot emit anything else, and frames that as a browser limit rather
  than a gap. `har-viewer`'s redact control **names the headers it strips and counts the values
  removed**, and explicitly does NOT claim the result is safe to share. `wifi-qr-code` says that
  anyone who photographs the screen has the password. `json-to-yaml` scans the raw JSON *before*
  `JSON.parse` for integer literals a double cannot hold, respelled literals and duplicate keys,
  and reports each with its line — the one direction of the pair that cannot be lossless.
  `xlsx-to-csv` reads `xl/styles.xml` to COUNT the date-formatted cells whose raw serial numbers it
  exports, rather than emitting `45678` silently.
  **Two engine facts worth carrying.** js-yaml's `dump` stringifies a DATE USED AS A MAPPING KEY
  through `String(Date)`, i.e. the browser's local zone and locale, so `2026-01-01: c` becomes
  `"Thu Jan 01 2026 05:30:00 GMT+0530 (India Standard Time)"` — machine-dependent output from a
  "conversion", now warned about with the literal key printed. And `tsconfig` targets ES2017, so
  `8n`-style BigInt literals are a `TS2737`; `bytes.ts` uses `BigInt("…")` for anything over 15
  digits so the argument does not round through a double on the way in.
  Built multi-agent: 7 read-only scouts → a written contract → 9 build agents on disjoint NEW
  files returning their registry data as JSON → 2 integrators on disjoint SHARED files → an
  adversarial review (9 dimension finders → **3 diverse refuters per finding**, majority-refuted
  dropped) → 8 fix agents + a copy integrator. **45 candidates → 42 confirmed (10 P1) → 39 fixed,
  0 disputed**, over 132 mutation tests in total.
  **The four findings worth carrying, because each is a class rather than an incident:**
  1. **`RATIO_PRESETS` stored `16:10` unreduced** — the only one of ten not in lowest terms — while
     `matchesPreset` compares a GCD-reduced input against the preset pair. So every exact 16:10
     screen (1920×1200, 1280×800, 1440×900, 2560×1600) was told *"is 8:5, not 16:10. It is 0%
     narrower than 16:10 — close enough to look right and not close enough to be it."* The unit
     test asserted `matchesPreset` for four other ratios and never for a 16:10 pair, which is
     exactly why the suite was green over it. Fixed BOTH ways: the preset is stored `8:5` labelled
     `16:10` (how 21:9 is already stored 64:27), **and** `matchesPreset` now reduces the preset
     before comparing, so a future unreduced entry is a cosmetic slip rather than a name nothing
     can match.
  2. **Nothing bound a tool slug to the UI it mounts.** `ToolClient.test.tsx` only proved the
     switch does not return `null`, so `case "json-minify": return <JsonFormatterClient />` would
     have passed every gate in the repo — including the all-tools e2e sweep, because the page still
     renders an `h1` and a control inside `[data-tool-surface]`. With 145 tools and 18 cases added
     in one batch, that was the cheapest large gap left. Now pinned per toolType.
  3. **Letterbox bars were rounded independently of the picture.** 1920×1080 into a 1000×1000 frame
     reported 219 above and 219 below a 563 px picture — **1001 px inside a 1000 px frame**. Now
     split floor-plus-remainder with the sum shown on screen, and swept over 5 frames × 3600 ratios
     in both modes for zero violations of `barsLeft + width + barsRight === frame width`.
  4. **A fabricated citation.** The JWT page attributed `your-256-bit-secret` to "the JWT
     specification's own worked example". It is jwt.io's debugger placeholder and appears in no JWT
     or JOSE RFC — and it is 19 bytes, i.e. 152 bits, whatever its name says. Both the on-screen
     warning and the FAQ now say that, which makes the warning's actual point sharper.
  **The refuters earned their keep in both directions**, as in Wave 3: three candidates died
  (including one aimed at the `OOM_TOKEN` fix, which therefore stands), and several that SURVIVED
  came back with the reporter's numbers corrected — the 16:10 banner renders a bare `0%`, not
  `0.000%`, because `decimals()` strips trailing zeroes, which makes the self-contradiction starker
  rather than milder. Read refuter notes as part of the finding, not as a verdict.
  Gates, all green after the fixes: tsc clean · lint 0 errors / 2 standing warnings · unit
  **4712 passed / 145 skipped** (was 3732/126) · default e2e **340** (was 321) · conversion e2e
  **261 + 4 designed skips in BOTH projects** (unchanged — no regression from the copy churn) ·
  `npm run build` **171 HTML files** in `out/` (was 152) · `out/` re-verified free of `mupdf`,
  lamejs/heic2any still unbundled at `/vendor/`, qpdf glue still absent from every chunk — each
  grep run beside a live positive control (pdf-lib 8, `lame_init` 4, `libheif` 1,
  `createQpdfModule` 2), so a silent zero cannot be mistaken for a pass.
  **One flake seen and deliberately not chased:** `CropPdfUI.test.tsx` failed once under 148-file
  parallel load and passes 4/4 in isolation and on re-run. It is a pre-existing `waitFor` on the
  1000 ms default in a file this batch never touched; the suite growing by ~980 tests is what
  surfaced it. Real, but not this batch's.)*
- [x] **`qr-code-reader`** — zxing-wasm (1.04 MB; `BarcodeDetector` is Chromium-only, don't rely
  on it) + `barcode-generator` (bwip-js, pure JS).
- [x] **Archive starter:** `create-zip` + `unzip-files` on already-bundled jszip (free);
  `extract-archive` (7z/tar/rar read) via archive-wasm (~1 MB) second. Extraction only — never
  advertise RAR creation (unRAR license). **Owner: category or file under developer?**
- [x] **`svg-optimizer`** — svgo v4 browser build (0.79 MB); shiki+diff already bundled for a
  before/after view.
- [x] **`docx-to-markdown`** — mammoth (0.61 MB) → existing turndown chain. (Reader-only; safe.)
- [x] **`xlsx-to-csv`** — NO SheetJS (npm build frozen 2022, unfixed CVE): XLSX is a ZIP of XML
  and jszip is bundled — unzip + DOMParser over `sheet1.xml`/`sharedStrings.xml`.
  *(2026-09-05: shipped with the developer fills above, on jszip + `DOMParser`, no SheetJS. Sparse
  cells and sparse rows are decoded from the `r` attribute and padded; `t="s"`/`"str"`/`"inlineStr"`
  /`"b"`/`"e"`/absent are all handled; a multi-run `<si>` concatenates its `<t>` children and
  honours `xml:space="preserve"`. **Dates are NOT formatted in v1 and the page says so** — but it
  reads `xl/styles.xml` and reports how many cells carry a date `numFmtId`, so the raw serial
  numbers are disclosed with a count rather than emitted silently. One sheet downloads directly,
  several come down as one ZIP through the existing `downloadFilesAsZip`. Delimiter (`,`/`;`/tab)
  and a UTF-8 BOM toggle are offered, because Excel's locale behaviour is the reason this page gets
  searched for. `.xls` and password-protected packages are OLE containers, not ZIPs; both are
  sniffed and refused by name. The unit test builds real `.xlsx` files in memory with jszip and
  round-trips them — genuine coverage, not green-over-nothing.
  Note `src/lib/tools/xlsx.ts` is **not DOM-free** (it uses `DOMParser`, like `xml-format.ts`), so
  it cannot move into a worker without a streaming-parser rewrite. It takes neither `maxSizeMB` nor
  `practicalLimitNote`: it hands its buffer to jszip **in-thread**, which is the unmeasured ceiling
  `size-claims.test.ts` deliberately declines to model.)*
  *(**2026-09-05, BATCH 2 — all seven shipped together, 145 → 152 tools**: `create-zip`,
  `unzip-files`, `barcode-generator`, `svg-optimizer`, `docx-to-markdown`, `qr-code-reader`,
  `extract-archive`. Five new dependencies, every one measured in a throwaway install before it was
  adopted rather than taken from a README.
  **TWO PLAN ASSUMPTIONS WERE WRONG, both caught by measuring:**
  1. **`archive-wasm` is GPL-3.0-or-later** — declared in its own `package.json`, with a GPLv3
     licence file shipped. Disqualifying under the closed-source posture, and the FFmpeg
     separate-program arrangement is not being extended to anything new. Note this is **not** the
     unRAR problem the plan anticipated and **not** a libarchive problem: libarchive is BSD-style
     with zero copyleft, and the GPL is the wrapper author's own choice.
     **Replaced with `libarchive-wasm` 1.2.0 (MIT)** — smaller (613,235 B against 1,002,547 B) and
     **read-only BY CONSTRUCTION**: 16 `archive_read_support_format_*` symbols and **zero**
     `archive_write_set_format_*`. The plan asked for "extraction only, never advertise RAR
     creation"; an engine that structurally cannot write an archive satisfies that better than a
     policy does, and the page says so in those terms. Engine self-report:
     `libarchive 3.7.7 zlib/1.3.1 liblzma/5.6.4 bz2lib/1.0.8`.
  2. **The size figures.** The plan's 1.04 MB / 0.79 MB / 0.61 MB are package sizes. What matters is
     what is SEPARATELY FETCHED. `qpdf.js` and `qpdf.wasm` are both staged to the origin root, which
     is why qpdf's row legitimately quotes the pair — but zxing's and libarchive's glue is an npm
     module that ends up inside the tool's own code-split chunk, so only the `.wasm` is a download.
     Measured: **zxing 1,093,289 B gives "1.0 MB"**, **libarchive 613,235 B gives "599 KB"**, on the
     DOWNLOAD column's own binary/one-decimal ruler.
  **THE DEVELOPER HUB NO LONGER SAYS "0 KB".** It reads **`0–1.0 MB`** (U+2013). That claim is a
  chain of five surfaces pinned by two tests, and all of it moved: the two ENGINES rows on the
  homepage, `CEILING["developer-tools"]`, the category string and its now-false comment, the
  duplicate `engine:` on the homepage category card that no test ties to `categories.ts`,
  `/privacy`'s External resources, and `/licenses`. **The green went with it** — `CategoryHubPage`
  paints the DOWNLOAD stat `text-success` only when the string is exactly `"0 KB"`, and the test
  hardcoded developer-tools as the green one, so that assertion had to be INVERTED rather than
  moved: **no hub is green now.**
  **A BUILD BLOCKER worth recording, because the repo had already solved it once and forgotten.**
  `libarchive-wasm`'s Emscripten glue calls `require("fs")`, `require("path")` and
  `require("crypto")` inside `if (ENVIRONMENT_IS_NODE)`. That branch is dead in a browser, but a
  bundler resolves `require()` STATICALLY, so the graph failed with `Module not found: Can't resolve
  'fs'` — and it took down **all seven** new pages, not just `/extract-archive`, because the error
  poisons the whole compilation rather than one route. The cure is the one this repo used for
  mupdf's glue and deleted when mupdf left: `turbopack.resolveAlias` with
  `{ browser: "./src/lib/empty-module.js" }`. That stub file is back, and its header now records why,
  so the next removal does not repeat the cycle. Found by probing every new page for a mounted
  `[data-tool-surface]` — which is also what `measure-tool-surfaces.mjs` hangs on, timing out after
  30 s with no indication of which slug did it.
  **jszip facts measured while building the two ZIP tools, both silent-loss classes:** a duplicate
  filename is silently REPLACED (two `file("dup.txt")` calls leave one entry), and a pre-1980 date
  WRAPS (1970 becomes 2098) because the DOS year is 7 bits from 1980 and jszip masks rather than
  checks. Both are guarded now. Also `JSZip.loadAsync` is all-or-nothing — one encrypted entry
  throws for the whole archive and cannot say which entry did it — so `zip-tools.ts` carries a
  hand-written, DOM-free central-directory reader that names every failure BEFORE anything is
  opened, and REFUSES zip-slip paths rather than silently repairing them the way jszip does
  (`../../etc/passwd` becomes `etc/passwd`).
  **A SELF-HOSTING GUARD NOW EXISTS FOR THE NEW ENGINES, and writing it exposed that the old one
  could not have caught this.** `forbidCdnCore` tested the HOST against
  `/unpkg\.com|cdn\.jsdelivr\.net/` — and zxing-wasm's default is **fastly**.jsdelivr.net, which
  that pattern misses entirely. A two-host allowlist was quietly not covering the hazard it is
  named for. It now tests the ORIGIN, so there is no list left to fall out of date. For the new
  engines, `watchEngineRequests` (a generalisation of `watchQpdfRequests`, which delegates to it as
  a proven no-op) records rather than throws and asserts **two-sidedly**: a foreign origin fails,
  and so does "the engine never loaded, so this test proved nothing". All four directions — foreign
  origin and never-fetched, for both zxing and libarchive — were proven RED before being restored.
  Worth knowing: with zxing pointed at jsDelivr the tool still worked end to end and only the guard
  fired, which is exactly the silent failure the guard exists for.
  **Adversarially reviewed like batch 1** (8 dimension finders, 3 diverse refuters each,
  majority-refuted dropped): **49 candidates, 47 confirmed (8 P1), 53 fixes landed, 9 findings
  DISPUTED back by the fix agents with evidence, 93 mutation tests.** The headline P1 is worth
  carrying because it is a RULER problem, not a typo: `/licenses` said the barcode generator
  "draws its own symbols in JavaScript through bwip-js and fetches nothing", while clicking
  Generate fetches a **947,409-byte** code-split chunk (~246 KiB gzipped). The refuters corrected
  the dimension (copy honesty, not privacy — nothing leaves the origin) and then WIDENED it: the
  homepage writes bwip-js out of ENGINES as a "bundled parsing library", but
  `image-convert.ts`'s `await import("utif2")` is the SAME mechanism and utif2 IS in the table at
  96 KB; and `categories.ts` justified the hub's floor with "the other fifty-odd tools here fetch
  nothing at all", which is false for /barcode-generator and /docx-to-markdown (489,613 B). One
  rule now governs every surface. Three more P1s were real data loss: a truncated ZIP promised N
  extractable files and delivered none; extra field **0x7075 (Unicode Path)** was ignored, so
  WinRAR/WinZip entries listed under a mojibake name and then could not be extracted; and a bare
  `%` in a `mailto:`/`tel:`/`geo:` QR payload threw `URIError` out of the payload PRETTIFIER and
  reported the whole image as unscannable — a decode that had already succeeded.
  **The DOS-timestamp P1 was fixed in the CODE, not the copy**, and the reasoning is the general
  one: a DOS timestamp is local wall clock with no zone, which is how Finder, Explorer, 7-Zip and
  `unzip` all read it, so jszip writing it from UTC fields shifted every date by the viewer's
  offset. Measured in Asia/Kolkata, 14:35:23 stored as 09:05:22; it now stores 14:35:22. The shift
  happens BEFORE the clamp and that order is load-bearing — `DOS_TIME_MIN` is a UTC constant
  standing for a wall-clock window, so clamping first accused every file stamped early on
  1 Jan 1980 east of Greenwich of carrying an unstorable date.
  **A correction to this session's own `next.config.ts` note**, made by a fix agent and worth
  keeping: the three browser stubs are NOT there for the same reason. Only `fs` failed to resolve —
  Next ships browser polyfills for `path` and `crypto` and none for `fs`. So the `fs` alias buys a
  green build; the other two buy a smaller chunk (a 364 KB crypto polyfill and 16 KB of path, both
  serving one `require` in dead code). `src/__tests__/unit/lib/next-config-browser-stubs.test.ts`
  now pins the alias map to what libarchive's glue actually requires, asserts those requires are
  still inside the dead `ENVIRONMENT_IS_NODE` branch, and fails if anything under `src/` starts
  importing one of them for real — which is what makes "delete the alias when its last consumer
  leaves" enforceable rather than advisory.
  Gates after the fixes: tsc clean · lint 0 errors / 2 standing warnings · unit **5373 passed /
  152 skipped** · default e2e **347** (was 340) · conversion e2e **269 + 4 designed skips in BOTH projects**
  (was 261+4; collection 144/129, verified nothing was dropped by `conversion-webkit`'s
  `grepInvert`) · build **178 HTML files** · `out/` carries `zxing_reader.wasm` and
  `libarchive.wasm` at the origin root beside the FFmpeg and qpdf cores, with zero `require("fs")`
  in any client chunk.)*
- [x] **PWA completion** (icons already exist in `public/`): ~~manifest~~ + service worker
  (offline precache: app shell always; 31 MB FFmpeg core opt-in "make available offline"
  toggle), `share_target` (Android share sheet → compress/convert), `file_handlers`
  (double-click `.heic` opens us). This is the moat item — no upload-based competitor can copy it.
  *(**2026-09-05 correction, made before anyone scopes this: the manifest ALREADY SHIPS.**
  `src/app/manifest.ts` has existed since the redesign commit `2ea0ab3`, is
  `export const dynamic = "force-static"` (which `output: "export"` requires for a metadata
  route), declares all three existing icons including the maskable one, and builds to
  `/manifest.webmanifest` — it is in the current build's route list. So this item is smaller than
  it reads, and its remaining parts are: a service worker, the opt-in offline toggle, and the two
  handler declarations. What is genuinely absent is any `serviceWorker` reference anywhere in
  `src/` — grep returns nothing.
  **Two constraints for whoever takes it, neither of which is a detail.** (1) The 31 MB core must
  be an opt-in toggle, not a precache — a service worker that quietly pulls 31 MB on first visit
  would be the largest silent cost this site has ever imposed, on a site whose whole pitch is that
  it does not do things behind your back. (2) "Works offline" is a user-facing CLAIM and therefore
  a P1 copy-honesty surface here: the app shell being cached is not the same as the tool working,
  because eleven tools need a WASM engine that is only there if the user opted in. Any offline
  copy has to say which tools work offline **and which do not**, derived from what is actually in
  the Cache API rather than asserted — the same "derive it from the run" rule that
  `RemuxResult.streamCopied` and this wave's `NormalizeAudioResult.twoPass` follow.)*
  *(**2026-09-10: SHIPPED.** Service worker, opt-in offline, `share_target`, `file_handlers` —
  and the 2026-09-05 correction above was right about the manifest: it already shipped, so the
  work was the other four.
  **Scouted before it was written, because a service worker persists on a device and can pin a
  dead build forever.** That risk is MEASURED here, not theoretical: the live `index.html`
  references 13 top-level assets and **4 no longer exist** in the pending build, and a missing
  chunk on GitHub Pages returns **`404`, `text/html`, `39,976 bytes`** — a 40 KB error page served
  where JavaScript was expected. So HTML is network-first, always, and so are the **190 un-hashed
  `.txt` RSC payloads** whose bodies embed hashed chunk names (the third asset class most recipes
  miss; `trailingSlash: false` also means a precache built by globbing `*.html` would never match
  a navigation, because Next emits `merge-pdf.html` for a `/merge-pdf` request). Only
  content-hashed `_next/static/**` is cache-first.
  **The decision is a pure module.** `src/lib/pwa/sw-policy.ts` holds every rule and is unit-tested
  in jsdom; `service-worker.ts` decides nothing. That split exists because jsdom has no
  `ServiceWorkerGlobalScope`, no `ExtendableEvent` and no Cache API — logic that stays in the
  worker is logic that ships unverified. The anti-brick assertion (a navigation and a `.txt` NEVER
  return `cache-first`) is mutation-proven.
  **No engine is ever precached**, and the worker contains no `cache.put` on the engine path at
  all: it serves an engine from cache if it is already there and otherwise passes it to the network
  WITHOUT adding it. Only the page's explicit, sized opt-in writes `ENGINE_CACHE`.
  **The offline map is derived, and its shape is the product insight:** **126 of 171 tools need no
  origin-root engine binary.** Of the 45 that do, everything EXCEPT FFmpeg totals 5.8 MB and covers
  13 tools, while FFmpeg alone is 30.8 MB for 32 — so the settings page leads with that rather than
  with one 31 MB button. Two corrections produced those numbers: cutting `media-preview.ts:14 →
  audio-decode.ts` took FFmpeg 39→32, and guard-checking `image-convert.ts:230` took heic2any 63→5
  and `CompressPngUI.tsx:212` took oxipng 61→1.
  ⚠ **Status is re-derived from `caches.match()` on every read, never remembered** — eviction is
  per-origin and TOTAL ("all of its data, not parts of it"), with no event, so a stored boolean is
  a lie waiting to happen. `addBundle` leaves nothing behind on failure: a half-cached 30 MB engine
  that reads as present is the exact failure the design exists to avoid.
  ⚠ **12 audio tools are neither "works offline" nor "does not".** `audio-decode.ts:411-419`
  reaches FFmpeg only AFTER `decodeAudioData` REJECTS, so the 30 MB is decided per file, per
  browser, at runtime. The UI carries a third value for them rather than an optimistic badge.
  **`share_target` is SW-only by necessity** — there is no server, so the worker intercepts the
  POST, stashes the files under `/_shared/<uuid>/<i>` in the shell cache and 303-redirects to a GET
  the landing page reads and then deletes. Cache API beat postMessage (at POST time no client
  exists) and IndexedDB (a second worker import and an upgrade path, against one `cache.put`).
  `/privacy` discloses that one-navigation window explicitly.
  **Registration is production-only**, and not for tidiness: the default e2e runs against
  `next dev`, and `conversion/video.spec.ts:120` stalls the core with `page.route`, which
  Playwright's own typings say cannot intercept what a service worker handles. So the feature gets
  its own env-gated project — `npm run test:e2e:pwa`, **16 tests** — serving the BUILT `out/` over
  Node's own `http`, mirroring how the conversion suite is gated. It asserts two-sidedly that the
  shell IS cached and the engines are NOT.
  **Two copy defects fixed rather than inherited**, both pre-existing: `/privacy` said Transmute
  "sets none of its own" browser storage, which a cache falsifies; and `ToolPageLayout` printed
  `{engine} READY` from a STATIC registry string on all 171 pages, so `/wma-to-mp3` claimed
  `FFMPEG · LAMEJS READY` while offline with an empty cache. The word is gone — the pipeline strip
  40px above already names the engine — and the bar's geometry is unchanged, so no height
  regeneration was needed.
  **A third defect found in passing and fixed:** the homepage lamejs ENGINES row read `254 KB`
  against a 259,508-byte artifact (253.4 KiB → 253; decimal would be 260, so 254 was neither).
  It was the last ENGINES row quoting a number nothing checked — `engine-disclosure.test.ts` even
  computed 253.4 in a comment and wrote 254 one line later. Both vendored rows are now pinned to
  their artifacts.
  **Unverified, and worth knowing:** GitHub Pages' extension-less resolution order could not be
  checked without a deploy, so the static server the PWA suite uses documents its choice as an
  explicit assumption and no spec depends on the ambiguous case. `launch_handler` is deliberately
  NOT declared — which `client_mode` "auto" picks for a file launch could not be verified.)*
- [ ] Deferred small bets (build only if a slot opens): `png-to-svg` (vtracer WASM — NOT
  @neplex/vectorizer which is a Node addon; potrace is GPL), `font-converter`
  (fonteditor-core, MIT — test variable fonts), `bcrypt-generator` (bcryptjs),
  `vcf-to-csv`, `ics-to-csv`, `markdown-table-generator`, `csv-markdown-table`.
- [ ] ⚠ **Owner: libheif-js swap** for the abandoned `heic2any` (fixes multi-image HEIC / Live
  Photos) — **LGPL-3.0; get a licensing answer before committing.** *(2026-08-31 answer:
  LGPL is compatible with the closed posture WITH the vendoring cure — separate replaceable
  file at a stable `/vendor/` URL, notices on /licenses; heic2any already embeds libheif
  today and gets the same cure in the remediation wave. Decode-only builds only — HEVC-encode
  libheif builds pull GPL x265.)*

---

## Wave 5 — flagship builds (quarter 2; strict dependency order)

- [ ] **1. `image-to-text` (OCR) — NOT BUILT. The size question this item asks to settle is now
  SETTLED, 2026-09-10, so whoever takes it starts from numbers instead of a conflict.** Measured
  from the registry without installing anything (`npm view … dist.unpackedSize`, and a HEAD
  request for the language data):
  * `tesseract.js` **7.0.0** — 1,411,341 B unpacked. This is the JS wrapper only.
  * `tesseract.js-core` **6.1.2** — 30,606,788 B unpacked, but that is EVERY variant in one
    package (SIMD and non-SIMD, LSTM-only and full). A build ships ONE, so this figure is an
    upper bound on the package, not on the download.
  * `eng.traineddata` (4.0.0_best_int) — **2,952,873 B**, fetched separately from the core.
  So the item's "claims conflict: 2–30 MB" resolves as: the LANGUAGE DATA is ~2.95 MB and the
  30 MB is the whole multi-variant core package. The real per-visitor download is one core
  variant plus one traineddata, and the exact core figure needs the variant chosen first —
  measure it from the staged artifact, the way qpdf and oxipng were, not from the package.
  **⚠ THE EXPENSIVE PART IS NOT THE ENGINE, IT IS THE DISCLOSURE.** A new served artifact has to
  land on SIX pinned surfaces, each with a test asserting exact bytes: the homepage `ENGINES`
  table (key order `name, handles, size, when` — the parser regex requires it), `/privacy`'s
  External resources with the exact `toLocaleString("en-US")` count AND the "none of the seven"
  counter, `src/content/blog/why-browser-based-tools-are-private.mdx`'s byte counts,
  `/licenses`, `Category.download` in categories.ts, and `CEILING` in
  `category-hub-claims.test.tsx`. Budget for that, not just for the tool.
  ORIGINAL ITEM: tesseract.js v7, **self-hosted** (default config hits a CDN —
  would break the zero-third-party property and `forbidCdnCore`'s spirit; add an equivalent
  guard). Measure real traineddata size at build (claims conflict: 2–30 MB). Lazy-load,
  English-first, preprocessing (deskew/contrast) matters more than the engine.
- [x] **2. `pdf-editor` — SHIPPED 2026-09-10, v1 exactly as scoped.** The item's own framing held
  up: pdfjs renders, pdf-lib writes, **zero new dependencies**. It cost far less than its billing
  because the four stamping tools shipped earlier the same day had already built the engine —
  `stampPdf` places text, images and rectangles, so add-text, add-image and whiteout are three
  configurations of one op, and `deletePdfPages` already existed. **The only new engine work was
  `PdfPathStamp`**, a freehand stroke, and it is the cleanest of the four kinds: its points are
  fractions of the DISPLAYED page mapped through `fractionToUserSpace` INDEPENDENTLY, so it needs
  no anchor correction and a page's own `/Rotate` falls out for free — verified putting the first
  point at (0.100, 0.100) on all four rotations.
  **v1 is the five verbs the item names**: add text, add image, whiteout, freehand, delete page.
  **And it leads with what it cannot do**, which is the whole reason this page is dangerous to
  ship carelessly: the `description`, the `aboutText`, an FAQ and a footnote ON THE CANVAS all
  say that the text already in the PDF cannot be retyped, because a page is glyphs at fixed
  coordinates with nothing to reflow. A second canvas footnote says **whiteout is paint, not
  redaction** — the covered text is still in the file and still copyable.
  **Two findings from building it, both worth keeping:**
  * ⚠ **A stale comment justified duplicated data, and the duplication is now gone.**
    `AnnotatePdfUI` carried its own copy of the 218-codepoint WinAnsi table under a 60-line
    justification: that `unsupportedStampCharacters()` lived in `pdf-engine-core` (pdf-lib's
    705 KB eager chunk) and would answer WRONGLY on the main thread anyway, because its probe
    font was only initialised inside the pool worker. Both were true when written and neither
    survived the same day: the function moved to `pdf-stamp-core.ts`, which has zero imports, and
    became a pure table with no probe to be uninitialised. The component now imports it, so the
    check the user sees on keypress and the check that refuses the run are literally the same
    code — and `pdf-stamp-core.test.ts` re-derives that table against pdf-lib across the whole
    BMP, failing in BOTH directions, which a second copy could never have been held to.
  * The `points.length < 2` guard in the path branch is **unobservable** — the segment loop
    starts at 1, so zero and one point already draw nothing. Kept as documentation of intent, but
    it is not a behaviour any test can pin, and the agent that tried said so rather than writing
    a test that could not fail.
  ORIGINAL ITEM: Highest expected value in the research. pdfjs renders, pdf-lib writes —
  zero new deps; the cost is the editing canvas (selection, undo, canvas↔PDF coordinate
  mapping). v1 scope: add-text, add-image, whiteout, freehand, delete-page — and say plainly
  body text is not editable (Adobe's free tier can't either). Competitors cap at 2–3 tasks/day;
  "unlimited, no account, never uploaded" is the pitch.
- [x] ~~**3. `docx-to-pdf`.**~~ **DEAD; tombstone ticked 2026-09-10** so it stops reading as
  queued work. *(DEAD 2026-08-31 — the MuPDF Office reader leaves with
  MuPDF under the closed posture; see Wave 2 REVISED.)* Office reader runtime-verified, zero bytes. MuPDF reflows (Office →
  HTML): page breaks/headers/columns won't match Word. Ship with an unmissable fidelity note +
  side-by-side preview before download. **Do NOT ship `pdf-to-word`** (writer compiled out; a
  text dump on the biggest PDF query burns the trust everything else depends on). Skip
  `pptx-to-pdf` (slides reflow into a text river).
- [ ] **4. `ocr-pdf`.** Only after 1 proves the pipeline: render page (existing pdf.worker) →
  tesseract hOCR → invisible render-mode-3 text layer via pdf-lib. 2–10 s/page; page-count gate
  + streaming progress.
- [ ] **Go/no-go — the PAPER WORK IS DONE 2026-09-10; the decision itself is the owner's,
  because both options commit real bandwidth and product direction.** Assessed against this
  item's own gates, with what could be checked, checked:
  * **`background-remover` — the licensing gate this item sets is currently FAILED by both
    leading options, on rules this project has ALREADY SETTLED.** `@imgly/background-removal`
    1.7.0 publishes `license: "SEE LICENSE IN LICENSE.md"` rather than an SPDX identifier — i.e.
    a licence that has to be read before it can be relied on, which is itself a finding for a
    dependency this repo would have to vendor and self-host. The commonly-cited RMBG models are
    published under non-commercial terms. **AGPL is disqualifying here (settled 2026-08-31, and
    it is why MuPDF was removed rather than licensed), and a non-commercial model is
    disqualifying for a site carrying ads.** So the honest position is not "not yet" but
    "not on these terms": the gate asks for a sub-100 MiB quantised model with a PERMISSIVE
    licence, and finding one is the prerequisite, not the model size. ⚠ Verify the exact terms
    against the source before acting on this — the npm metadata above is a pointer, not a licence
    review.
  * **Whisper (`audio-to-text` / `video-to-text` / SRT export as ONE build) — no licensing
    blocker; the blocker is bandwidth and it is arithmetic.** `@huggingface/transformers` 4.2.0
    is **Apache-2.0**, so the runtime is clean, and Whisper's own weights are permissively
    licensed. At the item's own ~85–120 MB, GitHub Pages' soft ~100 GB/month allowance is
    exhausted by roughly **850–1,200 downloads a month** — and this site already serves a 32 MB
    FFmpeg core. That is the number the decision turns on, and it is a hosting decision rather
    than an engineering one. The item's recorded trap stands and is the strongest reason to build
    it rather than fake it: Chrome's `SpeechRecognition` streams audio to Google, so using it
    would silently break the one promise this whole site is built on. **Whisper or nothing.**
  ORIGINAL GATES:
  - `background-remover` — largest raw demand in the audit. Gates: a sub-100 MiB quantized
    model (GitHub hard file limit) with a **permissive license** (RMBG-1.4 is non-commercial;
    @imgly is AGPL w/ CDN default), self-hosted, `navigator.gpu` gate, download size shown,
    Cache API persistence, Pages bandwidth math.
  - Whisper transcription (`audio-to-text`/`video-to-text`/SRT export = ONE build) — ~85–120 MB,
    WebGPU effectively required. Trap (verified in research): Chrome's `SpeechRecognition`
    streams audio to Google — using it would silently break the core promise. Whisper or nothing.

---

## Platform track (parallel to any wave)

- [x] **Accessibility — AUDITED AND LARGELY FIXED 2026-09-10.** Lighthouse had scored 96 on the
  only two pages it ever ran and the surface had never been audited. 178 tool pages sit on about
  40 components, so the audit went at the SHARED ones. It found **4 P1s, 8 P2s and 11 P3s**, each
  with file:line, a WCAG success criterion and the concrete failure a real user hits.
  **The four P1s are all fixed:**
  1. **The crop box was 100% mouse-only** (WCAG 2.1.1 Keyboard, A) on `/crop-image` and
     `/crop-pdf`. cropperjs 1.6.2 contains ZERO keyboard code — `grep -c keydown` returns 0,
     `tabindex` 0, `aria-` 0, against a positive control of 3 for `mousedown|pointerdown`. Fixed
     by following the pattern `PixelateImageUI` already had: number fields that ARE the stored
     rectangle, so drag and keyboard cannot disagree. For `crop-pdf` they are in POINTS from the
     page's top-left rather than preview pixels, because preview pixels are an artefact of the
     render scale the component happens to pick.
  2. **Assembly order was drag-only** on `merge-pdf` and `images-to-pdf` (2.1.1 A, and 2.5.7
     Dragging Movements AA) — a user who cannot drag could not choose their page order, which is
     the entire tool. Fixed on the model of `PdfPageReorderUI`, which already had arrow keys,
     Move buttons and a live region, so the three reordering surfaces now behave alike.
  3. **Focus was destroyed on every successful run** (2.4.3 Focus Order, A), at all 70+
     DownloadButton sites: the focused primary unmounts when the result arrives and focus falls
     to `<body>`, so the next Tab starts at the top of the document. DownloadButton now takes the
     focus the unmounting primary dropped — but ONLY when `document.activeElement` is `<body>`,
     so a user who tabbed away mid-run is not yanked back. Both directions are pinned.
  4. **Nothing announced that a conversion had FINISHED** (4.1.3 Status Messages, AA). Failure was
     announced at 96 `role="alert"` sites; success at none. `ToolDone` is now a live region.
  **Most P2/P3s too**: the invisible focus ring on CompareStage's `opacity-0` slider, a roving
  tabindex on the page listbox (a 60-page deck was 60 tab stops), keyboard-scrollable text panes,
  MobileNav's missing focus trap, `motion-reduce:` escapes, the unreliable ToolProgress live
  region, heading order, canvas names and several contrast tokens.
  **⚠ THE AUDIT WAS WRONG IN PLACES AND THE IMPLEMENTERS CAUGHT IT** — worth carrying, because
  the natural instinct with a detailed audit is to paste its prescriptions:
  * Its verbatim ImageCropperUI replacement was wrong three ways (it round-tripped the whole
    rectangle including a `rotate` key, added a second writer of the same state, and left the
    fields live before cropperjs was ready).
  * Its contrast prescription **did not reach 3:1**: it claimed `neutral-700 #595d6c` measures
    3.31:1 and that was not reproducible. Every ratio was recomputed from scratch instead.
  * One prescribed fix would have introduced a NEW ARIA violation (`role="option"` on children
    that are not all options), and another would have disabled pointer events on the control it
    was meant to make visible.
  * Its own greps disagreed with each other (8 vs 19 vs 7 for one positive control).
  **Deliberately NOT done, and recorded rather than quietly dropped:** the `aria-pressed` →
  radiogroup change (P3-8). The audit's own appendix says it should be a separate change, and the
  measured blast radius is ~80 components. Also outstanding: a handful of non-text contrast
  tokens inside ToolCanvas, and the remaining `motion-reduce:` sites there.

- [x] **SHIPPED BUG: every `images-to-pdf` tool placed a rotated photo wrongly — FIXED
  2026-09-10.** All six tools on that toolType (`images-to-pdf`, `jpg-to-pdf`, `png-to-pdf`,
  `heic-to-pdf`, `webp-to-pdf`, `tiff-to-pdf`). `embedJpg` embeds the ORIGINAL bytes and takes
  its dimensions from the stored sample grid; a PDF reader never reads EXIF inside a
  `/DCTDecode` stream, but **every image viewer does**. So a phone photo carrying Orientation 6
  is 800×600 in the file and 600×800 on screen, and the page was built from the stored grid —
  producing a landscape page with the photo lying on its side AND stretched to the wrong aspect
  ratio. Verified on the repo's own checked-in fixture: `sample-photo-portrait.jpg` reads EXIF
  Orientation 6 while `embedJpg` reports `800x600`.
  **It was visible in the product the whole time**: the thumbnail strip renders the SAME bytes
  through a plain `<img>`, which honours EXIF, so the preview showed the photo upright and the
  download showed it sideways.
  **`neutraliseJpegOrientation` — the cure `recompress-pdf-images` uses — is the WRONG tool
  here** and would have changed nothing: it rewrites a tag the PDF reader was already ignoring.
  The bytes are embedded as-is, so the answer is a placement transform. Geometry lives in a new
  DOM-free leaf, `src/lib/tools/pdf-stamp-core.ts`, whose EXIF table was derived twice
  independently — once from the tag's own (row0, col0) definition and once against Chrome's own
  decoder on a spliced JPEG — because **the orchestrator's first table had orientations 5 and 7
  swapped** and the build agent disputed it with evidence. 5 is the transpose (mirror-h then 90°
  CCW); 7 is the transverse (mirror-h then 90° CW). Note for callers: `rotate` is degrees
  COUNTER-clockwise, so orientation 6 ("rotated 90° clockwise", the commonest real value) is
  `rotate: 270`. It reads backwards and is correct.
  **PNG had the identical bug** via the `eXIf` chunk — Chrome applies it, pdf-lib's PNG path
  takes width and height straight from the IHDR — and this repo can produce such a file itself,
  because `change-image-dpi` writes an `eXIf` chunk. Both are read by the new leaf
  `src/lib/tools/image-orientation.ts`.
  **Fixed with `fit` now producing a 600×800 portrait page** (was 800×600) and A4 placing the
  photo portrait-shaped inside the margin, while an Orientation-1 photo's output is
  **byte-identical** to before. Four regression tests; mutations red.
  ⚠ **No `images-to-pdf` test used the rotated fixture, which is why it shipped** — the fixture
  has been checked in since Wave 0 and was used only by `jpg-to-png`, `image-dpi` and the
  `jpeg-orientation` unit test.

- [x] **Carried defects from the 2026-09-10 handoff — CLOSED 2026-09-10, except one, recorded
  below.**
  * **`video-frames.ts` carried a FALSE comment, and so did its warning.** The comment claimed
    that on a 2.090 s source "the clip really does carry a picture" at the 2.000 s moment. Read
    straight out of the container it does not: `mvhd` 2090/1000 = 2.090 s, the **video** `mdhd`
    is 115200/57600 = **exactly 2.000 s**, the **audio** `mdhd` is 92160/44100 = 2.0897959 s,
    and `stts` is `48 x 2400` — 48 frames at 1/24 s, the last STARTING at 47/24 = 1.9583 s and
    finishing at 2.000 s. So `<video>.duration` is the AUDIO track and there is no picture at
    2.000 s. The user-facing sentence blamed "playback reached the end of the clip"; it now says
    the video ran out of pictures, and explains that a clip's stated length is usually its audio.
    The unit test pinned the falsified explanation and was updated with the box numbers in it.
    (1/24 = 0.0416666… is also exactly the recorded first `requestVideoFrameCallback`
    `mediaTime`, confirming that frame k=0 is never delivered.)
  * **`QpdfToolShell`'s engine note now points at `/offline-access`.** It named "an offline tab"
    as a cause the reader could do nothing about; since the PWA work landed, qpdf is one of the
    storable bundles. It deliberately does NOT claim the engine IS stored — that needs a Cache
    API lookup this component does not make, and eviction is per-origin, total and silent.
  * **STILL OPEN — the first-frame drop.** `requestVideoFrameCallback` only fires for NEWLY
    PRESENTED frames, so the frame already showing at the start position is never delivered:
    first `mediaTime` is 1/24 (MP4) / 0.041 (WebM), never 0, in both engines. `/compress-video`
    and `/webm-to-mp4` therefore drop their first frame. Left alone deliberately — fixing it
    changes four tools' frame counts, so it wants its own measured pass with the conversion
    suite as the gate. **Do not confuse it with the defect the plan used to record** ("drops the
    last planned frame at end-of-clip"), which was investigated, does NOT reproduce, and whose
    sketched repair was measured producing a DUPLICATE frame stamped at a moment the clip has no
    picture at. `video-utils.ts` carries those numbers in a comment.
  * **STILL OPEN — the per-tool offline map** (`ToolPageLayout.tsx`'s "STILL UNDONE" marker).
    The status bar can say what is stored but not per-tool "this one works offline", because
    that needs an engine→tool map. `src/lib/pwa/offline.ts` has the bundle→tool COUNTS
    (`toolCount` per bundle) but not the slug→bundle mapping, and deriving it honestly means
    tracing each tool's reachable code path — which is how those counts were produced, by hand.

- [x] **Two gates that could not fail, both FIXED 2026-09-10.** Same disease as
  `feedback_verification_gates_must_fail`, in two new costumes.
  1. **The how-to control check covered 3 tools out of 121.** `HOW_TO_STEPS_BY_TOOL_TYPE`
     renders as VISIBLE page copy and as HowTo JSON-LD, and `tool-copy-claims.test.ts` asserts
     each named control exists — for `compress-video-to-size`, `extract-images-from-pdf` and
     `subtitle-converter` only, each with a hand-written list. That is why `exif-viewer`'s
     "Optionally export the metadata as JSON" shipped with every gate green over a UI that has
     never had a JSON export of any kind. Replaced by a GENERAL gate,
     `src/__tests__/unit/data/howto-controls.test.ts`, which derives the whole chain from source
     (toolType → client → UI component → the components it imports) and checks every
     `Click X` / `Press X` / `Tap X`. It found one more live inaccuracy immediately:
     `screen-recorder` said "Click Stop" for a button that has always read **"Stop and save"**.
     Proven able to fail in three independent directions (a step naming an absent control, a
     broken chain parser, broken label extraction), and it carries an explicit note on the two
     things it deliberately does NOT catch.
  2. **`license-notices.test.ts` fixed once and then self-healed.** Its comment said it
     "regenerates into a temporary location and compares"; it actually ran the generator against
     the repo root, so the generator **overwrote the checked-in file between the `before` read
     and the `after` read**. A stale notices file therefore went red exactly once and was
     repaired by the run that reported it — the next run was green with nothing done, which
     reads as "fixed". It also meant a unit test mutated the working tree. The generator now
     takes `--out-dir`; both call sites in the test use it. ⚠ **The second call site was found
     only by mutation-testing the fix** — appending a marker line still went red once and green
     on the re-run until it was changed too. It now fails on runs 1, 2 and 3 and leaves the tree
     alone.

- [x] **`out/workers/` shipped 5,288,473 bytes of dead code in every deploy — FIXED 2026-09-10.**
  Found while scouting the PWA, unrelated to it. `scripts/build-workers.mjs` bundles with
  `splitting: true` into a gitignored `public/workers`, and **never cleaned the outdir**, so chunks
  from every earlier build accumulated and `output: "export"` copied the lot. Measured: **29 files,
  5,815,816 bytes, of which only 12 files / 527,343 bytes were live** — 14 stale
  `pdf-engine-core-*.js` at ~435 KB each, 3 `pdf-image-core-*.js`, 1 orphaned chunk. "Live" was
  derived from what the emitted entrypoints actually import, not from mtime. After the clean:
  **12 files, 527,343 bytes**, idempotent across three runs, and all 12 SHA-256 identical to the
  pre-clean live set, so the change is output-neutral. The clean is scoped to that outdir's
  top-level `.js`/`.js.map` — never `rm -rf`, never a subdirectory — because `public/` also holds
  tracked files (CNAME, robots.txt, the icons, og-image.png) and `public/sw.js` now lands beside
  them. Every other `copy:wasm` target was checked and is structurally immune: each is `cp`ed under
  a fixed name, so builds overwrite in place.

- [x] **Prove the privacy claim in-product — TWO OF THREE DONE 2026-09-10; the CSP half is
  deliberately deferred, with reasons.**
  **The counter shipped, and it replaced a claim rather than adding one.** The tool status bar
  ended with the literal string `0 BYTES SENT` — true, and unfalsifiable, which is the same
  objection that took the word READY off the ENGINE cell one wave earlier. It now renders
  `RequestReadout`, which reads this document's own `PerformanceResourceTiming` entries and
  reports them split by origin.
  ⚠ **It says REQUESTS, not bytes, and that narrowing is the honest part.** The API exposes
  `transferSize` — bytes RECEIVED — and nothing whatever about a request body, so
  "0 BYTES SENT" is exactly the sentence this measurement cannot carry. A page printing it as a
  measured fact would be claiming something the browser never told it. A unit test asserts the
  readout never says "byte" or "sent" in any state, and it is mutation-proven by putting the old
  string back.
  ⚠ **A zero is not proof of absence in general** — `sendBeacon`, WebSockets and requests made
  inside a Worker never appear in a document's resource timeline. The new /privacy section
  ("Check it yourself") states both limits plainly and points the reader at their own DevTools
  Network panel, which has neither, rather than pretending the printed number is the last word.
  The classification lives in a pure module (`src/lib/privacy/request-monitor.ts`) for the same
  reason `sw-policy.ts` does: jsdom implements no resource `PerformanceObserver`, so a rule
  written inside the observer callback is a rule that ships unverified.
  **Two things worth carrying from building it:**
  * `useSyncExternalStore`, not `useState` + `useEffect`. The obvious shape is a HARD ESLint
    ERROR here (`react-hooks/set-state-in-effect`), and it is also the wrong primitive — the
    resource timeline is external mutable state. The snapshot must be cached at module scope;
    returning a fresh object from `getSnapshot` re-renders forever.
  * ⚠ **A test that anchored on `0 BYTES SENT` broke** — `offline-copy-claims.test.tsx` located
    the status bar by that cell, describing it as "the one cell this file is not changing". It
    is re-anchored on TOOLS INSTALLED, with a note saying why.
  **NOT DONE — the CSP `<meta http-equiv>`, and it should not be done casually.** GitHub Pages
  cannot send headers, so a meta CSP is the only option, and a meta CSP cannot carry
  `frame-ancestors` or `report-uri` — so it would be a partial policy advertised as a complete
  one, which is the wrong shape for a page whose whole argument is precision. It also has to
  allow the one third-party script (GA4) and every engine URL, and getting it wrong breaks the
  site for everyone with no way to roll back faster than a Pages deploy. **The site has not been
  deployed in 111 tools' worth of changes**, so a CSP could not be validated against the real
  origin before shipping either. Worth doing; worth doing with a deploy in hand.
- [ ] **Honest limits → real streaming — HALF DONE BY DESIGN, and the risky half is gated.
  Assessed 2026-09-10.**
  **What is done:** ceilings are declared where they exist and where they can bite. 11 tools
  carry `maxSizeMB` and 30 carry a `practicalLimitNote`, and `size-claims.test.ts` requires a
  declaration from exactly the tools that need one — its `readsWholeFileIntoAWorker` scan is
  `/\.arrayBuffer\(\)/ && /@\/lib\/workers\/[a-z0-9-]+-client/`, so any UI that pulls a whole
  file into memory and hands it to a worker MUST declare a cap or the suite goes red. The other
  ~137 tools stream, or work on a decoded frame, and have no ceiling of their own to publish
  beyond the tab's memory.
  **The dangerous half is already prevented, verified:** no page claims "no size limit" or "no
  size cap" — grep returns nothing across `src/data`, `src/app` and `src/content` (positive
  control: `no account` returns a hit, so the search works) — and `size-claims.test.ts:481`
  FORBIDS those phrases in page source. So the marketing line the item warns about cannot be
  shipped before it is true.
  **NOT done, and it is the real work:** OPFS / streaming, to RAISE the ceilings rather than
  document them. That is a genuine engineering project (chunked reads, an OPFS scratch file, a
  streaming muxer for the video tools) and nothing about it is started.
- [ ] ⚠ **Owner: i18n.** The KB/exam cluster is India-driven; PDF compress skews es/pt/id.
  Translating 60 existing tools into ~6 languages is plausibly more traffic than 200 new pages,
  and zero engine risk. Big lift under `output: "export"` — needs a real decision, not a drift.
- [x] **Command palette — ALREADY SHIPPED; the box was simply never ticked (confirmed
  2026-09-10).** `src/components/layout/CommandPalette.tsx` binds ⌘K / Ctrl+K
  (`:119`, `e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)`), is mounted globally from
  `src/app/layout.tsx:135`, exports `openSearch` for `SearchTrigger.tsx`, and announces its
  result count in a live region (`:217`). Nothing to build.

- [ ] ⚠ **`launch_handler` — STILL deliberately NOT declared, and it stays that way until
  someone can test an installed PWA.** Re-examined 2026-09-10. The reasoning recorded in
  `src/app/manifest.ts:69-74` holds: the three `client_mode` values trade an unwanted second
  window against navigating a window that may be minutes into a conversion, and what `"auto"`
  actually does for a FILE launch is UA-defined rather than specified. Verifying it needs the
  app installed from a real origin and a file opened from the OS file manager — which this
  session cannot do, because **the site has not been deployed** (see "Still open"). A unit test
  pins its absence, so the omission is deliberate rather than forgotten. Declaring a mode on a
  guess would be exactly the "capability claim we can't verify" this repo refuses to make.
- [x] **`OOM_SIGNATURES` false-positive — FIXED 2026-09-05.** `ffmpeg-loader.ts` carried the bare
  substring `"oom"` in its out-of-memory signature list and tested it with `lower.includes(sig)`,
  so any FFmpeg failure whose text contained "room", "zoom" or "bloom" was rewritten into
  *"Ran out of memory. A browser tab can hold about 1795 MB in one file…"*. **FFmpeg echoes the
  input FILENAME into its error text**, so `zoom-call.mp4: Invalid data found when processing
  input` was the ordinary path into it: a user with an unreadable 3 MB screen recording got a
  fabricated diagnosis that also hid the real one. Same shape as the wasm-trap-reported-as-OOM bug
  this file already fixed once. The four remaining entries are multi-word phrases that cannot occur
  inside a word and stay substring tests; the token is now `OOM_TOKEN = /\boom\b/`, whose boundary
  accepts `(`, `)` and `-` so `Aborted(OOM)` and `oom-killer` still match. Regression tests run in
  both directions and were mutation-proven red. The bug was even documented sideways at
  `ffmpeg-log-sink.test.ts:32`, whose comment told the reader to avoid the word "boom" in a
  deliberate failure message; that comment now records that the constraint is lifted and names the
  loader line that lifted it.
- [x] **`measure-tool-surfaces.mjs` could only ever GROW a number — FIXED 2026-09-05, and it had
  been wrong for at least one earlier wave.** The generator measures
  `[data-tool-surface].offsetHeight`, and `ToolPageLayout` sets `min-h-[var(--surface-min-sm)]` on
  *that same element* from the file the generator wrote last time. So a surface that gets SHORTER
  re-measures at its old height and the page goes on reserving blank space nothing fills. Found
  when five trimmed Wave-4 pages all re-measured completely unchanged. The fix is one
  `page.addStyleTag({content:"[data-tool-surface]{min-height:0 !important}"})` after `goto`, with
  the reasoning in a comment above it. Proof it was already live rather than newly introduced:
  regenerating with the fix dropped **`subtitle-converter` from 1511 to 1328** — 183 px of
  over-reservation that had been frozen in the map since Wave 3 and that no amount of re-running
  the generator would ever have released.
- [x] ⚠ **Owner (carried) — ALL FOUR RESOLVED; box ticked 2026-09-10.** GA4 cookieless DONE,
  `crop-image` PNG-only CLOSED in Wave 4, `Year.tsx` FIXED, and the 8 `npm audit` findings are
  build-time `sharp`/libvips via next and never ship. ORIGINAL: GA4 cookieless (`client_storage:'none'`) — DONE 2026-08-31 (see
  Wave 0 addendum). | `crop-image` PNG-only output — decided: keep until Wave 4 (addendum). |
  `Year.tsx` hardcodes 2026 — FIXED 2026-08-31. | `npm audit`: 8 vulns all build-time
  `sharp`/libvips via next, never ship.
- [x] **Post-deploy Lighthouse — RUN 2026-08-31 against the live site (mobile emulation,
  Chrome headless):** home: perf 72 / a11y 96 / best-practices 100 / SEO 100 (LCP **4.8 s**,
  CLS 0); /compress-image: perf 78 / a11y 96 / 100 / 100 (LCP 2.6 s, TBT 20 ms, CLS
  **0.397** — failing; "good" is ≤ 0.1).
  *(Follow-ups resolved same day: (1) **CLS fixed — 0.397 → 0.0000** measured on four
  archetypes incl. the 1058px worst case. Mechanism: below `lg` the `[data-tool-surface]`
  region had zero height until the `ssr:false` tool UI mounted (desktop was already
  layout-driven at 694px, no CLS there). Fix: measured per-slug reservation —
  `scripts/measure-tool-surfaces.mjs` generates `src/data/tool-surface-heights.ts` (all 67
  tools at 412px/768px; regenerate with the dev server up after reshaping a tool's initial
  UI — a unit test fails if a registered tool lacks an entry), applied as CSS vars +
  `min-h` utilities on the one surface wrapper in `ToolPageLayout`; `/workspace` untouched;
  adversarially reviewed, no defects; unit 1703, default e2e 231/231 green. The 45
  DropZone-archetype heights are exactly DropZone's own `min(52vh,460px)` at those
  viewports. (2) home mobile LCP 4.8 s: the LCP element is the hero H1 text with a 2.1 s
  render delay; `next/font` already self-hosts, preloads and swaps with adjusted fallbacks,
  so there is NO cheap fix — needs its own pass (reduce the ~20 KB render-blocking CSS,
  or an owner design call on `display: "optional"` for the display font). A11y 96 on both
  pages — worth one small audit later.)*

  *(**2026-09-10 — a THIRD lever existed that neither of those two named, and it shipped.**
  Measured on the built home page: it preloaded **four** fonts totalling **78,664 bytes** —
  Inter at 48,432 B and IBM Plex Mono at 10,052 / 10,060 / 10,120 B for weights 400, 500 and
  600. The LCP element is the hero `h1`, which is `font-display` -> `--font-inter`
  (globals.css:236). **So three of the four preloads, 30,232 bytes, were competing on the
  critical path with the one font the largest paint needs, and none of them could ever draw
  it.** `preload: false` on the mono family removes them; `display: "swap"` is untouched, so
  mono still renders in the fallback and swaps. Verified in the built output: **one preload,
  48,432 B, down from four at 78,664 B.**
  The trade-off is real and small: mono IS above the fold, in the navbar's 10.5px muted
  desktop-only status line, which will briefly show a fallback monospace. One line to revert.
  ⚠ **THE LCP NUMBER ITSELF IS NOT RE-MEASURED AND CANNOT BE FROM HERE.** Lighthouse ran
  against the LIVE site, which is now 111 tools behind this tree; re-measuring needs a deploy.
  What is measured is the byte change on the critical path, nothing more — do not report this
  as an LCP improvement until someone has run Lighthouse against a deploy.
  The render-blocking CSS was measured at the same time and is NOT reduced: **136,085 bytes
  raw / 21,322 gzipped across two stylesheets**, one of them 129,374 B. That is the second
  lever, still untouched, and it is real work rather than a setting.)*

---

## Do not build (rejected with reasons — stop resurfacing)

| Candidate | Why |
|---|---|
| YouTube/TikTok/Instagram downloaders (incl. thumbnails) | Server-side extractor + ToS/DMCA. |
| Plagiarism / AI-detect / grammar / rewriting | Needs web-scale index or LLM API. |
| SEO/DNS/WHOIS/IP/rank checkers | Outbound network calls the browser can't make. |
| Currency converter | Live FX breaks zero-third-party; stale rates are worse than absence. |
| `pdf-to-word`, `pdf-to-epub` | Writer compiled out; honest output is a text dump. |
| `optimize-pdf-web` / linearize | Compiled out (verified). |
| Animated AVIF encode, `stabilize-video` | libaom / vidstab absent from shipped core (verified). |
| `jpg-to-heic`, JPEG-XL encode | No client-side encoder / no browser decode support. |
| `bip39-generator` | Wallet seeds on a page loading any third-party JS (GA4) — irresponsible. |
| Text-to-speech **file** output | `speechSynthesis` has no capturable stream; WASM TTS is a flagship-sized build nobody asked for. |
| Calculators as a category | No file → no privacy wedge → pure SEO fight vs decade-old domains. File-adjacent ones only (already in Wave 4). |
| Network/Crypto as nav categories | Fold into developer; 3 thin tools ≠ a section. |

---

## Standing quality bar (applies to every item above)

Every new tool: registry entry in `tools.ts` (keywords, honest `description`/`h1`/`subtitle` —
the Phase 8 copy-honesty rules apply from day one, not as a later sweep) · three-layer component
pattern · processing in the right pipeline (worker for image/pdf/hash/audio; `copy:wasm` after
worker edits) · conversion-suite fixture wherever bytes change · `plan.md` box ticked in the
landing commit, deferrals annotated inline.
