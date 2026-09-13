import { test, expect, type Page } from "@playwright/test";
import { captureDownload, downloadAffordance, watchTesseractRequests } from "./support";

/**
 * `/image-to-text` — the functional half. The CI-visible smoke case lives in
 * `image/ocr-engine-smoke.spec.ts`; this file owns the behaviours that are too
 * slow or too numerous to run on every push, and it runs in BOTH conversion
 * projects, which is the only place WebKit ever executes this engine.
 *
 * That second point is the reason the file exists at all rather than folding
 * into the smoke case. The core served here is the FIXED-SIMD build, and the
 * variant is pinned in `ocr.ts` rather than feature-detected — a decision made
 * on a measurement (fixed SIMD validates in Chromium, Firefox and WebKit;
 * relaxed SIMD does not validate in WebKit). A pinned variant is exactly the
 * kind of choice that is right on the machine it was measured on and wrong
 * everywhere else, so it wants a WebKit run standing behind it.
 *
 * ⚠ No `gif`, `FFmpeg` or `MP4` in this filename or in any title below:
 * `playwright.config.ts` gives conversion-webkit a `grepInvert` that matches
 * the FILE PATH as well as the title, so one stray word would silently drop
 * the WebKit half while the run still reported green.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

const PHRASE = "TRANSMUTE READS THIS";

/**
 * Draw an image in the page and hand it to the tool's file input.
 *
 * `text: null` paints a blank sheet — the honest-empty case. Everything is
 * built in the page rather than checked in, which is this repo's stated
 * default for image inputs, and here it also keeps the expected string and the
 * thing that produced it in one place.
 */
async function feedImage(page: Page, text: string | null): Promise<void> {
  await page.evaluate(async (phrase) => {
    const FONT = "600 84px Helvetica, Arial, sans-serif";
    const PAD = 48;

    // Measure first: a fixed width clips the last word, and an OCR result that
    // lost a word to the canvas edge looks like an engine defect rather than a
    // fixture one. (Measured — it returned "TRANSMUTE READS TE".)
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = FONT;
    const width = phrase ? Math.ceil(measure.measureText(phrase).width) : 600;

    const canvas = document.createElement("canvas");
    canvas.width = width + PAD * 2;
    canvas.height = 220;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (phrase) {
      ctx.fillStyle = "#000000";
      ctx.font = FONT;
      ctx.textBaseline = "middle";
      ctx.fillText(phrase, PAD, canvas.height / 2);
    }

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const file = new File([blob], "sheet.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('[data-tool-surface] input[type="file"]');
    if (!input) throw new Error("image-to-text rendered no file input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
}

/** The tool UI is `ssr: false`, so the input arrives after hydration. */
async function waitForPicker(page: Page): Promise<void> {
  await surfaceOf(page)
    .locator('input[type="file"]')
    .first()
    .waitFor({ state: "attached", timeout: 60_000 });
}

test.describe("reading text out of a picture", () => {
  test.setTimeout(180_000);

  test("recognises rendered words, and fetches its engine only from this origin", async ({
    page,
  }) => {
    const watch = watchTesseractRequests(page);
    await page.goto("/image-to-text");

    // The disclosure the page itself makes: 4.9 MB, and not one byte of it
    // before there is something to read.
    watch.assertNeverFetched("the page has been opened but nothing dropped");

    await waitForPicker(page);
    await feedImage(page, PHRASE);

    const output = surfaceOf(page).getByRole("region", { name: "Recognised text" });
    await expect(output).toHaveText(/\S/, { timeout: 150_000 });

    const recognised = ((await output.textContent()) ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    expect(recognised, `OCR returned "${recognised}"`).toContain(PHRASE);

    // Both arms: no foreign origin, AND the engine really was fetched. A guard
    // that cannot tell "clean" from "never ran" proves nothing.
    watch.assertSelfHostedAndUsed();
  });

  test("the downloaded file carries the same text the page shows", async ({ page }) => {
    await page.goto("/image-to-text");
    await waitForPicker(page);
    await feedImage(page, PHRASE);

    const output = surfaceOf(page).getByRole("region", { name: "Recognised text" });
    await expect(output).toHaveText(/\S/, { timeout: 150_000 });

    const dl = downloadAffordance(page);
    await expect(dl.first()).toBeVisible({ timeout: 30_000 });
    const { name, bytes } = await captureDownload(page, dl);

    // Named from the image, not from the tool: `sheet.png` → `sheet.txt`.
    expect(name).toBe("sheet.txt");
    expect(bytes.toString("utf8").replace(/\s+/g, " ").trim().toUpperCase()).toContain(PHRASE);
  });

  test("a blank sheet is reported as empty rather than handed back as a file", async ({ page }) => {
    /*
      THE CASE THAT KEEPS THIS TOOL HONEST. OCR does not throw on a picture
      with no text in it — `recognizeImage` returns the empty string — so
      without an explicit empty branch the tool would offer a 0-byte .txt and
      look like it had worked. `PdfToTextUI` applies the same rule to a PDF of
      scans, and this is that rule for a picture of nothing.

      Note what is NOT asserted: that the recognised text is exactly "". A
      blank canvas can produce a stray mark at low confidence, and pinning the
      empty string would make this case fail on a correct read. What must hold
      is the AFFORDANCE — nothing to download.
    */
    await page.goto("/image-to-text");
    await waitForPicker(page);
    await feedImage(page, null);

    const surface = surfaceOf(page);
    const notice = surface.locator('[role="alert"], [role="status"]');
    await expect(notice.filter({ hasText: /No text came out of this image/i }).first()).toBeVisible({
      timeout: 150_000,
    });

    expect(
      await downloadAffordance(page).count(),
      "a picture with no text must not offer an empty .txt to download",
    ).toBe(0);
  });
});
