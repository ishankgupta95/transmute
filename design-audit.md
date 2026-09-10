# Design-fidelity audit — Transmute vs the six claude.ai/design docs

> Phase 1 of `plan.md`. Started 2026-08-09. Source: design project
> `e91a7226-762b-407b-9c69-f9f2bc407707` (docs: Logo · Home Redesign · All Tools ·
> Site Pages · Tool Redesign · theme via `_ds/nocturne-*`; "Current UI" is the
> pre-redesign reference, not audited against).
>
> Fidelity bar (owner decision): **structural + honest** — match the docs' layout and
> controls; keep documented usability/honesty deviations; every capability claim shows
> real detected values.
>
> Statuses: ✅ fixed this pass · ✓ match (verified) · ⚠ OPEN diff to fix ·
> ◇ deviation-kept (with reason) · ◆ deferred to a named phase.

## Cross-cutting

| Row | Status | Notes |
| --- | --- | --- |
| Tool count 67 everywhere, derived from registry | ✓ | Registry has **67** slugs; home/404/workspace all derive via `tools.length`. The *old plan's* "68" was wrong. The doc's own numbers disagree with themselves (hero badge 67, workshop cards sum 66, dev count 24 vs actual 25) — registry wins. |
| `SIMD ✓ · THREADS 8 · WEBGPU ✓` hardcoded (workspace status bar) | ✅ | Now `CapabilityReadout`: real wasm-SIMD probe, `navigator.hardwareConcurrency`, `"gpu" in navigator`; renders after mount so the export can't bake build-machine values. Phase 3 (2026-08-10) added a `POOL n` segment — the worker pool's actual size (`clamp(hc−1, 1, 4)`), not a decorative number. |
| Artboard frame ≠ UI; the doc's in-frame nav is the site navbar | ✓ | Recorded 2026-08-07; shells render full-bleed under the real navbar. Don't reintroduce. |
| Doc privacy copy (AdSense, unpkg CDN) | ◇ | The *doc* is stale: AdSense was removed 2026-08-08 and the FFmpeg core is self-hosted. The app's copy is the honest one — never "fix" it back toward the doc. |

## Tool Redesign doc → real tool pages (`ToolPageLayout` + `ToolAside` + UIs)

