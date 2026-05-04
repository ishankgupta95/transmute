import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPng, tinyJpg, tinyWebp, tinyBmp } from "../fixtures";

/**
 * Golden-path coverage for image converters. We hit one concrete pair per
 * source format the converter UI accepts; the unit tests already enforce that
 * every entry in `tools.ts` resolves and renders, so we don't need to
 * exhaustively iterate here.
 *
 * Format pairs that require heavyweight decoders (HEIC via heic2any, TIFF via
 * utif2, AVIF via canvas) are exercised in `converters-heavy.spec.ts` so they
 * can be sharded / skipped independently.
 */

test.describe("image converters — lightweight pairs", () => {
  test("PNG → JPG produces a JPEG download", async ({ page }) => {
    await page.goto("/png-to-jpg");
    await uploadFile(page, tinyPng(16));
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.jpe?g$/i);
    const bytes = await downloadBytes(download);
    // JPEG SOI marker
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  test("JPG → PNG produces a PNG download", async ({ page }) => {
    await page.goto("/jpg-to-png");
    await uploadFile(page, tinyJpg());
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.png$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("WebP → JPG produces a JPEG download", async ({ page }) => {
    await page.goto("/webp-to-jpg");
    await uploadFile(page, tinyWebp());
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.jpe?g$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  test("WebP → PNG produces a PNG download", async ({ page }) => {
    await page.goto("/webp-to-png");
    await uploadFile(page, tinyWebp());
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.png$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("PNG → WebP produces a WebP download", async ({ page }) => {
    await page.goto("/png-to-webp");
    await uploadFile(page, tinyPng(16));
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.webp$/i);
    const bytes = await downloadBytes(download);
    // RIFF...WEBP marker
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  test("JPG → WebP produces a WebP download", async ({ page }) => {
    await page.goto("/jpg-to-webp");
    await uploadFile(page, tinyJpg());
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.webp$/i);
  });

  test("BMP → JPG produces a JPEG download", async ({ page }) => {
    await page.goto("/bmp-to-jpg");
    await uploadFile(page, tinyBmp());
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.jpe?g$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
  });
});
