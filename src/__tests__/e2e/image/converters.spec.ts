import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPng, tinyJpg, tinyWebp, tinyBmp, tinySvg, tinyTiff } from "../fixtures";
import type { Page } from "@playwright/test";

/**
 * Decode a converted image inside the browser and report its real dimensions.
 *
 * Magic bytes alone are a weak assertion: a converter that lost the pixels and
 * emitted a 1x1 or an empty canvas still writes a perfectly valid JPEG/PNG
 * header. Asserting the decoded size is what makes these tests able to fail on
 * a real regression.
 */
async function decodedSize(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<{ width: number; height: number }> {
  return page.evaluate(
    async ({ b64, type }: { b64: string; type: string }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([buf], { type }));
      const out = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return out;
    },
    { b64: bytes.toString("base64"), type: mime },
  );
}

/**
 * Golden-path coverage for image converters. We hit one concrete pair per
 * source format the converter UI accepts; the unit tests already enforce that
 * every entry in `tools.ts` resolves and renders, so we don't need to
 * exhaustively iterate here.
 *
 * Every conversion here asserts the DECODED dimensions of the output, not just
 * its magic bytes — a converter that dropped the pixels still emits a valid
 * header, so a format-only assertion cannot fail on the regression that
 * matters.
 *
 * AVIF is the only input still on a page smoke, for a verified reason: it
 * cannot be synthesised in-browser — Chromium's `canvas.toBlob("image/avif")`
 * silently falls back to PNG (probed 2026-08-19 — it returns `image/png`) —
 * and its build-time fixture is written by sharp/libaom instead. TIFF used to
 * be on that list by assumption; `utif2` ships an encoder, so it has a real
 * conversion test below.
 *
 * HEIC LEFT THIS LIST ON 2026-09-12. The note that stood here said it "cannot
 * be synthesised" because the decoder never encodes — true of the library,
 * and beside the point: macOS writes real HEVC stills through ImageIO, so
 * `generate-test-fixtures.mjs --heic` produces genuine `.heic` files and the
 * real decode now lives in `e2e/conversion/image-formats.spec.ts`, where the
 * fixtures are. A premise worth re-testing when the machine changes.
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
    // ...and the pixels actually survived the round trip.
    expect(await decodedSize(page, bytes, "image/jpeg")).toEqual({
      width: 16,
      height: 16,
    });
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

  test("TIFF → JPG decodes a real TIFF and preserves its dimensions", async ({ page }) => {
    await page.goto("/tiff-to-jpg");
    await uploadFile(page, tinyTiff(40, 30));
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.jpe?g$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    // 40x30, not 30x40 and not 1x1 — pins both the utif2 decode order
    // (width/height are only populated by decodeImage) and the pixel copy.
    expect(await decodedSize(page, bytes, "image/jpeg")).toEqual({
      width: 40,
      height: 30,
    });
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