| Element (doc) | Status | Notes |
| --- | --- | --- |
| Status bar `{engine} READY` | ✓ | |
| Status bar `TOOL n OF total` | ✅ | Added; index from registry order. |
| Status bar capability segment | ✅ | `CapabilityReadout`, hidden below `sm` (phone bar is minimal per Phone screen). |
| Status bar `{total} TOOLS INSTALLED` | ✅ | Added, right-aligned with `0 BYTES SENT`. |
| Old `NO SIZE CAP · MAX SIZE — YOUR RAM` on every page | ✅ | Removed from the bar (was false for FFmpeg tools). Truth moved to per-tool surfaces below. |
| Doc-page spec tile `MAX SIZE` | ✅ | Was hardcoded `NONE` on all 67; now `Tool.maxSizeMB`. **Restated 2026-09-04** — the original note here named `validateVideoFileSize` and a `100 MB` cap, and neither exists any more (`grep -rn validateVideoFileSize src/` → zero hits). The enforcer is `validateFFmpegInput(file, shape)` (`lib/tools/ffmpeg-loader.ts:105`), and `ffmpegInputLimitBytes` (`:92`) returns a cap for `"stream-copy"` only and `null` for `"audio-extract"` — so `mp4-to-mp3` is uncapped **on purpose** (a mounted input, a much smaller output; verified in that file's header at 2500 MiB). `maxSizeMB: 1536` is set on the nine stream-copy tools — `video-trimmer`, `video-to-mp4`, `mov-to-mp4`, `mp4-to-mov`, `mkv-to-mp4`, `mp4-to-mkv`, `avi-to-mp4`, `mute-video`, `rotate-video` — derived from a measured MEMFS failure at ~1795 MiB ÷ the 1.125 growth factor. Read the registry, not this row, for the live set. |
| Empty state: "Drop a file to begin" / "Nothing uploads…" / **Choose file** / `{accept} · BATCH OK · NO SIZE CAP` | ✅ | DropZone reworked to the doc's copy; `BATCH OK` renders only when `multiple`, cap line reads `MAX {cap}` where enforced (`sizeCapMB` prop). Per-tool `label` overrides remain. **2026-09-04:** the rendered cap is `MAX 1.5 GB`, not `MAX 100 MB` — `formatCap` (`DropZone.tsx:98`) switches to GB at 1024, and the four UIs that pass the prop (`VideoTrimmerUI`, `VideoRemuxUI`, `MuteVideoUI`, `RotateVideoUI`) pass 1536. Those four also pass the `sizeCapReason` that was dead code when this row was written. |
| `⌘O` opens the picker (doc how-to copy) | ✅ | Global binding in DropZone; last-mounted zone wins; preventDefault stops the browser's Open dialog. |
| `⌘↵ TO RUN` under the primary | ✅ | Bound for real in `ToolActions` (meta/ctrl+Enter → primary when enabled); hint shows at `lg`, the sheet keeps `RUNS ON THIS DEVICE` (⌘↵ means nothing on touch). |
| Pipeline `+ step` chip | ◇ | Implies an editable pipeline that doesn't exist on real tool pages — omitted there. `/workspace` keeps it as part of the explorer. Revisit only if a pipeline feature ever ships. |
| Top-bar search "Jump to any of 67 tools… ⌘K" | ◇ | The site navbar (always present above the shell) owns search/⌘K; a second in-shell search would duplicate it. Artboard-frame rule. |
| Top-bar `?` help affordance | ◇ | The docs live below the fold on the same page; a `?` popover would duplicate them. |
| `RECENT OUTPUT` rail section + "saved to Recent" | ✅ | Phase 4 (2026-08-10): real localStorage-backed list (`lib/utils/recent-outputs.ts`, recorded by `triggerDownload` — metadata only, device-local). `RecentOutputs` renders the section in both rails (tool pages link to the tool; workspace picks in place), hidden until the first save. No fake copy anywhere. |
| `START FROM` presets with notes (doc specifies for compress-image, batch-convert, merge-pdf, split-pdf, video-gif, audio-trim, screen-rec, favicon, json) | ✅/◇ | `ToolPresets` primitive (2026-08-09): chips + active note; **any hand edit flips the active chip back to Custom** so what's lit is what runs. Landed on the four tools whose controls can express the doc's presets: **compress-image** (Email→target 2 MB, Web 72, Print 92, Archive 98, Custom — verified live incl. the flip-to-Custom), **image-converter** (Web 72 / Keep 94; lossy targets only), **video-to-gif** (Chat 480/10 · README 640/15 · Smallest 320/8), **audio-trimmer** (Podcast MP3 128 · Music MP3 320 · Lossless WAV). Preset notes only claim what they set. ◇ The other five flagged, not faked: merge-pdf / split-pdf / favicon presets require unbuilt features (merge+compress, bookmarks, one-file-per-page, modern-only set — Phase 5 product decisions); screen-recorder's only control is the mic toggle; json-formatter's doc presets duplicate its existing Format/Minify choice ("Sort keys" doesn't exist). |
| `ADVANCED n ›` collapsible with real key-values | ✅ | `ToolAdvanced` primitive (2026-08-09) on the same four tools, every row checked against the lib: compressor (EXIF+GPS stripped · sRGB · ≤10 binary-search passes · alpha→WebP), converter (stripped · sRGB · white-fill-on-JPG vs preserved), video-to-gif (256-colour per-frame RGB444 palette · no dither · infinite loop — read from gifenc usage), audio-trimmer (sample-accurate · WAV channels preserved · MP3 surround folded to stereo −3 dB — the shared encoders from the 2026-08-08 fixes). The doc's invented values (e.g. "Chroma subsampling 4:2:0", "Concurrency 4 workers") were **not** copied. |
| Compare canvas `SPLIT / SIDE BY SIDE / DIFF` modes | ✅ | Added inside `CompareStage` (2026-08-09) — all three image UIs (compressor, converter, resizer) inherit them. DIFF is a real pixel-difference render, amplified ×4 with the caption saying so. Verified in-browser. |
| Compressor stat `SSIM` | ✅ | Real SSIM (2026-08-09): `lib/tools/image-metrics.ts` — Rec. 601 luma, 8×8 windows at a ≤256px raster; 6 unit tests incl. the flat-field closed form. Shown only for single-file compare; decode failure hides the stat. Verified live: Q80 JPEG of a busy synthetic scored 0.989. |
| Queue header `n FILES · n THREADS` on the real batch table | ✅ | Phase 3 (2026-08-10): compressor + converter queue footnotes read `n OF m DONE · k THREADS` where k = `min(poolSize(), files.length)` — the worker pool's real size, and rows only say RUNNING once their worker reports progress. Batch is genuinely parallel now (converter's first-file-only bug died with it). |
| Doc how-to copy mentions ⌘O/Recent | ✓/◆ | `tool-metadata.ts` howToSteps make no ⌘O/Recent claims today — keep it that way until Recent ships. |

## Home Redesign doc → `/`

| Element | Status | Notes |
| --- | --- | --- |
| Hero badge, h1 "Change the file. Not the file's owner.", typed search, LiveEngine card | ✓ | Verified in earlier sessions; re-verify in sweep. |
| Five workshops with per-category counts | ✓ | Counts derive from registry (`tools.filter(...).length`). |
| Conversion matrix + legend | ✓ | |
| Stat band 0 / 67 / ∞ / — | ✓ | 67 derives from `tools.length`. |
| "Reached for most" (10) | ✓ | E2E asserts ≥4 links. |
| Engines table honesty | ✅ | Doc's seed data shipped verbatim: credited FFmpeg with **GIF encoding** (it's gifenc), said **25 MB** (served core is 32.2 MB → "31 MB"), and WebCodecs/Web Audio rows undersold WebM→MP4 and lamejs. All corrected; `LOADED` for FFmpeg now "ON FIRST USE" (compress-video never loads it). |
| Closing CTA + footer groups + "© 2026 TRANSMUTE · BUILT BY ISHANK" bottom line | ✓ | Verified 2026-08-09: © line, `NO COOKIES BEYOND ANALYTICS`, `NO FILE EVER TRANSMITTED` all present. |

