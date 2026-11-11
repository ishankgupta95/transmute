import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import type { FixtureFile } from "../helpers";
import {
  uploadFixture,
  downloadAffordance,
  captureDownload,
  toolError,
} from "./support";
import { assertGif } from "./validators";
import { compareImages, expectSameImage } from "./fidelity";

/**
 * gif-speed-changer. "Every frame delay is rescaled and no frames are added or
 * dropped" — so the output's delays are checked frame by frame against the
 * source's, and the picture of the first frame against the source's.
 *
 * The fixture has FIVE frames with five DIFFERENT delays on purpose: a tool that
 * wrote one uniform delay (the average, or frame 0's) would still scale the
 * total correctly and only a per-frame check catches it. Delays are chosen so
 * every scaled value lands on GIF's 10 ms grid without a rounding tie:
 *
 *   source        80  200  400  600   40   (sum 1320)
 *   x2   (200%)   40  100  200  300   20   (the 20 ms floor: 40/2 = 20)
 *   x0.5 (50%)   160  400  800 1200   80
 *   x4   (400%)   20   50  100  150   20   (80/4 and 40/4 sit at/below the 20 ms floor)
 *   x0.25 (25%)  320  800 1600 2400  160
 *
 * "gif" in the file path keeps this out of conversion-webkit (that project
 * drops /gif|FFmpeg|MP4/i by design), so it runs in Chromium only.
 */

const SOURCE_DELAYS = [80, 200, 400, 600, 40];
const W = 64;
const H = 48;

function buildGif(): FixtureFile {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GIFEncoder, quantize, applyPalette } = require("gifenc") as typeof import("gifenc");
  const gif = GIFEncoder();
  // Distinct hue per frame, with a left-to-right ramp so there is structure
  // for the picture comparison to correlate against.
  const hues: [number, number, number][] = [
    [220, 40, 40],
    [40, 200, 60],
    [40, 90, 220],
    [230, 190, 20],
    [160, 40, 200],
  ];
  SOURCE_DELAYS.forEach((delay, i) => {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const ramp = 0.35 + 0.65 * (x / (W - 1));
        const stripe = y < H / 2 ? 1 : 0.6;
        rgba[p] = Math.round(hues[i][0] * ramp * stripe);
        rgba[p + 1] = Math.round(hues[i][1] * ramp * stripe);
        rgba[p + 2] = Math.round(hues[i][2] * ramp * stripe);
        rgba[p + 3] = 255;
      }
    }
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, W, H, { palette, delay, ...(i === 0 ? { repeat: 0 } : {}) });
  });
  gif.finish();
  return { name: "five-frames.gif", mimeType: "image/gif", buffer: Buffer.from(gif.bytes()) };
}

async function openWithSource(page: Page): Promise<FixtureFile> {
  const fixture = buildGif();
  // Prove the fixture is what the test claims before using it as the oracle.
  const src = assertGif(fixture.buffer);
  expect(src.delaysMs).toEqual(SOURCE_DELAYS);
  expect(src.frames).toBe(5);
  await page.goto("/gif-speed-changer");
  await uploadFixture(page, fixture);
  // Uploading runs the tool once at 100%.
  await expect(downloadAffordance(page), `first run failed: ${await toolError(page)}`).toBeVisible({
    timeout: 60_000,
  });
  return fixture;
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

test.describe("gif-speed-changer — frame delays really scale", () => {
  test("100% keeps every delay and every frame", async ({ page }) => {
    const fixture = await openWithSource(page);
    const { name, bytes } = await captureDownload(page, downloadAffordance(page));

    expect(name).toBe("five-frames-respeed.gif");
    const out = assertGif(bytes);
    expect(out.frames).toBe(5);
    expect(out.delaysMs).toEqual(SOURCE_DELAYS);
    expect({ width: out.width, height: out.height }).toEqual({ width: W, height: H });
    expectSameImage(
      await compareImages(page, { bytes: fixture.buffer, mime: "image/gif" }, { bytes, mime: "image/gif" }),
      { label: "gif-speed-changer 100%" },
    );
  });

  const CASES = [
    { speed: 200, label: "twice as fast", delays: [40, 100, 200, 300, 20] },
    { speed: 50, label: "half speed", delays: [160, 400, 800, 1200, 80] },
    { speed: 25, label: "a quarter speed (slider minimum)", delays: [320, 800, 1600, 2400, 160] },
    { speed: 400, label: "four times as fast (slider maximum, floor engages)", delays: [20, 50, 100, 150, 20] },
  ] as const;

  for (const c of CASES) {
    test(`${c.speed}% plays ${c.label}: per-frame delays scale, frame count and picture are unchanged`, async ({ page }) => {
      const fixture = await openWithSource(page);

      await page.getByRole("slider").fill(String(c.speed));
      await page.getByRole("button", { name: "Change speed", exact: true }).click();

      // The footnote reports the new total; waiting on it is what tells the
      // re-run apart from the 100% result still on screen.
      const total = (sum([...c.delays]) / 1000).toFixed(2);
      await expect(
        page.locator("[data-tool-surface]").getByText(new RegExp(`5 FRAMES · ${total.replace(".", "\\.")}s`)),
        `the readout should report ${total}s; error: ${await toolError(page)}`,
      ).toBeVisible({ timeout: 60_000 });

      const { bytes } = await captureDownload(page, downloadAffordance(page));
      const out = assertGif(bytes);
      expect(out.frames, "no frames added or dropped").toBe(5);
      expect(out.delaysMs, `each delay scaled by 100/${c.speed}`).toEqual([...c.delays]);
      expect(out.durationMs).toBe(sum([...c.delays]));
      expect({ width: out.width, height: out.height }).toEqual({ width: W, height: H });
      expectSameImage(
        await compareImages(page, { bytes: fixture.buffer, mime: "image/gif" }, { bytes, mime: "image/gif" }),
        { label: `gif-speed-changer ${c.speed}%` },
      );
    });
  }
});
