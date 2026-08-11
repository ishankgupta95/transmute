import { test, expect } from "@playwright/test";
import { assertSeoBasics } from "../helpers";

/**
 * Blog detail pages are MDX-rendered with extra SEO scaffolding (Article
 * JSON-LD, breadcrumb chain to /blog, primary/related tool rail). They're
 * worth their own spec because the MDX import path differs from every other
 * route.
 */

test.describe("blog detail", () => {
  test("heic-vs-jpg renders the article body, breadcrumb chain, and Article JSON-LD", async ({
    page,
  }) => {
    await page.goto("/blog/heic-vs-jpg");
    await assertSeoBasics(page, {
      expectedJsonLdTypes: ["Article", "BreadcrumbList"],
      requireOgImage: true,
    });

    // Title is the post title; not a generic Next default.
    const title = await page.title();
    expect(title).toContain("HEIC");

    // Breadcrumb chain: Home → Blog → <post title>. Both intermediate links
    // must be navigable.
    const crumbs = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(crumbs.locator('a[href="/"]')).toHaveText(/^Home$/i);
    await expect(crumbs.locator('a[href="/blog"]')).toHaveText(/^Blog$/i);

    // Article body is rendered into the .prose container by the MDX import.
    await expect(page.locator("article.prose")).toBeVisible();
    const articleText = await page.locator("article.prose").innerText();
    expect(articleText.length).toBeGreaterThan(200);

    // Primary-tool rail links to /heic-to-jpg.
    await expect(
      page.getByRole("link", { name: /Open HEIC to JPG/i }),
    ).toBeVisible();

    // Related tools section lists at least one card.
    const relatedHeader = page.getByText(/ALSO MENTIONED/i).first();
    await expect(relatedHeader).toBeVisible();
  });

  test("blog post breadcrumb 'Blog' link navigates to the index", async ({ page }) => {
    await page.goto("/blog/heic-vs-jpg");
    await page
      .locator('nav[aria-label="Breadcrumb"] a[href="/blog"]')
      .click();
    await expect(page).toHaveURL(/\/blog\/?$/);
    // The blog index H1 is the section title, not the literal word "Blog".
    await expect(page.locator("h1")).toHaveText(/Notes on file formats/i);
  });

  test("blog index links lead to working post pages", async ({ page }) => {
    await page.goto("/blog");
    const firstPost = page.locator('a[href^="/blog/"]').first();
    const href = await firstPost.getAttribute("href");
    expect(href).toMatch(/^\/blog\/[a-z0-9-]+$/);
    await firstPost.click();
    // Wait for the URL to change before asserting H1 — Next App Router does
    // a soft navigation that updates the URL only after the next paint.
    await page.waitForURL(new RegExp(`${href}/?$`));
    await expect(page.locator("h1")).toHaveCount(1);
    const newH1 = await page.locator("h1").innerText();
    expect(newH1, "post page must not still render the index's 'Blog' h1").not.toBe(
      "Blog",
    );
    expect(newH1.length).toBeGreaterThan(5);
  });
});
