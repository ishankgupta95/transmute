import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  sample,
  uploadFixture,
  downloadAffordance,
  captureDownload,
  toolError,
} from "./support";
import { assertPdf, assertJpeg } from "./validators";
import { IMAGE_MAE, compareImages, expectSameImage } from "./fidelity";

/**
 * `recompress-pdf-images` — the explicitly lossy PDF image compressor.
 *
 * It re-encodes the JPEGs inside a document at a lower quality (and, chasing a
 * size ceiling, at smaller dimensions) and leaves everything it cannot safely
 * touch exactly where it found it. Both halves of that are asserted here
 * against the BYTES that come back: the photo's stream must be a real, smaller
 * JPEG, and the three images the tool is supposed to refuse must be
 * byte-identical to the ones in the fixture. A tool that renders a Download
 * over an untouched file, or that "compressed" a transparency mask into
 * nonsense, fails here rather than looking fine.
 *
 * The fixture is `sample-photo-doc.pdf` from `scripts/generate-test-fixtures.mjs`,
 * built for exactly this tool — four A4 pages, ONE 800 × 600 DCTDecode photo
 * shared across all four, plus a FlateDecode PNG and a second PNG carrying a
 * DeviceGray /SMask. So: four image XObjects, one eligible, two distinct skip
 * reasons, and 6,909 bytes of image data the tool must never rewrite.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i,
 * and every case here must run in BOTH engines — the tool is pdf-lib plus a
 * canvas round-trip, with no Chromium-only dependency — so no title may
 * contain those words.
 *
 * WHY THE NUMBERS BELOW ARE WHAT THEY ARE. Safari's JPEG encoder is far less
 * aggressive than Chromium's, and the same picture at the same quality comes
 * out roughly twice the size. Measured on this exact fixture's photo, through
 * `createImageBitmap` + `OffscreenCanvas.convertToBlob` in each engine:
 *
 *      quality    Chromium    WebKit     (source stream: 54,591 B)
 *      0.75       28,671 B    58,847 B   ← WebKit GROWS it; never-grow fires
 *      0.60       22,009 B    42,547 B
 *      0.45       18,591 B    28,807 B
 *      0.30       15,013 B    20,141 B
 *      0.05        5,830 B    15,710 B
 *
 * Every threshold here is chosen to hold on the WebKit column, and the
 * high-quality preset is deliberately not the one these tests run at: on
 * WebKit it re-encodes LARGER than the source, so the per-image never-grow
 * guard leaves the photo alone and the honest output is the original file.
 */

/**
 * The photo-heavy fixture, loaded through `support.ts`'s own reader. It is not
 * added to the shared `SAMPLES` map because this is the only spec that feeds
 * it to anything.
 */
const photoPdf = () => sample("sample-photo-doc.pdf", "application/pdf");

/** The fixture's own shape, from `buildPhotoPdf()` in the fixture generator. */
const FIXTURE = {
  pages: 4,
  bytes: 64_364,
  /** The one eligible image: 800 × 600, DCTDecode, DeviceRGB, 8 bpc. */
  photoStream: 54_591,
  /** The three FlateDecode streams the tool must refuse, summed. */
  skippedStreams: 4_099 + 2_780 + 30,
};

/**
 * The rail's primary action.
 *
 * Deliberately a description rather than a literal label: the contract fixes
 * the tool's name and its two modes, not the verb on its button. The
 * alternation cannot collide with the download (`Download <file>-recompressed.pdf`
 * — "recompressed" has no word boundary after "recompress"), with either mode
 * switch ("Quality", "Target size"), with a preset, or with the reset link.
 */
const RUN = /\b(recompress|compress|shrink|run)\b/i;

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/**
 * Run the tool over the already-loaded file and return the produced bytes.
 *
 * `PdfResizerUI` — the component this tool's UI is modelled on — waits to be
 * told to run, so the run button is the expected path; the `.or()` is there so
 * a tool that starts on drop still works. Preferring the button matters for
 * more than tidiness: after a control changes, clicking it is what makes the
 * captured bytes the CURRENT settings' output rather than the previous run's.
 */
async function runAndCapture(
  page: Page,
  timeout = 180_000,
): Promise<{ name: string; bytes: Buffer }> {
  const run = surfaceOf(page).getByRole("button", { name: RUN }).first();
  const dl = downloadAffordance(page);

  await expect(
    run.or(dl).first(),
    `the tool offered neither a run button nor a download: ${await toolError(page)}`,
  ).toBeVisible({ timeout: 90_000 });

  if ((await run.count()) > 0) {
    await expect(run).toBeEnabled({ timeout: 60_000 });
    await run.click();
  }

  await expect(dl, `recompression failed: ${await toolError(page)}`).toBeVisible({ timeout });
  return captureDownload(page, dl);
}

