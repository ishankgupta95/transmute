import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  sample,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  decodeAudioInPage,
  forbidCdnCore,
  toolError,
} from "./support";
import { assertWav } from "./validators";
import { audioLevelsInPage, audioTonesInPage, dB, expectDyad, expectLevels, expectTones } from "./fidelity";

/**
 * The four audio-effect pages, driven against real samples.
 *
 * Each case here exists because a measurement said a plausible implementation
 * would ship a silent loss:
 *
 *   normalize-audio      `loudnorm` negotiates a 192 kHz output link. Without
 *                        an explicit `-ar`, a 44 100 Hz / 352 844 B source came
 *                        back as 192 000 Hz / 1 536 102 B — 4.35x the bytes at
 *                        a rate nobody asked for. The rate is read out of the
 *                        DOWNLOADED file's own header below, because a browser
 *                        decode always reports the AudioContext's rate instead.
 *   remove-silence       every other audio fixture in this suite is a
 *                        continuous tone, against which "removed nothing" and
 *                        "removed exactly the right stretches" look identical.
 *                        `sample-audio-gaps.wav` exists so the difference is
 *                        measurable — see `--silence-gaps` in
 *                        `scripts/generate-test-fixtures.mjs`.
 *   change-audio-volume  the page promises no limiter and an honest clipping
 *                        report, so both the moved peak and the report are
 *                        asserted off the decoded output.
 *   reverse-audio        a byte count cannot tell a reversal from a re-encode.
 *                        The samples are compared against the source's, in
 *                        reverse, with a control that fails if the output is
 *                        merely a copy.
 *
 * TITLE TRAP — `playwright.config.ts:63` sets `grepInvert: /gif|FFmpeg|MP4/i`
 * on `conversion-webkit`, matched against the project name, the FILE PATH,
 * every describe title and every test title. None of those three tokens may
 * appear in this file's name or in any title below, or WebKit silently drops
 * the case with no warning. Slugs and engine names inside a test body are fine.
 */

/** The source `sample-audio.wav` is written at this rate, and must come back at it. */
const SOURCE_SAMPLE_RATE = 44100;

/** `sample-audio.wav`, from `scripts/generate-test-fixtures.mjs`. */
const NORMALIZE_SOURCE_BYTES = 352_844;

/**
 * What the 192 kHz resample costs, measured on that exact source:
 * 1 536 102 B against 352 878 B with the rate pinned. The band below sits
 * comfortably between the two, so it fails on the bug and passes on the fix
 * without pinning an encoder's byte count.
 */
const NORMALIZED_WAV_MIN_BYTES = 300_000;
const NORMALIZED_WAV_MAX_BYTES = 600_000;

/**
 * How far from the −16 LUFS target the unweighted meter may read. Measured
 * 2026-11-11: the output reads −15.86 in Chromium and WebKit (the meter skips
 * K-weighting, which is near 0 dB at 440/554 Hz); the untouched source −9.42.
 */
const NORMALIZE_TOLERANCE_LU = 1;

/** `sample-audio-gaps.wav`: 1 s + 1 s tone + 1.5 s + 1 s tone + 1 s. */
const GAPS_SECONDS = 5.5;
/** Measured with the shipped core: "ends" leaves 3.499683 s, "all" 2.039683 s. */
const GAPS_ENDS_SECONDS = 3.5;
const GAPS_ALL_SECONDS = 2.04;

/**
 * `sample-audio-gaps.wav`'s two tones as RMS: 12000 and 4000 int16 peak sines,
 * read back by `audioLevelsInPage` at 0.2590 and 0.0863 (fidelity.spec).
 */
const GAPS_LOUD = 12000 / 32768 / Math.SQRT2;
const GAPS_QUIET = 4000 / 32768 / Math.SQRT2;

/** Windows inside each span of the gaps fixture, 0.1 s clear of every edge. */
const GAPS_WINDOWS = [
  { from: 0.1, to: 0.9 },
  { from: 1.1, to: 1.9 },
  { from: 2.6, to: 3.4 },
  { from: 3.6, to: 4.4 },
  { from: 4.6, to: 5.4 },
];

/** The 2 s dyad fixture's steady stretch, clear of its 125 ms fades. */
const STEADY = [{ from: 0.3, to: 1.7 }];

function note(name: string, value: unknown): void {
  test.info().annotations.push({ type: name, description: JSON.stringify(value) });
}

