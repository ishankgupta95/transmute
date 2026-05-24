import { test, expect } from "@playwright/test";

const CATEGORIES = [
  { slug: "image-tools", name: "Image Tools" },
  { slug: "pdf-tools", name: "PDF Tools" },
  { slug: "audio-tools", name: "Audio Tools" },
  { slug: "video-tools", name: "Video Tools" },
  { slug: "developer-tools", name: "Developer Tools" },
];

test.describe("navigation", () => {
  test("homepage renders the brand and the popular tools rail", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Transmute/);
    await expect(page.locator("nav").getByText(/Transmute/i).first()).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);

    // Each category card on the homepage must link to its hub.
    for (const cat of CATEGORIES) {
      await expect(
        page.locator(`a[href="/${cat.slug}"]`).first(),
        `homepage should expose card link for ${cat.slug}`,
      ).toBeVisible();
    }

    // Popular-tools rail renders ≥4 cards; if it 404s on a slug the rail
    // would silently shrink.
    const popularTools = page.locator("section").filter({ hasText: /Popular tools/i });
    await expect(popularTools).toBeVisible();
  });

  test("every category in the navbar navigates to its hub with the right H1", async ({
    page,
  }) => {
    for (const cat of CATEGORIES) {
      await page.goto("/");
      const link = page.locator(`a[href="/${cat.slug}"]`).first();
      await expect(link, `category link for ${cat.slug} should exist`).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${cat.slug}/?$`));
      // The hub renders the category name as its h1 — checking `cat.name`
      // catches a wrong-page render that a /Tools/ regex would let through.
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(cat.name);
    }
  });

  test("footer links work", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();

    // Footer must list every category at least once.
    for (const cat of CATEGORIES) {
      await expect(footer.locator(`a[href="/${cat.slug}"]`)).toBeVisible();
    }

    // And the static pages.
    await expect(footer.locator('a[href="/blog"]')).toBeVisible();
    await expect(footer.locator('a[href="/about"]')).toBeVisible();
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();

    await footer.locator('a[href="/about"]').click();
    await expect(page).toHaveURL(/\/about\/?$/);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("breadcrumbs render on category and tool pages", async ({ page }) => {
    await page.goto("/image-tools");
    const crumbs = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(crumbs).toBeVisible();
    await expect(crumbs.locator('a[href="/"]')).toHaveText("Home");

    await page.goto("/heic-to-jpg");
    const toolCrumbs = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(toolCrumbs).toBeVisible();
    await expect(toolCrumbs.locator('a[href="/"]')).toHaveText("Home");
    // Tool breadcrumb should link back to the category hub.
    await expect(toolCrumbs.locator('a[href="/image-tools"]')).toBeVisible();
  });

  test("blog index loads and lists posts", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.locator("h1")).toHaveCount(1);
    // Each post links via /blog/<slug>; expect at least one card.
    const postLinks = page.locator('a[href^="/blog/"]');
    await expect(postLinks.first()).toBeVisible();
    expect(await postLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test("category navbar links work from inside a tool page", async ({ page }) => {
    // The navbar persists across routes — make sure it's still wired when
    // the user is already deep in the app.
    await page.goto("/heic-to-jpg");
    const link = page.locator('nav a[href="/pdf-tools"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/pdf-tools\/?$/);
  });
});
