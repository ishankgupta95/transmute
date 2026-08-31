import { test, expect } from "@playwright/test";
import { tools } from "../../../data/tools";

/**
 * The /all-tools index exists to be crawled: one plain link per registered
 * tool. The whole contract is registry-driven, so the assertions derive every
 * expected count and slug from the same `tools` import the page renders from
 * — nothing here is hand-curated, and a new tool is covered the moment it
 * lands in the registry.
 */

test.describe("all-tools index", () => {
  test("renders exactly one link per registered tool, with no page errors", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/all-tools");

    // One H1, and it names the page.
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(/All tools/i);

    // Every registry slug is linked from the page body — exactly once. The
    // hub links ("HUB →") and the layout chrome point at category/static
    // routes, so filtering the collected hrefs against the registry's slug
    // set counts tool links and nothing else.
    const slugHrefs = new Set(tools.map((t) => `/${t.slug}`));
    const hrefs = (await page
      .locator("main a[href]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("href")))) as (
      | string
      | null
    )[];
    const toolLinks = hrefs.filter((h): h is string => h !== null && slugHrefs.has(h));

    expect(
      toolLinks.length,
      "the index must link every registered tool exactly once",
    ).toBe(tools.length);
    expect(
      new Set(toolLinks).size,
      "no tool may be linked twice, and none may be missing",
    ).toBe(tools.length);

    expect(pageErrors, `page errors on /all-tools:\n${pageErrors.join("\n")}`).toEqual(
      [],
    );
  });

  test("the site footer links to /all-tools", async ({ page }) => {
    // Any page carries the shared footer; /about is cheap and stable.
    await page.goto("/about");
    await expect(page.locator('footer a[href="/all-tools"]')).toBeVisible();
  });
});
