import { test, expect } from "@playwright/test";

import { ENGINE_BUNDLES } from "@/lib/pwa/offline";
import {
  ENGINE_CACHE,
  cacheInventory,
  expectShellWithoutEngines,
  isEnginePath,
  loadUnderWorker,
} from "./support";

/** The smallest engine on the site: 164,172 bytes, one tool. Cheap to fetch for real. */
const SMALLEST = ENGINE_BUNDLES.reduce((a, b) => (a.bytes <= b.bytes ? a : b));

/**
 * THE LOUDEST RULE IN THE FEATURE.
 *
 * No engine binary enters storage without an explicit, sized, user-initiated
 * opt-in. `/ffmpeg-core.wasm` alone is 32,232,419 bytes, and a worker that
 * pulled it in the background on a first visit would be the largest silent
 * cost this site has ever imposed — on a site whose whole pitch is that it
 * does nothing behind your back.
 *
 * It is also the likeliest thing to regress, because every "improve the
 * offline experience" instinct points at a `cache.put` in the worker's engine
 * branch. `service-worker.ts` contains none, and these specs are what keeps it
 * that way from outside.
 *
 * EVERY ASSERTION HERE IS TWO-SIDED. "Nothing is cached" is the pass condition
 * of a browser where caching never happened at all, so each check pairs the
 * absence of engines with the presence of the shell.
 */
test.describe("no engine is cached without opt-in", () => {
  test("a plain visit caches the shell and not one engine byte", async ({ page }) => {
    await loadUnderWorker(page, "/");

    expectShellWithoutEngines(await cacheInventory(page));

    // And the engine cache is not merely empty — it does not exist. `caches.open`
    // CREATES a cache, so anything that had merely *looked* would leave a name
    // behind; that no such name is here is evidence the worker never opened it.
    const names = await page.evaluate(() => caches.keys());
    expect(names).not.toContain(ENGINE_CACHE);
  });

  test("visiting a tool page that needs an engine still caches no engine", async ({ page }) => {
    /*
      `/compress-png` is the one tool that reaches oxipng (png-optimise.ts has
      exactly one caller, CompressPngUI.tsx:212). Opening its page is what a
      visitor does before deciding anything, and it must not be what pays for
      the engine — the fetch happens when a file is dropped, not when the page
      is drawn. A precache built by globbing, or an install list that followed
      the registry, would fail here.
    */
    await loadUnderWorker(page, "/compress-png");

    expectShellWithoutEngines(await cacheInventory(page));
  });

  test("an engine actually fetched through the worker is served but NOT stored", async ({
    page,
  }) => {
    await loadUnderWorker(page, "/");

    /*
      The real thing: a request for an engine, through the worker, exactly as a
      tool's loader makes it. This is the branch the rule lives in —
      `engineFromCacheOnly` returns `fetch(request)` and has no `cache.put`
      anywhere in it. A one-line "helpfully" caching that response would leave
      every other spec in this file green and this one red, which is the whole
      reason it fetches for real instead of asserting about an idle page.
    */
    const served = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
    }, SMALLEST.urls[0]);

    // Served correctly — the negative half below is about storage, not about
    // the worker breaking the request.
    expect(served.ok).toBe(true);
    expect(served.bytes).toBe(SMALLEST.bytes);

    const entries = await cacheInventory(page);
    expectShellWithoutEngines(entries);
    expect(
      entries.filter((entry) => entry.path === SMALLEST.urls[0]),
      "the engine was fetched through the worker and must not have been kept",
    ).toEqual([]);
  });

  test("the shipped engine list and the harness agree", async () => {
    /*
      A guard on the guard. `expectShellWithoutEngines` decides "is this an
      engine?" with `isEngineUrl` — the worker's own predicate — so a ninth
      engine added to ENGINE_BUNDLES but not to ENGINE_FILES/ENGINE_DIRS would
      make every check above blind to it. That is a silent failure, so it gets
      a loud one.
    */
    for (const bundle of ENGINE_BUNDLES) {
      for (const url of bundle.urls) {
        expect(isEnginePath(url), `${bundle.id}: ${url} is not recognised as an engine`).toBe(
          true,
        );
      }
    }
  });
});
