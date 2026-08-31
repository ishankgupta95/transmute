import { expect, test } from "@playwright/test";

/**
 * GFM tables must actually become tables.
 *
 * Without `remark-gfm` in next.config.ts, MDX left pipe-syntax tables as raw
 * text in a <p> — three posts shipped `| --- |` to readers, while the article
 * body carried a full set of `prose-table:*` styles that never applied. This
 * pins the parse, not the styling.
 */
const POSTS_WITH_TABLES = [
  "heic-vs-jpg",
  "modern-image-formats-webp-avif-jpeg-xl",
  "video-to-gif-tradeoffs",
];

for (const slug of POSTS_WITH_TABLES) {
  test(`blog/${slug} renders its comparison table as a real <table>`, async ({ page }) => {
    await page.goto(`/blog/${slug}`);
    const body = page.locator("#post-body");
    await expect(body.locator("table")).not.toHaveCount(0);
    await expect(body.locator("thead th").first()).toBeVisible();
    // The failure mode this guards: pipe rows surviving into paragraph text.
    await expect(
      body.locator("p", { hasText: /^\s*\|/ }),
      "pipe-syntax table leaked into a paragraph",
    ).toHaveCount(0);
  });
}
