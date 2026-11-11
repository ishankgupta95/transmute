import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  convert,
  corruptFixture,
  forbidCdnCore,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeVideoInPage,
  toolError,
  parseIsoBmff,
  parseMatroska,
  videoTrack,
  audioTracks,
  displayRotationClockwise,
  expectVideoStreamCopied,
} from "./support";
import { assertMp4 } from "./validators";
import { VIDEO_MAE, compareVideoToSource, expectVideoMatches } from "./fidelity";

/**
 * The container tools — `mov-to-mp4`, `mkv-to-mp4`, `avi-to-mp4`, `mp4-to-mkv`
 * and their siblings — plus `mute-video` and `rotate-video`.
 *
 * Every one of these is a stream copy: FFmpeg rewrites the wrapper and moves
 * the compressed video across without decoding a frame. That is also the whole
 * marketing claim ("no re-encode, no quality loss"), so the tests here are
 * built around proving it from the BYTES rather than from the label the tool
 * printed next to them. A tool that quietly re-encoded and then said it had not
 * is a copy-honesty bug, and it is the one this file is shaped to catch.
 *
 * HOW "THE STREAM WAS COPIED" IS PROVEN. `expectVideoStreamCopied` compares two
 * things between the checked-in `sample-video.mp4` and the tool's output: the
 * video track's decoder configuration record (`avcC` — the SPS and PPS a
 * decoder is set up from) and its whole `stsz` sample-size table. Measured on
 * this FFmpeg core:
 *
 *      operation                    avcC                stsz table
 *      --------------------------   -----------------   -----------------
 *      source sample-video.mp4      32 B  0142c00dff…   48 / sum 150200
 *      -c copy via .mov / .mkv /
 *        .avi and back              identical           identical
 *      -c:v libx264 (a re-encode)   41 B, different     48 / sum 275976
 *
 * Note the sample COUNT is 48 either way. `assertMp4` exposes only that count,
 * so an assertion built on it would pass on a re-encode — which is exactly why
 * the comparison here goes down to the table and the decoder config.
 *
 * NOTE ON TITLES: the `conversion-webkit` project greps out /gif|FFmpeg|MP4/i,
 * and Playwright matches that against the project name, the FILE PATH, every
 * describe title and the test title. Half the natural names for these tools
 * contain "MP4", and a single one of them would silently delete this file — or
 * a block of it — from WebKit with no warning of any kind. Hence the filename
 * `video-container.spec.ts` and the prose below: "MPEG-4", "QuickTime",
 * "Matroska", never the token. Slugs inside a test BODY are not matched and are
 * spelled normally.
 *
 * These cases belong in both engines. `video.spec.ts` is `testIgnore`d from
 * WebKit because it drives WebCodecs; nothing here does — FFmpeg.wasm runs fine
 * in Safari, and the H.265 branch below can only be *played* by WebKit anyway
 * (Playwright's Chromium cannot decode HEVC at all).
 */

/** The clip every fixture in this file is a container variant of. */
const SOURCE = { width: 320, height: 240, seconds: 2.09 };

/** Lossless rewrapping should not move the duration at all; the slack is for
 *  the demuxer's own rounding, not for a re-encode's padding. */
function expectDuration(actual: number, expected: number, slack = 0.35): void {
  expect(Math.abs(actual - expected), `duration ${actual}s vs expected ${expected}s`)
    .toBeLessThan(slack);
}

