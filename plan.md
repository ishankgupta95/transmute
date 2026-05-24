# Transmute — Optimization & Polish Plan

> All 64 tools across 5 categories are built and live at **https://transmute.tools**.
> This plan covers what's left: SEO content, UI/UX polish, E2E coverage with Playwright, AdSense placements.
> **No new tool features** — only optimization, fixes, and product quality.
> **Exception (added 2026-05-07):** one priority feature — **Markdown → PDF** (Workstream P below). User-requested, MD Peek-quality styling.

---

## Snapshot — current state

- **Stack:** Next.js 16.2.2 (App Router, `output: "export"`), React 19, TypeScript strict, Tailwind v4, GitHub Pages
- **Domain:** `transmute.tools` live; CI deploys `out/` to `gh-pages` on `master` push (lint + tsc + Vitest + E2E gate the deploy)
- **Tools shipped:** 64 across image / pdf / audio / video / developer
- **Technical SEO:** sitemap, robots.txt, JSON-LD (HowTo, FAQPage, SoftwareApplication, BreadcrumbList, Article, Blog, WebSite), canonical URLs, OG/Twitter, semantic HTML
- **Blog:** 8 launch posts (1500–2100 words each) cross-linked to tool pages
- **Analytics:** GA4 (`G-TCWDH01ZSK`) firing `tool_used`, `file_processed`, `file_downloaded`
- **AdSense:** verification script + `ads.txt` in place (publisher `ca-pub-8318354633894162`); `NEXT_PUBLIC_ADS_ENABLED` env gate already wired in `layout.tsx`. No ad slots placed yet
- **E2E:** 11 Playwright spec files, 85 tests green (Chromium-only by decision); gates `build-and-deploy` in CI
- **Beta badge** still in navbar — removed only after §2.9 manual passes complete

---

## Completed workstreams (summary)

### Workstream 0 — Codebase cleanup ✅
Tier 1 deletes (~250 LOC, 5 files), dead deps, config drift, registry boilerplate, duplication refactors, layout cleanups all landed. New shared utils: `canvas-utils.ts`, `CategoryHubPage.tsx`. Lint + tsc + 651 tests + build green. Landed in commit `3119aeb`.

### Workstream 1 — SEO (§1.1–§1.5) ✅
- §1.1 Blog scaffolded (`src/data/posts.ts` + `src/content/blog/*.mdx`); 8 posts shipped with Article JSON-LD, OG, breadcrumbs; cross-linked from tool pages via `getPostsLinkingToTool()`
- §1.2 Metadata: 120–160 char descriptions enforced as CI test; one H1 per page verified across 73 pages; ≥4 FAQs per tool enforced; `relatedTools[]` resolution test in place; OG image (1200×630) generated and referenced
- §1.3 Sitemap covers all 64 tools + 5 categories + about/privacy + blog index + 8 posts (verified at build: 87 routes)
- §1.4 Internal linking enforced both directions as CI tests; "Popular tools" rail on homepage; alt-text/aria-hidden audit complete
- §1.5 Lighthouse: SEO 100, A11y 100, Perf ≥92 across 5 representative routes; preconnects added; lazy-loading verified (heic2any, FFmpeg, MuPDF, pdfjs all behind `await import()`)
- §1.5a Contrast bumped to WCAG AA (`--text-muted` `#7a7870` → `#858378`); inline `text-accent` links underlined

**Deferred (intentional, traffic-ROI):**
- §1.2 aboutText 200-word floor — currently 115–191 words; CI test exists as `describe.skip`
- §1.4 Related Tools to 4–6 entries — currently 3–4
- §1.5 Tool-page bundle 321 kB > 250 kB target — fix is a 55-file `next/dynamic` refactor (out of scope per §0.8)

### Workstream 2 — UI/UX polish (code-level) ✅
- §2.1 Bug audit via 4 parallel Explore agents across all 51 `*UI.tsx` + `lib/tools/*.ts`. Fixed: object URL leaks (ImageResizer, ImageConverter, VideoToGif, AudioTrimmer, ScreenRecorder), audio/video metadata error handling, `ffmpeg-loader.ts` race condition + progress listener accumulation
- §2.2 Cross-tool consistency: shared `DropZone`, `ProgressBar` (with proper ARIA + indeterminate mode — 17 tools migrated off hardcoded `progress={50}`), `DownloadButton`, `ErrorMessage` (35 tools migrated)
- §2.3 Empty/processing/error/done states wired across all tools
- §2.4 Touch targets ≥44×44 px (MobileNav, copy buttons in 4 tools); horizontal-scroll code audit clean
- §2.5 Keyboard focus indicators (`focus-visible:ring-accent`); `motion-reduce:` modifiers on high-friction transitions
- §2.6 Dark theme consistency verified; new components use existing tokens

