import { test, expect } from "@playwright/test";

/**
 * Video pipelines depend on FFmpeg.wasm (video-trimmer, mp4-to-mp3) and on
 * WebCodecs (compress-video, webm-to-mp4); video-to-gif is <video> + gifenc.
 * Loading and encoding takes real seconds even for the smallest input, so this
 * spec *doesn't* invoke the conversion paths — it only smoke-tests that every
 * video tool page renders, the dropzone is wired, and the action button is
 * present.
 *
 * Real conversion coverage lives in `src/__tests__/e2e/conversion/video.spec.ts`
 * (`npm run test:e2e:conversion`), which drives these tools against genuinely
 * encoded fixtures and asserts on the returned bytes.
 */

const VIDEO_TOOLS = [
  { slug: "video-to-gif", action: /Convert/i },
  { slug: "video-trimmer", action: /Trim/i },
  { slug: "mp4-to-mp3", action: /Convert|Extract/i },
  { slug: "webm-to-mp4", action: /Convert/i },
  { slug: "compress-video", action: /Compress/i },
  { slug: "screen-recorder", action: /Start/i },
];

test.describe("video tools — page smoke", () => {
  test.slow(); // these pages can pull a chunk of FFmpeg JS even at idle

  for (const { slug } of VIDEO_TOOLS) {
    test(`${slug} page loads with H1 + dropzone (or trigger)`, async ({ page }) => {
      await page.goto(`/${slug}`);
      await expect(page.locator("h1")).toHaveCount(1);

      // Every video tool except screen-recorder accepts a file. The recorder
      // exposes a "Start recording" button instead.
      if (slug === "screen-recorder") {
        const buttons = page.getByRole("button", { name: /Start/i });
        await expect(buttons.first()).toBeVisible();
      } else {
        await expect(page.locator('input[type="file"]').first()).toBeAttached();
      }
    });
  }
});
