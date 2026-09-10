import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  SAMPLES,
  sample,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  decodeAudioInPage,
  corruptFixture,
  forbidCdnCore,
  toolError,
} from "./support";
import { assertMp3, assertWav } from "./validators";

/**
 * The audio *source format* matrix, and the two tools that pull audio out of a
 * video container.
 *
 * `audio.spec.ts` covers the three formats a browser decodes natively (MP3,
 * WAV, AAC-in-M4A). Everything here is a format the browser may refuse, which
 * makes these the only tests that reach the FFmpeg fallback in
 * `audio-decode.ts` at all — and in WebKit, whose `decodeAudioData` rejects Ogg
 * outright, they are the *only* coverage the fallback has in any project.
 *
 * Every fixture carries the identical 2-second 440/554 Hz stereo dyad (see
 * `scripts/generate-test-fixtures.mjs --audio-formats`), so a converter that
 * hands back a well-formed file of digital silence, a mono downmix, or a
 * fraction of the source fails here rather than passing on "a download
 * appeared". Silence is the failure mode that matters: a truncated decode still
 * produces a perfectly valid MP3.
 *
 * TITLE TRAP — `playwright.config.ts:62` sets `grepInvert: /gif|FFmpeg|MP4/i` on
 * `conversion-webkit`, and Playwright matches that against the project name,
 * the FILE PATH, every describe title and the test title. None of those tokens
 * may appear above, in this file's name, or in any title below, or WebKit
 * silently loses the test with no warning. Slugs inside a test body are fine.
 */

/**
 * Seconds of audio each fixture actually carries, measured by decoding it back
 * to PCM with the shipped core. They are not all 2.000: the ADTS AAC inherits
 * the M4A's encoder padding, and the Opus track is whatever MediaRecorder
 * decided to write into `sample-video.webm`.
 */
const SOURCE_SECONDS = {
  flac: 2.0,
  ogg: 2.0,
  aac: 2.09,
  opus: 1.86,
  wma: 2.0,
  wav: 2.0,
  m4a: 2.09,
} as const;

/** Lossy round-trips add encoder delay/padding, so durations need slack. */
function expectDuration(actual: number, expected: number, slack = 0.35) {
  expect(actual).toBeGreaterThan(expected - slack);
  expect(actual).toBeLessThan(expected + slack);
}

// ────────────────────────────────────────────────────────────────────────────
// A FLAC validator, local to this spec
// ────────────────────────────────────────────────────────────────────────────

interface FlacInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 0 when the encoder never seeked back to finalise the header. */
  totalSamples: number;
  /** STREAMINFO's MD5 of the *unencoded* PCM, hex. All-zero when unset. */
  audioMd5: string;
  /** Byte offset of the first audio frame, past the metadata blocks. */
  firstFrameOffset: number;
}

/**
 * Parse and check a FLAC stream (RFC 9639 §8).
 *
 * The point of parsing rather than sniffing the magic: `.flac` is the one
 * output in this suite whose whole selling point is that it is lossless, and a
 * renamed WAV, an MP3 with the extension swapped, or a header-only stub would
 * all satisfy "a file called .flac came back". This reads the fields that only
 * a real encoder can fill in.
 */
