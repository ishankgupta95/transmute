import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  forbidCdnCore,
  probeVideoInPage,
  decodeAudioInPage,
  toolError,
} from "./support";
import { assertMp4, assertMp3, assertGif } from "./validators";

/**
 * The heaviest pipelines: FFmpeg.wasm (trim, audio extraction), WebCodecs +
 * mp4-muxer (compression, WebM→MP4) and <video> + gifenc (GIF — no FFmpeg
 * involved, which is why it is the fast one). The fixture is a genuine
 * 2-second 320x240 H.264 clip with an AAC track and moving, detailed frames,
 * so "did anything actually get encoded" is answerable.
 *
 * The FFmpeg core is self-hosted out of `public/` (copied from node_modules by
 * `npm run copy:wasm`), so these exercise the real production load path;
 * `forbidCdnCore` fails the test if it ever regresses to a CDN fetch.
 */

const SOURCE = { width: 320, height: 240, seconds: 2 };

test.describe("video conversions — real output", () => {
  test.beforeEach(async ({ page }) => {
    forbidCdnCore(page);
  });

  test("compress-video re-encodes to a smaller, playable MP4", async ({ page }) => {
    const mp4 = await SAMPLES.mp4();
    await page.goto("/compress-video");
    await uploadFixture(page, mp4);

    await primaryAction(page, /^Compress$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible();
    const { bytes } = await captureDownload(page, dl);

    assertMp4(bytes, { video: true });
    const probe = await probeVideoInPage(page, bytes, "video/mp4");
    expect(probe.width).toBeGreaterThan(0);
    expect(probe.height).toBeGreaterThan(0);
    expect(probe.duration).toBeGreaterThan(SOURCE.seconds - 0.5);
  });

  test("video-trimmer cuts a shorter clip", async ({ page }) => {
    await page.goto("/video-trimmer");
    await uploadFixture(page, await SAMPLES.mp4());

    const start = page.getByLabel("Clip start");
    const end = page.getByLabel("Clip end");
    await expect(start).toBeEnabled({ timeout: 90_000 });
    await start.fill("0.5");
    await end.fill("1.5");

    await primaryAction(page, /^Trim$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `trim failed: ${await toolError(page)}`).toBeVisible();
    const { bytes } = await captureDownload(page, dl);

    assertMp4(bytes, { video: true });
    const probe = await probeVideoInPage(page, bytes, "video/mp4");
    // A 1s cut out of a 2s source — must be meaningfully shorter.
    expect(probe.duration).toBeLessThan(SOURCE.seconds - 0.3);
    expect(probe.duration).toBeGreaterThan(0.3);
  });

  test("video-to-gif emits a multi-frame GIF", async ({ page }) => {
    await page.goto("/video-to-gif");
    await uploadFixture(page, await SAMPLES.mp4());

    await primaryAction(page, /Convert to GIF/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `gif failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.gif$/);
    const gif = assertGif(bytes);
    // A single-frame GIF would mean the frame extraction silently collapsed.
    expect(gif.frames, "GIF should animate").toBeGreaterThan(1);
    expect(gif.width).toBeGreaterThan(0);
    expect(gif.height).toBeGreaterThan(0);
  });

  test("mp4-to-mp3 extracts the AAC track as MP3", async ({ page }) => {
    await page.goto("/mp4-to-mp3");
    await uploadFixture(page, await SAMPLES.mp4());

    await primaryAction(page, /Extract Audio/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `extract failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.mp3$/);
    assertMp3(bytes);

    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(SOURCE.seconds - 0.4);
    expect(decoded.peak, "extracted audio must not be silence").toBeGreaterThan(0.02);
  });

  test("mp4-to-mp3 can be cancelled, and still works afterwards", async ({ page }) => {
    // Stall the core fetch so the tool is reliably still running when we click
    // Cancel — the 2s fixture otherwise finishes first and the click races.
    // This also exercises the hardest abort path: cancelling *during* the load,
    // where the in-flight instance must be discarded rather than published.
    let releaseCore: (() => void) | undefined;
    const coreStalled = new Promise<void>((resolve) => {
      releaseCore = resolve;
    });
    await page.route("**/ffmpeg-core.wasm", async (route) => {
      await coreStalled;
      await route.continue();
    });

    await page.goto("/mp4-to-mp3");
    await uploadFixture(page, await SAMPLES.mp4());

    await primaryAction(page, /Extract Audio/).click();

    // While a job runs, the primary *becomes* the cancel affordance — it is the
    // only reachable control, which is the whole point of the abort work.
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeVisible();
    await cancel.click();

    // A cancel is a user decision, not a failure: straight back to idle with
    // the action offered again, no error banner, and nothing to download.
    await expect(primaryAction(page, /Extract Audio/)).toBeVisible();
    expect(await toolError(page)).toBeNull();
    await expect(downloadAffordance(page)).toHaveCount(0);

    // Cancelling terminates the FFmpeg worker, so the next run has to reload
    // the core from scratch. Prove that recovers instead of wedging the tool.
    releaseCore?.();
    await primaryAction(page, /Extract Audio/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `re-run after cancel failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);
    expect(name).toMatch(/\.mp3$/);
    assertMp3(bytes);
  });

  test("webm-to-mp4 re-encodes VP8/Opus into a playable MP4", async ({ page }) => {
    await page.goto("/webm-to-mp4");
    await uploadFixture(page, await SAMPLES.webm());

    await primaryAction(page, /Convert to MP4/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.mp4$/);
    assertMp4(bytes, { video: true });
    const probe = await probeVideoInPage(page, bytes, "video/mp4");
    expect(probe.width).toBeGreaterThan(0);
    expect(probe.height).toBeGreaterThan(0);
    expect(probe.duration).toBeGreaterThan(0.5);
  });
});
