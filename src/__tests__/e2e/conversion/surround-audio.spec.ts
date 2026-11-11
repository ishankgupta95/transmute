import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import { sample, uploadFixture, primaryAction, downloadAffordance, captureDownload, toolError } from "./support";
import { assertMp3 } from "./validators";
import { audioTonesInPage, expectTones } from "./fidelity";

/**
 * 5.1 audio through the tools that decode in the tab — two bugs found and
 * fixed 2026-11-11, both measured in Chromium:
 *
 *  1. UNDECODABLE. Chromium's Web Audio rejects 6-channel audio declared as
 *     5.1 with BACK surrounds (WAVEFORMATEXTENSIBLE mask 0x3F): "Unable to
 *     decode audio data". 0x3F is the classic 5.1 mask; FFmpeg writes it as
 *     FLAC's `WAVEFORMATEXTENSIBLE_CHANNEL_MASK` tag and in its own >2-channel
 *     WAV, so the FFmpeg fallback produced a file Web Audio refused too.
 *     flac-to-mp3, audio-trimmer and reverse-audio all failed on a 5.1 FLAC.
 *     Fix: the fallback builds the AudioBuffer from FFmpeg's PCM directly.
 *  2. COLLAPSED REAR IMAGE. Folding to stereo put every channel past L/R into
 *     BOTH sides, LFE included. Fix: ITU-R BS.775 per layout (audio-pcm.ts).
 *
 *  3. DIALOGUE DROPPED FROM VIDEO. compress-video (and webm-to-mp4) write an
 *     at-most-stereo AAC track and read only source channels 0 and 1, so a
 *     5.1 film lost its centre, surrounds and LFE. Fix: the same fold.
 *
 * The fixtures' six channels each carry their own tone, in 5.1 order:
 * L 220, R 277, C 330, LFE 110, SL 440, SR 554 Hz (`sample-audio-6ch.wav`, and
 * as 5.1 AAC in `sample-video-51.mp4` — `generate-test-fixtures.mjs --surround`).
 */

const TONE = { L: 220, R: 277, C: 330, LFE: 110, SL: 440, SR: 554 };
const ALL = Object.values(TONE);