**New shared components introduced:**
- `src/components/tools/ErrorMessage.tsx` — `role="alert"` bordered-box
- `src/components/tools/StatusMessage.tsx` — `aria-live="polite"` wrapper
- `src/components/tools/CopyButton.tsx` — standardized clipboard button (44×44 option)
- `src/hooks/useObjectUrl.ts` — Blob → Object URL lifecycle hook

**Deferred (need real device / screen reader / live deploy):** mobile manual pass, landscape orientation, VoiceOver pass, FOUT check, tool-page copy re-read, reset-button copy unification (cosmetic). All consolidated in §2.9 below.

### Workstream 3 — E2E coverage ✅
11 spec files, 85 tests green, Chromium-only by decision. `playwright-report/` uploaded as artifact on failure (14-day retention). `build-and-deploy` now `needs: [unit-tests, e2e-tests]`. `lamejs` swapped for `@breezystack/lamejs` to fix Turbopack interop bug. Out-of-scope formats (HEIC/TIFF/AVIF/MP3-input/M4A/MP4/WebM video) covered by page-smoke tests; conversion-path coverage stays in §2.9 manual checklist.

---

## Outstanding work

The remaining work is four buckets, in this order:

1. **Workstream P — Markdown → PDF tool** (priority feature, added 2026-05-07; build before AdSense)
2. **Workstream 4 — AdSense placements** (not started; can land flag-off pre-deploy)
3. **§2.9 Manual verification + beta exit** (gates on live deploy)
4. **§1.7 Post-deploy SEO verification** (gates on live deploy)

---

## Workstream P — Markdown → PDF tool (priority addition)

> Added 2026-05-07 as a priority feature, overriding the original "no new tools" scope rule. Inspired by **MD Peek (iOS)**: serif body, generous line-height, subtle rounded code blocks, hairline tables, soft blockquote bar, no harsh shadows.
>
> **Approach: print-dialog ("Export to PDF" → browser Save as PDF).** Vector output, selectable text, small files (~50–500 KB), native pagination, MD Peek-grade typography. UX is two-click but matches what Typora / Obsidian / VS Code do under the hood.
>
> **Category: PDF Tools.** Cross-link from `markdown-to-html` and `html-to-markdown` for two-way discoverability between developer-tools and pdf-tools.

### P.1 Dependencies + tool registry

- [x] Add `shiki` (^1.x) for syntax highlighting — slim build with ~15 popular languages and 2 themes (light/dark). Dynamic-imported to keep tool-route bundle small.
- [x] Add `dompurify` (^3.x) + `@types/dompurify` to sanitize rendered HTML before injecting into the print iframe.
- [x] No other new deps — `marked` (^17) already present; `pdf-lib` is **not** needed for this approach (print path generates the PDF natively in the browser).
- [x] Verify `@tailwindcss/typography` (already in devDeps) is wired — used as the live-preview prose baseline before custom MD Peek-inspired layer.
- [x] Add `"markdown-to-pdf"` to the `ToolType` union in `src/data/tools.ts:1-54`
- [x] Register the tool in `src/data/tools.ts`:
  - `slug: "markdown-to-pdf"`, `category: "pdf-tools"`, `toolType: "markdown-to-pdf"`
  - `acceptFormats: ".md,.markdown,.txt,text/markdown"`
  - `relatedTools: ["markdown-to-html", "html-to-markdown", "merge-pdf", "compress-pdf"]`
  - 120–160 char `description`, ≥4 FAQs, ≥150-word `aboutText` (per §1.2 CI tests)
- [x] Cross-link both directions:
  - Add `"markdown-to-pdf"` to `relatedTools` of `markdown-to-html`, `html-to-markdown`
  - Add `"markdown-to-pdf"` to `relatedTools` of `merge-pdf`, `images-to-pdf`, `compress-pdf`

### P.2 Markdown rendering pipeline

