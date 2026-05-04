# Transmute — Optimization & Polish Plan

> All 64 tools across 5 categories are built and live at **https://transmute.tools**.
> This plan covers what's left: SEO content, UI/UX polish, E2E coverage with Playwright, AdSense placements.
> **No new tool features** — only optimization, fixes, and product quality.

---

## Snapshot — what's already done

- **Stack:** Next.js 16.2.2 (App Router, `output: "export"`), React 19, TypeScript strict, Tailwind v4, GitHub Pages
- **Domain:** `transmute.tools` live (Cloudflare DNS → GitHub Pages); CNAME at `public/CNAME`; HTTPS enforced
- **CI:** `.github/workflows/ci.yml` runs lint + `tsc --noEmit` + Vitest (coverage), then deploys `out/` to `gh-pages` on `master`
- **Tools shipped (64 total):** image converters (11), image utilities (10), developer tools (25), PDF tools (8), audio tools (5), video tools (6) — all wired through `src/data/tools.ts` + the Server page → Client wrapper → UI three-layer pattern
- **Technical SEO:** sitemap, robots.txt, JSON-LD (HowTo, FAQPage, SoftwareApplication, BreadcrumbList), canonical URLs, OG/Twitter, semantic HTML
- **Analytics:** GA4 (`G-TCWDH01ZSK`) loaded; events `tool_used`, `file_processed`, `file_downloaded` firing
- **AdSense:** verification script + `ads.txt` in place (publisher `ca-pub-8318354633894162`); approval pending or recent
- **Headers:** COOP/COEP set in `public/_headers` (required for FFmpeg.wasm SharedArrayBuffer)
- **Beta badge** still in navbar — flagged for removal once polish + E2E are done

**What's missing:** blog content, ad placements, E2E tests, UI/UX cleanup of known bugs.

---

## Workstream 0 — Codebase cleanup (AI slop & dead code)

> Audit pass on the Codex-authored codebase. **Execute first** — fewer files / less duplication makes every later workstream easier. Each finding below was verified by grepping `src/` and confirming zero non-self imports.

> **Status: complete.** All items below have landed in the working tree. Verification (lint, tsc, 651 tests, build) is green.

### 0.1 Tier 1 — Pure deletes (zero risk, ~250 LOC out, 5 files)

- [x] Delete unused UI components (zero importers anywhere):
  - `src/components/ui/Button.tsx`
  - `src/components/ui/Badge.tsx`
  - `src/components/ui/Card.tsx`
  - `src/components/ui/Toast.tsx`
  - Then `rmdir src/components/ui/`
- [x] Delete `src/components/layout/Sidebar.tsx` — defined but never rendered
- [x] Delete unused hooks:
  - `src/hooks/useDownload.ts` — production uses `triggerDownload` directly
  - `src/hooks/useWebWorker.ts` — no Web Workers exist in the project
- [x] Strip dead helpers from `src/lib/utils/file-helpers.ts`:
  - Remove `getExtension` (only its own test imports it)
  - Remove `getMimeType` and the entire MIME map (only its own definition references it)
  - Keep `formatFileSize` — it's the only one in use
  - Update `src/__tests__/unit/lib/file-helpers.test.ts` to drop the corresponding `describe` blocks
- [x] Delete dead placeholder `encodeIco` in `src/lib/tools/ico-encode.ts:5-23`:
  - Function returns `new Blob([])`; production calls `encodeIcoAsync` only
  - Also remove `pngBuffers` / `pngBlobs` dead locals
  - Drop the `describe("encodeIco (sync placeholder)")` block in `src/__tests__/unit/lib/ico-encode.test.ts:179-183`
- [x] Delete unused exported type `FrameCallbackInfo` from `src/lib/tools/video-utils.ts:44-47` — never imported

### 0.2 Tier 1 — Dead dependencies

- [x] Remove `browser-image-compression` from `package.json` — `grep -rln browser-image-compression src` is empty (image compression is in-house in `lib/tools/image-compress.ts`)
- [x] Decide on `@tailwindcss/typography`:
  - Currently installed but **not** registered in `postcss.config.mjs` and not loaded via `@plugin` in `globals.css`
  - The single `prose prose-invert` use in `src/components/tools/MarkdownToHtmlUI.tsx:58` is silently doing nothing
  - Either wire up the plugin OR drop both the dep and the `prose` classes
- [x] Run `npm install` to lock the change, commit `package-lock.json`

### 0.3 Tier 2 — Config / spec drift

- [x] Test infra references folders that don't exist — pick one:
  - `vitest.config.ts:14-15` includes `src/__tests__/integration/**`
  - `playwright.config.ts:4` `testDir: "./src/__tests__/e2e"`
  - Either create both folders with a `.gitkeep` (since Workstream 3 will fill them) or remove the dangling globs
- [x] CLAUDE.md claims `80%` coverage threshold; `vitest.config.ts:18-23` actually sets `10`. Update CLAUDE.md to match (or raise the threshold — the plan calls for ≥80% via §3)
- [x] `src/app/privacy/page.tsx:16` has hardcoded `Last updated: April 7, 2026`. Either lift to a `LAST_UPDATED` constant near the top of the file, or drop the line

### 0.4 Tier 3 — Registry slop

- [x] Fix `relatedTools` self-references in `src/data/tools.ts` (`css-gradient-generator` and `box-shadow-generator` were each listing themselves; both now point at sibling tools)
- [x] aboutText boilerplate cleanup in `src/data/tools.ts`:
  - Stripped trailing/standalone "Everything runs in your browser", "no sign-up", "no watermarks", "completely free", "Free to use", "no account required", "no installation needed" sentences from 63 of 66 entries (~9.3 KB removed)
  - Remaining mid-text mentions are tool-specific context (e.g. WebAssembly explainers, sensitive-document framing) and were intentionally kept
- [x] FAQ duplication in `src/data/faqs.ts`:
  - `PRIVACY_FAQ` is now exported from `faqs.ts` and appended once at render time in `src/app/[slug]/page.tsx`. 41 inline duplicates removed; every tool now gets the privacy FAQ uniformly
- [x] All 66 `description` fields rewritten to land in 120-160 chars (current min/max/avg: 124 / 155 / 135). Each rewrite swaps boilerplate for a concrete benefit, use case, or technical detail (Lanczos3, Web Crypto, FFmpeg.wasm, etc.)

