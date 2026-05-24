import { test, expect } from "@playwright/test";
import { uploadFile, downloadButton, waitForDownload, downloadBytes } from "../helpers";
import { tinyWav } from "../fixtures";

/**
 * Audio decoding goes through `AudioContext.decodeAudioData`. Encoding back
 * to WAV is pure JS; encoding to MP3 is via @breezystack/lamejs (also pure
 * JS, but slower).
 *
 * Real MP3 / M4A inputs are not synthesisable in Node without shipping a
 * binary; those format-pair tests are page-smoke only.
 */

test.describe("audio golden paths", () => {
  test("wav-to-mp3: encodes a tiny WAV to MP3 with selectable bitrate", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/wav-to-mp3");
    await uploadFile(page, tinyWav(0.3));

    // The bitrate selector is rendered after upload; default 192kbps.
    await expect(page.getByText("kbps").first()).toBeVisible();

    await page.getByRole("button", { name: "Convert", exact: true }).click();

    // lamejs encoding is single-threaded and can take a while even for a
    // half-second sample on a cold worker. Wait generously for the button.
    await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 });

    const { suggestedFilename, download } = await waitForDownload(
      page,
      downloadButton(page),
      90_000,
    );
    expect(suggestedFilename).toMatch(/\.mp3$/i);

    const bytes = await downloadBytes(download);
    // MP3 frame sync = 0xFFFE/F start (encoder also commonly emits ID3 header
    // — accept either).
    const head = bytes.subarray(0, 3).toString("hex");
    const isId3 = head === "494433"; // "ID3"
    const firstByte = bytes[0];
    const isFrameSync = firstByte === 0xff && (bytes[1] & 0xe0) === 0xe0;
    expect(isId3 || isFrameSync).toBe(true);
  });

  test("wav-to-mp3: bitrate buttons swap the active selection", async ({ page }) => {
    await page.goto("/wav-to-mp3");
    await uploadFile(page, tinyWav(0.3));

    // Click 320kbps and assert that button is now active.
    const btn320 = page.getByRole("button", { name: "320", exact: true });
    await btn320.click();
    // Active state uses border-accent + bg-accent-muted classes.
    await expect(btn320).toHaveClass(/border-accent/);
  });

  test("mp3-to-wav: page renders but skips conversion (binary fixture not shipped)", async ({
    page,
  }) => {
    // We don't synthesise MP3s in Node; this is a smoke test that the page
    // and its dropzone load. The reverse pipeline (wav-to-mp3) covers the
    // encoding path.
    await page.goto("/mp3-to-wav");
    await expect(page.locator("h1")).toHaveCount(1);
    const input = page.locator('input[type="file"]').first();
    await expect(input).toBeAttached();
    // The accept attribute is what tells the browser which formats to surface
    // in the OS file picker; a regression here breaks the tool silently.
    await expect(input).toHaveAttribute("accept", ".mp3");
  });

  test("m4a-to-mp3: page renders with a dropzone scoped to .m4a (binary fixture not shipped)", async ({
    page,
  }) => {
    await page.goto("/m4a-to-mp3");
    await expect(page.locator("h1")).toHaveCount(1);
    const input = page.locator('input[type="file"]').first();
    await expect(input).toBeAttached();
    await expect(input).toHaveAttribute("accept", ".m4a,.aac");
  });

  test("audio-trimmer: trims a 1s WAV to a sub-second WAV (functional path)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/audio-trimmer");
    await uploadFile(page, tinyWav(1));

    // Wait for the audio element to read its duration; the "Selected:" line
    // only appears once endTime > startTime.
    await expect(page.getByText(/Duration:/)).toBeVisible({ timeout: 10_000 });

    // The end-time number input is the second number input on the page; set
    // a sub-second range so the encoded output is meaningfully shorter.
    const numbers = page.locator('input[type="number"]');
    await numbers.first().fill("0.2");
    await numbers.nth(1).fill("0.7");

    // WAV output keeps the test off the slow lamejs encoder.
    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await page.getByRole("button", { name: "Trim", exact: true }).click();

    const { suggestedFilename, download } = await waitForDownload(
      page,
      downloadButton(page),
      30_000,
    );
    expect(suggestedFilename).toMatch(/\.wav$/i);
    const bytes = await downloadBytes(download);
    // RIFF/WAVE header magic.
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
  });

  test("audio-trimmer: page renders, dropzone accepts audio", async ({ page }) => {
    await page.goto("/audio-trimmer");
    await expect(page.locator("h1")).toHaveCount(1);

    // Upload a tiny WAV and assert the audio element gets the duration.
    await uploadFile(page, tinyWav(1));
    await expect(page.locator("audio")).toBeVisible({ timeout: 10_000 });
    // Once the metadata loads, the "Duration:" label appears.
    await expect(page.getByText(/Duration:/)).toBeVisible({ timeout: 10_000 });
  });

  test("merge-audio: 2 tiny WAVs in → 1 download out", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/merge-audio");
    const a = { ...tinyWav(0.2), name: "a.wav" };
    const b = { ...tinyWav(0.2), name: "b.wav" };
    await uploadFile(page, [a, b]);

    await expect(page.getByText("a.wav")).toBeVisible();
    await expect(page.getByText("b.wav")).toBeVisible();

    await page.getByRole("button", { name: /Merge 2 files/ }).click();
    await expect(downloadButton(page)).toBeVisible({ timeout: 90_000 });
    const { suggestedFilename } = await waitForDownload(page, downloadButton(page), 90_000);
    expect(suggestedFilename).toMatch(/\.(mp3|wav)$/i);
  });
});
