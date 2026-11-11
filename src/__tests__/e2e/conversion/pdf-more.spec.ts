import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import {
  SAMPLES,
  captureDownload,
  downloadAffordance,
  primaryAction,
  sample,
  toolError,
  uploadFixture,
} from "./support";
import { assertJpeg, assertPdf, assertPng } from "./validators";
import { compareImages, expectPdfPages, expectSameImage, pdfPageTexts } from "./fidelity";

/**
 * `heic-to-pdf`, `extract-images-from-pdf` and `pdf-editor`, asserted on what
 * is INSIDE the output: which images sit on which page and at what size, which
 * bytes an extracted image holds, which pages and text survive an edit.
 *
 * TITLES: nothing here matches /gif|FFmpeg|MP4/i — these must run in WebKit.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

interface PdfImage {
  page: number;
  width: number;
  height: number;
  filter: string;
  bytes: Buffer;
}

/** Every image XObject on every page, straight from the PDF object graph. */
async function pdfImages(buf: Buffer): Promise<PdfImage[]> {
  const doc = await PDFDocument.load(buf);
  const out: PdfImage[] = [];
  doc.getPages().forEach((p, i) => {
    const xobjects = p.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    if (!xobjects) return;
    for (const key of xobjects.keys()) {
      const obj = xobjects.lookup(key);
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      const f = obj.dict.lookup(PDFName.of("Filter"));
      const filter = f instanceof PDFArray ? String(f.lookup(0)) : String(f);
      out.push({
        page: i + 1,
        width: (obj.dict.lookup(PDFName.of("Width")) as PDFNumber).asNumber(),
        height: (obj.dict.lookup(PDFName.of("Height")) as PDFNumber).asNumber(),
        filter,
        bytes: Buffer.from(obj.contents),
      });
    }
  });
  return out;
}

async function pixelAt(page: Page, bytes: Buffer, mime: string, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    async ({ b64, type, x, y }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type }));
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    },
    { b64: bytes.toString("base64"), type: mime, x, y },
  );
}

const dominant = (px: number[]) => ["r", "g", "b"][px.indexOf(Math.max(px[0], px[1], px[2]))];

