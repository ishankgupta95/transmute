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
- [x] **Sweep every surface against the matrix** at 1440 / 768 / 375 — **done 2026-08-19**, and
  kept as a standing gate rather than a one-off pass: `src/__tests__/e2e/meta/responsive-sweep.spec.ts`
  drives all 85 routes (home, 5 hubs, 67 tools, `/workspace`, blog index + 8 posts, about, privacy)
  at each width and fails on horizontal overflow or any console error. **All three viewports clean.**
  The route table is derived from the registries, so a new tool is covered the moment it lands, and a
  guard test pins the table's size so the sweep can never pass vacuously. The detector itself was
  negative-controlled (injected a 2000px node + a console error; both caught) — a green sweep that
  cannot go red would be worse than no sweep. Accessible-name/alt/heading-order probe run across all
  page archetypes the same day: clean (see "Retained: manual" — the axe/VoiceOver pass is narrowed to
  what a headless probe can't judge).
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
- [x] **Compress PDF expectations — the "say so" branch shipped** (confirmed 2026-08-19):
  `CompressPdfUI` already carries *"Streams are deflated and duplicate objects removed. Image-heavy
  PDFs shrink least."* right under the stats, so the tool no longer over-promises. A rasterize mode
  remains a **genuine open owner call** — it would trade fidelity for size and is a feature, not a
  fix, so it is not a launch blocker.
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
- [x] **Beta exit — already done** (confirmed 2026-08-19): there is no `BETA` string anywhere in
  `src/` outside tests; the Navbar badge is gone. This box was stale, not pending.
- **Gate:** ESLint warnings stay ≤ 3; suites green; privacy page matches reality. *(Verified
  2026-08-10 for everything above: lint 0 err/3 warn · unit 1468 (59 files) · default e2e 213/213 ·
  conversion 57 unique/101 runs green · privacy copy matches the new no-third-party reality.
  The open items above are owner calls, not engineering leftovers.)*

---

## Phase 6 — Test honesty: mutation-verified assertions (2026-08-19)

*Goal, set by the owner: "make sure the tests are correct, do not write them in a way that they
always pass even if the tools/code has issues." Method: deliberately break production code and
require the suite to go red. A test that survives its own mutant is decoration.*

- [x] **Coverage census.** All 67 tools have functional e2e; **none is page-smoke-only**. 31 have
  byte-level real-output coverage in the conversion suite, 36 are covered functionally in the
  default suite (dev tools assert real output — UUID shape, password charset, cron prose).
- [x] **Unfailable assertions removed** (`meta/all-tools.spec.ts`). It counted
  `input, textarea, button` **page-wide** and asserted `> 0` — the navbar alone satisfies that.
  Proven vacuous: with `JsonFormatterUI` forced to `return null`, the old assertion still passed
  (page-wide count 3, scoped count 0). Also `title.length > 10`, which nothing could fail. Now
  scoped to a new `[data-tool-surface]` marker on `ToolPageLayout`'s tool region, plus an exact
  title match and a `pageerror` check. Re-verified: the same mutant now fails.
- [x] **TIFF gap closed.** `tiff-to-jpg` was page-smoke-only on the stated grounds that TIFF
  "cannot be synthesised without a binary fixture". It can — `utif2` is already a dependency and
  ships an encoder. New `tinyTiff()` builds a real two-toned 40x30 TIFF; the conversion test
  asserts the decoded output is 40x30. **HEIC and AVIF stay on smoke for a *verified* reason:**
  `heic2any` decodes but never encodes, and Chromium's `canvas.toBlob("image/avif")` silently
  returns `image/png` (probed 2026-08-19).
- [x] **Converters assert decoded dimensions**, not just magic bytes — a converter that dropped
  the pixels still writes a valid JPEG header.
- [x] **Two mutants that survived, and the assertions that now kill them:**
  - *Compressor no-op.* `image.worker.ts`'s never-grow guard forced to always return the original
    left `compress-image returns a smaller, still-decodable image` **green** — its invariant is
    `<=` (correct, for Safari's growing encoder), which a do-nothing compressor satisfies. Added a
    target-size-mode test requiring a **strictly** smaller file. Mutant now killed.
  - *Constant GIF frame delay* — the exact bug Phase 2 fixed. The timing window (600–1500 ms)
    could not catch it: 11 frames x 100 ms = 1100 ms sits inside it. `assertGif` now returns
    `delaysMs[]` and the test asserts the delays **vary** (real capture: 80–130 ms, 4–5 distinct
    values; the bug: exactly one). Mutant now killed.
- [x] **Mutants confirmed already caught** (no change needed): device-rate audio decode (the
  headline Phase 2 bug — 2 tests fail), WAV header lying about channel count, resize swapping axes
  on the live branch, crop switching output format, global regex returning one match, `parseHex`
  returning NaN.
- **Finding — two parallel image implementations.** `workers/image.worker.ts` imports only *types*
  from `lib/tools/image-{compress,convert,resize}.ts` and **reimplements** all three on
  `OffscreenCanvas`. The worker is what browsers actually run; `lib/tools/` is the fallback for SVG
  and engines without OffscreenCanvas. They agree today (same binary search, same never-grow
  guard), but **the unit tests for those three modules do not exercise the shipped path** — only
  the conversion suite does. Mutating `lib/tools/image-compress.ts` cannot fail an e2e test.
  Any fix to one must be mirrored in the other.
- **Finding — `resampleForMp3` is not load-bearing.** Deleting the 48 kHz ceiling changes nothing:
  LAME resamples internally, so the output is byte-identical and correctly declares 48 kHz. The
  guard is belt-and-braces, not a fix the tests can pin. The test now asserts the **declared**
  header rate (`assertMp3().sampleRate`) rather than the decoded rate, which is the only
  observable that says anything about the encoder — a browser always reports the AudioContext's
  rate, never the file's.
- **Trap for mutation work:** pool workers are esbuild-prebundled to `public/workers/`. Editing
  worker source and re-running a test proves nothing until `node scripts/build-workers.mjs` runs.
- **Gate: ✅ MET 2026-08-19.** tsc ✓ · lint 0 err/3 warn ✓ · unit **1469** ✓ ·
  default e2e **217/217** ✓ · conversion **101 passed / 2 designed skips** (was 99) ✓.

---

## Phase 7 — Canvas geometry + the 117-finding sweep (2026-08-29)

*Trigger: owner report — "the actual preview window in the tool is too small. It does not follow
the design religiously." A 16-agent audit (8 auditors + 8 adversarial verifiers) then found 117
confirmed defects across the shell, all five tool categories, the shared primitives and the site
pages; 8 more were refuted and dropped. Every fix below was applied against a measurement or a
repro, not against the audit text.*

**The design MCP was NOT available this session** — `DesignSync` needs an authorization only
`/design-login` can grant, and that cannot run non-interactively. Everything here was checked
against `design-audit.md` (the derived record) plus live measurement. **Open: re-diff the geometry
against `Transmute - All Tools.dc.html` once someone runs `/design-login`.**

### The root cause: a viewport-tall band nothing was allowed to grow into

- [x] **Media previews were pinned at 288px** (`max-h-72`) in six files, `max-h-80` in a seventh,
  `max-h-96` in an eighth. Measured identically — 788×288 — at 1440×900, 1920×1080 AND 2560×1400
  while the canvas band grew 742 → 922 → 1242. At 1080p that was ~480px of empty dot-grid under a
  postage-stamp video. Now `STAGE_MEDIA` (`h-full max-h-[70vh] w-full object-contain`) on a stage
  carrying `STAGE_GROW`: **816×685 at 1920, 816×980 at 2560.**
- [x] **`lg:justify-center` + `items-start`** centred an intrinsically-sized surface instead of
  stretching it, so *nothing* could consume the leftover height. The surface is `flex-1` from `lg`
  now, with explicit rows (`minmax(0,1fr)_auto`) while the controls are a stacked sheet.
- [x] **`overflow-hidden` on the canvas band silently disabled the control rail's `sticky`** — the
  band became the sticky scroll port and never scrolled. Removed; the decorative grid + glow moved
  into their own clipper (they were the only reason the property was there).
- [x] **The `lg` breakpoint made the preview SMALLER as the window grew.** The canvas/controls
  split fired at 1024, the same width the 230px sibling rail appears: video 702×288 at 768 →
  **372×279 at 1024**; PDF tiles 99×133 → **33×44**. The split moved to `xl`, and every
  sheet-vs-rail breakpoint in `ToolAside` moved with it.
- [x] **`has-[[data-tool-aside]]:max-w-[1180px]` never bound** — the real ceiling is the 1440 band
  minus the rail. Replaced with `max-w-none` so one number states the cap.
- [x] **Extracted to `components/workspace/shared.ts`**: `TOOL_SURFACE`, `CANVAS_COLUMN`,
  `STAGE_GROW`, `STAGE_MEDIA` — one vocabulary, used by the tool pages and `/workspace` alike
  (the workspace was duplicating the grid recipe and lacked the `data-tool-surface` hook entirely).
  All 52 tool UIs moved off `space-y-*` onto `CANVAS_COLUMN` so a stage can take the slack.
  Four provably-dead exports (`fmtMB`, `mmss`, `RANGE_CLASS`, `MONO_META` — 0 importers each) removed.

### The other surfaces the same defect had reached

- [x] **`PageDeck` was `lg:grid-cols-8`, fixed.** Now `auto-fill minmax(100px,1fr)` with its own
  internal scroll capped at `min(62vh,720px)` — a 60-page deck scrolls in the plate instead of
  growing the page to 1482px. Tiles: **81×110 → 99×133**, and 103×137 at 1024 (was 33×44).
- [x] **Every developer tool wasted 500–844px.** `TextPanes` now carries `STAGE_GROW` and the
  `TEXT_PANE_BODY` floor dropped 15rem → 12rem: `/json-formatter`'s textarea went **192px → 963px**
  at 1440×900. `WordCounterUI`'s `min-h-[24rem]` override deleted so it shares the one rule.
- [x] `CompareStage` and `ColorStage` clamp to the viewport; `Waveform`/`WaveformSkeleton` are
  `h-full min-h-[170px]`; the crop frame grew **818×500 → 816×778**; the DropZone empty state fills
  the plate (`min-h-[min(52vh,460px)]`) instead of floating as a 262px card.
- [x] `StatStrip` picks its column count from `stats.length` — a 5th stat (SSIM, or the converter's
  FORMAT cell) had been orphaning onto its own row beside three empty cells.
- [x] `PageTile` uses `object-contain` (it was cropping every thumbnail), takes `dimUnselected` (a
  deck with nothing selected yet no longer renders uniformly greyed-out), and takes `interactive`
  so `pdf-page-reorder` has a keyboard path — it was drag-only, on non-focusable divs.
- [x] `CanvasHeader` gained `trailingTone`, and the nine hand-rolled 13px headers migrated to it.
- [x] The `⌘↵ TO RUN` / `RUNS ON THIS DEVICE` row was gated on `onReset`, so it never rendered on
  any audio tool — the shortcut worked and was invisible. Decoupled.

### Functional defects (81 fixed in the tool scopes, all with a repro)

- [x] **Every screen recording the app produces was broken as input to its own tools.** A WebM with
  no declared duration made the trimmer emit an empty 591-byte clip, `video-to-gif` emit a 1-byte
  "GIF" — and offer both for download — and `webm-to-mp4` reject the file outright.
- [x] **`sizeCapMB` was decorative.** `MAX 100 MB` was displayed but never enforced: an over-cap
  file was accepted, previewed and decoded, and only rejected after the user pressed Run. Enforced
  at selection time in `DropZone`; the engine-level checks stay as defence in depth.
- [x] **Stale results, everywhere.** Change a setting after a run and the readouts updated while
  Download still held the OLD output, with no way to re-run — resize, rotate, reorder, split,
  images-to-pdf, pdf-to-jpg, the image converters, the audio trimmer, QR, text-case, xml/sql.
  One pattern applied across all six scopes: an input that changes the output clears the stale
  result and restores the primary action.
- [x] **PDF engine:** rotate silently did nothing on pages with an *inherited* `/Rotate`; page
  numbers landed in the wrong place on any rotated page; split/merge/reorder dropped metadata and
  bookmarks the FAQs promised were kept; compress could hand back a file 74% LARGER and call it
  "already well-optimized"; pdf.js documents were never destroyed; `addPageNumbers` leaked one live
  MuPDF `Page` per page.
- [x] **StrictMode blinded every dev.** The thumbnail effects in split/rotate/reorder bailed at the
  first page on the second mount, so *nobody had ever seen a real thumbnail deck on the dev server*.
  Now 50 thumbnails render on a 60-page document.
- [x] **Ten object URLs leaked on unmount** (nine single + the images-to-pdf list). `/workspace`
  remounts tools by key, so every rail pick leaked a whole file. Proven with a
  `createObjectURL`/`revokeObjectURL` counter harness — live URLs return to 0 for all ten — and
  negative-controlled by reintroducing the bug in one file and watching the harness go red.
- [x] **Dev tools:** `formatXml` corrupted any document with a newline inside a text node;
  `minifyXml` deleted significant inter-element whitespace; JSON formatting silently rewrote large
  integers; Base64 decode rejected line-wrapped input (i.e. the output of `base64` and every PEM
  body); the ISO 8601 field rewrote itself while you typed; hashing blocked the main thread for
  443ms on 8 MB (now a worker); "Side-by-Side" diff was not side-by-side; dragging Lightness to 0
  permanently destroyed the hue.
- [x] **Honesty.** The homepage credited FFmpeg for a job `gifenc` does; the privacy page said the
  app "stores no personal data locally" while writing file names to localStorage; the conversion
  matrix filled a cell for a tool that does not exist; "Browse all 67 tools" went to a 22-tool hub;
  `workspace.ts` advertised `ENGINE PDF-LIB` on MuPDF tools, `FFMPEG WASM` on two tools that never
  load FFmpeg, and ACCEPTS strings listing formats the picker rejects. All reconciled against the
  code, and the pipeline chips too ("Resize" on eleven converters that resize nothing).
- [x] **A11y:** the Regex Tester's pattern field and all four Timestamp fields had no accessible
  name; the conversion matrix shipped invalid ARIA (one critical + one serious axe violation on the
  homepage); the command palette's arrow-key selection was invisible to assistive tech; no skip
  link; the palette and mobile menu fought over `body.style.overflow`.

**Gate: ✅ MET 2026-08-29.** tsc ✓ · lint 0 err / 2 warn (both deliberate `no-img-element` on
`blob:` URLs) · unit **1606** ✓ · default e2e **228/228** ✓ · zero horizontal overflow and zero
console errors at 1440 / 1920 across every archetype.

**Deliberately not done** (recorded, not hidden):
- `computeWaveform` still decodes through a bare `AudioContext` with no FFmpeg fallback, so on
  Firefox/Safari an `.m4a`/`.ogg` whose *conversion* succeeds can still show "preview unavailable".
  Routing it through `decodeAudioFile` would let a decorative waveform pull the ~31 MB FFmpeg core —
  the wrong trade. Needs a cheaper probe, not a fallback.
- The `image` archetype's chips are still `["Process", "Rename"]`. Nothing false, but "Process"
  carries no information the way `Decode/Encode` now does for `batch`.
- No test pins pipeline-chip TEXT, so those strings can rot again silently.

---

## Phase 8 — Real design docs + the video size cap (2026-08-30)

*Two triggers. The owner exported the Claude Design handoff bundle to
`~/Desktop/transmute-ui-mockups/`, closing the gap Phase 7 recorded (DesignSync was
unavailable then, so Phase 7 was checked against `design-audit.md` rather than the docs
themselves). And: "I am also getting File is too large (125.4 MB). Maximum is 100 MB. in
video tools, why this limit? This limit should not be there unless we are limited by
something which we cannot resolve."*

### The size cap was arbitrary, and the real ceiling is elsewhere

- [x] `MAX_FILE_SIZE = 100 * 1024 * 1024` had **no derivation anywhere in the repo**. It was
  ~18x too strict. Everything below was measured, not reasoned about:
  - The shipped `ffmpeg-core.wasm` declares memory `{initial: 512 pages = 32 MB, maximum:
    32768 pages = 2048 MB}` — but **file bytes never live in the wasm heap**, so this was
    never the binding limit.
  - V8 refuses a single buffer near 2 GiB (2040 MiB allocates, 2047 MiB throws).
  - emscripten's MEMFS grows a file by `capacity * 1.125` holding old and new at once, so a
    file dies well under that. Observed death: a 2500 MiB trim reached `size= 1838336kB`
    (1795 MiB) and the worker died.
- [x] **The input never needed copying.** `mountInputFile` mounts the `File` through WORKERFS
  and FFmpeg reads slices on demand, so the source never becomes an ArrayBuffer on either
  thread. The old path paid for it twice — `file.arrayBuffer()` in the page heap, then MEMFS
  keeping a second full-size array for the length of the job (~3 GB resident for a 1.5 GB
  video). This is what makes an uncapped extraction honest.
- [x] **mp4-to-mp3 now has NO input cap** (verified end to end at 2500 MB → a 775 MB MP3).
  **video-trimmer is 1536 MB**, because a stream copy's output is the size of its input and
  both must survive MEMFS. Derived per job shape, with the derivation written where the
  bare `100` used to be.
- [x] **Failures say what happened.** `@ffmpeg/ffmpeg` posts errors as *strings*, so
  `useFileProcessor`'s `err instanceof Error` check collapsed every core-level failure —
  a genuine OOM included — into "Processing failed". `describeFFmpegFailure` translates it.
- [x] Owner's case verified independently: a real 123.4 MB MediaRecorder clip → 0.69 MB MP3
  in **9.0 s**, drop zone reading `NO SIZE CAP`; trimmer advertises `MAX 1.5 GB`. Pinned by
  `e2e/conversion/large-input.spec.ts`, which builds its ~120 MB fixture in the page (a noisy
  canvas plus a real audio track) rather than checking a binary into the repo.

### The design docs said things the derived record did not

14 agents: 6 read-only extractors (one per doc) writing precise specs, then 7 implementers on
disjoint file sets, then a re-run of two whose extractors crashed mid-response. 173 diffs
extracted, 88 applied in the first pass.

- [x] **The control rail is a flat `340px`** (`aside width:340px;flex:none`). Phase 7 shipped
  `clamp(300px,24%,368px)`, which never once reached 340: inside the 1440 band minus the 230px
  sibling rail minus padding, 24% of ~1146 is 275, so the clamp floor won at every width up to
  1920 and every screen drew a 300px rail.
- [x] **The canvas gap is 14px**, not 13 — and the doc animates every loaded canvas with
  `tmRise`, which ran on exactly one surface (`RecordStage`) before this.
- [x] **The spec panel is a 250px key/value column beside the h1**, one mono row per fact, not
  four tiles stacked across the full measure.
- [x] **The Nocturne signature rule** — a hairline fading to transparent over exactly 48px at
  each end — was not implemented at all. Now `RULE` in `ToolPageLayout`.
- [x] Confirmed already correct, so not churned: fonts (Inter + IBM Plex Mono via `next/font`)
  and the radius scale (4 / 8 / 14).
- ◇ **Phosphor icons stay unimplemented.** The `_ds` readme says to use them; the app ships
  lucide-react. Kept per the Phase 1 decision — the six screen docs were drawn with the app's
  own icons.

### Found while verifying, unrelated to either trigger

- [x] **Three blog posts shipped broken tables to readers.** `createMDX({})` had no
  `remark-gfm`, so pipe-syntax tables rendered as literal `| --- |` text inside a `<p>` —
  while `blog/[slug]/page.tsx` carried a full set of `prose-table:*` styles that could never
  apply. Five tables across `heic-vs-jpg`, `modern-image-formats-webp-avif-jpeg-xl` and
  `video-to-gif-tradeoffs`. Plugins are named as **strings**, not imported: this project
  builds with Turbopack and a JS function cannot cross into Rust. Guarded by
  `e2e/meta/blog-tables.spec.ts`.
- [x] `heic-vs-jpg` listed `mp4-to-mp3` and `video-trimmer` in `relatedTools`, so two video
  tool pages advertised a HEIC-vs-JPG article under "From the blog". Removed.
- [x] The skip link was the one focusable surface still on the browser default focus ring.

**Gate: ✅ MET 2026-08-30.** tsc ✓ · lint 0 err / 2 warn (both deliberate `no-img-element` on
`blob:` URLs) · unit **1629** ✓ · default e2e **231/231** ✓ · conversion **111 passed / 2
designed skips** ✓ · static export **87 routes** ✓.

**Owner calls — decided 2026-08-30, and one of them was a false dilemma:**
- ✅ **H-03 was never a conflict.** Re-read against the docs directly: `top:82px` appears once,
  in Home Redesign, on the homepage's own "Reached for most" rail; `top:74px` appears three
  times in Site Pages, on the hub "ON THIS PAGE" rail, the blog "CONTENTS" rail and the blog
  "TRY IT HERE" rail. Four different rails, each specified by its own doc. The earlier pass
  assumed they had to share one offset and reported a 3-to-1 disagreement that does not exist.
  Homepage moved to 82; the other three were already right. Verified live: home 82, hub 74,
  blog 74.
- ✅ **A-01 — the 1440px band stays** (owner decision). It keeps the homepage aligned with the
  navbar, footer and every other route.
- ◇ **K-02/K-03 — the navbar is a genuine conflict**, unlike H-03: the same element, 58px tall
  with identical padding and gap, drawn at `88%` + `blur(16px)` in Home Redesign and at `94%` +
  `blur(14px)` three times in Site Pages. One navbar renders on every route, so it cannot honour
  both. Kept at 94% / `blur(14px)` — the majority, and the doc that owns site chrome. Note for
  the record: an earlier pass reported the app as running `blur(24px) saturate(1.5)`; that value
  is from **Current UI**, the pre-redesign reference doc, and was never a target.
- ✅ **L-01/L-06 — done, and they were not "deltas".** The docs specify different animation
  values *per surface*, and the shared keyframes already matched Tool Redesign and All Tools
  exactly (`tmBlink` .25, `tmGlow` .35→.8, `tmRise` 8px). Home Redesign wants `.2`, `.3→.75`
  and its own `tmSlide` at 6px. Retuning the shared keyframes would have moved all 67 tool pages
  off their own doc to satisfy the homepage, so the homepage got its own tokens instead:
  `--animate-tm-blink-deep`, `--animate-tm-glow-home`, `--animate-tm-slide`. Verified live: the
  hero runs `tm-glow-home`, the caret `tm-blink-deep`, and a tool page's status dot still runs
  `tm-blink` at 3.2s.
- ✅ **S-08 — hub one-liners: done** (owner delegated the call). All 67 tools now carry a
  `hubLine`, so all five hubs match the design instead of only `/image-tools`. The 45 missing
  lines were written one agent per category, each RETURNING its lines rather than editing
  `tools.ts` — four parallel writers to one file would have clobbered each other. Every numeric
  claim was checked against the code before it landed: `Math.ceil(words / 225)`, 8 SQL dialects,
  `getNextRuns(expression, 5)`, `floatTo16Bit` at the source sample rate, WhatsApp 720p /
  Email 480p, 7 case transforms with acronym handling. Lengths 34–46 chars against the
  existing 31–47 band.

### The hub lines exposed a worse problem: the copy was lying

Writing a truthful one-liner meant reading each tool's code, and every agent kept hitting the same
thing — the registry's `description` advertising a feature that does not exist. That field renders
as the page's `<meta name="description">`, so these were false claims in search results. A
follow-up pass audited `description` and `aboutText` for all 67 tools against the shipped code:
**44 false claims across 32 tools**, all corrected (descriptions rewritten inside the 120–160
character window `tool-metadata.test.ts` pins).

A representative sample, each with the code that disproved it:
- [x] `json-formatter` / `xml-formatter` / `sql-formatter` — "with syntax highlighting"; all three
  output panes are a plain `<pre>`. `json-formatter` also promised a collapsible tree view; the
  MODE control has exactly two options, Format and Minify.
- [x] `csv-to-json` — "auto-typed values"; the row is `Record<string, string>` and nothing is
  coerced. Its `aboutText` also claimed tab/semicolon delimiter detection; the parser branches on
  `ch === ","` only.
- [x] `base64-encode-decode` — "Web Crypto powered"; it is `btoa`/`atob` plus `TextEncoder`.
- [x] `qr-code-generator` — "Wi-Fi credentials, contact cards"; one free-text textarea, no
  payload templates.
- [x] `color-picker` — "Includes a recent colors palette"; no history state exists. Its
  `aboutText` also described a gradient canvas; the picker is `<input type="color">`.
- [x] `text-diff` — "inline or side-by-side"; both modes render one combined pane, and the control
  switches word-diff vs line-diff.
- [x] `text-case-converter` — "CONSTANT_CASE"; the converters map has seven keys, not that one.
- [x] `split-pdf` — "into multiple files"; it emits a single `split.pdf`.
- [x] `add-page-numbers` — font choice and skip-title-page; `addPageNumbers` takes neither and
  hardcodes Helvetica 10pt.
- [x] `merge-pdf` — "uses the pdf-lib library"; `mergePdfs` builds a `mupdf.PDFDocument`.
- [x] `compress-pdf` — "stripping metadata, deduplicating objects"; the whole operation is
  `saveToBuffer("compress,garbage")`, which drops unreferenced objects and preserves `/Info`.
- [x] `wav-to-mp3` — "96–320 kbps"; `BITRATE_OPTIONS = [128, 192, 256, 320]`.
- [x] `merge-audio` / `audio-trimmer` — "drag to reorder" and "type exact timestamps"; reordering
  is arrow buttons and the trim controls are two range inputs.
- [x] `tiff-to-jpg` — "single and multi-page TIFFs"; `UTIF.decodeImage(arrayBuffer, ifds[0])` reads
  the first page only.
- [x] `svg-to-png` — "set custom dimensions"; the converter UI has no dimension input.
- [x] `compress-image-to-100kb` / `-200kb` — "may also resize to reach the target"; the canvas is
  drawn once at `bitmap.width, bitmap.height` and only quality is searched.
- [x] `resize-image` — an `aboutText` preset list naming "Facebook Cover (820×312)", absent from
  `image-resize.ts`.
- [x] `webp-to-png` — "download them individually"; batch output is a ZIP only.

Two phrases were deliberately KEPT after checking: `markdown-to-pdf`'s "syntax highlighting" is
true (it lazy-loads Shiki), and `qr-code-generator`'s `aboutText` sentence about what QR codes *as
a format* can encode is a statement about the format, not a claim about the tool.

**Gate after this pass: ✅** tsc ✓ · lint 0 err / 2 warn ✓ · unit **1629** ✓ ·
default e2e **231/231** ✓ · static export **87 routes** ✓.

### Release readiness (2026-08-30)

Seven independent auditors — diff hygiene, deploy integrity, cross-browser, SEO, security,
performance, accessibility — plus an adjudicator that re-verified every blocker claim rather than
accepting it. Four returned ship-with-notes; three claimed block; three of the six claims were
upheld. All three are fixed:

- [x] **A filename was being sent to Google.** `file.name.split(".").pop()` returns the WHOLE
  STRING when there is no dot, so a file called `Q4 board minutes` was transmitted verbatim as a
  GA event label — on a product whose privacy page promises "nothing about the files you process
  is ever recorded". `fileExtensionLabel()` in `hooks/useFileProcessor.ts` now emits a short
  alphanumeric extension or `"unknown"`; `useBatchProcessor` shares it.
- [x] **The privacy page stated something false.** "Transmute sets no first-party cookies" — a
  page load sets `_ga` and `_ga_<id>`, two-year lifetime, no consent gate (verified by reading the
  cookie jar, not the docs). The FOOTER was already honest ("NO COOKIES BEYOND ANALYTICS"), so the
  two contradicted each other. Copy corrected to name the cookies and their lifetime, per the
  project's standing rule of fixing copy to match reality.
  ⚠ **Owner call left open:** `gtag('config', GA_ID, { client_storage: 'none' })` would make GA4
  cookieless and the original claim TRUE, at the cost of every visit counting as a new user. One
  line. Not taken unilaterally because it changes the analytics data.
- [x] **The copy-honesty pass had a scope hole: it never touched `h1`, `subtitle` or `titleTag`** —
  0 edits across all 67 tools, against 20 descriptions and 25 aboutTexts rewritten. It had already
  leaked: `svg-to-png` shipped `<title>` and H1 promising "Any Resolution" on a page whose own
  corrected body text says "There is no resolution control on this page", and `text-diff`'s
  subtitle still advertised a side-by-side mode that was never built. A follow-up swept all 67:
  9 more false headline claims found, 59 tools cleared. The compressor variants promised to shrink
  "any image to under 100 KB" in both subtitle AND description, but
  `image.worker.ts:232` falls back to the smallest over-target blob — it is a best-effort binary
  search over quality, and it never resizes. Also fixed: `json-formatter`'s "view as a tree"
  (the MODE control has two options), `hash-generator`'s "using Web Crypto API" (MD5 is js-md5),
  and `compress-pdf`'s "removing metadata" (`saveToBuffer("compress,garbage")` preserves /Info).

Deliberately kept after checking: `uuid-generator` and `password-generator` really are Web Crypto
(`crypto.randomUUID`, `crypto.getRandomValues`); `markdown-to-html`'s "side-by-side preview" is
genuinely two panes; `markdown-to-pdf`'s "syntax highlighting" lazy-loads Shiki.

**Not blocking, recorded for the owner:**
- `compress-video` and `webm-to-mp4` fail in Safari and Firefox with a raw internal error instead
  of the friendly "needs WebCodecs" guard. Pre-existing, not a regression from these passes.
- `exifreader` 4.37.0 carries two unpatched DoS advisories and runs synchronously on the main
  thread against untrusted image bytes.
- `npm audit` reports 8 vulns, all `sharp` -> libvips. `sharp` is transitive via `next` and, with
  `output: "export"` + `images.unoptimized`, is a build-time optimiser that never ships. The
  `--force` remedy moves to next@16.3.3, outside the stated range.
- `Year.tsx` hardcodes 2026 as its server snapshot, so a JS-disabled reader sees a stale copyright
  from 2027 onward.
- 22 files are untracked; `git add -A` captures all of them. Every new module has real importers.

**Final gate: ✅** tsc ✓ · lint 0 err / 2 deliberate warn ✓ · unit **1629** ✓ ·
default e2e **231/231** ✓ · conversion **111 passed / 2 designed skips** (Chromium + WebKit) ✓ ·
static export **87 routes** ✓.

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
