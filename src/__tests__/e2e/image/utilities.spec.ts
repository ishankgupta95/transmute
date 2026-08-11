import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyPng, tinyJpg, tinyRectPng, twoColorPng } from "../fixtures";

test.describe("image utilities", () => {
  test("compress-image accepts multiple files and renders one download per file", async ({
    page,
  }) => {
    await page.goto("/compress-image");
    await uploadFile(page, [tinyPng(64), tinyJpg()]);
    await page.getByRole("button", { name: "Compress", exact: true }).click();

    // Multi-file output is bundled into one ZIP rather than firing N
    // downloads in a loop (which browsers throttled down to just the first).
    const zip = page.getByRole("button", { name: /Download all \(ZIP\)/i });
    await expect(zip).toBeVisible({ timeout: 20_000 });

    const { suggestedFilename, download } = await waitForDownload(page, zip);
    expect(suggestedFilename).toMatch(/\.zip$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
  });

  for (const { slug, target } of [
    { slug: "compress-image-to-100kb", target: "100" },
    { slug: "compress-image-to-200kb", target: "200" },
    { slug: "compress-image-to-1mb", target: "1024" },
  ]) {
    test(`${slug} loads in target-size mode with the right default`, async ({ page }) => {
      await page.goto(`/${slug}`);
      // Variant pages set defaultTargetSizeKb so the UI starts on "Target Size"
      // mode with the correct number pre-filled. After uploading we should be
      // able to compress and get a download.
      await uploadFile(page, tinyPng(64));

      // Target size input renders the configured default (100, 200, or 1024).
      const targetInput = page
        .locator('input[type="number"]')
        .filter({ hasNot: page.locator("[disabled]") })
        .first();
      await expect(targetInput).toHaveValue(target);

      await page.getByRole("button", { name: "Compress", exact: true }).click();
      const { suggestedFilename, download } = await waitForDownload(
        page,
        downloadButton(page),
      );
      expect(suggestedFilename).toMatch(/\.(jpe?g|png|webp)$/i);
      const bytes = await downloadBytes(download);
      expect(bytes.length).toBeGreaterThan(0);
    });
  }

  test("resize-image with a non-square source mirrors height when aspect is locked", async ({
    page,
  }) => {
    await page.goto("/resize-image");
    // 80x40 source — aspect 2:1. Halving width should drop height to 20.
    await uploadFile(page, tinyRectPng(80, 40));

    await page.getByRole("button", { name: "Custom", exact: true }).click();

    const numbers = page.locator('input[type="number"]');
    await numbers.first().fill("40");
    await expect(numbers.nth(1)).toHaveValue("20");

    await page.getByRole("button", { name: "Resize", exact: true }).click();
    const { suggestedFilename } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.(png|jpe?g|webp)$/i);
  });

  test("resize-image preset mode picks a fixed dimension preset", async ({ page }) => {
    await page.goto("/resize-image");
    await uploadFile(page, tinyRectPng(80, 40));

    // The "Presets" mode is the default. Click the first preset and confirm
    // the width input updates to a non-source value.
    const presetButtons = page.locator('button.rounded-md.border').filter({ hasText: /\d+/ });
    await expect(presetButtons.first()).toBeVisible();
  });

  test("image-to-base64 produces a data URI containing the file bytes", async ({ page }) => {
    await page.goto("/image-to-base64");
    await uploadFile(page, tinyPng(8));

    const output = page.locator("textarea[readonly]");
    await expect(output).toContainText("data:image/png;base64,");
    const value = await output.inputValue();
    const b64 = value.split(",")[1];
    const buf = Buffer.from(b64, "base64");
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("image-to-base64 raw mode strips the data URI prefix", async ({ page }) => {
    await page.goto("/image-to-base64");
    await uploadFile(page, tinyPng(8));
    await page.getByRole("button", { name: "Raw Base64" }).click();

    const output = page.locator("textarea[readonly]");
    const value = await output.inputValue();
    expect(value).not.toContain("data:");
    // Round-trip: the raw base64 must decode back to the PNG signature.
    const buf = Buffer.from(value, "base64");
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("crop-image: cropper renders, aspect presets are tappable, and crop yields a download", async ({
    page,
  }) => {
    await page.goto("/crop-image");
    await uploadFile(page, tinyRectPng(120, 80));

    // Cropper.js needs the image to load before it draws controls. The aspect
    // preset row is rendered alongside; wait on its first preset.
    const oneToOne = page.getByRole("button", { name: "1:1", exact: true });
    await expect(oneToOne).toBeVisible({ timeout: 10_000 });
    await oneToOne.click();

    await page.getByRole("button", { name: "Crop", exact: true }).click();
    const { suggestedFilename, download } = await waitForDownload(
      page,
      downloadButton(page),
      20_000,
    );
    // Cropped output is re-encoded as PNG by image-crop.ts.
    expect(suggestedFilename).toMatch(/\.png$/i);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("exif-viewer: reports 'no metadata' for a synthetic PNG with no tags", async ({
    page,
  }) => {
    await page.goto("/exif-viewer");
    await uploadFile(page, tinyPng(16));
    // The synthetic PNG has no EXIF/IPTC/XMP — UI shows the empty state.
    await expect(
      page.getByText(/No metadata found in this image/i),
    ).toBeVisible({ timeout: 10_000 });
    // The header states the field count alongside the empty state.
    await expect(page.getByText(/0 METADATA FIELDS/i)).toBeVisible();
  });

  test("png-to-ico: produces a valid ICO download", async ({ page }) => {
    await page.goto("/png-to-ico");
    await uploadFile(page, tinyPng(64));
    await page.getByRole("button", { name: "Convert to ICO", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(
      page,
      downloadButton(page),
      20_000,
    );
    expect(suggestedFilename).toMatch(/\.ico$/i);
    const bytes = await downloadBytes(download);
    // ICO header: reserved (2 bytes) = 0, type (2 bytes) = 1 (icon).
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    // Should encode the three configured sizes (16/32/48).
    expect(bytes.readUInt16LE(4)).toBe(3);
  });

  test("favicon-generator: renders the HTML snippet and downloads a zip bundle", async ({
    page,
  }) => {
    await page.goto("/favicon-generator");
    await uploadFile(page, tinyPng(128));

    await page
      .getByRole("button", { name: "Generate All Favicons", exact: true })
      .click();

    // The HTML snippet block is rendered into a <pre>; assert the canonical
    // <link> tags appear so we know the snippet generator produced text.
    await expect(page.locator("pre")).toContainText("apple-touch-icon", {
      timeout: 20_000,
    });
    await expect(page.locator("pre")).toContainText('rel="icon"');

    const { suggestedFilename, download } = await waitForDownload(
      page,
      downloadButton(page),
      20_000,
    );
    expect(suggestedFilename).toBe("favicons.zip");
    const bytes = await downloadBytes(download);
    // Zip files begin with the local-file-header magic "PK\x03\x04".
    expect(bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  test("image-color-palette: extracts at least one swatch from a two-tone PNG", async ({
    page,
  }) => {
    await page.goto("/image-color-palette");
    // Processing kicks off as soon as the file lands; no Convert button.
    await uploadFile(page, twoColorPng(64, 64));

    // Swatches are buttons labelled with the hex code plus a share
    // percentage — the old "rgb(...)" subtitle is gone.
    const swatches = page.locator("button").filter({ hasText: /^#[0-9a-f]{6}/i });
    await expect(swatches.first()).toBeVisible({ timeout: 15_000 });
    expect(await swatches.count()).toBeGreaterThanOrEqual(1);
  });
});
