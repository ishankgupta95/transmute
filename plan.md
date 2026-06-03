# Transmute — Bug-Fix, Polish & Optimization Plan

> **Rewritten 2026-06-03** after a full-codebase audit (31-agent fan-out, every subsystem read in full,
> each high/critical bug adversarially verified). The *previous* plan assumed "all 64 tools are built and
> working" and was an optimization/SEO/AdSense plan. That premise was **wrong**.
>
> The app builds clean (`next build` green, 88 routes), `tsc` is green, ESLint has 0 errors, and **1212
> unit tests pass** — yet the owner reports "almost everything is broken." The reason: **unit tests run in
> jsdom with NO `canvas.getContext()` and NO WASM**, so the actual image/PDF/audio/video conversion logic
> — the core of the product — is **never exercised by the test suite**. Green tests said nothing about
> whether conversions work in a real browser.
>
> A real-browser-focused audit found **151 issues: 4 critical, 28 high, 48 medium, 71 low — 80 of them
> genuine bugs.** This plan is now grounded in that audit. Items marked **[V]** were adversarially verified.

---

## Snapshot — ACTUAL current state (verified 2026-06-03)

- **Stack:** Next.js 16.2.2 (App Router, `output: "export"`, Turbopack), React 19, TypeScript strict, Tailwind v4
- **Deploy:** GitHub Pages, custom **apex domain `transmute.tools`** (`public/CNAME`). **No `basePath`** — the
  site serves from root. The repeated `basePath: "/transmute"` note in `CLAUDE.md` and the old plan is
  **STALE** and contradicted by `next.config.ts` (no basePath) and the live domain. All canonical/sitemap/OG
  URLs in code use the absolute `https://transmute.tools` base, so those are correct. One harmless stale
  `/transmute` assumption remains in `pdf-engine.ts` `locateFile`.
- **Tools:** **68** registered in `src/data/tools.ts` (not 64). Homepage hardcodes "Browse all **66** tools" — wrong.
- **Build:** `next build` green, 88 static routes (68 tools + 5 categories + about/privacy + blog index + 8 posts + home + sitemap).
- **Quality gates:** `tsc` green · ESLint **0 errors / 22 warnings** (mostly `<img>` hints) · **1212 unit tests
  pass / 67 skipped** (53 files) · E2E **17 spec files (~98 tests)**, Chromium-only.
  - ⚠️ **Test blind spot:** jsdom has no canvas/WASM, so conversion correctness is effectively untested. This is the #1 reason real bugs shipped despite green CI.
- **AdSense:** id `ca-pub-3308993640799405` in `layout.tsx` + `ads.txt` (the old plan's `ca-pub-8318354633894162`
  appears nowhere in the code). `NEXT_PUBLIC_ADS_ENABLED` is **never set in the build** → ads are off in prod.
  No `<AdSlot>` component exists.
- **`public/_headers`** sets COOP/COEP `require-corp` globally (`/*`). **GitHub Pages ignores `_headers`**, so it's
  dead config today — but it's misleading, and if ever honored it would block cross-origin assets (and AdSense).
- **Beta badge** still present in `Navbar.tsx`.

---

## Why it "feels broken everywhere" — the root causes

A handful of shared defects cascade across many tools, which is why the whole app reads as broken:

1. **Transparent images → BLACK background** when output is JPEG (no white fill before `drawImage`). Hits
   png/webp/avif→jpg **and** the Image Compressor **and** the Image Resizer. Ugly black boxes on any logo/icon/screenshot. **[V]**
2. **Resizer & Compressor always output JPEG** and rename to `.jpg` regardless of input → transparency lost, format silently changed. **[V]**
3. **25 tools reimplement clipboard copy without `await`/`.catch`** → user sees "Copied!" while nothing was copied (silent failure on denied/insecure/unfocused contexts). A correct `CopyButton` already exists, unused. **[V]**
4. **The "shared" processing hook is used by only 8 of 68 tools** → no shared progress/abort/loading; every other tool hand-rolls inconsistent state. No cancel anywhere; no real progress on heavy WASM jobs. **[V]**
5. **WebCodecs video tools crash in Firefox** (no capability check) and **hang forever on "Processing"** when an encoder errors (error callbacks `throw` into async void). **[V]**
6. **Multi-file "Download All" only downloads the first file** — the download util revokes the blob URL synchronously in a tight loop. **[V]**

Fixing these six gives the largest perceived-quality jump.

---

## Bug backlog (prioritized, deduped)

