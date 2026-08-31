import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  sample,
  corruptFixture,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  decodeAudioInPage,
  toolError,
} from "./support";
import { assertGif, assertMp3, assertPdf, assertPng, assertWav } from "./validators";

/*
  Phase 2 hardening: the failure modes the happy-path suite can't see.

  Three families:
  - fidelity: rates/dimensions the engines used to silently destroy
    (device-rate resampling, 0×0 SVG rasters, constant GIF frame delays);
  - error paths: corrupt input must surface the tool's error state — never a
    hang in "Processing", and never a download;
  - lifecycle: repeated runs on one page (the AudioContext-leak class),
    and stale results that must not survive input mutation.
*/

test.describe("conversion hardening — fidelity", () => {
  test("96 kHz mono WAV keeps its rate and channel count through a trim", async ({ page }) => {
    await page.goto("/audio-trimmer");
    await uploadFixture(page, await SAMPLES.wav96kMono());

    const start = page.getByLabel("Selection start");
    await expect(start).toBeEnabled({ timeout: 60_000 });

    // WAV output — the format that can actually carry 96 kHz.
    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await primaryAction(page, /^Trim$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `trim failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const wav = assertWav(bytes);
    // The old decode path resampled everything to the DEVICE rate (44.1/48k).
    expect(wav.sampleRate, "source rate must survive the decode").toBe(96000);
    expect(wav.channels, "mono must not grow channels").toBe(1);
    expect(wav.peak).toBeGreaterThan(0.05);
  });

  test("96 kHz source folds down to a valid, full-length MP3", async ({ page }) => {
    await page.goto("/wav-to-mp3");
    await uploadFixture(page, await SAMPLES.wav96kMono());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    // MP3 tops out at 48 kHz — an unresampled 96 kHz buffer made lamejs emit
    // a stream with half the real duration.
    const mp3 = assertMp3(bytes);
    /*
      The assertion that actually pins the ceiling. Duration and peak cannot:
      handing lamejs an unresampled 96 kHz buffer still yields ~2 s of audible
      output, so both stay in range (verified by mutation — deleting the
      resample left this test green). The frame header is where the truth is:
      MP3 has no 96 kHz rate, so a correct fold MUST declare 48 kHz.
    */
    expect(mp3.sampleRate, "MP3 must be folded to a legal rate").toBe(48000);
    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(1.6);
    expect(decoded.duration).toBeLessThan(2.4);
    expect(decoded.peak).toBeGreaterThan(0.05);
  });

  test("dimensionless SVG rasterises at its viewBox aspect, not 0×0", async ({ page }) => {
    await page.goto("/svg-to-png");
    await uploadFixture(page, await SAMPLES.svg());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.png$/);
    const png = assertPng(bytes);
    // viewBox 240×120 scaled to a 1024 longest edge.
    expect(png.width).toBe(1024);
    expect(png.height).toBe(512);
  });

  test("gif honours the trimmed range and stamps real frame timing", async ({ page }) => {
    await page.goto("/video-to-gif");
    await uploadFixture(page, await SAMPLES.mp4());

    const start = page.getByLabel("Clip start");
    await expect(start).toBeEnabled({ timeout: 60_000 });
    await start.fill("0.5");
    await page.getByLabel("Clip end").fill("1.5");

    await primaryAction(page, /Convert to GIF/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `gif failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const gif = assertGif(bytes);
    // 1 s at the default 10 fps. ~20 frames would mean the range was ignored.
    expect(gif.frames).toBeGreaterThanOrEqual(6);
    expect(gif.frames).toBeLessThanOrEqual(15);
    // Real per-frame delays: total playback must track the selected second.
    expect(gif.durationMs).toBeGreaterThan(600);
    expect(gif.durationMs).toBeLessThan(1500);
    /*
      The total alone cannot catch the regression this test is named for. The
      constant-delay bug stamped every frame with round(1000/fps) = 100 ms, and
      11 frames x 100 ms = 1100 ms — comfortably inside the window above. What
      separates a real capture from a constant is the SPREAD: rVFC delivers on
      display refresh, so measured gaps come back varied (observed 80-130 ms
      across runs, 4-5 distinct values), while the bug produces exactly one.
    */
    expect(
      new Set(gif.delaysMs).size,
      `frame delays should vary with real capture gaps, got ${JSON.stringify(gif.delaysMs)}`,
    ).toBeGreaterThan(1);
  });

  test("5.1 WAV keeps all six channels through a WAV trim", async ({ page }) => {
    await page.goto("/audio-trimmer");
    await uploadFixture(page, await SAMPLES.wav6ch());

    const start = page.getByLabel("Selection start");
    await expect(start).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await primaryAction(page, /^Trim$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `trim failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const wav = assertWav(bytes);
    // The old encoder wrote channel 0 alone under a 6-channel header.
    expect(wav.channels).toBe(6);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.peak).toBeGreaterThan(0.05);
  });

  test("5.1 WAV folds to a valid stereo MP3", async ({ page }) => {
    await page.goto("/wav-to-mp3");
    await uploadFixture(page, await SAMPLES.wav6ch());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const mp3 = assertMp3(bytes);
    expect(mp3.stereo, "surround must fold to stereo, not truncate").toBe(true);
    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(1.6);
    expect(decoded.duration).toBeLessThan(2.4);
    expect(decoded.peak).toBeGreaterThan(0.05);
  });

  test("VBR MP3 decodes at its full duration", async ({ page }) => {
    // Two bitrate segments, no Xing header — duration estimated from the
    // first frame is wrong, which is the class the trimmer's clamp guards.
    await page.goto("/mp3-to-wav");
    await uploadFixture(page, await SAMPLES.vbrMp3());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const wav = assertWav(bytes);
    expect(wav.peak).toBeGreaterThan(0.05);
    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(1.6);
    expect(decoded.duration).toBeLessThan(2.6);
  });

  test("EXIF-rotated JPEG converts at its displayed orientation", async ({ page }) => {
    // Orientation=6 (90° CW): an 800×600 sensor image displays as 600×800.
    // iPhone photos live and die by this.
    await page.goto("/jpg-to-png");
    await uploadFixture(page, await SAMPLES.jpgPortrait());

    await primaryAction(page, /^Convert$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `convert failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const png = assertPng(bytes);
    expect(png.width).toBe(600);
    expect(png.height).toBe(800);
  });

  test("60-page PDF: thumbnail cap is announced and the range field reaches past it", async ({ page }) => {
    await page.goto("/split-pdf");
    await uploadFixture(page, await SAMPLES.pdf60());

    await expect(
      page.getByText(/THUMBNAILS RENDERED FOR THE FIRST 50 OF 60 PAGES/),
    ).toBeVisible({ timeout: 60_000 });

    const range = page.getByLabel("Page range");
    await range.fill("51-60");
    await range.press("Enter");

    const action = primaryAction(page, /Extract 10 pages/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `split failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);
    await assertPdf(bytes, { pages: 10 });
  });
});

test.describe("conversion hardening — error paths", () => {
  test("corrupt MP3 errors cleanly, and the tool recovers", async ({ page }) => {
    await page.goto("/mp3-to-wav");
    await uploadFixture(page, corruptFixture("broken.mp3", "audio/mpeg"));
    await primaryAction(page, /^Convert$/).click();

    await expect
      .poll(async () => toolError(page), {
        message: "decode failure must surface an error, not hang",
        timeout: 60_000,
      })
      .not.toBeNull();
    await expect(downloadAffordance(page)).toHaveCount(0);

    // The same page must still work with a good file afterwards. (In the
    // error state the reset affordance reads CANCEL.)
    const resetLink = page.getByRole("button", { name: /START OVER|CLEAR|CONVERT ANOTHER|CANCEL/i });
    if (await resetLink.count()) await resetLink.first().click();
    await uploadFixture(page, await SAMPLES.mp3());
    await primaryAction(page, /^Convert$/).click();
    await expect(downloadAffordance(page)).toBeVisible({ timeout: 90_000 });
  });

  test("corrupt PNG errors cleanly in the image converter", async ({ page }) => {
    await page.goto("/png-to-jpg");
    await uploadFixture(page, corruptFixture("broken.png", "image/png"));
    await primaryAction(page, /^Convert$/).click();

    await expect
      .poll(async () => toolError(page), { timeout: 60_000 })
      .not.toBeNull();
    await expect(downloadAffordance(page)).toHaveCount(0);
  });

  test("corrupt PDF errors cleanly in split-pdf", async ({ page }) => {
    await page.goto("/split-pdf");
    await uploadFixture(page, corruptFixture("broken.pdf", "application/pdf"));

    await expect
      .poll(async () => toolError(page), { timeout: 60_000 })
      .not.toBeNull();
    await expect(downloadAffordance(page)).toHaveCount(0);
  });

  test("corrupt MP4 errors cleanly in mp4-to-mp3 (FFmpeg path)", async ({ page }) => {
    await page.goto("/mp4-to-mp3");
    await uploadFixture(page, corruptFixture("broken.mp4", "video/mp4"));
    await primaryAction(page, /Extract|Convert/).click();

    await expect
      .poll(async () => toolError(page), {
        message: "FFmpeg failure must surface an error, not hang",
        timeout: 120_000,
      })
      .not.toBeNull();
    await expect(downloadAffordance(page)).toHaveCount(0);
  });
});

test.describe("conversion hardening — lifecycle", () => {
  test("four consecutive audio conversions on one page all succeed", async ({ page }) => {
    // The class of bug this pins: an AudioContext leaked per run starves the
    // browser after ~6 conversions and the tool dies until reload.
    await page.goto("/mp3-to-wav");

    for (let run = 1; run <= 4; run++) {
      await uploadFixture(page, await SAMPLES.mp3());
      await primaryAction(page, /^Convert$/).click();
      const dl = downloadAffordance(page);
      await expect(dl, `run ${run} failed: ${await toolError(page)}`).toBeVisible({
        timeout: 90_000,
      });
      const { bytes } = await captureDownload(page, dl);
      const wav = assertWav(bytes);
      expect(wav.peak, `run ${run} must not be silence`).toBeGreaterThan(0.05);

      const reset = page.getByRole("button", { name: /START OVER|CLEAR|CONVERT ANOTHER/i });
      await reset.first().click();
    }
  });

  test("merge-pdf: reordering after a merge invalidates the stale download", async ({ page }) => {
    const a = await sample("sample-doc.pdf", "application/pdf");
    const b = { ...a, name: "second-doc.pdf" };

    await page.goto("/merge-pdf");
    await uploadFixture(page, a);
    await uploadFixture(page, b);

    await primaryAction(page, /Merge/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `merge failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });

    // Reorder the two source cards via HTML5 drag events on the draggables.
    const cards = page.locator('[draggable="true"]');
    await expect(cards).toHaveCount(2);
    await cards.first().dispatchEvent("dragstart");
    await cards.nth(1).dispatchEvent("dragover");
    await cards.first().dispatchEvent("dragend");

    // The download offered a PDF in the OLD order — it must be gone now.
    await expect(downloadAffordance(page)).toHaveCount(0);
  });
});
