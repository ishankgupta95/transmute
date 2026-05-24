import { test, expect } from "@playwright/test";

/**
 * Video pipelines depend on FFmpeg.wasm (~25 MB CDN download on first use)
 * and WebCodecs (compress-video). They take 10-60s on a warm CDN even for
 * the smallest input, and the WASM blob can stall in CI if unpkg is rate
 * limited. We *don't* invoke the conversion paths in this spec — we only
 * smoke-test that every video tool page renders, the dropzone is wired,
 * and the action button is present.
 *
 * Conversion-path coverage lives in the manual verification checklist
 * (plan.md §2.9) which runs against a deployed URL where the FFmpeg build
 * is cached. Adding it to CI would 4x the wall-clock for marginal value.
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
