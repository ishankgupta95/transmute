import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  SAMPLES,
  sample,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  toolError,
  probeImageInPage,
  decodeAudioInPage,
} from "./support";
import { assertPdf, assertZip, assertGif } from "./validators";

/**
 * Phase 4 gate: `/workspace` is real. Every archetype converts a real file
 * through the workspace mount — the same components as the tool pages, so
 * these assert the MOUNT (deep link, rail, remount, download), while the
 * byte-level fidelity of each engine stays with the per-tool specs.
 */

async function gotoWorkspaceTool(page: Page, slug: string): Promise<void> {
  await page.goto(`/workspace?tool=${slug}`);
  // The shell is up once the rail rendered.
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("workspace mounts real tools", () => {
  test("deep link selects the tool and the rail switches it (with remount)", async ({
    page,
  }) => {
    await gotoWorkspaceTool(page, "resize-image");
    await expect(
      page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: /Resize Image/ }),
    ).toHaveAttribute("aria-current", "true");

    // Pick another tool in the rail: URL updates, previous tool unmounts.
    await page
      .getByRole("navigation", { name: "Tools" })
      .getByRole("button", { name: /UUID Generator/ })
      .click();
    await expect(page).toHaveURL(/\?tool=uuid-generator/);
    await expect(page.getByRole("button", { name: /Generate/ }).first()).toBeVisible();
    expect(await page.locator('input[type="file"]').count()).toBe(0);
  });

  test("image: resize-image converts through the workspace", async ({ page }) => {
    await gotoWorkspaceTool(page, "resize-image");
    await uploadFixture(page, await SAMPLES.jpg());
    await primaryAction(page, /^Resize$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `resize failed: ${await toolError(page)}`).toBeVisible({
      timeout: 60_000,
    });
    const { bytes } = await captureDownload(page, dl);
    // Default preset: Instagram Post 1080×1080.
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 1080, height: 1080 });
  });

  test("batch: compress-image runs two files to a ZIP", async ({ page }) => {
    const a = await SAMPLES.jpg();
    const b = { ...(await SAMPLES.jpgPortrait()), name: "second.jpg" };
    await gotoWorkspaceTool(page, "compress-image");
    await uploadFixture(page, [a, b]);
    await primaryAction(page, /^Compress$/).click();

    await expect(page.getByText(/2 OF 2 DONE · \d+ THREADS/)).toBeVisible({
      timeout: 60_000,
    });
    const zip = await captureDownload(page, page.getByRole("button", { name: /Download all/ }));
    await assertZip(zip.bytes, { minEntries: 2 });
  });

  test("pdfpages: split-pdf extracts pages", async ({ page }) => {
    await gotoWorkspaceTool(page, "split-pdf");
    await uploadFixture(page, await SAMPLES.pdf());

    await expect(page.getByRole("button", { name: "Select all", exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Deselect all" }).click();
    await page.getByRole("button", { name: /^Page 1(,|$)/ }).first().click();
    await page.getByRole("button", { name: /^Page 3(,|$)/ }).first().click();

    await primaryAction(page, /Extract 2 pages/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `split failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);
    await assertPdf(bytes, { pages: 2 });
  });

  test("pdfdocs: merge-pdf concatenates two documents", async ({ page }) => {
    const a = await sample("sample-doc.pdf", "application/pdf");
    await gotoWorkspaceTool(page, "merge-pdf");
    await uploadFixture(page, [
      { ...a, name: "first-doc.pdf" },
      { ...a, name: "second-doc.pdf" },
    ]);
    await primaryAction(page, /Merge PDFs/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `merge failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);
    await assertPdf(bytes, { pages: 10 });
  });

  test("audio: mp3-to-wav decodes and re-encodes", async ({ page }) => {
    await gotoWorkspaceTool(page, "mp3-to-wav");
    await uploadFixture(page, await SAMPLES.mp3());
    await primaryAction(page, /^Convert/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { name, bytes } = await captureDownload(page, dl);
    expect(name).toMatch(/\.wav$/);
    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(0.5);
    expect(decoded.peak).toBeGreaterThan(0.01);
  });

  test("video: video-to-gif emits a GIF through the workspace", async ({ page }) => {
    await gotoWorkspaceTool(page, "video-to-gif");
    await uploadFixture(page, await SAMPLES.mp4());
    await primaryAction(page, /Convert to GIF/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `gif failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { bytes } = await captureDownload(page, dl);
    const gif = assertGif(bytes);
    expect(gif.frames).toBeGreaterThan(1);
  });

  test("text: json-formatter pretty-prints", async ({ page }) => {
    await gotoWorkspaceTool(page, "json-formatter");
    await page.getByPlaceholder(/{"name":/).fill('{"a":1,"b":[2,3]}');
    await expect(page.locator("pre")).toContainText('"a": 1');
  });

  test("gen: uuid-generator emits a v4 UUID", async ({ page }) => {
    await gotoWorkspaceTool(page, "uuid-generator");
    await page.getByRole("button", { name: /Generate/ }).click();
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(await page.locator("code").first().innerText()).toMatch(v4);
  });

  test("icons: favicon-generator bundles a ZIP", async ({ page }) => {
    await gotoWorkspaceTool(page, "favicon-generator");
    await uploadFixture(page, await SAMPLES.jpg());
    await page.getByRole("button", { name: "Generate All Favicons", exact: true }).click();

    await expect(page.locator("pre")).toContainText("apple-touch-icon", { timeout: 30_000 });
    const dl = downloadAffordance(page);
    await expect(dl, `favicon failed: ${await toolError(page)}`).toBeVisible({
      timeout: 30_000,
    });
    const { name, bytes } = await captureDownload(page, dl);
    expect(name).toBe("favicons.zip");
    await assertZip(bytes, { minEntries: 3 });
  });

  test("color: image-color-palette extracts swatches", async ({ page }) => {
    await gotoWorkspaceTool(page, "image-color-palette");
    // Processing starts on drop; swatch buttons carry the hex code.
    await uploadFixture(page, await SAMPLES.jpg());
    const swatches = page.locator("button").filter({ hasText: /^#[0-9a-f]{6}/i });
    await expect(swatches.first()).toBeVisible({ timeout: 30_000 });
  });

  test("data: exif-viewer reads the fixture's metadata", async ({ page }) => {
    await gotoWorkspaceTool(page, "exif-viewer");
    await uploadFixture(page, await SAMPLES.jpg());
    await expect(page.getByText("Transmute", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Contains location data/i)).toBeVisible();
  });

  test("record: screen-recorder produces a clip in the workspace", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "display capture needs the Chromium fake-media launch flags",
    );
    await gotoWorkspaceTool(page, "screen-recorder");

    const start = page.getByRole("button", { name: /Start Recording/i });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.click();

    const stop = page.getByRole("button", { name: /Stop Recording/i });
    const failed = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
    await expect(stop.or(failed)).toBeVisible({ timeout: 60_000 });
    if (await failed.count()) {
      const message = await failed.textContent();
      test.skip(true, `display capture unavailable: ${message?.trim()}`);
    }

    await page.waitForTimeout(1500);
    await stop.click();

    const dl = downloadAffordance(page);
    await expect(dl, `recording failed: ${await toolError(page)}`).toBeVisible({
      timeout: 60_000,
    });
    const { bytes } = await captureDownload(page, dl);
    expect(bytes.readUInt32BE(0), "recording should be WebM/EBML").toBe(0x1a45dfa3);
  });
});
