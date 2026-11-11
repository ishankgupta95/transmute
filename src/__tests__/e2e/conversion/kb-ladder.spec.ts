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
import { assertJpeg } from "./validators";
import { compareImages, expectSameImage } from "./fidelity";

/**
 * The Wave 1 KB-ladder variant pages are pure registry config over the
 * image-compress engine: `defaultTargetSizeKb` preselects target-size mode and
 * seeds the KB field. These two tests pin the wiring from BOTH phrasings —
 * one compress-named page whose preset actually drives a run, and one
 * resize-named page whose copy promises the "Scaled to …" disclosure that the
 * engine must deliver on. Titles deliberately avoid the conversion-webkit
 * grepInvert terms so both browser projects run them.
 */

test.describe("KB ladder variant pages", () => {
  test("compress-image-to-50kb preselects the 50 KB target and lands under it", async ({ page }) => {
    const jpg = await SAMPLES.jpg(); // 800×600, ~53 KB — just over the target
    await page.goto("/compress-image-to-50kb");
    await uploadFixture(page, jpg);

    // Registry wiring: `defaultTargetSizeKb: 50` must preselect target-size
    // mode and seed the KB field — the entire point of the variant page.
    await expect(
      page.getByRole("button", { name: "Target size", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Target file size in KB")).toHaveValue("50");

    // No control tweaking: the preset alone must produce the promised result.
    await primaryAction(page, /^Compress$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    assertJpeg(bytes);
    expect(bytes.length, "output must be at or under the preloaded 50 KB target")
      .toBeLessThanOrEqual(50 * 1024);
    // The fixture starts above 50 KB, so a strictly smaller file proves the
    // preset drove a real compression run, not a never-grow passthrough.
    expect(bytes.length).toBeLessThan(jpg.buffer.length);
    // 800×600 reaches 50 KB on quality alone — dimensions must survive.
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 800, height: 600 });
    expectSameImage(
      await compareImages(page, { bytes: jpg.buffer, mime: jpg.mimeType }, { bytes, mime: "image/jpeg" }),
      { label: "compress-image-to-50kb" },
    );
  });

  test("resize-image-to-20kb reaches 20 KB and discloses the downscale", async ({ page }) => {
    /*
      The resize-phrasing pages run the compressor, and their copy promises
      that a downscale is always disclosed. A large per-pixel-noise JPEG
      cannot reach 20 KB at ANY quality at source dimensions (image.spec.ts
      proves the same bound on /compress-image), so a green run here proves
      the preloaded 20 KB target genuinely stepped the dimensions down, said
      so in the exact shared wording, and still delivered a decodable JPEG
      under the ceiling. Fixture synthesised in-page (batch.spec.ts pattern).
    */
    const SRC_W = 4000;
    const SRC_H = 3000;
    await page.goto("/resize-image-to-20kb");
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

    // The page's own preset must carry the run — no target is typed here.
    await expect(page.getByLabel("Target file size in KB")).toHaveValue("20");

    await primaryAction(page, /^Compress$/).click();

    // Stepping re-runs the quality search per size level over a 12 MP source,
    // so this legitimately takes longer than the plain compress cases.
    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });

    // The honesty bar for the resize-phrasing pages: the engine must SAY it
    // changed the picture, in the exact wording target-size.ts owns.
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
});
