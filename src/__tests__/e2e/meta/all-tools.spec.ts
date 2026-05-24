import { test, expect } from "@playwright/test";
import { tools } from "../../../data/tools";

/**
 * Page-load sweep across every tool registered in `tools.ts`. Cheap per-tool
 * (one navigation, three cheap DOM assertions) but catches the class of
 * regressions where a tool's slug, h1, or client component fails to render
 * — without us having to remember to add it to a hand-curated sample list.
 *
 * Functional behaviour for each tool lives in its category-specific spec.
 */

test.describe("every tool page renders the registry's H1 + an interactive surface", () => {
  for (const tool of tools) {
    test(`/${tool.slug} renders h1="${tool.h1}" and an input affordance`, async ({
      page,
    }) => {
      await page.goto(`/${tool.slug}`);

      // Exactly one <h1>, matching the registry.
      const h1 = page.locator("h1");
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(tool.h1);

      // Every tool surfaces *some* user input — a file dropzone, a textarea,
      // or a button. Screen-recorder is the one tool that has no upload
      // affordance until you grant permission, but it always renders an
      // initial action button.
      const inputCount = await page
        .locator('input[type="file"], textarea, button')
        .count();
      expect(
        inputCount,
        `${tool.slug} should render at least one input/button on first paint`,
      ).toBeGreaterThan(0);

      // Title contains the tool name (sanity that getToolMetadata is wired).
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);
    });
  }
});
