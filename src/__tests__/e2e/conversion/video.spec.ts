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
import {
  audioTonesInPage,
  compareGifToVideo,
  compareVideoToSource,
  expectDyad,
  expectTones,
  expectVideoMatches,
} from "./fidelity";

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
/** Where frames are sampled for content checks: spread across the clip. */
const FRAME_TIMES = [0.25, 0.75, 1.25, 1.7];

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

    // Content: the frames must still be the source's frames — not black,
    // green, colour-shifted, frozen or out of order.
    const { matches } = await compareVideoToSource(
      page,
      { bytes: mp4.buffer, mime: "video/mp4" },
      { bytes, mime: "video/mp4" },
      { outTimes: FRAME_TIMES },
    );
    expectVideoMatches(matches, { label: "compress-video" });
  });

  /*
    THE TRIMMER, BOTH ARMS. Until 2026-11-11 this was one test asserting the
    output was "between 0.3 and 1.7 s", and it passed a file that was wrong:
    asked for 0.5–1.5 s, the fast copy delivered 1.51 s starting at 0.00 s
    (the keyframe before 0.5), under a page reading "CLIP 0:01.0". A copy
    cannot start between keyframes — so the fast arm now has to SAY where it
    started, and the exact arm has to start where it was asked.
  */
  async function trimTo(
    page: import("@playwright/test").Page,
    mode: "Fast" | "Exact frame",
  ): Promise<{ bytes: Buffer; name: string }> {
    await page.goto("/video-trimmer");
    await uploadFixture(page, await SAMPLES.mp4());
    const start = page.getByLabel("Clip start");
    const end = page.getByLabel("Clip end");
    await expect(start).toBeEnabled({ timeout: 90_000 });
    await start.fill("0.5");
    await end.fill("1.5");
    await page.getByRole("group", { name: "Cut accuracy" }).getByRole("button", { name: mode, exact: true }).click();
    await primaryAction(page, /^Trim$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `trim failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    return captureDownload(page, dl);
  }

  test("video-trimmer's fast cut says where it really starts, and is telling the truth", async ({ page }) => {
    const mp4 = await SAMPLES.mp4();
    const { bytes, name } = await trimTo(page, "Fast");
    expect(name).toBe("sample-video-trimmed.mp4");
    assertMp4(bytes, { video: true });

    // The fixture's keyframes are at 0 and 1.0 s, so a copy from 0.5 starts at 0.
    const surface = page.locator("[data-tool-surface]");
    await expect(surface.getByRole("status").filter({ hasText: "This clip starts at 0:00.0, not 0:00.5." }))
      .toBeVisible();
    await expect(surface, "the CLIP readout is the file, not the selection").toContainText("CLIP0:01.5");

    // And the notice is TRUE: the file's frames are the source's from 0:00.0.
    const { matches } = await compareVideoToSource(
      page,
      { bytes: mp4.buffer, mime: "video/mp4" },
      { bytes, mime: "video/mp4" },
      { outTimes: [0.1, 0.6, 1.3] },
    );
    expectVideoMatches(matches, { label: "fast trim, read from where it says it starts" });
  });

  test("video-trimmer's exact cut starts on the frame that was picked", async ({ page }) => {
    const mp4 = await SAMPLES.mp4();
    const { bytes, name } = await trimTo(page, "Exact frame");
    expect(name).toBe("sample-video-trimmed.mp4");
    assertMp4(bytes, { video: true });

    const probe = await probeVideoInPage(page, bytes, "video/mp4");
    expect(Math.abs(probe.duration - 1), `exact trim lasted ${probe.duration}s`).toBeLessThan(0.15);
    expect(probe.width).toBe(SOURCE.width);
    expect(probe.height).toBe(SOURCE.height);
    await expect(page.locator("[data-tool-surface]").getByText(/This clip starts at/)).toHaveCount(0);

    // Output t is source t + 0.5 — the frame picked, not the keyframe before it.
    const { matches } = await compareVideoToSource(
      page,
      { bytes: mp4.buffer, mime: "video/mp4" },
      { bytes, mime: "video/mp4" },
      { outTimes: [0.1, 0.5, 0.85], map: (t) => t + 0.5 },
    );
    expectVideoMatches(matches, { label: "exact trim 0.5–1.5 s" });
    // The soundtrack was cut at the same place and still carries the dyad.
    await expectDyad(page, bytes, { from: 0.2, to: 0.8, label: "exact trim audio" });
  });

  test("video-to-gif emits a multi-frame GIF", async ({ page }) => {
    await page.goto("/video-to-gif");
    const mp4 = await SAMPLES.mp4();
    await uploadFixture(page, mp4);

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

    // Content: each sampled frame is the source frame at the time the GIF's
    // own delays put it on screen — not black, not one frame repeated, not
    // colour-swapped by the palette, and not drifting from the clip.
    const { gif: decoded, matches } = await compareGifToVideo(
      page,
      { bytes: mp4.buffer, mime: "video/mp4" },
      bytes,
    );
    test.info().annotations.push({
      type: "frames vs source",
      description: JSON.stringify({
        frames: decoded.frames.length,
        delays: decoded.frames.map((f) => f.delayMs),
        matches: matches.map((m) => [m.outT, +m.mae.toFixed(2), +m.correlation.toFixed(3)]),
      }),
    });
    expectVideoMatches(matches, { label: "video-to-gif" });
    // The animation covers the whole 2 s clip, not a stretch of it.
    const last = decoded.frames[decoded.frames.length - 1];
    expect((last.startMs + last.delayMs) / 1000, "the GIF should run as long as the clip").toBeGreaterThan(SOURCE.seconds - 0.4);
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
    await expectDyad(page, bytes, { label: "mp4-to-mp3" });
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

  /*
    The capability guard, driven end to end: strip the WebCodecs encode APIs
    before any page script runs (the Firefox / older-Safari shape) and the
    tool must explain itself up front — friendly banner, no upload needed,
    and the drop zone still standing so the page keeps its shape.
  */
  for (const slug of ["/compress-video", "/webm-to-mp4"] as const) {
    test(`${slug} warns pre-flight when WebCodecs is missing`, async ({ page }) => {
      await page.addInitScript(() => {
        delete (window as { VideoEncoder?: unknown }).VideoEncoder;
        delete (window as { AudioEncoder?: unknown }).AudioEncoder;
        delete (window as { VideoFrame?: unknown }).VideoFrame;
      });
      await page.goto(slug);

      // Scoped to the alert: both tools' about copy also says "WebCodecs",
      // so a bare page-wide text match would pass without the banner.
      await expect(
        page.getByRole("alert").filter({ hasText: /WebCodecs/ }).first(),
      ).toBeVisible();
      await expect(page.locator('input[type="file"]').first()).toBeAttached();
    });
  }

  test("webm-to-mp4 re-encodes VP8/Opus into a playable MP4", async ({ page }) => {
    await page.goto("/webm-to-mp4");
    const webm = await SAMPLES.webm();
    await uploadFixture(page, webm);

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

    const { matches } = await compareVideoToSource(
      page,
      { bytes: webm.buffer, mime: "video/webm" },
      { bytes, mime: "video/mp4" },
      { outTimes: FRAME_TIMES },
    );
    expectVideoMatches(matches, { label: "webm-to-mp4" });
    // And the Opus track came across as audio, at its 440 Hz.
    const tones = await audioTonesInPage(page, bytes, [440]);
    expectTones(tones, tones.channels.map(() => 440), { label: "webm-to-mp4 audio", minRms: 0.01 });
  });
});
