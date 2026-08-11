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
    await expect(page.locator("h1")).toHaveText(/^Privacy policy$/i);

    // Each section heading is required — losing one would change the legal
    // surface area and shouldn't happen silently.
    // The "Children's Privacy" heading uses a typographic apostrophe (U+2019)
    // because the source uses &rsquo;. Match by regex so we don't have to
    // copy the curly char into the test.
    // Sentence case since the redesign, and the standalone "Overview" and
    // "Contact" sections were folded into the intro and footer respectively
    // (both still render — asserted below). Matched case-insensitively;
    // `Children's` uses a typographic apostrophe, hence the `.`.
    for (const heading of [
      /^Files you process$/i,
      /^Cookies and local storage$/i,
      /^Analytics$/i,
      // Was "Third-party advertising" while the dead AdSense wiring was still
      // in the layout; the section now states plainly that there is none.
      /^Advertising$/i,
      /^External resources$/i,
      /^Children.s privacy$/i,
      /^Changes to this policy$/i,
    ]) {
      await expect(
        page.getByRole("heading", { level: 2, name: heading }),
        `privacy page must render section matching ${heading}`,
      ).toBeVisible();
    }

    // The last-updated stamp and a contact route are part of the legal
    // contract, so assert them regardless of how the copy is phrased.
    await expect(page.getByText(/UPDATED\s+\d{1,2}\s+\w+\s+\d{4}/i).first()).toBeVisible();
    const contact = page.getByText(/Reach the maintainer/i);
    await expect(contact).toBeVisible();
    await expect(contact.locator("a")).toHaveAttribute("href", /^(https?:|mailto:)/);
  });

  test("404 page renders content (not just a status code)", async ({ page }) => {
    const response = await page.goto("/this-tool-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(404);
    // The redesigned 404 (src/app/not-found.tsx) replaces Next's default
    // "404 / This page could not be found" with a branded page: a mono
    // status label plus a copy-led H1. Wait explicitly so we don't race
    // dev-mode hydration (innerText returns "" before hydration finishes).
    await expect(page.getByText(/HTTP 404 · NO SUCH ROUTE/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("h1")).toHaveText(/Nothing converts to this/i);
    // It must offer a route back rather than dead-ending.
    await expect(page.locator('a[href="/"]').first()).toBeVisible();
  });
});
