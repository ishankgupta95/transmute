# Transmute — session handoff (updated 2026-09-13)

Read `plan.md` first — it is the source of truth, and the re-classification
table at the top of it overrides the stale "⚠ Owner:" labels. Then
`licensing-posture.md`, which **is now current for the HEIC engine** (a dated
libheif section was added at the end this session) and still mentions none of
the *previous* session's engines — zero hits for tesseract, omggif, gifenc,
bcryptjs. Treat it as current for FFmpeg/qpdf/MuPDF/oxipng/libheif and out of
date for those four.

---

## 0. Preflight — establish state before touching anything

```bash
git log --oneline origin/master..master | wc -l   # expect 3
git ls-remote origin master                       # expect 3de521a… (NOT local master)
grep -c 'slug: "' src/data/tools.ts               # expect 190
grep -c '^- \[ \]' plan.md                        # expect 0
```

**The tree is 3 commits ahead of `origin/master` and carries ~120 uncommitted
files on top.** The live site still serves the **67-tool** build — it is now
**123 tools behind**. Nothing in either session has ever reached a user.

⚠ **NEVER `git commit` or `git push`.** The owner commits manually. This is a
standing instruction, not a per-change one.

⚠ **ON AN OLDER CHECKOUT, DELETE `public/vendor/heic2any.js` BY HAND.**
`copy:wasm` only copies; it never removes, and `next build` copies ALL of
`public/` into `out/` — so a 1,361,547-byte file for a decoder this app no
longer loads would be published. It is gitignored, so nothing in the suite or
in git will tell you it is there:

```bash
rm -f public/vendor/heic2any.js
```

---

## 1. Baselines — measured 2026-09-13 on a clean machine

| gate | expected |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, **2 standing warnings** (ToolCanvas.tsx, VideoToGifUI.tsx — deliberate, do not "fix") |
| `npm test` | **7144 passed, 216 files** |
| `npm run test:e2e` | **390 passed** — the 3 sweep timeouts described in §2(b) are GONE as of 2026-09-13; confirmed twice, and the suite runs in 3.9 min rather than 7.5 |
| `npm run test:e2e:conversion` | **409 collected**: **405 passed + 4 designed skips**. The `frame-export` flake was DIAGNOSED AND FIXED on 2026-09-13 (§3). ⚠ One run in about ten on 2026-09-13 came back `1 failed` and the log was not captured; the three runs straight after were green. `large-input.spec.ts` is the likeliest candidate — its in-browser recorder produced 78.5–156 MB across observed runs against a `> 100 MB` assertion — but that is INFERRED, not measured. Capture the log next time it happens |
| `npm run build` | succeeds, **222 HTML files** in `out/` |
| `npm run test:e2e:pwa` | **16 passed** (needs `npm run build` first) |

Unit went 7111 → 7144 and 212 → 216 files across the two sessions: the HEIC
swap (−4 heic2any, +11 HEIC, +4 decode-only) and then 2026-09-13's four new
files — `prose-scoping`, `hash-digest-streaming`, `og-locale`, plus the
re-founded assertions in `size-claims`. Conversion went
403 → 409 collected: +3 real HEIC tests × 2 browser projects. Per-project
collection is **212 / 35 files** chromium and **197 / 33** webkit (was 209 /
194) — checked per project, because `grepInvert` matches the FILE PATH.

A different number means something real changed. Investigate rather than
updating the number.

---

## 2. ⚠ PORT 3000, A TIMEOUT THAT WAS NOT A DEFECT, AND ONE REAL FLAKE

**(a) A leftover `next dev` or `playwright test` holds port 3000**, and
Playwright's `reuseExistingServer: !CI` silently adopts it. Symptoms are
indistinguishable from a real defect. **Chaining two Playwright commands in one
shell invocation reproduces it reliably.** Always, before any e2e run or
`measure-tool-surfaces`:

```bash
pkill -9 -f 'playwright test'; pkill -9 -f 'next dev'; lsof -ti:3000 | xargs kill -9
```

`ps -eo pid,etime,args | grep -E 'playwright|next dev'` — an `etime` older than
your command is the tell.

**(b) THREE `responsive-sweep.spec.ts` TIMEOUTS — DIAGNOSED 2026-09-12, GONE
2026-09-13, and the sequence is the lesson.** The sweep walks all ~222 routes
serially at 3 viewports waiting for `networkidle`, under a 300 s
`test.setTimeout`. Measured at **~288 s per viewport in isolation** — 96% of its
own budget on an idle machine — so it passed alone and timed out whenever the
full suite competed for cores. The error was always
`Test timeout of 300000ms exceeded`, never an assertion.