## All Tools doc → `/workspace`

| Element | Status | Notes |
| --- | --- | --- |
| Shell: rail + filters + pipeline + sidebar + status bar | ✓ | Spot-checked at 1440 (2026-08-09). |
| Status bar capability claims | ✅ | Real values via `CapabilityReadout`. |
| BatchPane `4 THREADS` / `WORKER POOL 4/8` | ✅ | Phase 4 (2026-08-10): BatchPane (and every seeded pane) is deleted — batch tools now mount their REAL queue table in the workspace, with the pool's real thread count (`n OF m DONE · k THREADS`, Phase 3). |
| Canvases process real files | ✅ | Phase 4 (2026-08-10): the workspace mounts the real `*UI.tsx` components through the shared `ToolClient` switch — same components as the tool pages, never a fork. One real conversion per archetype pinned by `conversion/workspace.spec.ts` (Chromium + WebKit). |

## Site Pages doc → hubs, blog, about, privacy, 404

| Element | Status | Notes |
| --- | --- | --- |
| Category hub: sticky rail `ON THIS PAGE`, `I HAVE A…` chips, stat tiles, two-section split | ✓ | `I HAVE A…` present in `CategoryHubPage`; verify chips + `DOWNLOAD 0 KB` tile in sweep. |
| Blog index: stat tiles POSTS/READING/UPDATED, numbered two-column list | ✓ | Verified 2026-08-09: `POSTS 8 · READING 81 MIN · UPDATED MAY 3, 2026`, derived from real posts. |
| Blog post: contents rail, read-progress, TRY IT HERE panel, ALSO MENTIONED | ✓ | `ArticleRail` owns contents+progress. Doc puts `62% READ` in the top bar — rail placement is a fine structural match; confirm in sweep. |
| About: capabilities grid + "Built by Ishank" link | ✓ | Verified 2026-08-09: tagged capability grid + ishank.dev link present. |
| Privacy: green shield card "Your files never leave your device." + numbered sections | ✓ | App copy is *more honest* than the doc (see cross-cutting row). |
| 404: "Nothing converts to this." + search + five hub links | ✓ | E2E asserts branded copy; count derives. |
| Hub row copy: doc's one-clause editorial line | ✅ | 2026-08-30: `Tool.hubLine` (optional) added and seeded verbatim from the doc's `utilities`/`converters` arrays for all 22 image tools; the hub renders `hubLine ?? description`, so the other four hubs still show the (clamped) SEO blurb until the owner commissions lines for them. One doc string corrected for honesty: the favicon generator ships **eight** assets (6 PNGs + .ico + manifest), not the doc's "Seven". |
| Hub row names: doc's short forms | ✅ | 2026-08-30: the hub now renders `getWorkspaceTool(slug)?.name ?? tool.name`, which already carried the doc's `Resize Image` / `Crop Image` / `EXIF Viewer`. Registry names are untouched — 11 tools get a shorter hub label, matching the workspace rail. |
| Blog index: post order, tags, index blurbs | ✅ | 2026-08-30: sort is `date, then longest read` (every post shares 2026-05-03, so the date sort alone was a no-op and numbering fell back to registry order) — reproduces the doc's exact 01–08. `BlogPost.indexBlurb` seeded from the doc; `BlogPost.tag` overrides the derived label on the two `IMAGE FORMATS` posts and the `PRIVACY` one, and `postTag()` no longer falls back to `relatedTools[0]` before the privacy keyword check. Dates are the doc's `3 MAY 2026` (UTC-pinned) and the tile is the coarser `MAY 2026`. |
| Blog post: `ALSO MENTIONED` is four rows | ✅ | 2026-08-30: trimmed at the render site (`relatedTools` stays long — it is also the internal-link audit list). Was 9 rows on HEIC (duplicating the TRY IT HERE tool) and 25 on the dev-tools post. |
| Blog post: `TRY IT HERE` on every post | ✅ | 2026-08-30: the three posts without a `primaryTool` got one — `modern-image-formats…` → `jpg-to-webp`, `browser-based-developer-tools` → `json-formatter`, `why-browser-based-tools-are-private` → `compress-pdf`. Owner call on which tool each headlines. |
| Blog post: doc's bordered/rounded comparison table | ⚠ | The `prose-table-*`/`prose-th-*`/`prose-td-*` treatment is in place, but **`remark-gfm` is not installed**, so the GFM tables in `heic-vs-jpg`, `modern-image-formats…` and `video-to-gif-tradeoffs` render as raw `\| --- \| --- \|` paragraph text today. Styling is inert until the plugin lands. The doc's mono/accent value columns cannot come from Markdown at all — that needs an MDX component, flagged not faked. |
| Focus rings on rails, prose links, about/privacy links | ✅ | 2026-08-30: DS readme's 2px accent `:focus-visible` added to `HubRail`, `ArticleRail`, `prose-a` and the two ishank.dev links. Measured live at 2px / 2px offset / #9184d9 (they transition in over 200ms — read the settled value, not the first frame). |
| `I HAVE A…` chips are selectable in the doc | ◇ | Format filtering is not a shipped feature; the chips stay static labels rather than faking a filter. |
| Doc's hub route typography (`HEIC→JPG`) | ◇ | The app keeps ` → ` spacing — it is load-bearing (`blog/[slug]` splits the route on `" → "` for the TRY IT HERE pair). |

