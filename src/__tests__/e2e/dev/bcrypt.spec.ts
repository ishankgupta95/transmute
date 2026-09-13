import { test, expect, type Page } from "@playwright/test";

/**
 * `/bcrypt-generator` — the wiring the unit suite cannot see.
 *
 * `unit/lib/bcrypt.test.ts` owns the algorithm (salting, clamping, the
 * three-way verify). What is only checkable here is that the page reaches it:
 * that typing a password and pressing the button produces a real hash, and
 * that the checker in the rail agrees with it.
 *
 * In the DEFAULT project on purpose — this is the only gate CI runs, and a
 * tool whose button does nothing would otherwise ship green.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

test("bcrypt-generator hashes a password and verifies its own output", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/bcrypt-generator");
  const surface = surfaceOf(page);

  const password = surface.getByPlaceholder("correct horse battery staple");
  await password.waitFor({ state: "visible", timeout: 60_000 });
  await password.fill("hunter2");

  await surface.getByRole("button", { name: /GENERATE HASH/i }).click();

  const hash = surface.getByRole("region", { name: "Hash" });
  // A real bcrypt hash: version, two-digit cost, 53 chars of salt+digest.
  await expect(hash).toHaveText(/^\$2[abxy]\$\d{2}\$.{53}$/, { timeout: 90_000 });
  const produced = ((await hash.textContent()) ?? "").trim();

  /*
    THE PAIRED CHECK. Asserting the shape alone would pass over a hash of the
    wrong password — the format says nothing about the input. Feeding it back
    through the page's own checker is what ties the output to "hunter2".
  */
  await surface.getByLabel("Existing hash to check against").fill(produced);
  await surface.getByRole("button", { name: /Check against the password above/i }).click();
  await expect(surface.getByRole("status")).toHaveText(/MATCH — this password produced that hash/);
});

test("the checker tells a wrong password apart from a malformed hash", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/bcrypt-generator");
  const surface = surfaceOf(page);

  await surface.getByPlaceholder("correct horse battery staple").fill("something");
  await surface.getByLabel("Existing hash to check against").fill("definitely not a hash");
  await surface.getByRole("button", { name: /Check against the password above/i }).click();
  await expect(surface.getByRole("status")).toHaveText(/NOT A BCRYPT HASH/);
});
