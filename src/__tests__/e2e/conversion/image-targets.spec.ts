import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import type { FixtureFile } from "../helpers";
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
import { IMAGE_MAE, compareImages, expectSameImage } from "./fidelity";

/**
 * The KB-target tool family: `compress-image-to-target-size`, the fixed-target
 * `compress-image-to-*kb/mb` pages and the `resize-image-to-*kb` /
 * `photo-resizer-in-kb` phrasings. All of them mount the one image-compress
 * engine with a preloaded `defaultTargetSizeKb`; only the registry data differs,
 * which is exactly what a copy/paste slip in `tools.ts` would corrupt.
 *
 * Every case asserts the three things a user is promised and a download alone
 * proves none of: the file is AT OR UNDER the target, it decodes, and it is
 * still the SAME PICTURE as the source (`expectSameImage` — the comparison grid
 * normalises size, so a legitimate downscale to reach a tight target is fine
 * while a flipped, tinted or blanked result is not).
 *
 * The source is a LARGE photo, not `sample-photo.jpg` (54 KB): that file is
 * already under every target from 100 KB up, which the tool answers by handing
 * the original back, and "output <= target" would then pass for any tool. The
 * large source is built in the page from the checked-in photo (upscaled with
 * fine grain), so it is megabytes of real detail that genuinely has to be
 * squeezed to each target.
 */

const BIG_W = 2400;
const BIG_H = 1800;

/** The checked-in 800x600 photo, upscaled 3x with per-pixel grain, as a JPEG. */
async function bigPhoto(page: Page): Promise<FixtureFile> {
  const small = await SAMPLES.jpg();
  const b64 = await page.evaluate(
    async ({ src, w, h }) => {
      const bin = atob(src);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type: "image/jpeg" }));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      // Deterministic grain (xorshift), +-14 per channel.
      let x = 0x9e3779b9;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          x ^= x << 13; x >>>= 0;
          x ^= x >>> 17;
          x ^= x << 5; x >>>= 0;
          const n = (x % 29) - 14;
          d[i + c] = Math.max(0, Math.min(255, d[i + c] + n));
        }
      }
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.95));
      const out = new Uint8Array(await blob!.arrayBuffer());
      let s = "";
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { src: small.buffer.toString("base64"), w: BIG_W, h: BIG_H },
  );
  const buffer = Buffer.from(b64, "base64");
  // The premise of the whole file: this is bigger than the largest target.
  expect(buffer.length, "the large source must exceed 1 MB or the 1 MB page proves nothing").toBeGreaterThan(
    1.3 * 1024 * 1024,
  );
  return { name: "big-photo.jpg", mimeType: "image/jpeg", buffer };
}

const KB = 1024;

interface Case {
  slug: string;
  /** The KB the registry preloads. */
  preset: number;
  /** MAE ceiling: aggressive targets need the looser one. */
  mae: number;
}

const CASES: Case[] = [
  { slug: "compress-image-to-target-size", preset: 200, mae: IMAGE_MAE.lossy },
  { slug: "compress-image-to-20kb", preset: 20, mae: IMAGE_MAE.heavy },
  { slug: "compress-image-to-100kb", preset: 100, mae: IMAGE_MAE.heavy },
  { slug: "compress-image-to-200kb", preset: 200, mae: IMAGE_MAE.lossy },
  { slug: "compress-image-to-500kb", preset: 500, mae: IMAGE_MAE.lossy },
  { slug: "compress-image-to-1mb", preset: 1024, mae: IMAGE_MAE.lossy },
  { slug: "resize-image-to-50kb", preset: 50, mae: IMAGE_MAE.heavy },
  { slug: "resize-image-to-100kb", preset: 100, mae: IMAGE_MAE.heavy },
  { slug: "photo-resizer-in-kb", preset: 100, mae: IMAGE_MAE.heavy },
];

