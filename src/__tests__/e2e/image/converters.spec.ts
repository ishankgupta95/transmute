import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPng, tinyJpg, tinyWebp, tinyBmp, tinySvg } from "../fixtures";

/**
 * Golden-path coverage for image converters. We hit one concrete pair per
 * source format the converter UI accepts; the unit tests already enforce that
 * every entry in `tools.ts` resolves and renders, so we don't need to
 * exhaustively iterate here.
 *
 * Heavy decoders (HEIC via heic2any, TIFF via utif2, AVIF via the Chromium
 * AVIF decoder) cannot be exercised end-to-end without shipping binary
 * fixtures we don't keep in-tree. Those slugs get a smoke test that confirms
 * the page renders and the dropzone accepts the right MIME — the conversion
 * code itself is covered by the unit suite.
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

  test("SVG → PNG rasterises a vector input to a valid PNG download", async ({ page }) => {
    await page.goto("/svg-to-png");
    await uploadFile(page, tinySvg());
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.png$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});

test.describe("image converters — page smoke (binary-fixture-required formats)", () => {
  // HEIC/TIFF/AVIF inputs are not synthesisable in Node without shipping a
  // binary fixture. The unit suite covers the conversion code; here we just
  // confirm the page wires up correctly so a regression that breaks the route
  // or the dropzone accept attribute is caught.
  for (const { slug, accept } of [
    { slug: "heic-to-jpg", accept: ".heic,.heif" },
    { slug: "tiff-to-jpg", accept: ".tiff,.tif" },
    { slug: "avif-to-jpg", accept: ".avif" },
  ]) {
    test(`${slug} renders with H1 and a dropzone that accepts ${accept}`, async ({ page }) => {
      await page.goto(`/${slug}`);
      await expect(page.locator("h1")).toHaveCount(1);
      const fileInput = page.locator('input[type="file"]').first();
      await expect(fileInput).toBeAttached();
      // The DropZone forwards `accept` straight to the underlying input.
      await expect(fileInput).toHaveAttribute("accept", accept);
    });
  }
});
