import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { SAMPLES, uploadFixture, primaryAction, downloadAffordance, captureDownload, toolError } from "./support";
import type { FixtureFile } from "../helpers";
import { IMAGE_MAE, compareImages, expectSameImage, pdfEmbeddedImages, rawToPng } from "./fidelity";
import { multiPageTiff } from "../fixtures";
import { assertPdf, assertZip } from "./validators";

/**
 * The image→PDF tools, judged by what a READER shows.
 *
 * The older tests (images-to-pdf-children.spec.ts) used 1×1 fixtures and
 * checked that a JPEG was embedded (`DCTDecode`) — a wrong, sideways, mirrored
 * or discoloured picture passed them. Here each output PDF is rendered by the
 * app's own pdf-to-png (pdfjs — a different code path from the assembler, and
 * the decoder a reader uses), each page is cropped to its picture, and that is
 * compared with the source AS A BROWSER SHOWS IT (EXIF orientation applied).
 *
 * The EXIF case matters: PDF readers ignore EXIF orientation, so a phone photo
 * stored sideways with Orientation=6 must be rotated by the tool. jpg-to-pdf
 * does it by embedding the JPEG unchanged (800×600) and drawing it with a 90°
 * matrix — measured 2026-11-11 — which only a render can verify.
 */

async function makeImage(page: Page, src: FixtureFile, type: "image/png" | "image/webp", name: string): Promise<FixtureFile> {
  const b64 = await page.evaluate(
    async ({ b64, srcType, type }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([buf], { type: srcType }));
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.92));
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { b64: src.buffer.toString("base64"), srcType: src.mimeType, type },
  );
  return { name, mimeType: type, buffer: Buffer.from(b64, "base64") };
}