/** Unweighted BS.1770-style loudness of a stereo window: −0.691 + 10·log10(Σ mean square). */
function approxLufs(rms: number[]): number {
  return -0.691 + 10 * Math.log10(rms.reduce((a, r) => a + r * r, 0));
}

async function gapsFixture() {
  return sample("sample-audio-gaps.wav", "audio/wav");
}

/** Pick an option out of one of `ToolChoice`'s labelled chip groups. */
function chip(page: Page, group: string, label: string) {
  return page.getByRole("group", { name: group }).getByRole("button", { name: label, exact: true });
}

/** Click the primary action and hand back the bytes it produced. */
async function runAndDownload(
  page: Page,
  action: RegExp,
  slug: string,
): Promise<{ name: string; bytes: Buffer }> {
  const button = primaryAction(page, action);
  await expect(button, `${slug} never offered its primary action`).toBeEnabled({
    timeout: 60_000,
  });
  await button.click();

  const dl = downloadAffordance(page);
  await expect(dl, `${slug} failed: ${await toolError(page)}`).toBeVisible({ timeout: 150_000 });
  return captureDownload(page, dl);
}

/**
 * Decode two WAVs in the page and compare the second against the first read
 * backwards.
 *
 * `reversedDelta` is the claim; `identityDelta` is the control that stops this
 * from being a test a no-op passes. A tool that handed the input straight back
 * would score 0 on the control and something large on the claim, which is
 * exactly the pair asserted at the call site.
 *
 * The context is pinned to the source's own rate so `decodeAudioData` does no
 * resampling — a resampler's own filter would otherwise show up in the
 * difference and there would be no honest tolerance to pick.
 */
async function compareReversed(
  page: Page,
  source: Buffer,
  output: Buffer,
  sampleRate: number,
): Promise<{ reversedDelta: number; identityDelta: number; frames: number }> {
  return page.evaluate(
    async ({ a, b, rate }: { a: string; b: string; rate: number }) => {
      const toBuffer = (b64: string) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      };
      const ac = new AudioContext({ sampleRate: rate });
      try {
        const src = await ac.decodeAudioData(toBuffer(a));
        const out = await ac.decodeAudioData(toBuffer(b));
        const frames = Math.min(src.length, out.length);
        const left = src.getChannelData(0);
        const right = out.getChannelData(0);
        let reversedDelta = 0;
        let identityDelta = 0;
        // Every 7th sample: enough of the 240k frames to catch a partial
        // reversal, cheap enough not to stall the page.
        for (let i = 0; i < frames; i += 7) {
          reversedDelta = Math.max(reversedDelta, Math.abs(right[i] - left[src.length - 1 - i]));
          identityDelta = Math.max(identityDelta, Math.abs(right[i] - left[i]));
        }
        return { reversedDelta, identityDelta, frames };
      } finally {
        await ac.close();
      }
    },
    { a: source.toString("base64"), b: output.toString("base64"), rate: sampleRate },
  );
}