/** The 6-ch fixture rewritten as WAVE_FORMAT_EXTENSIBLE with mask 0x3F. */
function backSurroundWav(plain: Buffer): Buffer {
  const data = plain.subarray(44);
  const h = Buffer.alloc(68);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(60 + data.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(40, 16);
  h.writeUInt16LE(0xfffe, 20);
  h.writeUInt16LE(6, 22);
  h.writeUInt32LE(44100, 24);
  h.writeUInt32LE(44100 * 12, 28);
  h.writeUInt16LE(12, 32);
  h.writeUInt16LE(16, 34);
  h.writeUInt16LE(22, 36);
  h.writeUInt16LE(16, 38);
  h.writeUInt32LE(0x3f, 40);
  Buffer.from("0100000000001000800000aa00389b71", "hex").copy(h, 44);
  h.write("data", 60, "latin1");
  h.writeUInt32LE(data.length, 64);
  return Buffer.concat([h, data]);
}

async function run(page: import("@playwright/test").Page, slug: string, input: { name: string; mimeType: string; buffer: Buffer }, action: RegExp) {
  await page.goto(`/${slug}`);
  await uploadFixture(page, input);
  const button = primaryAction(page, action);
  await expect(button, `${slug} offered no action: ${await toolError(page)}`).toBeEnabled({ timeout: 60_000 });
  await button.click();
  const dl = downloadAffordance(page);
  await expect(dl, `${slug} failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
  return captureDownload(page, dl);
}

/** Left must hold L, SL and C; right R, SR and C; LFE nowhere; no crossover. */
async function expectItuDownmix(page: import("@playwright/test").Page, mp3: Buffer, label: string) {
  assertMp3(mp3);
  const r = await audioTonesInPage(page, mp3, ALL);
  test.info().annotations.push({ type: `${label} purity`, description: JSON.stringify(r.channels.map((c) => c.purity)) });
  expect(r.channels.length, `${label}: stereo`).toBe(2);
  const [left, right] = r.channels.map((c) => c.purity);
  const has = (p: Record<string, number>, f: number) => p[String(f)];
  for (const [side, p, own, other] of [
    ["left", left, [TONE.L, TONE.SL], [TONE.R, TONE.SR]],
    ["right", right, [TONE.R, TONE.SR], [TONE.L, TONE.SL]],
  ] as const) {
    for (const f of own) expect(has(p, f), `${label} ${side} should carry ${f} Hz`).toBeGreaterThan(0.1);
    for (const f of other) expect(has(p, f), `${label} ${side} leaks ${f} Hz from the other side`).toBeLessThan(0.01);
    expect(has(p, TONE.C), `${label} ${side} should carry the centre`).toBeGreaterThan(0.1);
    expect(has(p, TONE.LFE), `${label} ${side} should not carry the LFE`).toBeLessThan(0.01);
  }
}

test.describe("5.1 audio decodes and folds to stereo correctly", () => {
  test("a 5.1 FLAC made by wav-to-flac converts with flac-to-mp3", async ({ page }) => {
    const wav = await sample("sample-audio-6ch.wav", "audio/wav");
    const flac = await run(page, "wav-to-flac", wav, /^Convert$/);
    // The trigger, pinned: FFmpeg tags the 5.1 layout with the back-surround mask.
    expect(flac.bytes.toString("latin1"), "the FLAC should carry the channel-mask tag").toContain(
      "WAVEFORMATEXTENSIBLE_CHANNEL_MASK=0x3f",
    );
    const mp3 = await run(page, "flac-to-mp3", { name: "surround.flac", mimeType: "audio/flac", buffer: flac.bytes }, /^Convert$/);
    await expectItuDownmix(page, mp3.bytes, "flac-to-mp3");
  });

  test("a 5.1 back-surround WAV (mask 0x3F) converts with wav-to-mp3", async ({ page }) => {
    const plain = await sample("sample-audio-6ch.wav", "audio/wav");
    const mp3 = await run(page, "wav-to-mp3", { name: "surround.wav", mimeType: "audio/wav", buffer: backSurroundWav(plain.buffer) }, /^Convert$/);
    await expectItuDownmix(page, mp3.bytes, "wav-to-mp3");
  });

  test("a 5.1 FLAC opens in audio-trimmer and reverse-audio", async ({ page }) => {
    const wav = await sample("sample-audio-6ch.wav", "audio/wav");
    const flac = await run(page, "wav-to-flac", wav, /^Convert$/);
    const input = { name: "surround.flac", mimeType: "audio/flac", buffer: flac.bytes };
    for (const [slug, action] of [["audio-trimmer", /^Trim$/], ["reverse-audio", /^Reverse/]] as const) {
      const out = await run(page, slug, input, action);
      expect(out.bytes.length, `${slug} wrote nothing`).toBeGreaterThan(1000);
    }
  });
});

test.describe("5.1 video soundtracks keep their centre and surrounds", () => {
  test("the 5.1 video fixture really carries six separate channels", async ({ page }) => {
    // Falsification first: the next test only means something if the source
    // is genuine 5.1 with each tone on its own channel.
    await page.goto("/");
    const video = await sample("sample-video-51.mp4", "video/mp4");
    const r = await audioTonesInPage(page, video.buffer, ALL);
    expectTones(r, [TONE.L, TONE.R, TONE.C, TONE.LFE, TONE.SL, TONE.SR], { label: "sample-video-51.mp4" });
  });

  test("compress-video folds a 5.1 soundtrack to stereo, dialogue included", async ({ page }) => {
    const video = await sample("sample-video-51.mp4", "video/mp4");
    await page.goto("/compress-video");
    await uploadFixture(page, video);
    await primaryAction(page, /^Compress$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { bytes } = await captureDownload(page, dl);

    const r = await audioTonesInPage(page, bytes, ALL);
    test.info().annotations.push({ type: "compress purity", description: JSON.stringify(r.channels.map((c) => c.purity)) });
    expect(r.channels.length, "the AAC track is stereo").toBe(2);
    const [left, right] = r.channels.map((c) => c.purity);
    const p = (side: Record<string, number>, f: number) => side[String(f)];
    // The centre is the dialogue channel: it is the one this bug deleted.
    expect(p(left, TONE.C), "left must carry the centre").toBeGreaterThan(0.1);
    expect(p(right, TONE.C), "right must carry the centre").toBeGreaterThan(0.1);
    expect(p(left, TONE.SL), "left must carry the left surround").toBeGreaterThan(0.1);
    expect(p(right, TONE.SR), "right must carry the right surround").toBeGreaterThan(0.1);
    expect(p(left, TONE.SR), "the right surround must not leak left").toBeLessThan(0.01);
    expect(p(right, TONE.SL), "the left surround must not leak right").toBeLessThan(0.01);
    expect(Math.max(p(left, TONE.LFE), p(right, TONE.LFE)), "the LFE is dropped").toBeLessThan(0.01);
  });
});
