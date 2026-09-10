import { test, expect } from "@playwright/test";

import { OWNED_CACHES, activeWorker, cacheInventory, waitForController } from "./support";

/**
 * The worker exists, at the right scope, in the right state.
 *
 * These four assertions are the ones no unit test can make. `sw-policy.ts` is
 * exhaustively covered in jsdom, but "does the script Turbopack emitted to
 * public/sw.js parse, install, activate and claim in a real browser" is a
 * question only a real browser answers — and a syntax error, a bad
 * `Content-Type`, or a scope narrower than `/` would each leave every rule in
 * that unit-tested module inert while the unit tests stayed green.
 */
test.describe("service worker registration", () => {
  test("registers /sw.js at scope / and reaches activated", async ({ page }) => {
    await page.goto("/");

    const worker = await activeWorker(page);

    expect(worker.state).toBe("activated");

    /*
      SCOPE `/`, and the whole reason the script sits at the origin root.

      A worker's default scope is the directory it is served from, and widening
      it needs a `Service-Worker-Allowed` response header — which GitHub Pages
      cannot send, because `headers()` is unsupported under
      `output: "export"`. So `public/sw.js` is emitted beside index.html rather
      than into `public/workers/` with the pool workers. If that ever moved,
      the worker would still register and still pass a "reaches activated"
      check while silently controlling nothing outside its own folder.
    */
    expect(new URL(worker.scope).pathname).toBe("/");
    expect(worker.scriptURL).not.toBeNull();
    expect(new URL(worker.scriptURL as string).pathname).toBe("/sw.js");
  });

  test("claims the page that registered it, so the first visit is controlled", async ({
    page,
  }) => {
    await page.goto("/");

    /*
      `clients.claim()` in `activate` is what this proves. Without it the very
      first visit runs uncontrolled: the worker is installed and activated, the
      page's requests never reach its `fetch` handler, and NOTHING is cached
      until a second navigation. Every later spec's "the shell is cached" half
      would then be measuring the second page load rather than the feature.
    */
    await waitForController(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  });

  test("owns only the caches sw-policy names", async ({ page }) => {
    await page.goto("/");
    await waitForController(page);
    await page.reload();
    await waitForController(page);

    const names = [...new Set((await cacheInventory(page)).map((entry) => entry.cache))];

    /*
      Named caches only, checked against the module's own list rather than a
      copy. `activate` deletes anything outside `OWNED_CACHES`, and this is the
      cheap half of that: a stray cache created by a future change shows up
      here immediately, whereas the pruning half needs a previous worker
      version to have left one behind — which a fresh Playwright context, by
      construction, never has. That half stays with the unit tests.
    */
    for (const name of names) {
      expect(OWNED_CACHES, `unexpected cache: ${name}`).toContain(name);
    }
    expect(names.length).toBeGreaterThan(0);
  });
});