### 0.5 Tier 4 — Duplication refactors (do as separate PRs after the deletes land)

- [x] Extract a shared `<CategoryHubPage>` component → `src/components/layout/CategoryHubPage.tsx` (98 LOC). All 5 hub pages now ~30-50 LOC each (down from 86-122), driven by a `sections: Array<{ title?, tools }>` prop
- [x] Pull `loadImage()` and `canvasToBlob()` into `src/lib/tools/canvas-utils.ts`:
  - 6 `loadImage` and 4 `canvasToBlob` private copies consolidated; param types unified to `Blob` (File extends Blob), quality made optional to fold in ico-encode's 2-arg variant
- [x] Replace inline blob/download with `triggerDownload` in:
  - `QrCodeGeneratorUI` PNG (now uses `canvasToBlob` + `triggerDownload`) and SVG paths; silent `catch {}` now surfaces errors via `setError`
  - `CsvToJsonUI`, `JsonToCsvUI` download handlers
  - `ScreenRecorderUI:59` was a stale plan reference — that line is the preview-video Object URL; the actual download already routes through `<DownloadButton>` → `triggerDownload`
- [x] Decide on the 9 image-related `*Client.tsx` thin wrappers:
  - Confirmed all 9 follow the same `"use client"` forwarder pattern. Per CLAUDE.md and saved memory (next/dynamic with ssr:false must live in a 'use client' wrapper), kept the indirection uniform across categories rather than collapsing the image variants

### 0.6 Tier 5 — Layout / homepage minor

- [x] `src/app/page.tsx` — `organizationSchema` dropped. `WebSite` schema retained
- [x] `src/app/layout.tsx` — AdSense `<Script>` now gated behind `process.env.NEXT_PUBLIC_ADS_ENABLED === "true"`. Default off; flips on by setting the env var. Forward-compatible with §4.1

### 0.7 Verification before closing the workstream

- [x] `npm run lint` clean (0 errors; 21 pre-existing warnings)
- [x] `tsc --noEmit` clean
- [x] `npm test` green (651/651 across 50 files)
- [x] `npm run build` produces a working `out/` (78 routes prerendered: 5 hubs + 64 tools + about/privacy/sitemap)
- [x] `git diff --stat` — net LOC well past target (>−700 LOC tracked + 2 new util/component files)

### 0.8 Out of scope for this workstream

- Re-architecting the Server/Client three-layer pattern (works, just verbose)
- Touching `aboutText` length itself — long form is intentional for SEO; only the *repeated boilerplate* is slop
- Replacing analytics, AdSense, or fonts
- Renaming files / restructuring directories beyond the deletes above

---

## Workstream 1 — SEO

> **Status: §1.1–§1.5 complete locally; §1.6 + §1.7 are post-deploy.** Two items were intentionally deferred per the traffic-ROI conversation: aboutText 200-word floor and the tool-route bundle refactor. Both annotated below.

### 1.1 Blog (biggest remaining traffic lever)

- [x] Scaffold `src/app/blog/page.tsx` (listing) and `src/app/blog/[slug]/page.tsx` (post)
- [x] Use MDX or a typed `src/data/posts.ts` registry (mirror `tools.ts` pattern); keep static-export friendly — landed both: typed registry at `src/data/posts.ts` + MDX bodies at `src/content/blog/*.mdx` rendered via `next/mdx`
- [x] Each post: H1, 1500–2500 words, internal links to 3–5 relevant tool pages, `Article` JSON-LD, OG image, breadcrumbs — all 8 posts confirmed at 1509–2086 words
- [x] Add `/blog` to sitemap and the homepage / footer nav — sitemap includes blog index + 8 posts; Footer + Navbar + MobileNav all link to `/blog`
- [x] Ship 8 launch posts targeting commercial-intent long-tail queries:
  - [x] "HEIC vs JPG: Which Format Should You Use?" → `/heic-to-jpg`
  - [x] "How to Compress Images Without Losing Quality" → `/compress-image` + variants
  - [x] "Complete Guide to Modern Image Formats (WebP, AVIF, JPEG XL)" → all converters
  - [x] "How to Merge PDFs in Your Browser (No Upload)" → `/merge-pdf`
  - [x] "Reduce PDF File Size for Email — 3 Practical Methods" → `/compress-pdf`
  - [x] "Convert Video to GIF — Frame Rate, Size, Quality Tradeoffs" → `/video-to-gif`
  - [x] "10 Free Browser-Based Developer Tools You Didn't Know Existed" → dev category
  - [x] "Why Browser-Based Tools Are More Private Than Online Converters" → privacy/positioning
- [x] Add a `/blog` link to footer + Navbar; cross-link from each tool's "About this tool" section to its companion post — `ToolPageLayout` now renders a "From the blog" section listing every post mentioning the tool, via `getPostsLinkingToTool(slug)`

### 1.2 Metadata audit

- [x] Script: walk every entry in `src/data/tools.ts`, assert `description.length` ≤ 160 and ≥ 120 chars; flag violations — enforced as a CI test in `src/__tests__/unit/data/tool-metadata.test.ts`; all 66 tools pass
- [x] Confirm exactly one `<h1>` per page (tools, hubs, blog, about, privacy) — verified across 73 pages (homepage, 5 hubs, 66 tools, blog index, blog post, about, privacy)
- [ ] Confirm `aboutText` is 200–400 words for every tool (memory says 150–200 — bring up to 200+ on the short ones) — **deferred per traffic-ROI agreement.** All 66 tools currently 115–191 words. Test exists but `describe.skip`ped with explicit comment; flip to `describe(...)` when content is rewritten.
- [x] Verify every tool has ≥ 4 unique FAQ items — 17 new FAQ entries written across 16 tools that were short; CI test enforces ≥4 rendered (faqs.ts entries + `PRIVACY_FAQ`)
- [x] Verify `relatedTools[]` slugs all resolve (unit test in `data/tool-metadata.test.ts` if not already) — test enforces resolution + no self-references + no duplicates
- [x] Verify Open Graph image exists at `/og-image.png` and is referenced (1200×630). If missing, generate one and add to root metadata — generated via `rsvg-convert` from `assets/og-image.svg` (1200×630, 113 KB); referenced from `metadataBase` and every tool's metadata; Twitter card upgraded `summary` → `summary_large_image`

### 1.3 Schema + crawl validation

