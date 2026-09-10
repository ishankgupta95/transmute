import { test, expect } from "@playwright/test";

import { expectNetworkIsDown, goOffline, loadUnderWorker } from "./support";

/**
 * The promise, and its edge.
 *
 * Cutting the context's network is the only honest way to test this, and it is
 * also the only one available: Playwright's own typings note that a
 * `page.route` "will not intercept requests intercepted by Service Worker"
 * (types.d.ts:9147-9156), so the usual trick of stubbing a URL to fail cannot
 * reach anything the worker handles. `setOffline` cuts the worker's `fetch()`
 * too — with one measured caveat that `goOffline` in ./support exists to
 * absorb, and that `expectNetworkIsDown` exists to catch if it ever stops
 * being absorbed.
 */
test.describe("offline navigation", () => {
  test("a page opened once still opens with the network cut", async ({ page, context }) => {
    await loadUnderWorker(page, "/");
    const onlineHeading = await page.locator("h1").first().innerText();

    await goOffline(context);
    await expectNetworkIsDown(page);

    // `domcontentloaded` rather than `load`: the page's one cross-origin
    // request (GA4) is `network-only` by design and simply fails offline, and
    // waiting on the load event would make this spec depend on how the browser
    // times out a beacon rather than on whether the document was served.
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The REAL page, not the fallback. Asserting only "a document rendered"
    // would pass on `offline.html`, which would mean the shell cache had
    // failed and the fallback had covered for it.
    //
    // Compared through `innerText` on BOTH sides, via poll so it still retries.
    // The homepage h1 is two block lines, and the two readings disagree about
    // them: `innerText` yields "Change the file.\nNot the file's owner." while
    // `toHaveText` normalises the text content to "Change the file.Not the
    // file's owner." — no separator at all, because the two spans are
    // adjacent. Capturing one way and asserting the other made this fail on a
    // page that was served perfectly.
    await expect
      .poll(() => page.locator("h1").first().innerText())
      .toBe(onlineHeading);
    await expect(page.locator("h1").first()).not.toHaveText(/on this device/i);
  });

  test("a page never opened falls back to offline.html rather than an error", async ({
    page,
    context,
  }) => {
    await loadUnderWorker(page, "/");
    await goOffline(context);
    await expectNetworkIsDown(page);

    /*
      `/merge-pdf` was never visited in this context, so `networkFirst` finds
      no cached copy and reaches the precached fallback. This is also the case
      that stays clear of the static server's one ambiguous resolution
      (`out/merge-pdf.html` beside a `out/merge-pdf/` directory): with the
      network down, the server is never consulted at all — the answer comes
      from the Cache API.
    */
    await page.goto("/merge-pdf", { waitUntil: "domcontentloaded" });

    await expect(page.locator("h1")).toHaveText(/on this device/i);
    // The URL is still the one that was asked for: the fallback is a response,
    // not a redirect, so a reload once the network returns lands on the real
    // page rather than on /offline.html.
    expect(new URL(page.url()).pathname).toBe("/merge-pdf");
  });

  test("the fallback needs nothing but itself", async ({ page, context }) => {
    await loadUnderWorker(page, "/");
    await goOffline(context);
    await expectNetworkIsDown(page);
    await page.goto("/merge-pdf", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveText(/on this device/i);

    /*
      THE POINT OF A HAND-WRITTEN FALLBACK. `out/404.html` is a full Next page
      whose four stylesheets and script chunks are exactly what is missing when
      this fires; `offline.html` references no external file at all, so it
      renders whatever else is or is not on the device. Counting its external
      subresource references is how that stays true — a stylesheet or a font
      added later would make the page that must work when nothing else does
      depend on something else.

      The h1 assertion above is a precondition, not decoration: on the real
      page this count is not zero, so without it a regression that served the
      wrong document would turn this into a test of index.html.
    */
    const external = await page.evaluate(
      () => document.querySelectorAll("link[href], script[src], img[src]").length,
    );
    expect(external, "offline.html must reference no external file").toBe(0);

    // And it is legible: a page that rendered black on black would pass every
    // structural check above. The stylesheet is inline, so a computed colour
    // is proof the Nocturne values survived being written out literally rather
    // than left as tokens this file cannot resolve.
    const painted = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(painted.color).not.toBe(painted.background);
    expect(painted.background).not.toBe("rgba(0, 0, 0, 0)");
  });
});