test.describe("PDF tools — real output", () => {
  test("heic-to-pdf makes one page per HEIC, each holding that picture upright and in order", async ({ page }) => {
    const photo = await sample("sample-photo.heic", "image/heic");
    const burst = await sample("sample-burst.heic", "image/heic");
    const rotated = await sample("sample-rotated.heic", "image/heic");

    await page.goto("/heic-to-pdf");
    await uploadFixture(page, [photo, burst, rotated]);
    await expect(page.getByText(/DRAG TO REORDER · 3 IMAGES/)).toBeVisible({ timeout: 90_000 });

    await primaryAction(page, /^Create PDF$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 3 });
    const images = await pdfImages(bytes);
    expect(images.map((i) => i.page), "one image per page, in upload order").toEqual([1, 2, 3]);
    // photo 800x600; burst keeps its PRIMARY (64x48, green); rotated is
    // 120x60 stored + orientation 6 → upright 60x120.
    expect(images.map((i) => [i.width, i.height])).toEqual([
      [800, 600],
      [64, 48],
      [60, 120],
    ]);
    for (const im of images) expect(im.filter, `page ${im.page} embeds a picture, not text`).toBe("/DCTDecode");

    // Content, not just size: the photo's fill colour, the burst's green, and
    // the rotated picture's red→green→blue bands running down its long axis.
    const [p0, p1, p2] = images;
    const [r, g, b] = await Promise.all([
      pixelAt(page, p0.bytes, "image/jpeg", 400, 300),
      pixelAt(page, p1.bytes, "image/jpeg", 32, 24),
      Promise.all([20, 60, 100].map((y) => pixelAt(page, p2.bytes, "image/jpeg", 30, y))),
    ]);
    expect(Math.abs(r[0] - 48), `photo pixel ${r}`).toBeLessThanOrEqual(14);
    expect(Math.abs(r[1] - 133), `photo pixel ${r}`).toBeLessThanOrEqual(14);
    expect(Math.abs(r[2] - 198), `photo pixel ${r}`).toBeLessThanOrEqual(14);
    expect(dominant(g), `burst pixel ${g}`).toBe("g");
    expect(b.map(dominant), `rotated bands ${JSON.stringify(b)}`).toEqual(["r", "g", "b"]);
  });

  test("extract-images-from-pdf lifts the embedded photo out byte for byte", async ({ page }) => {
    const doc = await sample("sample-photo-doc.pdf", "application/pdf");
    const photo = await SAMPLES.jpg();

    await page.goto("/extract-images-from-pdf");
    await uploadFixture(page, doc);
    const surface = surfaceOf(page);

    // Several images arrive as a ZIP — the button says how many.
    const button = surface.getByRole("button", { name: /^Download \d+ images \(ZIP\)$|^Download / }).first();
    await expect(button, `extract failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
    const { name, bytes } = await captureDownload(page, button);

    let files: { name: string; bytes: Buffer }[];
    if (name.endsWith(".zip")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      files = await Promise.all(
        Object.values(zip.files)
          .filter((f) => !f.dir)
          .map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.async("uint8array")) })),
      );
    } else {
      files = [{ name, bytes }];
    }

    const jpegs = files.filter((f) => /\.jpe?g$/i.test(f.name));
    expect(jpegs.length, "the 800x600 photo must come out as a .jpg").toBeGreaterThanOrEqual(1);
    const lifted = jpegs.find((f) => f.bytes.equals(photo.buffer));
    expect(
      lifted,
      `no extracted JPEG equals sample-photo.jpg byte for byte (got ${jpegs.map((j) => j.bytes.length)} vs ${photo.buffer.length})`,
    ).toBeTruthy();
    assertJpeg(lifted!.bytes);
    expectSameImage(
      await compareImages(
        page,
        { bytes: photo.buffer, mime: "image/jpeg" },
        { bytes: lifted!.bytes, mime: "image/jpeg" },
      ),
      { maxMae: 0.5, label: "extracted photo" },
    );

    /*
      The 48x48 opaque PNG is a Flate bitmap, rebuilt into a real PNG. The
      40x40 translucent one carries an /SMask, so lifting its stream alone
      would paint back what the mask hides: it (and the mask image) is left in
      the document, counted and said so. Four image objects, two out, two left.
    */
    const pngs = files.filter((f) => /\.png$/i.test(f.name));
    expect(files.length, "the photo and the one opaque PNG come out, nothing else").toBe(2);
    expect(pngs).toHaveLength(1);
    const { width, height } = assertPng(pngs[0].bytes);
    expect([width, height]).toEqual([48, 48]);
    // buildPng(): red ramps with x, green with y, blue is 128.
    const topLeft = await pixelAt(page, pngs[0].bytes, "image/png", 0, 0);
    const bottomRight = await pixelAt(page, pngs[0].bytes, "image/png", 47, 47);
    expect(topLeft, "top-left pixel").toEqual([0, 0, 128, 255]);
    expect(bottomRight, "bottom-right pixel").toEqual([255, 255, 128, 255]);
    await expect(surface).toContainText(/2 OF 4 IMAGES WERE LEFT IN THE DOCUMENT/);
  });

  test("pdf-editor deletes the pages that were marked and keeps the rest in order", async ({ page }) => {
    await page.goto("/pdf-editor");
    await uploadFixture(page, await SAMPLES.pdf());
    const surface = surfaceOf(page);
    const pageField = page.getByLabel("Page to edit");
    await expect(pageField).toBeVisible({ timeout: 60_000 });

    for (const n of [2, 4]) {
      await pageField.fill(String(n));
      await surface.getByRole("button", { name: "Delete this page" }).click();
    }
    await expect(surface.getByText("Page 2 · deleted")).toBeVisible();
    await expect(surface.getByText("Page 4 · deleted")).toBeVisible();

    await primaryAction(page, /^Apply edits$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `edit failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("sample-doc-edited.pdf");
    await assertPdf(bytes, { pages: 3 });
    await expectPdfPages(bytes, [1, 3, 5], "pdf-editor after deleting pages 2 and 4");
  });

  test("pdf-editor draws added text on the page it was added to and nowhere else", async ({ page }) => {
    const MARK = "EDITED-MARK-7Q3";
    await page.goto("/pdf-editor");
    await uploadFixture(page, await SAMPLES.pdf());
    const surface = surfaceOf(page);
    const pageField = page.getByLabel("Page to edit");
    await expect(pageField).toBeVisible({ timeout: 60_000 });

    await pageField.fill("3");
    const add = surface.getByRole("button", { name: "Add text", exact: true });
    await expect(add).toBeEnabled({ timeout: 60_000 });
    await add.click();
    const text = page.getByLabel("Text to draw on the page");
    await text.fill(MARK);

    await primaryAction(page, /^Apply edits$/).click();
    const dl = downloadAffordance(page);
    await expect(dl, `edit failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 5 });
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "pdf-editor after adding text");
    const texts = await pdfPageTexts(bytes);
    texts.forEach((t, i) => {
      if (i === 2) expect(t, "page 3 should carry the added text").toContain(MARK);
      else expect(t, `page ${i + 1} must not carry it`).not.toContain(MARK);
    });
    // The original text is still there (the editor marks over, it does not rebuild).
    expect(texts[2]).toContain("Page 3");
  });
});