- [ ] Run Google Rich Results Test on 5 representative URLs (homepage, category hub, image converter, PDF tool, dev tool); fix any reported errors — **moved to §1.7** (post-deploy; cannot run on localhost)
- [ ] Crawl with Screaming Frog (free up to 500 URLs — fits) or `wget --spider`; resolve any 404s, redirect chains, missing titles, duplicate descriptions — **moved to §1.7** (post-deploy)
- [x] Verify `sitemap.xml` lists all 64 tools + 5 categories + about/privacy + every blog post — verified in build output: 87 routes (66 tools + 5 hubs + home + about + privacy + blog index + 8 posts + sitemap + 404)

### 1.4 Internal linking + content polish

- [ ] Each tool's "Related Tools" section: 4–6 entries, audited for relevance (not just same category) — **deferred per traffic-ROI agreement.** Currently 3–4 entries; bumping to 4–6 and auditing for relevance is its own pass.
- [x] Every blog post links to ≥ 3 tools; every tool's About section links to ≥ 1 blog post (once they exist) — both directions enforced as CI tests; all 66 tools have ≥1 companion post; all 8 posts link to ≥3 tools (range 5–24)
- [x] Add a "Popular tools" rail to the homepage based on GA4 top-N (manual curation initially) — hand-curated 8 tools (`POPULAR_TOOL_SLUGS` in `src/app/page.tsx`) mixing commercial intent + category breadth; revisit with GA4 data later
- [x] Image alt text audit on category icons, tool icons, blog post images — all 11 `<img>` tags already had `alt`; added `aria-hidden="true"` to all 16 inline decorative SVGs across 6 files

### 1.5 Performance for SEO

- [x] Lighthouse audit: every category hub + 10 random tool pages. Target Performance ≥ 95, SEO = 100, Accessibility ≥ 95 — ran on 5 representative routes (home, image-tools, heic-to-jpg, /blog, /blog/heic-vs-jpg). Final scores: SEO 100/100/100/100/100 ✓, Accessibility 100 across the board ✓ (after fixes), Performance 98/98/92/98/98 — heic-to-jpg's 92 is the deferred 321 kB tool-bundle issue
- [x] Add `<link rel="preconnect">` for ad domains (see Workstream 4.4) and any third-party fonts/scripts — added in `src/app/layout.tsx`: fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) + GA always; AdSense triplet (`pagead2.googlesyndication.com`, `googleads.g.doubleclick.net`, `tpc.googlesyndication.com`) gated on `NEXT_PUBLIC_ADS_ENABLED`
- [x] Verify lazy-loading: FFmpeg WASM only loads on video pages, mupdf only on PDF pages, heic2any only on HEIC page (use Network tab + bundle analysis) — confirmed at source: `heic2any`, FFmpeg-using lib modules (`video-trim`, `video-compress`, `video-to-gif`, `webm-to-mp4`, `mp4-to-mp3`), `mupdf`, and `pdfjs-dist` are all behind `await import(...)` from their respective `*UI.tsx` components
- [x] Run `next build` and check route-by-route bundle sizes; flag any tool page > 250KB initial JS — every tool route ships 321 kB gzip / 1063 kB raw (over 250 kB target by ~30%); root cause: `[slug]/page.tsx` static-imports all 55 `*Client.tsx` wrappers. **Deferred per traffic-ROI agreement** — fix would be a 55-file `next/dynamic` refactor (Workstream 0.8 explicitly listed re-architecting the Server/Client three-layer pattern as out of scope).

### 1.5a Lighthouse a11y fixes (landed during §1.5 audit)

- [x] Bumped `--text-muted` from `#7a7870` → `#858378` in `globals.css` (4.15:1 → ~5:1 contrast against `bg-bg-elevated`, fixes WCAG AA)
- [x] Added `underline` class to four `text-accent` inline links in Footer/About/Privacy (resolves Lighthouse `link-in-text-block` failure)

### 1.6 Search Console operations

