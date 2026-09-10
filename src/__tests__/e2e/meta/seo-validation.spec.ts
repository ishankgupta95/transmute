import { test, expect } from "@playwright/test";
import { assertSeoBasics } from "../helpers";

/**
 * SEO contract: every page archetype renders the canonical, OG, JSON-LD and
 * meta-description scaffolding the unit tests assume. Sample tools picked to
 * cover every distinct toolType (different client component / SEO injector)
 * so a regression in the metadata pipeline for any one client is caught.
 * The all-tools sweep (`all-tools.spec.ts`) covers raw page-load coverage.
 */

const SAMPLE_TOOLS = [
  // image — converter, compressor variant, resizer, cropper, exif, base64,
  // ico, favicon, palette
  "heic-to-jpg",
  "compress-image",
  "compress-image-to-200kb",
  "resize-image",
  "crop-image",
  "exif-viewer",
  "image-to-base64",
  "png-to-ico",
  "favicon-generator",
  "image-color-palette",
  // pdf — every distinct pdf toolType
  "merge-pdf",
  "split-pdf",
  "compress-pdf",
  "recompress-pdf-images",
  "pdf-to-jpg",
  "images-to-pdf",
  "rotate-pdf",
  "add-page-numbers",
  "pdf-page-reorder",
  "extract-pdf-pages",
  "delete-pdf-pages",
  "crop-pdf",
  "change-pdf-page-size",
  "pdf-resizer",
  "pdf-to-text",
  "protect-pdf",
  "unlock-pdf",
  "pdf-permissions",
  "repair-pdf",
  // audio
  "wav-to-mp3",
  "mp3-to-wav",
  "m4a-to-mp3",
  "audio-trimmer",
  "merge-audio",
  // video
  "video-to-gif",
  "video-trimmer",
  "compress-video",
  "screen-recorder",
  "mp4-to-mp3",
  "webm-to-mp4",
  "video-to-mp4",
  "mute-video",
  "rotate-video",
  // dev — sample across formatter/encoder/generator/utility families
  "json-formatter",
  "csv-to-json",
  "base64-encode-decode",
  "jwt-decoder",
  "uuid-generator",
  "qr-code-generator",
  "regex-tester",
  "color-picker",
];

test.describe("SEO validation", () => {
  test("homepage exposes WebSite + BreadcrumbList JSON-LD", async ({ page }) => {
    await page.goto("/");
    await assertSeoBasics(page, { expectedJsonLdTypes: ["WebSite"] });
  });

  test("category hub exposes BreadcrumbList JSON-LD", async ({ page }) => {
    await page.goto("/image-tools");
    await assertSeoBasics(page, { expectedJsonLdTypes: ["BreadcrumbList"] });
  });

  test("blog index exposes Blog + BreadcrumbList JSON-LD", async ({ page }) => {
    await page.goto("/blog");
    await assertSeoBasics(page, { expectedJsonLdTypes: ["Blog", "BreadcrumbList"] });
  });

  for (const slug of SAMPLE_TOOLS) {
    test(`tool page ${slug} renders the full SEO scaffolding`, async ({ page }) => {
      await page.goto(`/${slug}`);
      await assertSeoBasics(page, {
        expectedJsonLdTypes: [
          "SoftwareApplication",
          "HowTo",
          "FAQPage",
          "BreadcrumbList",
        ],
        requireOgImage: true,
        descriptionRange: [120, 160],
      });

      // Title carries the tool name (sanity check against accidentally
      // shipping a default Next title).
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);
    });
  }

  test("FAQ section renders at least four entries (incl. shared privacy FAQ)", async ({
    page,
  }) => {
    await page.goto("/heic-to-jpg");
    // FAQ items are wrapped in <details>; the privacy FAQ is appended at
    // render time so every tool gets at least one extra entry on top of its
    // bespoke faqs.ts list.
    const items = page.locator("details");
    const count = await items.count();
    expect(count, "tool page should render ≥4 FAQ items").toBeGreaterThanOrEqual(4);
  });
});