test.describe("audio effects — real filters, real samples", () => {
  test.beforeEach(({ page }) => {
    // normalize-audio and remove-silence both reach the WASM core; it must come
    // from our own origin, never a CDN.
    forbidCdnCore(page);
  });

  /**
   * THE 192 kHz TRAP.
   *
   * `loudnorm` is a double-precision filter that negotiates 192 kHz on its
   * output link. Delete the `-ar` from `loudnormPass2Args` and this run still
   * exits 0, still produces a perfectly valid WAV, and still offers a download
   * — at 4.35x the size and a rate the user never chose. WAV output is used
   * deliberately: the MP3 arm caps at 48 kHz, so it cannot tell the two apart.
   */
  test("normalize-audio keeps the source rate instead of loudnorm's 192 kHz", async ({
    page,
  }) => {
    await page.goto("/normalize-audio");

    const source = await sample("sample-audio.wav", "audio/wav");
    expect(
      source.buffer.length,
      "the fixture must be the 44.1 kHz WAV the byte band below was measured against",
    ).toBe(NORMALIZE_SOURCE_BYTES);
    await uploadFixture(page, source);

    // WAV, so the rate written is the source's and not MP3's 48 kHz ceiling.
    await chip(page, "Output format", "WAV").click();

    const { name, bytes } = await runAndDownload(page, /^Normalise$/, "normalize-audio");
    expect(name).toMatch(/\.wav$/);

    // Read off the file's own fmt chunk. A browser decode is useless here: it
    // always reports the AudioContext's rate, not the file's.
    const wav = assertWav(bytes);
    expect(
      wav.sampleRate,
      "loudnorm resamples to 192000 Hz unless the output `-ar` pins the source rate",
    ).toBe(SOURCE_SAMPLE_RATE);
    expect(wav.channels, "the source is stereo and nothing here downmixes").toBe(2);
    expect(wav.peak, "a normalised file must not be digital silence").toBeGreaterThan(0.05);

    // Content: the level actually MOVED to the target, and it is still the
    // same two tones. The default chip is "podcast", −16 LUFS; the source
    // reads −9.42 on the same meter, so a no-op misses by 6.6 LU.
    const srcLevel = approxLufs((await audioLevelsInPage(page, source.buffer, STEADY)).rms[0]);
    const outLevel = approxLufs((await audioLevelsInPage(page, bytes, STEADY)).rms[0]);
    note("loudness (unweighted LUFS)", { source: srcLevel, output: outLevel });
    expect(outLevel, `normalised to ${outLevel.toFixed(2)} from ${srcLevel.toFixed(2)}, target −16`).toBeGreaterThan(-16 - NORMALIZE_TOLERANCE_LU);
    expect(outLevel).toBeLessThan(-16 + NORMALIZE_TOLERANCE_LU);
    note("purity", (await expectDyad(page, bytes, { label: "normalize-audio" })).channels.map((c) => c.purity));

    expect(
      bytes.length,
      `a 192 kHz output measures 1,536,102 B against the source's ${NORMALIZE_SOURCE_BYTES}`,
    ).toBeGreaterThan(NORMALIZED_WAV_MIN_BYTES);
    expect(bytes.length).toBeLessThan(NORMALIZED_WAV_MAX_BYTES);

    const surface = page.locator("[data-tool-surface]");
    /*
      The rate the page CLAIMS it wrote. Asserted as an ABSENCE rather than as
      "44.1 kHz": the canvas header prints the source's rate from the preview
      decode whatever the run did, so a positive match there proves nothing.
      `192.0 kHz` can only ever come from `NormalizeAudioResult.sampleRate`,
      which is the rate `-ar` actually pinned.
    */
    await expect(surface).not.toContainText("192.0 kHz");

    /*
      And the two-pass claim, which is derived from the argv that ran rather
      than asserted by the page. A single-pass fallback renders "One pass" here
      and raises a warning; the measurement says this file analyses cleanly, so
      "Two passes" is the honest answer and anything else is a regression.
    */
    await expect(surface).toContainText("Two passes");
    await expect(surface).not.toContainText("One pass");
    await expect(surface).toContainText("Analysed in two passes");
    expect(
      await toolError(page),
      "a clean two-pass normalise raises nothing",
    ).toBeNull();
  });

  /**
   * "Ends only": the leading and trailing silence go, the 1.5 s gap between the
   * two tones stays. Measured 3.499683 s out of 5.500000 s.
   */
  test("remove-silence trims the outer quiet and keeps the gap in the middle", async ({
    page,
  }) => {
    await page.goto("/remove-silence");
    await uploadFixture(page, await gapsFixture());

    // WAV out, so the decoded duration is the filter's answer and not an MP3
    // encoder's padding.
    await chip(page, "Output format", "WAV").click();

    const { name, bytes } = await runAndDownload(page, /^Remove silence$/, "remove-silence");
    expect(name).toMatch(/\.wav$/);

    const wav = assertWav(bytes);
    expect(wav.sampleRate, "silenceremove preserves the source rate").toBe(SOURCE_SAMPLE_RATE);

    const decoded = await decodeAudioInPage(page, bytes);
    expect(
      decoded.duration,
      `the two outer silences are 2.0 s of the source's ${GAPS_SECONDS} s`,
    ).toBeGreaterThan(GAPS_ENDS_SECONDS - 0.2);
    expect(
      decoded.duration,
      "nothing but the outer silence should have gone — the middle gap stays",
    ).toBeLessThan(GAPS_ENDS_SECONDS + 0.2);
    expect(decoded.peak, "the tones must survive the trim").toBeGreaterThan(0.05);

    // Content: loud tone, the kept 1.5 s gap, quiet tone — in that order, at
    // their source levels. A cut in the wrong place, or one that ate into a
    // tone, moves a window's level or puts sound where the gap should be.
    const levels = await audioLevelsInPage(page, bytes, [
      { from: 0.1, to: 0.9 },
      { from: 1.1, to: 2.4 },
      { from: 2.6, to: 3.4 },
    ]);
    note("levels", levels.rms);
    expectLevels(levels, [GAPS_LOUD, 0, GAPS_QUIET], { label: "remove-silence ends" });
    const tones = await audioTonesInPage(page, bytes, [440], { from: 0.1, to: 0.9 });
    note("purity", tones.channels.map((c) => c.purity));
    expectTones(tones, [440, 440], { label: "remove-silence ends, loud tone" });

    // And the page's own arithmetic, off the engine's report of the run.
    const surface = page.locator("[data-tool-surface]");
    await expect(surface).toContainText("5.5 s");
    await expect(surface).toContainText("3.5 s");
    await expect(surface).toContainText("2.0 s of silence gone");
  });

  /** "Every gap": all three stretches go. Measured 2.039683 s. */
  test("remove-silence takes every gap out when asked for all of them", async ({ page }) => {
    await page.goto("/remove-silence");
    await uploadFixture(page, await gapsFixture());

    await chip(page, "Which silence to remove", "Every gap").click();
    await chip(page, "Output format", "WAV").click();

    const { bytes } = await runAndDownload(page, /^Remove silence$/, "remove-silence");

    const decoded = await decodeAudioInPage(page, bytes);
    expect(
      decoded.duration,
      `all 3.5 s of silence should be gone from the source's ${GAPS_SECONDS} s`,
    ).toBeGreaterThan(GAPS_ALL_SECONDS - 0.25);
    expect(decoded.duration).toBeLessThan(GAPS_ALL_SECONDS + 0.25);
    expect(
      decoded.duration,
      "'every gap' must remove strictly more than 'ends only' did",
    ).toBeLessThan(GAPS_ENDS_SECONDS - 0.5);
    expect(decoded.peak, "the two tones must still be there").toBeGreaterThan(0.05);

    // Content: the two tones back to back, loud then quiet, nothing between.
    const levels = await audioLevelsInPage(page, bytes, [
      { from: 0.1, to: 0.9 },
      { from: 1.15, to: 1.95 },
    ]);
    note("levels", { duration: decoded.duration, rms: levels.rms });
    expectLevels(levels, [GAPS_LOUD, GAPS_QUIET], { label: "remove-silence all" });
    const tones = await audioTonesInPage(page, bytes, [440], { from: 1.15, to: 1.95 });
    note("purity", tones.channels.map((c) => c.purity));
    expectTones(tones, [440, 440], { label: "remove-silence all, quiet tone" });
  });

  /**
   * The gain is a plain multiply with no limiter, so both halves of the claim
   * are checkable: the peak really moves, and going over full scale is
   * reported rather than quietly flattened.
   */
  test("change-audio-volume moves the decoded peak and owns up to clipping", async ({ page }) => {
    await page.goto("/change-audio-volume");
    await uploadFixture(page, await sample("sample-audio.wav", "audio/wav"));
    await chip(page, "Output format", "WAV").click();

    const surface = page.locator("[data-tool-surface]");
    // By ROLE, not by label: once a run finishes the download button is
    // labelled "Download sample-audio-volume.wav", which `getByLabel("Volume")`
    // also matches.
    const volume = page.getByRole("slider", { name: "Volume" });

    // ── Down 12 dB: the peak must drop by roughly a factor of four. ──
    await volume.fill("-12");
    const quiet = await runAndDownload(page, /^Apply$/, "change-audio-volume");
    const quietWav = assertWav(quiet.bytes);
    expect(
      quietWav.peak,
      "the fixture peaks at about 0.366, so −12 dB lands near 0.092",
    ).toBeGreaterThan(0.06);
    expect(quietWav.peak, "−12 dB must actually be quieter than the source").toBeLessThan(0.15);

    const source = await sample("sample-audio.wav", "audio/wav");
    const srcRms = (await audioLevelsInPage(page, source.buffer, STEADY)).rms[0];
    const quietRms = (await audioLevelsInPage(page, quiet.bytes, STEADY)).rms[0];
    // Measured −12.00 dB on both channels, both engines.
    const quietGain = quietRms.map((r, c) => dB(r / srcRms[c]));
    note("−12 dB measured gain per channel", quietGain);
    for (const g of quietGain) {
      expect(g, "the RMS must move by the chosen gain, on every channel").toBeGreaterThan(-12 - 0.5);
      expect(g).toBeLessThan(-12 + 0.5);
    }
    note("−12 dB purity", (await expectDyad(page, quiet.bytes, { label: "volume −12 dB" })).channels.map((c) => c.purity));

    const quietDecoded = await decodeAudioInPage(page, quiet.bytes);
    expect(quietDecoded.peak, "a gain change must not produce silence").toBeGreaterThan(0.05);
    expect(quietDecoded.peak).toBeLessThan(0.2);
    await expect(surface, "nothing was pushed over full scale").toContainText(
      "The loudest peak still fits under full scale",
    );
    await expect(surface).not.toContainText("above the 0 dBFS ceiling");

    // ── Up 12 dB from the same file: over full scale, and said so. ──
    // Moving the slider drops the finished run, so the primary action returns.
    await volume.fill("12");
    const loud = await runAndDownload(page, /^Apply$/, "change-audio-volume");
    const loudWav = assertWav(loud.bytes);
    expect(
      loudWav.peak,
      "+12 dB on a −8.7 dBFS source cannot fit, so the stored peak is full scale",
    ).toBeGreaterThan(0.98);

    // Louder by a lot, though not the full 12 dB: the samples past full
    // scale were clipped on the way into 16 bits (measured +10.14 dB RMS).
    const loudRms = (await audioLevelsInPage(page, loud.bytes, STEADY)).rms[0];
    const loudGain = loudRms.map((r, c) => dB(r / srcRms[c]));
    note("+12 dB measured gain per channel", loudGain);
    for (const g of loudGain) expect(g, "+12 dB must make it substantially louder").toBeGreaterThan(6);

    // The report, not a limiter: the page has to name the overshoot.
    await expect(surface).toContainText("above the 0 dBFS ceiling");
    await expect(surface).toContainText("The peaks above full scale cannot be stored");
    await expect(surface).not.toContainText("The loudest peak still fits under full scale");
  });

  /**
   * A reversal that is asserted as a reversal.
   *
   * `sample-audio-gaps.wav` is used rather than `sample-audio.wav` because the
   * latter's envelope is symmetric by construction — a no-op and a reversal
   * decode to the same thing, and no assertion over it can fail. The gaps
   * fixture carries a loud tone at 1–2 s and a quiet one at 3.5–4.5 s, so the
   * two directions are unmistakable.
   */
  test("reverse-audio hands back the source samples in the opposite order", async ({ page }) => {
    await page.goto("/reverse-audio");

    const source = await gapsFixture();
    await uploadFixture(page, source);
    // WAV so the comparison is against 16-bit quantisation only, with no lossy
    // codec between the two sample sets.
    await chip(page, "Output format", "WAV").click();

    const { name, bytes } = await runAndDownload(page, /^Reverse$/, "reverse-audio");
    expect(name).toMatch(/\.wav$/);

    const wav = assertWav(bytes);
    expect(wav.sampleRate, "reversing changes the order, not the rate").toBe(SOURCE_SAMPLE_RATE);
    expect(wav.channels).toBe(2);

    const { reversedDelta, identityDelta, frames } = await compareReversed(
      page,
      source.buffer,
      bytes,
      SOURCE_SAMPLE_RATE,
    );
    expect(frames, "both files must decode to the full 5.5 s").toBeGreaterThan(
      SOURCE_SAMPLE_RATE * (GAPS_SECONDS - 0.1),
    );
    expect(
      reversedDelta,
      "every sample must match the source's read backwards, within 16-bit quantisation",
    ).toBeLessThan(0.002);
    expect(
      identityDelta,
      "control: an output that merely copied the input would score 0 here",
    ).toBeGreaterThan(0.05);

    // The envelope, as a listener hears it: quiet tone first, loud one last,
    // gaps where they mirror to — and both still a clean 440 Hz.
    const levels = await audioLevelsInPage(page, bytes, GAPS_WINDOWS);
    note("levels", levels.rms);
    expectLevels(levels, [0, GAPS_QUIET, 0, GAPS_LOUD, 0], { label: "reverse-audio" });
    for (const w of [GAPS_WINDOWS[1], GAPS_WINDOWS[3]]) {
      const tones = await audioTonesInPage(page, bytes, [440], w);
      note(`purity ${w.from}–${w.to}`, tones.channels.map((c) => c.purity));
      expectTones(tones, [440, 440], { label: `reverse-audio ${w.from}–${w.to}s` });
    }
  });
});