It was deliberately NOT "fixed" by raising the number, because nothing had moved
it and raising a number you did not move is how a baseline stops meaning
anything. Cutting **2,634 gzipped bytes of render-blocking CSS per route** put it
back under budget on its own: `npm run test:e2e` is **390/390 in 3.9 min**,
confirmed twice, against 387/390 in 7.5 min before. ⚠ It is still a test with a
~30% margin — a future page-weight regression lands here first, and the failure
will again look like a defect in whatever spec is unlucky.

**(c) ⚠ A SECOND FLAKE — ORDERING DEPENDENCY REMOVED, CAUSE NEVER CONFIRMED.**
`unit/components/ExtractPdfImagesUI.test.tsx` → "revokes every preview URL it
allocated" failed twice in about seven runs on 2026-09-13, then passed **46
consecutive runs** (20 filtered, 20 whole-file, 6 full-suite). The original
failure was never reproduced, so nothing in the product was changed — fixing
code against an unreproducible failure is what this file warns about elsewhere.

What WAS fixed, found by reading: the test required an ordering nothing
enforced. The revoke timer is created by an effect CLEANUP, so it has to be
created after `vi.useFakeTimers()` and before `advanceTimersByTime`, and
whether React had flushed that cleanup inside `fireEvent` was a scheduling
detail rather than a guarantee. An explicit `act(() => {})` makes it explicit.
⚠ If it fails again, do NOT widen the 1500 — it is not the variable.

⚠ **And a trap worth more than the fix:** mutating `useObjectUrl`'s revoke made
the test still pass, which reads exactly like a gate that cannot fail. It is
not — this component does its own `createObjectURL`/`revokeObjectURL` inline
(it renders a LIST; the hook serves one URL), and mutating THAT fails the test
properly. **Check what the code under test actually calls before believing a
mutation result.**

**Also still true:** a long-lived `next dev` serves a **cached module graph**
after registry edits. Same cure as (a).

---

## 3. What shipped (190 tools throughout — no new pages)

### 2026-09-13 — four platform items

**The `frame-export` flake: DIAGNOSED AND FIXED at BOTH levels, no bisect
needed.** The test required the product to FAIL — `toBeLessThan(3)` demanded the
element miss the 2.000 s frame, and the captured failure was
`Expected: < 3, Received: 3`. Replaced by the accounting invariant.

⚠ **And the product defect under it is fixed too.** `processFrame` took no
parameters, discarding rVFC's `metadata.mediaTime` and crediting frames to
`video.currentTime`. **Measured: `currentTime − mediaTime` is −28.3…−10.8 ms in
Chromium and +0.9…+32.0 ms in WebKit**, against a 41.667 ms frame period — a
whole-frame error pointing in OPPOSITE directions per engine, which is why each
project failed differently. ⚠ That fix alone would have regressed "8 frames"
to 7, because the 8th planned moment sits 0.85 ms past the last picture (the
plan is computed off `duration`, which is the AUDIO track). So the matcher now
takes the frame NEAREST a moment, with a tolerance of half the shortest
observed inter-frame gap — derived from the stream. Both modes are deterministic
on both engines now.

**File-size ceilings: `/hash-generator` and `/file-checksum` no longer have
one.** They hash off `blob.stream()`; the Blob crosses the worker boundary
instead of an ArrayBuffer. ⚠ OPFS was the wrong lever and this item was named
after it. ⚠ `ffmpeg-loader.ts`'s "it is a V8 limit" was FALSE — the same V8
under Node allocates 4 GiB; the ~2 GB wall is the RENDERER's. Measured cost
**in the browser**: ~39 MB/s for all four digests (Node says 50 — quote the
browser one).

**Render-blocking CSS: 129,437 → 104,943 raw / 19,804 → 17,170 gzipped
(−13.3%)** on every non-blog page, by scoping `@tailwindcss/typography` to its
three real consumers and stopping Tailwind scanning `src/__tests__`. This is
what fixed §2(b).

**i18n: scoped, then DECLINED by the owner — but it exposed a live defect worth
keeping.** ⚠ **212 of 222 pages were shipping with NO `og:locale`**, because a
page's `openGraph` REPLACES the layout's rather than merging and eight files
declare their own. Now 221/222, off `src/lib/seo/locale.ts` — two constants,
which is all that survived. The multi-locale scaffolding (a `LOCALES` tuple, a
`Locale` type, an unread `SCHEMA_LANGUAGE` map, and both values as
`Record<Locale, string>`) was removed with the decision.

