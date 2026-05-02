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

1. **Bug triage (2.1)** — known bugs are blockers for everything else
2. **E2E scaffolding (3.1) + a few golden-path specs** in parallel — gives a regression safety net for the polish work that follows
3. **UI/UX consistency pass (2.2 → 2.6)** — biggest leverage on perceived quality
4. **Full E2E suite (3.2 → 3.5)** — fill out coverage now that tools are stable
5. **Beta exit (2.7)** — remove the Beta badge
6. **AdSense component + flag-off rollout (4.1 → 4.4)** — ready to flip on the moment approval lands
7. **SEO audit + blog (1.1 → 1.6)** — blog has the longest payoff curve, start it once the product is solid enough that traffic won't bounce
8. **AdSense flag-on (4.6)** — only after blog is shipping consistent traffic, so first-week RPM data is meaningful

---

## Out of scope (do not do in this plan)

- New tools or new tool categories
- Freemium tier / paid plans (Lemon Squeezy, Paddle)
- Promotion (Product Hunt, HN, Reddit) — schedule separately once Beta is removed
- Multi-language / i18n
- Domain transfer GoDaddy → Cloudflare Registrar (eligible 2026-06-07; routine task, not part of polish)
