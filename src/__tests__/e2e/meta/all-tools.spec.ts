import { test, expect } from "@playwright/test";
import { tools } from "../../../data/tools";

/**
 * Page-load sweep across every tool registered in `tools.ts`. Cheap per tool
 * (one navigation, three assertions) but it catches the class of regression
 * where a slug, an H1, or a whole client component stops rendering — without
 * anyone having to remember to add the tool to a hand-curated list.
 *
 * Every assertion here is written to be *failable*. The previous version
 * counted `input, textarea, button` across the entire page and asserted the
 * count was > 0 — but the navbar alone ships buttons, so that passed for a
 * tool whose UI had thrown and rendered nothing at all. It also asserted
 * `title.length > 10`, which no real page could ever fail. Both are replaced
 * with assertions tied to values only a correctly-rendered page produces.
 *
 * Functional behaviour for each tool lives in its category-specific spec.
 */

test.describe("every tool page renders the registry's H1 + its own interactive surface", () => {
  for (const tool of tools) {
    test(`/${tool.slug} renders h1="${tool.h1}" and mounts its tool UI`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => consoleErrors.push(err.message));

      await page.goto(`/${tool.slug}`);

      // Exactly one <h1>, matching the registry.
      const h1 = page.locator("h1");
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(tool.h1);

      // The tool's own surface must carry a real control. Scoped to
      // [data-tool-surface] so the navbar's buttons, the FAQ accordion and the
      // related-tools links cannot satisfy it — if the client component fails
      // to mount, this region is empty and the test goes red.
      const controls = page.locator(
        '[data-tool-surface] input:not([type="hidden"]), [data-tool-surface] textarea, [data-tool-surface] button, [data-tool-surface] select',
      );
      await expect(
        controls.first(),
        `${tool.slug} rendered no control inside its own tool surface`,
      ).toBeAttached();

      // The exact title the metadata layer is supposed to build, not merely a
      // non-empty one: `tool.titleTag ?? tool.h1` plus the site suffix.
      await expect(page).toHaveTitle(`${tool.titleTag ?? tool.h1} | Transmute`);

      // A tool UI that throws during render can still leave the H1 behind.
      expect(
        consoleErrors,
        `${tool.slug} threw during render: ${consoleErrors.join(" | ")}`,
      ).toEqual([]);
    });
  }
});