/** Load the tool with the photo fixture and pick a quality preset. */
async function openWithPreset(page: Page, preset: RegExp): Promise<void> {
  await page.goto("/recompress-pdf-images");
  await uploadFixture(page, await photoPdf());

  const surface = surfaceOf(page);
  // Quality is one of the two modes the contract fixes; select it explicitly
  // rather than trusting whichever one the tool opens on.
  const quality = surface.getByRole("button", { name: /^quality$/i });
  await expect(
    quality,
    "the tool must offer a Quality mode alongside the size ceiling",
  ).toBeVisible({ timeout: 60_000 });
  await quality.click();

  const button = surface.getByRole("button", { name: preset });
  await expect(
    button,
    `the Quality mode must offer the presets from PDF_IMAGE_QUALITY_PRESETS (looking for ${preset})`,
  ).toBeVisible({ timeout: 60_000 });
  await button.click();
}

// ────────────────────────────────────────────────────────────────────────────
// Reading the produced document
// ────────────────────────────────────────────────────────────────────────────

interface DocImage {
  /** `/DCTDecode`, `/FlateDecode`, … as written in the dictionary. */
  filter: string;
  colorSpace: string;
  width: number;
  height: number;
  bytes: Buffer;
  digest: string;
}

/** Every image XObject in a document, whichever page draws it. */
async function imagesIn(bytes: Buffer): Promise<DocImage[]> {
  const { PDFDocument, PDFName, PDFNumber, PDFRawStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  const number = (dict: import("pdf-lib").PDFDict, key: string): number => {
    const value = dict.get(PDFName.of(key));
    return value instanceof PDFNumber ? value.asNumber() : NaN;
  };

  const out: DocImage[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (String(object.dict.get(PDFName.of("Subtype"))) !== "/Image") continue;
    const contents = Buffer.from(object.getContents());
    out.push({
      filter: String(object.dict.get(PDFName.of("Filter")) ?? ""),
      colorSpace: String(object.dict.get(PDFName.of("ColorSpace")) ?? ""),
      width: number(object.dict, "Width"),
      height: number(object.dict, "Height"),
      bytes: contents,
      digest: createHash("sha256").update(contents).digest("hex"),
    });
  }
  return out;
}

const photosIn = (images: DocImage[]) => images.filter((i) => i.filter === "/DCTDecode");
const refusedIn = (images: DocImage[]) => images.filter((i) => i.filter !== "/DCTDecode");

/**
 * The assertions every produced document has to satisfy, whatever mode made
 * it: still four pages, still four images, the photo is a genuine JPEG the
 * dictionary describes correctly, and every refused image is the same bytes it
 * arrived as.
 */
async function assertRecompressed(
  page: Page,
  produced: Buffer,
  source: Buffer,
  /** Pixel-error ceiling for the photo; layout and colour cast stay strict. */
  maxMae: number = IMAGE_MAE.heavy,
): Promise<{ photo: DocImage }> {
  await assertPdf(produced, { pages: FIXTURE.pages });

  const before = await imagesIn(source);
  const after = await imagesIn(produced);

  /*
    The fixture's own numbers, re-read on every run. Every threshold in this
    file was measured against these exact streams, so a regenerated fixture has
    to fail here — loudly, and pointing at the table in the header — rather
    than quietly making a size assertion easier or impossible to satisfy.
  */
  expect(source.length, "sample-photo-doc.pdf is not the file these tests were measured against")
    .toBe(FIXTURE.bytes);
  expect(photosIn(before).map((i) => i.bytes.length)).toEqual([FIXTURE.photoStream]);
  expect(refusedIn(before).reduce((total, i) => total + i.bytes.length, 0)).toBe(
    FIXTURE.skippedStreams,
  );

  // Four in, four out. A per-PAGE implementation would re-encode the shared
  // photo once per page and write four copies of it.
  expect(after, "the document must still hold exactly its four images").toHaveLength(
    before.length,
  );

  const photos = photosIn(after);
  expect(photos, "exactly one DCTDecode image, as in the fixture").toHaveLength(1);
  const photo = photos[0];

  // A real JPEG, not merely bytes wearing /DCTDecode: SOI and EOI markers.
  assertJpeg(photo.bytes);
  // A canvas round-trip always returns sRGB, so the dictionary has to say so —
  // a stream left claiming its source colour space renders as garbage.
  expect(photo.colorSpace).toBe("/DeviceRGB");
  expect(photo.width).toBeGreaterThan(0);
  expect(photo.height).toBeGreaterThan(0);

  // …and still the SAME photo: a re-encode may lose detail, not turn, mirror,
  // recolour or swap the picture. Heavy ceiling — shrinking it is the point.
  expectSameImage(
    await compareImages(page, { bytes: photosIn(before)[0].bytes, mime: "image/jpeg" }, { bytes: photo.bytes, mime: "image/jpeg" }),
    { maxMae, label: "recompressed photo vs the original stream" },
  );

  // The refusal, stated as bytes. `sample-photo-doc.pdf` carries a FlateDecode
  // PNG and a PNG plus its DeviceGray /SMask; all three must come through
  // untouched, because re-encoding a mask or a non-JPEG through a JPEG encoder
  // is how a page loses its transparency or its colours.
  expect(refusedIn(after).map((i) => i.digest).sort()).toEqual(
    refusedIn(before).map((i) => i.digest).sort(),
  );

  return { photo };
}

/**
 * Read a `StatStrip` cell by its mono label — the `.locator("..")` idiom
 * `pdf-pages.spec.ts` uses, scoped to the tool surface because the page's own
 * FAQ copy quotes these words.
 */
async function statValue(page: Page, label: string): Promise<string> {
  const cell = surfaceOf(page).getByText(label, { exact: true }).first().locator("..");
  const text = (await cell.textContent()) ?? "";
  return text.slice(label.length).trim();
}

// ────────────────────────────────────────────────────────────────────────────

test.describe("recompress-pdf-images — real output", () => {
  test("re-encodes the photo and leaves the other images exactly as they were", async ({
    page,
  }) => {
    const source = (await photoPdf()).buffer;
    await openWithPreset(page, /^medium\b/i);

    const { name, bytes } = await runAndCapture(page);

    expect(name).toBe("sample-photo-doc-recompressed.pdf");
    const { photo } = await assertRecompressed(page, bytes, source);

    // The point of the tool. WebKit's weakest column still lands 22% under the
    // source stream, so 10% is a floor no working implementation can miss and
    // no no-op can reach.
    expect(
      photo.bytes.length,
      `the photo must come back smaller (was ${FIXTURE.photoStream} B)`,
    ).toBeLessThan(FIXTURE.photoStream * 0.9);
    expect(bytes.length).toBeLessThan(source.length);

    // A quality run must not resize anything — the contract's scale is 1 here,
    // and silently shrinking the picture is a different operation from the one
    // the user asked for.
    expect(photo.width).toBe(800);
    expect(photo.height).toBe(600);

    // ── The disclosure, which is mandatory and must be on screen ──
    /*
      Skipped images are a feature of this tool, not an omission, so they have
      to be visible rather than merely counted somewhere.

      Every locator here is anchored on THIS DOCUMENT'S numbers, and that is the
      whole design of the block. The rail already explains in general terms what
      the tool refuses — "Flate/PNG-style images … anything carrying a
      transparency mask" — so a search of the surface for "flate" or "mask"
      passes against a build that reports nothing at all about the file in front
      of the user. Pinning "3 of 4" first, then asserting the reasons INSIDE
      that element, is what makes this a report rather than a disclaimer.
    */
    const surface = surfaceOf(page);
    await expect(
      surface.getByText("IMAGES", { exact: true }).first(),
      "the StatStrip must carry an IMAGES cell",
    ).toBeVisible();
    expect(
      await statValue(page, "IMAGES"),
      "the IMAGES stat must say how many of the document's images were touched",
    ).toMatch(/^1\s+of\s+4$/i);

    const disclosure = surface
      .getByText(/\b3\s+of\s+4\b/i)
      .filter({ hasText: /untouched|skipped|left|not re-?compressed/i })
      .first();
    await expect(
      disclosure,
      "the three skipped images must be reported on screen, by count",
    ).toBeVisible();
    // And their reasons, in the same breath as the count: one is the wrong
    // format, two are tangled up with a transparency mask. A user who is told
    // "3 were skipped" and not why has been given a number, not an answer.
    await expect(
      disclosure,
      "the non-JPEG image's filter must be named, so the count is actionable",
    ).toContainText(/flate|not (a )?jpeg/i);
    await expect(
      disclosure,
      "the masked pair must be disclosed as a mask, not as a format problem",
    ).toContainText(/mask|transparen/i);
  });

  test("a lower quality preset really does produce a smaller file", async ({ page }) => {
    /*
      That the control is WIRED — the one thing a single run cannot show. Each
      run starts from a fresh page load so neither can be satisfied by the
      other's stale output.

      Both presets recompress in both engines (medium: 22,009 B on Chromium,
      42,547 B on WebKit; low: 18,591 B and 28,807 B), so the comparison is
      between two real re-encodes rather than between a re-encode and a
      never-grow refusal. The smallest measured gap is 3.4 KB, on Chromium.
    */
    await openWithPreset(page, /^medium\b/i);
    const medium = await runAndCapture(page);

    await openWithPreset(page, /^low\b/i);
    const low = await runAndCapture(page);

    const source = (await photoPdf()).buffer;
    const mediumPhoto = photosIn(await imagesIn(medium.bytes))[0];
    const lowPhoto = photosIn(await imagesIn(low.bytes))[0];

    expect(lowPhoto.bytes.length).toBeLessThan(mediumPhoto.bytes.length);
    expect(low.bytes.length).toBeLessThan(medium.bytes.length);
    expect(medium.bytes.length).toBeLessThan(source.length);
    // Both are still real JPEGs inside real documents.
    assertJpeg(lowPhoto.bytes);
    await assertPdf(low.bytes, { pages: FIXTURE.pages });
  });

  test("lands under a size ceiling, over the file already on the page", async ({ page }) => {
    const source = (await photoPdf()).buffer;
    await page.goto("/recompress-pdf-images");
    await uploadFixture(page, await photoPdf());

    const surface = surfaceOf(page);
    const targetMode = surface.getByRole("button", { name: /^target size$/i });
    await expect(
      targetMode,
      "the tool must offer a size ceiling alongside the quality presets",
    ).toBeVisible({ timeout: 60_000 });
    await targetMode.click();

    // Switching modes keeps the loaded PDF — the idiom pdf-resizer established,
    // and the reason this page is worth using twice in a row.
    await expect(surface.getByText("sample-photo-doc.pdf").first()).toBeVisible();

    const kb = surface.locator('input[type="number"]').first();
    await expect(kb, "target mode needs a KB field").toBeVisible();
    // 32 KB is half the fixture. Chromium reaches it at quality ≈ 0.45 and
    // WebKit at ≈ 0.3, both at full dimensions, so neither engine has to fall
    // back on scaling to satisfy this.
    await kb.fill("32");
    await expect(kb).toHaveValue("32");

    const { bytes } = await runAndCapture(page);

    expect(
      bytes.length,
      "a ceiling the tool reported as met must actually hold in the bytes",
    ).toBeLessThanOrEqual(32 * 1024);
    const { photo } = await assertRecompressed(page, bytes, source);
    // Whether or not it needed to scale, it may never grind the picture away:
    // MIN_LONGEST_SIDE is 64, and the source is 800 × 600.
    expect(photo.width).toBeGreaterThanOrEqual(64);
    expect(photo.width).toBeLessThanOrEqual(800);
  });

  test("says a ceiling it cannot reach was missed, and hands back the closest it managed", async ({
    page,
  }) => {
    /*
      The honesty path, and the one this fixture makes unfalsifiable: 4 KB is
      arithmetically impossible for this document at ANY quality or scale,
      because the three images the tool refuses to touch are 6,909 bytes on
      their own before a single page or the photo is counted. So the only
      correct behaviour is to say the target was missed and offer the smallest
      build it managed — never a "success" over a file that is nowhere near it,
      and never an error page over a document it did shrink.
    */
    expect(
      FIXTURE.skippedStreams,
      "the refused images alone must exceed the ceiling for this test to mean anything",
    ).toBeGreaterThan(4 * 1024);

    const source = (await photoPdf()).buffer;
    await page.goto("/recompress-pdf-images");
    await uploadFixture(page, await photoPdf());

    const surface = surfaceOf(page);
    const targetMode = surface.getByRole("button", { name: /^target size$/i });
    await expect(targetMode).toBeVisible({ timeout: 60_000 });
    await targetMode.click();

    const kb = surface.locator('input[type="number"]').first();
    await kb.fill("4");
    await expect(kb).toHaveValue("4");

    const { bytes } = await runAndCapture(page);

    // The closest achievable size is a real, valid, smaller document.
    expect(bytes.length).toBeGreaterThan(4 * 1024);
    expect(bytes.length).toBeLessThan(source.length);
    // An unreachable target squeezes as far as it can: measured 2026-11-11 at
    // MAE 14.2 with correlation 0.972 and no colour cast (|bias| < 1.2) — the
    // same picture, heavily degraded. 20 allows that; a wrong, turned or
    // recoloured photo still fails on correlation and bias.
    await assertRecompressed(page, bytes, source, 20);

    /*
      And it must SAY so. The wording is the UI's; the claim is not optional.

      Both halves of the locator earn their place. The rail's own copy calls the
      number "a ceiling, not a promise" and warns that pages "carry a floor this
      tool cannot re-encode past" — so a bare search for a ceiling, or for a
      "cannot", passes against a build that reports nothing. Requiring a SIZE in
      the same element is what ties the sentence to this run: the rail's
      paragraph carries no figure, and this footnote has to carry two.
    */
    await expect(
      surface
        .getByText(
          /could ?n[o']?t reach|cannot reach|can[o']?t reach|did ?n[o']?t reach|not reached|could ?n[o']?t (be )?met|not (be )?met|closest/i,
        )
        .filter({ hasText: /\d[\d.]*\s*KB/i })
        .first(),
      "an unreachable target must be reported as unreachable, with the closest size it managed",
    ).toBeVisible();
  });
});
