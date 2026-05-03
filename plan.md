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

### 1.1 Blog (biggest remaining traffic lever)

- [ ] Scaffold `src/app/blog/page.tsx` (listing) and `src/app/blog/[slug]/page.tsx` (post)
- [ ] Use MDX or a typed `src/data/posts.ts` registry (mirror `tools.ts` pattern); keep static-export friendly
- [ ] Each post: H1, 1500–2500 words, internal links to 3–5 relevant tool pages, `Article` JSON-LD, OG image, breadcrumbs
- [ ] Add `/blog` to sitemap and the homepage / footer nav
- [ ] Ship 8 launch posts targeting commercial-intent long-tail queries:
  - "HEIC vs JPG: Which Format Should You Use?" → `/heic-to-jpg`
  - "How to Compress Images Without Losing Quality" → `/compress-image` + variants
  - "Complete Guide to Modern Image Formats (WebP, AVIF, JPEG XL)" → all converters
  - "How to Merge PDFs in Your Browser (No Upload)" → `/merge-pdf`
  - "Reduce PDF File Size for Email — 3 Practical Methods" → `/compress-pdf`
  - "Convert Video to GIF — Frame Rate, Size, Quality Tradeoffs" → `/video-to-gif`
  - "10 Free Browser-Based Developer Tools You Didn't Know Existed" → dev category
  - "Why Browser-Based Tools Are More Private Than Online Converters" → privacy/positioning
- [ ] Add a `/blog` link to footer + Navbar; cross-link from each tool's "About this tool" section to its companion post

### 1.2 Metadata audit

- [ ] Script: walk every entry in `src/data/tools.ts`, assert `description.length` ≤ 160 and ≥ 120 chars; flag violations
- [ ] Confirm exactly one `<h1>` per page (tools, hubs, blog, about, privacy)
- [ ] Confirm `aboutText` is 200–400 words for every tool (memory says 150–200 — bring up to 200+ on the short ones)
- [ ] Verify every tool has ≥ 4 unique FAQ items
- [ ] Verify `relatedTools[]` slugs all resolve (unit test in `data/tool-metadata.test.ts` if not already)
- [ ] Verify Open Graph image exists at `/og-image.png` and is referenced (1200×630). If missing, generate one and add to root metadata

### 1.3 Schema + crawl validation

- [ ] Run Google Rich Results Test on 5 representative URLs (homepage, category hub, image converter, PDF tool, dev tool); fix any reported errors
- [ ] Crawl with Screaming Frog (free up to 500 URLs — fits) or `wget --spider`; resolve any 404s, redirect chains, missing titles, duplicate descriptions
- [ ] Verify `sitemap.xml` lists all 64 tools + 5 categories + about/privacy + every blog post

### 1.4 Internal linking + content polish

- [ ] Each tool's "Related Tools" section: 4–6 entries, audited for relevance (not just same category)
- [ ] Every blog post links to ≥ 3 tools; every tool's About section links to ≥ 1 blog post (once they exist)
- [ ] Add a "Popular tools" rail to the homepage based on GA4 top-N (manual curation initially)
- [ ] Image alt text audit on category icons, tool icons, blog post images

### 1.5 Performance for SEO

- [ ] Lighthouse audit: every category hub + 10 random tool pages. Target Performance ≥ 95, SEO = 100, Accessibility ≥ 95
- [ ] Add `<link rel="preconnect">` for ad domains (see Workstream 4.4) and any third-party fonts/scripts
- [ ] Verify lazy-loading: FFmpeg WASM only loads on video pages, mupdf only on PDF pages, heic2any only on HEIC page (use Network tab + bundle analysis)
- [ ] Run `next build` and check route-by-route bundle sizes; flag any tool page > 250KB initial JS

### 1.6 Search Console operations

