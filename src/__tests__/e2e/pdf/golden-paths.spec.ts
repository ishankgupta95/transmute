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

    // Use the page-range field to select page 2.
    await page.getByPlaceholder(/1-3, 5, 8-10/).fill("2");
    await page.getByRole("button", { name: "Apply" }).click();

    await page.getByRole("button", { name: /Extract 1 page/ }).click();
    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toBe("split.pdf");
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("images-to-pdf: 2 images → multi-page PDF", async ({ page }) => {
    await page.goto("/images-to-pdf");
    await uploadFile(page, [tinyPng(64), tinyJpg()]);

    await page.getByRole("button", { name: /Create PDF \(2 images\)/ }).click();

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
    await page.getByRole("button", { name: /Add Page Numbers/ }).click();
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
});
