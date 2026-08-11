import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  sample,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  decodeAudioInPage,
  toolError,
} from "./support";
import { assertMp3, assertWav } from "./validators";

/**
 * Audio pipelines run on `AudioContext.decodeAudioData` + lamejs. Fixtures are
 * a genuine 2-second stereo 440/554 Hz dyad in MP3, WAV and AAC/M4A, so a
 * conversion that silently emits silence, mono, or the wrong duration fails.
 */

const SOURCE_SECONDS = 2;

/** Lossy round-trips add encoder delay/padding, so durations need slack. */
function expectDuration(actual: number, expected: number, slack = 0.35) {
  expect(actual).toBeGreaterThan(expected - slack);
  expect(actual).toBeLessThan(expected + slack);
}

test.describe("audio conversions — real output", () => {
  test("mp3-to-wav decodes MP3 and emits playable PCM", async ({ page }) => {
    await page.goto("/mp3-to-wav");
    await uploadFixture(page, await SAMPLES.mp3());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.wav$/);
    const wav = assertWav(bytes);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.peak, "output must not be digital silence").toBeGreaterThan(0.05);

    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS);
    expect(decoded.channels, "stereo source should stay stereo").toBe(2);
    expect(decoded.peak).toBeGreaterThan(0.05);
  });

  test("wav-to-mp3 emits a real MPEG stream", async ({ page }) => {
    await page.goto("/wav-to-mp3");
    await uploadFixture(page, await SAMPLES.wav());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.mp3$/);
    const mp3 = assertMp3(bytes);
    expect(mp3.stereo, "stereo source should stay stereo").toBe(true);

    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS);
    expect(decoded.peak, "output must not be digital silence").toBeGreaterThan(0.05);
  });

  test("m4a-to-mp3 decodes AAC and re-encodes", async ({ page }) => {
    await page.goto("/m4a-to-mp3");
    await uploadFixture(page, await SAMPLES.m4a());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.mp3$/);
    assertMp3(bytes);

    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS);
    expect(decoded.peak).toBeGreaterThan(0.05);
  });

  test("audio-trimmer cuts the selection out of the source", async ({ page }) => {
    await page.goto("/audio-trimmer");
    await uploadFixture(page, await SAMPLES.wav());

    // Wait for decode to populate the real duration before moving handles.
    const start = page.getByLabel("Selection start");
    const end = page.getByLabel("Selection end");
    await expect(start).toBeEnabled({ timeout: 60_000 });

    await start.fill("0.5");
    await end.fill("1.5");

    await primaryAction(page, /^Trim$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `trim failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    if (name.endsWith(".wav")) {
      const wav = assertWav(bytes);
      expect(wav.peak).toBeGreaterThan(0.05);
    } else {
      assertMp3(bytes);
    }

    const decoded = await decodeAudioInPage(page, bytes);
    // A 1-second selection out of a 2-second source.
    expectDuration(decoded.duration, 1);
    expect(decoded.peak, "trimmed audio must not be silence").toBeGreaterThan(0.05);
  });

  test("merge-audio concatenates both inputs", async ({ page }) => {
    const wav = await sample("sample-audio.wav", "audio/wav");
    await page.goto("/merge-audio");
    await uploadFixture(page, [
      { ...wav, name: "first.wav" },
      { ...wav, name: "second.wav" },
    ]);

    const action = primaryAction(page, /Merge 2 files/);
    await expect(action).toBeEnabled({ timeout: 60_000 });
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `merge failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/^merged\.(wav|mp3)$/);
    const decoded = await decodeAudioInPage(page, bytes);
    // Two 2-second clips end to end.
    expectDuration(decoded.duration, SOURCE_SECONDS * 2);
    expect(decoded.peak).toBeGreaterThan(0.05);
  });
});