async function assemble(page: Page, slug: string, inputs: FixtureFile[]): Promise<Buffer> {
  await page.goto(`/${slug}`);
  await uploadFixture(page, inputs);
  const n = inputs.length;
  await expect(page.getByText(new RegExp(`${n} IMAGES? · ${n} PAGES?`))).toBeVisible({ timeout: 60_000 });
  await primaryAction(page, /^Create PDF$/).click();
  const dl = downloadAffordance(page);
  await expect(dl, `${slug} failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
  return (await captureDownload(page, dl)).bytes;
}

/** Render every page with the app's pdf-to-png; page images in page order. */
async function render(page: Page, pdf: Buffer): Promise<Buffer[]> {
  await page.goto("/pdf-to-png");
  await uploadFixture(page, { name: "assembled.pdf", mimeType: "application/pdf", buffer: pdf });
  await primaryAction(page, /Convert to images/).click();
  const pages = (await assertPdf(pdf)).pages;
  if (pages === 1) {
    const dl = downloadAffordance(page);
    await expect(dl, `render failed: ${await toolError(page)}`).toBeVisible({ timeout: 150_000 });
    return [(await captureDownload(page, dl)).bytes];
  }
  const zipButton = page.getByRole("button", { name: /Download all \(ZIP\)/ });
  await expect(zipButton, `render failed: ${await toolError(page)}`).toBeVisible({ timeout: 150_000 });
  const { bytes } = await captureDownload(page, zipButton);
  const names = (await assertZip(bytes, { minEntries: pages })).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/)));
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  return Promise.all(names.map((n) => zip.files[n].async("nodebuffer")));
}

/** Crop a rendered page to the bounding box of its non-white pixels (the picture). */
async function picture(page: Page, png: Buffer): Promise<{ bytes: Buffer; mime: string }> {
  const b64 = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < buf.length; i++) buf[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error("rendered page is blank");
    // One pixel in from each edge: the anti-aliased border is half page, half picture.
    const w = x1 - x0 - 1, h = y1 - y0 - 1;
    const o = document.createElement("canvas");
    o.width = w;
    o.height = h;
    o.getContext("2d")!.drawImage(c, x0 + 1, y0 + 1, w, h, 0, 0, w, h);
    const blob = await new Promise<Blob>((r) => o.toBlob((b) => r(b!), "image/png"));
    const out = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  }, png.toString("base64"));
  return { bytes: Buffer.from(b64, "base64"), mime: "image/png" };
}

/** Every page shows its source, upright, in order. */
async function expectPagesShow(page: Page, pdf: Buffer, sources: FixtureFile[], label: string) {
  const pages = await render(page, pdf);
  expect(pages.length, `${label}: one page per image`).toBe(sources.length);
  for (const [i, png] of pages.entries()) {
    const shown = await picture(page, png);
    const diff = await compareImages(page, { bytes: sources[i].buffer, mime: sources[i].mimeType }, shown);
    test.info().annotations.push({ type: `${label} p${i + 1}`, description: JSON.stringify({ mae: +diff.mae.toFixed(2), corr: +diff.correlation.toFixed(3), shown: diff.output }) });
    // Aspect first: a sideways picture is the classic failure, and it reads
    // here before any pixel does.
    const srcBmp = await compareImages(page, { bytes: sources[i].buffer, mime: sources[i].mimeType }, { bytes: sources[i].buffer, mime: sources[i].mimeType });
    const want = srcBmp.output.width / srcBmp.output.height;
    const got = diff.output.width / diff.output.height;
    expect(Math.abs(got - want) / want, `${label} page ${i + 1}: shown ${diff.output.width}×${diff.output.height}, source aspect ${want.toFixed(3)}`).toBeLessThan(0.03);
    expectSameImage(diff, { maxMae: IMAGE_MAE.lossy, label: `${label} page ${i + 1}` });
  }
}

test.describe("image→PDF tools: each page shows its picture, upright", () => {
  test("jpg-to-pdf: a landscape photo and an EXIF-rotated portrait both read upright", async ({ page }) => {
    const landscape = await SAMPLES.jpg();
    const portrait = { ...(await SAMPLES.jpgPortrait()), name: "portrait.jpg" };
    const pdf = await assemble(page, "jpg-to-pdf", [landscape, portrait]);
    // Lossless passthrough: the JPEG bytes go in unchanged.
    const embedded = await pdfEmbeddedImages(pdf);
    expect(embedded.map((e) => e.filter)).toEqual(["DCTDecode", "DCTDecode"]);
    expect(embedded[0].file.bytes.equals(landscape.buffer), "page 1 embeds the source JPEG unchanged").toBe(true);
    await expectPagesShow(page, pdf, [landscape, portrait], "jpg-to-pdf");
  });

  test("png-to-pdf embeds the picture losslessly and shows it", async ({ page }) => {
    await page.goto("/");
    const png = await makeImage(page, await SAMPLES.jpg(), "image/png", "photo.png");
    const pdf = await assemble(page, "png-to-pdf", [png]);
    const [embedded] = await pdfEmbeddedImages(pdf);
    // The embedded pixels, not just the render, are the source's.
    expectSameImage(await compareImages(page, { bytes: png.buffer, mime: "image/png" }, embedded.file), {
      maxMae: IMAGE_MAE.lossless,
      label: `png-to-pdf embedded (${embedded.filter})`,
    });
    await expectPagesShow(page, pdf, [png], "png-to-pdf");
  });

  test("webp-to-pdf shows the picture", async ({ page }) => {
    await page.goto("/");
    const webp = await makeImage(page, await SAMPLES.jpg(), "image/webp", "photo.webp");
    await expectPagesShow(page, await assemble(page, "webp-to-pdf", [webp]), [webp], "webp-to-pdf");
  });

  test("images-to-pdf keeps each picture on its own page, in upload order", async ({ page }) => {
    await page.goto("/");
    const photo = await SAMPLES.jpg();
    const portrait = { ...(await SAMPLES.jpgPortrait()), name: "b-portrait.jpg" };
    const png = await makeImage(page, photo, "image/png", "c-photo.png");
    const inputs = [{ ...portrait, name: "a-portrait.jpg" }, { ...photo, name: "b-photo.jpg" }, png];
    await expectPagesShow(page, await assemble(page, "images-to-pdf", inputs), inputs, "images-to-pdf");
  });

  test("tiff-to-pdf: every page of a scan is its own page, in order", async ({ page }) => {
    // Browsers cannot decode TIFF, so the reference is the fixture's own known
    // page colours (multiPageTiff: red, green, blue) — no TIFF decoder involved.
    const COLOURS: [number, number, number][] = [[210, 60, 40], [40, 180, 90], [40, 90, 210]];
    const pdf = await (async () => {
      await page.goto("/tiff-to-pdf");
      await uploadFixture(page, multiPageTiff(3));
      await expect(page.getByText(/1 IMAGE · 3 PAGES/)).toBeVisible({ timeout: 60_000 });
      await primaryAction(page, /^Create PDF$/).click();
      const dl = downloadAffordance(page);
      await expect(dl, `tiff-to-pdf failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
      return (await captureDownload(page, dl)).bytes;
    })();
    const pages = await render(page, pdf);
    expect(pages.length, "one PDF page per TIFF page").toBe(3);
    for (const [i, png] of pages.entries()) {
      const shown = await picture(page, png);
      const solid = new Uint8Array(8 * 8 * 4);
      for (let k = 0; k < 64; k++) solid.set([...COLOURS[i], 255], k * 4);
      const diff = await compareImages(page, { bytes: await rawToPng(8, 8, 4, solid), mime: "image/png" }, shown);
      // A flat fill has no layout, so colour is the whole check.
      expectSameImage(diff, { maxMae: 6, minCorrelation: -1, label: `tiff-to-pdf page ${i + 1} (expected rgb ${COLOURS[i]})` });
    }
  });
});
