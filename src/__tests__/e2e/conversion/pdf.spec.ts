import { test, expect } from "@playwright/test";
import {
  SAMPLES,
  sample,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  toolError,
} from "./support";
import { assertPdf, assertZip, assertJpeg } from "./validators";

/**
 * PDF pipelines run on pdf-lib (every document and page operation) and pdfjs
 * (rendering). The fixture is a real 5-page A4 document with embedded text and
 * a filled rectangle per page, so page counts, rasterisation and stamping are
 * all falsifiable.
 *
 * The page-geometry and extraction tools that landed alongside these —
 * extract-pdf-pages, delete-pdf-pages, crop-pdf, change-pdf-page-size,
 * pdf-resizer and pdf-to-text — are covered in `pdf-pages.spec.ts`.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i,
 * and every case here must run in BOTH engines — pdf-lib and pdfjs have no
 * Chromium-only dependency — so no title may contain those words.
 */

test.describe("pdf conversions — real output", () => {
  test("split-pdf extracts the selected pages", async ({ page }) => {
    await page.goto("/split-pdf");
    await uploadFixture(page, await SAMPLES.pdf());

    await expect(page.getByRole("button", { name: "Select all", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Deselect all" }).click();

    // Pick two pages; the action label reflects the live selection count.
    await page.getByRole("button", { name: /^Page 1(,|$)/ }).first().click();
    await page.getByRole("button", { name: /^Page 3(,|$)/ }).first().click();

    const action = primaryAction(page, /Extract 2 pages/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `split failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 2 });
  });

  test("merge-pdf concatenates both documents", async ({ page }) => {
    const a = await sample("sample-doc.pdf", "application/pdf");
    // Distinct names so the merge list shows two entries rather than one.
    const b = { ...a, name: "second-doc.pdf" };

    await page.goto("/merge-pdf");
    await uploadFixture(page, [{ ...a, name: "first-doc.pdf" }, b]);

    await primaryAction(page, /Merge PDFs/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `merge failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    // 5 + 5 — the whole point of the tool.
    await assertPdf(bytes, { pages: 10 });
  });

  test("images-to-pdf assembles one page per image", async ({ page }) => {
    const jpg = await SAMPLES.jpg();
    await page.goto("/images-to-pdf");
    await uploadFixture(page, [
      { ...jpg, name: "cover-page.jpg" },
      { ...jpg, name: "diagram-01.jpg" },
      { ...jpg, name: "appendix.jpg" },
    ]);

    // The assembly strip is shared with merge-pdf; each card is one output page.
    await expect(page.getByText(/DRAG TO REORDER · 3 IMAGES · 3 PAGES/)).toBeVisible({
      timeout: 60_000,
    });

    await primaryAction(page, /^Create PDF$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const info = await assertPdf(bytes, { pages: 3 });
    // A4 portrait by default — the images must not have flipped the page box.
    for (const size of info.sizes) {
      expect(size.height).toBeGreaterThan(size.width);
    }
  });

  test("compress-pdf returns a valid document with every page intact", async ({ page }) => {
    const pdf = await SAMPLES.pdf();
    await page.goto("/compress-pdf");
    await uploadFixture(page, pdf); // compression starts on drop

    const dl = downloadAffordance(page);
    await expect(dl, `compress failed: ${await toolError(page)}`).toBeVisible({ timeout: 120_000 });
    const { bytes } = await captureDownload(page, dl);

    // Compression must never silently drop pages, whatever it does to size.
    await assertPdf(bytes, { pages: 5 });
  });

  test("pdf-to-jpg rasterises every page", async ({ page }) => {
    await page.goto("/pdf-to-jpg");
    await uploadFixture(page, await SAMPLES.pdf());

    await primaryAction(page, /Convert to images/).click();

    const zipButton = page.getByRole("button", { name: /Download all \(ZIP\)/ });
    await expect(zipButton, `rasterise failed: ${await toolError(page)}`)
      .toBeVisible({ timeout: 150_000 });
    const { bytes } = await captureDownload(page, zipButton);

    const names = await assertZip(bytes, { minEntries: 5 });
    expect(names.length, "one image per page").toBe(5);

    // Every entry must be a real JPEG, not an empty or truncated blob.
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    for (const name of names) {
      const entry = await zip.files[name].async("nodebuffer");
      assertJpeg(entry);
      expect(entry.length, `${name} should carry real pixels`).toBeGreaterThan(2000);
    }
  });

  test("rotate-pdf writes the rotation into the page tree", async ({ page }) => {
    await page.goto("/rotate-pdf");
    await uploadFixture(page, await SAMPLES.pdf());

    const selectAll = page.getByRole("button", { name: "Select all", exact: true });
    await expect(selectAll).toBeVisible({ timeout: 60_000 });
    await selectAll.click();

    const action = primaryAction(page, /Rotate 5 pages/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `rotate failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const info = await assertPdf(bytes, { pages: 5 });
    // Default rotation is 90° clockwise; a no-op would leave every angle at 0.
    expect(info.rotations.every((angle) => angle % 360 !== 0)).toBe(true);
  });

  test("rotate-pdf honours an INHERITED /Rotate", async ({ page }) => {
    /*
      /Rotate is an inheritable page attribute. MuPDF's findPage() returns the
      raw page dict, so a value living on the /Pages node reads as null there
      and the rotation used to silently no-op — the user got a "rotated" file
      that was byte-for-byte the same orientation.
    */
    const { PDFDocument, PDFName, PDFNumber } = await import("pdf-lib");
    type PDFDict = import("pdf-lib").PDFDict;
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const pagesDict = doc.context.lookup(
      doc.catalog.get(PDFName.of("Pages"))!,
    ) as PDFDict;
    pagesDict.set(PDFName.of("Rotate"), PDFNumber.of(90));

    await page.goto("/rotate-pdf");
    await uploadFixture(page, {
      name: "inherited-rotate.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await doc.save()),
    });

    const action = primaryAction(page, /Rotate 2 pages/);
    await expect(action).toBeVisible({ timeout: 60_000 });
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `rotate failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    // 90 (inherited) + 90 (requested) = 180 on every page.
    const info = await assertPdf(bytes, { pages: 2 });
    expect(info.rotations).toEqual([180, 180]);
  });

  test("add-page-numbers stamps each page", async ({ page }) => {
    await page.goto("/add-page-numbers");
    await uploadFixture(page, await SAMPLES.pdf());

    await primaryAction(page, /Add page numbers/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `numbering failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    const info = await assertPdf(bytes, { pages: 5 });
    // Stamping embeds a font and adds content streams, so the file must grow.
    const source = (await SAMPLES.pdf()).buffer;
    expect(info.pages).toBe(5);
    expect(bytes.length).toBeGreaterThan(source.length);
  });

  test("split and merge carry the document title and author", async ({ page }) => {
    /*
      All three grafting tools (split, merge, reorder) build a fresh
      PDFDocument and copy pages in, which used to leave the trailer empty and
      silently drop /Info — on tools whose own FAQ promises the title and
      author survive.
    */
    const { PDFDocument } = await import("pdf-lib");
    const build = async (title: string, pages: number) => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < pages; i++) doc.addPage([300, 300]);
      doc.setTitle(title);
      doc.setAuthor("Audit Author");
      return Buffer.from(await doc.save());
    };
    const readMeta = async (bytes: Buffer) => {
      const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
      return { title: doc.getTitle(), author: doc.getAuthor() };
    };

    await page.goto("/split-pdf");
    await uploadFixture(page, {
      name: "titled.pdf",
      mimeType: "application/pdf",
      buffer: await build("Audit Title Here", 4),
    });
    await expect(page.getByText(/4 PAGES/).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await primaryAction(page, /Extract 4 pages/).click();

    let dl = downloadAffordance(page);
    await expect(dl, `split failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    expect(await readMeta((await captureDownload(page, dl)).bytes)).toEqual({
      title: "Audit Title Here",
      author: "Audit Author",
    });

    // A merge has no single authoritative title, so the FIRST file's wins.
    await page.goto("/merge-pdf");
    await uploadFixture(page, [
      { name: "first.pdf", mimeType: "application/pdf", buffer: await build("Audit Title Here", 2) },
      { name: "second.pdf", mimeType: "application/pdf", buffer: await build("Second Doc", 1) },
    ]);
    await primaryAction(page, /Merge PDFs/).click();

    dl = downloadAffordance(page);
    await expect(dl, `merge failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    expect((await readMeta((await captureDownload(page, dl)).bytes)).title).toBe(
      "Audit Title Here",
    );
  });

  test("add-page-numbers counter-rotates the stamp on a rotated page", async ({ page }) => {
    /*
      `loadPage().getBounds()` is the VISUAL rect, but the stamp is appended to
      the page's UNROTATED content stream. Without the inverse matrix the
      number was centred on 842 inside a 595-wide media box — outside the page
      and drawn sideways.
    */
    const { PDFDocument, PDFName, PDFNumber } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).node.set(PDFName.of("Rotate"), PDFNumber.of(90));

    await page.goto("/add-page-numbers");
    await uploadFixture(page, {
      name: "rotated.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await doc.save()),
    });
    await primaryAction(page, /Add page numbers/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `numbering failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    // Content streams are Flate-compressed by saveToBuffer("compress").
    const zlib = await import("node:zlib");
    let text = bytes.toString("latin1");
    const re = /stream\r?\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length;
      const end = text.indexOf("endstream", start);
      if (end < 0) continue;
      try {
        text += "\n" + zlib.inflateSync(bytes.subarray(start, end)).toString("latin1");
      } catch {
        /* not a Flate stream */
      }
    }
    // w is the UNROTATED width (595), and x stays centred on the visual 842.
    expect(text).toContain("0 1 -1 0 595 0 cm");
    expect(text).toMatch(/418\.\d+ 20 Td/);
  });

  test("pdf-page-reorder saves a reordered document", async ({ page }) => {
    await page.goto("/pdf-page-reorder");
    await uploadFixture(page, await SAMPLES.pdf());

    // Reorder tiles are listbox options, not buttons — `PageTile` only renders
    // a <button> when it takes an onClick — so they're addressed by aria-label.
    const first = page.locator('[aria-label="Page 1, position 1 of 5"]');
    await expect(first).toBeVisible({ timeout: 90_000 });

    // The deck uses HTML5 drag-and-drop; drop page 1 onto page 4's slot.
    await first.dragTo(page.locator('[aria-label="Page 4, position 4 of 5"]'));

    // Order changed → the header flips and the reorder becomes saveable.
    // Scoped to the tool surface: the page's FAQ copy repeats the phrase.
    await expect(page.locator("[data-tool-surface]").getByText("ORDER CHANGED")).toBeVisible();

    await primaryAction(page, /Save Reordered PDF/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `reorder failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 5 });
  });
});
