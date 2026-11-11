import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  forbidCdnCore,
  uploadFixture,
  primaryAction,
  captureDownload,
  toolError,
} from "./support";
import { assertPng, assertWebp, assertZip } from "./validators";
import { expectFixturePageRasters } from "./fidelity";

/** ZIP entries as images, ordered by the page number in their name. */
function byPage(entries: { name: string; bytes: Buffer; mime: string }[]) {
  const n = (s: string) => Number(s.match(/\d+/)?.[0]);
  return [...entries].sort((a, b) => n(a.name) - n(b.name));
}

/**
 * The pdf-to-png / pdf-to-webp variant pages share pdf-to-jpg's renderer
 * (PDF.js raster → image-pool encode) and differ only in the preselected
 * format. These prove the preselection is real — the ZIP entries are genuine
 * PNG/WebP containers, not JPEGs wearing the wrong extension — and that the
 * WebP page refuses honestly on engines that can't encode WebP.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i —
 * both tests here must run in BOTH engines, so titles avoid those words.
 */

test.describe("pdf→image variant pages — real output", () => {
  test("pdf-to-png preselects PNG and rasterises every page to real PNGs", async ({
    page,
  }) => {
    forbidCdnCore(page);
    await page.goto("/pdf-to-png");
    await uploadFixture(page, await SAMPLES.pdf());

    // The variant's whole point: PNG is already the active toggle, and the
    // quality slider stays hidden — PNG is lossless, there is nothing to set.
    await expect(
      page.getByRole("button", { name: "PNG", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("slider", { name: "Quality" })).toHaveCount(0);

    await primaryAction(page, /Convert to images/).click();

    const zipButton = page.getByRole("button", { name: /Download all \(ZIP\)/ });
    await expect(zipButton, `rasterise failed: ${await toolError(page)}`)
      .toBeVisible({ timeout: 150_000 });
    const { name, bytes } = await captureDownload(page, zipButton);
    expect(name).toBe("sample-doc-pages.zip");

    const names = await assertZip(bytes, { minEntries: 5 });
    expect(names.length, "one image per page").toBe(5);

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const images: { name: string; bytes: Buffer; mime: string }[] = [];
    for (const entryName of names) {
      expect(entryName).toMatch(/^page-\d+\.png$/);
      const entry = await zip.files[entryName].async("nodebuffer");
      // A real PNG container with real pixels — not renamed JPEG bytes.
      const dims = assertPng(entry);
      expect(dims.width, `${entryName} should be a rendered page`).toBeGreaterThan(100);
      expect(dims.height).toBeGreaterThan(100);
      images.push({ name: entryName, bytes: entry, mime: "image/png" });
    }
    // Each page-N.png is a render of page N (its bar's colour), not a blank,
    // a repeat or a neighbour.
    const bars = await expectFixturePageRasters(page, byPage(images), [1, 2, 3, 4, 5], { label: "pdf-to-png" });
    test.info().annotations.push({ type: "bar colours", description: JSON.stringify(bars) });
  });

  test("pdf-to-webp delivers real webp pages, or refuses honestly where the browser can't encode them", async ({
    page,
  }) => {
    forbidCdnCore(page);
    await page.goto("/pdf-to-webp");
    await uploadFixture(page, await SAMPLES.pdf());

    await expect(
      page.getByRole("button", { name: "WEBP", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    // WebP is a lossy encode here, so the quality slider must be offered.
    await expect(page.getByRole("slider", { name: "Quality" })).toBeVisible();

    // One test, both truths: Chromium can encode WebP and must produce real
    // WebP bytes; WebKit cannot — its canvas encoders silently substitute
    // PNG — and must show the friendly refusal instead of a mislabelled ZIP.
    const canEncodeWebp = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      return canvas.toDataURL("image/webp").startsWith("data:image/webp");
    });

    await primaryAction(page, /Convert to images/).click();

    if (canEncodeWebp) {
      const zipButton = page.getByRole("button", { name: /Download all \(ZIP\)/ });
      await expect(zipButton, `rasterise failed: ${await toolError(page)}`)
        .toBeVisible({ timeout: 150_000 });
      const { name, bytes } = await captureDownload(page, zipButton);
      expect(name).toBe("sample-doc-pages.zip");

      const names = await assertZip(bytes, { minEntries: 5 });
      expect(names.length, "one image per page").toBe(5);

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      const images: { name: string; bytes: Buffer; mime: string }[] = [];
      for (const entryName of names) {
        expect(entryName).toMatch(/^page-\d+\.webp$/);
        const entry = await zip.files[entryName].async("nodebuffer");
        // A genuine RIFF….WEBP container — the exact thing Safari's silent
        // PNG fallback would break — and a still, not an animation.
        const info = assertWebp(entry);
        expect(info.animated, `${entryName} must be a still image`).toBe(false);
        images.push({ name: entryName, bytes: entry, mime: "image/webp" });
      }
      const bars = await expectFixturePageRasters(page, byPage(images), [1, 2, 3, 4, 5], { label: "pdf-to-webp" });
      test.info().annotations.push({ type: "bar colours", description: JSON.stringify(bars) });
    } else {
      // The engine sniffs page 1's bytes and fails fast with the same wording
      // pdf-engine.ts throws — surfaced through the tool's role=alert path.
      // Non-empty filter: Next's route announcer is an empty [role=alert].
      await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ })).toContainText(
        "This browser can't encode WebP images. Use PDF to PNG instead, or open this page in Chrome or Edge.",
        { timeout: 150_000 },
      );
      // No download may be offered over the failed run — neither the ZIP nor
      // any per-page tile.
      await expect(page.getByRole("button", { name: /Download all \(ZIP\)/ })).toHaveCount(0);
      await expect(page.locator('[aria-label^="Download page "]')).toHaveCount(0);
    }
  });
});
