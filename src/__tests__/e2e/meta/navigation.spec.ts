import { test, expect } from "@playwright/test";

const CATEGORIES = [
  { slug: "image-tools", name: "Image Tools" },
  { slug: "pdf-tools", name: "PDF Tools" },
  { slug: "audio-tools", name: "Audio Tools" },
  { slug: "video-tools", name: "Video Tools" },
  { slug: "developer-tools", name: "Developer Tools" },
];

test.describe("navigation", () => {
  test("homepage renders and shows the brand", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Transmute/);
    // Brand is rendered as "Trans" + accent-coloured "mute"; assert on the
    // composed text node so the test survives styling tweaks.
    await expect(page.locator("nav").getByText(/Transmute/i).first()).toBeVisible();
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("every category in the navbar is reachable", async ({ page }) => {
    await page.goto("/");

    for (const cat of CATEGORIES) {
      await page.goto("/");
      // The desktop navbar links may be hidden on small viewports; tap the
      // direct URL to exercise routing in either case.
      const link = page.locator(`a[href="/${cat.slug}"]`).first();
      await expect(link, `category link for ${cat.slug} should exist`).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${cat.slug}/?$`));
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/Tools/i);
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

  test("404 page renders for unknown slugs", async ({ page }) => {
    const response = await page.goto("/this-tool-does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    // Static export serves the 404 HTML with a 404 status when the file is
    // missing; in dev mode Next intercepts and returns 404 too.
    expect(response?.status()).toBe(404);
  });
});