## Logo doc → mark, icons, OG

| Element | Status | Notes |
| --- | --- | --- |
| Seam mark in navbar/footer, icon set, maskable, OG card | ✓ | `generate-brand-assets.mjs` emits the full set from the doc's mark. |
| "Below 16 px use the solid arc alone" | ✓ | Smallest emitted raster is 16px, where the doc says the full mark still survives; nothing ships below 16. |
| BETA badge lockup (`APP BAR · 26 PX`) | ✓ | Navbar matches; badge removal is a separate post-verification decision (plan.md). |

## Sweep log (1440 / 768 / 375)

- 2026-08-09: `/workspace`, `/compress-image`, `/video-trimmer` at 1440 — shell matches; the
  fixed status bar (`TOOL 63 OF 67 │ SIMD ✓ · THREADS 14 · WEBGPU ✓ … 67 TOOLS INSTALLED`),
  the doc empty state with `MAX 100 MB` (trimmer) vs `BATCH OK · NO SIZE CAP` (compressor)
  verified in-browser. Blog index tiles, About grid, Footer © line verified. Gates after the
  fix batch: tsc ✓ · lint 0 err/3 warn · unit 1620 ✓ · e2e 213/213 ✓ · conversion 27/27 ✓ ·
  build 92 routes ✓.
