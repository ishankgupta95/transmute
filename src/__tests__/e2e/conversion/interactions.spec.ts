import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeImageInPage,
  toolError,
} from "./support";
import { assertPng } from "./validators";

/**
 * Interaction paths the unit suite cannot reach: cropperjs (needs real layout
 * and pointer events), the Markdown print pipeline (needs an iframe document),
 * and the screen recorder (needs media permissions and a capture source).
 */

test.describe("cropperjs interaction", () => {
  test("1:1 aspect ratio produces a square crop", async ({ page }) => {
    await page.goto("/crop-image");
    await uploadFixture(page, await SAMPLES.jpg());

    // Cropper needs the <img> laid out before it initialises its box.
    await expect(page.getByRole("button", { name: "1:1", exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "1:1", exact: true }).click();

    await primaryAction(page, /^Crop$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `crop failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    const png = assertPng(bytes);
    // The ratio is applied by cropperjs in CSS pixels and scaled back to source
    // pixels, so allow a rounding pixel either way rather than exact equality.
    expect(Math.abs(png.width - png.height), `expected square, got ${png.width}x${png.height}`)
      .toBeLessThanOrEqual(2);
  });

  test("dragging the crop box changes the exported region", async ({ page }) => {
    await page.goto("/crop-image");
    await uploadFixture(page, await SAMPLES.jpg());

    const cropBox = page.locator(".cropper-crop-box");
    await expect(cropBox).toBeVisible({ timeout: 60_000 });

    // The default 80% crop box extends below a 720px-tall viewport, putting the
    // south-east handle out of the mouse's reach — scroll it in before dragging.
    const handle = page.locator(".cropper-point.point-se");
    await handle.scrollIntoViewIfNeeded();
    await expect(handle).toBeVisible();

    const before = (await cropBox.boundingBox())!;
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 40, hb.y - 30, { steps: 5 });
    await page.mouse.move(hb.x - 80, hb.y - 60, { steps: 10 });
    await page.mouse.up();

    const after = (await cropBox.boundingBox())!;
    expect(after.width, "drag should have shrunk the crop box").toBeLessThan(before.width);
    expect(after.height).toBeLessThan(before.height);

    await primaryAction(page, /^Crop$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `crop failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    const png = assertPng(bytes);
    const dims = await probeImageInPage(page, bytes, "image/png");
    expect(dims).toEqual({ width: png.width, height: png.height });
    // `autoCropArea: 0.8` on an 800px-wide source exports 640px un-dragged, so
    // a shrunk selection has to come back visibly narrower than that.
    expect(png.width).toBeLessThan(620);
    expect(png.width).toBeGreaterThan(100);
  });
});

test.describe("markdown-to-pdf export", () => {
  test("builds a print document from the editor content", async ({ page }) => {
    // `PrintFrame` writes the built document into an off-screen iframe and
    // immediately calls print(). Headless Chromium fires `afterprint`
    // synchronously, so the parent unmounts the iframe within milliseconds and
    // it can't be inspected after the fact. Stub print in every frame to
    // capture what was about to be printed instead.
    await page.addInitScript(() => {
      window.print = function capturePrint() {
        try {
          (window.top as Window & { __printedHtml?: string }).__printedHtml =
            document.documentElement.outerHTML;
        } catch {
          // Cross-origin top — not possible here, but don't break printing.
        }
      };
    });

    await page.goto("/markdown-to-pdf");

    // Switch to the paste/editor mode, then type real Markdown.
    const pasteTab = page.getByRole("tab", { name: /paste|type|write/i }).last();
    if (await pasteTab.count()) await pasteTab.click();

    const editor = page.getByLabel(/Markdown source|Uploaded Markdown content/).first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.fill("# Fixture Heading\n\nSome **bold** body text.\n\n- one\n- two\n");

    // The live preview renders through `marked` before any export happens.
    await expect(page.getByText("Fixture Heading").first()).toBeVisible();

    await primaryAction(page, /Export to PDF/).click();

    await expect
      .poll(
        () => page.evaluate(() => (window as Window & { __printedHtml?: string }).__printedHtml),
        { timeout: 60_000, message: "print document was never produced" },
      )
      .toBeTruthy();

    const printed = await page.evaluate(
      () => (window as Window & { __printedHtml?: string }).__printedHtml!,
    );
    // The print document is self-contained: rendered body + inlined styles.
    expect(printed).toContain("Fixture Heading");
    expect(printed).toContain("<strong>bold</strong>");
    expect(printed).toContain("<li>one</li>");
    expect(printed).toContain("<li>two</li>");
    expect(printed, "print CSS must be inlined — there is no stylesheet to link")
      .toContain("<style");
  });
});

test.describe("screen recorder", () => {
  test("records, pauses and produces a downloadable clip", async ({ page }) => {
    await page.goto("/screen-recorder");

    const start = page.getByRole("button", { name: /Start Recording/i });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await start.click();

    // If the environment cannot grant display capture, the tool surfaces its
    // error state — report that rather than failing on a missing control.
    const stop = page.getByRole("button", { name: /Stop Recording/i });
    const failed = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
    await expect(stop.or(failed)).toBeVisible({ timeout: 60_000 });

    if (await failed.count()) {
      const message = await failed.textContent();
      test.skip(true, `display capture unavailable in this environment: ${message?.trim()}`);
    }

    // The elapsed timer confirms the recorder is actually running. It appears
    // both on the stage and in the rail readout, so scope to the first.
    await expect(page.getByText(/00:0\d/).first()).toBeVisible({ timeout: 30_000 });

    const pause = page.getByRole("button", { name: /Pause/i });
    if (await pause.count()) {
      await pause.click();
      await expect(page.getByRole("button", { name: /Resume/i })).toBeVisible();
      await page.getByRole("button", { name: /Resume/i }).click();
    }

    await page.waitForTimeout(2000);
    await stop.click();

    const dl = downloadAffordance(page);
    await expect(dl, `recording failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { bytes } = await captureDownload(page, dl);

    // MediaRecorder emits WebM (EBML magic).
    expect(bytes.length).toBeGreaterThan(1024);
    expect(bytes.readUInt32BE(0), "recording should be a WebM/EBML container").toBe(0x1a45dfa3);
  });
});
