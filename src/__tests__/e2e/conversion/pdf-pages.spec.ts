import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  toolError,
} from "./support";
import { assertPdf, assertZip } from "./validators";
import { expectPdfPages } from "./fidelity";

/**
 * The PDF page-geometry and extraction cluster: extract-pdf-pages,
 * delete-pdf-pages, crop-pdf, change-pdf-page-size, pdf-resizer and
 * pdf-to-text.
 *
 * Every case here asserts the BYTES that came back, not that a button
 * appeared. Page counts are re-parsed with pdf-lib, page boxes are read out of
 * the produced document and compared against what the UI claimed it would do,
 * the per-page ZIP is unzipped and each member re-parsed, and the extracted
 * text is matched against strings `scripts/generate-test-fixtures.mjs`
 * demonstrably drew into the fixture. A tool that renders a Download over a
 * no-op — a "cropped" PDF whose boxes never moved, a "resized" one whose
 * CropBox still holds the old sheet — fails here.
 *
 * The fixture is the checked-in 5-page A4 document (595 × 842 pt, real
 * embedded text, one filled rectangle per page), so counts, boxes and text are
 * all falsifiable against known values.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i —
 * every test here must run in BOTH engines (all six tools are pure pdf-lib /
 * pdfjs and have no Chromium-only dependency), so no title may contain those
 * words.
 */

/** The fixture's own page box, from `buildPdf()` in the fixture generator. */
const A4 = { width: 595, height: 842 };

/**
 * Inflate every Flate stream in a saved PDF and append it to the raw text.
 *
 * Content streams are compressed by pdf-lib on the way out, so a literal
 * operator assertion (`... cm`) can only be made against the decompressed
 * bytes. Same walk `pdf.spec.ts` uses for the page-number counter-rotation.
 */
async function pdfOperatorText(bytes: Buffer): Promise<string> {
  const zlib = await import("node:zlib");
  let text = bytes.toString("latin1");
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      text += "\n" + zlib.inflateSync(bytes.subarray(start, end)).toString("latin1");
    } catch {
      /* not a Flate stream */
    }
  }
  return text;
}

/** Page boxes as the produced file declares them, MediaBox and CropBox both. */
async function pageBoxes(bytes: Buffer): Promise<
  {
    media: { width: number; height: number };
    crop: { x: number; y: number; width: number; height: number };
  }[]
> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  return doc.getPages().map((p) => ({
    media: { width: p.getWidth(), height: p.getHeight() },
    crop: p.getCropBox(),
  }));
}

/**
 * Read a `StatStrip` cell by its mono label. The value is the label span's
 * sibling, so the parent's text is `LABEL` + `VALUE` concatenated — the same
 * `.locator("..")` idiom golden-paths.spec.ts uses on the FORMAT stat.
 * Scoped to the tool surface because FAQ copy on the page quotes these words.
 */
async function statValue(page: Page, label: string): Promise<string> {
  const cell = page
    .locator("[data-tool-surface]")
    .getByText(label, { exact: true })
    .first()
    .locator("..");
  const text = (await cell.textContent()) ?? "";
  return text.slice(label.length).trim();
}

