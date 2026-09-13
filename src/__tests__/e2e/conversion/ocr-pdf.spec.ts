import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { captureDownload, downloadAffordance, watchTesseractRequests } from "./support";

/**
 * `/ocr-pdf` — the two claims nothing else can check.
 *
 * The unit suite owns the placement arithmetic and the document structure;
 * jsdom has no canvas and no pdfjs worker, so it cannot run OCR, cannot render
 * a page and cannot extract text. Both of the things a user actually cares
 * about therefore live here:
 *
 *   1. THE TEXT COMES BACK. A PDF carrying no text at all goes in, and a PDF
 *      whose words a real extractor reads comes out — with the "no text
 *      before" half asserted against the input rather than assumed, so a tool
 *      that did nothing could not pass.
 *   2. THE PAGE IMAGE IS UNTOUCHED. The tool's pitch, its aboutText and an
 *      on-canvas footnote all say the scan is not rebuilt. Checked here by
 *      pulling the image out of both documents and comparing bytes.
 *
 * ⚠ No `gif`, `FFmpeg` or `MP4` in this filename or any title below:
 * conversion-webkit's `grepInvert` matches the FILE PATH too, and one stray
 * word would silently drop the WebKit half while the run reported green.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** Short, high-contrast, and free of the letter pairs OCR most confuses. */
const PHRASE = "TRANSMUTE READS THIS";

/**
 * Rasterise the phrase in the BROWSER and assemble a scan in Node.
 *
 * This is the only honest way to get a real test input: a PDF whose only
 * content is a picture of text, which is what every scanner produces and the
 * one shape this tool is for. Node has no canvas, so the browser draws; pdf-lib
 * cannot rasterise, so Node assembles. Neither half can do it alone.
 *
 * Built rather than checked in, per this repo's stated default for image
 * inputs — and here it earns it twice, because the assertion is that OCR
 * returns THESE words, so the input and the expectation must live together.
 */
async function scanOf(page: Page, phrase: string, rotate = 0): Promise<Buffer> {
  const pngBytes: number[] = await page.evaluate(async (text) => {
    const FONT = "600 64px Helvetica, Arial, sans-serif";
    // Measure first: a fixed width clips the last word, and an OCR result that
    // lost a word to the canvas edge looks like an engine defect.
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = FONT;
    const width = Math.ceil(measure.measureText(text).width);

    const canvas = document.createElement("canvas");
    canvas.width = width + 96;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.fillText(text, 48, canvas.height / 2);

    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, phrase);

  const doc = await PDFDocument.create();
  const png = await doc.embedPng(Uint8Array.from(pngBytes));
  // A letter page with the strip of text near the top, like a scanned header.
  const pdfPage = doc.addPage([612, 792]);
  const scale = (612 - 96) / png.width;
  pdfPage.drawImage(png, {
    x: 48,
    y: 792 - 96 - png.height * scale,
    width: png.width * scale,
    height: png.height * scale,
  });
  if (rotate) pdfPage.setRotation({ type: "degrees", angle: rotate } as never);
  return Buffer.from(await doc.save());
}

/** Read a PDF's text with pdfjs — the same library the app ships. */
async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No worker and no canvas in this process; text extraction needs neither.
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n";
  }
  await doc.destroy();
  return out.replace(/\s+/g, " ").trim();
}

/** Every image XObject in the file, as raw bytes — the page's own picture. */
async function imageBytes(bytes: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const text = String(obj);
    if (text.includes("/Image")) {
      const contents = (obj as { contents?: Uint8Array }).contents;
      if (contents) out.push(Buffer.from(contents).toString("base64"));
    }
  }
  return out;
}

test.describe("making a scan searchable", () => {
  test.setTimeout(240_000);

  test("adds text a real extractor can read, and leaves the page picture alone", async ({
    page,
  }) => {
    await page.goto("/ocr-pdf");
    const source = await scanOf(page, PHRASE);

    /*
      THE CONTROL THAT MAKES THE ASSERTION MEAN SOMETHING. If the input already
      had text, a tool that did nothing at all would pass the check below.
    */
    expect(
      await pdfText(source),
      "the fixture must start with NO text or this test proves nothing",
    ).toBe("");

    const watch = watchTesseractRequests(page);
    // Re-navigate so the watcher sees the engine fetch from the very start.
    await page.goto("/ocr-pdf");
    watch.assertNeverFetched("the page has been opened but no document dropped");

    const input = surfaceOf(page).locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 60_000 });
    await input.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: source });

    const dl = downloadAffordance(page);
    await expect(dl).toBeVisible({ timeout: 210_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("scan-searchable.pdf");
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // 1. THE TEXT COMES BACK.
    const recovered = (await pdfText(bytes)).toUpperCase();
    expect(recovered, `the searchable layer reads "${recovered}"`).toContain(PHRASE);

    // 2. THE PAGE PICTURE IS THE ONE THAT WENT IN, byte for byte.
    const before = await imageBytes(source);
    const after = await imageBytes(bytes);
    expect(before.length, "the fixture carries no image — nothing to compare").toBeGreaterThan(0);
    expect(after, "the page image was re-encoded; the scan is meant to be untouched").toEqual(
      before,
    );

    // …and every byte of the engine came from us, and it really was fetched.
    watch.assertSelfHostedAndUsed();
  });

  test("says so, and offers nothing, when the pages carry no text at all", async ({ page }) => {
    /*
      The honest-empty case. OCR does not throw on a blank page — it returns
      the empty string — so without an explicit branch the tool would hand back
      a "searchable" file containing nothing and look like it had worked.
    */
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const blank = Buffer.from(await doc.save());

    await page.goto("/ocr-pdf");
    const input = surfaceOf(page).locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 60_000 });
    await input.setInputFiles({ name: "blank.pdf", mimeType: "application/pdf", buffer: blank });

    const notice = surfaceOf(page).locator('[role="alert"], [role="status"]');
    await expect(
      notice.filter({ hasText: /No text came out of any of this PDF/i }).first(),
    ).toBeVisible({ timeout: 210_000 });

    expect(
      await downloadAffordance(page).count(),
      "a document with no recognised text must not offer a download",
    ).toBe(0);
  });

  test("warns when the document already carries real text", async ({ page }) => {
    /*
      The pre-flight. Overlaying OCR on a page that already has text makes
      search and copy return everything twice, and the layer already there is
      the accurate one. A warning rather than a refusal, because a mixed
      document — a scan bound into a digital report — is a real case.
    */
    const doc = await PDFDocument.create();
    const p = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    p.drawText("Already selectable", { x: 48, y: 640, size: 28, font, color: rgb(0, 0, 0) });
    const digital = Buffer.from(await doc.save());
    expect(await pdfText(digital), "this fixture must really carry text").toContain("Already");

    await page.goto("/ocr-pdf");
    const input = surfaceOf(page).locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 60_000 });
    await input.setInputFiles({
      name: "digital.pdf",
      mimeType: "application/pdf",
      buffer: digital,
    });

    const notice = surfaceOf(page).locator('[role="alert"], [role="status"]');
    await expect(notice.filter({ hasText: /already carry real text/i }).first()).toBeVisible({
      timeout: 120_000,
    });
  });
});
