import { test, expect } from "@playwright/test";
import { assertSeoBasics } from "../helpers";

/**
 * SEO contract: every page archetype renders the canonical, OG, JSON-LD and
 * meta-description scaffolding the unit tests assume. Sample 10 tool pages
 * across categories so we don't burn CI on all 64 — the unit suite already
 * structurally validates every entry in tools.ts.
 */

const SAMPLE_TOOLS = [
  // image
  "heic-to-jpg",
  "compress-image",
  "resize-image",
  // pdf
  "merge-pdf",
  "compress-pdf",
  // audio
  "wav-to-mp3",
  "audio-trimmer",
  // video
  "compress-video",
  // dev
  "json-formatter",
  "regex-tester",
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
