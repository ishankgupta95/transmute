import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import * as UTIF from "utif2";
import { animatedGif, animatedWebp, multiPageTiff, tinyWebp } from "../fixtures";
// Relative on purpose: Playwright's transpiler resolves relative .ts imports,
// and image-frames is a leaf module, so nothing app-side comes with it.
import { firstFrameWarning } from "../../../lib/tools/image-frames";
import { convert, probeImageInPage } from "./support";
import { assertJpeg, assertPng, assertWebp } from "./validators";

/**
 * Frame-0 honesty: every canvas pipeline keeps exactly one raster — frame 0
 * of an animated source, page 0 of a multi-page TIFF. These pin the two
 * halves of the fix: the output is still a valid single-frame image, and the
 * UI SAYS the rest was dropped, with the exact origin string.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i,
 * so titles say "animated image" — these cases must run in BOTH engines.
 */

const FIRST_FRAME_RE = /only its first frame was kept/;

test.describe("first-frame and first-page warnings", () => {
  test("fixture sanity: the animated and multi-page builders emit what they claim", async () => {
    // The rest of this file leans on these fixtures — prove they parse with
    // the same decoders/sniffers the app ships before trusting a green run.
    expect(firstFrameWarning(new Uint8Array(animatedGif().buffer))).toBe(
      "This GIF is animated — only its first frame was kept.",
    );
    expect(firstFrameWarning(new Uint8Array(animatedWebp().buffer))).toBe(
      "This WebP is animated — only its first frame was kept.",
    );
    expect(firstFrameWarning(new Uint8Array(tinyWebp().buffer))).toBeNull();

    const tiff = multiPageTiff(3);
    const ab = tiff.buffer.buffer.slice(
      tiff.buffer.byteOffset,
      tiff.buffer.byteOffset + tiff.buffer.byteLength,
    ) as ArrayBuffer;
    const ifds = UTIF.decode(ab);
    expect(ifds.length).toBe(3);
    UTIF.decodeImage(ab, ifds[0]);
    expect({ w: ifds[0].width, h: ifds[0].height }).toEqual({ w: 40, h: 30 });
    expect(UTIF.toRGBA8(ifds[0]).length).toBe(40 * 30 * 4);
  });

  test("webp-to-jpg flattens an animated image to frame 0 and says so", async ({ page }) => {
    const fixture = animatedWebp();
    // Byte-level proof the fixture is genuinely animated, so a green run can
    // never mean "the sniffer and the fixture are both duds".
    const info = assertWebp(fixture.buffer);
    expect(info.animated).toBe(true);
    expect(info.anmfCount).toBeGreaterThanOrEqual(2);

    const { bytes } = await convert(page, {
      slug: "webp-to-jpg",
      input: fixture,
      action: /^Convert$/,
    });

    assertJpeg(bytes);
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 1, height: 1 });
    await expect(
      page.getByText("This WebP is animated — only its first frame was kept.", { exact: true }),
    ).toBeVisible();
  });

  test("webp-to-png warns about an animated image too", async ({ page }) => {
    const { bytes } = await convert(page, {
      slug: "webp-to-png",
      input: animatedWebp(),
      action: /^Convert$/,
    });

    assertPng(bytes);
    await expect(
      page.getByText("This WebP is animated — only its first frame was kept.", { exact: true }),
    ).toBeVisible();
  });

  test("compress-image hands back the animated original untouched — and claims no loss", async ({
    page,
  }) => {
    /*
      The never-grow half of compress-image's animated story (the re-encode
      half is the noisy case below). The ~150-byte animated WebP fixture is
      smaller than any canvas re-encode, so never-grow returns the untouched
      original — which still carries BOTH its frames. "Only its first frame
      was kept" would be a lie on that result: the download must be
      byte-identical to the input and the UI must show no warning at all.
    */
    const fixture = animatedWebp();
    const { name, bytes } = await convert(page, {
      slug: "compress-image",
      input: fixture,
      action: /^Compress$/,
    });

    expect(name).toBe(fixture.name);
    expect(Buffer.compare(bytes, fixture.buffer)).toBe(0);
    // Scoped to the tool surface: FAQ copy quotes the warning verbatim.
    await expect(page.locator("[data-tool-surface]").getByText(FIRST_FRAME_RE)).toHaveCount(0);
  });

  test("compress-image re-encodes a noisy animated image to a smaller still and says so", async ({
    page,
  }) => {
    /*
      The re-encode half: 256×256 of seeded per-pixel noise, twice. LZW cannot
      compress noise while a JPEG re-encode still can, so the output genuinely
      shrinks (never-grow stays out of the way) and the loss warning MUST
      attach — chooseOutput sends an opaque source down the JPEG path.
    */
    const fixture = animatedGif(256, 256, { noise: true });
    // Byte-level proof the noisy build is still genuinely animated, so a green
    // run can never mean "the builder quietly dropped to one frame".
    expect(firstFrameWarning(new Uint8Array(fixture.buffer))).toBe(
      "This GIF is animated — only its first frame was kept.",
    );

    const { bytes } = await convert(page, {
      slug: "compress-image",
      input: fixture,
      action: /^Compress$/,
    });

    assertJpeg(bytes);
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 256, height: 256 });
    // Strictly smaller — proves the download is a re-encode, not the
    // never-grow original (which would carry no warning and both frames).
    expect(bytes.length).toBeLessThan(fixture.buffer.length);
    await expect(
      page.getByText("This GIF is animated — only its first frame was kept.", { exact: true }),
    ).toBeVisible();
  });

  test("resize-image warns for an animated image and outputs a still", async ({ page }) => {
    // resize-image is the tool whose accept list really takes GIFs, so the
    // GIF origin string gets its in-UI assertion here.
    const { name, bytes } = await convert(page, {
      slug: "resize-image",
      input: animatedGif(),
      action: /^Resize$/,
      setup: async (p) => {
        // Percentage mode needs no source-dependent numbers: 50% of 16×16.
        await p.getByRole("button", { name: "%", exact: true }).click();
      },
    });

    await expect(
      page.getByText("This GIF is animated — only its first frame was kept.", { exact: true }),
    ).toBeVisible();

    // GIF sources resize to alpha-capable PNG (resizeOutputFormat).
    expect(name).toMatch(/\.png$/);
    assertPng(bytes);
    const dims = await probeImageInPage(page, bytes, "image/png");
    expect(dims).toEqual({ width: 8, height: 8 });
  });

  test("tiff-to-jpg keeps page one of a multi-page scan and says so", async ({ page }) => {
    const fixture = multiPageTiff(3);
    const { bytes } = await convert(page, {
      slug: "tiff-to-jpg",
      input: fixture,
      action: /^Convert$/,
    });

    assertJpeg(bytes);
    // Page 0 is 40×30; later pages shrink, so the wrong IFD cannot pass.
    const dims = await probeImageInPage(page, bytes, "image/jpeg");
    expect(dims).toEqual({ width: 40, height: 30 });
    await expect(page.getByText(/This TIFF has 3 pages/)).toBeVisible();
  });

  test("a still image converts without any first-frame warning", async ({ page }) => {
    const { bytes } = await convert(page, {
      slug: "webp-to-jpg",
      input: tinyWebp(),
      action: /^Convert$/,
    });

    assertJpeg(bytes);
    // The download exists AND no warning is shown — the sniffer must stay
    // quiet for a single-frame source, or every WebP user learns to ignore it.
    // Scoped to the tool surface: FAQ copy quotes the warning verbatim.
    await expect(page.locator("[data-tool-surface]").getByText(FIRST_FRAME_RE)).toHaveCount(0);
  });
});
