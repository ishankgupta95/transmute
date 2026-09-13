import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeImageInPage,
  forbidCdnCore,
  toolError,
} from "./support";
import { assertZip, assertPng, assertJpeg } from "./validators";

/**
 * Pulling stills out of a clip: the whole-video frame export, and the single
 * poster frame.
 *
 * Neither tool downloads a conversion engine — the decode is the one a
 * `<video>` element does anyway, and the encode is the canvas's. So the risk
 * here is not "did the engine load"; it is the quiet arithmetic: how many
 * pictures came back, whether each is a real decodable image rather than an
 * empty file with the right name, and whether the moment on the label is the
 * moment the picture came from.
 *
 * `assertZip` already rejects empty entries, so the assertions below add the
 * two things it cannot know: the COUNT the settings asked for, and that each
 * entry decodes to the source's own frame size.
 *
 * TITLE TRAP — `playwright.config.ts:63` sets `grepInvert: /gif|FFmpeg|MP4/i`
 * on `conversion-webkit`, matched against the project name, the FILE PATH,
 * every describe title and every test title. None of those tokens may appear
 * in this file's name or in any title below, or WebKit silently drops the case
 * with no warning. Slugs inside a test body are fine.
 */

/** `sample-video.mp4` — 320x240, ~2.09 s at 24 fps. */
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 240;

/** `frame-007-00m03.500s.png` — index first so a long run unzips in order. */
const FRAME_NAME = /^frame-(\d{3,})-(\d{2})m(\d{2}\.\d{3})s\.(png|jpg|webp)$/;

/** Read one entry out of a downloaded archive. */
async function zipEntry(archive: Buffer, name: string): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(archive);
  const entry = zip.files[name];
  expect(entry, `the archive has no entry called ${name}`).toBeTruthy();
  return Buffer.from(await entry.async("uint8array"));
}

/** Pick an option out of one of `ToolChoice`'s labelled chip groups. */
function chip(page: Page, group: string, label: string) {
  return page.getByRole("group", { name: group }).getByRole("button", { name: label, exact: true });
}

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

