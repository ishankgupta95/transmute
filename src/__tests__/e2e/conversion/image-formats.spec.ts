import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { multiPageTiff, tinyTiff } from "../fixtures";
import type { FixtureFile } from "../helpers";
import {
  sample,
  convert,
  captureDownload,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  probeImageInPage,
  toolError,
  watchEngineRequests,
} from "./support";
import { assertJpeg, assertPng, assertWebp } from "./validators";

/**
 * The seven registry-only format fills of the Wave 4 image cluster:
 * `tiff-to-png`, `avif-to-png`, `avif-to-webp`, `bmp-to-png`, `svg-to-jpg`,
 * `svg-to-webp` and `heic-to-webp`. They ship no new code — every one mounts
 * `ImageConverterUI` on the existing `image-convert` toolType — which is
 * exactly why they need this file rather than being covered by it elsewhere:
 * a wrong `sourceFormat`/`targetFormat` pair in `tools.ts` is a pure data bug
 * that renders perfectly and hands the user the wrong bytes. Nothing in the
 * unit suite can see it (jsdom has no canvas), and a page smoke cannot either.
 *
 * So every test here reads the PIXELS back out, not just the magic bytes. The
 * fixtures are built two-toned and non-square on purpose: a converter that
 * emitted an empty canvas, transposed the axes, or flipped the rows still
 * produces a structurally valid file, and only a pixel assertion fails on it.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i
 * against project name + file path + describe + test title, so a stray one of
 * those words silently drops a test from WebKit — which is the only engine
 * that exercises the two refusal branches below. Keep all three out.
 */

// ────────────────────────────────────────────────────────────────────────────
// Local fixtures and probes
// ────────────────────────────────────────────────────────────────────────────

/**
 * A 40×24 BMP in four quadrants of flat colour, 24-bit BGR, bottom-up.
 *
 * `../fixtures`'s `tinyBmp()` is 4×4 and one flat colour, which makes a
 * dimension assertion nearly vacuous and a pixel assertion completely so —
 * every pixel is the same, so a decoder that returned the wrong row, the wrong
 * column or the wrong orientation is indistinguishable from a correct one.
 * BMP stores its rows bottom-up, which is precisely the mistake worth
 * catching, so this one differs top from bottom AND left from right.
 */
function quadrantBmp(): FixtureFile {
  const width = 40;
  const height = 24;
  // 40 px × 3 bytes = 120, already a multiple of 4 — no row padding needed,
  // but compute it rather than assume, so a future size change stays correct.
  const rowSize = Math.ceil((24 * width) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const buf = Buffer.alloc(54 + pixelArraySize);

  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(54, 10); // pixel array offset
  buf.writeUInt32LE(40, 14); // BITMAPINFOHEADER size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22); // positive = bottom-up rows
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30); // BI_RGB
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = BMP_QUADRANTS[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)];
      // Row 0 of the pixel array is the BOTTOM row of the image.
      const offset = 54 + (height - 1 - y) * rowSize + x * 3;
      buf[offset] = b;
      buf[offset + 1] = g;
      buf[offset + 2] = r;
    }
  }
  return { name: "sample.bmp", mimeType: "image/bmp", buffer: buf };
}

/** Image-space quadrant colours: top-left, top-right, bottom-left, bottom-right. */
const BMP_QUADRANTS: ReadonlyArray<readonly [number, number, number]> = [
  [200, 30, 40],
  [30, 160, 80],
  [40, 80, 200],
  [230, 190, 20],
];

/** The same four, in the AVIF fixture (`generate-test-fixtures.mjs --avif`). */
const AVIF_QUADRANTS: ReadonlyArray<readonly [number, number, number]> = [
  [220, 40, 60],
  [30, 160, 80],
  [40, 80, 200],
  [230, 190, 20],
];

