import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { SAMPLES, uploadFixture, primaryAction, downloadAffordance, captureDownload, toolError } from "./support";
import { tinyTiff } from "../fixtures";
import { assertPng } from "./validators";
import { IMAGE_MAE, compareImages, expectSameImage, rawToPng, videoFramesInPage } from "./fidelity";

/**
 * Content checks for image tools whose tests checked only sizes, names or that
 * something appeared (ranked weakest on 2026-11-11). Each compares the output
 * with an expectation that does not come from the tool itself.
 */

async function zipEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, Buffer>();
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) out.set(name, await zip.files[name].async("nodebuffer"));
  }
  return out;
}

/** Crop to the bounding box of pixels that are not transparent (a letterboxed icon's picture). */
async function opaqueArea(page: Page, png: Buffer): Promise<{ bytes: Buffer; mime: string }> {
  const b64 = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < buf.length; i++) buf[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 250) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 < 0) throw new Error("icon is fully transparent");
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const o = document.createElement("canvas");
    o.width = w;
    o.height = h;
    o.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob>((r) => o.toBlob((b) => r(b!), "image/png"));
    const out = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  }, png.toString("base64"));
  return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
}

test.describe("image tools: the output is the right picture", () => {
  test("image-splitter: every tile is its own region of a real photo", async ({ page }) => {
    // The existing splitter test uses a solid fill, so a tile from the wrong
    // place, or all nine tiles of one region, passed. A photo makes it visible.
    const photo = await SAMPLES.jpg(); // 800 × 600
    await page.goto("/image-splitter");
    await uploadFixture(page, photo);
    await page.getByRole("spinbutton", { name: "Rows", exact: true }).fill("2");
    await page.getByRole("spinbutton", { name: "Columns", exact: true }).fill("3");
    await primaryAction(page, /^Split$/).click();
    const zipButton = page.getByRole("button", { name: "Download 6 tiles (ZIP)", exact: true });
    await expect(zipButton, `split failed: ${await toolError(page)}`).toBeVisible({ timeout: 150_000 });
    const tiles = await zipEntries((await captureDownload(page, zipButton)).bytes);
    expect(tiles.size).toBe(6);

    const size = new Map<string, { width: number; height: number }>();
    for (const [name, bytes] of tiles) size.set(/-(r\d+c\d+)\.\w+$/.exec(name)![1], assertPng(bytes));
    const source = { bytes: photo.buffer, mime: photo.mimeType };
    let y = 0;
    for (let r = 1; r <= 2; r++) {
      let x = 0;
      for (let c = 1; c <= 3; c++) {
        const key = `r${r}c${c}`;
        const [name, bytes] = [...tiles].find(([n]) => n.includes(`-${key}.`))!;
        const { width, height } = size.get(key)!;
        const diff = await compareImages(page, source, { bytes, mime: "image/png" }, { crop: { x, y, width, height } });
        expectSameImage(diff, { maxMae: IMAGE_MAE.lossy, label: `${name} (source x ${x}, y ${y})` });
        x += width;
      }
      y += size.get(`r${r}c1`)!.height;
    }
  });

  test("favicon-generator: each large icon shows the source, letterboxed not stretched", async ({ page }) => {
    const photo = await SAMPLES.jpg(); // 4:3 into square icons
    await page.goto("/favicon-generator");
    await uploadFixture(page, photo);
    await page.getByRole("button", { name: /^Generate \d+ assets$/ }).click();
    const dl = downloadAffordance(page);
    await expect(dl, `favicon failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const files = await zipEntries((await captureDownload(page, dl)).bytes);
    const pngs = [...files].filter(([n]) => n.endsWith(".png"));
    expect(pngs.length, "the ZIP should carry PNG icons").toBeGreaterThan(0);
    let checked = 0;
    for (const [name, bytes] of pngs) {
      const { width, height } = assertPng(bytes);
      expect(width, `${name} must be square`).toBe(height);
      // Tiny sizes are dominated by resampling; the large ones say whether the
      // picture is the source, placed whole.
      if (width < 150) continue;
      const shown = await opaqueArea(page, bytes);
      const diff = await compareImages(page, { bytes: photo.buffer, mime: photo.mimeType }, shown);
      const aspect = diff.output.width / diff.output.height;
      expect(Math.abs(aspect - 800 / 600) / (800 / 600), `${name}: picture ${diff.output.width}×${diff.output.height} must keep 4:3`).toBeLessThan(0.03);
      expectSameImage(diff, { maxMae: IMAGE_MAE.lossy, label: name });
      checked++;
    }
    expect(checked, "at least one icon large enough to judge").toBeGreaterThan(0);
  });

  test("video-thumbnail: the still IS the source frame at the moment it reports", async ({ page }) => {
    const video = await SAMPLES.mp4();
    await page.goto("/video-thumbnail");
    await uploadFixture(page, video);
    const moment = page.getByRole("slider", { name: "Time" });
    await expect(moment).toBeEnabled({ timeout: 60_000 });
    await moment.fill("1");
    await primaryAction(page, /^Capture frame$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `capture failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);
    const m = /-(\d{2})m(\d{2}\.\d{3})s\.jpg$/.exec(name)!;
    const takenAt = Number(m[1]) * 60 + Number(m[2]);

    // Compare against the source frames around that time; the best must be a
    // near-copy, and it must be the reported moment, not frame 0.
    const grid = { width: 64, height: 48 };
    const times = [takenAt - 1 / 24, takenAt, takenAt + 1 / 24].filter((t) => t >= 0);
    const frames = await videoFramesInPage(page, video.buffer, "video/mp4", times, grid);
    const still = await videoFramesInPage(page, video.buffer, "video/mp4", [0], grid); // frame 0, for contrast
    const asImage = await compareImages(page, { bytes, mime: "image/jpeg" }, { bytes, mime: "image/jpeg" });
    expect(asImage.output).toEqual({ width: 320, height: 240 });
    const toPng = async (rgb: number[]) => {
      const rgba = new Uint8Array(grid.width * grid.height * 4);
      for (let i = 0; i < grid.width * grid.height; i++) rgba.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 255], i * 4);
      return { bytes: await rawToPng(grid.width, grid.height, 4, rgba), mime: "image/png" };
    };
    const diffs = await Promise.all(frames.frames.map(async (f) => compareImages(page, await toPng(f.rgb), { bytes, mime: "image/jpeg" }, { gridMax: 64 })));
    const best = diffs.reduce((a, b) => (b.mae < a.mae ? b : a));
    expectSameImage(best, { maxMae: IMAGE_MAE.lossy, label: `thumbnail vs source @${takenAt.toFixed(3)}s` });
    const vsFirst = await compareImages(page, await toPng(still.frames[0].rgb), { bytes, mime: "image/jpeg" }, { gridMax: 64 });
    expect(vsFirst.mae, "the still must not be frame 0").toBeGreaterThan(best.mae + 20);
  });

  test("image-color-palette: the swatches are the image's own colours", async ({ page }) => {
    // Four flat quadrants: the palette has nothing to average, so each swatch
    // must land on one of these four, and all four must appear.
    const QUADS: [number, number, number][] = [[220, 40, 40], [40, 180, 60], [40, 70, 210], [240, 210, 40]];
    await page.goto("/");
    const b64 = await page.evaluate(async (quads) => {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext("2d")!;
      quads.forEach(([r, g, b], i) => { ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect((i % 2) * 100, Math.floor(i / 2) * 100, 100, 100); });
      const blob = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
      const u = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    }, QUADS);
    await page.goto("/image-color-palette");
    await uploadFixture(page, { name: "quads.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
    const swatches = page.locator("[data-tool-surface] button").filter({ hasText: /^#[0-9a-f]{6}/i });
    await expect(swatches.first()).toBeVisible({ timeout: 30_000 });
    const hexes = (await swatches.allInnerTexts()).map((t) => t.match(/#[0-9a-f]{6}/i)![0]);
    const rgb = hexes.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    const dist = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    test.info().annotations.push({ type: "swatches", description: hexes.join(" ") });
    for (const [i, s] of rgb.entries()) {
      expect(Math.min(...QUADS.map((q) => dist(s, q))), `swatch ${hexes[i]} is not one of the image's colours`).toBeLessThanOrEqual(12);
    }
    for (const q of QUADS) {
      expect(Math.min(...rgb.map((s) => dist(s, q))), `rgb(${q}) is in the image but no swatch shows it`).toBeLessThanOrEqual(12);
    }
  });

  test("tiff-to-jpg: the pixels are the TIFF's, the right way round", async ({ page }) => {
    // tinyTiff: left half (210,60,40), right half (40,90,200). The reference is
    // built from those numbers directly — no TIFF decoder involved — so a
    // mirrored, flipped or channel-swapped decode fails.
    const W = 80, H = 60;
    const tiff = tinyTiff(W, H);
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set(x < W / 2 ? [210, 60, 40, 255] : [40, 90, 200, 255], (y * W + x) * 4);
    const reference = { bytes: await rawToPng(W, H, 4, rgba), mime: "image/png" };
    await page.goto("/tiff-to-jpg");
    await uploadFixture(page, tiff);
    await primaryAction(page, /^Convert$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);
    expectSameImage(await compareImages(page, reference, { bytes, mime: "image/jpeg" }), { maxMae: IMAGE_MAE.lossy, label: "tiff-to-jpg" });
  });
});