test.describe("stills out of a clip", () => {
  test.beforeEach(({ page }) => {
    forbidCdnCore(page);
  });

  test("video-to-images saves a real picture per moment, and discloses any it missed", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/video-to-images");
    await uploadFixture(page, await SAMPLES.mp4());

    const surface = page.locator("[data-tool-surface]");

    /*
      "Fixed count" samples the MIDDLE of each equal slice, so eight frames out
      of this clip land at 0.13 s through 1.91 s — every one of them inside the
      media, which is what makes an exact-count assertion honest here. (The
      every-N-seconds default plans a moment at 2 s, right at the end of a
      2.09 s clip, and the element does not always present it. That case is
      covered below, as the DISCLOSURE it produces.)
    */
    await chip(page, "Sampling", "Fixed count").click();
    await chip(page, "Frame count", "8").click();

    const eightUp = await runAndDownload(page, /^Extract frames$/, "video-to-images");
    expect(eightUp.name).toBe("sample-video-frames.zip");

    const eight = await assertZip(eightUp.bytes, { minEntries: 8 });
    expect(eight.length, "eight frames were asked for, so eight must arrive").toBe(8);
    await expect(
      surface,
      "a plan that fits inside the clip must not report anything missing",
    ).not.toContainText("missing from this ZIP");

    // Every name carries its position and the moment it came from, zero-padded
    // so a 300-file archive still unzips in order.
    for (const [i, entry] of [...eight].sort().entries()) {
      const match = FRAME_NAME.exec(entry);
      expect(match, `${entry} is not a frame filename`).not.toBeNull();
      expect(match![1], "the index is 1-based and in file order").toBe(
        String(i + 1).padStart(3, "0"),
      );
      expect(match![4], "PNG is the page's default format").toBe("png");
      const at = Number(match![2]) * 60 + Number(match![3]);
      expect(at, `${entry} claims a moment outside the clip`).toBeLessThan(2.1);
    }

    // And the pictures are pictures — the source's own frame size, decoded.
    const firstFrame = await zipEntry(eightUp.bytes, [...eight].sort()[0]);
    expect(assertPng(firstFrame)).toEqual({ width: FRAME_WIDTH, height: FRAME_HEIGHT });
    const decoded = await probeImageInPage(page, firstFrame, "image/png");
    expect(decoded).toEqual({ width: FRAME_WIDTH, height: FRAME_HEIGHT });

    /*
      The other format, and the other sampling mode — the one whose last
      planned moment sits at the very end of the clip. Two frames come back
      where three were planned, and the page has to SAY that, with both
      numbers. This is the tool's central promise ("it never quietly hands back
      a shorter set") and the only place in this suite it is exercised.
    */
    await chip(page, "Sampling", "Every N sec").click();
    await chip(page, "Image format", "JPEG").click();

    const perSecond = await runAndDownload(page, /^Extract frames$/, "video-to-images");
    const shortfall = await assertZip(perSecond.bytes, { minEntries: 1 });
    for (const entry of shortfall) {
      expect(FRAME_NAME.exec(entry)?.[4], "JPEG was chosen").toBe("jpg");
    }
    assertJpeg(await zipEntry(perSecond.bytes, [...shortfall].sort()[0]));

    /*
      ⚠ THIS USED TO ASSERT `toBeLessThan(3)` — that the third planned moment
      is NEVER captured — AND THAT IS THE FLAKE plan.md carried as "a real
      flake in the conversion gate, characterised, not fixed". It was neither
      memory pressure nor CPU contention nor a dropped frame. The old assertion
      REQUIRED THE PRODUCT TO FAIL: one a second over a clip the element calls
      2.089796 s long plans 0 s, 1 s and 2 s, and this file's video track ends
      at exactly 2.000000 s (the 2.09 is the AUDIO track), so Chromium normally
      presents nothing at the third moment. Normally. Captured 2026-09-13 in
      conversion-webkit: `Expected: < 3, Received: 3` — all three arrived, and
      the test failed because the tool did BETTER than it demanded. The comment
      two lines above the old assertion admitted the premise itself
      ("the element does not always present it") and then asserted it never
      does. A test cannot pin a browser's presentation timing as an invariant.

      What IS invariant, and what this page actually promises, is that THE
      ACCOUNTING CLOSES: saved + missing = planned, and the page's claim
      matches the ZIP either way. That is asserted below in both directions —
      which also makes this STRONGER than what it replaces, because a false
      "frames are missing" claim on a complete run could not have failed the
      old assertion and does fail this one.

      The shortfall sentence itself keeps deterministic coverage elsewhere:
      `video-frames.test.ts` drives it from a stubbed walk, and
      `frame-walk-end.spec.ts` exercises it end to end.
      ⚠ That sibling pins `entries.length` to exactly 2 and carries the SAME
      assumption this one just lost — if it ever fails on a third frame, this
      comment is the diagnosis; do not go looking for memory pressure.
    */
    expect(
      shortfall.length,
      "a run cannot save more frames than its own plan of three",
    ).toBeLessThanOrEqual(3);
    expect(
      shortfall.length,
      "the clip has pictures at 0 s and 1 s, so at least two must always arrive",
    ).toBeGreaterThanOrEqual(2);

    const missing = 3 - shortfall.length;
    if (missing > 0) {
      await expect(
        surface,
        "a run that saved fewer frames than it planned must say so, with the numbers",
      ).toContainText(`the last ${missing} of the 3 planned frames are missing from this ZIP`);
    } else {
      await expect(
        surface,
        "a run that saved every planned frame must not claim any are missing",
      ).not.toContainText("missing from this ZIP");
    }

    /*
      THE CAP, WHICH THIS FIXTURE IS FAR TOO SHORT TO REACH. It is stated
      standing copy for exactly that reason: nobody finds out about a ceiling
      by hitting it. This asserts the page says the number and says what
      happens when it bites — the sentence the post-run notice is built from
      lives in the engine (`frameCapNotice`), so the two cannot drift.
    */
    await expect(surface).toContainText("300-FRAME CEILING");
    await expect(surface).toContainText("One run saves at most 300 frames");
    await expect(surface).toContainText("It never quietly hands back a shorter set");
  });

  test("video-thumbnail takes one still at the chosen moment", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/video-thumbnail");
    await uploadFixture(page, await SAMPLES.mp4());

    const surface = page.locator("[data-tool-surface]");
    // The slider's range comes from the loaded metadata, so wait for a length.
    const moment = page.getByRole("slider", { name: "Time" });
    await expect(moment).toBeEnabled({ timeout: 60_000 });
    await moment.fill("1");

    const { name, bytes } = await runAndDownload(page, /^Capture frame$/, "video-thumbnail");

    // One file, named with the moment it really came from.
    const stamp = /^sample-video-frame-(\d{2})m(\d{2}\.\d{3})s\.jpg$/.exec(name);
    expect(stamp, `${name} is not a thumbnail filename`).not.toBeNull();
    const takenAt = Number(stamp![1]) * 60 + Number(stamp![2]);
    expect(
      takenAt,
      "the still must come from the moment asked for, or the first frame after it",
    ).toBeGreaterThanOrEqual(1);
    expect(takenAt, "and not from somewhere else in the clip").toBeLessThan(1.2);

    assertJpeg(bytes);
    const decoded = await probeImageInPage(page, bytes, "image/jpeg");
    expect(decoded, "'Source' width means the video's own frame size").toEqual({
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
    });
    expect(bytes.length, "a still has to be a real picture, not a stub").toBeGreaterThan(1024);

    // The page reports what it captured, not only what was asked for.
    await expect(surface).toContainText("Captured at");
    await expect(surface).toContainText("0:01.0");
    await expect(surface).toContainText(`${FRAME_WIDTH} × ${FRAME_HEIGHT}`);
  });
});
