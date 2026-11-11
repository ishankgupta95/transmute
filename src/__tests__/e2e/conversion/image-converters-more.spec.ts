import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import type { FixtureFile } from "../helpers";
import {
  SAMPLES,
  sample,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeImageInPage,
  toolError,
} from "./support";
import { assertJpeg, assertPng, assertWebp } from "./validators";
import { IMAGE_MAE, compareImages, expectSameImage } from "./fidelity";

/**
 * Format-pair converters that had no real-conversion test: `jpg-to-webp`,
 * `png-to-webp`, `avif-to-jpg`, `bmp-to-jpg`, `png-to-ico`, `image-to-base64`.
 *
 * Each is fed a real picture (the 800x600 photo fixture, re-wrapped as PNG /
 * BMP in the page where the input format demands it) and the OUTPUT is decoded
 * and compared with the source — right size, right way up, no colour cast,
 * transparency kept where the format can hold it. A page wired to the wrong
 * target format, or a pipeline that flips rows (BMP is stored bottom-up) or
 * drops alpha, renders a perfectly normal Download button.
 */

// ────────────────────────────────────────────────────────────────────────────
// Fixtures built from the checked-in photo
// ────────────────────────────────────────────────────────────────────────────

interface Derived {
  /** The photo as PNG, top-left 240x180 block fully transparent. */
  pngAlpha: FixtureFile;
  /** The photo as an opaque 24-bit bottom-up BMP. */
  bmp: FixtureFile;
  /** Centre square of the photo, 96x96, opaque PNG (for the ICO pipeline). */
  pngSquare: FixtureFile;
}

async function derive(page: Page): Promise<Derived> {
  const jpg = await SAMPLES.jpg();
  const out = await page.evaluate(async (src) => {
    const bin = atob(src);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([buf], { type: "image/jpeg" }));
    const b64 = (u8: Uint8Array) => {
      let s = "";
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const toPng = async (c: HTMLCanvasElement) =>
      new Uint8Array(await (await new Promise<Blob | null>((r) => c.toBlob(r, "image/png")))!.arrayBuffer());

    const W = bmp.width;
    const H = bmp.height;
    const full = document.createElement("canvas");
    full.width = W;
    full.height = H;
    const fctx = full.getContext("2d", { willReadFrequently: true })!;
    fctx.drawImage(bmp, 0, 0);
    const pixels = fctx.getImageData(0, 0, W, H);

    // BMP from the opaque pixels: BITMAPINFOHEADER, 24 bpp, rows bottom-up, BGR.
    const rowSize = Math.ceil((24 * W) / 32) * 4;
    const bmpBytes = new Uint8Array(54 + rowSize * H);
    const dv = new DataView(bmpBytes.buffer);
    bmpBytes[0] = 0x42;
    bmpBytes[1] = 0x4d;
    dv.setUint32(2, bmpBytes.length, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, W, true);
    dv.setInt32(22, H, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, rowSize * H, true);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const d = 54 + (H - 1 - y) * rowSize + x * 3;
        bmpBytes[d] = pixels.data[s + 2];
        bmpBytes[d + 1] = pixels.data[s + 1];
        bmpBytes[d + 2] = pixels.data[s];
      }
    }

    // PNG with a transparent block.
    const holed = document.createElement("canvas");
    holed.width = W;
    holed.height = H;
    const hctx = holed.getContext("2d")!;
    hctx.drawImage(bmp, 0, 0);
    hctx.clearRect(0, 0, 240, 180);

    // Square centre crop.
    const sq = document.createElement("canvas");
    sq.width = 600;
    sq.height = 600;
    sq.getContext("2d")!.drawImage(bmp, (W - 600) / 2, (H - 600) / 2, 600, 600, 0, 0, 600, 600);

    // Reduce stepwise to 96 px. An icon built from a 600 px source asks every
    // engine to shrink 37x in one draw, and engines disagree wildly on how
    // (WebKit's "high" quality aliases at that ratio), which would make the
    // oracle noisier than the tool. 96 px keeps every ratio below 6x.
    let cur: HTMLCanvasElement = sq;
    for (const side of [300, 150, 96]) {
      const n = document.createElement("canvas");
      n.width = n.height = side;
      const nctx = n.getContext("2d")!;
      nctx.imageSmoothingQuality = "high";
      nctx.drawImage(cur, 0, 0, side, side);
      cur = n;
    }

    return {
      png: b64(await toPng(holed)),
      bmp: b64(bmpBytes),
      sq: b64(await toPng(cur)),
    };
  }, jpg.buffer.toString("base64"));
  return {
    pngAlpha: { name: "photo-alpha.png", mimeType: "image/png", buffer: Buffer.from(out.png, "base64") },
    bmp: { name: "photo.bmp", mimeType: "image/bmp", buffer: Buffer.from(out.bmp, "base64") },
    pngSquare: { name: "photo-square.png", mimeType: "image/png", buffer: Buffer.from(out.sq, "base64") },
  };
}