/**
 * An SVG whose top half is genuinely nothing.
 *
 * `../fixtures`'s `tinySvg()` and the checked-in `sample-vector.svg` both
 * paint an opaque background over the whole viewBox, so neither can tell the
 * three SVG rasterisers apart: transparency is the ONLY thing that differs
 * between `svg-to-png`, `svg-to-webp` (keep it) and `svg-to-jpg` (flatten it
 * onto white — the page's copy says white, and black is what a canvas that
 * skipped the fill would give you). Explicit width/height, so the output size
 * is the document's own rather than the 1024px viewBox-only floor, and
 * non-square so a transposition cannot pass.
 */
function halfTransparentSvg(): FixtureFile {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40" viewBox="0 0 64 40">' +
    '<rect x="0" y="20" width="64" height="20" fill="#c81e28"/></svg>';
  return { name: "sample.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg, "utf8") };
}

/** The `#c81e28` the SVG above paints its bottom half with. */
const SVG_INK: readonly [number, number, number] = [200, 30, 40];

type Rgba = [number, number, number, number];

/**
 * Decode image bytes in the page and read individual pixels back.
 *
 * `probeImageInPage` answers "what size is it", which a converter that handed
 * back a correctly-sized empty canvas also satisfies. This answers "what is
 * actually in it". Points are in image space; the returned tuples are
 * un-premultiplied RGBA straight out of `getImageData`.
 */
async function pixelsInPage(
  page: Page,
  bytes: Buffer,
  mime: string,
  points: ReadonlyArray<readonly [number, number]>,
): Promise<Rgba[]> {
  return page.evaluate(
    async ({
      b64,
      type,
      pts,
    }: {
      b64: string;
      type: string;
      pts: ReadonlyArray<readonly [number, number]>;
    }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([buf], { type }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data) as number[]);
    },
    { b64: bytes.toString("base64"), type: mime, pts: points },
  ) as Promise<Rgba[]>;
}

/** Assert a pixel's RGB is `want` within `tol` per channel, and it is opaque. */
function expectRgb(
  got: Rgba,
  want: readonly [number, number, number],
  tol: number,
  what: string,
): void {
  expect(got[3], `${what} must be opaque`).toBe(255);
  for (let c = 0; c < 3; c++) {
    expect(
      Math.abs(got[c] - want[c]),
      `${what} channel ${"rgb"[c]}: expected ~${want[c]}, got ${got[c]} (full pixel ${got.join()})`,
    ).toBeLessThanOrEqual(tol);
  }
}

/**
 * Whether this engine's canvas can genuinely encode WebP. Chromium can and
 * WebKit cannot, which is why the two WebP tests below branch instead of
 * skipping the engine that takes the other path.
 */
function canEncodeWebp(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  });
}

// ────────────────────────────────────────────────────────────────────────────