> **✅ Implementation pass — 2026-06-03.** All **P0 (6)** and **~18 P1** items below are FIXED in the working tree
> (tsc + ESLint 0-errors + **1215 unit tests** + production build all green; the diff was adversarially reviewed and
> the one real regression it found — a WebCodecs backpressure hang — was fixed). **Deferred:** the `useFileProcessor`
> progress/abort/batch refactor (architectural) and the **P2/P3** backlog + UI-redesign direction. **Not committed** — left for review.

### P0 — Critical: security, data corruption, total-feature-failure — ✅ all fixed

- [x] **Transparent images flatten to BLACK on JPEG output.** Fill an opaque white background before `drawImage`
  whenever the output MIME lacks alpha. **[V]**
  `image-convert.ts:33-41`, `image-compress.ts:92-109`, `image-resize.ts:55-73`, `canvas-utils.ts:16-31`
- [x] **Resizer & Compressor hard-code JPEG output + `.jpg` rename** for PNG/WebP/AVIF/GIF inputs → transparency
  loss + silent format change. Preserve source format (png→png, webp→webp) or add a format selector; white-fill if JPEG. **[V]**
  `image-resize.ts:73-81`, `image-compress.ts:23,92-108`
- [x] **XSS in Markdown→HTML preview:** `dangerouslySetInnerHTML` with unsanitized `marked.parse()`. Sanitize with
  DOMPurify (preview sanitized; raw HTML kept for copy/HTML view). **[V]**
  `MarkdownToHtmlUI.tsx:11,57-60` (RegexTester `dangerouslySetInnerHTML` attribute gap still open, low)
- [x] **WebCodecs tools crash in Firefox / old Safari** (no `VideoEncoder`/`requestVideoFrameCallback`); generic
  "Compression failed". Added `assertWebCodecsSupported()` + `pickH264Config()` (profile/HW fallback) + clear message. **[V]**
  `video-utils.ts`, `video-compress.ts`, `webm-to-mp4.ts`
- [x] **WebCodecs encoder error callbacks `throw e`** into async void → uncaught rejection, UI stuck forever.
  Errors captured (not thrown), checked after flush, AND wake any parked backpressure waiter so the loop can't hang. **[V]**
  `video-compress.ts`, `webm-to-mp4.ts`
- [x] **Multi-file "Download All" only downloads the first file** — sync object-URL revoke. Revoke now deferred;
  multi-file output bundles into one ZIP (`downloadFilesAsZip`). **[V]**
  `download.ts`, `PdfToJpgUI.tsx`

### P1 — High: broken features / wrong output — ✅ all fixed (except the `useFileProcessor` refactor, deferred)

- [x] **Clipboard "Copied!" lies on failure across ~25 tools.** Migrated 24 tools to a shared `copyText` helper
  (`src/lib/utils/clipboard.ts`) that awaits the write and only confirms "Copied!" on success. **[V]**
- [x] **Color palette returns 2^N colors and `#NaNNaNNaN` swatches** instead of the N selected (count is passed as
  recursion *depth*; empty buckets → NaN). Rewrite as count-driven iterative median-cut; filter empty buckets. **[V]**
  `color-palette.ts:47,74-106`, `ColorPaletteUI.tsx:32`
- [x] **EXIF "Remove & Download" fails for HEIC/HEIF/TIFF** (its flagship "strip GPS from iPhone photos" use). Route
  `stripExifData` through `toDecodableBlob` (heic2any/utif2) or restrict accept formats. **[V]**
  `exif-viewer.ts:44-48`, `tools.ts:339`, `ExifViewerUI.tsx:46`