- [ ] Re-submit sitemap once blog ships
- [ ] Request indexing for top 10 new URLs (blog posts + any tools that aren't yet indexed)
- [ ] Track impressions/CTR weekly for the first month — flag pages with high impressions but low CTR for title/description rewrites

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

### 2.1 Bug triage (before any new polish)

- [ ] Walk every tool category in a dev session; reproduce + log every visible bug into a tracked list (one issue per bug, in `BUGS.md` or GitHub Issues)
- [ ] Confirm status of FFmpeg deadlock fix (memory: `sliced-threads=1` workaround applied but not confirmed) — test compress-video, video-trimmer, webm-to-mp4 with 30s, 1080p, 120fps, and audio-only sources
- [ ] Image-resize: regression-check the recent fix (`9aa9971`) — boundary cases (1×1, 10000×1, non-integer scale)
- [ ] PDF: cross-realm `ArrayBuffer` (recent fix `e0c3044`) — verify hash/SubtleCrypto paths still work in Safari + Firefox
- [ ] Audio: verify mp3 encoding produces playable files in macOS QuickTime + Windows Media Player
- [ ] After triage, fix every P0/P1 bug before moving on. Keep a one-line entry per fix; do not refactor surrounding code

### 2.2 Cross-tool consistency pass

- [ ] DropZone behavior: same hover state, same error-state visual, same drag-rejected animation, same touch fallback in every tool
- [ ] Progress bar: same component, same color, same units (`%` vs `frames` vs `MB`) for similar tools
- [ ] Download button: same size, same accent, always positioned consistently in the tool flow
- [ ] Error toasts: same component, same dismiss behavior, same wording style ("We couldn't read this file" vs technical errors)
- [ ] Settings panels: same layout (slider above, presets to right, output format last) across all tools that have settings
- [ ] File-size + filename display: same formatter (already exists in `lib/utils/file-helpers.ts` — ensure every tool uses it)

### 2.3 Empty / loading / error / done states

For every tool, verify all four states are designed and wired:
- [ ] **Empty:** before file upload — clear primary CTA, no placeholder noise
- [ ] **Loading:** WASM/library fetch ("Loading FFmpeg…", show progress where possible)
- [ ] **Processing:** animated progress, indication of remaining time when known, can be cancelled
- [ ] **Error:** human-readable message, "Try a different file" affordance, never raw stack traces
- [ ] **Done:** download button is the prominent next step; "Convert another" reset is one click away

### 2.4 Mobile polish

- [ ] Manual test pass on real iPhone (Safari) and a mid-range Android (Chrome). Dev-tools simulation is insufficient for file-picker behavior
- [ ] Verify all touch targets ≥ 44×44px
- [ ] Verify no horizontal scroll at 320px viewport (test all category hubs + 10 tool pages)
- [ ] Verify drag-and-drop fallback to tap-to-upload on touch
- [ ] Landscape orientation sanity check on 5 tool pages

### 2.5 Accessibility

- [ ] Keyboard-only run-through: tab through every interactive element on 5 representative tool pages; ensure visible focus on every focusable element
- [ ] Color contrast: re-run axe / Lighthouse Accessibility — fix any WCAG AA failures
- [ ] Screen reader pass with VoiceOver on the homepage + 1 tool from each category: file upload, processing status, and download must be announced
- [ ] `prefers-reduced-motion`: confirm decorative animations (card reveals, drop-zone pulse) honor it

### 2.6 Visual + copy polish

- [ ] Dark theme consistency: scan for any light-mode bleed (white flashes on transitions, mismatched modal backgrounds, third-party widget bleed)
- [ ] Typography: verify Syne (display) + Outfit (body) load correctly; no FOUT on slow connections (preload critical font weights if needed)
- [ ] Tool-page copy: re-read every H1 + subtitle + first FAQ; trim filler, tighten promises
- [ ] Footer / about / privacy pages: skim for stale claims now that the product is live (e.g. anything saying "coming soon")

### 2.7 Beta exit criteria

- [ ] Bug list from 2.1 fully closed
- [ ] All four state types wired for every tool (2.3)
- [ ] Mobile pass clean (2.4)
- [ ] Accessibility audit clean (2.5)
- [ ] **Then** remove the Beta badge from the Navbar

---

## Workstream 3 — E2E coverage with Playwright

> Playwright is already installed and configured (`playwright.config.ts` exists, baseURL = `http://localhost:3000`, 5 browser projects). The CI e2e job was removed because no specs existed. Re-enable it once specs land.

### 3.1 Scaffolding

- [ ] Create `src/__tests__/e2e/` directory with sub-folders: `image/`, `pdf/`, `audio/`, `video/`, `dev/`, `meta/` (navigation + SEO)
- [ ] Create `src/__tests__/fixtures/` with tiny valid samples for every input format the tools accept:
  - images: `sample.jpg`, `sample.png`, `sample.webp`, `sample.heic`, `sample.svg`, `sample.avif`, `sample.bmp`, `sample.tiff` — each ≤ 50KB
  - pdfs: `single-page.pdf`, `multi-page-5.pdf`, `corrupt.pdf`
  - audio: `sample.mp3`, `sample.wav`, `sample.m4a` — each ≤ 100KB, ≤ 3s
  - video: `sample.mp4`, `sample.webm` — each ≤ 500KB, ≤ 2s
  - text: `sample.json`, `sample.csv`, `sample.xml`, `sample.md`
- [ ] Add a `tests-helpers.ts` with reusable functions: `uploadFile(page, selector, fixturePath)`, `waitForDownload(page, action)`, `assertSeoBasics(page)` (checks H1 count, meta description length, canonical, JSON-LD presence)

### 3.2 Per-category specs

For each category, the goldenpath spec uploads a fixture, waits for processing, asserts the download triggers, and verifies output filename/extension. Cover at least one tool per format conversion pair.

- [ ] **`meta/navigation.spec.ts`** — homepage loads, all 5 category links work, footer links work, breadcrumbs render correctly on category + tool pages, 404 page renders for unknown slugs
- [ ] **`meta/seo-validation.spec.ts`** — for a sample of 10 tool pages: exactly one H1, meta description present and 120–160 chars, canonical URL matches, JSON-LD blocks parse and contain expected `@type` values, OG tags present
- [ ] **`image/converters.spec.ts`** — golden path for HEIC→JPG, WebP→PNG, PNG→JPG, SVG→PNG, AVIF→JPG, TIFF→JPG, BMP→JPG. One spec per pair. Each: upload → wait for done state → click download → verify suggested filename has correct extension
- [ ] **`image/utilities.spec.ts`** — compress (verify output smaller than input), resize (verify dimensions in done state), crop, exif viewer, image-to-base64 (verify clipboard write or visible output), favicon generator (verify ZIP downloaded)
- [ ] **`pdf/golden-paths.spec.ts`** — merge (3 PDFs in, 1 PDF out, page count = sum), split (page-range UI, download N parts), pdf-to-jpg (multi-page PDF → ZIP with N images), images-to-pdf (5 images → 5-page PDF), rotate, add-page-numbers, reorder
- [ ] **`audio/golden-paths.spec.ts`** — mp3-to-wav, wav-to-mp3 (verify bitrate selector), m4a-to-mp3, audio-trimmer (drag handles, verify trimmed duration), merge-audio
- [ ] **`video/golden-paths.spec.ts`** — video-to-gif, video-trimmer, mp4-to-mp3, webm-to-mp4, compress-video, screen-recorder (mock `getDisplayMedia` permission). Mark slow tests with `test.slow()` so Playwright triples the timeout
- [ ] **`dev/data-formatters.spec.ts`** — JSON formatter (valid + invalid input), JSON↔CSV, SQL formatter, markdown↔HTML, XML formatter
- [ ] **`dev/encoders.spec.ts`** — base64 round-trip, URL round-trip, JWT decoder (valid + expired token), HTML entity round-trip
- [ ] **`dev/generators.spec.ts`** — UUID (verify v4 regex), password generator (toggle options, verify result matches criteria), hash generator (SHA-256 of known input), QR code (verify canvas/SVG rendered), lorem ipsum
- [ ] **`dev/css-tools.spec.ts`** — color picker (HEX/RGB/HSL conversion), gradient generator (copy CSS button works), box-shadow generator
- [ ] **`dev/utilities.spec.ts`** — regex tester (matches highlighted), cron generator (human-readable output), timestamp converter, text diff, text case converter (all 7 cases), word counter

### 3.3 Cross-browser + mobile matrix

- [ ] Run full suite on Chromium, Firefox, WebKit, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 13)
- [ ] Tag tools that legitimately don't work on a given browser (e.g., screen-recorder on iOS Safari) with `test.skip(browserName === 'webkit', '...')` rather than letting them fail silently

### 3.4 CI re-integration

- [ ] Add an `e2e-tests` job back to `.github/workflows/ci.yml` after `unit-tests`
- [ ] Cache Playwright browsers between CI runs (`actions/cache` keyed on `package-lock.json`)
- [ ] Upload `playwright-report/` as an artifact on failure
- [ ] Make `build-and-deploy` depend on `e2e-tests` — gate deploys on green E2E
- [ ] Sharding: if total run > 10 min, split across 3 shards via `--shard=1/3` matrix

### 3.5 Stability practices

- [ ] No `waitForTimeout` — use `waitFor` selectors and event-driven waits
- [ ] No hard-coded localhost ports outside `playwright.config.ts`
- [ ] Each spec independent — no shared state between tests, no test ordering assumptions
- [ ] Fixtures committed to repo; no network fetches inside tests

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

---

## Out of scope (do not do in this plan)

- New tools or new tool categories
- Freemium tier / paid plans (Lemon Squeezy, Paddle)
- Promotion (Product Hunt, HN, Reddit) — schedule separately once Beta is removed
- Multi-language / i18n
- Domain transfer GoDaddy → Cloudflare Registrar (eligible 2026-06-07; routine task, not part of polish)
