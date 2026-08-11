import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPdf, tinyPng, tinyJpg } from "../fixtures";

/**
 * PDF tools rely on MuPDF / pdf-lib / pdfjs running in the browser. Tests
 * upload programmatically generated tiny PDFs (via pdf-lib in Node) so we
 * never depend on a checked-in PDF blob.
 *
 * Tools that thumbnail every page (split, rotate, reorder) take measurably
 * longer than the others because they paint a JPEG canvas per page; for a
 * 3-page sample the wait is well under our default timeout.
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
    await expect(page.getByText(/3 pages/)).toBeVisible({ timeout: 15_000 });

    // Use the page-range field to select page 2. `RangeField` commits on
    // Enter or blur — there is no longer a separate Apply button.
    await page.getByLabel("Page range").fill("2");
    await page.getByLabel("Page range").press("Enter");

    await page.getByRole("button", { name: /Extract 1 page/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("split.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
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

    const { suggestedFilename } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/-rotated\.pdf$/);
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
  });

  test("compress-pdf: round-trips a valid PDF (compression auto-starts on upload)", async ({
    page,
  }) => {
    await page.goto("/compress-pdf");
    // pdf-lib output is already minimal; we just assert it round-trips.
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
    await expect(page.getByText(/3 pages/).first()).toBeVisible({ timeout: 30_000 });
    // Scoped to the canvas header — the sibling-tool rail also describes
    // Merge PDF as "Drag to reorder".
    await expect(page.getByText("DRAG TO REORDER", { exact: true })).toBeVisible();

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
});