- [x] Create `src/lib/tools/markdown-to-pdf.ts` (pure logic, no React) exporting:
  - `renderMarkdown(md: string, opts: { theme: "github-light" | "github-dark"; font: "serif" | "sans" }): Promise<string>`
  - Pipeline: marked (GFM on) → custom renderer that swaps `<code class="language-X">` blocks with Shiki output → DOMPurify sanitize
- [x] Configure `marked` with GFM enabled (tables, task lists, strikethrough, autolinks, footnotes)
- [x] Lazy-load Shiki via dynamic import — only initialize the highlighter on first render
- [x] Bundled Shiki language set: `js, ts, tsx, jsx, py, go, rust, java, c, cpp, json, yaml, toml, bash, sh, sql, html, css, md, diff` (covers ~90% of GitHub surface; unknown languages fall back to plain `<pre><code>`)
- [x] Sanitize the rendered HTML with DOMPurify before injecting into the print iframe (prevents `<script>` in user MD from executing)
- [x] Render task list items as Unicode glyphs (`☐` / `☑`) instead of `<input type="checkbox">` — checkboxes don't print consistently across browsers

### P.3 PDF generation (print-dialog)

- [x] Create `src/components/tools/markdown-pdf/PrintFrame.tsx` — hidden iframe (`absolute -left-[9999px] w-0 h-0`) that:
  - Receives a fully self-contained HTML doc string (inline `<style>` + computed prose HTML + Shiki CSS for active theme)
  - On mount, writes via `iframe.contentDocument.open()/write()/close()`
  - Awaits `iframe.contentDocument.fonts.ready` before triggering print
  - Calls `iframe.contentWindow.print()`, listens for `afterprint`, then unmounts
- [x] Create `src/lib/tools/markdown-pdf-print-css.ts` — single string export, parameterized by theme + font:
  - `@page { size: A4; margin: 18mm 16mm; }` (offer Letter as a toggle later)
  - `@page :first { margin-top: 28mm; }` for first-page breathing room
  - `h1, h2, h3 { break-after: avoid; }` to prevent orphaned headings
  - `pre, table, blockquote { break-inside: avoid; }` where reasonable
  - `img { max-width: 100%; break-inside: avoid; }`
- [x] Embed referenced fonts as `@font-face` data URIs inside the iframe's `<style>` (the iframe is `about:blank` and can't reach parent CSS reliably across browsers) — *deferred to Google Fonts `@import` per the budget guardrail in plan §FONTS; documented inline in `markdown-pdf-print-css.ts`*
- [x] **Firefox caveat:** `Background graphics` is off by default. Surface a UI banner: "If colors look missing, enable 'Print backgrounds' in your browser's print dialog."

### P.4 MD Peek-inspired styling

> MD Peek's defining traits: serif body + sans heads, generous line-height (~1.7), subtle rounded code blocks, soft blockquote bar, hairline tables, no harsh shadows.

- [x] Body: serif (Newsreader or Charter system fallback) at 11pt, line-height 1.65, color `#1f1d1a` on `#fdfdfb`
- [x] Headings: sans (Syne — already loaded for display) with rhythm:
  - h1: 22pt, 24pt margin-top
  - h2: 17pt, 20pt margin-top, hairline `1px solid #e8e6e0` bottom border
  - h3: 14pt, 16pt margin-top
- [x] Inline code: 0.92em, JetBrains Mono, `#f3efe7` background, `2px 6px` padding, `4px` radius, no border
- [x] Code blocks: Shiki-highlighted, `#f7f5ef` background, `12px` radius, `16px 18px` padding, line-height 1.5, long lines wrap (no horizontal scroll in print)
- [x] Blockquotes: `4px solid #c9b88a` left bar, 0.96em italic, `#5a5852` color, no background
- [x] Tables: `border-collapse`, hairline `1px solid #e8e6e0` borders, `8px 12px` cell padding, header row `#f7f5ef` tint, no row striping
- [x] Horizontal rules: `1px solid #e8e6e0`, 24pt vertical margin
- [x] Images: centered, max-width 100%, alt text rendered as 9pt italic caption beneath
- [x] Links: `#9a7b1f` (warm gold matching the brand accent), underlined; URLs printed inline after the link text only when `@media print` (so the PDF is useful offline)
- [x] **Theme toggle:** "Light" (default) and "Dark" (`#1a1814` background, `#f0eee8` text, dark Shiki theme)
- [x] **Font toggle:** "Serif" (default) and "Sans" (Outfit body, matching modern docs sites)

