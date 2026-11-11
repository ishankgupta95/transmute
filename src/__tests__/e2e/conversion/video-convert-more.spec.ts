import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  convert,
  expectVideoStreamCopied,
  forbidCdnCore,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeVideoInPage,
  toolError,
} from "./support";
import { assertMp4, assertWav } from "./validators";
import {
  audioTonesInPage,
  compareVideoToSource,
  expectDyad,
  expectTones,
  expectVideoMatches,
  DYAD,
} from "./fidelity";

/**
 * `video-to-mp4`, `mp4-to-mov`, `mp4-to-wav` and `compress-video-to-size`,
 * asserted on the PICTURES and SOUND in the output, not on "a file came back".
 *
 * The source of truth is `sample-video.mp4` (320x240, 24 fps, hue sweep; audio
 * is the 440 Hz / 554.37 Hz stereo dyad). The .mov/.mkv/.avi fixtures are
 * stream copies of it, so every output is compared back to the MP4.
 *
 * TITLES: the FFmpeg-backed cases deliberately carry the slug (and so the
 * three-letter container token) in their titles: `conversion-webkit` greps
 * /gif|FFmpeg|MP4/i out of titles, which is the by-design way these stay
 * Chromium-only. The WebCodecs case has no such token and skips WebKit
 * explicitly.
 */

const SOURCE_SECONDS = 2.09;
const FRAME_TIMES = [0.25, 0.75, 1.25, 1.7];

test.describe("more video conversions — real output", () => {
  test.beforeEach(async ({ page }) => {
    forbidCdnCore(page);
  });

  for (const src of [
    { label: "QuickTime", fixture: SAMPLES.mov, mime: "video/quicktime" },
    { label: "Matroska", fixture: SAMPLES.mkv, mime: "video/x-matroska" },
    { label: "AVI", fixture: SAMPLES.avi, mime: "video/x-msvideo" },
  ] as const) {
    test(`video-to-mp4 turns a ${src.label} recording into the portable container with its picture and sound intact`, async ({ page }) => {
      const original = await SAMPLES.mp4();
      const { name, bytes } = await convert(page, {
        slug: "video-to-mp4",
        input: await src.fixture(),
        action: /^Convert$/,
      });

      expect(name).toMatch(/^sample-video\.mp4$/);
      assertMp4(bytes, { video: true, audio: true });
      expectVideoStreamCopied(original.buffer, bytes, `video-to-mp4 from ${src.label}`);
      await expect(page.locator("[data-tool-surface]")).toContainText("NOTHING WAS RE-ENCODED");

      const probe = await probeVideoInPage(page, bytes, "video/mp4");
      expect(probe.width).toBe(320);
      expect(probe.height).toBe(240);
      expect(Math.abs(probe.duration - SOURCE_SECONDS)).toBeLessThan(0.35);

      const { matches } = await compareVideoToSource(
        page,
        { bytes: original.buffer, mime: "video/mp4" },
        { bytes, mime: "video/mp4" },
        { outTimes: FRAME_TIMES },
      );
      expectVideoMatches(matches, { maxMae: 3, label: `video-to-mp4 (${src.label})` });
      await expectDyad(page, bytes, { label: `video-to-mp4 (${src.label}) audio` });
    });
  }

  test("mp4-to-mov writes a real QuickTime file that is a stream copy of the original", async ({ page }) => {
    const original = await SAMPLES.mp4();
    const { name, bytes } = await convert(page, {
      slug: "mp4-to-mov",
      input: original,
      action: /^Convert$/,
    });

    expect(name).toBe("sample-video.mov");
    expect(bytes.toString("latin1", 4, 8), "first box is ftyp").toBe("ftyp");
    expect(bytes.toString("latin1", 8, 12), "the major brand is QuickTime's").toBe("qt  ");
    expectVideoStreamCopied(original.buffer, bytes, "mp4-to-mov");
    await expect(page.locator("[data-tool-surface]")).toContainText("NOTHING WAS RE-ENCODED");

    const { matches } = await compareVideoToSource(
      page,
      { bytes: original.buffer, mime: "video/mp4" },
      { bytes, mime: "video/quicktime" },
      { outTimes: FRAME_TIMES },
    );
    expectVideoMatches(matches, { maxMae: 3, label: "mp4-to-mov" });
    await expectDyad(page, bytes, { label: "mp4-to-mov audio" });
  });

  test("mp4-to-wav extracts the soundtrack as 16-bit PCM with the left and right tones in place", async ({ page }) => {
    const { name, bytes } = await convert(page, {
      slug: "mp4-to-wav",
      input: await SAMPLES.mp4(),
      action: /^Extract Audio$/,
    });

    expect(name).toMatch(/\.wav$/);
    const wav = assertWav(bytes);
    expect(wav.channels).toBe(2);
    expect(wav.bitsPerSample).toBe(16);
    // 16-bit stereo PCM: the data length IS the duration.
    const seconds = (bytes.length - 44) / (wav.sampleRate * wav.channels * 2);
    expect(Math.abs(seconds - SOURCE_SECONDS), `duration ${seconds}s`).toBeLessThan(0.15);
    await expectDyad(page, bytes, { label: "mp4-to-wav" });
  });

  test("compress-video-to-size lands under the target without losing the picture", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes("webkit"), "WebCodecs encoding is Chromium-only (see video.spec.ts)");
    const mp4 = await SAMPLES.mp4();
    await page.goto("/compress-video-to-size");
    await page.locator('input[type="file"]').first().setInputFiles(mp4);

    // The smallest ceiling the field allows (1 MB).
    await page.getByLabel("Target file size in MB").fill("1");
    await primaryAction(page, /^Compress$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { bytes } = await captureDownload(page, dl);

    assertMp4(bytes, { video: true });
    expect(bytes.length, "output must fit the 1 MB target").toBeLessThanOrEqual(1024 * 1024);
    expect(bytes.length, "never inflate a clip already under the ceiling").toBeLessThan(mp4.buffer.length);
    await expect(page.locator("[data-tool-surface]")).toContainText(/Fits\s*Yes/i);

    const probe = await probeVideoInPage(page, bytes, "video/mp4");
    expect(probe.duration).toBeGreaterThan(SOURCE_SECONDS - 0.5);
    expect(probe.duration).toBeLessThan(SOURCE_SECONDS + 0.5);

    const { matches } = await compareVideoToSource(
      page,
      { bytes: mp4.buffer, mime: "video/mp4" },
      { bytes, mime: "video/mp4" },
      { outTimes: FRAME_TIMES },
    );
    // A heavily rate-limited re-encode: looser than the default ceiling.
    expectVideoMatches(matches, { maxMae: 18, label: "compress-video-to-size" });
    const tones = await audioTonesInPage(page, bytes, [DYAD.left, DYAD.right]);
    expectTones(tones, [DYAD.left, DYAD.right], { minPurity: 0.7, label: "compress-video-to-size audio" });
  });
});