**`launch_handler`: declared as `navigate-new`.** ⚠ **The reasoning that kept it
undeclared was backwards.** `manifest.ts` argued that declaring nothing left
"the browser's own default in place". The default is `auto`, and `auto` means
the UA decides — with `navigate-existing` the documented typical choice on
mobile, which NAVIGATES an existing window to the launch URL. So declaring
nothing was the only option exposing a tab mid-conversion to being navigated
away. `focus-existing` was rejected too: `LaunchQueueIntake` is mounted ONLY in
`OpenWithClient` (`/open`), so focusing a window on any other page drops the
file silently. Verified in the built manifest; the test pins the value AND that
the handler action still matches where the intake is mounted.

### 2026-09-12 — the HEIC engine swap

**`heic2any` 0.0.4 → `libheif-js` 1.23.2.** No new tools; one engine replaced.
`plan.md`'s Wave 4 item carries the full account. The three things worth
carrying in your head:

**⚠ The plan item's stated motivation was WRONG IN BOTH HALVES, and the item now
says so.** "Fixes multi-image HEIC / Live Photos" — a decoder cannot fix Live
Photos (the motion half is a separate `.MOV` that never enters the HEIC, which
the product's own copy already said correctly), and multi-image was already
reachable with the old engine via an unused `{ multiple: true }` option, so that
defect was **ours**, in `image-convert.ts`, not the library's.

**What actually justified it — measured, not argued:**
1. **Transparency decoded to OPAQUE BLACK.** heic2any's binding hardcodes alpha
   to 255: a HEIC with an `auxC` alpha item came back `rgba(0,0,0,255)` where
   libheif returns `rgba(0,0,0,0)`. Live on every HEIC page that writes PNG/WebP.
2. **The `multiple: true` path is deterministically broken** — 3/3 across a
   7-row matrix: re-decoding the same bytes in one tab under-reports the image
   count, and the next *different* file then kills the module with `abort(12)`.
   The shipped call shape never reached it (0/9), so it was a landmine in the
   path of the cheap fix rather than a live bug.
3. **It took index 0, not the primary image.** `pitm` names the main picture and
   nothing requires it to be first.

**Every new gate was mutation-proved** — ten of them: primary-not-[0], the
multi-image warning, freeing every handle, freeing the wasm context (×2), the
three load/decode failure paths, plus two e2e (primary selection and `irot`
orientation). Each was mutated, watched to fail, and restored.
`libheif-decode-only.test.ts` re-derives the licensing claim from the shipped
bytes on every `npm test`.

⚠ **A LEAK I INTRODUCED AND THEN CAUGHT — read this before touching
`decodeHeic`.** `HeifDecoder.decode()` frees its previous `heif_context` only
when called AGAIN ON THE SAME INSTANCE, and `decodeHeic` makes a fresh instance
per file (it has to: the image handles outlive an `await`, so a shared instance
would let a concurrent decode free them under live handles). The first version
therefore never freed anything. **Measured: 400 decodes of an 82,878-byte photo
grew the wasm heap 16.3 MB → 48.6 MB, and stayed flat at 16.3 MB once
`heif_context_free` was called.** ~81 KB per photo — a batch of 3 MB iPhone
photos walks a browser into the same out-of-memory abort this swap was partly
made to escape. Two unit gates pin it, including the throw path.

**Cost, stated because it is a regression:** **+152,085 B raw / +158,123 B
gzipped**; homepage row "1.3 MB" → "1.4 MB". The one-file bundle variant would
have kept the single-artifact shape and cost **199,164 MORE gzipped bytes**,
all base64 padding around the identical wasm.

---

## 4. No open items

⚠ **`plan.md` has ZERO open checkboxes as of 2026-09-13.** That is not the same
as "nothing left to do" — it means every remaining thing is either a decision
that has been TAKEN, or work that needs a deploy first. Read the rejection
table at the end of plan.md before proposing anything; three things were closed
as decisions, not oversights:

* **Wave 5 (`background-remover` + Whisper) — REMOVED.** Both are in the "Do not
  build" table with their findings. `background-remover` fails the licensing
  gate this repo already settled (no SPDX identifier; RMBG models are
  non-commercial). ⚠ Whisper's blocker is GitHub's hard ~100 MiB PER-FILE limit
  at PUSH, before bandwidth is even a question.
* **coi-serviceworker — REMOVED.** It buys ONE tool: oxipng's parallel build,
  +71,870 served bytes, speedup NOT MEASURED. There is no multi-threaded engine
  in the tree to accelerate, so its own exit criterion was unsatisfiable.
* **Search Console and i18n — DECLINED** (see below).

**Still genuinely deploy-gated, and nobody's open task:** home mobile LCP needs
Lighthouse against a real deploy, and nobody has opened a file from an OS file
manager into an installed copy (five minutes of clicking; §3 says what it would
confirm).

**The evidence behind the coi-serviceworker NO**, written up in full in the
rejection table. Nothing was run in a browser. Four findings, each verified
locally:
* **⚠ The spike's own named exit criterion is unsatisfiable.** "Deadlock repro
  across 3 browsers" needs a threaded engine and there is none:
  `@ffmpeg/core-mt` has **0 hits in `package-lock.json`** (positive control:
  `@ffmpeg/core` = 3).
* **⚠ Two service workers cannot share scope `/`, and we already own it.** The
  real work is never "adopt coi-serviceworker" — it is ~15 lines of header
  synthesis inside our own `service-worker.ts`, which the plan item never
  mentions.
* **⚠ The bootstrap gap is permanent.** Headers are fixed at navigation time, so
  the first navigation of any visit is never isolated. Their cure is
  `location.reload()`, which `ServiceWorkerRegistration` refuses on purpose. Any
  threaded engine therefore ships *alongside* its single-threaded build forever.
* **One worry is refuted:** `gtag/js` and `/g/collect` both send
  `cross-origin-resource-policy: cross-origin` (measured), so plain
  `require-corp` suffices and Safari's missing `credentialless` does not bite.
  ⚠ But that is a third-party promise and its failure is SILENT.

**What isolation buys today: one tool** — oxipng's parallel build, **+71,870 B**
(236,042 vs 164,172), which must ship *in addition to* the single-threaded one.
Speedup **NOT MEASURED**; do not repeat the research doc's "4–8×".

---

## 5. Traps found this session

**⚠ "A real `.heic` cannot be synthesised" WAS FALSE, and it cost this repo real
coverage.** Two spec files carried that note and both were reasoning about the
wrong machine: the library never encodes and sharp refuses HEVC, but **macOS
writes real HEVC stills through ImageIO**. `node scripts/generate-test-fixtures.mjs
--heic` now writes THREE: `sample-photo.heic` (800×600), `sample-burst.heic`
(3 pictures, 3 sizes, **the MIDDLE one marked primary** so a decoder that takes
`[0]` fails), and `sample-rotated.heic` (a 120×60 landscape raster carrying
orientation 6). Like `--avif`/sharp it is excluded from the no-flag run because
it cannot work off macOS. **Re-test a "cannot be done" premise when the machine
changes.**

**⚠ HEIF stores rotation as an `irot` PROPERTY, not an EXIF tag** — so none of
this repo's recorded EXIF-orientation lore applies to it. Measured: libheif
APPLIES it, and a 120×60 raster with orientation 6 decodes to a 60×120 picture
with its colour bands in the right order. That is pinned by an e2e test in both
browser projects, because a portrait photo arriving sideways is the most common
real complaint about HEIC conversion.

**⚠ Do not assert exact RGB on saturated primaries through this chain.** HEVC
stores chroma at 4:2:0 and JPEG subsamples it again: pure blue comes back as
`rgb(4,51,255)`. A tolerance loose enough to admit that (≥51) is loose enough to
stop telling the bands apart. Assert the DOMINANT CHANNEL instead — unambiguous,
and it still cannot survive a wrong band order.

**⚠ The `import()`-and-read-the-global vendor trick does not generalise.**
heic2any's UMD had an explicit `global.heic2any = factory()` branch. libheif-js's
tail is only `module.exports` / AMD `define` over a top-level `var libheif`,
which in an ES module is module-scoped: `import()` gives an EMPTY namespace *and*
leaves `globalThis.libheif` undefined. A classic `<script>` tag's sloppy-mode
global is the only way in. Both shapes were tried in all three engines before
either was believed.

**⚠ An Emscripten glue that reads `document.currentScript.src` resolves its
`.wasm` against the PAGE url** once the script has finished running. Passing
`wasmBinary` yourself skips the resolution entirely — which is both why the
tesseract sibling trap cannot bite here and why the §4(d) replaceability claim
is stronger than it was.

**⚠ A mocked `document.createElement` that falls through to
`document.createElement(tag)` re-enters its own spy.** Harmless while canvases
were the only element the code made; infinite recursion the moment a `<script>`
is created. Bind the real factory first.

**⚠ A 4-second test sitting under a 5-second default timeout is not passing, it
is lucky.** `barcode.test.ts`'s version-40 QR case drove nine full BWIPP encodes
inside the default budget; adding **one more test FILE** (≈0.9 s of extra worker
environment competing for cores) made it fail 3/3 while still passing alone. It
now has an explicit 20 s timeout with the measurement written beside it. Look
for the *timeout*, not the assertion, when a test fails only in a full run.

**Carried from the previous session and still true:** `grepInvert` matches the
FILE PATH, not just the title (`conversion-webkit` carries `/gif|FFmpeg|MP4/i`)
— **check collection counts per project** after adding specs; a raw byte grep
over a PDF is unsound (object streams); `ImageDecoder` is absent on a non-secure
origin; `await decoder.tracks.ready` is required; tesseract's `output` is the
THIRD argument; `workerBlobURL` defaults true and never settles; RFC 5545
unfolding CONSUMES the whitespace marker; an installed-but-unused dependency is
caught by the license-notices gate; **"small bets" lists absorb engine
adoptions**.

---

## 6. Adding a tool — the surfaces, in order

`tools.ts` (ToolType + entry, and `CONVERTER_TOOL_TYPES`) →
`HOW_TO_STEPS_BY_TOOL_TYPE` → the category client barrel → `ToolClient.tsx` →
`EXPECTED_CLIENT` in `ToolClient.test.tsx` (plus `UI_FOR_CLIENT`) → `faqs.ts`
(≥3) → ~~`posts.ts` relatedTools (≥1)~~ (blog removed 2026-09-18; `posts.ts` is
gone) → `workspace.ts` → restart dev, then
`node scripts/measure-tool-surfaces.mjs` → `offline.ts` counts +
`offline.test.ts` `tools.length`. Plus `ConversionMatrix.tsx` `ROUTES` for any
format→format tool, and **the licence notices for ANY new npm dependency**
(`node scripts/generate-license-notices.mjs`, commit the .txt; a package that
ships no LICENSE file is additionally hand-named on `/licenses`).

Per-tool and not obvious: description **120–160 chars**, aboutText
**200–400 words**, `relatedTools` resolve / exclude self / no duplicates, how-to
steps parsed against controls the UI really has.

**Swapping or adding a SERVED ENGINE is a bigger list than that, and this
session walked all of it — 35 files.** Beyond the above:
`copy:wasm` in package.json · `.gitignore` (not needed if it lives under
`/public/vendor/`, which is ignored wholesale) · homepage `ENGINES` (key order
`name, handles, size, when`) · the prose *under* that table · `/privacy` ·
`categories.ts` `engine` + `download` + its ceiling comments · `CategoryHubPage`
· `sw-policy.ts` `ENGINE_DIRS` · `offline.ts` bundle (`bytes`, `urls`, and the
ruler derivation comment) · `/licenses` · ~~the blog~~ (blog removed 2026-09-18 —
drop this bullet for future engine swaps) · and the tests that pin each
one: `engine-disclosure.test.ts`, `offline.test.ts`, `category-hub-claims.test.tsx`
(`CEILING` / `CEILING_ARTIFACT`), `offline-copy-claims.test.tsx`,
`sw-policy.test.ts`, `vendor-loader-retry.test.ts`.

⚠ **`workspace.ts` spells engine names in UPPERCASE** (`HEIC2ANY`, now
`LIBHEIF`) — invisible to a case-sensitive grep for the package name, and **no
test asserts that field**. It is the single most dangerous surface on the list.

⚠ **The size is spelled in ~20 places and exactly ONE is machine-checked**
(`src/app/page.tsx`'s ENGINES row, via `engine-disclosure.test.ts`). Grep every
spelling of the old number before you believe you are done.

---

## 7. One trap I set for myself

⚠ **The PWA e2e suite binds port 4319, and `test:e2e` binds 3000.** I started
throwaway `npx serve` instances on 4317/4318/4319 to verify built pages in a
browser, and `npm run test:e2e:pwa` then failed with "http://localhost:4319 is
already used" — §2(a) in a costume I had made myself. Kill your own helpers too:

```bash
pkill -f 'serve out'; for p in 3000 4317 4318 4319; do lsof -ti:$p | xargs kill -9; done
```

---

## 8. Standing rules

- Never commit, never push.
- Every gate must be able to **fail** — prove it by mutation before trusting it.
  (Done this session for all four new HEIC gates and the licensing gate: each
  was mutated, watched to fail, and restored.)
- Every negative scan needs a **positive control** beside it, and never
  `strings … | grep -q`.
- Tick `plan.md` boxes as work lands; annotate deferrals inline with the
  measurement that justified them.
- The repo stays private, the app closed-source. AGPL is disqualifying. MuPDF is
  removed, not licensed. Do not propose making the repo public.