test.describe("video container tools — real output", () => {
  test("a QuickTime recording is rewrapped into the portable container", async ({ page }) => {
    const { name, bytes } = await convert(page, {
      slug: "mov-to-mp4",
      input: await SAMPLES.mov(),
      action: /^Convert$/,
    });

    expect(name).toBe("sample-video.mp4");
    assertMp4(bytes, { video: true, audio: true });

    // The strongest available validity signal: hand the bytes to a real
    // demuxer and read back what it found.
    const probed = await probeVideoInPage(page, bytes, "video/mp4");
    expectDuration(probed.duration, SOURCE.seconds);
    expect(probed.width).toBe(SOURCE.width);
    expect(probed.height).toBe(SOURCE.height);
  });

  test("the rewrap copies the video track instead of re-encoding it", async ({ page }) => {
    const source = await SAMPLES.mp4();
    const { bytes } = await convert(page, {
      slug: "mov-to-mp4",
      input: await SAMPLES.mov(),
      action: /^Convert$/,
    });

    // The fixture is a stream copy of `sample-video.mp4`, so a lossless rewrap
    // has to land back on that file's exact elementary stream.
    expectVideoStreamCopied(source.buffer, bytes, "the rewrapped file");

    // And the tool has to be saying so. Binding the two together is the point:
    // either claim on its own can be true while the pair is a lie.
    const surface = page.locator("[data-tool-surface]");
    await expect(surface).toContainText("NOTHING WAS RE-ENCODED");
    expect(await toolError(page)).toBeNull();
  });

  /*
    The other two inbound containers. Both are stream copies of the same MP4,
    so both must reproduce its video track exactly — including AVI, where
    FFmpeg has to rebuild the `avcC` from in-band SPS/PPS and (measured) lands
    on the identical 32 bytes.
  */
  for (const source of [
    { article: "a", label: "Matroska", slug: "mkv-to-mp4", fixture: SAMPLES.mkv },
    { article: "an", label: "AVI", slug: "avi-to-mp4", fixture: SAMPLES.avi },
  ] as const) {
    test(`${source.article} ${source.label} recording is rewrapped and its video track survives untouched`, async ({
      page,
    }) => {
      const original = await SAMPLES.mp4();
      const { name, bytes } = await convert(page, {
        slug: source.slug,
        input: await source.fixture(),
        action: /^Convert$/,
      });

      expect(name).toBe("sample-video.mp4");
      assertMp4(bytes, { video: true, audio: true });
      expectVideoStreamCopied(original.buffer, bytes, `the ${source.label} rewrap`);
      await expect(page.locator("[data-tool-surface]")).toContainText("NOTHING WAS RE-ENCODED");
    });
  }

  test("the reverse direction writes a Matroska file carrying the original decoder config", async ({
    page,
  }) => {
    const source = await SAMPLES.mp4();
    const { name, bytes } = await convert(page, {
      slug: "mp4-to-mkv",
      input: source,
      action: /^Convert$/,
    });

    expect(name).toBe("sample-video.mkv");
    /*
      Byte-level only, and deliberately so: measured, WebKit cannot decode
      Matroska at all, so `probeVideoInPage` would fail here for a reason that
      has nothing to do with the tool. The EBML structure runs in both engines.
    */
    const mkv = parseMatroska(bytes);
    expect(mkv.magic, "Matroska files start with the EBML magic").toBe("1a45dfa3");

    const video = mkv.tracks.find((t) => t.trackType === 1);
    expect(video, `no video track in [${mkv.tracks.map((t) => t.codecId).join(", ")}]`)
      .toBeTruthy();
    expect(video!.codecId).toBe("V_MPEG4/ISO/AVC");
    expect(video!.width).toBe(SOURCE.width);
    expect(video!.height).toBe(SOURCE.height);

    // Matroska stores the AVCC record verbatim as CodecPrivate, so the
    // no-re-encode claim is checkable across the container boundary.
    const sourceConfig = videoTrack(parseIsoBmff(source.buffer), "the source").codecConfigHex;
    expect(sourceConfig, "the source fixture must carry an avcC to compare against").toBeTruthy();
    expect(
      video!.codecPrivateHex,
      "the Matroska file re-encoded the video: its CodecPrivate is not the source's avcC",
    ).toBe(sourceConfig);

    const audio = mkv.tracks.find((t) => t.trackType === 2);
    expect(audio?.codecId, "the audio track should have come across too").toBe("A_AAC");
    await expect(page.locator("[data-tool-surface]")).toContainText("NOTHING WAS RE-ENCODED");
  });

  test("removing the audio leaves the picture bit for bit", async ({ page }) => {
    const source = await SAMPLES.mp4();
    const { name, bytes } = await convert(page, {
      slug: "mute-video",
      input: source,
      action: /^Remove audio$/,
    });

    expect(name).toBe("sample-video-muted.mp4");
    const info = assertMp4(bytes, { video: true });

    // The track really has to be gone, not merely silent. Both halves are
    // checked because a muxer can leave an empty `soun` trak behind.
    expect(audioTracks(parseIsoBmff(bytes)), "the muted file still carries an audio track")
      .toHaveLength(0);
    expect([...info.boxes], "an AAC sample entry survived the mute").not.toContain("mp4a");

    expectVideoStreamCopied(source.buffer, bytes, "the muted file");

    // And nothing but the audio left: what remains in `mdat` is exactly the
    // video samples, so the audio was dropped rather than zeroed.
    const videoBytes = videoTrack(parseIsoBmff(source.buffer))
      .sampleSizes.reduce((a, b) => a + b, 0);
    expect(parseIsoBmff(bytes).mdatBytes).toBe(videoBytes);

    await expect(page.locator("[data-tool-surface]")).toContainText("WAS NOT RE-ENCODED");
  });

  test("rotating rewrites the display flag and leaves every frame alone", async ({ page }) => {
    const source = await SAMPLES.mp4();

    // Falsification check first: the assertion below can only mean something if
    // the source reads back as unrotated.
    const before = videoTrack(parseIsoBmff(source.buffer), "the source");
    expect(displayRotationClockwise(before.matrix!), "the fixture should start upright").toBe(0);

    const { name, bytes } = await convert(page, {
      slug: "rotate-video",
      input: source,
      action: /^Rotate$/,
    });

    expect(name).toBe("sample-video-rotated.mp4");
    assertMp4(bytes, { video: true, audio: true });

    /*
      The rotation has to survive being written out and read back — a display
      matrix the tool only ever held in memory would rotate nothing.

      Read CLOCKWISE, deliberately. FFmpeg's `rotate` tag counts the other way,
      so a tool that wrote the control's "90" straight into the tag would turn
      every video anti-clockwise while an assertion in FFmpeg's own convention
      nodded along. In this convention that mistake reads back as 270 and goes
      red. (For the record, `ffprobe` will describe this same file as
      "displaymatrix: rotation of -90.00 degrees" — the same fact, counted the
      other way.)
    */
    const after = videoTrack(parseIsoBmff(bytes), "the rotated file");
    expect(after.matrix, "the rotated file carries no display matrix at all").toBeTruthy();
    expect(
      displayRotationClockwise(after.matrix!),
      `expected a quarter turn clockwise, got the matrix [${after.matrix!.join(", ")}]`,
    ).toBe(90);

    // …and the frames must be untouched, which is the tool's entire pitch:
    // ~6 ms against ~7.6 s for the equivalent re-encode.
    expectVideoStreamCopied(source.buffer, bytes, "the rotated file");
    expect(parseIsoBmff(bytes).mdatBytes).toBe(parseIsoBmff(source.buffer).mdatBytes);

    await expect(page.locator("[data-tool-surface]")).toContainText("NOT ONE PIXEL WAS TOUCHED");

    /*
      What the user sees. A display matrix is only worth anything if players
      honour it, so play the file back and look: it must come out 240×320 with
      every frame the source's frame turned a quarter clockwise. A matrix
      written the wrong way round, or one players ignore, fails here even
      though every byte check above passes.
    */
    const shown = await compareVideoToSource(
      page,
      { bytes: source.buffer, mime: "video/mp4" },
      { bytes, mime: "video/mp4" },
      { outTimes: [0.25, 1, 1.7], transform: "rot90" },
    );
    expect({ width: shown.output.width, height: shown.output.height }, "played back upright-portrait").toEqual({
      width: SOURCE.height,
      height: SOURCE.width,
    });
    expectVideoMatches(shown.matches, { maxMae: VIDEO_MAE.copy + 2, label: "rotated playback" });
  });

  /*
    The plain refusal. `ffprobe` on undecodable bytes is measured at 6 ms and
    returns the JSON body "{\n\n}" with exit code -1 — and it returns -1 on
    VALID files too, so the tool has to notice the empty body rather than trust
    the exit code. Get that wrong in the forgiving direction and the run
    proceeds on a file with no known codec, which is how a tool ends up handing
    back a zero-byte download under a confident filename.
  */
  test("a file that is not readable video is refused before anything is produced", async ({
    page,
  }) => {
    forbidCdnCore(page);
    await page.goto("/mov-to-mp4");
    await uploadFixture(page, corruptFixture("clip.mov", "video/quicktime"));

    // Polled rather than located: the message only appears once the engine has
    // loaded and failed to read the file.
    await expect.poll(() => toolError(page), { timeout: 120_000 }).not.toBeNull();
    const message = (await toolError(page)) ?? "";

    expect(message).toContain("clip.mov");
    /*
      "memory access out of bounds" is in the loader's OOM signature list, so a
      wasm trap gets reported to the user as "Ran out of memory. A browser tab
      can hold about 1795 MB…" — for a 4 KB file. This path must reach the
      friendly message instead of tripping that.
    */
    expect(message, "an unreadable 4 KB file must not be reported as running out of memory")
      .not.toMatch(/ran out of memory/i);

    await expect(primaryAction(page, /^Convert$/)).toBeDisabled();
    await expect(downloadAffordance(page)).toHaveCount(0);
  });

  /*
    The refusal, and the honest alternative behind it.

    An iPhone .mov is routinely H.265, and `-c copy` into MPEG-4 SUCCEEDS on
    one: measured, it produces a structurally valid file whose video is still
    `hvc1` — which is precisely why it would not play wherever the user was
    trying to put it. Reporting that run as a success is the silent failure this
    whole cluster exists to stop, so the tool must refuse to start until the
    user has chosen the re-encode by name, and must then say that it re-encoded.
  */
  test("an H.265 recording is never quietly rewrapped", async ({ page }) => {
    forbidCdnCore(page);
    const hevc = await SAMPLES.hevcMov();

    // The fixture has to actually be H.265, or this test proves nothing.
    const sourceVideo = videoTrack(parseIsoBmff(hevc.buffer), "the H.265 fixture");
    expect(sourceVideo.sampleEntry, "the fixture is not an H.265 recording").toBe("hvc1");

    await page.goto("/mov-to-mp4");
    await uploadFixture(page, hevc);

    const surface = page.locator("[data-tool-surface]");
    // Stated before anything runs, and stated in the user's vocabulary rather
    // than ffprobe's ("hevc").
    await expect(surface).toContainText(/This recording is H\.265/, { timeout: 120_000 });

    const run = primaryAction(page, /^Convert$/);
    await expect(run, "the run must be blocked until the user chooses").toBeDisabled();
    await expect(downloadAffordance(page)).toHaveCount(0);
    expect(await toolError(page)).toBeNull();

    // The explicit second choice. Only now may anything run.
    await page.getByRole("button", { name: "Re-encode to H.264" }).click();
    await expect(run).toBeEnabled();
    await run.click();

    const dl = downloadAffordance(page);
    await expect(dl, `tool error: ${await toolError(page)}`).toBeVisible({ timeout: 150_000 });
    const { bytes } = await captureDownload(page, dl);

    // A real H.264 encode, not the source's H.265 wearing a new extension.
    assertMp4(bytes, { video: true, audio: true });
    const out = videoTrack(parseIsoBmff(bytes), "the converted file");
    expect(out.sampleEntry, "the H.265 stream was copied across instead of converted")
      .toBe("avc1");
    expect(out.codecConfigHex).not.toBe(sourceVideo.codecConfigHex);

    // …and the tool has to own it. The lossless sentence must be nowhere on the
    // page after a run that decoded and re-encoded every frame.
    await expect(surface).toContainText("THIS RUN RE-ENCODED THE VIDEO TO H.264");
    await expect(surface).not.toContainText("NOTHING WAS RE-ENCODED");
  });
});
