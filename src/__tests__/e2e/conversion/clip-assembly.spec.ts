import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeVideoInPage,
  parseIsoBmff,
  videoTrack,
  forbidCdnCore,
  toolError,
} from "./support";
import { assertZip } from "./validators";
import { VIDEO_MAE, compareVideoToSource, expectVideoMatches } from "./fidelity";

/**
 * Cutting a clip into parts, and joining parts back into a clip — the two
 * stream-copy tools, and the two measurements that made them worth building.
 *
 * ⚠ THE JOIN IS THE HEADLINE. The concat demuxer EXITS 0 while silently
 * dropping every input after the first when the containers disagree. Measured
 * against this repo's own fixtures, with the shipped core:
 *
 *     inputs                      exit   expected   actual
 *     ---------------------------------------------------------
 *     sample-video.mp4 + .mov       0     4.180 s    4.180 s   ok
 *     sample-video.mp4 + .mkv       0     4.180 s    2.090 s   SILENT LOSS
 *
 * The losing pair agrees on EVERY stream property anyone would think to
 * compare — same h264, 320x240, yuv420p, aac 44100 Hz stereo. Only the
 * container differs. So the refusal below is not an error path being smoke
 * tested; it is the feature, and a version of this tool that merely trusted
 * FFmpeg's exit code would hand the user a video with a clip missing and call
 * it a success.
 *
 * ⚠ AND THE CUT REPORTS WHAT IT WROTE, NOT WHAT WAS ASKED FOR. A stream copy
 * can only cut at a keyframe, so a part asked to be 1.000 s of this fixture
 * measures 1.022 s. Every row's ACTUAL column is probed off the finished part,
 * and the test below proves that by probing the same part itself.
 *
 * TITLE TRAP — `playwright.config.ts:63` sets `grepInvert: /gif|FFmpeg|MP4/i`
 * on `conversion-webkit`, matched against the project name, the FILE PATH,
 * every describe title and every test title. None of those tokens may appear
 * in this file's name or in any title below, or WebKit silently drops the case
 * with no warning. Container names and slugs inside a test body are fine.
 */

/** `sample-video.mp4` is 2.090 s; `sample-video.mov` is the same clip. */
const SOURCE_SECONDS = 2.09;
/** Two identical clips joined end to end. */
const JOINED_SECONDS = 4.18;

/** Read one entry out of a downloaded archive. */
async function zipEntry(archive: Buffer, name: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(archive);
  const entry = zip.files[name];
  expect(entry, `the archive has no entry called ${name}`).toBeTruthy();
  return Buffer.from(await entry.async("uint8array"));
}

/** Everything the tool has rendered about this file, as one string. */
function surfaceOf(page: Page) {
  return page.locator("[data-tool-surface]");
}

