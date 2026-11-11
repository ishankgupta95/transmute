import { test, expect, type Page } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPdf, tinyPng, tinyJpg } from "../fixtures";
import { expectPdfPages } from "../conversion/fidelity";

/**
 * PDF tools rely on pdf-lib (documents and pages) and pdfjs (rendering)
 * running in the browser. Tests upload programmatically generated tiny PDFs
 * (via pdf-lib in Node) so we never depend on a checked-in PDF blob.
 *
 * Every page of a `tinyPdf` draws "Page N", so each page-picking tool here
 * checks WHICH pages came back (`expectPdfPages`), not only that the download
 * starts `%PDF-` — a "page 2" extract that held page 1 used to pass. Deeper
 * checks (page boxes, archive members, metadata) live in the opt-in
 * conversion suite: `conversion/pdf.spec.ts` and `conversion/pdf-pages.spec.ts`.
 *
 * Tools that thumbnail every page (split, extract, delete, rotate, reorder)
 * take measurably longer than the others because they paint a JPEG canvas per
 * page; crop and the page-size tools render page 1 at a readable scale before
 * their primary becomes usable. For a 2- or 3-page sample every one of those
 * waits is well under our default timeout.
 */

test.describe("PDF golden paths", () => {
  test("merge-pdf: 2 single-page PDFs in → 1 PDF (downloads merged.pdf)", async ({
    page,
  }) => {
    await page.goto("/merge-pdf");

    const pdfA = await tinyPdf(1, "a.pdf");
    const pdfB = await tinyPdf(1, "b.pdf");
    await uploadFile(page, [pdfA, pdfB]);

    // Both entries appear as draggable rows.
    await expect(page.getByText("a.pdf")).toBeVisible();
    await expect(page.getByText("b.pdf")).toBeVisible();

    await page.getByRole("button", { name: /Merge PDFs/i }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("merged.pdf");

    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // Merged output should be larger than either input — sanity check.
    expect(bytes.length).toBeGreaterThan(Math.max(pdfA.buffer.length, pdfB.buffer.length));
  });

  test("split-pdf: extract page 2 from a 3-page PDF", async ({ page }) => {
    await page.goto("/split-pdf");
    const pdf = await tinyPdf(3);
    await uploadFile(page, pdf);

    // Wait for the page count to be read off the file.
    await expect(page.getByText(/3 PAGES/)).toBeVisible({ timeout: 15_000 });

    // Use the page-range field to select page 2. `RangeField` commits on
    // Enter or blur — there is no longer a separate Apply button.
    await page.getByLabel("Page range").fill("2");
    await page.getByLabel("Page range").press("Enter");

    await page.getByRole("button", { name: /Extract 1 page/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("split.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await expectPdfPages(bytes, [2], "split.pdf");
  });

  test("images-to-pdf: 2 images → multi-page PDF", async ({ page }) => {
    await page.goto("/images-to-pdf");
    await uploadFile(page, [tinyPng(64), tinyJpg()]);

    await page.getByRole("button", { name: /^Create PDF$/ }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("images.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("rotate-pdf: rotates every selected page", async ({ page }) => {
    await page.goto("/rotate-pdf");
    const pdf = await tinyPdf(2);
    await uploadFile(page, pdf);

    // The action button label "Rotate N pages" only appears once the file
    // has loaded and pages are auto-selected. Using it as the wait condition
    // sidesteps the "2 pages" / "Rotate 2 pages" strict-mode collision.
    const rotateBtn = page.getByRole("button", { name: /^Rotate 2 pages?$/ });
    await expect(rotateBtn).toBeVisible({ timeout: 15_000 });
    await rotateBtn.click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/-rotated\.pdf$/);
    const bytes = await downloadBytes(download);
    // The rotation is in the file, on every page, and the pages are unchanged.
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(new Uint8Array(bytes));
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90]);
    await expectPdfPages(bytes, [1, 2], "rotated");
  });

  test("add-page-numbers: stamps a number on every page", async ({ page }) => {
    await page.goto("/add-page-numbers");
    const pdf = await tinyPdf(3);
    await uploadFile(page, pdf);
    await page.getByRole("button", { name: /Add page numbers/i }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/-numbered\.pdf$/);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await expectPdfPages(bytes, [1, 2, 3], "numbered");
  });

  test("compress-pdf: round-trips a valid PDF (compression auto-starts on upload)", async ({
    page,
  }) => {
    await page.goto("/compress-pdf");
    // pdf-lib's own output is already minimal, so the structural rewrite has
    // nothing to win here and can come back LARGER. This pins that a
    // "compressor" never hands back more bytes than it was given: the UI ships
    // the smaller of the rewrite and the original.
    const pdf = await tinyPdf(2);
    await uploadFile(page, pdf);

    // The download button appears once compression completes — no button to
    // click to start the pipeline.
    const { suggestedFilename, download } = await waitForDownload(
      page,
      async () => {
        await downloadButton(page).waitFor({ state: "visible", timeout: 60_000 });
        await downloadButton(page).click();
      },
      60_000,
    );
    expect(suggestedFilename).toMatch(/-compressed\.pdf$/);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(
      bytes.length,
      "compress must never return a file larger than the upload",
    ).toBeLessThanOrEqual(pdf.buffer.length);
  });

  test("pdf-to-jpg: rasterises every page and downloads JPEG bytes", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/pdf-to-jpg");
    const pdf = await tinyPdf(2);
    await uploadFile(page, pdf);

    await page.getByRole("button", { name: /Convert to images/i }).click();

    // Rasterisation finished when the deck has a tile per page. (The old
    // "N pages converted" label was replaced by the page deck + stat strip.)
    await expect(page.locator('[aria-label^="Download page "]')).toHaveCount(2, {
      timeout: 30_000,
    });

    // Multi-file output is bundled into a single ZIP — firing N downloads in
    // one loop got them throttled, which is why only the first ever arrived.
    const { suggestedFilename, download } = await waitForDownload(
      page,
      page.getByRole("button", { name: /Download all \(ZIP\)/i }),
      30_000,
    );
    expect(suggestedFilename).toMatch(/\.zip$/i);
    const bytes = await downloadBytes(download);
    // ZIP local file header.
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  test("pdf-page-reorder: loads pages, allows save, and downloads a reordered PDF", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/pdf-page-reorder");
    const pdf = await tinyPdf(3);
    await uploadFile(page, pdf);

    // The header reports the page count and the drag hint as separate
    // elements since the canvas port.
    await expect(page.getByText(/3 PAGES/).first()).toBeVisible({ timeout: 30_000 });
    // Scoped to the canvas header — the sibling-tool rail also describes
    // Merge PDF as "Drag to reorder". The deck is keyboard-operable too, so
    // the hint names both paths.
    await expect(page.getByText("DRAG OR USE ← →", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: /Save Reordered PDF/, exact: true })
      .click();

    const { suggestedFilename, download } = await waitForDownload(
      page,
      downloadButton(page),
      30_000,
    );
    expect(suggestedFilename).toMatch(/-reordered\.pdf$/);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("extract-pdf-pages: page 2 of a 3-page PDF → one document", async ({ page }) => {
    await page.goto("/extract-pdf-pages");
    await uploadFile(page, await tinyPdf(3));

    // Nothing is preselected here — unlike split-pdf, this tool opens empty.
    await expect(page.getByText("0 PAGES SELECTED")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Page range").fill("2");
    await page.getByLabel("Page range").press("Enter");

    await page.getByRole("button", { name: /Extract 1 page/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("extracted-pages.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await expectPdfPages(bytes, [2], "extracted-pages.pdf");
  });

  test("extract-pdf-pages: a one-page per-page run saves the page, not an archive", async ({
    page,
  }) => {
    /*
      `downloadFilesAsZip` hands a single file over bare rather than zipping
      one member, so the readout and the download have to agree that a
      one-page selection in per-page mode saves `page-2.pdf`. Promising an
      archive here and then saving a PDF is the kind of mismatch this suite
      exists to catch.
    */
    await page.goto("/extract-pdf-pages");
    await uploadFile(page, await tinyPdf(3));
    await expect(page.getByText("0 PAGES SELECTED")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "One per page", exact: true }).click();
    await page.getByRole("button", { name: /^Page 2(,|$)/ }).first().click();
    await expect(
      page.locator("[data-tool-surface]").getByText(/downloads on its own rather than in a ZIP/),
    ).toBeVisible();

    await page.getByRole("button", { name: /Extract 1 page/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("page-2.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await expectPdfPages(bytes, [2], "page-2.pdf");
  });

  test("delete-pdf-pages: removes page 2 of a 3-page PDF", async ({ page }) => {
    await page.goto("/delete-pdf-pages");
    await uploadFile(page, await tinyPdf(3));

    await expect(page.getByText("0 PAGES WILL BE REMOVED")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Page range").fill("2");
    await page.getByLabel("Page range").press("Enter");
    await expect(page.getByText("1 PAGES WILL BE REMOVED")).toBeVisible();

    await page.getByRole("button", { name: /^Delete 1 page$/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("pages-removed.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // Page 2 went; 1 and 3 stayed.
    await expectPdfPages(bytes, [1, 3], "pages-removed.pdf");
  });

  test("crop-pdf: renders page 1, then crops every page", async ({ page }) => {
    await page.goto("/crop-pdf");
    await uploadFile(page, await tinyPdf(2));

    // The primary stays disabled until page 1 has rendered — there is no crop
    // box to read before that, so an enabled button would silently do nothing.
    const crop = page.getByRole("button", { name: /^Crop 2 pages$/ });
    await expect(crop).toBeEnabled({ timeout: 30_000 });
    await crop.click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("sample-cropped.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("change-pdf-page-size: reshapes every page to the chosen sheet", async ({ page }) => {
    await page.goto("/change-pdf-page-size");
    await uploadFile(page, await tinyPdf(2));

    const resize = page.getByRole("button", { name: /^Resize to A4$/ });
    await expect(resize).toBeEnabled({ timeout: 30_000 });
    await resize.click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("sample-a4.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("pdf-resizer: the file-size half shrinks without a second upload", async ({ page }) => {
    await page.goto("/pdf-resizer");
    const pdf = await tinyPdf(2);
    await uploadFile(page, pdf);

    // Opens on the page-dimension half; the switch is the tool's whole point.
    await expect(page.getByRole("button", { name: /^Resize to A4$/ })).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "File size", exact: true }).click();

    await page.getByRole("button", { name: /^Shrink file$/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page), 30_000);
    expect(suggestedFilename).toBe("sample-compressed.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    // The smaller of the rewrite and the original ships, so this can never
    // hand back more bytes than it was given.
    expect(bytes.length).toBeLessThanOrEqual(pdf.buffer.length);
  });

  test("pdf-to-text: extraction starts on drop and saves a .txt", async ({ page }) => {
    await page.goto("/pdf-to-text");
    await uploadFile(page, await tinyPdf(2));

    // No convert button — `handleFiles` extracts as soon as the file lands.
    const pane = page.locator('pre[aria-label="Extracted text"]');
    await expect(pane).toBeVisible({ timeout: 30_000 });
    await expect(pane).toContainText("Page 1");
    await expect(pane).toContainText("--- Page 2 ---");

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("sample.txt");
    const bytes = await downloadBytes(download);
    expect(bytes.toString("utf8")).toContain("Page 2");
  });
});


/**
 * Every one of these tools swaps its primary action out for a Download the
 * moment a run finishes. So an input change after a run must drop the result
 * too — otherwise the readouts describe the new settings while the only
 * button on screen still hands over the old bytes, with no way to re-run.
 * (merge-pdf's equivalent lives in conversion/hardening.spec.ts.)
 */
test.describe("PDF stale-result invalidation", () => {
  const downloadGone = async (page: Page) =>
    expect(downloadButton(page)).toHaveCount(0);

  test("rotate-pdf: changing the angle or the selection drops the stale file", async ({
    page,
  }) => {
    await page.goto("/rotate-pdf");
    await uploadFile(page, await tinyPdf(2));

    const rotate = page.getByRole("button", { name: /^Rotate 2 pages$/ });
    await expect(rotate).toBeVisible({ timeout: 15_000 });
    await rotate.click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "180°" }).click();
    await downloadGone(page);
    await expect(rotate).toBeVisible();

    await rotate.click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Deselect all" }).click();
    await downloadGone(page);
  });

  test("split-pdf: changing the selection drops the stale file", async ({ page }) => {
    await page.goto("/split-pdf");
    await uploadFile(page, await tinyPdf(3));
    await expect(page.getByText(/3 PAGES/).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await page.getByRole("button", { name: /Extract 3 pages/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /^Page 1(,|$)/ }).first().click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /Extract 2 pages/ })).toBeVisible();
  });

  test("split-pdf: an unparseable range keeps the text and says why", async ({ page }) => {
    await page.goto("/split-pdf");
    await uploadFile(page, await tinyPdf(3));
    await expect(page.getByText(/3 PAGES/).first()).toBeVisible({ timeout: 15_000 });

    const range = page.getByLabel("Page range");
    await range.fill("1-2");
    await range.press("Enter");
    await expect(page.getByText("2 PAGES SELECTED")).toBeVisible();

    // Blanking both the field and the selection was indistinguishable from
    // the tool having eaten the input.
    await range.fill("banana");
    await range.press("Enter");
    await expect(range).toHaveValue("banana");
    await expect(page.getByText(/No pages matched "banana"/)).toBeVisible();
    await expect(page.getByText("2 PAGES SELECTED")).toBeVisible();
  });

  test("images-to-pdf: changing the page size drops the stale file", async ({ page }) => {
    await page.goto("/images-to-pdf");
    await uploadFile(page, [tinyPng(64), tinyJpg()]);
    await page.getByRole("button", { name: /^Create PDF$/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Letter", exact: true }).click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /^Create PDF$/ })).toBeVisible();
  });

  test("add-page-numbers: changing the corner drops the stale file", async ({ page }) => {
    await page.goto("/add-page-numbers");
    await uploadFile(page, await tinyPdf(2));
    await page.getByRole("button", { name: /Add page numbers/i }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "TR", exact: true }).click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /Add page numbers/i })).toBeVisible();
  });

  test("pdf-to-jpg: the readouts describe what was rendered, not the live controls", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/pdf-to-jpg");
    await uploadFile(page, await tinyPdf(2));
    await page.getByRole("button", { name: /Convert to images/i }).click();
    await expect(page.locator('[aria-label^="Download page "]')).toHaveCount(2, {
      timeout: 30_000,
    });

    // Clicking PNG used to relabel the existing JPEGs as PNG while the ZIP
    // still held page-N.jpg, with no way to re-run.
    await page.getByRole("button", { name: "PNG", exact: true }).click();
    await expect(page.getByRole("button", { name: /Download all \(ZIP\)/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Convert to images/i })).toBeVisible();
    await expect(
      page.getByText("FORMAT", { exact: true }).first().locator(".."),
    ).toContainText("JPG");
  });

  test("extract-pdf-pages: changing the output mode drops the stale file", async ({ page }) => {
    await page.goto("/extract-pdf-pages");
    await uploadFile(page, await tinyPdf(3));
    await expect(page.getByText("0 PAGES SELECTED")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await page.getByRole("button", { name: /Extract 3 pages/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    // The mode decides how many files come out, so it invalidates a finished
    // run exactly as hard as the selection does — otherwise the footer offers
    // the previous mode's download under the new mode's readout.
    await page.getByRole("button", { name: "One per page", exact: true }).click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /Download all \(ZIP\)/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Extract 3 pages/ })).toBeVisible();
  });

  test("delete-pdf-pages: changing the selection drops the stale file", async ({ page }) => {
    await page.goto("/delete-pdf-pages");
    await uploadFile(page, await tinyPdf(3));
    await expect(page.getByText("0 PAGES WILL BE REMOVED")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Page 1, will be kept" }).click();
    await page.getByRole("button", { name: /^Delete 1 page$/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Page 3, will be kept" }).click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /^Delete 2 pages$/ })).toBeVisible();
  });

  test("crop-pdf: changing the crop frame drops the stale file", async ({ page }) => {
    await page.goto("/crop-pdf");
    await uploadFile(page, await tinyPdf(2));

    const crop = page.getByRole("button", { name: /^Crop 2 pages$/ });
    await expect(crop).toBeEnabled({ timeout: 30_000 });
    await crop.click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    // Locking the aspect ratio resizes the frame, which fires cropperjs's own
    // `crop` event — the one place this tool learns the box changed.
    await page.getByRole("button", { name: "1:1", exact: true }).click();
    await downloadGone(page);
    await expect(crop).toBeVisible();
  });

  test("change-pdf-page-size: changing the sheet drops the stale file", async ({ page }) => {
    await page.goto("/change-pdf-page-size");
    await uploadFile(page, await tinyPdf(2));

    const resize = page.getByRole("button", { name: /^Resize to A4$/ });
    await expect(resize).toBeEnabled({ timeout: 30_000 });
    await resize.click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Legal", exact: true }).click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /^Resize to Legal$/ })).toBeVisible();

    // The content control changes the bytes just as much as the sheet does.
    await page.getByRole("button", { name: /^Resize to Legal$/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Box only", exact: true }).click();
    await downloadGone(page);
  });

  test("pdf-resizer: switching halves drops the stale file but keeps the PDF", async ({
    page,
  }) => {
    await page.goto("/pdf-resizer");
    await uploadFile(page, await tinyPdf(2));

    await page.getByRole("button", { name: "File size", exact: true }).click();
    await page.getByRole("button", { name: /^Shrink file$/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    // A compressed file is not an answer to "make the pages A4", so flipping
    // halves has to drop it — while the dropped PDF itself survives, which is
    // the entire reason the two live on one page.
    await page.getByRole("button", { name: "Page size", exact: true }).click();
    await downloadGone(page);
    await expect(page.getByRole("button", { name: /^Resize to A4$/ })).toBeEnabled({
      timeout: 30_000,
    });
    await expect(page.locator("[data-tool-surface]").getByText("sample.pdf").first()).toBeVisible();
  });
});

/**
 * Reordering is the entire point of /pdf-page-reorder, and HTML5 drag never
 * fires from a finger and never reaches a keyboard. The deck is a listbox of
 * focusable options with an arrow-key mover and an on-screen fallback.
 */
test.describe("pdf-page-reorder — keyboard and touch access", () => {
  test("arrow keys move the focused page, and the Move buttons do too", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/pdf-page-reorder");
    await uploadFile(page, await tinyPdf(3));

    const deck = page.getByRole("listbox", { name: "Page order" });
    await expect(deck).toBeVisible({ timeout: 30_000 });
    await expect(deck.getByRole("option")).toHaveCount(3);

    await page.locator('[aria-label="Page 1, position 1 of 3"]').focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[aria-label="Page 1, position 2 of 3"]')).toBeVisible();
    // Scoped to the tool surface: the page's FAQ copy repeats the phrase.
    await expect(page.locator("[data-tool-surface]").getByText("ORDER CHANGED")).toBeVisible();

    // Focus follows the page it moved, so a second press keeps moving it.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[aria-label="Page 1, position 3 of 3"]')).toBeVisible();

    await page.getByRole("button", { name: "Move left" }).click();
    await expect(page.locator('[aria-label="Page 1, position 2 of 3"]')).toBeVisible();

    await page.getByRole("button", { name: /Save Reordered PDF/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 30_000 });

    // A further move invalidates the saved file.
    await page.getByRole("button", { name: "Move right" }).click();
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save Reordered PDF/ })).toBeVisible();
  });
});