async function runPreset(page: Page, slug: string, source: FixtureFile, timeout = 180_000) {
  await uploadFixture(page, source);
  await primaryAction(page, /^Compress$/).click();
  const dl = downloadAffordance(page);
  await expect(dl, `${slug} failed: ${await toolError(page)}`).toBeVisible({ timeout });
  return captureDownload(page, dl);
}

test.describe("KB-target pages — under the target, same picture", () => {
  for (const c of CASES) {
    test(`${c.slug} preloads ${c.preset} KB and delivers a decodable, faithful image under it`, async ({ page }) => {
      await page.goto(`/${c.slug}`);
      const source = await bigPhoto(page);

      // The registry wiring: the page must open in target-size mode on its own number.
      await uploadFixture(page, source);
      await expect(page.getByRole("button", { name: "Target size", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByLabel("Target file size in KB")).toHaveValue(String(c.preset));

      await primaryAction(page, /^Compress$/).click();
      const dl = downloadAffordance(page);
      await expect(dl, `${c.slug} failed: ${await toolError(page)}`).toBeVisible({ timeout: 180_000 });
      const { bytes } = await captureDownload(page, dl);

      assertJpeg(bytes);
      const target = c.preset * KB;
      expect(bytes.length, `${c.slug}: output must be at or under ${c.preset} KB`).toBeLessThanOrEqual(target);
      // The engine hunts for the best quality that FITS; collapsing to a
      // thumbnail-sized file far below the ceiling is a different bug.
      expect(bytes.length, `${c.slug}: should use most of the budget, not a fraction of it`).toBeGreaterThan(
        target * 0.35,
      );
      expect(bytes.length).toBeLessThan(source.buffer.length);

      const dims = await probeImageInPage(page, bytes, "image/jpeg");
      expect(dims.width / dims.height, "aspect ratio must survive any downscale").toBeCloseTo(BIG_W / BIG_H, 1);
      expect(dims.width).toBeLessThanOrEqual(BIG_W);
      expect(dims.width, "not a floor-sized thumbnail").toBeGreaterThanOrEqual(64);

      expectSameImage(
        await compareImages(page, { bytes: source.buffer, mime: "image/jpeg" }, { bytes, mime: "image/jpeg" }),
        { maxMae: c.mae, label: c.slug },
      );
    });
  }

  test("compress-image-to-target-size honours a typed target, not just its 200 KB default", async ({ page }) => {
    await page.goto("/compress-image-to-target-size");
    const source = await bigPhoto(page);
    await uploadFixture(page, source);

    const target = page.getByLabel("Target file size in KB");
    await target.fill("75");
    await target.blur();
    await primaryAction(page, /^Compress$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 180_000 });
    const { bytes } = await captureDownload(page, dl);

    assertJpeg(bytes);
    expect(bytes.length).toBeLessThanOrEqual(75 * KB);
    expect(bytes.length, "a 75 KB request must not be answered with a 200 KB-sized file").toBeGreaterThan(
      0.35 * 75 * KB,
    );
    expectSameImage(
      await compareImages(page, { bytes: source.buffer, mime: "image/jpeg" }, { bytes, mime: "image/jpeg" }),
      { maxMae: IMAGE_MAE.heavy, label: "compress-image-to-target-size (75 KB)" },
    );
  });

  test("a source already under the target is never made bigger", async ({ page }) => {
    // The other half of the contract: 54 KB into a 1 MB page must not be inflated.
    const jpg = await SAMPLES.jpg();
    await page.goto("/compress-image-to-1mb");
    const { bytes } = await runPreset(page, "compress-image-to-1mb", jpg);

    assertJpeg(bytes);
    expect(bytes.length, "never grow a file that already fits").toBeLessThanOrEqual(jpg.buffer.length);
    expect(await probeImageInPage(page, bytes, "image/jpeg")).toEqual({ width: 800, height: 600 });
    expectSameImage(
      await compareImages(page, { bytes: jpg.buffer, mime: "image/jpeg" }, { bytes, mime: "image/jpeg" }),
      { label: "compress-image-to-1mb (already small)" },
    );
  });
});