function assertFlac(buf: Buffer): FlacInfo {
  expect(buf.length, "FLAC output is too small to contain a STREAMINFO block").toBeGreaterThan(42);
  expect(buf.toString("ascii", 0, 4), "FLAC files start with the fLaC marker").toBe("fLaC");

  // The first metadata block MUST be STREAMINFO (type 0) and MUST be 34 bytes.
  const header = buf[4];
  expect(header & 0x7f, "the first metadata block must be STREAMINFO").toBe(0);
  expect(buf.readUIntBE(5, 3), "STREAMINFO is a fixed 34 bytes").toBe(34);

  const si = buf.subarray(8, 42);
  // 20 bits sample rate, 3 bits (channels-1), 5 bits (bits per sample-1),
  // 36 bits total samples, then a 128-bit MD5 — all packed, hence the shifts.
  const sampleRate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
  const channels = ((si[12] >> 1) & 0x07) + 1;
  const bitsPerSample = (((si[12] & 0x01) << 4) | (si[13] >> 4)) + 1;
  const totalSamples = (si[13] & 0x0f) * 2 ** 32 + si.readUInt32BE(14);
  const audioMd5 = si.subarray(18, 34).toString("hex");

  // Walk the metadata blocks to the first audio frame and check its sync code
  // (14 bits: 11111111 111110xx). A metadata-only file decodes to nothing.
  let offset = 4;
  let last = false;
  while (!last) {
    expect(offset + 4, "metadata block header runs past the end of the file").toBeLessThan(buf.length);
    last = (buf[offset] & 0x80) !== 0;
    offset += 4 + buf.readUIntBE(offset + 1, 3);
  }
  expect(
    buf[offset] === 0xff && (buf[offset + 1] & 0xfe) === 0xf8,
    "no audio frame follows the metadata — the file carries no samples",
  ).toBe(true);

  return { sampleRate, channels, bitsPerSample, totalSamples, audioMd5, firstFrameOffset: offset };
}

// ────────────────────────────────────────────────────────────────────────────

