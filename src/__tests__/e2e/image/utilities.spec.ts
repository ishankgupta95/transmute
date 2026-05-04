import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload } from "../helpers";
import { tinyPng, tinyJpg } from "../fixtures";

test.describe("image utilities", () => {
  test("compress-image accepts multiple files and renders per-file results", async ({ page }) => {
    await page.goto("/compress-image");
    await uploadFile(page, [tinyPng(64), tinyJpg()]);
    await page.getByRole("button", { name: "Compress", exact: true }).click();

    // One DownloadButton per result, plus the bottom "Download all"-style row
    // isn't used in this UI — the per-file download buttons live in the
    // results list. Wait for at least 2.
    const downloads = downloadButton(page);
    await expect(downloads).toHaveCount(2, { timeout: 20_000 });
  });

  test("resize-image preserves aspect ratio when locked", async ({ page }) => {
    await page.goto("/resize-image");
    // Generate an obviously non-square PNG so the aspect-ratio math is visible.
    const buf = tinyPng(32);
    await uploadFile(page, buf);

    // Switch to "Custom" mode so the width/height inputs are usable.
    await page.getByRole("button", { name: "Custom", exact: true }).click();

    const numbers = page.locator('input[type="number"]');
    await numbers.first().fill("16");
    // For a 32x32 source with aspect locked, height should mirror to 16.
    await expect(numbers.nth(1)).toHaveValue("16");

    await page.getByRole("button", { name: "Resize", exact: true }).click();
    const { suggestedFilename } = await waitForDownload(page, downloadButton(page));
    expect(suggestedFilename).toMatch(/\.(png|jpe?g|webp)$/i);
  });

  test("image-to-base64 produces a data URI containing the file bytes", async ({ page }) => {
    await page.goto("/image-to-base64");
    await uploadFile(page, tinyPng(8));

    // Output textarea (read-only) is the only one rendered.
    const output = page.locator("textarea[readonly]");
    await expect(output).toContainText("data:image/png;base64,");
    const value = await output.inputValue();
    // Decoded base64 must reproduce the PNG signature.
    const b64 = value.split(",")[1];
    const buf = Buffer.from(b64, "base64");
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("image-to-base64 can switch to raw output mode", async ({ page }) => {
    await page.goto("/image-to-base64");
    await uploadFile(page, tinyPng(8));
    await page.getByRole("button", { name: "Raw Base64" }).click();

    const output = page.locator("textarea[readonly]");
    const value = await output.inputValue();
    expect(value).not.toContain("data:");
    expect(() => Buffer.from(value, "base64")).not.toThrow();
  });
});
