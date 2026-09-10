import { test, expect, type Page } from "@playwright/test";
import {
  QR_FIXTURE_PAYLOAD,
  SAMPLES,
  captureDownload,
  downloadAffordance,
  uploadFixture,
  watchZxingRequests,
} from "./support";

/**
 * `/qr-code-reader`, driven against a QR code something else wrote.
 *
 * Two things are proved here, and the second is the reason the file exists.
 *
 *   1. zxing-cpp compiled to WebAssembly reads `sample-qr.png` and returns the
 *      exact bytes that were encoded into it — asserted on screen AND in the
 *      downloaded transcript, so a page that renders a payload it cannot also
 *      export does not pass.
 *   2. The engine came from THIS origin. `zxing-wasm@3.1.3`'s default
 *      `locateFile` resolves to a jsDelivr URL, and that literal string is in
 *      the shipped bundle today — `qr-decode.ts` overrides it twice over so it
 *      is never used. Nothing else in the repo would notice if a refactor
 *      dropped the override, and the failure mode is silent: the tool would go
 *      on working while handing a third party the reader's IP and referrer, on
 *      a page whose whole claim is that the image never leaves the tab.
 *
 * TITLES: the `conversion-webkit` project greps out /gif|FFmpeg|MP4/i against
 * the project name, the FILE PATH and every describe/test title, so a banned
 * word anywhere in that chain would drop these cases from WebKit with no
 * warning. Both cases must run in both engines — the reader is plain
 * WebAssembly plus a 2D canvas, with nothing Chromium-only about it.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** The value beside a `StatStrip` label, read out of the label's own cell. */
async function stat(page: Page, label: string): Promise<string> {
  const cell = surfaceOf(page).getByText(label, { exact: true }).locator("xpath=..");
  return (await cell.innerText()).replace(label, "").trim();
}

test.describe("barcode reader", () => {
  test("reads the fixture code and loads its engine from this origin", async ({ page }) => {
    /*
      The watcher goes on BEFORE the navigation. The engine is fetched by
      `loadQrReader` the moment the first image is dropped, which is well
      inside the window this test controls, but a watcher installed after
      `goto` would miss anything a future preload does.
    */
    const watch = watchZxingRequests(page);
    await page.goto("/qr-code-reader");
    await uploadFixture(page, await SAMPLES.qrPng());

    const surface = surfaceOf(page);

    // The payload, verbatim. Scoped to the tool surface: the FAQ and the
    // reference prose below it are outside this region on purpose.
    await expect(surface.getByText(QR_FIXTURE_PAYLOAD, { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    // One symbol, read as a QR code rather than as some other symbology the
    // "QR only" scope should not have been searching for.
    expect(await stat(page, "CODES FOUND")).toBe("1");
    expect(await stat(page, "FORMAT")).toMatch(/QR/i);

    // The fixture is 198 × 198, comfortably under the canvas ceiling, so it
    // must have been scanned at full size — a downscale here would mean the
    // reader silently resized an image that never needed it.
    expect(await stat(page, "SCANNED AT")).toBe("198×198");

    // Nothing on the surface may claim a failure.
    await expect(surface.locator('[role="alert"]').filter({ hasText: /\S/ })).toHaveCount(0);

    /*
      And the same payload has to survive the export. `scanToText` is what the
      Download button hands over, and a reader that can print a payload but
      cannot write it out has lost the bytes somewhere between the two.
    */
    const dl = await captureDownload(page, downloadAffordance(page));
    expect(dl.name).toBe("sample-qr-codes.txt");
    expect(dl.bytes.toString("utf8")).toContain(QR_FIXTURE_PAYLOAD);

    watch.assertSelfHostedAndUsed();
  });

  test("says so when a photograph holds no code, with the same engine", async ({ page }) => {
    /*
      The honest-negative half. It matters for the guard as much as for the
      tool: `assertSelfHostedAndUsed` insists the engine was actually fetched,
      so this case proves the engine loads and reports "nothing here" rather
      than the page merely declining to run.
    */
    const watch = watchZxingRequests(page);
    await page.goto("/qr-code-reader");
    await uploadFixture(page, await SAMPLES.jpg());

    const surface = surfaceOf(page);
    // `.filter({ hasText: /\S/ })` because Next's route announcer is an empty
    // role=alert of its own.
    const alerts = surface.locator('[role="alert"]').filter({ hasText: /\S/ });
    await expect(alerts.first()).toContainText(/Nothing was found/, { timeout: 60_000 });
    expect(await stat(page, "CODES FOUND")).toBe("0");

    watch.assertSelfHostedAndUsed();
  });
});