/** "492 × 700 PT" → { width: 492, height: 700 }. */
function parsePtLabel(label: string): { width: number; height: number } {
  const m = label.match(/(\d+)\s*×\s*(\d+)\s*PT/);
  if (!m) throw new Error(`not a points label: ${JSON.stringify(label)}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Poll a StatStrip cell until it holds a real points label, then parse it.
 *
 * The em-dash placeholder is not a paint artefact a single read is merely
 * unlucky to catch. `preview` is set the commit the page <img> renders, but the
 * CROP readout comes from cropperjs's first `crop` event, which only fires from
 * `build()` on the CLONED image's async load — so the two are separated by a
 * real window. Measured: reading the cell once threw `not a points label: "—"`
 * on a two-worker run of this file, and passed when the same test ran alone.
 *
 * crop-pdf's primary now carries `!cropBox` as its own readiness term, so the
 * button no longer opens that window for a caller who waits on it. This poll is
 * kept regardless: it costs nothing when the value is already there, it does not
 * depend on any one tool's disabled logic, and a spec whose job is to measure the
 * canvas→points mapping must not be the thing that reintroduces the race.
 */
async function readPtLabel(page: Page, label: string): Promise<{ width: number; height: number }> {
  await expect
    .poll(() => statValue(page, label), { timeout: 90_000 })
    .toMatch(/\d+\s*×\s*\d+\s*PT/);
  return parsePtLabel(await statValue(page, label));
}

/** A PDF of nothing but a drawn image: no fonts, therefore no text layer. */
async function imageOnlyPdf(pages = 2) {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const jpg = await doc.embedJpg(new Uint8Array((await SAMPLES.jpg()).buffer));
  for (let i = 0; i < pages; i++) {
    doc.addPage([400, 300]).drawImage(jpg, { x: 0, y: 0, width: 400, height: 300 });
  }
  return {
    name: "scanned-pages.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// extract-pdf-pages
// ────────────────────────────────────────────────────────────────────────────

test.describe("extract-pdf-pages — real output", () => {
  test("the selected pages come back as one document", async ({ page }) => {
    await page.goto("/extract-pdf-pages");
    await uploadFixture(page, await SAMPLES.pdf());

    // Wait on the LAST tile, not on "Select all": the aside's buttons render
    // the moment a file is set, so they are visible while the deck is still
    // empty and a tile click would miss.
    await expect(page.getByRole("button", { name: /^Page 5(,|$)/ })).toBeVisible({
      timeout: 60_000,
    });
    // Nothing is preselected here — extract opens on an empty selection.
    await expect(
      page.locator("[data-tool-surface]").getByText("0 PAGES SELECTED"),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Page 2(,|$)/ }).first().click();
    await page.getByRole("button", { name: /^Page 4(,|$)/ }).first().click();

    const action = primaryAction(page, /Extract 2 pages/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `extract failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("extracted-pages.pdf");
    const info = await assertPdf(bytes, { pages: 2 });
    // The pages that were PICKED — not the first two, not in another order.
    await expectPdfPages(bytes, [2, 4], "extracted-pages.pdf");
    // Pages are grafted whole, so the A4 geometry has to survive the copy.
    for (const size of info.sizes) {
      expect(Math.round(size.width)).toBe(A4.width);
      expect(Math.round(size.height)).toBe(A4.height);
    }
  });

  test("one document per page arrives as an archive of single-page PDFs", async ({ page }) => {
    await page.goto("/extract-pdf-pages");
    await uploadFixture(page, await SAMPLES.pdf());

    await expect(page.getByRole("button", { name: /^Page 5(,|$)/ })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: /^Page 1(,|$)/ }).first().click();
    await page.getByRole("button", { name: /^Page 3(,|$)/ }).first().click();
    await page.getByRole("button", { name: /^Page 5(,|$)/ }).first().click();

    // The mode toggle is the whole reason this page exists next to split-pdf.
    await page.getByRole("button", { name: "One per page", exact: true }).click();

    const action = primaryAction(page, /Extract 3 pages/);
    await expect(action).toBeEnabled();
    await action.click();

    const zipButton = page.getByRole("button", { name: /Download all \(ZIP\)/ });
    await expect(zipButton, `extract failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { name, bytes } = await captureDownload(page, zipButton);

    expect(name).toBe("extracted-pages.zip");
    const names = await assertZip(bytes, { minEntries: 3 });
    // Named by SOURCE page number, not by position in the batch — that is what
    // makes the members meaningful once they are unzipped beside the original.
    expect(names.sort()).toEqual(["page-1.pdf", "page-3.pdf", "page-5.pdf"]);

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    for (const entry of names) {
      const member = await zip.files[entry].async("nodebuffer");
      await assertPdf(member, { pages: 1 });
      // page-3.pdf must actually hold page 3.
      await expectPdfPages(member, [Number(entry.match(/\d+/)![0])], entry);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// delete-pdf-pages
// ────────────────────────────────────────────────────────────────────────────

test.describe("delete-pdf-pages — real output", () => {
  test("removes the chosen pages and keeps the rest", async ({ page }) => {
    await page.goto("/delete-pdf-pages");
    await uploadFixture(page, await SAMPLES.pdf());

    await expect(page.getByRole("button", { name: "Page 5, will be kept" })).toBeVisible({
      timeout: 60_000,
    });
    // The selection is what LEAVES — the inversion is the whole tool, and the
    // tile's accessible name is where it is stated to a screen reader.
    await page.getByRole("button", { name: "Page 2, will be kept" }).click();
    await page.getByRole("button", { name: "Page 4, will be kept" }).click();
    await expect(page.getByRole("button", { name: "Page 2, will be removed" })).toBeVisible();
    await expect(
      page.locator("[data-tool-surface]").getByText("2 PAGES WILL BE REMOVED"),
    ).toBeVisible();

    const action = primaryAction(page, /Delete 2 pages/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `delete failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("pages-removed.pdf");
    // 5 − 2. The complement is derived inside the engine from the real
    // document, so this also pins that it never trusted a stale UI count.
    await assertPdf(bytes, { pages: 3 });
    // And the RIGHT three: 2 and 4 went, 1, 3 and 5 stayed, in order.
    await expectPdfPages(bytes, [1, 3, 5], "pages-removed.pdf");
  });

  test("refuses to hand back a document with no pages left", async ({ page }) => {
    await page.goto("/delete-pdf-pages");
    await uploadFixture(page, await SAMPLES.pdf());

    await expect(page.getByRole("button", { name: "Page 5, will be kept" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Select all", exact: true }).click();

    /*
      `deletePdfPages` will happily produce a structurally valid 0-page PDF —
      that is deliberate in the engine and unit-tested there. No reader opens
      such a file, so the UI is the layer that has to refuse, and this is the
      assertion that keeps the refusal from being quietly dropped.
    */
    await expect(
      page.locator("[data-tool-surface]").getByText(/All 5 pages are marked for removal/),
    ).toBeVisible();
    await expect(primaryAction(page, /Delete 5 pages/)).toBeDisabled();

    // Leaving one page behind re-enables it — the block is about emptiness,
    // not about a large selection.
    await page.getByRole("button", { name: "Page 1, will be removed" }).click();
    await expect(primaryAction(page, /Delete 4 pages/)).toBeEnabled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// crop-pdf
// ────────────────────────────────────────────────────────────────────────────

test.describe("crop-pdf — real output", () => {
  test("the produced page boxes are the cropped rectangle, on every page", async ({ page }) => {
    await page.goto("/crop-pdf");
    await uploadFixture(page, await SAMPLES.pdf());

    const action = primaryAction(page, /Crop 5 pages/);
    await expect(action, `render failed: ${await toolError(page)}`).toBeEnabled({
      timeout: 90_000,
    });

    /*
      What the tool SAYS it will produce, read off the stat strip — the bytes
      must not disagree with the readout the user was looking at.

      What this comparison does NOT prove, and used to claim it did: the
      canvas→points mapping. `CROP` is rendered from the same `toPdfRect(cropBox,
      preview)` call that feeds the engine (CropPdfUI.tsx:282 vs :249), so a
      mapping bug moves both sides of the comparison together; and the default
      cropperjs frame (`autoCropArea: 0.9`, centred) is symmetric on both axes,
      so an inverted y-flip is numerically identical to the correct one — 42.25
      either way on this fixture. The `crop.x > 0` / `crop.y > 0` pair below is
      the only positional assertion here and both mappings satisfy it. The
      asymmetric-frame test underneath is what actually pins the flip.

      Measured, not assumed: with `toPdfRect`'s y-flip removed in the running
      app, THIS test still passes and the asymmetric one fails by 379.20 pt.
    */
    const claimed = await readPtLabel(page, "CROP");
    expect(claimed.width, "the default frame must be smaller than the sheet").toBeLessThan(
      A4.width,
    );
    expect(claimed.height).toBeLessThan(A4.height);

    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `crop failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-doc-cropped.pdf");
    await assertPdf(bytes, { pages: 5 });

    const boxes = await pageBoxes(bytes);
    expect(boxes).toHaveLength(5);
    for (const { media, crop } of boxes) {
      // ±1 pt: the readout is rounded to whole points, the box is not.
      expect(Math.abs(media.width - claimed.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(media.height - claimed.height)).toBeLessThanOrEqual(1);
      // Both boxes, to the same rect. A CropBox-only crop leaves a MediaBox
      // some print paths still honour; a MediaBox-only crop is invisible in
      // any viewer, because what is shown is the intersection of the two.
      expect(Math.abs(crop.width - media.width)).toBeLessThan(0.01);
      expect(Math.abs(crop.height - media.height)).toBeLessThan(0.01);
      // A crop must never scale or move content, so the box has to be an
      // OFFSET window into the original sheet rather than a reset to (0,0).
      expect(crop.x).toBeGreaterThan(0);
      expect(crop.y).toBeGreaterThan(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(A4.width + 0.01);
      expect(crop.y + crop.height).toBeLessThanOrEqual(A4.height + 0.01);
    }

    // And nothing was scaled: the crop writes boxes only, so no page-level
    // transformation matrix may appear that was not already in the fixture.
    const text = await pdfOperatorText(bytes);
    expect(text).not.toMatch(/0\.\d+ 0 0 0\.\d+ [\d.-]+ [\d.-]+ cm/);
  });

  test("an off-centre frame lands where it was drawn, not mirrored", async ({ page }) => {
    /*
      The guard for `toPdfRect` (CropPdfUI.tsx:227-239) — the single place a
      TOP-left canvas frame becomes a BOTTOM-left PDF frame, and the one line in
      the crop tool whose own comment concedes it was verified only by a
      scratchpad script that was never checked in.

      Two properties make the sibling test above blind to it, and both are
      removed here:

        · The default frame is symmetric. cropperjs's `initCropBox` sizes the
          box to `canvas × autoCropArea` and centres it (cropper.js:1365-1395),
          and CropPdfUI passes `autoCropArea: 0.9` with no aspect ratio, so
          `box.y` and `canvasH − (box.y + box.height)` are equal by
          construction. `pageH − (box.y + box.height)/sy` and the flipless
          `box.y/sy` therefore collapse onto the same number — measured 42.25
          on this fixture, bit-for-bit, so a mirrored build produces a
          byte-identical file. Dragging the south-east handle up and to the
          left leaves the frame ~5% from the top of the sheet and ~50% from the
          bottom, so the two mappings are now hundreds of points apart.

        · The expectation was self-referential. Here the expected rect is
          derived from LAID-OUT PIXELS — the on-screen `.cropper-crop-box`
          measured against the on-screen `.cropper-canvas`, which is the page —
          scaled by the page size the tool reports for the source. That path
          shares no arithmetic with `toPdfRect`, so nothing about the produced
          rect can move it.

      A mirrored y is what this catches, but the same derivation pins x, width
      and height, so an x-mirror (equally invisible against a centred box) fails
      it too.

      Both halves of that are measured, not asserted. Mutating `toPdfRect` in
      the running app and re-running this file:

        · `y: box.y / sy` (flip dropped) → this test FAILS with
          `crop.y 42.2488 vs 421.4525` (off by 379.20 pt), and the sibling test
          above still PASSES — which is exactly the blindness this case exists
          for.
        · `x: p.pageWidth - (box.x + box.width) / sx` (x mirrored) → this test
          FAILS with `crop.x 208.845 vs 29.7505` (off by 179.09 pt), sibling
          still passes.

      Both mutations were reverted immediately; CropPdfUI.tsx is byte-identical
      to its pre-mutation SHA-256.
    */
    await page.goto("/crop-pdf");
    await uploadFixture(page, await SAMPLES.pdf());

    const action = primaryAction(page, /Crop 5 pages/);
    await expect(action, `render failed: ${await toolError(page)}`).toBeEnabled({
      timeout: 90_000,
    });

    // The page's VISUAL size in points, straight from the tool's own pdfjs
    // probe. Not `A4`: this number is what `cropPdfPages` works in, and reading
    // it here keeps the expectation honest if the fixture is ever re-generated.
    const sheet = await readPtLabel(page, "PAGE 1");
    expect(sheet).toEqual(A4);

    const stage = page.locator(".cropper-canvas");
    const frame = page.locator(".cropper-crop-box");
    await expect(frame).toBeVisible({ timeout: 90_000 });

    /*
      The default frame reaches to 95% of the sheet, so on a 720px-tall viewport
      its south-east handle sits below the fold and the mouse cannot reach it —
      the same trap `interactions.spec.ts` documents for crop-image. Scroll
      first, then measure: `boundingBox()` is viewport-relative.
    */
    const handle = page.locator(".cropper-point.point-se");
    await handle.scrollIntoViewIfNeeded();
    await expect(handle).toBeVisible();

    const stageBefore = (await stage.boundingBox())!;
    const hb = (await handle.boundingBox())!;
    // Target: right edge at 65% of the sheet's width, bottom edge at 50% of its
    // height. With the untouched top-left at 5%/5% that is asymmetric on BOTH
    // axes, which is the entire point of the drag.
    const targetX = stageBefore.x + stageBefore.width * 0.65;
    const targetY = stageBefore.y + stageBefore.height * 0.5;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move((hb.x + targetX) / 2, (hb.y + targetY) / 2, { steps: 5 });
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await page.mouse.up();

    // Re-measure both boxes together, after the drag and with no scrolling in
    // between, so they share one viewport origin.
    const stageBox = (await stage.boundingBox())!;
    const frameBox = (await frame.boundingBox())!;

    const topGap = frameBox.y - stageBox.y;
    const bottomGap = stageBox.y + stageBox.height - (frameBox.y + frameBox.height);
    // If the drag silently did nothing the frame is still centred, both mappings
    // still agree, and the assertions below would pass a mirrored build. Fail
    // loudly here instead of passing vacuously.
    expect(
      topGap,
      `the frame is still vertically centred (top ${topGap}, bottom ${bottomGap}) — the drag did not take, so this test proves nothing`,
    ).toBeLessThan(bottomGap / 2);

    // Screen pixels → PDF points, bottom-left origin. Derived from layout only.
    const expected = {
      x: ((frameBox.x - stageBox.x) / stageBox.width) * sheet.width,
      y:
        ((stageBox.y + stageBox.height - (frameBox.y + frameBox.height)) / stageBox.height) *
        sheet.height,
      width: (frameBox.width / stageBox.width) * sheet.width,
      height: (frameBox.height / stageBox.height) * sheet.height,
    };

    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `crop failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 5 });
    const boxes = await pageBoxes(bytes);
    expect(boxes).toHaveLength(5);

    /*
      ±4 pt. cropperjs rounds its box to whole NATURAL-image pixels
      (`getData(true)`), and this preview is rendered at ~1.68x, so one such
      pixel is ~0.6 pt; the rest is the CSS-pixel layout measurement above. The
      mirror this test exists to catch is off by `sheetHeight − y − height`,
      which on the frame drawn here is ~380 pt — two orders of magnitude clear
      of the tolerance.
    */
    for (const { crop } of boxes) {
      expect(Math.abs(crop.x - expected.x), `crop.x ${crop.x} vs ${expected.x}`).toBeLessThan(4);
      expect(Math.abs(crop.y - expected.y), `crop.y ${crop.y} vs ${expected.y}`).toBeLessThan(4);
      expect(Math.abs(crop.width - expected.width)).toBeLessThan(4);
      expect(Math.abs(crop.height - expected.height)).toBeLessThan(4);
    }

    // And state the asymmetry as an absolute fact about the output, so the
    // test still means something if the derivation above is ever loosened: the
    // frame was drawn against the TOP of the sheet, so the kept rectangle must
    // sit in the upper half of the page.
    expect(boxes[0].crop.y + boxes[0].crop.height).toBeGreaterThan(sheet.height * 0.9);
    expect(boxes[0].crop.y).toBeGreaterThan(sheet.height * 0.4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// change-pdf-page-size
// ────────────────────────────────────────────────────────────────────────────

test.describe("change-pdf-page-size — real output", () => {
  test("A4 in, Letter out, with the content scaled to fit", async ({ page }) => {
    await page.goto("/change-pdf-page-size");
    await uploadFixture(page, await SAMPLES.pdf());

    /*
      Poll the PAGE 1 NOW cell rather than waiting for "595 × 842 PT" to
      appear anywhere: the tool opens on A4, so its NEW SIZE cell already
      reads 595 × 842 PT before the pdfjs probe has measured anything, and a
      page-wide wait on that string passes against the wrong cell while the
      source is still "—".
    */
    await expect
      .poll(() => statValue(page, "PAGE 1 NOW"), { timeout: 90_000 })
      .toMatch(/\d+ × \d+ PT/);
    expect(parsePtLabel(await statValue(page, "PAGE 1 NOW"))).toEqual(A4);

    await page.getByRole("button", { name: "Letter", exact: true }).click();

    const action = primaryAction(page, /Resize to Letter/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `resize failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const scaled = await captureDownload(page, dl);

    expect(scaled.name).toBe("sample-doc-letter.pdf");
    await assertPdf(scaled.bytes, { pages: 5 });

    for (const { media, crop } of await pageBoxes(scaled.bytes)) {
      expect(media).toEqual({ width: 612, height: 792 });
      // The CropBox has to move too. `setSize()` only propagates to it when it
      // float-equals the MediaBox, so a page carrying a real CropBox would
      // keep the old sheet and the resize would be invisible in a viewer.
      expect(crop).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    }

    /*
      The scaled mode's defining artefact. s = min(612/595, 792/842) = 0.9406…,
      emitted as a single `cm` prefixed onto every page's content stream by
      `wrapContentStreams`. Its absence would mean the page box moved while the
      content stayed at its old size — the exact silent-wrong-output this mode
      exists to avoid.
    */
    const scaledText = await pdfOperatorText(scaled.bytes);
    expect(scaledText).toMatch(/0\.94\d+ 0 0 0\.94\d+ [\d.]+ 0 cm/);

    // ── The other half of the control: boxes only, content untouched ──
    await page.getByRole("button", { name: "Box only", exact: true }).click();
    await expect(downloadAffordance(page)).toHaveCount(0);

    const boxOnly = primaryAction(page, /Resize to Letter/);
    await expect(boxOnly).toBeEnabled();
    await boxOnly.click();

    const dl2 = downloadAffordance(page);
    await expect(dl2, `resize failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const unscaled = await captureDownload(page, dl2);

    await assertPdf(unscaled.bytes, { pages: 5 });
    for (const { media } of await pageBoxes(unscaled.bytes)) {
      expect(media).toEqual({ width: 612, height: 792 });
    }
    const unscaledText = await pdfOperatorText(unscaled.bytes);
    expect(
      unscaledText,
      "box-only must emit no page transform at all",
    ).not.toMatch(/0\.94\d+ 0 0 0\.94\d+ [\d.]+ 0 cm/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// pdf-resizer — two operations behind one dropped file
// ────────────────────────────────────────────────────────────────────────────

test.describe("pdf-resizer — real output", () => {
  test("resizes the sheet, then shrinks the file, without a second upload", async ({ page }) => {
    await page.goto("/pdf-resizer");
    const source = await SAMPLES.pdf();
    await uploadFixture(page, source);

    // ── Half one: the page dimensions ──
    // Poll the measured cell, not the page — see the note in the sibling spec.
    await expect
      .poll(() => statValue(page, "PAGE 1 NOW"), { timeout: 90_000 })
      .toMatch(/\d+ × \d+ PT/);
    expect(parsePtLabel(await statValue(page, "PAGE 1 NOW"))).toEqual(A4);

    await page.getByRole("button", { name: "Legal", exact: true }).click();
    const resize = primaryAction(page, /Resize to Legal/);
    await expect(resize).toBeEnabled();
    await resize.click();

    const dl = downloadAffordance(page);
    await expect(dl, `resize failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const resized = await captureDownload(page, dl);

    await assertPdf(resized.bytes, { pages: 5 });
    for (const { media, crop } of await pageBoxes(resized.bytes)) {
      expect(media).toEqual({ width: 612, height: 1008 });
      expect(crop).toEqual({ x: 0, y: 0, width: 612, height: 1008 });
    }

    // ── Half two: the file size, over the SAME dropped file ──
    await page.getByRole("button", { name: "File size", exact: true }).click();
    // No re-upload: the file is owned by the page, not by either half, so the
    // compressor half opens already holding the document.
    await expect(
      page.locator("[data-tool-surface]").getByText("sample-doc.pdf").first(),
    ).toBeVisible();

    const shrink = primaryAction(page, /^Shrink file$/);
    await expect(shrink).toBeEnabled();
    await shrink.click();

    const dl2 = downloadAffordance(page);
    await expect(dl2, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const shrunk = await captureDownload(page, dl2);

    expect(shrunk.name).toBe("sample-doc-compressed.pdf");
    // Structural-only compression: it may save nothing at all on a document
    // that is already packed, but it must never drop a page and must never
    // hand back MORE bytes than it was given.
    await assertPdf(shrunk.bytes, { pages: 5 });
    expect(shrunk.bytes.length).toBeLessThanOrEqual(source.buffer.length);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// pdf-to-text
// ────────────────────────────────────────────────────────────────────────────

test.describe("pdf-to-text — real output", () => {
  test("returns the text the document actually carries", async ({ page }) => {
    await page.goto("/pdf-to-text");
    await uploadFixture(page, await SAMPLES.pdf());

    const pane = page.locator('pre[aria-label="Extracted text"]');
    await expect(pane, `extraction failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    // Strings the fixture generator demonstrably draws onto every page.
    await expect(pane).toContainText("Transmute conversion fixture");
    await expect(pane).toContainText("The quick brown fox jumps over the lazy dog.");

    const dl = downloadAffordance(page);
    await expect(dl).toBeVisible({ timeout: 30_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-doc.txt");
    const text = bytes.toString("utf8");
    for (let i = 1; i <= 5; i++) {
      expect(text).toContain(`--- Page ${i} ---`);
      expect(text, `page ${i}'s heading`).toContain(`Page ${i}`);
    }
    // 24 numbered body lines per page × 5 pages, all present in file order.
    expect(text.match(/The quick brown fox jumps over the lazy dog\./g)?.length).toBe(120);
    expect(text.indexOf("--- Page 1 ---")).toBeLessThan(text.indexOf("--- Page 5 ---"));

    // Turning the markers off must re-join from the per-page text rather than
    // re-extract, and the markers must genuinely leave the output.
    await page.getByLabel("Mark where each page starts").uncheck();
    await expect(pane).not.toContainText("--- Page 2 ---");
    const plain = await captureDownload(page, downloadAffordance(page));
    expect(plain.bytes.toString("utf8")).not.toContain("--- Page");
    expect(plain.bytes.toString("utf8")).toContain(
      "The quick brown fox jumps over the lazy dog.",
    );
  });

  test("a document of images says plainly that there is no text layer", async ({ page }) => {
    /*
      The honesty path. There is no OCR here, so a scan yields nothing, and the
      tool has to say what happened rather than presenting an empty result as a
      successful one.
    */
    await page.goto("/pdf-to-text");
    await uploadFixture(page, await imageOnlyPdf(2));

    const surface = page.locator("[data-tool-surface]");
    await expect(
      surface.getByText(/all 2 of its pages are scans or images/),
      `extraction failed: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 90_000 });
    await expect(surface.getByText(/it does not run OCR/)).toBeVisible();

    // No text pane and no inline Copy/Download over an empty extraction.
    await expect(page.locator('pre[aria-label="Extracted text"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);

    // And the offered alternative is a real page, not a dead end.
    await expect(surface.getByRole("link", { name: "PDF to JPG" })).toHaveAttribute(
      "href",
      "/pdf-to-jpg",
    );
  });

  test("a document of images offers nothing to save", async ({ page }) => {
    /*
      REGRESSION GUARD for a defect this spec found and PdfToTextUI then fixed.

      `PdfToTextUI`'s footer gates its DownloadButton on the folded `text`
      string. With page markers on (the default) that string used to be
      `joinPdfPages(pages)`, and `joinPdfPages` deliberately emits a bare
      `--- Page N ---` line for every EMPTY page — so a document with no text
      layer at all folded to a non-empty string made entirely of separators,
      and the tool offered `Download scanned-pages.txt` carrying exactly 30
      bytes: "--- Page 1 ---\n\n--- Page 2 ---". The canvas meanwhile hid the
      pane and said nothing came out, so the file could not even be previewed
      before it was saved.

      The fix empties `text` when every page is empty, at the single place the
      gates read it. Without that, this test fails on the download count.
    */
    await page.goto("/pdf-to-text");
    await uploadFixture(page, await imageOnlyPdf(2));

    const surface = page.locator("[data-tool-surface]");
    await expect(
      surface.getByText(/all 2 of its pages are scans or images/),
      `extraction failed: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 90_000 });

    await expect(downloadAffordance(page)).toHaveCount(0);
    // The header's character count must report the truth too — it used to
    // count the separators the download was made of.
    await expect(surface.getByText("0 CHARACTERS")).toBeVisible();
  });
});