test.describe("registry-only format fills — real output", () => {
  test("tiff-to-png decodes a real TIFF losslessly and does not cry wolf about pages", async ({
    page,
  }) => {
    /*
      utif2 is the decoder and PNG is lossless end to end, so this asserts
      EXACT pixel values, not a tolerance. 40×30 and two-toned: the wrong axis
      order or an empty canvas both fail. The page also promises it counts the
      pages and tells you — on a ONE-page file that notice must not appear, or
      it teaches every user to ignore it.
    */
    const { name, bytes } = await convert(page, {
      slug: "tiff-to-png",
      input: tinyTiff(40, 30),
      action: /^Convert$/,
    });

    expect(name).toBe("sample-40x30.png");
    expect(assertPng(bytes)).toEqual({ width: 40, height: 30 });
    const [left, right] = await pixelsInPage(page, bytes, "image/png", [
      [8, 15],
      [32, 15],
    ]);
    expectRgb(left, [210, 60, 40], 0, "TIFF left half");
    expectRgb(right, [40, 90, 200], 0, "TIFF right half");

    // Scoped to [data-tool-surface]: the page's FAQ copy talks about pages too.
    await expect(
      page.locator("[data-tool-surface]").getByText(/only the first page was kept/),
    ).toHaveCount(0);
  });

  test("tiff-to-png keeps page one of a multi-page scan and names the real count", async ({
    page,
  }) => {
    /*
      The claim on the page is specific — it says how many pages it found — so
      the assertion is specific: "3 pages", not /\d+ pages/. Page 0 is 40×30
      and later pages shrink to 32×24 and 24×18, and page 0's fill is the only
      red one, so neither a wrong IFD nor a decode that returned nothing can
      pass both the dimension and the pixel check.
    */
    const { bytes } = await convert(page, {
      slug: "tiff-to-png",
      input: multiPageTiff(3),
      action: /^Convert$/,
    });

    expect(assertPng(bytes)).toEqual({ width: 40, height: 30 });
    const [px] = await pixelsInPage(page, bytes, "image/png", [[20, 15]]);
    expectRgb(px, [210, 60, 40], 0, "TIFF page 0 fill");

    await expect(
      page.getByText("This TIFF has 3 pages — only the first page was kept.", { exact: true }),
    ).toBeVisible();
  });

  test("bmp-to-png keeps every pixel exactly, right way up, in fewer bytes", async ({
    page,
  }) => {
    /*
      The page's whole pitch is "the file gets substantially smaller and not a
      single pixel changes", so both halves of that sentence are asserted here.
      BMP rows are stored bottom-up: the quadrant fixture differs top from
      bottom, so a pipeline that took the rows in file order fails on the
      top-left pixel rather than passing silently.
    */
    const bmp = quadrantBmp();
    const { name, bytes } = await convert(page, {
      slug: "bmp-to-png",
      input: bmp,
      action: /^Convert$/,
    });

    expect(name).toBe("sample.png");
    expect(assertPng(bytes)).toEqual({ width: 40, height: 24 });
    const corners = await pixelsInPage(page, bytes, "image/png", [
      [4, 4],
      [36, 4],
      [4, 20],
      [36, 20],
    ]);
    const labels = ["top-left", "top-right", "bottom-left", "bottom-right"];
    corners.forEach((px, i) => expectRgb(px, BMP_QUADRANTS[i], 0, `BMP ${labels[i]}`));

    expect(
      bytes.length,
      "an uncompressed bitmap must not come back as a LARGER lossless PNG",
    ).toBeLessThan(bmp.buffer.length);
  });

  test("svg-to-jpg rasterises the vector and flattens transparency onto WHITE", async ({
    page,
  }) => {
    /*
      THE trap on this page, and one this repo has hit before: a canvas is
      transparent-black until something fills it, so a JPEG encode of an
      unfilled canvas turns every clear region BLACK. The page's copy promises
      white ("a white logo on a clear background comes back as a white
      rectangle"), so white is what gets asserted — with the ink half checked
      too, since a canvas painted entirely white would otherwise pass.

      JPEG is lossy, hence the tolerances; they are far tighter than the
      distance between white and black, which is the failure being excluded.
    */
    const { name, bytes } = await convert(page, {
      slug: "svg-to-jpg",
      input: halfTransparentSvg(),
      action: /^Convert$/,
    });

    expect(name).toBe("sample.jpg");
    assertJpeg(bytes);
    // The SVG declares width/height, so those pixels are used as-is — not the
    // 1024px viewBox-only floor, and not the UA's 300×150 replaced-element
    // default that the sizing code exists to override.
    expect(await probeImageInPage(page, bytes, "image/jpeg")).toEqual({
      width: 64,
      height: 40,
    });

    const [clear, ink] = await pixelsInPage(page, bytes, "image/jpeg", [
      [32, 6],
      [32, 32],
    ]);
    expectRgb(clear, [255, 255, 255], 5, "the transparent half of the SVG");
    expectRgb(ink, SVG_INK, 12, "the painted half of the SVG");
  });

  test("svg-to-webp keeps the transparency, or refuses where the browser can't write it", async ({
    page,
  }) => {
    /*
      Two correct outcomes, one per engine, and this spec runs in both.
      `canvas.toBlob` does not fail for a type it cannot encode — it silently
      writes PNG — and WebKit is the live case, which is how this very page
      once shipped 42 KB of PNG named `.webp` (image-convert.ts:72-80). The
      third outcome, PNG bytes under a `.webp` name, is what this forbids.
    */
    await page.goto("/svg-to-webp");
    const webp = await canEncodeWebp(page);
    await uploadFixture(page, halfTransparentSvg());
    await primaryAction(page, /^Convert$/).click();

    if (!webp) {
      await expect(
        page.locator('[role="alert"]').filter({ hasText: /\S/ }),
      ).toContainText("This browser cannot write WEBP images.");
      await expect(
        downloadAffordance(page),
        "a refused encode must offer nothing to download",
      ).toHaveCount(0);
      return;
    }

    const dl = downloadAffordance(page);
    await expect(dl, `rasterise failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample.webp");
    // A genuine RIFF/WEBP container — the exact thing the PNG substitution
    // would break — and a still, not an animation.
    expect(assertWebp(bytes).animated).toBe(false);
    expect(await probeImageInPage(page, bytes, "image/webp")).toEqual({
      width: 64,
      height: 40,
    });

    const [clear, ink] = await pixelsInPage(page, bytes, "image/webp", [
      [32, 6],
      [32, 32],
    ]);
    // The page's promise, in one number: alpha 0 where the SVG drew nothing.
    // (RGB under a zero alpha is meaningless after un-premultiplying, so only
    // the alpha is read there.)
    expect(clear[3], "svg-to-webp must keep the transparency, not flatten it").toBe(0);
    expectRgb(ink, SVG_INK, 12, "the painted half of the SVG");
  });

  test("avif-to-png decodes AVIF with the browser's own decoder, losslessly", async ({
    page,
  }) => {
    /*
      `sample.avif` is the one fixture in the repo a browser could not have
      made: `canvas.toBlob("image/avif")` silently returns PNG, so it is
      encoded losslessly by libaom via sharp at build time
      (`generate-test-fixtures.mjs --avif`). Lossless in, lossless out, so the
      quadrant colours are asserted EXACTLY — a tolerance here would also
      accept the second lossy generation this page's copy promises there isn't.
    */
    const { name, bytes } = await convert(page, {
      slug: "avif-to-png",
      input: await sample("sample.avif", "image/avif"),
      action: /^Convert$/,
    });

    expect(name).toBe("sample.png");
    expect(assertPng(bytes)).toEqual({ width: 48, height: 32 });

    const [tl, tr, bl, br, clear] = await pixelsInPage(page, bytes, "image/png", [
      [8, 12],
      [40, 12],
      [8, 24],
      [40, 24],
      [24, 3],
    ]);
    // The quadrant split is at y=16, and rows 0-7 are the transparent band, so
    // the two "top" quadrants only exist in rows 8-15 — hence y=12, not y=20.
    expectRgb(tl, AVIF_QUADRANTS[0], 0, "AVIF top-left");
    expectRgb(tr, AVIF_QUADRANTS[1], 0, "AVIF top-right");
    expectRgb(bl, AVIF_QUADRANTS[2], 0, "AVIF bottom-left");
    expectRgb(br, AVIF_QUADRANTS[3], 0, "AVIF bottom-right");
    // "an alpha channel comes through intact" — the reason the page exists
    // rather than pointing everyone at avif-to-jpg.
    expect(clear[3], "PNG output must keep the AVIF's alpha channel").toBe(0);
  });

  test("avif-to-webp writes a real container, or refuses where the browser can't", async ({
    page,
  }) => {
    // Same two-outcome shape as svg-to-webp, on the other input format. Worth
    // its own test rather than a parameter: this one goes through the worker
    // pool (image-client.ts) while the SVG one takes the main-thread fallback,
    // and each carries its own copy of the substitution check.
    const fixture = await sample("sample.avif", "image/avif");

    await page.goto("/avif-to-webp");
    const webp = await canEncodeWebp(page);
    await uploadFixture(page, fixture);
    await primaryAction(page, /^Convert$/).click();

    if (!webp) {
      await expect(
        page.locator('[role="alert"]').filter({ hasText: /\S/ }),
      ).toContainText("This browser cannot write WEBP images.");
      await expect(
        downloadAffordance(page),
        "a refused encode must offer nothing to download",
      ).toHaveCount(0);
      return;
    }

    const dl = downloadAffordance(page);
    await expect(dl, `conversion failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample.webp");
    expect(assertWebp(bytes).animated).toBe(false);
    expect(await probeImageInPage(page, bytes, "image/webp")).toEqual({
      width: 48,
      height: 32,
    });

    const [tl, br, clear] = await pixelsInPage(page, bytes, "image/webp", [
      [8, 12], // rows 8-15: below the transparent band, above the y=16 split
      [40, 24],
      [24, 3],
    ]);
    // WebP is the lossy leg here — "a second generation", as the copy says —
    // so these are tolerances. They are still an order of magnitude tighter
    // than the gap between any two of the four quadrants.
    expectRgb(tl, AVIF_QUADRANTS[0], 16, "AVIF top-left");
    expectRgb(br, AVIF_QUADRANTS[3], 16, "AVIF bottom-right");
    expect(clear[3], "WebP output must keep the AVIF's alpha channel").toBe(0);
  });

  /*
    HEIC USED TO BE THE ONE INPUT THIS FILE COULD NOT SYNTHESISE, and the note
    that stood here said so: the decoder decodes but never encodes, and sharp's
    HEIF support refuses HEVC in this build. Both halves were true, and both
    were about the wrong machine. macOS has an HEVC still-image encoder behind
    ImageIO, so `generate-test-fixtures.mjs --heic` writes two REAL `.heic`
    files — brand `heic`, `hvc1` items — and they are checked in. What follows
    is a real decode of real HEVC, which this suite has never had.
  */
  test("heic-to-jpg really decodes HEVC, from a decoder served by this origin", async ({
    page,
  }) => {
    /*
      Two claims in one pass, because the fetch only happens once:

        1. The 1.4 MB decoder must come from OUR origin. libheif-js ships
           libheif and libde265, both LGPL, and the licensing posture rests on
           them being replaceable same-origin files under /vendor/ rather than
           something bundled or pulled off a CDN (image-convert.ts's
           `loadLibheif`). Nothing else in the E2E tree watches that fetch.
        2. The pixels are really decoded. A solid fill is the right shape for
           this: HEVC's own losses cannot move a flat field far, so a tight
           tolerance here still fails loudly on a decoder that returned noise,
           an empty canvas, or the wrong plane order.
    */
    const glue = watchEngineRequests(page, {
      label: "libheif.js",
      isEngine: (url) => /\/vendor\/libheif\.js(\?|#|$)/.test(url),
    });
    const binary = watchEngineRequests(page, {
      label: "libheif.wasm",
      isEngine: (url) => /\/vendor\/libheif\.wasm(\?|#|$)/.test(url),
    });

    const fixture = await sample("sample-photo.heic", "image/heic");

    await page.goto("/heic-to-jpg");
    await expect(page.locator('input[type="file"]').first()).toHaveAttribute(
      "accept",
      ".heic,.heif",
    );

    await uploadFixture(page, fixture);
    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `conversion failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-photo.jpg");
    expect(await probeImageInPage(page, bytes, "image/jpeg")).toEqual({
      width: 800,
      height: 600,
    });

    const [centre] = await pixelsInPage(page, bytes, "image/jpeg", [[400, 300]]);
    expectRgb(centre, [48, 133, 198], 12, "HEIC fill colour");

    // Both halves of the engine were fetched — so the assertion means
    // something — and every fetch of each came from this origin.
    glue.assertSelfHostedAndUsed();
    binary.assertSelfHostedAndUsed();
  });

  test("heic-to-jpg keeps the primary image of a burst and says the others were dropped", async ({
    page,
  }) => {
    /*
      `sample-burst.heic` holds three pictures at three sizes, and the PRIMARY
      one is the MIDDLE entry — 64x48, green — precisely so that a decoder
      which takes index 0 hands back the 120x90 red one and fails here. The
      decoder this page used until 2026-09-12 did exactly that.

      The warning is the other half. A HEIC that loses two of its three
      pictures in silence is the same defect Wave 0 purged for animated
      GIF/WebP and multi-page TIFF; this is that class closed on the last
      format that still had it.
    */
    const fixture = await sample("sample-burst.heic", "image/heic");

    await page.goto("/heic-to-jpg");
    await uploadFixture(page, fixture);
    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `conversion failed: ${await toolError(page)}`).toBeVisible();
    const { bytes } = await captureDownload(page, dl);

    expect(
      await probeImageInPage(page, bytes, "image/jpeg"),
      "the primary image is the 64x48 middle entry, not the 120x90 at index 0",
    ).toEqual({ width: 64, height: 48 });

    const [centre] = await pixelsInPage(page, bytes, "image/jpeg", [[32, 24]]);
    expectRgb(centre, [0, 166, 66], 12, "primary (green) burst frame");

    await expect(
      page.locator("[data-tool-surface]").getByText(/This HEIC holds 3 images/),
      "a burst that lost two pictures must say so",
    ).toBeVisible();
  });

  test("heic-to-jpg turns a sideways phone photo the right way up", async ({ page }) => {
    /*
      The single most common real complaint about HEIC conversion is a portrait
      photo arriving on its side, and HEIF does not store that the way JPEG
      does: the rotation is an `irot` PROPERTY on the item, not an EXIF tag a
      canvas pipeline would trip over.

      `sample-rotated.heic` is a 120x60 LANDSCAPE raster carrying orientation 6,
      so a decoder that ignores `irot` hands back 120x60 and the test fails on
      the dimensions alone. The three colour bands run red-green-blue along the
      long axis in either reading, which is what separates a real rotation from
      a transposed width/height — the bands are checked too, so a decoder that
      merely swapped the numbers cannot pass.
    */
    const fixture = await sample("sample-rotated.heic", "image/heic");

    await page.goto("/heic-to-jpg");
    await uploadFixture(page, fixture);
    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `conversion failed: ${await toolError(page)}`).toBeVisible();
    const { bytes } = await captureDownload(page, dl);

    expect(
      await probeImageInPage(page, bytes, "image/jpeg"),
      "orientation 6 must be applied: a 120x60 raster becomes a 60x120 picture",
    ).toEqual({ width: 60, height: 120 });

    const [first, middle, last] = await pixelsInPage(page, bytes, "image/jpeg", [
      [30, 20],
      [30, 60],
      [30, 100],
    ]);
    /*
      DOMINANT CHANNEL, not a tolerance on the exact RGB. Saturated primaries
      are the worst case for this chain — HEVC stores chroma at 4:2:0 and JPEG
      subsamples it again — so pure blue comes back as rgb(4,51,255) and a
      tolerance loose enough to admit that (>=51) would be loose enough to stop
      distinguishing the bands, which is the only thing this assertion is for.
      Which channel WINS is unambiguous and cannot survive a wrong band order.
    */
    const dominant = (px: number[]) => ["r", "g", "b"][px.indexOf(Math.max(px[0], px[1], px[2]))];
    expect(
      [dominant(first), dominant(middle), dominant(last)],
      "the bands must read red-green-blue down the rotated picture",
    ).toEqual(["r", "g", "b"]);
  });

  test("heic-to-webp refuses a file that isn't HEIC", async ({ page }) => {
    /*
      Bytes that are not HEIC must be refused, with no download offered. This
      page cannot sniff its way out of it — the decoder is the only thing that
      can say no — so the failure has to survive the script-tag load, the wasm
      fetch and the batch processor.
    */
    await page.goto("/heic-to-webp");
    await uploadFixture(page, {
      name: "not-really.heic",
      mimeType: "image/heic",
      // Deterministic junk, the same shape support.ts's `corruptFixture` uses.
      buffer: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 197 + 13) & 0xff)),
    });
    await primaryAction(page, /^Convert$/).click();

    await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ })).toBeVisible();
    await expect(
      downloadAffordance(page),
      "a file the decoder rejected must not produce a download",
    ).toHaveCount(0);
  });
});
