import { test, expect } from "@playwright/test";
import { assertSeoBasics } from "../helpers";

/**
 * Static pages (about, privacy) are entirely server-rendered and stable —
 * worth catching regressions in their copy, link structure, and SEO scaffolding.
 */

test.describe("static pages", () => {
  test("about page renders the brand sections and a working ishank.dev link", async ({
    page,
  }) => {
    await page.goto("/about");
    // Static pages don't ship JSON-LD — opt out of that single assertion.
    await assertSeoBasics(page, { requireJsonLd: false });
    await expect(page.locator("h1")).toHaveText("About Transmute");

    // The page advertises four sub-sections (Why, What, How, Built By).
    const h2s = page.locator("h2");
    expect(await h2s.count()).toBeGreaterThanOrEqual(4);

    // External attribution link must point to ishank.dev with the safe-rel.
    const externalLink = page.locator('a[href="https://ishank.dev"]').first();
    await expect(externalLink).toBeVisible();
    await expect(externalLink).toHaveAttribute("rel", /noopener/);
    await expect(externalLink).toHaveAttribute("target", "_blank");
  });

  test("privacy page renders the canonical sections and last-updated date", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await assertSeoBasics(page, { requireJsonLd: false });
    await expect(page.locator("h1")).toHaveText("Privacy Policy");

    // Each section heading is required — losing one would change the legal
    // surface area and shouldn't happen silently.
    // The "Children's Privacy" heading uses a typographic apostrophe (U+2019)
    // because the source uses &rsquo;. Match by regex so we don't have to
    // copy the curly char into the test.
    for (const heading of [
      /^Overview$/,
      /^Files You Process$/,
      /^Cookies & Local Storage$/,
      /^Analytics$/,
      /^Third-Party Advertising$/,
      /^External Resources$/,
      /^Children.s Privacy$/,
      /^Changes to This Policy$/,
      /^Contact$/,
    ]) {
      await expect(
        page.getByRole("heading", { level: 2, name: heading }),
        `privacy page must render section matching ${heading}`,
      ).toBeVisible();
    }

    // Last-updated label is part of the legal contract.
    await expect(page.getByText(/Last updated:/)).toBeVisible();
  });

  test("404 page renders content (not just a status code)", async ({ page }) => {
    const response = await page.goto("/this-tool-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(404);
    // Next's not-found renders an h1 with "404" — wait for it explicitly so
    // we don't race the dev-mode hydration (innerText returns "" before
    // hydration finishes).
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("heading", { level: 2, name: /This page could not be found/i }),
    ).toBeVisible();
  });
});
