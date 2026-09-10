import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  forbidCdnCore,
  toolError,
} from "./support";
import { assertZip } from "./validators";

/**
 * WHERE THE FRAME WALK STOPS — the end-of-clip contract that /video-to-images,
 * /video-to-gif, /compress-video and /webm-to-mp4 all inherit from the single
 * `playAndExtractFrames` in `lib/tools/video-utils.ts`.
 *
 * This exists because that walk was carried as a defect ("the last planned
 * frame is dropped at end-of-clip; give the outstanding moment one more frame
 * callback after `ended`") and the measurement said otherwise. The numbers,
 * taken from the fixture's own boxes and from headless Chromium and WebKit:
 *
 *   · `sample-video.mp4`'s video track is ONE `stts` entry — 48 samples of
 *     2400/57600 s. Its last picture is presented at 1.958333 s and the track
 *     ends at exactly 2.000000 s. The 2.089796 s the element reports as
 *     `duration` is the AUDIO track (`mdhd` timescale 44100, duration 92160).
 *   · rVFC delivered all 48 of those pictures before `ended` fired, in every
 *     run of both engines. The walk loses nothing it is given.
 *   · So the third moment "every 1 s" plans — 2.000 s, planned off `duration`
 *     — is a moment this file HAS NO PICTURE AT, and the tool's warning about
 *     it is true rather than a symptom.
 *   · Seeking there after `ended` does return a frame: `mediaTime` 1.958333,
 *     pixel-identical to the one already saved. Recovering it would file a
 *     duplicate under a timestamp the clip has no picture at.
 *
 * Every assertion below is chosen to go red on that "recovery": a third entry
 * would have to claim a moment at or after 2.000 s, or repeat a picture, or
 * break the saved+missing arithmetic. And the counts here are EXACT: the
 * sibling case in `frame-export.spec.ts` asserts `fewer than 3` and then builds
 * its expected sentence out of the number it got back, and that PAIR of
 * assertions is self-consistent at one frame or at zero — so on its own it
 * cannot tell "the clip has no picture at 2 s" from "the walk lost the 1 s
 * frame as well". `toBe(2)` below is what separates them.
 *
 * TITLE TRAP — `playwright.config.ts:62` sets `grepInvert: /gif|FFmpeg|MP4/i`
 * on `conversion-webkit`, matched against the project name, the FILE PATH and
 * every describe/test title joined together. None of those tokens appear in
 * this file's name or in any title here; slugs inside a body are fine.
 */

/**
 * The last instant `sample-video.mp4` carries a picture at, from its `stts`:
 * 48 samples x 2400/57600 s. Anything the tool files at or after this is a
 * frame it invented.
 */
const PICTURE_ENDS_AT_SECONDS = 2.0;

/** `frame-002-00m01.031s.png` — index, then the moment it came from. */
const FRAME_NAME = /^frame-(\d{3,})-(\d{2})m(\d{2}\.\d{3})s\.png$/;

function momentOf(entry: string): number {
  const match = FRAME_NAME.exec(entry);
  expect(match, `${entry} is not a frame filename`).not.toBeNull();
  return Number(match![2]) * 60 + Number(match![3]);
}

async function zipEntry(archive: Buffer, name: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(archive);
  return Buffer.from(await zip.files[name].async("uint8array"));
}

test.describe("the frame walk at the end of a clip", () => {
  test.beforeEach(({ page }) => {
    forbidCdnCore(page);
  });

  test("saves a picture for every moment the clip has one, and invents none for the moments it does not", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/video-to-images");
    await uploadFixture(page, await SAMPLES.mp4());

    const surface = page.locator("[data-tool-surface]");
    await page
      .getByRole("group", { name: "Sampling" })
      .getByRole("button", { name: "Every N sec", exact: true })
      .click();

    const run = primaryAction(page, /^Extract frames$/);
    await expect(run, "video-to-images never offered its primary action").toBeEnabled({
      timeout: 60_000,
    });
    await run.click();
    const download = downloadAffordance(page);
    await expect(download, `video-to-images failed: ${await toolError(page)}`).toBeVisible({
      timeout: 150_000,
    });
    const { bytes } = await captureDownload(page, download);

    const entries = (await assertZip(bytes, { minEntries: 1 })).sort();

    /*
      TWO, exactly. One a second over a clip the element calls 2.089796 s long
      plans three moments — 0 s, 1 s, 2 s — and the first two have pictures
      behind them while the third does not. A walk that lost the 1 s frame as
      well would land at one entry here and the warning would still read as a
      well-formed sentence, which is why this number is pinned rather than
      bounded.
    */
    expect(entries.length, "the clip has a picture at 0 s and at 1 s, and both must arrive").toBe(2);

    const moments = entries.map(momentOf);
    expect(moments[0], "the first moment planned is the start of the clip").toBeLessThan(0.1);
    expect(moments[1], "the second is one second in, and the clip has a picture there").toBeGreaterThanOrEqual(1);
    expect(moments[1], "and it is that picture, not a later one").toBeLessThan(1.1);

    /*
      THE ASSERTION THAT BLOCKS THE 'FIX'. This file's video track ends at
      2.000000 s. Seeking to the third planned moment after `ended` hands back
      the picture from 1.958333 s — filing it as `00m02.000s` would put a
      timestamp in a filename that the clip has no picture at.
    */
    for (const [i, at] of moments.entries()) {
      expect(
        at,
        `${entries[i]} claims a moment at or past 2.000 s, where this clip's video track has already ended`,
      ).toBeLessThan(PICTURE_ENDS_AT_SECONDS);
    }

    /*
      And they are two different pictures. Both are PNG written by the same
      canvas at the same size, so identical bytes means identical pixels —
      which is what re-saving the last presented frame under a second name
      would produce.
    */
    const [first, second] = await Promise.all(entries.map((name) => zipEntry(bytes, name)));
    expect(
      first.equals(second),
      "two entries holding the same bytes are the same frame saved twice",
    ).toBe(false);

    /*
      The honesty mechanism itself: the page must still report BOTH numbers,
      and they must close — saved + missing = planned. Only the arithmetic is
      asserted, not the sentence's opening clause: the walk did in fact reach
      the end of its plan here, and what ran out was the video track, not the
      walk.
    */
    await expect(
      surface,
      "a run that saved fewer frames than it planned must say so, with both numbers",
    ).toContainText(
      `the last ${3 - entries.length} of the 3 planned frames are missing from this ZIP`,
    );
    await expect(surface, "and the count it shows is the count in the ZIP").toContainText(
      `${entries.length} FRAMES`,
    );
  });
});