function canEncodeWebp(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  });
}

/**
 * Convert on the current page. Returns null when the tool refused with `refuse`
 * (WebKit and WebP): there it must say so and offer nothing to download, which
 * is asserted here.
 */
async function convertOrRefusal(
  page: Page,
  input: FixtureFile,
  opts: { refuse?: RegExp } = {},
): Promise<{ name: string; bytes: Buffer } | null> {
  await uploadFixture(page, input);
  await primaryAction(page, /^Convert( to ICO)?$/).click();
  const dl = downloadAffordance(page);
  if (opts.refuse) {
    const refusal = page.locator('[role="alert"]').filter({ hasText: opts.refuse });
    await expect(dl.or(refusal).first()).toBeVisible({ timeout: 90_000 });
    if ((await refusal.count()) > 0) {
      expect(await dl.count(), "a refused encode must offer nothing to download").toBe(0);
      return null;
    }
  }
  await expect(dl, `conversion failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
  return captureDownload(page, dl);
}

// ────────────────────────────────────────────────────────────────────────────

test.describe("format-pair converters — real output, same picture", () => {
  test("jpg-to-webp writes a real, still WebP of the same photo (or refuses where the browser can't)", async ({ page }) => {
    const jpg = await SAMPLES.jpg();
    await page.goto("/jpg-to-webp");
    const webp = await canEncodeWebp(page);
    const res = await convertOrRefusal(page, jpg, { refuse: /cannot write WEBP/i });
    if (!webp) {
      expect(res, "this browser cannot encode WebP; the tool must refuse").toBeNull();
      return;
    }
    expect(res).not.toBeNull();
    const { name, bytes } = res!;

    expect(name).toBe("sample-photo.webp");
    expect(assertWebp(bytes).animated).toBe(false);
    expect(await probeImageInPage(page, bytes, "image/webp")).toEqual({ width: 800, height: 600 });
    expectSameImage(
      await compareImages(page, { bytes: jpg.buffer, mime: "image/jpeg" }, { bytes, mime: "image/webp" }),
      { label: "jpg-to-webp" },
    );
  });

  test("png-to-webp keeps the picture AND the transparent block", async ({ page }) => {
    await page.goto("/png-to-webp");
    const { pngAlpha } = await derive(page);
    const webp = await canEncodeWebp(page);
    const res = await convertOrRefusal(page, pngAlpha, { refuse: /cannot write WEBP/i });
    if (!webp) {
      expect(res).toBeNull();
      return;
    }
    const { name, bytes } = res!;

    expect(name).toBe("photo-alpha.webp");
    assertWebp(bytes);
    expect(await probeImageInPage(page, bytes, "image/webp")).toEqual({ width: 800, height: 600 });
    const diff = await compareImages(page, { bytes: pngAlpha.buffer, mime: "image/png" }, { bytes, mime: "image/webp" });
    // alphaMae is averaged over the whole grid: flattening the 240x180 hole to
    // opaque would cost ~255 * (240*180)/(800*600) = 23, far over the ceiling.
    expectSameImage(diff, { maxAlphaMae: 4, label: "png-to-webp" });
  });

  test("avif-to-jpg decodes AVIF to a JPEG with the right colours, flattening transparency onto white", async ({ page }) => {
    const avif = await sample("sample.avif", "image/avif");
    await page.goto("/avif-to-jpg");
    const { name, bytes } = (await convertOrRefusal(page, avif))!;

    expect(name).toBe("sample.jpg");
    assertJpeg(bytes);
    expect(await probeImageInPage(page, bytes, "image/jpeg")).toEqual({ width: 48, height: 32 });
    /*
      The fixture's top 8 rows are transparent. JPEG has no alpha, so the page
      paints white first; composite the source over white for the oracle. A tool
      that skipped the fill would put black there and fail the MAE.
    */
    const diff = await compareImages(
      page,
      { bytes: avif.buffer, mime: "image/avif" },
      { bytes, mime: "image/jpeg" },
      { background: "#ffffff" },
    );
    // 48x32 is a tiny picture of four hard-edged flat blocks: chroma
    // subsampling bleeds across every edge, so the heavy ceiling.
    expectSameImage(diff, { maxMae: IMAGE_MAE.heavy, label: "avif-to-jpg" });
  });

  test("bmp-to-jpg turns a bottom-up 24-bit BMP into an upright JPEG of the same photo", async ({ page }) => {
    await page.goto("/bmp-to-jpg");
    const { bmp } = await derive(page);
    const jpg = await SAMPLES.jpg();
    const { name, bytes } = (await convertOrRefusal(page, bmp))!;

    expect(name).toBe("photo.jpg");
    assertJpeg(bytes);
    expect(await probeImageInPage(page, bytes, "image/jpeg")).toEqual({ width: 800, height: 600 });
    // The BMP is a lossless copy of the JPEG's decode, so the oracle is the
    // photo itself: BMP rows are stored bottom-up, and a flip costs MAE ~60.
    expectSameImage(
      await compareImages(page, { bytes: jpg.buffer, mime: "image/jpeg" }, { bytes, mime: "image/jpeg" }),
      { label: "bmp-to-jpg" },
    );
    expect(bytes.length, "a 1.4 MB BMP should shrink dramatically as a JPEG").toBeLessThan(bmp.buffer.length / 5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// png-to-ico
// ────────────────────────────────────────────────────────────────────────────

interface IcoEntry {
  width: number;
  height: number;
  png: Buffer;
}

function parseIco(buf: Buffer): IcoEntry[] {
  expect(buf.readUInt16LE(0), "ICO reserved word").toBe(0);
  expect(buf.readUInt16LE(2), "ICO type 1 = icon").toBe(1);
  const count = buf.readUInt16LE(4);
  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const size = buf.readUInt32LE(o + 8);
    const offset = buf.readUInt32LE(o + 12);
    expect(offset + size, "ICO entry must lie inside the file").toBeLessThanOrEqual(buf.length);
    entries.push({
      width: buf[o] || 256,
      height: buf[o + 1] || 256,
      png: buf.subarray(offset, offset + size),
    });
  }
  return entries;
}

test.describe("png-to-ico", () => {
  test("writes 16, 32 and 48 px icons that are each the source picture", async ({ page }) => {
    await page.goto("/png-to-ico");
    const { pngSquare } = await derive(page);
    const { name, bytes } = (await convertOrRefusal(page, pngSquare))!;

    expect(name).toBe("photo-square.ico");
    const entries = parseIco(bytes);
    expect(entries.map((e) => `${e.width}x${e.height}`)).toEqual(["16x16", "32x32", "48x48"]);
    for (const e of entries) {
      const dims = assertPng(Buffer.from(e.png));
      expect(dims, "the directory size must match the embedded image").toEqual({ width: e.width, height: e.height });
      expectSameImage(
        await compareImages(page, { bytes: pngSquare.buffer, mime: "image/png" }, { bytes: Buffer.from(e.png), mime: "image/png" }),
        /*
          WebKit's "high" smoothing (the oracle's) is the noisy side at 16 px:
          measured against a box-filtered reference, the tool's default draw
          read mae 7.0 and WebKit's "high" read 12.3. So the 16 px icon gets the
          loose ceiling there; a flipped or wrong picture still reads ~60 / <0.
        */
        e.width === 16
          ? { maxMae: IMAGE_MAE.heavy, minCorrelation: 0.8, label: `png-to-ico ${e.width}px` }
          : { maxMae: IMAGE_MAE.lossy, label: `png-to-ico ${e.width}px` },
      );
    }
  });

  test("a non-square PNG is letterboxed with transparency, not stretched", async ({ page }) => {
    await page.goto("/png-to-ico");
    const { pngAlpha } = await derive(page);
    const { bytes } = (await convertOrRefusal(page, pngAlpha))!;

    const e48 = parseIco(bytes).find((e) => e.width === 48)!;
    // 800x600 contained in 48x48 is 48x36: 6 transparent rows above and below.
    const px = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = c.height = 48;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const at = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3];
      // Bottom-right is photo (the transparent block is top-left only).
      return { topBar: at(40, 2), bottomBar: at(40, 45), photo: at(40, 40) };
    }, Buffer.from(e48.png).toString("base64"));
    expect(px.topBar, "letterbox bar above the picture").toBe(0);
    expect(px.bottomBar, "letterbox bar below the picture").toBe(0);
    expect(px.photo, "picture area").toBe(255);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// image-to-base64
// ────────────────────────────────────────────────────────────────────────────

test.describe("image-to-base64", () => {
  async function encode(page: Page, input: FixtureFile) {
    await page.goto("/image-to-base64");
    await uploadFixture(page, input);
    const uri = page.getByLabel("Data URI output");
    await expect(uri).not.toHaveValue("", { timeout: 30_000 });
    return uri;
  }

  test("the data URI decodes back to the exact JPEG bytes, and draws the same picture", async ({ page }) => {
    const jpg = await SAMPLES.jpg();
    const uri = await encode(page, jpg);
    const value = await uri.inputValue();

    expect(value.startsWith("data:image/jpeg;base64,")).toBe(true);
    const decoded = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
    expect(decoded.equals(jpg.buffer), "the encoded payload must be the file, byte for byte").toBe(true);
    expectSameImage(
      await compareImages(page, { bytes: jpg.buffer, mime: "image/jpeg" }, { bytes: decoded, mime: "image/jpeg" }),
      { maxMae: IMAGE_MAE.lossless, label: "image-to-base64 (jpg)" },
    );
  });

  test("a PNG with transparency round-trips exactly, in Data URI and Raw Base64 modes", async ({ page }) => {
    await page.goto("/image-to-base64");
    const { pngAlpha } = await derive(page);
    await uploadFixture(page, pngAlpha);
    const uri = page.getByLabel("Data URI output");
    await expect(uri).not.toHaveValue("", { timeout: 30_000 });

    const value = await uri.inputValue();
    expect(value.startsWith("data:image/png;base64,")).toBe(true);
    const decoded = Buffer.from(value.slice(value.indexOf(",") + 1), "base64");
    expect(decoded.equals(pngAlpha.buffer)).toBe(true);
    expectSameImage(
      await compareImages(page, { bytes: pngAlpha.buffer, mime: "image/png" }, { bytes: decoded, mime: "image/png" }),
      { maxMae: IMAGE_MAE.lossless, maxAlphaMae: 0.5, label: "image-to-base64 (png)" },
    );

    await page.getByRole("button", { name: "Raw Base64", exact: true }).click();
    const raw = page.getByLabel("Raw Base64 output");
    expect(await raw.inputValue(), "raw mode is the payload without the data: prefix").toBe(
      pngAlpha.buffer.toString("base64"),
    );
  });

  test("an AVIF round-trips byte for byte under its own MIME type", async ({ page }) => {
    const avif = await sample("sample.avif", "image/avif");
    const uri = await encode(page, avif);
    const value = await uri.inputValue();
    expect(value.startsWith("data:image/avif;base64,")).toBe(true);
    expect(Buffer.from(value.slice(value.indexOf(",") + 1), "base64").equals(avif.buffer)).toBe(true);
  });
});