test.describe("cutting a clip into parts, and joining parts into a clip", () => {
  test.beforeEach(({ page }) => {
    forbidCdnCore(page);
  });

  /**
   * THE KEYFRAME-DRIFT DISCLOSURE.
   *
   * A cut asked to end at 1.000 s cannot land there: `-c copy` moves the
   * boundary back to the nearest keyframe. This asserts the page prints the
   * length of the file it actually wrote — probed here independently, off the
   * part pulled out of the downloaded archive — and not the length that was
   * requested. Make the ACTUAL column render `requestedEnd - requestedStart`
   * and this goes red.
   */
  test("split-video reports each part's measured length, not the requested one", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/split-video");

    const source = await SAMPLES.mp4();
    await uploadFixture(page, source);

    const surface = surfaceOf(page);
    // The probe has to land before a plan exists; the stat strip says so.
    await expect(surface, `probe failed: ${await toolError(page)}`).toContainText("2.09 s", {
      timeout: 60_000,
    });

    // "At times" with a single cut at 1 s is the exact shape that was measured.
    await page
      .getByRole("group", { name: "Split mode" })
      .getByRole("button", { name: "At times", exact: true })
      .click();
    await page.getByLabel("Times to cut at").fill("1");

    const run = primaryAction(page, /^Cut into 2 parts$/);
    await expect(run, "two cut points should plan two parts").toBeEnabled({ timeout: 30_000 });
    await run.click();

    const dl = downloadAffordance(page);
    await expect(dl, `split failed: ${await toolError(page)}`).toBeVisible({ timeout: 180_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-video-parts.zip");
    const entries = await assertZip(bytes, { minEntries: 2 });
    expect(entries.sort()).toEqual(["sample-video-part-01.mp4", "sample-video-part-02.mp4"]);

    // ── The first part is a real, playable video of the source's own size.
    const part = await zipEntry(bytes, "sample-video-part-01.mp4");
    const probed = await probeVideoInPage(page, part, "video/mp4");
    expect(probed.width, "a stream copy keeps the source's frame size").toBe(320);
    expect(probed.height).toBe(240);
    expect(probed.duration, "and it holds about the second that was asked for").toBeGreaterThan(
      0.9,
    );

    /*
      ── The two columns, read off THE SAME ROW.

      Deliberately not "probe the part in the browser and expect the page to
      print that number": measured, WebKit's `<video>.duration` reports this
      part as exactly 1.000 s where Chromium reports 1.022 s, so a test written
      that way would demand the page render a different figure per engine. The
      page's own ACTUAL comes from FFmpeg probing the written file, which is
      the same engine in both projects — so the invariant asserted here is that
      the two columns DISAGREE, in the direction a keyframe cut always moves.
    */
    const rangeCell = surface.getByText("0.00 s → 1.00 s", { exact: true });
    await expect(rangeCell, "the first part should span 0 s to the cut").toBeVisible();
    const cells = await rangeCell.locator("xpath=..").locator("span").allInnerTexts();
    expect(cells.length, "each row is #, range, asked, actual, size").toBe(5);

    const [, , askedCell, actualCell] = cells;
    expect(askedCell, "the ASKED column still shows what was requested").toBe("1.00 s");
    expect(
      actualCell,
      "the ACTUAL column must be the probed length of the written part, and a stream copy " +
        "cannot land on 1.000 s — printing the request here is the bug this pins",
    ).not.toBe(askedCell);
    expect(
      Number(actualCell.replace(" s", "")),
      "a keyframe boundary moves back, so the part runs LONGER than asked",
    ).toBeGreaterThan(1.0);
    expect(Number(actualCell.replace(" s", "")), "but only by up to one GOP").toBeLessThan(1.3);

    // The disclosure that makes the two columns make sense, and the copy claim
    // about what the parts are.
    await expect(surface).toContainText("WHY THE PARTS ARE NOT EXACT");
    await expect(surface).toContainText("a copy can only cut at a keyframe");
    await expect(surface).toContainText("NOT ONE FRAME WAS RE-ENCODED");

    // And the second part carries the rest of the clip, so nothing was lost.
    const second = await zipEntry(bytes, "sample-video-part-02.mp4");
    const secondProbe = await probeVideoInPage(page, second, "video/mp4");
    expect(
      probed.duration + secondProbe.duration,
      "the two parts together must still be the whole clip",
    ).toBeGreaterThan(SOURCE_SECONDS - 0.2);

    // Content: part 1 is the start of the source, and part 2 picks up exactly
    // where part 1 ends — no repeated, missing or wrong frames at the seam.
    const src = { bytes: source.buffer, mime: "video/mp4" };
    const p1 = await compareVideoToSource(page, src, { bytes: part, mime: "video/mp4" }, {
      outTimes: [0.1, probed.duration * 0.5, probed.duration - 0.1],
    });
    expectVideoMatches(p1.matches, { maxMae: VIDEO_MAE.copy + 2, label: "part 1" });
    const p2 = await compareVideoToSource(page, src, { bytes: second, mime: "video/mp4" }, {
      outTimes: [0.05, secondProbe.duration * 0.5, secondProbe.duration - 0.1],
      map: (t) => t + probed.duration,
    });
    expectVideoMatches(p2.matches, { maxMae: VIDEO_MAE.copy + 2, label: "part 2" });
  });

  /**
   * THE REFUSAL. `sample-video.mp4` and `sample-video.mkv` carry the identical
   * elementary streams and are the pair FFmpeg silently truncates. The tool has
   * to say so — naming the file and the property — and must not offer a join.
   */
  test("merge-video refuses a pair whose containers disagree, and says which", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/merge-video");
    await uploadFixture(page, [await SAMPLES.mp4(), await SAMPLES.mkv()]);

    const surface = surfaceOf(page);
    await expect(surface, `probe failed: ${await toolError(page)}`).toContainText("CAN'T JOIN", {
      timeout: 120_000,
    });

    // The refusal names the tool's reasoning, not just "incompatible".
    await expect(surface).toContainText("These clips can't be joined without re-encoding");
    await expect(surface).toContainText("joining anyway would produce a file with clips");

    // The table row: which file, which property, and both values.
    await expect(surface, "the offending file has to be named").toContainText(
      "sample-video.mkv",
    );
    await expect(surface, "and the property that differs").toContainText("file format");
    await expect(surface).toContainText("MP4/MOV");
    await expect(surface).toContainText("MKV/WebM");

    // No join is offered, and nothing was produced.
    await expect(
      primaryAction(page, /^Join 2 clips$/),
      "a set that would lose a clip must not be runnable",
    ).toBeDisabled();
    await expect(downloadAffordance(page)).toHaveCount(0);
  });

  /**
   * The positive half. `.mp4` + `.mov` share a demuxer and a timebase and were
   * measured joining cleanly at 4.180 s — so a tool that refused everything
   * would fail here rather than passing the case above for free.
   */
  test("merge-video joins two compatible clips into one, without re-encoding", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/merge-video");

    const first = await SAMPLES.mp4();
    await uploadFixture(page, [first, await SAMPLES.mov()]);

    const surface = surfaceOf(page);
    await expect(surface, `probe failed: ${await toolError(page)}`).toContainText("READY", {
      timeout: 120_000,
    });
    await expect(surface, "a compatible pair must not be reported as a mismatch").not.toContainText(
      "can't be joined without re-encoding",
    );

    const run = primaryAction(page, /^Join 2 clips$/);
    await expect(run).toBeEnabled({ timeout: 30_000 });
    await run.click();

    const dl = downloadAffordance(page);
    await expect(dl, `join failed: ${await toolError(page)}`).toBeVisible({ timeout: 180_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-video-joined.mp4");

    // The whole of both clips, not the first one and a success message.
    const probed = await probeVideoInPage(page, bytes, "video/mp4");
    expect(
      probed.duration,
      "a concat that dropped the second clip measures 2.09 s and still exits 0",
    ).toBeGreaterThan(JOINED_SECONDS - 0.2);
    expect(probed.duration).toBeLessThan(JOINED_SECONDS + 0.2);
    expect(probed.width).toBe(320);
    expect(probed.height).toBe(240);

    // "Nothing was re-encoded", checked against the bytes: the decoder
    // configuration record is the source's, and the sample table is both
    // clips' worth rather than one.
    const src = videoTrack(parseIsoBmff(first.buffer), "the source");
    const out = videoTrack(parseIsoBmff(bytes), "the joined file");
    expect(
      out.codecConfigHex,
      "a re-encode writes a different avcC — this must be the source's, untouched",
    ).toBe(src.codecConfigHex);
    expect(
      out.sampleSizes.length,
      `the join must carry both clips' frames (${src.sampleSizes.length} each)`,
    ).toBeGreaterThan(src.sampleSizes.length * 1.8);

    await expect(surface).toContainText("NOT ONE FRAME WAS RE-ENCODED");
    await expect(surface).toContainText("COPIED ACROSS BYTE FOR BYTE");

    // Content: the first clip, then the second clip from ITS start. Both are
    // the same frames, so a join that dropped, repeated or reordered the second
    // half shows up as the wrong frame at a known time.
    const firstLength = (await probeVideoInPage(page, first.buffer, "video/mp4")).duration;
    const joined = await compareVideoToSource(
      page,
      { bytes: first.buffer, mime: "video/mp4" },
      { bytes, mime: "video/mp4" },
      {
        outTimes: [0.4, 1.2, firstLength + 0.4, firstLength + 1.2],
        map: (t) => (t < firstLength ? t : t - firstLength),
      },
    );
    expectVideoMatches(joined.matches, { maxMae: VIDEO_MAE.copy + 2, label: "joined" });
  });
});
