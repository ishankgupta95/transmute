import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
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
import { assertMp3 } from "./validators";
import { DYAD, audioTonesInPage, expectDyad, expectTones } from "./fidelity";

/**
 * Two tools that had no real-conversion test:
 *
 *  - `mp3-converter` — the generic "anything in, MP3 out" page. MP3 encoding is
 *    libmp3lame compiled to wasm (loaded unbundled from /vendor/), so these
 *    check the BYTES a real encode produced: the rate and channel count the
 *    MPEG header declares, the bitrate the chip asked for, and — through a real
 *    decode — that the two channels still carry their own tones.
 *  - `file-checksum` — every digest on the page is compared with Node's
 *    `crypto.createHash` over the same bytes, so a streaming/worker bug that
 *    hashes the wrong span, or labels one algorithm's digest as another, fails.
 *
 * Titles avoid the conversion-webkit grepInvert words on purpose.
 */

const SOURCE_SECONDS = 2;

function expectDuration(actual: number, expected: number, slack = 0.35) {
  expect(actual).toBeGreaterThan(expected - slack);
  expect(actual).toBeLessThan(expected + slack);
}

/** Bitrate (kbps) the MPEG-1 Layer III frame header at `index` declares. */
function frameBitrate(buf: Buffer, index: number): number {
  let o = 0;
  if (buf.toString("latin1", 0, 3) === "ID3") {
    o = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const RATES = [44100, 48000, 32000, 0];
  for (let i = 0; i < index; i++) {
    const bitrate = BITRATES[(buf[o + 2] >> 4) & 0x0f];
    const rate = RATES[(buf[o + 2] >> 2) & 0x03];
    const padding = (buf[o + 2] >> 1) & 0x01;
    o += Math.floor((144 * bitrate * 1000) / rate) + padding;
  }
  return BITRATES[(buf[o + 2] >> 4) & 0x0f];
}

async function convertToMp3(
  page: Page,
  input: Awaited<ReturnType<typeof sample>>,
  setup?: () => Promise<void>,
): Promise<{ name: string; bytes: Buffer }> {
  await uploadFixture(page, input);
  if (setup) await setup();
  await primaryAction(page, /^Convert$/).click();
  const dl = downloadAffordance(page);
  await expect(dl, `mp3-converter failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
  return captureDownload(page, dl);
}

test.describe("mp3-converter — real wasm LAME encode", () => {
  test("a stereo WAV becomes a 44.1 kHz stereo MP3 that still holds both tones", async ({ page }) => {
    await page.goto("/mp3-converter");
    const { name, bytes } = await convertToMp3(page, await SAMPLES.wav());

    expect(name).toBe("sample-audio.mp3");
    const mp3 = assertMp3(bytes);
    expect(mp3.stereo, "a stereo source must stay stereo").toBe(true);
    expect(mp3.sampleRate, "the source's own rate, not a resample").toBe(44100);
    // The page's default chip is 192 kbps CBR.
    expect(frameBitrate(bytes, 3), "the default bitrate chip is 192").toBe(192);
    // 2 s at 192 kbps is ~48 KB; a few KB either side for headers/padding.
    expect(bytes.length).toBeGreaterThan(40_000);
    expect(bytes.length).toBeLessThan(60_000);

    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS);
    expect(decoded.channels).toBe(2);
    await expectDyad(page, bytes, { label: "mp3-converter (wav, 192)" });
  });

  test("the bitrate chips change the stream: 128 and 320 kbps", async ({ page }) => {
    await page.goto("/mp3-converter");
    const wav = await SAMPLES.wav();

    const low = await convertToMp3(page, wav, async () => {
      await page.getByRole("button", { name: "128", exact: true }).click();
    });
    expect(frameBitrate(low.bytes, 3)).toBe(128);

    // A new chip drops the finished result; convert again on the same page.
    await page.getByRole("button", { name: "320", exact: true }).click();
    await expect(downloadAffordance(page)).toHaveCount(0);
    await primaryAction(page, /^Convert$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `320 failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const high = await captureDownload(page, dl);

    assertMp3(low.bytes);
    assertMp3(high.bytes);
    expect(frameBitrate(high.bytes, 3)).toBe(320);
    expect(
      high.bytes.length / low.bytes.length,
      "320 kbps is 2.5x the data of 128 kbps",
    ).toBeGreaterThan(2.2);
    expect(high.bytes.length / low.bytes.length).toBeLessThan(2.8);
    await expectDyad(page, low.bytes, { label: "mp3-converter 128", minPurity: 0.8 });
    await expectDyad(page, high.bytes, { label: "mp3-converter 320" });
  });

  test("a 96 kHz mono WAV is folded to a 48 kHz mono MP3 without changing pitch", async ({ page }) => {
    await page.goto("/mp3-converter");
    const { bytes } = await convertToMp3(page, await SAMPLES.wav96kMono());

    const mp3 = assertMp3(bytes);
    expect(mp3.sampleRate, "MP3 tops out at 48 kHz").toBe(48000);
    expect(mp3.stereo, "mono must not grow a channel").toBe(false);
    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS);
    expect(decoded.channels).toBe(1);
    // The fixture is an 880 Hz tone; a rate mix-up would move it.
    expectTones(await audioTonesInPage(page, bytes, [880]), [880], { label: "mp3-converter 96k mono" });
  });

  test("a stereo MP3 re-encodes to a fresh MP3 with its channels intact", async ({ page }) => {
    await page.goto("/mp3-converter");
    const { bytes } = await convertToMp3(page, await SAMPLES.mp3());
    const mp3 = assertMp3(bytes);
    expect(mp3.stereo).toBe(true);
    expect(mp3.sampleRate).toBe(44100);
    await expectDyad(page, bytes, { label: "mp3-converter (mp3 -> mp3)" });
  });

  test("an Ogg Opus voice note keeps its pitch through the decode and encode", async ({ page }) => {
    await page.goto("/mp3-converter");
    const { bytes } = await convertToMp3(page, await sample("sample-audio.opus", "audio/ogg"));
    const mp3 = assertMp3(bytes);
    expect(mp3.sampleRate, "Opus decodes at 48 kHz").toBe(48000);
    // 440 Hz in BOTH channels (one oscillator), not the dyad.
    expectTones(await audioTonesInPage(page, bytes, [440, DYAD.right]), [440, 440], { label: "mp3-converter (opus)" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// file-checksum
// ────────────────────────────────────────────────────────────────────────────

const ALGOS = ["md5", "sha1", "sha256", "sha512"] as const;

function digests(buf: Buffer): Record<(typeof ALGOS)[number], string> {
  return Object.fromEntries(ALGOS.map((a) => [a, createHash(a).update(buf).digest("hex")])) as Record<
    (typeof ALGOS)[number],
    string
  >;
}

/** Every hex digest shown on the page, in document order. */
async function shownDigests(page: Page): Promise<string[]> {
  const texts = await page.locator("[data-tool-surface] code").allTextContents();
  return texts.map((t) => t.trim()).filter((t) => /^[0-9a-f]{32,128}$/.test(t));
}

test.describe("file-checksum — digests equal Node's crypto", () => {
  test("a real WAV shows MD5, SHA-1, SHA-256 and SHA-512 identical to Node's", async ({ page }) => {
    const wav = await SAMPLES.wav();
    const want = digests(wav.buffer);
    await page.goto("/file-checksum");
    await uploadFixture(page, wav);

    await expect(page.getByText("4 DIGESTS")).toBeVisible({ timeout: 60_000 });
    // One row per algorithm, in the page's order: MD5, SHA-1, SHA-256, SHA-512.
    expect(await shownDigests(page)).toEqual(ALGOS.map((a) => want[a]));
  });

  test("a pasted SHA-256 matches, a flipped digit does not, and an MD5 line is recognised by length", async ({ page }) => {
    const pdf = await SAMPLES.pdf();
    const want = digests(pdf.buffer);
    await page.goto("/file-checksum");
    await uploadFixture(page, pdf);
    await expect(page.getByText("4 DIGESTS")).toBeVisible({ timeout: 60_000 });

    const box = page.getByLabel("Expected checksum");
    const surface = page.locator("[data-tool-surface]");

    await box.fill(`${want.sha256}  ${pdf.name}`);
    await expect(surface.getByText("MATCH", { exact: true }).first()).toBeVisible();
    await expect(surface.getByText(/matched on SHA-256/)).toBeVisible();

    await box.fill(want.md5.toUpperCase());
    await expect(surface.getByText(/matched on MD5/)).toBeVisible();

    const flipped = (want.sha256[0] === "0" ? "1" : "0") + want.sha256.slice(1);
    await box.fill(flipped);
    await expect(surface.getByText("NO MATCH", { exact: true }).first()).toBeVisible();
    await expect(surface.getByText(/matched on/)).toHaveCount(0);
  });

  test("the SHA256SUMS download is a coreutils line carrying Node's digest", async ({ page }) => {
    const mp3 = await SAMPLES.mp3();
    const want = digests(mp3.buffer);
    await page.goto("/file-checksum");
    await uploadFixture(page, mp3);
    await expect(page.getByText("4 DIGESTS")).toBeVisible({ timeout: 60_000 });

    const dl = page.getByRole("button", { name: /^Download SHA256SUMS$/ });
    await expect(dl).toBeVisible();
    const { name, bytes } = await captureDownload(page, dl);
    // The browser appends .txt to an extension-less text/plain download.
    expect(name).toMatch(/^SHA256SUMS(\.txt)?$/);
    expect(bytes.toString("utf8")).toBe(`${want.sha256}  ${mp3.name}\n`);
  });

  test("a large file (streamed through the worker) and an empty file hash correctly", async ({ page }) => {
    // 9 MB of deterministic non-repeating bytes: bigger than any single read
    // chunk, so a bug in the streaming loop (dropped or repeated chunk) shows.
    const big = Buffer.alloc(9 * 1024 * 1024 + 123);
    let x = 0x12345678;
    for (let i = 0; i < big.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      big[i] = x >>> 24;
    }
    const empty = Buffer.alloc(0);
    await page.goto("/file-checksum");
    await uploadFixture(page, [
      { name: "big.bin", mimeType: "application/octet-stream", buffer: big },
      { name: "empty.bin", mimeType: "application/octet-stream", buffer: empty },
    ]);
    await expect(page.getByText("2 of 2 hashed")).toBeVisible({ timeout: 120_000 });

    const wantBig = digests(big);
    const wantEmpty = digests(empty);
    expect(await shownDigests(page)).toEqual([
      ...ALGOS.map((a) => wantBig[a]),
      ...ALGOS.map((a) => wantEmpty[a]),
    ]);
  });
});