/** Upload, convert, and hand back the bytes — the shape every case below uses. */
async function runConversion(
  page: Page,
  opts: { slug: string; fixture: string; mimeType: string; action?: RegExp },
): Promise<{ name: string; bytes: Buffer }> {
  const { slug, fixture, mimeType, action = /^Convert$/ } = opts;
  await page.goto(`/${slug}`);
  await uploadFixture(page, await sample(fixture, mimeType));

  const button = primaryAction(page, action);
  await expect(button, `${slug} never offered its primary action`).toBeEnabled({ timeout: 60_000 });
  await button.click();

  const dl = downloadAffordance(page);
  await expect(dl, `${slug} failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
  return captureDownload(page, dl);
}

test.describe("audio source formats — real decode, real re-encode", () => {
  test.beforeEach(({ page }) => {
    // Every case here can fall through to the WASM core; it must come from our
    // own origin, never a CDN.
    forbidCdnCore(page);
  });

  /**
   * One case per source format. Each is a separate page with its own registry
   * entry, so each needs its own test — and each exercises a different demuxer
   * and decoder inside the core.
   */
  const CASES = [
    {
      slug: "flac-to-mp3",
      what: "a lossless FLAC",
      fixture: "sample-audio.flac",
      mimeType: "audio/flac",
      seconds: SOURCE_SECONDS.flac,
    },
    {
      slug: "ogg-to-mp3",
      what: "Ogg Vorbis",
      fixture: "sample-audio.ogg",
      mimeType: "audio/ogg",
      seconds: SOURCE_SECONDS.ogg,
    },
    {
      // A bare elementary stream in ADTS framing — no container at all, which
      // is a different demux path from the `.m4a` case in `audio.spec.ts`.
      slug: "aac-to-mp3",
      what: "a bare ADTS stream",
      fixture: "sample-audio.aac",
      mimeType: "audio/aac",
      seconds: SOURCE_SECONDS.aac,
    },
    {
      slug: "opus-to-mp3",
      what: "an Ogg Opus voice note",
      fixture: "sample-audio.opus",
      mimeType: "audio/ogg",
      seconds: SOURCE_SECONDS.opus,
      // Opus is the one source here that is not 44.1 kHz: the codec always
      // operates at 48 kHz internally and every decoder hands back 48 kHz,
      // whatever was fed to the encoder. Asserting 44100 for it would be
      // asserting a resample.
      rate: 48000,
    },
    {
      // No browser decodes Windows Media Audio; this one is entirely the
      // core's ASF demuxer plus its `wma` decoder, in both projects.
      slug: "wma-to-mp3",
      what: "Windows Media Audio",
      fixture: "sample-audio.wma",
      mimeType: "audio/x-ms-wma",
      seconds: SOURCE_SECONDS.wma,
    },
  ] as const;

  for (const c of CASES) {
    test(`${c.slug} decodes ${c.what} and writes a real MPEG stream`, async ({ page }) => {
      const { name, bytes } = await runConversion(page, c);

      expect(name).toMatch(/\.mp3$/);
      const mp3 = assertMp3(bytes);
      expect(mp3.frames, "an MP3 with no frames is an empty file").toBeGreaterThan(10);
      expect(mp3.stereo, "a stereo source must not be silently downmixed").toBe(true);
      /*
        The rate is the assertion this file was missing, and the gap shipped a
        real defect: sniffSampleRate fell through to an MP3 sync-word scan for
        any container it did not recognise, and a bare ADTS stream's AAC
        payload hits that pattern by chance — so the decode was opened at a
        bogus rate and decodeAudioData RESAMPLED to it. The same audio came out
        at 48 kHz as .aac and 44.1 kHz as .m4a. Every source here is 44.1 kHz,
        so a rate that is not 44100 means something resampled it silently.
      */
      const expectedRate = "rate" in c ? c.rate : 44100;
      expect(
        mp3.sampleRate,
        `${c.what} must come out at its own ${expectedRate} Hz, not resampled to something else`,
      ).toBe(expectedRate);

      const decoded = await decodeAudioInPage(page, bytes);
      expectDuration(decoded.duration, c.seconds);
      expect(decoded.channels).toBe(2);
      expect(
        decoded.peak,
        "output decoded to digital silence — the source was never really decoded",
      ).toBeGreaterThan(0.05);
    });
  }

  test("m4a-to-wav writes 16-bit PCM, not a renamed source", async ({ page }) => {
    const { name, bytes } = await runConversion(page, {
      slug: "m4a-to-wav",
      fixture: "sample-audio.m4a",
      mimeType: "audio/mp4",
    });

    expect(name).toMatch(/\.wav$/);
    const wav = assertWav(bytes);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.channels).toBe(2);
    expect(wav.peak, "PCM output must not be digital silence").toBeGreaterThan(0.05);
    // PCM is ~5.6 MB/minute; an 11 KB "WAV" would be the input wearing a new
    // extension. The source M4A is 11,377 bytes.
    expect(bytes.length, "a real PCM render is far larger than the compressed source").toBeGreaterThan(
      300_000,
    );

    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS.m4a);
    expect(decoded.peak).toBeGreaterThan(0.05);
  });

  test("wav-to-flac writes a real FLAC, not a renamed WAV", async ({ page }) => {
    const { name, bytes } = await runConversion(page, {
      slug: "wav-to-flac",
      fixture: "sample-audio.wav",
      mimeType: "audio/wav",
    });

    expect(name).toMatch(/\.flac$/);
    const flac = assertFlac(bytes);
    expect(flac.channels, "a stereo source must stay stereo").toBe(2);
    // The whole claim of this tool is that it is lossless. An 8-bit stream
    // would be a real FLAC and still have thrown half the source away.
    expect(flac.bitsPerSample, "lossless output must keep at least the source's 16 bits").toBeGreaterThanOrEqual(16);
    /*
      And it must not have resampled. This is a real risk rather than a
      hypothetical one: `AudioContext.decodeAudioData` resamples to the
      hardware rate — 48 kHz on the machine this was written on — so an engine
      that renders through a plain `AudioContext` writes a 48 kHz "lossless"
      file from a 44.1 kHz source and never says so.
    */
    const source = assertWav((await sample("sample-audio.wav", "audio/wav")).buffer);
    expect(flac.sampleRate, "lossless output must not resample the source").toBe(source.sampleRate);
    // Both of these are only filled in when the encoder seeks back and
    // finalises the header, and both are what a decoder verifies the stream
    // against. A stub or a truncated write leaves them zero.
    expectDuration(flac.totalSamples / flac.sampleRate, SOURCE_SECONDS.wav);
    expect(flac.audioMd5, "STREAMINFO carries no PCM checksum — the stream is unverifiable").not.toBe(
      "00000000000000000000000000000000",
    );

    // FLAC decodes natively in both Chromium and WebKit, so this half runs in
    // both projects.
    const decoded = await decodeAudioInPage(page, bytes);
    expectDuration(decoded.duration, SOURCE_SECONDS.wav);
    expect(decoded.channels).toBe(2);
    expect(decoded.peak, "output decoded to digital silence").toBeGreaterThan(0.05);
  });

  test("extract-audio lifts a Matroska track out without re-encoding it", async ({ page }) => {
    // Two things at once. The source is not an ISO-BMFF file, so the tool has
    // to demux Matroska to reach the AAC track — and `extract-audio` starts on
    // its lossless arm, so what comes back must be the track itself.
    await page.goto("/extract-audio");
    await uploadFixture(page, await SAMPLES.mkv());

    await primaryAction(page, /^Extract Audio$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `extract failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name, "the lossless arm must not hand back a re-encode").not.toMatch(/\.(mp3|wav)$/);

    /*
      The size IS the proof, and it does not depend on which container the
      engine picked for the copy. `sample-video.mkv` carries the same AAC
      elementary stream as `sample-video.mp4`, whose audio `stsz` table sums to
      10,391 bytes across 90 samples. A copy is that payload plus container
      framing. A silent re-encode is not: 2 s of MP3 at 192 kbps is ~48 KB and
      the same as WAV is ~350 KB. Digital silence is likewise impossible here —
      the bytes came out of the source, they were never synthesised.
    */
    expect(bytes.length, "output is not the size of the source's 10,391-byte AAC track").toBeGreaterThan(
      9_000,
    );
    expect(bytes.length).toBeLessThan(30_000);

    // And the page must say which of the two things happened. The claim is
    // derived from what the engine reported, so this is the copy-honesty half.
    const surface = page.locator("[data-tool-surface]");
    await expect(surface.getByText(/NOTHING WAS RE-ENCODED/i)).toBeVisible();
    await expect(surface.getByText(/THIS RUN DECODED AND RE-ENCODED/i)).toHaveCount(0);
  });

  test("extract-audio re-encodes a Matroska track when asked for an MPEG file", async ({ page }) => {
    await page.goto("/extract-audio");
    await uploadFixture(page, await SAMPLES.mkv());

    // The other arm of the same page, off the AUDIO OUT chip group.
    await page
      .getByRole("group", { name: "Audio output" })
      .getByRole("button", { name: "MP3", exact: true })
      .click();
    await primaryAction(page, /^Extract Audio$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `extract failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.mp3$/);
    const mp3 = assertMp3(bytes);
    expect(mp3.frames).toBeGreaterThan(10);

    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(1.6);
    expect(decoded.peak, "extracted audio must not be silence").toBeGreaterThan(0.02);

    // Asked for a re-encode, so the page must not be claiming a copy.
    await expect(page.locator("[data-tool-surface]").getByText(/NOTHING WAS RE-ENCODED/i)).toHaveCount(0);
  });

  test("video-to-wav writes PCM from a WebM recording", async ({ page }) => {
    await page.goto("/video-to-wav");
    await uploadFixture(page, await SAMPLES.webm());

    await primaryAction(page, /^Extract Audio$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `extract failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toMatch(/\.wav$/);
    const wav = assertWav(bytes);
    expect(wav.bitsPerSample).toBe(16);
    expect(wav.peak, "PCM output must not be digital silence").toBeGreaterThan(0.02);

    const decoded = await decodeAudioInPage(page, bytes);
    expect(decoded.duration).toBeGreaterThan(1.5);
    expect(decoded.duration).toBeLessThan(2.6);
    expect(decoded.peak).toBeGreaterThan(0.02);
  });

  test("flac-to-mp3 surfaces an error on undecodable bytes instead of a download", async ({
    page,
  }) => {
    // The honest failure. A converter that swallows a decoder failure and hands
    // back an empty or truncated MP3 is worse than one that refuses, and the
    // FLAC path has no browser decoder to fall back on.
    await page.goto("/flac-to-mp3");
    await uploadFixture(page, corruptFixture("broken.flac", "audio/flac"));

    await primaryAction(page, /^Convert$/).click();

    await expect
      .poll(async () => toolError(page), {
        message: "a decode failure must surface an error, not hang or fake a result",
        timeout: 120_000,
      })
      .not.toBeNull();
    await expect(page.locator("[data-tool-surface]").getByRole("button", { name: /^Download / })).toHaveCount(
      0,
    );
  });
});
