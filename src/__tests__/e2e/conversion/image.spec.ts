import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeImageInPage,
  toolError,
} from "./support";
import { assertJpeg, assertPng, hasExifSegment } from "./validators";

/**
 * Image pipelines run on canvas + pica, neither of which exists in jsdom, so
 * the unit suite never exercises them. These drive the real 800x600 JPEG
 * fixture and decode whatever comes back out.
 */

test.describe("image conversions — real output", () => {
  test("resize-image produces an image at the requested width", async ({ page }) => {
    await page.goto("/resize-image");
    await uploadFixture(page, await SAMPLES.jpg());

    // Width is the first number input in DIMENSIONS; aspect lock is on by
    // default, so height should follow from the 4:3 source.
    const width = page.locator('input[type="number"]').first();
    await expect(width).toBeVisible();
    await width.fill("400");
    await width.blur();

    await primaryAction(page, /^Resize$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `resize failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    assertJpeg(bytes);
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(300); // 800x600 locked to 400 wide
  });

  test("compress-image returns a smaller, still-decodable image", async ({ page }) => {
    const jpg = await SAMPLES.jpg();
    await page.goto("/compress-image");
    await uploadFixture(page, jpg);

    await primaryAction(page, /^Compress$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    assertJpeg(bytes);
    // ≤, not <: when re-encoding would GROW the file (Safari's encoder does
    // this to already-optimised JPEGs) the tool now returns the original —
    // never-bigger is the invariant, shrinking is the usual outcome.
    expect(bytes.length, "compression must never grow the file")
      .toBeLessThanOrEqual(jpg.buffer.length);
    // Dimensions must survive compression — only quality should change.
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  test("crop-image emits a genuinely cropped image", async ({ page }) => {
    await page.goto("/crop-image");
    await uploadFixture(page, await SAMPLES.jpg());

    await primaryAction(page, /^Crop$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `crop failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { name, bytes } = await captureDownload(page, dl);

    // `cropImage` always re-encodes to lossless PNG regardless of input type —
    // deliberate, and pinned by src/__tests__/unit/lib/image-crop.test.ts.
    expect(name).toMatch(/\.png$/);
    const png = assertPng(bytes);
    const dims = await probeImageInPage(page, bytes, "image/png");
    expect(dims).toEqual({ width: png.width, height: png.height });
    // Cropper's default box is inset, so output must not exceed the source.
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.width).toBeLessThanOrEqual(800);
    expect(dims.height).toBeGreaterThan(0);
    expect(dims.height).toBeLessThanOrEqual(600);
  });

  test("exif-viewer reads GPS and strips it on demand", async ({ page }) => {
    const jpg = await SAMPLES.jpg();
    await page.goto("/exif-viewer");
    await uploadFixture(page, jpg);

    // The fixture carries Make/Model, capture settings and GPS.
    await expect(page.getByText("Transmute", { exact: false }).first())
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Contains location data/i)).toBeVisible();

    expect(hasExifSegment(jpg.buffer), "fixture must start with EXIF").toBe(true);

    await primaryAction(page, /Remove EXIF/i).click();

    const dl = downloadAffordance(page);
    await expect(dl, `strip failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    assertJpeg(bytes);
    expect(hasExifSegment(bytes), "stripped output must not carry an Exif APP1 segment")
      .toBe(false);
    // Stripping metadata must not damage the image itself.
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 800, height: 600 });
  });
});
