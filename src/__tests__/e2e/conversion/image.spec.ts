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

  test("compress-image in target-size mode actually shrinks the file", async ({ page }) => {
    /*
      The test above pins the never-grow invariant with `<=`, which a
      compressor that did nothing at all would also satisfy — verified by
      mutation: forcing the worker's compress path to always return the
      original left that assertion green. This one drives target-size mode at a
      target well under the source and requires a STRICTLY smaller result, so
      "compression happened" is asserted somewhere.
    */
    const jpg = await SAMPLES.jpg();
    await page.goto("/compress-image");
    await uploadFixture(page, jpg);

    await page.getByRole("button", { name: "Target size", exact: true }).click();
    const target = page.getByLabel("Target file size in KB");
    await target.fill("20");
    await target.blur();

    await primaryAction(page, /^Compress$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    assertJpeg(bytes);
    expect(
      bytes.length,
      "target-size compression must produce a strictly smaller file",
    ).toBeLessThan(jpg.buffer.length);
    // Only quality should change — the binary search must not resize.
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  test("compress-image reaches a tiny KB target by scaling down", async ({ page }) => {
    /*
      The dimension-stepping half of the target-size engine. A large
      per-pixel-noise JPEG cannot reach 20 KB at ANY quality while it stays
      at source dimensions (JPEG overhead scales with pixel count — 12 MP at
      20 KB would be ~0.002 bytes/px, below even an all-flat encode), so a
      green run proves the engine genuinely stepped the dimensions down, told
      the user, and still delivered a decodable JPEG under the ceiling.

      The fixture is synthesised in-page (batch.spec.ts pattern): a canvas
      this size is cheap to build in the browser and would be megabytes to
      check in.
    */
    const SRC_W = 4000;
    const SRC_H = 3000;
    await page.goto("/compress-image");
    await page.locator('input[type="file"]').first().waitFor({ state: "attached" });
    await page.evaluate(
      async ({ w, h }: { w: number; h: number }) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        const img = ctx.createImageData(w, h);
        const d = img.data;
        // Per-pixel random RGB: incompressible detail at every quality, so
        // only a downscale can reach a tiny byte target.
        for (let i = 0; i < d.length; i += 4) {
          d[i] = (Math.random() * 256) | 0;
          d[i + 1] = (Math.random() * 256) | 0;
          d[i + 2] = (Math.random() * 256) | 0;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.95));
        const file = new File([blob!], "noise.jpg", { type: "image/jpeg" });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { w: SRC_W, h: SRC_H },
    );

    await page.getByRole("button", { name: "Target size", exact: true }).click();
    const target = page.getByLabel("Target file size in KB");
    await target.fill("20");
    await target.blur();

    await primaryAction(page, /^Compress$/).click();

    // Stepping re-runs the quality search per size level over a 12 MP source,
    // so this legitimately takes longer than the plain compress cases.
    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });

    // The engine must SAY it changed the picture, in the exact shared wording.
    await expect(page.getByText(/Scaled to \d+×\d+ to reach the target size\./)).toBeVisible();

    const { bytes } = await captureDownload(page, dl);
    assertJpeg(bytes);
    expect(bytes.length, "output must be at or under the 20 KB target").toBeLessThanOrEqual(
      20 * 1024,
    );
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims.width, "stepping must have reduced the width").toBeLessThan(SRC_W);
    expect(dims.height, "stepping must have reduced the height").toBeLessThan(SRC_H);
    // Sanity: still a real picture, not a floor-sized thumbnail of nothing.
    expect(dims.width).toBeGreaterThanOrEqual(64);
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
    // Scoped to the tool surface: the page's FAQ copy repeats the phrase.
    await expect(
      page.locator("[data-tool-surface]").getByText(/Contains location data/i),
    ).toBeVisible();

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
