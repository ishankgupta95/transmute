# Transmute — Phased Plan: Design Fidelity · WASM Hardening · Multi-Core · Workspace-Real

> **Rewritten 2026-08-09** at the owner's direction. The previous plan was a bug-fix ledger; all its
> P0/P1 work (and much of P2) landed and was verified, so the completed history is gone. What remains
> below is (a) context that keeps future sessions honest and (b) the new work, broken into phases.
>
> **Owner decisions recorded 2026-08-09** (asked and answered this session):
> 1. **Multi-core = plain Web Worker pool only.** No SharedArrayBuffer, no `@ffmpeg/core-mt`, no
>    hosting change, no coi-serviceworker shim. FFmpeg stays the single-threaded singleton.
> 2. **`/workspace` becomes fully real** — every canvas processes real files, not seeded previews.
> 3. **Fidelity bar = structural + honest.** Match the docs' layout, hierarchy and every control, but
>    keep the documented usability/honesty deviations, and any capability claim in the UI
>    (`THREADS`, `SIMD`, `WEBGPU`, thread counts in the queue) must report **real detected values**.

---

## Context (keep — hard-won, do not re-derive)

- **Stack:** Next.js 16.2.2 (App Router, `output: "export"`, Turbopack), React 19, TS strict,
  Tailwind v4. Deploy: GitHub Pages, apex `transmute.tools` (`public/CNAME`), **no basePath**
  (CLAUDE.md's stale basePath notes were fixed 2026-08-10).
- **Tools:** **67** registered in `src/data/tools.ts` (recounted 2026-08-09; the old plan's "68"
  was wrong). Every UI count derives from `tools.length` — home hero/stat band/CTA, 404,
  workspace rail and status bars. The design docs' own numbers disagree with themselves
  (hero badge 67, workshop cards sum 66, dev count 24 vs actual 25) — the registry wins.
- **Design source of truth:** claude.ai/design project `e91a7226-762b-407b-9c69-f9f2bc407707`,
  six docs (`Logo`, `Theme` via `_ds/nocturne-*`, `Home Redesign`, `All Tools`, `Site Pages`,
  `Tool Redesign`). Fetch with the DesignSync tool. Each `data-screen-label` block's 1440px
  frame/radius/shadow is the **artboard, not UI**; the nav inside it is the site navbar.
- **The test blind spot (the defining lesson of this project):** jsdom has no canvas and no WASM, so
  green unit tests say nothing about conversion correctness. `npm run test:e2e:conversion`
  (real fixtures, byte-level + decoded assertions, Chromium) is the gate that matters. Run it after
  any change to `lib/tools/` or a tool UI.
- **Verified baseline — 2026-08-09, this session, all green:**
  `tsc` clean · ESLint 0 errors / 3 warnings (`no-img-element` on `blob:` URLs — unavoidable under
  `output: "export"`, leave as warnings) · **unit 1620 pass / 67 skipped** (54 files) ·
  **`test:e2e` 213/213** · **`test:e2e:conversion` 27/27** · `next build` green (92 routes).
  The whole redesign + bug-fix tree is **uncommitted, awaiting owner review**.
- **Deliberate deviations from the design docs — keep, do not "fix" back:**
  `Copy`/`Copied!` casing (docs say lowercase `copy`); selectable `<textarea readonly>` for text
  outputs instead of `<pre>`; `CodeBlock` renders `<pre><code>`; `GenList` values are `<code>`;
  rail primaries say "Copied to clipboard" where an inline button already says "Copied!" (the
  duplicate-string trap); `MarkdownToPdfUI` keeps editor+preview (not `PdfDocsPane`);
  `AudioMergerUI` keeps the numbered join-order list (ordering is the interaction, and it decodes
  nothing today).
- **Gotchas / traps:**
  - `@ffmpeg/core-mt` deadlocked in many browsers (emscripten pthreads) — and is now also out of
    scope by owner decision. Revisit only if hosting ever moves off GitHub Pages (COOP/COEP).
  - Running `static-pages.spec.ts` alone against a *cold* `.next` 500s on the 404 test
    (`next dev` + `output: "export"` + unknown `/[slug]`). Passes warm / in the full suite.
  - `ToolPageLayout` renders the mobile sibling rail as a `<details>` at every width — a bare
    `page.locator("details")` count is always FAQs + 1.
  - `ImageCropperUI` e2e: the SE cropper handle sits below a 720px viewport at the default 80% crop —
    scroll it into view before dragging.
  - Don't run `next build` while `next dev` is up — they share `.next`.
  - `public/**` is in ESLint `globalIgnores` (the copied ffmpeg core would otherwise fail CI).
  - FFmpeg core is self-hosted (`npm run copy:wasm` → `public/`, gitignored). `forbidCdnCore` in the
    conversion suite **fails the run** if the loader ever regresses to a CDN.
  - Setting state in an effect is an **error** in this repo; use `useIsClient()` /
    `useSyncExternalStore` patterns (see `CronExpressionGeneratorUI`, `?q=` palette).
  - **Turbopack's `next build` does NOT bundle `new Worker(new URL(...))`** — it emits the raw
    `.ts` as a static asset (dev hides this behind an on-demand loader), so pool workers are
    pre-bundled by esbuild into `public/workers/` via `copy:wasm` (`scripts/build-workers.mjs`).
    Worker entrypoints must import **leaf modules only** — an import chain that reaches back to a
    module naming the worker's own URL hangs the production build forever at ~0 % CPU
    (`lib/tools/audio-pcm.ts` and `regex-eval.ts` exist for this reason).
  - After editing worker code (or its imports: `audio-pcm.ts`, `regex-eval.ts`,
    `pdf-engine-core.ts`, `pool.ts` protocol), re-run `npm run copy:wasm` — `next dev` does not
    watch the esbuild bundles.
- **Known product notes (not bugs):** `crop-image` always re-encodes to PNG (pinned by test; a JPEG
  in → bigger PNG out — product decision pending, Phase 5). `ExifViewerUI`'s primary reads
  "Remove EXIF & Download" but stripping and downloading are two clicks.
- ~~Markdown→PDF print CSS `@import`s Google Fonts~~ — **fixed 2026-08-10 (Phase 5):** print
  fonts are self-hosted from `@fontsource-variable/*` via `copy:wasm`; the app now makes zero
  third-party requests beyond analytics, and the privacy page says exactly that.

---

## Phase 1 — Full design-fidelity audit + fixes (every tool, every control)

*Goal: "the whole app as per the design" is demonstrated, not assumed. Prior sessions implemented
all six docs and spot checks pass (2026-08-09: `/workspace` and `/compress-image` at 1440 match
structurally), but no systematic screen-by-screen diff has ever been recorded.*

- [x] **Build the audit matrix** (2026-08-09). All six docs fetched via DesignSync, inventories
  extracted, `design-audit.md` created — one row per element per surface with statuses
  (✅ fixed · ✓ match · ⚠ open · ◇ deviation-kept · ◆ deferred-to-phase).
- [ ] **Sweep every surface against the matrix** at 1440 / 768 / 375: home, 5 hubs, all 67–68 tool
  routes, `/workspace`, blog index + posts, about, privacy, 404, navbar/footer/⌘K palette.
  (Playwright sweep + screenshots for the record; judgement diffs by eye.)
- [x] **Known suspects — all resolved 2026-08-09** (detail in `design-audit.md`):
  - Tool status bar now carries `TOOL n OF 67`, the capability segment and `67 TOOLS INSTALLED`;
    the blanket `NO SIZE CAP · MAX SIZE — YOUR RAM` claim is **gone** (it was false for the two
    FFmpeg tools — `Tool.maxSizeMB` now drives the spec tile and DropZone line: `MAX 100 MB` on
    video-trimmer/mp4-to-mp3, `NONE`/`NO SIZE CAP` elsewhere).
  - DropZone reworked to the doc's empty state ("Drop a file to begin", "Nothing uploads…",
    **Choose file**, `{formats} · BATCH OK · {cap}`), with a real **⌘O** binding.
  - **⌘↵ TO RUN** is now bound in `ToolActions` (meta/ctrl+Enter fires the primary); hint at `lg`,
    sheet keeps `RUNS ON THIS DEVICE`.
  - `+ step` chip: deviation-kept on real pages (implies an editable pipeline that doesn't exist).
  - "saved to Recent": the fake string was **removed** from the workspace sidebar; the Recent
    feature itself is Phase 4.
- [x] **Honest capabilities** (2026-08-09) — new `CapabilityReadout` (real wasm-SIMD probe,
  `hardwareConcurrency`, WebGPU check; renders post-mount so the export can't bake build-machine
  values) now feeds both status bars; `BatchPane` shows the machine's real thread count. The
  homepage engines table was also de-fictionalised (FFmpeg ≠ GIF encoding — that's gifenc;
  25 MB → 31 MB actual; WebCodecs/Web Audio rows now name WebM→MP4 and lamejs).
- [x] **Reconcile 67 vs 68** (2026-08-09) — registry has 67; the old plan's 68 was the error;
  all UI counts already derive from the registry.
- [x] Fix every `diff-fix` row; record every `deviation-kept` with its reason — **matrix has zero
  ⚠ rows as of 2026-08-09.** Second batch: **SPLIT / SIDE BY SIDE / DIFF compare modes**
  (in `CompareStage`, inherited by compressor/converter/resizer; DIFF is a real ×4
  pixel-difference render) and **real SSIM** (`lib/tools/image-metrics.ts`, 6 unit tests,
  verified 0.989 live at Q80). Third batch: **START FROM presets** (`ToolPresets` — hand edits
  flip the chip back to Custom) on the four tools whose controls can express them
  (compress-image, image-converter, video-to-gif, audio-trimmer) and **honest ADVANCED
  sections** (`ToolAdvanced`) on the same four, every row verified against the lib. The five
  doc tools whose presets imply unbuilt features are ◇-flagged in `design-audit.md`, not faked
  (merge-pdf/split-pdf/favicon → Phase 5 product decisions; screen-rec/json → presets would
  duplicate their single existing control).
- **Gate: ✅ MET 2026-08-09.** `design-audit.md` has zero unresolved ⚠ rows (every row is ✅ fixed,
  ✓ verified, ◇ deviation-kept-with-reason, or ◆ deferred-to-phase). Final gates:
  tsc ✓ · lint 0 err/3 warn · **unit 1626** ✓ · e2e 213/213 ✓ · conversion 27/27 ✓ ·
  build 92 routes ✓. Phase 1 is done pending owner review; the ◆ rows land with their phases
  (Recent + workspace-real → Phase 4; real batch thread counts → Phase 3; preset-implied
  features → Phase 5).

## Phase 2 — WASM/FFmpeg deep hardening (find the bugs before the refactor)

*Goal: the conversion suite today (27 tests) proves the happy path on one clean fixture per format.
Widen it until the engines' real failure modes are pinned — then fix what it catches. This lands
**before** Phase 3 so the worker-pool refactor happens under a safety net.*

- [x] **Fixture matrix expansion — first tranche** (2026-08-10): `sample-audio-96k-mono.wav`
  (96 kHz **and** mono), `sample-doc-60p.pdf` (past the thumbnail cap), `sample-vector.svg`
  (viewBox-only), plus a deterministic `corruptFixture()` helper for garbage-bytes inputs; all
  wired into `scripts/generate-test-fixtures.mjs` so a full regen reproduces them.
  *Still wanted later:* 5.1 audio, VBR MP3, video-without-audio, rotation-metadata video,
  encrypted PDF, CMYK/EXIF-orientation JPEG, 16-bit PNG, animated GIF/WebP inputs.
- [x] **Error-path tests** (2026-08-10): corrupt MP3 (decode), PNG (image), PDF (MuPDF/pdf-lib) and
  MP4 (FFmpeg exec) each surface the tool's `role="alert"` error — no hang, no download — and the
  MP3 case also proves the tool recovers with a good file afterwards.
- [x] **Lifecycle tests — first tranche** (2026-08-10): four consecutive audio conversions on one
  page (the AudioContext-leak class); merge→reorder invalidates the stale download.
  *Still wanted:* cancel-mid-exec for video-trimmer; navigate-away-mid-job.
- [x] **Cross-browser — WebKit landed 2026-08-10.** `conversion-webkit` project (Desktop Safari)
  runs the audio/pdf/image specs + the non-Chromium-flag hardening cases: **30 tests green in
  WebKit** alongside 42 in Chromium (72 runs total). Excluded there: WebCodecs video specs, the
  screen recorder (both need Chromium launch flags) and the GIF/FFmpeg-tagged cases pending a
  WebKit-tuned pass. **Its first run caught two real Safari-only bugs, both fixed with tests:**
  - Safari's canvas encoder writes its **own Exif APP1** into fresh JPEGs — "Remove EXIF" output
    still carried an Exif segment there. `removeApp1Segments` now sweeps APP1 (Exif/XMP) from the
    encoded bytes (JFIF/ICC kept); 3 unit tests + the WebKit e2e pin it.
  - Safari's encoder at Q80 **grew** the already-optimised fixture (54.6 → 60.5 KB) and the
    compressor offered it as a result. `compressImage` now has a never-grow guard: if the encode
    isn't smaller, the untouched original comes back. Unit test + the e2e invariant is now
    "never bigger", cross-browser.
  - Firefox project: still open, low priority (needs its own install + triage pass).
- [x] **m4a/AAC (and Ogg/FLAC) FFmpeg decode fallback** (2026-08-10) — when `decodeAudioData`
  rejects an allowlisted container (AAC in Firefox, Ogg/FLAC in Safari), `audio-decode.ts`
  transcodes to WAV via the FFmpeg singleton and re-decodes at the exact rate. Allowlist-gated so
  unknown extensions still fail fast instead of pulling 31 MB. 3 routing unit tests (mocked
  engine); the WebKit corrupt-MP3 e2e exercises the fallback path live.
- [x] **Fixture tranche 2** (2026-08-10): `sample-audio-6ch.wav` (5.1-style, distinct tone per
  channel), `sample-audio-vbr.mp3` (two-bitrate, no Xing — the duration-mismatch class),
  `sample-photo-portrait.jpg` (EXIF Orientation=6). Generator now exports its builders behind a
  direct-run guard for targeted regeneration. Four new fidelity tests: 6-ch WAV survives a trim
  with all six channels; folds to valid stereo MP3; VBR decodes full-length; rotated JPEG
  converts at its displayed 600×800.
- [x] **Conversion-layer bugs — fixed 2026-08-10, each with the test that would have caught it:**
  - ✅ **Device-rate resampling** — `audio-decode.ts` now sniffs the source rate from container
    headers (WAV fmt / MP3 frame / FLAC STREAMINFO / Ogg Vorbis+Opus / MP4 mdhd — 25 unit tests
    against the real fixtures) and decodes through `OfflineAudioContext` at that rate; unknown
    sniffs fall back to the old device-rate path. E2E: a 96 kHz mono WAV survives a trim at
    96 kHz/mono.
  - ✅ **Follow-on found by the fix:** MP3 tops out at 48 kHz and lamejs mangles higher rates —
    previously masked by the resample bug. New `resampleForMp3` (≤48 kHz pass-through) wired into
    convert/trim/merge; E2E proves a 96 kHz source emits a valid full-length MP3.
  - ✅ Trim NaN/∞ times now rejected *before* the decode (unit-tested).
  - ✅ Dimensionless SVG: Firefox reports 0×0 and **Chromium invents the 300×150 UA default** —
    both wrong. `svgFallbackSize` (viewBox → 1024 longest edge; explicit attrs returned as-is)
    now wins when the document declares no size. E2E: viewBox 240×120 → 1024×512 PNG.
  - ✅ `pdfToImages` toBlob-null → a per-page error naming the size and suggesting lower scale
    (was `b!` → downstream crash).
  - ✅ MergePdf stale download after drag-reorder cleared (add/remove already did).
  - ✅ video-to-gif frames are stamped with the **real capture gap** instead of a constant delay
    (rVFC captures land at ≥0.8× the target interval, so constant-delay GIFs played ~20% long).
    E2E asserts a 1 s trim yields ~10 frames and 600–1500 ms of GIF time — via a **real GIF block
    walker** added to the validators (the old frame count scanned raw bytes for 0x2C and was off
    by orders of magnitude; it only survived because callers asserted `> 1`).
  - ✅ Thumbnail cap made honest: split/rotate/reorder announce "THUMBNAILS RENDERED FOR THE FIRST
    50 OF N PAGES" (all pages were already selectable/reorderable — only the preview images cap).
    E2E: the 60-page fixture shows the note and `51-60` still splits to a 10-page PDF.
- **Gate: ✅ MET 2026-08-10.** Conversion suite: **42 unique tests, 72 green runs across
  Chromium (42) + WebKit (30)** — against 27 Chromium-only at phase start. Every fix in this
  phase is pinned by the test that would have caught it, and the WebKit project earned its keep
  on day one (two Safari-only bugs found and fixed). All gates green: tsc · lint 0 err/3 warn ·
  **unit 1647** · e2e 213/213 · build 92 routes. Deferred, recorded above: Firefox project;
  WebKit-tuned GIF/FFmpeg-video pass; remaining exotic fixtures (encrypted PDF needs an external
  sample — pdf-lib cannot encrypt).

## Phase 3 — Multi-core: worker pool + off-main-thread processing

*Goal: the design's `4 THREADS · WORKER POOL 4/8` queue and `THREADS n` status become true. Owner
decision: plain Web Workers only — parallelism across files and off-main-thread heavy work; no
SharedArrayBuffer anywhere.*

- [x] **Pool primitive** (2026-08-10) — `src/lib/workers/pool.ts`: FIFO task queue over lazily
  spawned module workers, `N = clamp(hardwareConcurrency - 1, 1, 4)`, memory-aware admission
  (per-task `memoryBytes` estimate against a budget of ¼ × `navigator.deviceMemory` — 4 GB
  assumed where the API is missing, i.e. Safari; an over-budget task runs *alone* rather than
  never). Per-task progress + AbortSignal in the `ProcessingContext` shape; aborting a running
  task terminates its worker (the only way to stop synchronous WASM) and replaces it lazily.
  **20 unit tests** (`worker-pool.test.ts`): scheduling, reuse, FIFO under memory pressure,
  abort queued/running, crash recovery, destroy. Turbopack bundles
  `new Worker(new URL(...), {type:"module"})` fine — verified live in dev.
- [x] **Image pipeline into workers** (2026-08-10) — `workers/image.worker.ts` mirrors
  convert/compress/resize on `createImageBitmap` (+`imageOrientation:"from-image"`, plain-decode
  retry for older engines) + `OffscreenCanvas.convertToBlob`; `workers/image-client.ts` exports
  the same three signatures and routes: SVG and no-OffscreenCanvas browsers → the untouched
  `lib/tools/` main-thread path; HEIC/TIFF → decoded on main (heic2any/utif2), pixels transferred
  as ImageBitmap. Pica: kept `features:["js"]` but via `resizeBuffer` on raw RGBA in *our* worker
  (same lanczos3 math as `resize()` at quality 3 — pica maps both through one mathlib), so pica's
  own ww feature stays off. Compressor's never-grow guard crosses as a `{kind:"original"}` result.
  Image e2e 8/8 + hardening 28/28 green in Chromium *and* WebKit through the worker path.
- [x] **Batch tools real parallelism + queue table** (2026-08-10) — new `useBatchProcessor` hook
  (6 unit tests): fires every file at once, pool schedules; rows stay QUEUED until their worker
  actually reports progress, so RUNNING means running. `ImageCompressorUI` sequential for-loop
  replaced; `ImageConverterUI` **first-file-only bug fixed** — real multi-file with queue table +
  ZIP; both footnotes read `n OF m DONE · k THREADS` with k = the pool's real size. `PdfToJpgUI`:
  per-page encode now runs in the image pool (render stays pdfjs-sequential — its worker
  serialises anyway), determinate per-page progress; ZIP unchanged (JSZip STORE is memcpy).
- [x] **Audio encode off the main thread** (2026-08-10) — pure PCM encoders extracted into
  `lib/tools/audio-pcm.ts` (`encodePcmToMp3` with progress callback, `encodePcmToWav`), run in
  `workers/audio-encode.worker.ts` (pool of 2); `workers/audio-client.ts` copies channel data
  (`slice`) and transfers it, so the caller's AudioBuffer survives. Decode/resample stay on main
  (no AudioContext in workers). Converter/trimmer/merger all routed; audio e2e 10/10 green in
  Chromium + WebKit.
  **Trap found the hard way — worker bundles must import only leaf modules.** The worker
  originally imported `audio-encode-mp3.ts`, whose `convertToMp3` dynamically imports
  `audio-client.ts`, which names the worker's own URL — a chunking cycle that made
  `next build` (Turbopack) hang forever at ~0 % CPU (`next dev` never hit it: dev compiles the
  dynamic chunk lazily, and nothing in the worker calls the wrappers). `audio-pcm.ts` exists to
  break that cycle; the rule is recorded in both files' comments.
- [x] **MuPDF / pdf-lib in a worker** (2026-08-10) — implementations moved to
  `lib/tools/pdf-engine-core.ts`; `pdf-engine.ts` keeps every signature and routes through
  `workers/pdf.worker.ts` on a **single-worker** pool (each worker = its own ~10 MB MuPDF heap;
  ops serialise like the FFmpeg queue). Inputs are structured-cloned, not transferred — MergePdf's
  re-merge-after-reorder keeps its buffers. pdfjs untouched (own worker). PDF e2e 16/16 green in
  Chromium + WebKit. jsdom/no-Worker falls back to running the core inline.
- [x] **FFmpeg: unchanged by decision** — still the single-threaded serialised singleton;
  `ffmpeg-loader.ts`'s comment now records the Phase 3 owner decision (no core-mt/SAB — needs
  COOP/COEP GitHub Pages can't send; no pool of instances — N × 31 MB heaps + shared FS names).
- [x] **UI truthfulness** (2026-08-10) — `CapabilityReadout` now reads
  `SIMD · THREADS {hc} · POOL {poolSize()} · WEBGPU`; batch queue footnotes carry the real thread
  count; workspace `BatchPane` reads `WORKER POOL {poolSize()}/{hc}` (rows stay sample data until
  Phase 4).
- **Gate: ✅ MET 2026-08-10.** Conversion suite green with assertions unchanged — **44 unique
  tests / 76 runs, 75 green + 1 designed skip** (was 42/72; +`batch.spec.ts`): new batch test proves 6 files complete
  correctly AND ≥2 observed RUNNING simultaneously (Chromium + WebKit), and a
  longtask-PerformanceObserver test pins **no main-thread task > 200 ms during the batch**
  (Chromium-only — WebKit has no longtask API). Full gates: tsc ✓ · lint 0 err/3 warn ·
  **unit 1673** (57 files) ✓ · default e2e 213/213 ✓ · build 92 routes ✓.

## Phase 4 — `/workspace` becomes real (owner decision)

*Goal: every canvas in `/workspace` processes real files. Architecture rule: **mount the real
`*UI.tsx` components in the workspace shell — do not fork them.** The 52 UI files already return
`(canvas, <ToolAside>)` fragments, which is exactly the two-slot shape the workspace grid needs;
the seeded panes in `src/data/workspace.ts` + `workspace/panes/*` retire as their tools go live.*

- [x] **Selected tool in the URL** (2026-08-10) — `/workspace?tool=slug` deep links. The URL is the
  single source of truth, read via `useSyncExternalStore` (server snapshot null → default tool
  prerendered; no setState-in-effect); picks go through `history.replaceState` + manual listener
  notify. Unknown slugs fall back to the default. Rail + category filters keep working; ⌘K stays
  the navbar's. `key={slug}` remounts on switch so no state leaks between tools (e2e-pinned).
- [x] **Per-tool code-splitting** (2026-08-10) — the `toolType → component` switch moved out of
  `[slug]/page.tsx` into `components/tools/ToolClient.tsx`; both surfaces render tools through it,
  and every branch resolves to the existing `next/dynamic` wrappers. Verified live: `/workspace`
  route load pulls no tool libs; picking Crop Image fetched exactly its chunks
  (`ImageCropperUI…js`, jszip) on selection.
- [x] **The tool's own `ToolAside` IS the workspace sidebar** (2026-08-10) — the mount area
  reuses ToolPageLayout's `:has([data-tool-aside])` two-column grid, so the (canvas, aside)
  fragment lands exactly like on the tool pages. Pipeline strip / ENGINE / ACCEPTS read the same
  `data/workspace.ts` metadata the tool pages read.
- [x] **`TrimOverlay` moved** to `components/tools/ToolCanvas.tsx` (2026-08-10) as the panes
  retired; `AudioTrimmerUI` + the video stage import it from there. All 13 seeded panes,
  `Canvas.tsx`, `Sidebar.tsx`, `workspace/types.ts` deleted; `data/workspace.ts` slimmed to rail
  metadata + `pipelineByArchetype` (unit test rewritten for what remains).
- [x] **Recent is REAL** (2026-08-10) — `lib/utils/recent-outputs.ts`: every `triggerDownload`
  records `{name, bytes, slug, at}` to localStorage (metadata only — blobs don't fit; it's a
  record, not a re-download cache). `RecentOutputs` renders the docs' RECENT OUTPUT rail section
  in BOTH rails (workspace: picks the tool in place; tool pages: links to the tool), hidden until
  the first save, synced across tabs via the storage event.
- [x] **SEO: `noindex` kept** — real tools now, but still duplicate content against the tool
  pages; comment updated with the revisit condition.
- [x] **E2E workspace sweep** (2026-08-10) — `conversion/workspace.spec.ts`: deep-link + rail
  switch + remount, and one real conversion per archetype through the workspace mount (image
  resize→1080², batch compress→ZIP, split→2-page PDF, merge→10-page PDF, mp3→decodable WAV,
  video→multi-frame GIF, JSON pretty-print, UUID v4, favicon ZIP, palette swatches, EXIF read,
  screen-recorder→real WebM). **13/13 Chromium · 11+1-designed-skip WebKit, first run.**
- **Gate: ✅ MET 2026-08-10.** All archetypes convert real files in `/workspace`; zero
  seeded-constant canvases remain (the pane files are gone); bundle check shows tool code loading
  on selection. Full gates: tsc ✓ · lint 0 err/3 warn · unit **1446** (57 files — the deleted
  simulator's ~230 data tests retired with it) · default e2e 213/213 ✓ · conversion suite
  **57 unique / 101 runs: 99 green + 2 designed skips** (WebKit longtask + WebKit recorder) ·
  build 92 routes ✓ · **prod-export smoke ✓** — served `out/` statically and converted real
  files through `/workers/image.worker.js` AND the mupdf `pdf.worker.js` chunk chain in the
  browser (the exact paths Turbopack's raw-`.ts` emission would have broken).
  **Deviation (recorded):** workers are pre-bundled to `public/workers/` by
  `scripts/build-workers.mjs` (esbuild, invoked from `copy:wasm`) instead of Turbopack worker
  chunks — `next build` emits `new Worker(new URL(...))` references as RAW `.ts` assets (dev's
  on-demand worker loader masks it), which would have shipped broken workers. Dev and prod now
  run byte-identical worker bundles.

## Phase 5 — Remainder: open P2/P3 + SEO/polish

*Everything still open from the old audit that earlier phases didn't absorb. Nothing here blocks the
phases above; batch it by area.*

- [x] **Dev tools — all fixed 2026-08-10, each with tests:** XML formatter comment/DOCTYPE
  indent (extracted to `lib/tools/xml-format.ts`, only element tags open a level; 6 unit tests);
  color picker partial/3-digit hex (extracted to `lib/tools/color-picker.ts` — `parseHex` returns
  null, never NaN; the UI keeps a raw `hexInput` beside an always-valid `hex`; 7 tests); Base64
  file-mode poisoning (file name now lives outside the text state — direction/source switches
  re-run the preserved TEXT input, never the filename); `formatFileSize` TB/PB + clamp + "—" for
  NaN/negative (4 new tests); text-case acronyms (`NASA` stays, `parseHTMLString` splits at the
  right boundary; 2 tests); password generator rejection-sampling (no modulo bias) + every
  selected class guaranteed present + crypto Fisher–Yates (2 property tests × 50 runs); timestamp
  Local/UTC display toggle (weekday follows); gradient hex text input validates through
  `parseHex` with a draft that snaps on blur (box-shadow needed nothing — its only colour input
  is `type=color`, which can't emit garbage); lorem "words" = exactly N words, no bolted-on
  period; `describeCron` speaks lists/ranges/steps (`*/5` → "Every 5 minutes", `1-5` →
  "Mon through Fri"; 3 new tests).
- [x] **Regex backtracking guard** (2026-08-10) — evaluation moved to a 1-worker pool
  (`regex.worker.ts` + `regex-client.ts`, `lib/tools/regex-eval.ts` as the pure leaf) with a 2 s
  timeout that aborts → terminates the worker. Verified live: `(a+)+$` over 45 chars produced
  ZERO main-thread long tasks, surfaced the timeout message, and the next pattern worked
  immediately (pool replaced the worker). jsdom falls back to synchronous inline eval, so the
  12 existing component tests run unchanged.
- [x] **UX consistency** (2026-08-10): uuid/password/lorem clear stale output on any option
  change (results on screen always match the lit controls); `useObjectUrl` revokes on a 1 s
  delay so a still-loading `<img>` can't flash broken; DropZone drag-highlight uses an
  enter/leave depth counter (no more child-crossing flicker) and gained a `disabled` prop —
  wired on the three always-mounted zones (merge-pdf, merge-audio, images-to-pdf) so drops can't
  land mid-run; DropZone `accept` filtering was already implemented (lenient `matchesAccept` —
  item was stale). **Live-on-type vs click-to-run: resolved as a deliberate rule, not churn** —
  live for character-level transforms (base64/url/entity/json), click-to-run for library-backed
  conversions (sql/xml/turndown/csv), which is the current split; normalising all-live would
  fight the doc's ⌘↵ model and all-click would worsen the cheap tools.
- [ ] **Compress PDF expectations:** deflate-only never shrinks image-heavy PDFs — either say so in
  the UI or add a rasterize mode (now `pdf-engine-core.ts` `compressPdf`). **Owner product call —
  still open.**
- [ ] **crop-image PNG-only output** product call: keep (pinned) or offer format choice. **Owner
  call — still open.**
- [x] **Infra** (2026-08-10): GA now tracks client-side navigations (`AnalyticsPageviews` —
  usePathname watcher, first render skipped so the landing view isn't double-counted;
  deliberately not useSearchParams, which would force a Suspense boundary); stale `/transmute`
  `locateFile` was already gone (everything reads `__NEXT_ROUTER_BASEPATH`); CLAUDE.md's two
  stale basePath notes fixed. The root layout's hand-rolled `<head>` scripts STAY — the Metadata
  API has no script/preconnect surface; this is the App Router escape hatch, noted in place.
- [x] **SEO mechanical items** (2026-08-10): the 13 over-length titles got a `Tool.titleTag`
  override (≤60 chars with the " | Transmute" suffix; on-page H1s unchanged); canonicals verified
  absolute in the export everywhere (`metadataBase` resolves them) and source style unified to
  relative. **Still open (owner/editorial):** genuine 4th/5th FAQs for the 45 thin-FAQ tools
  (≈90 entries of real copy — needs editorial voice); all-tools index route (product call);
  Lighthouse re-measure (needs the live URL, post-deploy).
- [x] **Markdown→PDF fonts self-hosted** (2026-08-10) — the app's LAST third-party request is
  gone: latin-subset variable woff2s from pinned `@fontsource-variable/*` packages (OFL), copied
  to `public/fonts/print/` by `copy:wasm` (gitignored, same treatment as the WASM), injected as
  five `@font-face` rules with origin-absolute URLs (an about:blank iframe can't resolve relative
  ones). Verified live: print document carries the five local faces, zero googleapis/gstatic
  requests, all files serve 200. Privacy copy updated — the Google Fonts exception paragraph is
  now "no third-party requests beyond analytics".
- [ ] **Beta exit:** remove the Navbar badge once the manual pass below is done. **Gated on the
  owner's manual verification pass — still open.**
- **Gate:** ESLint warnings stay ≤ 3; suites green; privacy page matches reality. *(Verified
  2026-08-10 for everything above: lint 0 err/3 warn · unit 1468 (59 files) · default e2e 213/213 ·
  conversion 57 unique/101 runs green · privacy copy matches the new no-third-party reality.
  The open items above are owner calls, not engineering leftovers.)*

---

## Retained: post-deploy / manual / out of scope

**Manual verification (needs real devices / live URL):** FFmpeg smoke across Chrome/Safari/Firefox;
real iPhone Safari + Android Chrome walk-through; 320px + landscape; keyboard-only + VoiceOver +
axe; `prefers-reduced-motion`; FOUT on Slow 3G; MP3 playback in QuickTime/WMP; PDF cross-realm
ArrayBuffer in Safari/Firefox.

**Post-deploy SEO:** Rich Results Test on 6 URLs; Search Console sitemap resubmit + index requests;
OG smoke-test; `npm audit fix`; impressions/CTR tracking.

**Out of scope (unchanged):** new tools/categories, freemium, i18n, promotion, re-architecting the
three-layer pattern, domain transfer — **plus, by 2026-08-09 owner decision: SharedArrayBuffer /
`@ffmpeg/core-mt` / hosting changes** (revisit trigger: moving off GitHub Pages for other reasons).
