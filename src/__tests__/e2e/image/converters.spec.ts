import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPng, tinyJpg, tinyWebp, tinyBmp, tinySvg, tinyTiff } from "../fixtures";
import type { Page } from "@playwright/test";
import type { FixtureFile } from "../helpers";
import { compareImages, expectSameImage } from "../conversion/fidelity";

/** Decode both and require the same colour (solid fixtures: no layout to compare). */
async function expectSameColour(page: Page, input: FixtureFile, bytes: Buffer, mime: string) {
  const diff = await compareImages(page, { bytes: input.buffer, mime: input.mimeType }, { bytes, mime });
  // A flat fill has no structure, so correlation is meaningless here.
  expectSameImage(diff, { minCorrelation: -1, label: `${input.name} → ${mime}` });
}

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
 * Every conversion here decodes the output and compares its COLOUR to the
 * input's (`expectSameColour`), not just its magic bytes — a converter that
 * dropped the pixels, swapped channels or flattened onto the wrong colour
 * still emits a valid header. (Until 2026-11-11 this comment claimed every
 * test checked decoded dimensions; two of eight did.) The fixtures are tiny
 * solid fills, so layout is not checkable here; orientation and structure
 * are covered against real photos in `conversion/image*.spec.ts`.
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
    const input = tinyPng(16);
    await uploadFile(page, input);
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
    await expectSameColour(page, input, bytes, "image/jpeg");
  });

  test("JPG → PNG produces a PNG download", async ({ page }) => {
    await page.goto("/jpg-to-png");
    const input = tinyJpg();
    await uploadFile(page, input);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.png$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    await expectSameColour(page, input, bytes, "image/png");
  });

  test("WebP → JPG produces a JPEG download", async ({ page }) => {
    await page.goto("/webp-to-jpg");
    const input = tinyWebp();
    await uploadFile(page, input);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.jpe?g$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    await expectSameColour(page, input, bytes, "image/jpeg");
  });

  test("WebP → PNG produces a PNG download", async ({ page }) => {
    await page.goto("/webp-to-png");
    const input = tinyWebp();
    await uploadFile(page, input);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.png$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    await expectSameColour(page, input, bytes, "image/png");
  });

  test("PNG → WebP produces a WebP download", async ({ page }) => {
    await page.goto("/png-to-webp");
    const input = tinyPng(16);
    await uploadFile(page, input);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.webp$/i);
    const bytes = await downloadBytes(download);
    // RIFF...WEBP marker
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    await expectSameColour(page, input, bytes, "image/webp");
  });

  test("JPG → WebP produces a WebP download", async ({ page }) => {
    await page.goto("/jpg-to-webp");
    const input = tinyJpg();
    await uploadFile(page, input);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.webp$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    await expectSameColour(page, input, bytes, "image/webp");
  });

  test("BMP → JPG produces a JPEG download", async ({ page }) => {
    await page.goto("/bmp-to-jpg");
    const input = tinyBmp();
    await uploadFile(page, input);
    await page.getByRole("button", { name: "Convert", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.jpe?g$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
    await expectSameColour(page, input, bytes, "image/jpeg");
  });

  test("TIFF → JPG decodes a real TIFF and preserves its dimensions", async ({ page }) => {
    await page.goto("/tiff-to-jpg");
    const input = tinyTiff(40, 30);
    await uploadFile(page, input);
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
    // No colour check: browsers cannot decode the TIFF input to compare against.
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