- Prior full sweep (all 67 routes at 1280/768/375, interaction assertions) ran 2026-08-08 and
  the 213-test suite re-covers page smoke today.
- 2026-08-09 (second batch): compare modes + real SSIM verified live on `/compress-image` —
  tabs render, DIFF canvas shows amplified JPEG error (56% non-black pixels on a busy synthetic),
  SIDE BY SIDE draws both frames, SSIM 0.989 at Q80. Unit 1626 ✓.
- Remaining Phase 1 work = the ⚠ OPEN rows above: START FROM presets for the doc's nine tools,
  honest ADVANCED sections.
- 2026-08-10 (Phase 3): batch queue verified live on `/compress-image` (6 files → mixed
  RUNNING/DONE states mid-flight, footnote `6 OF 6 DONE · 4 THREADS · RUNS ON THIS DEVICE` on a
  14-core machine — pool caps at 4) and `/png-to-jpg` (3 files → queue table, per-file OUT sizes,
  Download all ZIP). `resize-image` single-file compare unchanged through the worker path
  (1080×1080 out, 49.4 KB). (Workers were later moved to pre-bundled `public/workers/*.js` —
  Turbopack's PROD build ships raw `.ts` for worker URLs; see plan.md Phase 4 deviation.)
- **2026-08-19 — the systematic sweep, automated.** All 85 routes at 1440 / 768 / 375:
  **zero horizontal overflow, zero console errors** at every width. Now a standing spec
  (`e2e/meta/responsive-sweep.spec.ts`), not a one-off eyeball pass, with a negative control
  proving the detector goes red. Accessible-name / alt / heading-order probe across every page
  archetype: clean. Theme tokens re-verified against the Nocturne design system via DesignSync —
  `bg #161826`, `surface #232532`, `text #e9e9ed`, `accent #9184d9`, radius 8, Inter heading+body
  all match `theme.json` exactly. **One new deviation to record:** `theme.json` specifies
  `iconSet: "phosphor"`; the app ships `lucide-react` throughout. Kept — the six screen docs were
  drawn with the app's own icons and swapping icon libraries app-wide buys nothing but churn.
- 2026-08-10 (Phase 4): `/workspace` verified live — `?tool=png-to-jpg` deep link selects in
  rail, real PNG→JPG conversion + Download inside the shell, rail pick to JSON Formatter updates
  URL + remounts (stale state gone, `TOOL 43 OF 67` status), RECENT OUTPUT appears in the rail
  after a real download (`recent-test.jpg — 1.1 KB · JUST NOW`). Route load pulls no tool libs;
  picking Crop Image fetched only its own chunks (bundle-check ✓).
- **2026-08-29 — the canvas geometry pass.** The owner's report ("the preview window is too small;
  it does not follow the design religiously") was reproduced and measured before anything was
  changed: with real media loaded, every media stage sat at **788×288 at 1440×900, 1920×1080 AND
  2560×1400** while the canvas band grew 742 → 922 → 1242. The `lg:min-h-[calc(100vh-58px)]` the
  shell reserves was decorative — `lg:justify-center` centred an intrinsically-sized surface,
  `items-start` shrink-wrapped both rows, and all 52 tool UIs opened their canvas with `space-y-*`
  (a block), so no child could ever consume the leftover height. Worse, crossing into `lg` made the
  preview *smaller*: the canvas/controls split fired at 1024, the same width the 230px sibling rail
  appears, taking the video from 702×288 at 768 to **372×279 at 1024** and PDF tiles from 99×133 to
  **33×44**. Fixed as a system, not per tool — `TOOL_SURFACE` / `CANVAS_COLUMN` / `STAGE_GROW` /
  `STAGE_MEDIA` in `components/workspace/shared.ts`, the split moved to `xl`, `overflow-hidden`
  dropped from the band (it had also been silently disabling the control rail's `sticky`). Re-measured
  at 1024 / 1440 / 1920 / 2560: video **816×685 @1920, 816×980 @2560**, json-formatter's pane
  **192 → 963px**, PDF tiles **99×133** (103×137 at 1024), crop frame **818×500 → 816×778**, and
  zero horizontal overflow at every width. Full detail and the 117-finding sweep it came with are in
  `plan.md` Phase 7.
- **2026-08-30 — Site Pages re-run against `spec-site.md`.** Worked the extractor's 34 rows end to
  end. Landed: S-01 (hub intro copy), S-03/S-22/S-23/S-29/S-31 (focus rings), S-06/S-12 (220ms hover
  slide), S-07 (short hub names), S-08 (22 `hubLine`s), S-11/S-13 (`3 MAY 2026`, `MAY 2026`),
  S-14/S-15/S-16/S-17 (blurbs, order, tags), S-18/S-27/S-30 (page padding), S-19 (h2 `mt-30px`, no
  h2 tracking), S-20 (blockquote type), S-21 (table treatment — inert, see the ⚠ row above),
  S-24 (`animate-tm-seam`, the 2.4s keyframe the theme already defined), S-25 (three `primaryTool`s),
  S-26 (four `ALSO MENTIONED` rows), S-33 (404 field 48px/10px/15px/11px/14px/flat — measured
  exactly), S-34 (`Image tools`, sentence case). Already applied by the previous implementer and
  left alone: S-02, S-04, S-32, and the hub-row/blog-row focus rings. Structural sweep of
  `/image-tools`, `/pdf-tools`, `/blog`, two posts, `/about`, `/privacy` and the 404 at
  **375 / 768 / 1024 / 1440 / 1920**: zero horizontal overflow, zero page errors. Gates: tsc ✓ ·
  eslint 0 err / 2 warn · vitest 1629 ✓ 67 skipped · playwright default 228/228 ✓.
- **2026-08-29 — a caveat on this entry and on the 2026-08-19 one above.** The 2026-08-19 sweep
  verified theme tokens "against the Nocturne design system via DesignSync". **DesignSync was NOT
  available on 2026-08-29** — it needs an authorization only `/design-login` can grant, and that
  cannot run in a non-interactive session. Everything in the geometry pass was therefore checked
  against *this file* plus live measurement, not against the six docs themselves. ⚠ OPEN: re-run the
  geometry rows against `Transmute - All Tools.dc.html` and the `_ds` bundle once someone has run
  `/design-login`. The measurements above are facts about the app; whether the doc asks for exactly
  these proportions is the part that is still unverified.
- **2026-08-30 — the docs themselves, at last.** The owner exported the Claude Design handoff
  bundle to `~/Desktop/transmute-ui-mockups/`, so the ⚠ OPEN caveat recorded above is now
  CLOSED: six extractors read all six `.dc.html` docs plus the `_ds` bundle end to end and
  diffed them against the code (173 diffs; specs kept alongside this pass). The Phase 7
  geometry survived the comparison except where the doc carried real numbers we had guessed:
  the control rail is a flat **340px** (the `clamp(300px,24%,368px)` we shipped never exceeded
  its 300px floor at any width up to 1920), the canvas gap is **14px**, the spec panel is a
  **250px key/value column** beside the h1 rather than four tiles across the measure, and the
  Nocturne **48px fade-out rule** was missing entirely. Fonts and the radius scale were already
  exact. Full detail in `plan.md` Phase 8.
