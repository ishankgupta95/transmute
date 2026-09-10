# Handoff prompt — Transmute, next session

> Copy everything below the line into a new Claude Code session in this repo.
> Delete this file once it has been used; it is a message, not documentation.

---

Read `plan.md` at the repo root first — it is the source of truth and it is current. Read, in
this order: "Context carried forward", "Engine facts" (**the MuPDF section is HISTORICAL — that
engine is GONE, do not reason from it**), then every **2026-09-10** annotation, of which there
are many: the Wave-2 PDF-tail completions, the `compress-pdf` engine reversal, the two
Platform-track shipped-bug entries, the accessibility entry, the LCP entry, and the two Wave-5
entries. Then `licensing-posture.md` (the STATUS block, the qpdf section, "FFmpeg — re-derived
2026-09-05", and "oxipng — ADOPTED 2026-09-06").

Do NOT re-litigate settled calls: the repo stays private, the app stays closed-source, MuPDF is
removed not licensed, AGPL is disqualifying, GPL is not being extended beyond the FFmpeg core,
and the ~120-page cap is retired. Do not propose making the repo public.

## Preflight

1. **Establish which of two states you are in before anything else.** The owner was handed a
   commit message at the end of the last session, so the tree may or may not have been committed
   and pushed.
   * `git log --oneline origin/master..master` → **3** unpushed commits and a clean-ish
     `git status --porcelain` means **the owner COMMITTED but did not push.** The live site is
     still the **67-tool** build.
   * **0 unpushed commits** and a clean tree means **the owner COMMITTED AND PUSHED**, and
     ⚠ **that means the site has been DEPLOYED** — `.github/workflows/ci.yml:70` runs
     `build-and-deploy` (`peaceiris/actions-gh-pages@v4`) on every push to master. Read the
     "if the site has been deployed" section below FIRST; it changes what is worth doing.
   * `git status --porcelain | wc -l` → **436** with **2** unpushed commits (`c828b0b`,
     `4880716`) means nothing was committed and the tree is exactly as the last session left it.
   In every case the tree should hold **179 tools** (`grep -c 'slug: "' src/data/tools.ts`).
2. Confirm the baseline is green before touching anything. These are the numbers as of
   **2026-09-10, end of session**; a different number means something real changed.
   * `npx tsc --noEmit` → clean
   * `npm run lint` → 0 errors, **2** standing `no-img-element` warnings (ToolCanvas.tsx,
     VideoToGifUI.tsx). Deliberate; do not "fix" them.
   * `npm test` → **6869 passed, 0 skipped, 207 files**
   * `npm run test:e2e` → **376 passed**
   * `npm run test:e2e:conversion` → **371 passed + 4 designed skips**, in BOTH projects
   * `npm run test:e2e:pwa` → **16 passed**. **Requires `out/`** — run `npm run build` first.
   * `npm run build` → succeeds, **211 HTML files** in `out/`
3. If the default e2e comes back massively red (pages rendering an `h1` but no
   `input[type=file]`), it is NOT the code — `.next` was last written by `next build` and
   `next dev` ran over it. `rm -rf .next` and re-run. Do not start debugging hydration.

## What the last session did, so you do not redo it

**The Wave-2 PDF tail is DONE — 171 → 179 tools.** `watermark-pdf`, `sign-pdf`,
`add-image-to-pdf`, `annotate-pdf`, `fill-pdf-form`, `flatten-pdf`, `remove-metadata`, and
**Wave 5's `pdf-editor`**. All pdf-lib + pdfjs; **zero new engine bytes**. Four of them are one
engine op (`stampPdf`), and `pdf-editor` came cheap because that op already existed.
All eight got **real conversion e2e coverage** (333 → 371 tests), including a rotation test that
re-renders through pdf.js and locates the mark by **pixel scan**, sharing no arithmetic with the
engine.

**Three shipped bugs were found and fixed, none of them on the task list:**
1. **Every `images-to-pdf` tool placed a rotated photo wrongly** — a phone photo with EXIF
   Orientation 6 came out sideways and at the wrong aspect ratio, on six tools, while the
   thumbnail strip showed it upright the whole time. PNG had the same bug via `eXIf`.
2. **`compress-pdf` could make a file BIGGER** (11,032 → 11,192 bytes, −1.45%) because its guard
   compared stream payloads and ignored the 21-byte `/Filter` entry it wrote.
3. **`stampPdf` misplaced images and rectangles on rotated pages** — my own bug, found by three
   build agents independently, each of which correctly refused to compensate in their UI.

**`compress-pdf`'s engine upgrade reversed its own premise.** Font subsetting is dead twice over
(pdf-lib cannot subset an already-embedded font, and across 400 real PDFs exactly ONE has a
non-subset face). The lever that pays is **re-deflating streams that arrived already
`/FlateDecode`**: aggregate **5.35% → 26.10%** on the corpus, **5.68% → 31.05%** on Xcode's
Acknowledgments.pdf, corroborated by an independently-written 400-file harness.

**Accessibility: audited and largely fixed.** 4 P1s, 8 P2s, 11 P3s. All four P1s closed —
mouse-only crop box, drag-only page reorder, focus destroyed on every run, and success never
announced. **The audit itself was wrong in several places and the implementers caught it**; read
the plan.md entry before trusting any prescription in it.

**Two gates that could not fail were fixed**: the how-to control check covered 3 tools of 121
(now general, and it immediately found `screen-recorder` naming a button that has always read
something else), and `license-notices.test.ts` repaired the file it was asserting on, so it
failed once and then self-healed.

**`0 BYTES SENT` is now measured, not asserted** — a live request count from the browser's own
resource timeline, saying REQUESTS rather than bytes because the API exposes bytes *received*
and nothing about a request body.

## Your job — what actually remains, and what does not

**11 unchecked items in `plan.md`. Only two are buildable work.**

### Buildable
- **`image-to-text` (OCR), Wave 5 item 1.** NOT built. The sizing question is now SETTLED and
  recorded: tesseract.js 7.0.0 is 1,411,341 B, `tesseract.js-core` 6.1.2 is 30,606,788 B for ALL
  variants (you ship one), and `eng.traineddata` is **2,952,873 B**. ⚠ **The expensive part is
  not the engine, it is the disclosure**: a new served artifact lands on SIX pinned surfaces,
  each with a test asserting exact bytes. Budget for that.
- **`ocr-pdf`**, which the plan gates behind OCR proving the pipeline. Do not start it first.

### Blocked on a deploy — READ THIS FIRST, because it may no longer be blocked

**A push to master IS a deploy** (`ci.yml:70`, `peaceiris/actions-gh-pages@v4`). Note that CI
gates the deploy on lint, typecheck and the DEFAULT e2e project only — the conversion,
conversion-webkit and pwa projects never run there, so a green CI is not the full gate this repo
uses locally.

**If the site HAS been deployed** (0 unpushed commits — check first), four things unblock, and
three of them are immediate:
1. **Home-LCP re-measure — do this one.** Lighthouse's 4.8 s was measured against the OLD live
   site. The last session removed 30,232 B of competing font preloads from the critical path
   (three IBM Plex Mono weights that could never draw the LCP element) but **explicitly did not
   claim an improvement, because it could not be measured**. Run Lighthouse against the live
   origin, mobile emulation, and record the real number in `plan.md` beside the old one.
2. **The GitHub Pages extension-less resolution question** (`/merge-pdf` → `.html` vs
   `/index.html`) — settled by one request against the live origin. The PWA suite's static
   server documents its choice as an assumption; replace the assumption with the answer.
3. **`launch_handler`** — with the PWA installable from a real origin, test what `"auto"` does
   for a FILE launch and declare a `client_mode` if the answer is clear. A unit test currently
   pins its absence; update it deliberately.
4. **Search Console — NOT immediate.** It needs impression data to accumulate first, so it is
   days-to-weeks after the deploy, not the same day. It gates the **GIF/animation cluster** and
   the Animation-category decision. When there IS data: check for doorway-style demotion on the
   16 Wave-1 variant pages BEFORE adding ten more thin ones. The rollback lever is
   canonicalising variants back to their engine page.

**If the site has NOT been deployed**, all four remain blocked and it is the owner's call —
the deploy would be **112 tools' worth of changes at once**.

### Owner decisions, explicitly not to be made for them
i18n · the LGPL FFmpeg-core build · the libheif-js swap for heic2any · the coi-serviceworker
spike · the background-remover / Whisper go/no-go (both now assessed on paper in `plan.md`, with
the licensing and bandwidth arithmetic done).

### Assessed and recorded rather than built
"Honest limits → real streaming" — the publishing half is done and the dangerous half is gated
(no page may claim "no size limit"); the OPFS/streaming work to RAISE the ceilings is untouched
and is a real project.

## Hard rules and traps — do not relearn these

Everything in the previous handoff still holds. **Read `plan.md`'s 2026-09-10 entries for the
new ones**, and treat these as the highest-value additions:

- ⚠ **A RAW BYTE GREP OVER A PDF IS UNSOUND, and it cost this session three separate false
  readings.** pdf-lib saves with `useObjectStreams` (its default) so structure is
  Flate-compressed, and flatten writes text HEX-ENCODED. `Buffer.includes("Ada Lovelace")`
  returns FALSE on a document that visibly contains it, and `grep -ac AcroForm` returns 0 on
  three fixtures that have one. Parse with pdf-lib, or inflate and follow `/Resources /XObject`.
- ⚠ **`constructor.name` on a third-party class is unsound in this repo.** esbuild renames
  classes in the worker bundle: `PDFTextField` unbundled, `PDFTextField3` bundled. A field
  classifier written that way passes every unit test (vitest imports unbundled) and classifies
  everything as "unknown" in the shipped worker. Use spec data — `/FT` plus the field flags.
- ⚠ **`PDFDocument.getForm()` CREATES an `/AcroForm` on a document that has none.** Read the
  catalog first, or a form-less PDF gains a form dictionary just by being inspected.
- ⚠ **`flatten()` bakes the `/AP`, not the `/V`**, and THROWS on a widget with no resolvable
  appearance — leaving the document half-flattened and unsaveable. Detect before leaping.
- ⚠ **Clearing `/Info` does NOT remove XMP.** It lives on the catalog, on pages, and on image
  XObjects. Measured.
- ⚠ **An assertion can be subsidised by another lever.** Two of my compress tests passed against
  a deliberately broken engine because the object-stream rewrite shrank the file regardless.
  Build the fixture so the behaviour under test is the ONLY thing that can satisfy the assertion.
- ⚠ **`git checkout` fails SILENTLY on untracked files**, and much of this tree is untracked. A
  mutation test that restores with `git checkout` leaves the mutation in the tree. Copy the file
  to /tmp first. This bit me once.
- ⚠ **The session scratchpad is SHARED between parallel agents.** One agent's file was
  overwritten by another mid-task, silently changing a word count it had already measured.
- ⚠ **`new URL(x, base)` almost never throws** — `"::::not a url::::"` resolves fine. The strings
  that genuinely throw are malformed authorities: `"http://"`, `"//"`, `"https://["`.
- **Let agents dispute the brief.** This session: three found the same real engine bug; one
  proved two rows of my EXIF table were swapped; one measured that the accessibility audit's own
  contrast prescription did not reach 3:1; several found stale premises in my contracts. Every
  one of them was right.

## Gates before you stop

`npx tsc --noEmit` clean · `npm run lint` 0 errors (2 standing warnings) · `npm test` ·
`npm run test:e2e:conversion` green in BOTH projects · `npx playwright test` green ·
`npm run build` succeeds · `npm run test:e2e:pwa` green (build first) · regenerate
`tool-surface-heights.ts` with the dev server up **after restarting it** and confirm nothing
exceeds 1600 px · grep the built `out/` with **a positive control beside every negative**, and
note the scopes that matter: `createQpdfModule` must be absent from `out/_next/**` and
`out/workers/**` but IS expected in `out/qpdf.js` (the served artifact), and the
`SharedArrayBuffer` assertion is scoped to **workers**, not all chunks — it appears harmlessly in
`typeof` guards inside vendored polyfills · tick the `plan.md` boxes as items land, annotating
deferrals inline with the measurement that justified them. That file is the handoff and it has
been kept accurate.

**Never run `git commit` or `git push`.** Make the changes, run the gates, stop for review.
