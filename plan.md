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

### MuPDF (`public/mupdf-wasm.wasm`, 9.5 MB, already shipped on every PDF page)

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
- [ ] **KB-ladder "resize" phrasing — needs engine work first:** add dimension-stepping to the
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
- [ ] **PDF size ladder** over `compress-pdf`: `compress-pdf-to-100kb`, `-200kb`, `-500kb`,
  `-1mb`. Hard requirement: text-heavy PDFs have a compression floor — **report the closest
  achievable size**, never silently overshoot. (Do after the Wave 2 compress-pdf upgrade so the
  ladder inherits the stronger engine.)
- [ ] `pdf-resizer` as a genuine dual-purpose page (file size + page dimensions via
  `setPageBox`), not a synonym doorway.
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
- [ ] **Post-deploy verification (FIRST THING in the next session's preflight, once the
  owner has committed and CI has deployed Wave 1):** (1) Search Console — look for
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
> - [ ] **Remove MuPDF** (one import site: `pdf-engine-core.ts`; 10 MB wasm + AGPL glue
>   chunk out of `public/`): port its 7 ops to pdf-lib — merge/split/reorder via
>   `copyPages`, rotate via `setRotation` (native inherited-/Rotate handling),
>   page counts, add-page-numbers via `StandardFonts.Helvetica` +
>   `widthOfTextAtSize` (port the rotation-compensation matrix,
>   pdf-engine-core.ts:250–281). Rewrite `pdf-engine.test.ts` against real pdf-lib
>   (mupdf-mock harness today); retune `golden-paths.spec.ts:102`.
> - [ ] **compress-pdf**: qpdf-wasm spike (qpdf is Apache-2.0 — verify the wasm
>   package's own license) for GC/recompress + repair + encrypt/decrypt; fallback is
>   pdf-lib `useObjectStreams` with honestly weakened copy (never-grow already holds).
> - [ ] **lamejs LGPL cure**: vendor `dist/lamejs.js` → `public/vendor/` (copy:wasm
>   step), runtime `import()` of the stable URL (non-analyzable specifier so no
>   bundler inlines it); cures the worker bundle + both Next client chunks at once.
> - [ ] **heic2any LGPL cure (found 2026-08-31: it embeds libheif/libde265 TODAY)**:
>   same `/vendor/` treatment for its 1.35 MB chunk.
> - [ ] **/licenses page** (`src/app/licenses/page.tsx` mirroring privacy; footer
>   SITE_LINKS + sitemap): full inventory incl. FFmpeg GPL source offer (core 0.12.10,
>   release tag, configure line, static libs, credit line), lamejs/libheif/libde265
>   LGPL notices + replaceable-file pointers, exifreader MPL, pdfjs Apache text,
>   jszip-elect-MIT, dompurify-elect-Apache, diff BSD-3, pako, OFL fonts. Texts as
>   `public/licenses/*.txt`.
> - [ ] **Copy consistency sweep with MuPDF removal**: homepage ENGINES table +
>   LiveEngine + CompressPdfUI badge + about + privacy + six `MUPDF WASM` workspace
>   rows + `how-to-merge-pdfs-in-browser.mdx` + CLAUDE.md.
> - [ ] **FFmpeg posture**: keep GPL core under the separate-program argument
>   (MIT wrapper worker, postMessage, CLI-shaped exec) + the /licenses source offer;
>   belt-and-braces spike later: custom LGPL core (`--disable-gpl` — nothing shipped
>   encodes via x264/x265; H.264 encode is WebCodecs).
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

- [ ] **Security trio (one engine, three pages):** `protect-pdf` (encrypt options above),
  `unlock-pdf` (user-supplied known password → `authenticatePassword` + decrypted re-save;
  frame as "remove a password you know" — no cracking), `pdf-permissions` (owner-password /
  permission flags editor). *The privacy story is sharpest here: competitors upload the
  confidential file to a server to password-protect it.*
- [ ] **`redact-pdf`** — search-or-draw regions → Redact annots → `applyRedactions()`. UI must
  communicate this is true content removal (verified), not a visual box. Include image redaction
  mode (`REDACT_IMAGE_REMOVE`).
- [ ] **Extraction set:** `pdf-to-text` (`asText`), `pdf-to-html` (`DocumentWriter('html')`),
  `pdf-to-svg` (per-page), `extract-images-from-pdf` (walk image blocks → PNG → ZIP).
- [ ] **Page ops:** `delete-pdf-pages`, `extract-pdf-pages` (both thin over existing split/reorder
  machinery), `crop-pdf` + `change-pdf-page-size` (`setPageBox`; shared UI).
- [ ] **`watermark-pdf`** (text/image stamp annotation + `bake()`), **`annotate-pdf`**
  (highlight/underline/strikeout/ink/free-text — scope v1 tightly), **`sign-pdf`** (canvas
  signature pad or PNG → stamp; *label as drawn/visual signature, no eIDAS/ESIGN claims*) +
  `add-image-to-pdf` (same placement canvas, two pages).
- [ ] **`fill-pdf-form`** (`getWidgets()` editor) and **`flatten-pdf`** (`bake(true,true)`).
- [ ] **`repair-pdf`** — xref reconstruction fires automatically on open+resave; best-in-class
  for free.
- [ ] **Metadata consolidation:** one `remove-metadata` build covering images (existing EXIF path)
  AND PDF (`setMetaData` clear + `sanitize`). Fixes the carried UX gripe ("Remove EXIF &
  Download" is two clicks) and is the moment to move `exifreader` (2 unpatched DoS advisories)
  off the main thread.
- [ ] **Ebook/comic converts (readers verified present):** `epub-to-pdf`, `mobi-to-pdf`,
  `cbz-to-pdf`, `pdf-to-cbz`. Surface DRM detection honestly (refuse DRM'd files with a clear
  message).
- [ ] **`compress-pdf` engine upgrade:** current save options preserve `/Info` and skip font
  work; measure `garbage=compact,compress-images,compress-fonts,sanitize` + `subsetFonts()`
  against the current output on the fixture corpus; keep the honest "image-heavy PDFs shrink
  least" copy in sync with whatever the new engine actually does.
- [ ] **PDF bookmarks/outline editor** (`OutlineIterator` mutation) — lower priority, ship last.
- [ ] ⚠ **Owner: AGPL posture.** MuPDF is AGPL-3.0; we already ship it, but this wave makes it
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

- [ ] ⚠ **Owner: revisit the 2026-08-09 "no coi-serviceworker" decision.** Recorded facts have
  changed: the only third-party script is GA4 (no ad stack), and `COEP: credentialless` +
  self-hosted or proxied analytics covers Chrome/Firefox. BUT this repo *also* recorded real
  `@ffmpeg/core-mt` pthread deadlocks, and Safari gets no `credentialless`. Treat as a spike
  with exit criteria (deadlock repro suite across 3 browsers, GA data continuity), not a Wave
  prerequisite. **Everything below ships single-threaded regardless; nothing waits on this.**
- [ ] **Remux-first container tools** (`-c copy` where codecs allow — sub-second, lossless;
  surface "no re-encode needed" in the UI): `mov-to-mp4`, `mp4-to-mov`, `mkv-to-mp4`,
  `mp4-to-mkv`, `avi-to-mp4`, plus a `video-to-mp4` hub page.
  **HEVC branch is mandatory:** iPhone `.mov` is often H.265; a naive remux emits an .mp4 that
  still won't play where the user needs it. Probe codec → offer remux (fast) vs H.264 transcode
  (slow, honest time estimate).
- [ ] **`extract-audio`** — generalize `mp4-to-mp3` to all demuxable containers (MKV/AVI/WebM/
  MOV) and to WAV output (`video-to-wav`, `mp4-to-wav` as children).
- [ ] **Audio format matrix** (decoders verified present): `flac-to-mp3`, `ogg-to-mp3`,
  `aac-to-mp3`, `wma-to-mp3`, `opus-to-mp3` ("convert WhatsApp voice notes" is the real query),
  `m4a-to-wav`, `wav-to-flac`, + `mp3-converter` hub.
- [ ] **Audio effects (Web Audio / FFmpeg filters verified):** `normalize-audio` (loudnorm —
  broadcast LUFS while free rivals do peak-only; say so), `change-audio-volume`,
  `reverse-audio`, `remove-silence`, `audio-recorder` (mic, MediaRecorder).
- [ ] **Video verbs:** `mute-video` (remux, strip audio track), `rotate-video` (display-matrix
  rewrite — milliseconds, no re-encode; a categorical win worth explaining in the UI),
  `video-to-images` / `video-thumbnail` (frame extraction), `split-video`, `merge-video`
  (the missing sibling of merge-pdf/merge-audio; same-codec concat first, transcode fallback).
- [ ] **`compress-video-to-size`** — presets (25 MB email / 16 MB WhatsApp / 10 MB Discord) as a
  bitrate solver over the **existing WebCodecs compress path**, not FFmpeg. Honest duration
  estimate + the existing WebCodecs-guard fix from Wave 0.
- [ ] **`webcam-recorder`** — sibling of the existing screen recorder, mostly shared UI.
- [ ] **Honest limits copy:** MEMFS ceiling means multi-GB inputs fail — publish the real limit
  on every FFmpeg page (feeds the Platform-track OPFS work; do not claim "no cap" until it's true).
- [ ] `subtitle-converter` (SRT/VTT/ASS + offset shift + framerate re-timing — pure JS, no
  FFmpeg needed; the offset/retime features are what the query actually wants).

---

## Wave 4 — cheap-dependency categories + PWA (weeks 8–12)

- [ ] **GIF/animation cluster** — enable decode via native `ImageDecoder` + `omggif` fallback
  (~38 KB); `gifenc` already bundled for encode. Pages: `gif-maker` (images→GIF),
  `compress-gif` (gifsicle-wasm-browser, 0.34 MB), `resize-gif`, `split-gif` (frames→ZIP),
  `gif-speed-changer`, `gif-to-mp4` (WebCodecs), `webp-to-gif` / `gif-to-webp`,
  `reverse-gif`. **Owner: open "Animation" as a 6th category in `categories.ts`, or file under
  video?** (Research says 6th category; ezgif's ~250 pages prove the space.)
- [ ] **Image edit verbs** (all Canvas2D, both pipelines per the dual-pipeline trap):
  `rotate-image`, `flip-image`, `watermark-image`, `pixelate-image` (region select),
  `crop-circle`, `add-border`, `social-media-image-resizer` (preset crop matrix),
  `image-splitter` (3×3 grid). Missing-half fills: `ico-to-png`, `base64-to-image`,
  `svg-to-jpg`/`svg-to-webp`, `tiff-to-png`, `avif-to-png`/`avif-to-webp`, `bmp-to-png`,
  `heic-to-webp`, `change-image-dpi` (header rewrite, not resample).
- [ ] **PNG/JPEG real compression:** `@jsquash/oxipng` (0.16 MB, single-thread build ONLY) for
  `compress-png` — canvas re-encode is a no-op for PNG, this is the only honest path. Optional:
  mozjpeg (0.24 MB) upgrade for every existing compress page. Measure before/after on fixtures.
- [ ] **Developer fills:** YAML block (`yaml-to-json`, `json-to-yaml`, `yaml-formatter`;
  js-yaml ~40 KB — the only tool on all 7 surveyed dev sites, we have zero), `jwt-encoder`
  (missing half of decoder), `hmac-generator`, `json-minify`, `sort-dedupe-lines`,
  `charset-converter` + `crlf-lf` (TextDecoder), `chmod-calculator`, `http-status-codes`,
  `timezone-converter`, `byte-converter`, `aspect-ratio-calculator`, `url-parser`,
  `har-viewer` (HAR files hold auth tokens — textbook never-upload tool), `file-checksum`
  (existing hash worker over arbitrary files), `wifi-qr-code` (preset over existing QR gen).
- [ ] **`qr-code-reader`** — zxing-wasm (1.04 MB; `BarcodeDetector` is Chromium-only, don't rely
  on it) + `barcode-generator` (bwip-js, pure JS).
- [ ] **Archive starter:** `create-zip` + `unzip-files` on already-bundled jszip (free);
  `extract-archive` (7z/tar/rar read) via archive-wasm (~1 MB) second. Extraction only — never
  advertise RAR creation (unRAR license). **Owner: category or file under developer?**
- [ ] **`svg-optimizer`** — svgo v4 browser build (0.79 MB); shiki+diff already bundled for a
  before/after view.
- [ ] **`docx-to-markdown`** — mammoth (0.61 MB) → existing turndown chain. (Reader-only; safe.)
- [ ] **`xlsx-to-csv`** — NO SheetJS (npm build frozen 2022, unfixed CVE): XLSX is a ZIP of XML
  and jszip is bundled — unzip + DOMParser over `sheet1.xml`/`sharedStrings.xml`.
- [ ] **PWA completion** (icons already exist in `public/`): manifest + service worker
  (offline precache: app shell always; 31 MB FFmpeg core opt-in "make available offline"
  toggle), `share_target` (Android share sheet → compress/convert), `file_handlers`
  (double-click `.heic` opens us). This is the moat item — no upload-based competitor can copy it.
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

- [ ] **1. `image-to-text` (OCR).** tesseract.js v7, **self-hosted** (default config hits a CDN —
  would break the zero-third-party property and `forbidCdnCore`'s spirit; add an equivalent
  guard). Measure real traineddata size at build (claims conflict: 2–30 MB). Lazy-load,
  English-first, preprocessing (deskew/contrast) matters more than the engine.
- [ ] **2. `pdf-editor`.** Highest expected value in the research. pdfjs renders, pdf-lib writes —
  zero new deps; the cost is the editing canvas (selection, undo, canvas↔PDF coordinate
  mapping). v1 scope: add-text, add-image, whiteout, freehand, delete-page — and say plainly
  body text is not editable (Adobe's free tier can't either). Competitors cap at 2–3 tasks/day;
  "unlimited, no account, never uploaded" is the pitch.
- [ ] ~~**3. `docx-to-pdf`.**~~ *(DEAD 2026-08-31 — the MuPDF Office reader leaves with
  MuPDF under the closed posture; see Wave 2 REVISED.)* Office reader runtime-verified, zero bytes. MuPDF reflows (Office →
  HTML): page breaks/headers/columns won't match Word. Ship with an unmissable fidelity note +
  side-by-side preview before download. **Do NOT ship `pdf-to-word`** (writer compiled out; a
  text dump on the biggest PDF query burns the trust everything else depends on). Skip
  `pptx-to-pdf` (slides reflow into a text river).
- [ ] **4. `ocr-pdf`.** Only after 1 proves the pipeline: render page (existing pdf.worker) →
  tesseract hOCR → invisible render-mode-3 text layer via pdf-lib. 2–10 s/page; page-count gate
  + streaming progress.
- [ ] **Go/no-go (decide once, on paper, before any code):**
  - `background-remover` — largest raw demand in the audit. Gates: a sub-100 MiB quantized
    model (GitHub hard file limit) with a **permissive license** (RMBG-1.4 is non-commercial;
    @imgly is AGPL w/ CDN default), self-hosted, `navigator.gpu` gate, download size shown,
    Cache API persistence, Pages bandwidth math.
  - Whisper transcription (`audio-to-text`/`video-to-text`/SRT export = ONE build) — ~85–120 MB,
    WebGPU effectively required. Trap (verified in research): Chrome's `SpeechRecognition`
    streams audio to Google — using it would silently break the core promise. Whisper or nothing.

---

## Platform track (parallel to any wave)

- [ ] **Prove the privacy claim in-product:** per-tool network-request counter ("0 requests
  made"), CSP via `<meta http-equiv>` (Pages can't send headers) with a documented
  `connect-src` allowlist, and a "verify it yourself in DevTools" paragraph on /privacy.
  We built the property; we currently offer no evidence.
- [ ] **Honest limits → real streaming:** publish actual per-tool input ceilings now; then OPFS/
  streaming work to raise them. "No size limit, no daily limit, no account, no watermark" is
  the sharpest head-to-head line available — but only once it's true.
- [ ] ⚠ **Owner: i18n.** The KB/exam cluster is India-driven; PDF compress skews es/pt/id.
  Translating 60 existing tools into ~6 languages is plausibly more traffic than 200 new pages,
  and zero engine risk. Big lift under `output: "export"` — needs a real decision, not a drift.
- [ ] Command palette: extend the existing `?q=` search into a ⌘K palette as the tool count grows.
- [ ] ⚠ **Owner (carried):** GA4 cookieless (`client_storage:'none'`) — DONE 2026-08-31 (see
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
