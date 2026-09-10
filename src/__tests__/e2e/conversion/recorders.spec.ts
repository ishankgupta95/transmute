import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  downloadAffordance,
  captureDownload,
  decodeAudioInPage,
  probeVideoInPage,
  toolError,
} from "./support";

/**
 * The two capture pages that were added alongside /screen-recorder, driven for
 * real: a microphone recording and a camera recording, each taken through
 * start → stop → download and then decoded.
 *
 * CHROMIUM ONLY, and deliberately. Both need `--use-fake-device-for-media-stream`
 * (plus `--use-fake-ui-for-media-stream` to answer the permission prompt), and
 * only the `conversion` project sets them — `playwright.config.ts:35-45`. The
 * skip is written as `test.skip(browserName !== "chromium", …)` rather than a
 * `testIgnore` so the case is still COLLECTED in WebKit and shows up as a
 * declared skip, which is how `workspace.spec.ts:190` handles the screen
 * recorder and is the only form that makes the exclusion visible in a run.
 *
 * These three pages share one `MediaRecorderShell`, so this file is also the
 * only end-to-end evidence that the refactor left the shell's capture, timer,
 * stop and download path working for a stream it did not previously see (an
 * audio-only one, and one carrying a live preview element).
 *
 * TITLE TRAP — `playwright.config.ts:63` sets `grepInvert: /gif|FFmpeg|MP4/i`
 * on `conversion-webkit`. None of those tokens may appear in this file's name
 * or in any title below.
 */

/** WebM/Matroska's EBML magic — what `MediaRecorder` writes in Chromium. */
const EBML_MAGIC = 0x1a45dfa3;

/**
 * Start capturing, or skip with the environment's own reason.
 *
 * A recorder that cannot get a stream renders its error rather than a stop
 * button, and "the button never appeared" is a useless failure message. This
 * races the two and reports whichever arrived.
 */
async function startRecording(page: Page, what: string): Promise<void> {
  const start = page.getByRole("button", { name: /Start Recording/i });
  await expect(start, `${what} never offered a record button`).toBeVisible({ timeout: 30_000 });
  await start.click();

  const stop = page.getByRole("button", { name: /Stop and save/i });
  const failed = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
  await expect(stop.or(failed)).toBeVisible({ timeout: 60_000 });

  if (await failed.count()) {
    const message = await failed.textContent();
    test.skip(true, `${what} unavailable in this environment: ${message?.trim()}`);
  }
}

/** Let it run, stop, and hand back the file the page offered. */
async function stopAndCapture(
  page: Page,
  what: string,
  millis = 2000,
): Promise<{ name: string; bytes: Buffer }> {
  // The elapsed clock proves the recorder is really running rather than
  // sitting in a started-but-dead state. It appears on the stage and in the
  // rail, so scope to the first.
  await expect(page.getByText(/00:0\d/).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(millis);

  await page.getByRole("button", { name: /Stop and save/i }).click();
  const dl = downloadAffordance(page);
  await expect(dl, `${what} produced nothing: ${await toolError(page)}`).toBeVisible({
    timeout: 60_000,
  });
  return captureDownload(page, dl);
}

test.describe("in-tab capture", () => {
  test("audio-recorder captures the microphone and hands back a playable file", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "a synthetic microphone needs the Chromium fake-media launch flags",
    );
    test.setTimeout(180_000);

    await page.goto("/audio-recorder");
    await startRecording(page, "microphone capture");
    const { name, bytes } = await stopAndCapture(page, "audio-recorder");

    // The shell names the file after the page it was recorded on.
    expect(name).toMatch(/^audio-recording-[\d-]+\.(webm|ogg|m4a)$/);
    expect(bytes.length, "a recording has to be more than a container header").toBeGreaterThan(
      1024,
    );
    expect(bytes.readUInt32BE(0), "MediaRecorder writes a WebM/EBML container").toBe(EBML_MAGIC);

    // And it is really audio — decoded by the browser, not sniffed.
    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration, "two seconds of capture must decode to about two").toBeGreaterThan(
      0.5,
    );
    expect(decoded.channels, "a microphone stream carries at least one channel").toBeGreaterThan(0);
    expect(
      decoded.sampleRate,
      "a decoded recording has to report a real sample rate",
    ).toBeGreaterThan(8000);
    expect(
      decoded.peak,
      "the fake device emits a tone, so silence here means the track never reached the recorder",
    ).toBeGreaterThan(0.001);

    /*
      The format claim. This page has no encoder in it at all, so it must name
      whatever `MediaRecorder.mimeType` reports rather than promising a format
      — and it must say that outright, because "audio recorder" reads as "MP3"
      to most people.
    */
    const surface = page.locator("[data-tool-surface]");
    await expect(surface).toContainText("This page has no encoder in it");
    await expect(
      surface,
      "the format has to be read back off the recorder, not asserted by the page",
    ).toContainText(/Your browser wrote this recording as [A-Z]/);
  });

  test("webcam-recorder captures the camera and hands back a playable clip", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "a synthetic camera needs the Chromium fake-media launch flags",
    );
    test.setTimeout(180_000);

    await page.goto("/webcam-recorder");
    await startRecording(page, "camera capture");

    // The live preview is the one thing this page has that the screen and
    // audio recorders do not, and it only exists while a capture is running.
    await expect(
      page.getByLabel("Live camera preview"),
      "a recorder you cannot frame yourself in is the bug this page exists to avoid",
    ).toBeVisible({ timeout: 30_000 });

    const { name, bytes } = await stopAndCapture(page, "webcam-recorder");

    expect(name).toMatch(/^webcam-recording-[\d-]+\.(webm|mp4)$/);
    expect(bytes.length).toBeGreaterThan(1024);
    expect(bytes.readUInt32BE(0), "MediaRecorder writes a WebM/EBML container").toBe(EBML_MAGIC);

    // A real, seekable picture track — not merely well-shaped bytes.
    const probed = await probeVideoInPage(page, bytes, "video/webm");
    expect(probed.width, "the recording must carry a picture").toBeGreaterThan(0);
    expect(probed.height).toBeGreaterThan(0);
    expect(probed.duration, "and more than a single frame of it").toBeGreaterThan(0.5);
  });
});