### P.5 UI component

Three-layer pattern per CLAUDE.md:

- [x] `src/app/[slug]/page.tsx` already routes via the registry — no change needed (added the case branch for `markdown-to-pdf` toolType)
- [x] Create `src/components/tools/MarkdownToPdfClient.tsx` (thin `"use client"` wrapper)
- [x] Create `src/components/tools/MarkdownToPdfUI.tsx`:
  - **Two input modes** (tabs): "Upload .md" (uses shared `DropZone`) and "Paste markdown" (full-height monospace textarea)
  - Both modes feed the same `markdown` state
  - **Live preview** beside input on desktop (≥1024px), below on mobile — debounced 200ms, rendered HTML in a `prose` container
  - **Toolbar**: theme toggle (Light/Dark), font toggle (Serif/Sans), page size toggle (A4/Letter, *deferred to v1.1 per plan §P.8*)
  - **"Export to PDF" button** — disabled until `markdown.trim().length > 0`. On click: render full HTML doc → mount `PrintFrame` → `print()` → unmount on `afterprint`
  - Info banner under the button about Firefox `Print backgrounds` toggle and "Save as PDF" destination tip
- [x] Reuse shared components: `DropZone`, `ErrorMessage`, `StatusMessage` (CopyButton wasn't needed for v1 — preview text is implicitly selectable)
- [x] File input: 10 MB cap on `.md` / `.markdown` / `.txt`. Reject other types via `<ErrorMessage>`.
- [x] Empty state: example MD snippet (a heading, a paragraph, a code fence, a table) pre-populated as placeholder, cleared on first interaction

### P.6 Testing

- [x] **Unit** (`src/__tests__/unit/lib/markdown-to-pdf.test.ts`):
  - `renderMarkdown` strips `<script>`, `onerror=` etc.
  - GFM features render: tables, task lists (as glyphs), strikethrough, autolinks
  - Shiki highlights `js`, `ts`, `py` code fences; unknown language falls back to plain `<pre><code>` without throwing
  - Theme switch swaps Shiki theme classes
- [x] **Component** (`src/__tests__/unit/components/MarkdownToPdfUI.test.tsx`):
  - Tab switch preserves markdown state across upload/paste modes
  - Export button disabled when empty, enabled when non-empty
  - Theme + font toggles re-render preview
- [x] **E2E** (`src/__tests__/e2e/pdf/markdown-to-pdf.spec.ts`):
  - Page smoke (h1, ≥4 FAQs, related tools render, no console errors)
  - Paste mode: type `# Hello`, preview updates, click Export → assert `window.print` was invoked (parent-side `HTMLIFrameElement.prototype.contentWindow` patch — `addInitScript` does not propagate into `document.write`-built iframes reliably)
  - Upload mode: drop a small `.md` file → preview matches expected HTML
  - **Cannot** assert final PDF contents end-to-end (print dialog isn't scriptable). Coverage stops at the `print()` call.

### P.7 SEO + content

- [x] Tool page metadata (per §1.2 CI tests):
  - 120–160 char `description` (141 chars — verified in CI)
  - One H1 (`Convert Markdown to PDF — Free, Online, In-Browser`)
  - 5 bespoke FAQs (+ shared `PRIVACY_FAQ` = 6 rendered): "What languages are syntax-highlighted?" / "Why does the print dialog open instead of an instant download?" / "Does it support GitHub-Flavored Markdown?" / "Can I customize the styling?" / "Why are colors missing from my exported PDF in Firefox?"
  - `aboutText` ≥150 words (213 words — verified locally): privacy story, MD Peek-style typography, syntax highlighting, GFM support, print-to-PDF rationale
- [x] Sitemap auto-includes via existing `generateStaticParams` (verified in `out/sitemap.xml`)
- [x] Internal linking enforced by §1.4 CI tests — both directions covered by P.1 cross-links + added to `browser-based-developer-tools` blog post for the ≥1-companion-post invariant
- [ ] Blog post candidate: "Why I built a Markdown → PDF tool that actually looks good" — defer until post-launch traffic data

### P.8 Deferred / explicit non-goals for v1

- Custom CSS upload (v1 ships 2 themes × 2 fonts = 4 looks; advanced users can request later)
- Math rendering (KaTeX / MathJax) — adds ~250 KB; defer unless requested
- Mermaid diagram rendering — same reasoning
- Page numbers, running headers/footers, table of contents — possible via `@page` margin boxes; defer to v1.1
- One-click raster download (html2canvas + jsPDF) — explicitly chose against in P.0 decision; revisit only if users complain about the two-click print flow

---

## Workstream 4 — AdSense placements

> Verification script + `ads.txt` already in place. AdSense submitted ~2026-04-07; confirm approval status before flipping the flag. Build the component infrastructure now with the existing `NEXT_PUBLIC_ADS_ENABLED` env gate so placements activate the moment approval lands.

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

- [ ] AdSense preconnects already added in `layout.tsx` during §1.5 (gated on `NEXT_PUBLIC_ADS_ENABLED`) — verify on deploy
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

## §2.9 Manual verification + beta exit

> Single consolidated checklist of every UI/UX item that requires a real device, screen reader, or deployed URL. Run alongside §1.7 — there's overlap (both want a public URL).

**Browser/regression smoke (~30 min, prod URL or `npm run dev`):**
- [ ] **FFmpeg deadlock check** — load `/compress-video`, `/video-trimmer`, `/webm-to-mp4`, `/mp4-to-mp3`, `/video-to-gif` in Chrome + Safari + Firefox. For each: upload a 30s 1080p sample and verify processing completes without hanging. Then test edge cases: a 120 fps source on `/video-trimmer`, an audio-only `.mp4` on `/mp4-to-mp3`. Confirm the `sliced-threads=1` workaround holds
- [ ] **Image-resize boundaries** — on `/resize-image`, upload a 1×1 PNG, a 10000×1 strip, and use a non-integer percentage (e.g. 33%). Verify clamping and output dimensions
- [ ] **PDF cross-realm ArrayBuffer** — on `/pdf-to-jpg` and `/merge-pdf`, exercise the hash/SubtleCrypto paths in **Safari** and **Firefox** specifically (the original `e0c3044` fix was driven by Safari). Drop in a multi-page PDF, confirm rendered pages match
- [ ] **MP3 playback** — convert a `.wav` via `/wav-to-mp3` at 320 kbps, download, then open the file in **macOS QuickTime** and **Windows Media Player** (or VLC on Linux) — confirm it plays end-to-end without errors. Repeat at 128 kbps to catch any low-bitrate encoder issues

**Mobile manual pass (~45 min, real devices required):**
- [ ] **Real iPhone Safari** + **mid-range Android Chrome** (devtools simulation does not catch file-picker quirks). For each, walk through one tool per category: an image converter, `/merge-pdf`, `/wav-to-mp3`, `/video-to-gif`, `/uuid-generator`. Confirm: file picker opens on tap, the same file can be re-uploaded, processing completes, download triggers
- [ ] **320 px viewport scroll** — open Chrome DevTools → 320 px width, walk all 5 category hubs + 10 tool pages, watch for any horizontal scroll or content cut off
- [ ] **Landscape orientation** — rotate iPhone landscape on `/compress-video`, `/merge-pdf`, `/heic-to-jpg`, `/uuid-generator`, `/qr-code-generator`. Verify nothing collides with the notch and modals don't overflow

**Accessibility manual pass (~60 min):**
- [ ] **Keyboard-only run-through** — tab through every interactive element on `/`, `/heic-to-jpg`, `/merge-pdf`, `/wav-to-mp3`, `/regex-tester`. Confirm: visible focus ring on every focusable element, Enter/Space activates each control, no keyboard traps
- [ ] **VoiceOver pass on macOS Safari** — on `/`, `/heic-to-jpg`, `/merge-pdf`, `/wav-to-mp3`, `/video-to-gif`, `/uuid-generator`. Confirm three things are announced: (1) the file-upload affordance via DropZone's `aria-label`, (2) processing state via `<StatusMessage>`'s `aria-live="polite"`, (3) errors via `<ErrorMessage>`'s `role="alert"`. Confirm `<ProgressBar>` reads progress when determinate
- [ ] **axe / Lighthouse Accessibility** — re-run on the same 5 pages. Should report 100/100
- [ ] **`prefers-reduced-motion`** — System Preferences → Accessibility → Display → Reduce motion. Reload `/`, `/heic-to-jpg` (drag a file over the dropzone), `/compress-video` (start a job to see the indeterminate progress bar). Confirm dropzone doesn't pulse-scale, indeterminate bar doesn't pulse, MobileNav doesn't slide

**Visual + copy polish (~20 min):**
- [ ] **FOUT check** — open `/` on a throttled Slow 3G connection. Watch for a flash of fallback font before Syne (display) and Outfit (body) load. If visible, add `<link rel="preload" as="font">` for the critical weights to `layout.tsx`
- [ ] **Tool-page copy re-read** — skim H1 + subtitle + first FAQ on 10 random tool pages. Trim filler / tighten promises if anything reads stale (light-touch only per §1.2 traffic-ROI agreement)
- [ ] **Reset-button copy unification** — 6 different phrasings exist ("Convert another", "Trim another", etc.); cosmetic, low priority

**Beta exit (after all the above):**
- [ ] Remove the Beta badge from `Navbar.tsx:18-20` (the `<span class="rounded-full bg-accent/15 …">Beta</span>`)
- [ ] Update memory: project status no longer "Beta"

---

## §1.7 Post-deploy SEO verification

> Manual checklist that requires a deployed, public URL. Run **once Workstream 4 + §2.9 are done**, not before. None of these can be done from localhost.

- [ ] **Deploy** the site (push to `master`, confirm GitHub Pages workflow finishes, hit `https://transmute.tools` in a private window)
- [ ] **Rich Results Test** on these 6 representative URLs at <https://search.google.com/test/rich-results>; fix any reported schema errors:
  - `https://transmute.tools/` (homepage — `WebSite` schema)
  - `https://transmute.tools/image-tools` (category hub — `BreadcrumbList`)
  - `https://transmute.tools/heic-to-jpg` (tool page — `SoftwareApplication`, `HowTo`, `FAQPage`, `BreadcrumbList`)
  - `https://transmute.tools/merge-pdf` (PDF tool — same schema set, different content)
  - `https://transmute.tools/blog` (blog index — `Blog`, `BreadcrumbList`)
  - `https://transmute.tools/blog/heic-vs-jpg` (blog post — `Article`, `BreadcrumbList`)
- [ ] **Search Console**: resubmit `sitemap.xml`, then request indexing for the 9 new blog URLs (the `/blog` index + 8 launch posts)
- [ ] **OG image smoke-test** — paste each of the 6 URLs above into the [Twitter Card Validator](https://cards-dev.twitter.com/validator), [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/), and [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) to confirm `/og-image.png` renders for each
- [ ] **`npm audit`** — `npm audit fix` for the Vite + @xmldom transitive bumps (no-op for production), then a deliberate `next` bump to 16.2.4+ in its own commit with a full lint/tsc/test/build pass and a manual click-through of one tool per category in dev
- [ ] **Search Console ongoing** — track impressions/CTR weekly for the first month; flag pages with high impressions but low CTR for title/description rewrites

---

## Sequencing

1. **Workstream P — Markdown → PDF tool** (priority feature; ship registry + pipeline + UI + tests before deploy)
2. **AdSense component, flag-off** (§4.1 → §4.5) — build dormant
3. **Deploy** (push to `master`)
4. **§2.9 manual verification** on the live URL (~2.5 hrs total across browser smoke + mobile + a11y + visual). Add a markdown-to-pdf check: print one real document in Chrome + Safari + Firefox, save as PDF, confirm fonts embed and code blocks render correctly.
5. **§1.7 post-deploy SEO verification** on the same live URL — overlap with §2.9 where possible
6. **Beta badge removal** once §2.9 manual passes are clean
7. **AdSense flag-on** (§4.6) once approval lands and blog has ~2–4 weeks of organic traffic so first-week RPM is meaningful

---

## Out of scope (do not do in this plan)

- New tools or new tool categories — **except** Markdown → PDF (Workstream P, explicitly added as a priority 2026-05-07)
- Freemium tier / paid plans (Lemon Squeezy, Paddle)
- Promotion (Product Hunt, HN, Reddit) — schedule separately once Beta is removed
- Multi-language / i18n
- Domain transfer GoDaddy → Cloudflare Registrar (eligible 2026-06-07; routine task, not part of polish)
- Re-architecting Server/Client three-layer pattern (works, just verbose)
- aboutText 200-word floor rewrites + tool-route bundle refactor (deferred per traffic-ROI agreement)
