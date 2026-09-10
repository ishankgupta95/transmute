import { test, expect, type Locator, type Page } from "@playwright/test";

import { ENGINE_BUNDLES, formatEngineBytes } from "@/lib/pwa/offline";
import {
  ENGINE_CACHE,
  cacheInventory,
  expectNetworkIsDown,
  goOffline,
  isEnginePath,
  loadUnderWorker,
} from "./support";

/**
 * oxipng: 164,172 bytes, one URL, one tool. The opt-in path is identical for
 * all eight bundles — `addBundle` takes an id — so the spec exercises it with
 * the cheapest one rather than pulling 32 MB through a test runner to learn
 * the same thing.
 */
const SMALLEST = ENGINE_BUNDLES.reduce((a, b) => (a.bytes <= b.bytes ? a : b));

function engineRow(page: Page): Locator {
  // Located by the URL the row prints, not by its label: the URL is the thing
  // the cache is keyed on, so a row whose printed path drifted from what
  // `addBundle` fetches would fail to be found rather than silently pass.
  return page.locator("li").filter({ hasText: SMALLEST.urls[0] });
}

/** What the engine cache actually holds for one URL, read from the browser. */
async function storedBytes(page: Page, url: string): Promise<number | null> {
  return page.evaluate(
    async ([cacheName, target]) => {
      if (!(await caches.has(cacheName))) return null;
      const cache = await caches.open(cacheName);
      const hit = await cache.match(target, { ignoreSearch: true });
      return hit ? (await hit.arrayBuffer()).byteLength : null;
    },
    [ENGINE_CACHE, url] as const,
  );
}

/**
 * The opt-in, driven through the surface a visitor uses.
 *
 * Every state word on /offline-access is `cachedBundleIds()`'s output rendered:
 * `OfflineSettings.refresh()` awaits it and the row shows `cached.has(id)`.
 * So asserting the badge IS asserting that function, and it asserts it the way
 * it will actually be read — after a round trip through the Cache API, which
 * is the only thing that module is allowed to believe.
 *
 * Each assertion is paired with a direct read of the cache, because the two
 * can disagree in exactly the way that matters: a badge that said STORED over
 * an empty cache is the failure this whole design exists to prevent.
 */
test.describe("offline opt-in", () => {
  test("the row states its size before anything is fetched", async ({ page }) => {
    await loadUnderWorker(page, "/offline-access");
    const row = engineRow(page);

    await expect(row.getByText("NOT STORED")).toBeVisible();
    expect(await storedBytes(page, SMALLEST.urls[0])).toBeNull();

    /*
      THE SIZE IS IN THE BUTTON. Consent to an unnamed download is not consent,
      and this button is the last surface before the fetch. Asserting the
      accessible name — the string a screen reader announces — rather than the
      rendered span, because that is what makes the claim reach everyone.
    */
    const keep = row.getByRole("button", { name: /^KEEP OFFLINE/ });
    await expect(keep).toHaveAccessibleName(
      new RegExp(formatEngineBytes(SMALLEST.bytes).replace(" ", "\\s")),
    );
  });

  test("opting in stores exactly that bundle, and removing it clears it", async ({ page }) => {
    await loadUnderWorker(page, "/offline-access");
    const row = engineRow(page);
    const summary = page.locator("[aria-live='polite']").first();

    await expect(row.getByText("NOT STORED")).toBeVisible();
    await expect(summary).toContainText("No engine is stored");

    await row.getByRole("button", { name: /^KEEP OFFLINE/ }).click();

    // `exact` matters: "NOT STORED" contains "STORED", and a substring match
    // here would go green on the state this test is trying to leave.
    await expect(row.getByText("STORED", { exact: true })).toBeVisible({ timeout: 60_000 });

    // The badge is `cachedBundleIds()`; this is the cache it claims to have
    // read. The byte count is the measured size of the file on disk, so a
    // truncated or error-page body fails here rather than reading as stored.
    expect(await storedBytes(page, SMALLEST.urls[0])).toBe(SMALLEST.bytes);

    // The count in the summary is `cachedBundleIds().size` — ONE, not eight.
    // Storing one bundle must not pull the other seven along with it, and the
    // inventory below is the same claim from the other direction.
    await expect(summary).toContainText(`1 of ${ENGINE_BUNDLES.length} engines stored`);

    const cachedEngines = (await cacheInventory(page))
      .filter((entry) => isEnginePath(entry.path))
      .map((entry) => entry.path);
    expect(cachedEngines).toEqual([...SMALLEST.urls]);

    // ── and back out again ────────────────────────────────────────────────
    await row.getByRole("button", { name: "REMOVE" }).click();

    await expect(row.getByText("NOT STORED")).toBeVisible({ timeout: 30_000 });
    expect(await storedBytes(page, SMALLEST.urls[0])).toBeNull();
    await expect(summary).toContainText("No engine is stored");
    expect((await cacheInventory(page)).filter((entry) => isEnginePath(entry.path))).toEqual([]);
  });

  test("a stored engine survives the network being cut", async ({ page, context }) => {
    /*
      WHY THE OPT-IN EXISTS AT ALL. Storing bytes nothing can hand back would
      be the most expensive no-op on the site, so the test that matters is not
      "is it in the cache" but "does a request for it succeed with no network".
      That is the worker's `engine` strategy on its hit path, and it is the one
      promise /offline-access makes to anyone who presses the button.
    */
    await loadUnderWorker(page, "/offline-access");
    const row = engineRow(page);
    await row.getByRole("button", { name: /^KEEP OFFLINE/ }).click();
    await expect(row.getByText("STORED", { exact: true })).toBeVisible({ timeout: 60_000 });

    await goOffline(context);
    // Without this the two assertions below would pass against a live server,
    // proving the file is downloadable rather than that it is stored.
    await expectNetworkIsDown(page);

    const offlineFetch = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
      } catch (err) {
        return { ok: false, bytes: -1, error: String(err) };
      }
    }, SMALLEST.urls[0]);

    expect(offlineFetch.ok).toBe(true);
    expect(offlineFetch.bytes).toBe(SMALLEST.bytes);

    // And the retry variant every loader falls back to. A failed dynamic
    // import is remembered as failed in the realm's module map, so the loaders
    // re-request with `?retry=N` (audio-pcm.ts:52-57) — which is a different
    // URL and would miss a cache keyed strictly. The worker pairs its
    // path-only `isEngineUrl` with `ignoreSearch: true`; this is that pairing,
    // offline, where getting it wrong is unrecoverable.
    const retried = await page.evaluate(async (url) => {
      try {
        const response = await fetch(`${url}?retry=1`);
        return { ok: response.ok, bytes: (await response.arrayBuffer()).byteLength };
      } catch (err) {
        return { ok: false, bytes: -1, error: String(err) };
      }
    }, SMALLEST.urls[0]);

    expect(retried.ok).toBe(true);
    expect(retried.bytes).toBe(SMALLEST.bytes);
  });
});