- [x] **Base64 decode fails on URL-safe input** (`-`/`_`, no padding). Normalize before `atob`; add a URL-safe encode toggle. **[V]** `Base64EncodeDecodeUI.tsx:22-31`
- [x] **JWT decoder corrupts UTF-8 claims** (José/CJK/emoji → mojibake). Decode via `TextDecoder` over the byte array. **[V]** `JwtDecoderUI.tsx:18-21`
- [x] **JSON→CSV doesn't flatten nested objects** → `[object Object]` columns (copy claims dot-notation flattening). Implement recursive flatten. **[V]** `JsonToCsvUI.tsx:7-27`
- [x] **CSV→JSON breaks on Windows CRLF** (trailing `\r` in keys/values) and doesn't handle quoted multi-line fields despite copy. Single-pass quote-aware parse + line-ending normalize. **[V]** `CsvToJsonUI.tsx:7-54`
- [x] **UUIDv7 timestamp corrupted by 32-bit bitwise AND** → loses time-ordering (the whole point of v7). Use floored division, drop the mask. **[V]** `UuidGeneratorUI.tsx:14`
- [x] **FFmpeg trim uses `-ss/-t` after `-i` with `-c copy`** → keyframe-only cuts: wrong start, frozen/black lead, A/V desync; about-copy falsely claims "precise"/"lossless". Re-encode for accuracy or `-ss` before `-i` + label as keyframe-aligned; normalize output to mp4. **[V]** `video-trim.ts:24-32`
- [x] **compress-video / webm-to-mp4 decode the whole file twice and silently drop the audio track** (AAC/Opus that WebAudio can't decode → `detectAudio` false → no audio). Decode once; use a real demuxer/`AudioDecoder`. **[V]** `video-utils.ts:32-42`, `video-compress.ts:35,112`, `webm-to-mp4.ts:21`
- [x] **WebCodecs muxer hardcodes stereo/48k** while encoder uses source channel count → corrupt/mis-pitched audio for mono sources. Compute channels+rate once, pass to both muxer and encoder. **[V]** `webm-to-mp4.ts:38,134-147`, `video-compress.ts:50,149-162`
- [x] **`detectAudio` leaks an AudioContext on every audio-less video** (catch branch never closes it) → after ~6 runs the tool dies until reload. Close in `finally`. **[V]** `video-utils.ts:32-42`
- [x] **Screen recorder leaks live MediaStream** (camera/screen/mic indicator stays on after navigating away) + leaks the recording URL. Add unmount cleanup that stops tracks and revokes the URL. **[V]** `ScreenRecorderUI.tsx:10-145`
- [x] **WebCodecs tools advertise `.mov/.avi/.mkv`** the `<video>` pipeline can't decode → silent failure. Restrict accept lists to `.mp4,.webm,.mov`; validate finite duration. **[V]** `CompressVideoUI.tsx:63`, `VideoToGifUI.tsx:89`, `video-utils.ts:21-27`
- [x] **Audio trimmer rejects a valid full-range trim** (media-element duration > decoded duration on VBR MP3/M4A). Clamp `endTime`/`endSample` instead of throwing. **[V]** `AudioTrimmerUI.tsx:51`, `audio-trim.ts:23`
- [x] **`addPageNumbers` shadows inherited PDF `/Resources`** with an empty dict → corrupts pages that rely on tree-inherited fonts/XObjects. Resolve/merge inherited resources first. **[V]** `pdf-engine.ts:173-183`
- [ ] **`useFileProcessor` has no progress, no abort, no batch — and only 8/68 tools use it.** Extend (progress number, AbortSignal threaded into ffmpeg/webcodecs, `ProcessedResult[]`) and migrate tools onto it. **[V]** `useFileProcessor.ts:15-52`
- [x] **Doubled `| Transmute | Transmute` `<title>` on all 68 tool pages** (title template + manual suffix). Return `title: tool.h1` and let the layout template add the suffix. **[V]** `tool-metadata.ts:310`, `layout.tsx:28-31`
- [x] **DropZone never shows its `label`** — every upload zone reads the same generic "Drag & drop or browse files," so 60+ tools give zero hint of expected format/count. Render `label` + accepted-formats line. **[V]** `DropZone.tsx:72-77`

### P2 — Medium (representative; full list in audit)

- **Image:** rotated crop produces misaligned region (`image-crop.ts:28`); cropper preview leaks an object URL per render (`ImageCropperUI.tsx:120`); `bmp` target silently emits PNG bytes with `.bmp` name (`image-convert.ts:21-47`); SVG-to-PNG → 0×0 for dimensionless SVGs; converter/compressor advertise batch but process only the first file.
- **PDF:** Compress PDF only deflates streams (never shrinks image-heavy PDFs) — set expectations or add rasterize mode (`pdf-engine.ts:266-274`); `pdfToImages` crashes when `toBlob` returns null at high scale (`pdf-engine.ts:300-313`); MergePdf keeps a stale download after reorder/remove (`MergePdfUI.tsx:51-61`); split/rotate/reorder thumbnails silently capped at 50 pages.
- **Audio:** WAV/MP3 encoders drop channels beyond stereo (`audio-encode-wav.ts:7`, `audio-encode-mp3.ts:13`); all audio silently resampled to the system AudioContext rate (`audio-decode.ts:7`); m4a/AAC decode unreliable outside Chromium — fall back to FFmpeg (`audio-decode.ts:9`); trim OOB reads write NaN/0 (`audio-trim.ts:26,37`).
- **Video:** no cancel/abort for any long job (`CompressVideoUI`/`VideoToGifUI`/`VideoTrimmerUI`, thread AbortSignal + `ffmpeg.terminate()`); FFmpeg singleton shares one mutable progress callback across ops (`ffmpeg-loader.ts:10,38,52-55`); video-to-gif start-seek mistimed (`video-to-gif.ts:39-49`); VideoTrimmer leaks a detached metadata `<video>` + URL (`VideoTrimmerUI.tsx:25-43`).
- **Dev:** XML formatter mis-indents after comments (`XmlFormatterUI.tsx:24`); cron uses AND for day-of-month+weekday (POSIX is OR) and mis-parses steps (`CronExpressionGeneratorUI.tsx:42-68`); color picker shows NaN for partial/3-digit hex (`ColorPickerUI.tsx:5-8`); Base64 file-mode poisons text mode (`Base64EncodeDecodeUI.tsx:49-61`); `formatFileSize` returns "undefined"/"NaN" past TB / for bad input (`file-helpers.ts:1-6`).
- **Infra/UX:** GA only counts the initial pageview — client-side navigations untracked (`layout.tsx:103-110`); DropZone never filters by `accept` (wrong-type files crash downstream) (`DropZone.tsx:25-43`); MobileNav has no backdrop-click/Escape/focus management (`MobileNav.tsx:32-95`); homepage "66 tools" + CTA links only to image tools (`page.tsx:174-179`).
- **SEO:** `WebSite` `SearchAction` schema declares a search that doesn't exist (`page.tsx:31-35`); 45 tools have only 3 unique FAQs + shared privacy boilerplate (`faqs.ts`); video-to-gif/webm-to-mp4/compress-video copy makes **false engine claims** (FFmpeg/palettegen/lossless) vs the real WebCodecs/gifenc impl (`tools.ts:935-941`, `tool-metadata.ts:151-155`).
- **Config:** decide AdSense intent — either set `NEXT_PUBLIC_ADS_ENABLED=true` + add real ad units, or remove the dead AdSense Script/meta/ads.txt/privacy clause (`layout.tsx:10,111-117`, `ci.yml:76`).

### P3 — Low / polish (71 items; highlights)

- Text-case converter lowercases acronyms / mangles all-caps; password generator has modulo bias + no guaranteed
  character classes; regex tester can hang on catastrophic backtracking (add a guard/worker); timestamp converter
  lacks a UTC/local toggle; gradient/box-shadow emit invalid CSS without color validation; lorem "words" mode
  punctuation; cron `describeCron` mislabels lists/ranges/steps.
- Generators don't reset stale results when options change; `useObjectUrl` can revoke a URL still rendered (broken-image flash); DropZone has no processing/disabled state and flickers on drag-leave; inconsistent live-on-type vs click-to-run across formatters.
- 13 tool titles exceed ~60 chars (SERP truncation); canonical strategy inconsistent (some absolute, some relative); no all-tools index route; **no PWA manifest / viewport / themeColor / apple-touch icons**.
- Remove unnecessary Google Fonts preconnects (`next/font` self-hosts); `globals.css` has a custom `body {}` rule (violates the no-custom-CSS rule); root layout hand-rolls `<head>` `<title>/<meta>/<Script>` instead of the Metadata API; remove dead `public/_headers`.

---

## UI/UX redesign direction ("the UI can be a lot better")

- [ ] **Show the DropZone label + accepted formats** (P1 above) — the single highest-leverage clarity fix; touches every file tool.
- [ ] **Global search + ⌘K command palette** for the 68-tool catalog (fuzzy-match name/keywords, deep-link to `/[slug]`).
  Also makes the `SearchAction` schema honest and is a strong distinctive feature.
- [ ] **Consistent result / loading / empty / done states** across all tools — fold into the `useFileProcessor` extension so
  progress/error/reset look identical everywhere (today every tool differs).
- [ ] **Distinctive visual identity** instead of the generic dark card grid: transmutation-themed hero, per-category accent
  colors via new CSS vars, a bento layout that elevates featured tools, depth via subtle gradient borders/inner highlights
  rather than flat 1px borders. (`page.tsx`, `CategoryHubPage.tsx`, `ToolPageLayout.tsx`, `globals.css`)
- [ ] **Consistent content widths and spacing rhythm** across home/category/tool/blog pages.

---

## Performance

- [ ] **Code-split the 9 image tool clients.** They're statically imported into `/[slug]`, so `pica` + `cropperjs` +
  `jszip` + `exifreader` ship on **every** tool route (even password-generator). Add `ImageToolClients.tsx` wrapping each
  in `next/dynamic({ ssr: false })`, mirroring `DevToolClients.tsx`. **[V]** `[slug]/page.tsx:7-15`
- [ ] **Self-host `@ffmpeg/core`** under `public/` (like the mupdf WASM) instead of fetching ~25 MB from unpkg at runtime —
  works offline, immune to COEP, no CORS dependency. Then **remove the dead `public/_headers`**.
- [ ] Remove unnecessary `fonts.googleapis.com`/`fonts.gstatic.com` preconnects (`next/font` self-hosts at build).
- [ ] Add a catastrophic-backtracking guard (timeout/worker) to the regex tester so it can't freeze the tab.
- [ ] (Lighthouse Perf/A11y/SEO scores claimed in the old plan are **unverifiable from source** — re-measure on the live URL.)

---

## SEO correctness

- [ ] Fix the doubled `<title>` (P1). · Fix 13 over-length titles. · Unify the canonical strategy (absolute everywhere).
- [ ] Make the `SearchAction` schema honest (ship search or drop the `potentialAction`).
- [ ] Give the 45 thin-FAQ tools a genuine 4th/5th tool-specific FAQ; reduce reliance on the shared privacy FAQ.
- [ ] Correct the **false engine claims** in video-to-gif / webm-to-mp4 / compress-video copy.
- [ ] Add PWA manifest + `viewport`/`themeColor`/icon metadata. · Consider an all-tools index route for crawl + UX.

---

## Plan-vs-code corrections (keep this doc honest)

| Old plan claim | Reality (code) |
| --- | --- |
| AdSense `ca-pub-8318354633894162` | `ca-pub-3308993640799405` (`layout.tsx:9`, `ads.txt`) |
| 64 tools / "87 routes" | **68 tools**, 88 routes; homepage hardcodes "66" |
| `basePath: "/transmute"` | **No basePath**; apex domain `transmute.tools` (`CNAME`) |
| 651 unit tests / "11 specs, 85 E2E" | **1212 unit (1279 w/ skips)**; **17 E2E specs (~98 tests)** |
| §4.5 COOP/COEP "risk to confirm" | `_headers` is global already, but **dead on GitHub Pages** — reframe |
| Workstream P (Markdown→PDF) complete | **TRUE** — files exist and are wired |
| AdSense placements not started | **TRUE** — no `<AdSlot>` exists |
| Beta badge in Navbar | **TRUE** — still present |
| §1.5a contrast bump (`--text-muted #858378`) | **TRUE** |
| Lighthouse scores, bundle KB, FOUT, word counts | **Unverifiable from source** — re-measure live |

---

## Suggested sequencing

1. **P0 bug fixes** (6 items) — biggest perceived-quality jump, especially the transparent-JPEG + resizer/compressor format fixes.
2. **P1 bug fixes** — restore correct output across image/dev/audio/video tools; consolidate clipboard on `CopyButton`; extend `useFileProcessor`.
3. **UI/UX uplift** — DropZone labels, command palette/search, consistent states, visual identity.
4. **Performance** — code-split image clients, self-host ffmpeg core, prune preconnects.
5. **SEO correctness** — titles, canonicals, honest copy, FAQs, manifest.
6. **P2/P3** — sweep medium/low items by area.
7. **Then** the prior post-deploy items below (manual device/a11y passes, Rich Results, etc.).
8. **Backfill real conversion tests** (the biggest process gap): Playwright tests that actually run conversions in Chromium with real fixtures, so this class of bug can't recur silently.

---

## Retained from prior plan (post-deploy / manual / out of scope)

**Manual verification (needs real devices / screen readers / live URL):** FFmpeg deadlock smoke across Chrome/Safari/Firefox;
image-resize boundary cases; PDF cross-realm ArrayBuffer in Safari/Firefox; MP3 playback in QuickTime/WMP; real iPhone Safari +
Android Chrome walk-through; 320px + landscape; keyboard-only + VoiceOver + axe; `prefers-reduced-motion`; FOUT on Slow 3G.

**Post-deploy SEO:** Rich Results Test on 6 URLs; Search Console sitemap resubmit + index requests; OG smoke-test; `npm audit fix`;
ongoing impressions/CTR tracking. **Beta exit:** remove the badge in `Navbar.tsx` once manual passes are clean.

**AdSense (only if monetizing):** build `<AdSlot>` (flag-gated), placement strategy (no ads above the tool), slot map; confirm
COOP/COEP non-issue (it's dead on Pages); flip `NEXT_PUBLIC_ADS_ENABLED=true` after approval.

**Out of scope:** new tools/categories, freemium tiers, i18n, promotion, re-architecting the three-layer pattern,
domain registrar transfer.