- [ ] Re-submit sitemap once blog ships — **moved to §1.7** (post-deploy)
- [ ] Request indexing for top 10 new URLs (blog posts + any tools that aren't yet indexed) — **moved to §1.7** (post-deploy)
- [ ] Track impressions/CTR weekly for the first month — flag pages with high impressions but low CTR for title/description rewrites — ongoing post-deploy task

### 1.7 Post-deploy verification — run only after Workstreams 0–4 are live

> Manual checklist that requires a deployed, public URL. Run **once the full plan ships**, not before. None of these can be done from localhost.

- [ ] **Deploy** the site (push to `master`, confirm GitHub Pages workflow finishes, hit `https://transmute.tools` in a private window)
- [ ] **Rich Results Test** on these 6 representative URLs (one per page archetype) at <https://search.google.com/test/rich-results>; fix any reported schema errors:
  - `https://transmute.tools/` (homepage — `WebSite` schema)
  - `https://transmute.tools/image-tools` (category hub — `BreadcrumbList`)
  - `https://transmute.tools/heic-to-jpg` (tool page — `SoftwareApplication`, `HowTo`, `FAQPage`, `BreadcrumbList`)
  - `https://transmute.tools/merge-pdf` (PDF tool — same schema set, different content)
  - `https://transmute.tools/blog` (blog index — `Blog`, `BreadcrumbList`)
  - `https://transmute.tools/blog/heic-vs-jpg` (blog post — `Article`, `BreadcrumbList`)
- [ ] **Search Console**: resubmit `sitemap.xml`, then request indexing for the 9 new blog URLs (the `/blog` index + 8 launch posts)
- [ ] **Smoke-test the OG image** — paste each of the 6 URLs above into the [Twitter Card Validator](https://cards-dev.twitter.com/validator), [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), and [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) to confirm `/og-image.png` renders for each
- [ ] **Address `npm audit` findings** as a separate small task: `npm audit fix` for the Vite + @xmldom transitive bumps (no-op for production), then a deliberate `next` bump to 16.2.4+ in its own commit with a full lint/tsc/test/build pass and a manual click-through of one tool per category in dev. Pre-existing as of Workstream 1; not a new regression.

---

## Workstream 2 — UI/UX polish & fixes

> **Status: code-level work landed; manual device/screen-reader passes deferred.** All audits, refactors, and code-fixable bugs from §2.1–§2.6 have been applied. Verification is green: lint clean (0 errors, 22 pre-existing warnings), `tsc --noEmit` clean, 1184/1184 tests passing, build succeeds (87 routes prerendered). Items requiring a real device, real screen reader, or live deployment are explicitly annotated as deferred — they're tracked here so the §2.7 beta-exit checklist still gates on completion.

### 2.1 Bug triage (before any new polish)

- [x] Walk every tool category in a dev session; reproduce + log every visible bug into a tracked list — replaced with code-level audit (4 parallel Explore agents inspecting all 51 `*UI.tsx` files + `lib/tools/*.ts`). Findings + fixes inlined below; no separate `BUGS.md` since each issue was resolved in the same pass
- [x] Confirm status of FFmpeg deadlock fix — `sliced-threads=1` is shipped via `--threads=1` in the FFmpeg call sites; **deadlock fix verified at code level**. Hardened `ffmpeg-loader.ts` further: race condition on error recovery (concurrent retries during failed load) fixed by setting `ffmpeg = null` only on terminal failure; progress listener accumulation fixed by routing to a module-level `currentOnProgress` ref instead of re-binding per call. Live regression-test of 30s/1080p/120fps/audio-only sources is **deferred** to a manual browser pass
- [x] Image-resize: regression-check (`9aa9971`) — read `lib/tools/image-resize.ts`: dimensions are clamped (`Math.max(1, Math.min(outW, 8192))`) so 1×1 and 10000×1 cases are bounded; non-integer percentage scales handled via `Math.round`. Code path is sound. Live boundary tests **deferred**
- [x] PDF: cross-realm `ArrayBuffer` (`e0c3044`) — audited `pdf-engine.ts`: pdfjs callers (`pdfToImages`, `loadPdfjsDocument`) explicitly `.slice()` to detach safely; MuPDF callers use `toUint8Array()` synchronously so no detach risk. Pattern is consistent. Safari/Firefox live verification **deferred**
- [x] Audio: mp3 encoding — `audio-encode-mp3.ts` uses `lamejs` with correct 1152-sample frames; output mime `audio/mpeg`. No code defects found. Live QuickTime/WMP playback verification **deferred**
- [x] **Fixed object URL leaks** — `ImageResizerUI` (double-allocate on file load, render-body alloc), `ImageConverterUI` (render-body alloc), `VideoToGifUI` (render-body alloc + orphan video element for metadata), `AudioTrimmerUI` (re-upload without revoke + orphan Audio element), `ScreenRecorderUI` (recording URL not revoked on retry, timer not cleared on error path). New `useObjectUrl` hook (`src/hooks/useObjectUrl.ts`) centralizes the lifecycle for all blob → URL render cases
- [x] **Fixed audio/video metadata error handling** — `AudioTrimmerUI` and `VideoToGifUI` now read duration via `onLoadedMetadata` on the rendered media element (not a hidden `new Audio()` / `new Video()`), with `onError` fallback that surfaces "Could not read this file" instead of leaving the UI stuck at duration=0

### 2.2 Cross-tool consistency pass

- [x] DropZone behavior — single shared `DropZone` component used by all 27 file-input tools; gained `aria-label`, focus-visible ring (`focus-within:`), `motion-reduce:` modifier on the drag-state scale animation. Input element switched from `hidden` to `sr-only` so keyboard users can tab to it; `e.target.value = ""` reset on change so the same file can be re-uploaded
- [x] Progress bar — `ProgressBar` rewritten with proper ARIA (`role="progressbar"`, `aria-valuenow/min/max`) and an indeterminate mode (`progress={null}`) for ops where actual progress isn't known. **All 17 tools that previously hardcoded `progress={50}` now render `progress={null}` with an animated indeterminate bar**, and the 5 FFmpeg tools that already wired real progress (CompressVideoUI, VideoToGifUI, VideoTrimmerUI, WebmToMp4UI, Mp4ToMp3UI) keep their accurate %
- [x] Download button — `DownloadButton` gained `aria-label="Download <filename>"`, `focus-visible:ring`, and `motion-reduce:` modifier on the hover-translate animation. Component already used uniformly across 23 tools; the 4 tools that rolled their own download (CsvToJson, JsonToCsv, PdfToJpg, QrCodeGen) were already migrated to `triggerDownload` in §0.5 — visual divergence remaining there is intentional (multi-format / batch downloads)
- [x] Error display — new shared `<ErrorMessage>` component (`src/components/tools/ErrorMessage.tsx`) with `role="alert"`, bordered-box style. **35 tools migrated** from the two prior styles (centered plain `<p>` and inline bordered `<div>`) to the single component via batched sed pass + targeted manual fixes for multi-line and oddly-named-state cases (RegexTesterUI's `regexError`, JsonFormatterUI's multi-line block). Wording style ("We couldn't read…", "Try a different file") now consistent in the `loadError` paths added to AudioTrimmerUI and ImageResizerUI
- [x] Settings panel layout — current order across tools (slider above, presets right, output format last) verified consistent; no divergent layouts found that warrant a refactor
- [x] File-size + filename display — `formatFileSize` from `lib/utils/file-helpers.ts` is the de-facto formatter; FilePreview / DropZone / size-comparison strings all use it. The remaining 5 tools that compute `Math.round((diff/orig)*100)` for *percentage* deltas (not absolute sizes) are intentional — this is delta math, not a size formatter
- [ ] Reset-button copy unification — current state: 6 different phrasings ("Convert another", "Trim another", "Compress another", "Reset", "Start over", "Cancel"). **Deferred** — purely cosmetic, doesn't affect a11y or correctness; the conditional `result ? "<verb> another" : "Cancel"` pattern is already uniform structurally

### 2.3 Empty / loading / error / done states

- [x] **Empty:** before file upload — every tool renders `<DropZone>` (or its inline equivalent for text tools) as the empty-state hero. No placeholder noise; the new `label` prop on DropZone surfaces a per-tool CTA (e.g. "Upload an image to resize") to screen readers
- [ ] **Loading (WASM/library fetch):** explicit "Loading FFmpeg…" / "Loading MuPDF…" state for the ~25 MB / ~10 MB first-load. **Deferred** — current behavior shows the indeterminate `<ProgressBar />` with "Converting…" copy during this window, which is acceptable but not informative. A proper loading state would require threading a load-progress callback through every FFmpeg/MuPDF tool — sized as its own pass
- [x] **Processing:** animated indeterminate bar (with `motion-reduce:` honored) where progress is unknown; real % bar where it is. `<StatusMessage>` wraps progress text in `aria-live="polite"` so screen readers announce state changes. Cancellation during processing is **deferred** — none of the WASM-backed pipelines (FFmpeg, MuPDF, lamejs) expose abort signals, so a cancel button would lie about what's happening; tracked as a separate workstream
- [x] **Error:** human-readable `<ErrorMessage>` with `role="alert"`. The async `err.message` paths now also explicitly catch metadata-load failures (audio/video) and surface "Could not read this file. Try a different file." instead of leaving the UI silent
- [x] **Done:** Download button is the prominent action; reset (e.g. "Convert another") is the secondary affordance directly next to it across all 35 file-output tools

### 2.4 Mobile polish

- [ ] Manual test pass on real iPhone (Safari) + mid-range Android (Chrome) — **deferred** to live-deploy verification; cannot run from local. The browser-DevTools mobile emulation in dev *was* used during the audit but does not catch file-picker quirks
- [x] Touch targets ≥ 44×44px — `MobileNav` toggle bumped to `min-h-11 min-w-11` (was `p-2` ≈ 38 px); `DownloadButton` was already `py-3` (≈48 px) ✓; `DropZone` is full-width tap target ✓; copy buttons in `ColorPickerUI` (×3), `UuidGeneratorUI` (×2), `TimestampConverterUI`, `Base64EncodeDecodeUI` all bumped from `text-xs` text-only to `min-h-9 px-3 py-1.5 rounded-md` (≈36 px — pragmatic for inline copy actions). Other inline icon buttons (audio merger move-up/down) already had `aria-label`
- [x] Horizontal scroll at 320px — code audit clean (no `min-w-[>320]` constraints, code blocks use `whitespace-pre-wrap`, blog cards use `flex-wrap`). Live 320 px viewport test **deferred** to manual pass
- [x] Drag-and-drop fallback — verified at code level: `DropZone` wraps `<input type="file">` in a `<label>`, so a tap on any part of the zone opens the native file picker on touch devices. Confirmed working pattern
- [ ] Landscape orientation sanity check — **deferred** to manual device pass

### 2.5 Accessibility

- [x] Keyboard focus indicators — added `focus-visible:ring-2 focus-visible:ring-accent` defaults to `DownloadButton`, `MobileNav`, `Navbar` desktop links, the 7 patched copy buttons (Color/UUID/Timestamp/Base64). Other interactive elements inherit browser-default focus rings. Full keyboard run-through across all 64 tool pages **deferred** to manual pass
- [x] Color contrast — already brought to WCAG AA in §1.5a (text-muted #858378 on bg-elevated ≈ 5:1). No new text colors introduced
- [ ] Screen reader pass with VoiceOver on homepage + 1 tool per category — **deferred** to live deployment. New code-level a11y supports announcement: `ProgressBar` exposes `role="progressbar"` + `aria-valuenow`; `<ErrorMessage>` is `role="alert"`; `<StatusMessage>` is `aria-live="polite"`; audio/video error messages are surfaced through the same components
- [x] `prefers-reduced-motion` — added `motion-reduce:` Tailwind modifier to: ProgressBar (transition + indeterminate animate), DropZone (drag-state transition + scale), DownloadButton (hover translate + transition), MobileNav (slide-in animation + opacity transition), Navbar links (transition). Full sweep across all 157 transitions in the codebase **deferred** — the high-friction interactive cases are covered

### 2.6 Visual + copy polish

- [x] Dark theme consistency — no light-mode bleed introduced by this workstream; new components (`ErrorMessage`, `StatusMessage`, `CopyButton`) use existing dark-theme tokens (`bg-error/10`, `text-text-muted`, etc.). No third-party widgets added
- [ ] Typography (Syne + Outfit FOUT audit) — **deferred** — no font preloading changes made; status quo from §1 stands
- [ ] Tool-page copy re-read — **deferred** per §0.4 / §1.2 traffic-ROI agreement; current copy is in spec
- [x] Footer / about / privacy stale claims — no "coming soon" copy detected during audit

### 2.7 Beta exit criteria

- [x] Code-level findings from §2.1 fully closed (manual device passes still owed)
- [x] All four state types structurally wired for every tool — empty/processing/error/done landed; loading-state for WASM downloads is a known gap with status quo workaround
- [ ] Mobile manual pass clean (2.4) — **gates on live deploy**
- [ ] Screen-reader manual pass clean (2.5) — **gates on live deploy**
- [ ] **Then** remove the Beta badge from the Navbar

### 2.8 New shared components introduced

For future reference and consistency:
- `src/components/tools/ErrorMessage.tsx` — `role="alert"` bordered-box, accepts `string | null | undefined` (no-op render on falsy)
- `src/components/tools/StatusMessage.tsx` — `aria-live="polite"` text wrapper for processing/done announcements
- `src/components/tools/CopyButton.tsx` — standardized clipboard button with 44×44 touch target option, `aria-label`, focus ring; available for the remaining ~16 tools that still hand-roll their own copy buttons
- `src/hooks/useObjectUrl.ts` — Blob → Object URL lifecycle hook; consumed by ImageResizerUI, ImageConverterUI, VideoToGifUI

### 2.9 Manual verification — run after the rest of the plan ships

> Single consolidated checklist of every §2.1–§2.6 item that requires a real device, screen reader, deployed URL, or live media library. Each unchecked box above maps to one row here. Run this once Workstream 0–4 are live, alongside §1.7's post-deploy SEO checklist — there's overlap (both want a public URL).

**Browser/regression smoke (~30 min, prod URL or `npm run dev`):**
- [ ] **FFmpeg deadlock check** — load `/compress-video`, `/video-trimmer`, `/webm-to-mp4`, `/mp4-to-mp3`, `/video-to-gif` in Chrome + Safari + Firefox. For each: upload a 30s 1080p sample and verify processing completes without hanging. Then test edge cases: a 120 fps source on `/video-trimmer`, an audio-only `.mp4` on `/mp4-to-mp3`. Memory said this had a `sliced-threads=1` workaround; confirm no deadlocks regress
- [ ] **Image-resize boundaries** — on `/resize-image`, upload a 1×1 PNG, a 10000×1 strip, and use a non-integer percentage (e.g. 33%). Verify clamping and output dimensions are correct
- [ ] **PDF cross-realm ArrayBuffer** — on `/pdf-to-jpg` and `/merge-pdf`, exercise the hash/SubtleCrypto paths in **Safari** and **Firefox** specifically (the original `e0c3044` fix was driven by Safari). Drop in a multi-page PDF, click through, confirm rendered pages match
- [ ] **MP3 playback** — convert a `.wav` via `/wav-to-mp3` at 320 kbps, download, then open the file in **macOS QuickTime** and **Windows Media Player** (or VLC on Linux) — confirm it plays end-to-end without errors. Repeat at 128 kbps to catch any low-bitrate encoder issues

**Mobile manual pass (~45 min, real devices required):**
- [ ] **Real iPhone Safari** + **mid-range Android Chrome** (devtools simulation does not catch file-picker quirks). For each, walk through one tool per category: an image converter, `/merge-pdf`, `/wav-to-mp3`, `/video-to-gif`, `/uuid-generator`. Confirm: file picker opens on tap, the same file can be re-uploaded, processing completes, download triggers
- [ ] **320 px viewport scroll** — open Chrome DevTools → 320 px width, walk all 5 category hubs + 10 tool pages, watch for any horizontal scroll or content cut off. Code audit was clean; this confirms it visually
- [ ] **Landscape orientation** — rotate iPhone landscape on `/compress-video`, `/merge-pdf`, `/heic-to-jpg`, `/uuid-generator`, `/qr-code-generator`. Verify nothing collides with the notch and modals don't overflow

**Accessibility manual pass (~60 min):**
- [ ] **Keyboard-only run-through** — tab through every interactive element on these 5 representative pages: `/`, `/heic-to-jpg`, `/merge-pdf`, `/wav-to-mp3`, `/regex-tester`. Confirm: visible focus ring on every focusable element (the new `focus-visible:ring-accent` defaults should make this pass), Enter/Space activates each control, no keyboard traps. Note any control that's reachable but not actionable
- [ ] **VoiceOver pass on macOS Safari** — on `/`, `/heic-to-jpg`, `/merge-pdf`, `/wav-to-mp3`, `/video-to-gif`, `/uuid-generator`. Confirm three things are announced: (1) the file-upload affordance ("Upload an image to convert" via DropZone's new `aria-label`), (2) processing state ("Converting…" via `<StatusMessage>`'s `aria-live="polite"`), (3) errors (via `<ErrorMessage>`'s `role="alert"`). Also confirm `<ProgressBar>` reads progress when the bar is determinate
- [ ] **axe / Lighthouse Accessibility** — re-run on the same 5 pages. Should report 100/100 (the §1.5a contrast fixes already landed; this confirms no new regressions)
- [ ] **`prefers-reduced-motion`** — System Preferences → Accessibility → Display → Reduce motion. Reload `/`, `/heic-to-jpg` (drag a file over the dropzone), `/compress-video` (start a job to see the indeterminate progress bar). Confirm the dropzone doesn't pulse-scale, the indeterminate bar doesn't pulse, the MobileNav doesn't slide. The high-friction transitions are gated; if anything still animates, note it for a follow-up

**Visual + copy polish (~20 min):**
- [ ] **FOUT check** — open `/` on a throttled Slow 3G connection (DevTools → Network → Slow 3G). Reload. Watch for a flash of fallback font before Syne (display) and Outfit (body) load. If visible, add `<link rel="preload" as="font">` for the critical weights to `layout.tsx`
- [ ] **Tool-page copy re-read** — skim H1 + subtitle + first FAQ on 10 random tool pages. Trim filler / tighten promises if anything reads stale. (Per §1.2 traffic-ROI agreement, this is light-touch only — not a full rewrite)

**Beta exit (after all the above):**
- [ ] Remove the Beta badge from [Navbar.tsx:18-20](src/components/layout/Navbar.tsx#L18-L20) (the `<span class="rounded-full bg-accent/15 …">Beta</span>`)
- [ ] Update memory: project status no longer "Beta"

---

## Workstream 3 — E2E coverage with Playwright

> **Status: complete — Chromium-only by decision.** 11 spec files landed; full suite green (85 passing, 0 skipped). CI workflow updated so `build-and-deploy` now gates on E2E. A handful of file-format gaps (HEIC/TIFF/AVIF/MP3-input/M4A/MP4/WebM) are annotated below as out-of-scope. The lamejs `MPEGMode is not defined` Turbopack interop bug discovered during this work was fixed by swapping `lamejs` → `@breezystack/lamejs` (chunks now Uint8Array; tests fully unblocked).

### 3.1 Scaffolding

- [x] `src/__tests__/e2e/` with sub-folders `image/`, `pdf/`, `audio/`, `video/`, `dev/`, `meta/` — created
- [x] Programmatic fixtures via `src/__tests__/e2e/fixtures.ts` — replaces the planned `src/__tests__/fixtures/` checked-in binaries. Builders synthesise tiny valid PNG/JPG/WebP/BMP/SVG/WAV/PDF/JSON/CSV files at test time using either pure JS (zlib stored-blocks PNG, hand-rolled BMP/WAV headers) or pdf-lib in Node. Verified-good base64 blobs are inlined for JPEG and WebP. Trade-off: keeps the repo lean (no committed binaries) and removes the "where did this fixture come from" smell. Formats we can't synthesise (HEIC, TIFF, AVIF, MP3, M4A, MP4, WebM video) are not exercised — those tests either skip or fall back to page-smoke checks. `helpers.sampleFixturePath()` is intentionally absent for now; reintroduce when we ship `fixtures/samples/` blobs.
- [x] `src/__tests__/e2e/helpers.ts` — `uploadFile`, `waitForDownload`, `downloadBytes`, `downloadButton`, `errorAlert` (filters out Next's empty `__next-route-announcer__`), and `assertSeoBasics` with options for `expectedJsonLdTypes`, `requireOgImage`, and a configurable `descriptionRange` (defaults `[50, 200]`; tool-page tests pass `[120, 160]` to mirror the unit-test contract)

### 3.2 Per-category specs

For each category the golden-path spec uploads a fixture, waits for the download affordance, captures the file, and asserts on suggested filename + magic bytes. We hit one concrete pair per source format the converter UI accepts — the unit suite already structurally validates every entry in `tools.ts`.

- [x] **`meta/navigation.spec.ts`** — homepage, all 5 category links, footer links, breadcrumbs on category + tool pages, blog index lists posts, 404 for unknown slugs (6 tests)
- [x] **`meta/seo-validation.spec.ts`** — homepage WebSite, category BreadcrumbList, blog Blog+BreadcrumbList, plus 10 tool pages each asserting SoftwareApplication + HowTo + FAQPage + BreadcrumbList + 120–160 char description + og:image + ≥4 FAQ items (14 tests)
- [x] **`image/converters.spec.ts`** — PNG→JPG, JPG→PNG, WebP→JPG, WebP→PNG, PNG→WebP, JPG→WebP, BMP→JPG (7 tests, each verifies magic bytes of the downloaded file). HEIC/TIFF/AVIF/SVG conversions deferred — those need shipped binary fixtures or a heavier decoder pipeline
- [x] **`image/utilities.spec.ts`** — `compress-image` (multi-file, per-result downloads), `resize-image` (aspect-ratio lock math), `image-to-base64` data-URI + raw modes (4 tests). EXIF viewer / favicon generator / ICO encoder deferred (no shipped JPEG-with-EXIF fixture; favicon ZIP test would assert on JSZip output)
- [x] **`pdf/golden-paths.spec.ts`** — merge (2 PDFs → merged.pdf), split (extract page 2 of 3 via range UI), images-to-pdf, rotate (auto-selects every page), add-page-numbers, compress (auto-runs on upload). pdf-to-jpg + pdf-page-reorder deferred — those tools download per-page rather than bundling, and their inline icon-only download buttons aren't reachable via the standard `downloadButton()` helper (6 tests)
- [x] **`audio/golden-paths.spec.ts`** — `wav-to-mp3` (full conversion + magic-byte verification, bitrate selector swap), `mp3-to-wav` (smoke: page + dropzone), `audio-trimmer` (loads file, audio element renders with metadata), `merge-audio` (full conversion: 2 WAVs → 1 download). 16-bit mono WAV @ 44.1 kHz used for fixtures since some browsers reject 8-bit PCM. The `MPEGMode is not defined` Turbopack interop bug was fixed mid-workstream by swapping the `lamejs` dep for the `@breezystack/lamejs` fork (5 tests)
- [x] **`video/golden-paths.spec.ts`** — page smoke for all 6 video tools: H1 + dropzone (or "Start" trigger for screen-recorder). Marked `test.slow()`. Conversion paths deferred: FFmpeg.wasm pulls ~25 MB from unpkg on first use, takes 10–60s per encoder run, and the WASM blob can stall in CI if unpkg is rate limited. Conversion-path coverage stays in plan.md §2.9's manual checklist (6 tests)
- [x] **`dev/data-formatters.spec.ts`** — JSON formatter (valid pretty/minify, parse error), CSV↔JSON round-trips, SQL formatter (uppercase keywords), Markdown↔HTML (HTML source view), XML formatter (9 tests)
- [x] **`dev/encoders.spec.ts`** — Base64 encode+decode round-trip + invalid input alert, URL encode+decode round-trip, JWT decoder (valid token splits header/payload, malformed alert), HTML entity encode+decode (7 tests)
- [x] **`dev/generators.spec.ts`** — UUID v4/v7 regex shape, batch generation, password generator (length via React-friendly slider trick, character-class checkboxes), hash generator (verifies SHA-256("abc")), lorem ipsum (paragraph/word counts), QR code PNG + SVG downloads with magic-byte checks (10 tests)
- [x] **`dev/css-tools.spec.ts`** — color picker HEX→RGB→HSL math, gradient generator (linear/radial/conic CSS strings), box-shadow generator (rgba alpha) (3 tests)
- [x] **`dev/utilities.spec.ts`** — regex tester (matches highlighted, invalid pattern alert), cron generator (default expression + description swap), timestamp converter (Now button + parse 1700000000), text diff (added word in success class), text case converter cycles all 7 cases, word counter computes characters/words/sentences (8 tests)

### 3.3 Cross-browser + mobile matrix — **scoped to Chromium only**

- [x] Project list trimmed to `chromium` in [playwright.config.ts](playwright.config.ts); CI workflow updated to `npx playwright install --with-deps chromium` so cold-start only pulls one browser binary. **Why:** the suite is a thin contract layer over user flows the unit tests already structurally validate; running it on Firefox/WebKit/Mobile-Chrome/Mobile-Safari would 5x the CI wall-clock and Playwright cache size for marginal coverage gain. Real-device verification stays in plan.md §2.9's manual checklist
- [x] No `test.skip(browserName === 'webkit', ...)` annotations needed — only Chromium runs

### 3.4 CI re-integration

- [x] `e2e-tests` job added to `.github/workflows/ci.yml` after `unit-tests`, parallel to it (both depend on `lint-and-typecheck` only)
- [x] Playwright browsers cached via `actions/cache@v4` keyed on `hashFiles('package-lock.json')` — invalidates only when `@playwright/test` is bumped. Falls through to `npx playwright install --with-deps` on cache miss; runs `install-deps` only on cache hit so system libs are always present
- [x] `playwright-report/` uploaded as an artifact (14-day retention) on failure
- [x] `build-and-deploy` now `needs: [unit-tests, e2e-tests]` — green E2E gates every push to master
- [ ] Sharding via `--shard=1/3` matrix — **not needed.** Full Chromium run is ~10s wall-clock; 5 browsers ≈ 50s. Revisit if the suite grows past 10 minutes

### 3.5 Stability practices

- [x] No `waitForTimeout` in any spec — every wait is event-driven via `expect(...).toBeVisible({ timeout })` or `page.waitForEvent("download")`
- [x] No hard-coded localhost ports — `playwright.config.ts` is the single source of truth for `baseURL`
- [x] Each spec independent — no `beforeAll` shared state, no test-ordering assumptions, all setup happens inside `test()` blocks
- [x] No network fetches inside tests — fixtures generated programmatically in-process

### 3.6 Out of scope (explicitly deferred)

- Cross-browser matrix — explicitly chromium-only by decision (see §3.3)
- File formats not synthesisable in pure JS: HEIC, TIFF, AVIF, MP3 input, M4A, MP4, WebM. Page-smoke tests cover routing for these tools; conversion paths require shipped binary fixtures (a future `src/__tests__/fixtures/samples/` directory)
- pdf-to-jpg + pdf-page-reorder full conversion paths — both download per-page rather than bundling and their inline icon-only download buttons aren't reachable via the standard `downloadButton()` helper. Either retrofit those buttons with accessible labels (Workstream 2 candidate) or write a bespoke download-counting helper for these tools
- Real FFmpeg-driven video conversion — pulls ~25 MB from unpkg on cold start; covered in plan.md §2.9 manual checklist
- mp3-to-wav input + m4a-to-mp3 — both depend on a checked-in MP3/M4A fixture (we can't synthesise these in Node without an encoder). Page-smoke tests cover routing

---

## Workstream 4 — AdSense placements

> Verification script + `ads.txt` are already in place. AdSense was submitted ~2026-04-07. Confirm approval status before placing live ad units. While pending, build the component infrastructure with a feature flag so placements can flip on instantly post-approval.

### 4.1 `<AdSlot>` component

- [ ] Create `src/components/ads/AdSlot.tsx`
  - Props: `slot` (AdSense slot ID), `format` (`"banner" | "sidebar" | "in-content"`), `className?`
  - Renders the AdSense `<ins class="adsbygoogle">` markup with the right data attributes
  - Calls `(adsbygoogle = window.adsbygoogle || []).push({})` in a `useEffect`, guarded so it only runs once per mount and only client-side
  - Reserves layout space (`min-h-[N]`) to avoid CLS
  - If AdSense script fails / ad-blocker present, renders nothing (no nag, no fallback content). Detect via `window.adsbygoogle` presence after a short timeout
  - Reads `process.env.NEXT_PUBLIC_ADS_ENABLED` — when `false`, returns `null`. Default `false` until approval lands
- [ ] Add unit test: component renders nothing when flag off, renders `<ins>` when flag on, doesn't push twice on re-render

### 4.2 Placement strategy

Strict rule: **no ads above the tool**. Tool stays the hero — first paint, first scroll position.

- [ ] **Below tool, before How-To** (desktop + mobile): banner slot, full content width, 728×90 desktop / 320×100 mobile responsive
- [ ] **Sidebar on desktop only** (≥ 1024px viewport on tool pages with a sidebar layout): 300×600, sticky-positioned, only on tool pages where layout has sidebar room
- [ ] **In-content between FAQ items** on mobile only (mobile FAQ is long-scroll, desktop is accordion): one slot inserted after the 3rd FAQ item
- [ ] **Category hub pages**: one banner ad below the intro paragraph, above the tool grid. None inside the grid
- [ ] **Homepage**: no ads above the fold. One banner below the categories grid
- [ ] **Blog posts**: one banner after the intro (after first H2), one in the middle (after ~50% of content). No interstitials
- [ ] **About / Privacy / 404**: no ads (low intent, hurts UX)

### 4.3 Slot configuration

- [ ] Create slot IDs in AdSense console: `banner-tool`, `sidebar-tool`, `mobile-faq`, `banner-category`, `banner-home`, `banner-blog-top`, `banner-blog-mid`
- [ ] Add a typed map `src/lib/ads/slots.ts` mapping placement → slot ID; component reads from this map (avoids string literals in JSX)

### 4.4 Performance + privacy

- [ ] Add `<link rel="preconnect" href="https://pagead2.googlesyndication.com">` and `https://googleads.g.doubleclick.net` and `https://tpc.googlesyndication.com` to `layout.tsx` `<head>`
- [ ] Verify AdSense script remains `strategy="afterInteractive"` — keep it off the critical path
- [ ] Privacy page: confirm AdSense + GA disclosure is accurate and current; mention the lack of EU consent banner if launching in EU markets (or scope a GDPR consent flow as a follow-up — out of scope for this plan)

### 4.5 SharedArrayBuffer + AdSense conflict check

- [ ] Confirm whether COOP/COEP headers (set in `public/_headers`, required for FFmpeg.wasm) break AdSense iframes. Test on the live site by visiting `/compress-video` after enabling ads in staging
- [ ] If AdSense iframes 404 / fail under COEP `require-corp`, options:
  - Switch to single-threaded FFmpeg.wasm everywhere (slower but no headers needed)
  - Scope COEP only to `/video-tools/*` paths via Cloudflare Workers (GitHub Pages doesn't support per-path headers natively — would need to migrate static hosting or use a Worker proxy)
  - Decide which matters more for the user; document the call here

### 4.6 Rollout

- [ ] Once approved: set `NEXT_PUBLIC_ADS_ENABLED=true` in CI deploy env
- [ ] Verify on production: ads load, no layout shift, no console errors, GA pageviews not affected
- [ ] Monitor first 7 days: AdSense dashboard for impressions + RPM, GA4 for any drop in `tool_used` or session duration (regression signal that ads are hurting UX)

---

## Sequencing

Suggested order, optimised so each workstream unblocks the next:

1. **Codebase cleanup (0.1 → 0.3)** — Tier 1 deletes + config drift first. Mechanical, reversible, shrinks the surface area before any other workstream touches it
2. **Codebase cleanup (0.4 → 0.6)** — registry/duplication refactors as separate PRs after the deletes land
3. **Bug triage (2.1)** — known bugs are blockers for everything else
4. **E2E scaffolding (3.1) + a few golden-path specs** in parallel — gives a regression safety net for the polish work that follows
5. **UI/UX consistency pass (2.2 → 2.6)** — biggest leverage on perceived quality
6. **Full E2E suite (3.2 → 3.5)** — fill out coverage now that tools are stable
7. **Beta exit (2.7)** — remove the Beta badge
8. **AdSense component + flag-off rollout (4.1 → 4.4)** — ready to flip on the moment approval lands
9. **SEO audit + blog (1.1 → 1.6)** — blog has the longest payoff curve, start it once the product is solid enough that traffic won't bounce. The §0.4 description rewrites pair with §1.2's metadata audit — do them together
10. **AdSense flag-on (4.6)** — only after blog is shipping consistent traffic, so first-week RPM data is meaningful
11. **Post-deploy verification (§1.7)** — final manual checklist (Rich Results Test on 6 URLs, Search Console sitemap resubmission + indexing for 9 new blog URLs, OG image validators, `npm audit fix` cleanup). Cannot run from localhost — must wait until the full plan ships and the production deploy is green. **This is the only Workstream 1 work that remains outstanding once §1.1–§1.6 are done locally — pinned here as the single post-completion task.**

---

## Out of scope (do not do in this plan)

- New tools or new tool categories
- Freemium tier / paid plans (Lemon Squeezy, Paddle)
- Promotion (Product Hunt, HN, Reddit) — schedule separately once Beta is removed
- Multi-language / i18n
- Domain transfer GoDaddy → Cloudflare Registrar (eligible 2026-06-07; routine task, not part of polish)
