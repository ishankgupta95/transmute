import { test, expect } from "@playwright/test";

/**
 * Category hubs are the entry-points users land on after clicking a footer
 * or navbar link. The unit suite proves every tool entry resolves; this spec
 * validates that the hub page actually links out to its tools and renders
 * the expected layout.
 */

const CATEGORIES = [
  {
    slug: "image-tools",
    title: "Image Tools",
    // Tools we expect the hub to link to. Picked to span both
    // converters and utilities so a section regression is caught.
    expectedToolLinks: ["heic-to-jpg", "compress-image", "resize-image", "exif-viewer"],
  },
  {
    slug: "pdf-tools",
    title: "PDF Tools",
    expectedToolLinks: ["merge-pdf", "split-pdf", "compress-pdf", "pdf-to-jpg"],
  },
  {
    slug: "audio-tools",
    title: "Audio Tools",
    expectedToolLinks: ["wav-to-mp3", "mp3-to-wav", "audio-trimmer", "merge-audio"],
  },
  {
    slug: "video-tools",
    title: "Video Tools",
    expectedToolLinks: [
      "video-to-gif",
      "video-trimmer",
      "compress-video",
      "screen-recorder",
    ],
  },
  {
    slug: "developer-tools",
    title: "Developer Tools",
    expectedToolLinks: [
      "json-formatter",
      "regex-tester",
      "uuid-generator",
      "qr-code-generator",
    ],
  },
];

test.describe("category hubs", () => {
  for (const cat of CATEGORIES) {
    test(`${cat.slug} hub renders the expected title and links to its tools`, async ({
      page,
    }) => {
      await page.goto(`/${cat.slug}`);

      // The CategoryHubPage renders an h1 with the category title.
      await expect(page.locator("h1")).toHaveCount(1);
      // Case-insensitive: the redesign moved these H1s to sentence case,
      // and casing is presentation, not contract.
      await expect(page.locator("h1")).toHaveText(
        new RegExp(`^${cat.title}$`, "i"),
      );

      // Every expected tool is reachable from the hub via a card link.
      for (const slug of cat.expectedToolLinks) {
        const link = page.locator(`a[href="/${slug}"]`).first();
        await expect(
          link,
          `${cat.slug} hub should link to /${slug}`,
        ).toBeVisible();
      }

      // Breadcrumb back to home is rendered.
      const crumbs = page.locator('nav[aria-label="Breadcrumb"]');
      await expect(crumbs.locator('a[href="/"]')).toHaveText(/^Home$/i);
    });
  }

  test("clicking a tool card on a hub navigates to the tool page", async ({ page }) => {
    await page.goto("/developer-tools");
    await page.locator('a[href="/json-formatter"]').first().click();
    await expect(page).toHaveURL(/\/json-formatter\/?$/);
    await expect(page.locator("h1")).toHaveCount(1);
  });
});
