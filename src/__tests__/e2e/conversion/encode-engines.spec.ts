import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeVideoInPage,
  toolError,
} from "./support";
import { assertMp4 } from "./validators";
import { compareVideoToSource, expectVideoMatches } from "./fidelity";

/**
 * compress-video, judged on content. Written as the guard for two WebKit bugs
 * found and fixed 2026-11-11 (both fixes are in shipped code and harmless in
 * Chromium):
 *
 *  1. HANG. WebKit's `isConfigSupported` says yes to H.264 High and Main, but
 *     those encoders return four frames and then deadlock — nothing from the
 *     fifth on, `flush()` never settles. `pickH264Config` took High, so
 *     compress-video (and webm-to-mp4, and the trimmer's Exact frame) sat at
 *     15–32% forever with no error. Fix: the picker now proves a config with an
 *     8-frame probe (`video-utils.ts`, unit-tested in h264-probe.test.ts).
 *  2. RAW LIBRARY ERROR. With the hang gone, WebKit's chunks carry
 *     `duration: null`, which mp4-muxer rejects; the page then showed "null is
 *     not an object (evaluating 'track.info.decoderConfig.colorSpace')". Fix:
 *     `mux-chunk.ts` supplies the duration (unit-tested in mux-chunk.test.ts).
 *
 * Chromium-only since 2026-11-11 (the product targets Chromium browsers), so
 * this now runs where both fixes are inert; it stays as the content check for
 * compress-video's output. The WebKit colour shift that was found here (up to
 * ~35 levels per channel, varying per run, structure correct) was never fixed
 * and is out of scope.
 */

async function compressFixture(page: import("@playwright/test").Page) {
  const source = await SAMPLES.mp4();
  await page.goto("/compress-video");
  await uploadFixture(page, source);
  await primaryAction(page, /^Compress$/).click();
  const dl = downloadAffordance(page);
  await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
  expect(await toolError(page), "no error may sit beside a finished result").toBeNull();
  const { bytes } = await captureDownload(page, dl);
  const { matches } = await compareVideoToSource(
    page,
    { bytes: source.buffer, mime: "video/mp4" },
    { bytes, mime: "video/mp4" },
    { outTimes: [0.25, 0.75, 1.25, 1.7] },
  );
  return { bytes, matches };
}

test("compress-video finishes with the source's frames and colours", async ({ page }) => {
  const { bytes, matches } = await compressFixture(page);
  assertMp4(bytes, { video: true, audio: true });
  const probe = await probeVideoInPage(page, bytes, "video/mp4");
  expect({ width: probe.width, height: probe.height }).toEqual({ width: 320, height: 240 });
  expect(Math.abs(probe.duration - 2.09), `duration ${probe.duration}s`).toBeLessThan(0.3);
  expectVideoMatches(matches, { label: "compress-video" });
});
