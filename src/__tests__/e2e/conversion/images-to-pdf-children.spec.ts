import { test, expect } from "@playwright/test";
import { animatedWebp, multiPageTiff, tinyJpg, tinyPng, tinyWebp } from "../fixtures";
import {
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  toolError,
} from "./support";
import { assertPdf, assertWebp } from "./validators";

/**
 * The images→PDF format children (jpg/png/webp/tiff-to-pdf) share the parent
 * engine but add a per-file prep pass (`images-to-pdf-prep.ts`): JPEG/PNG
 * bytes pass through untouched, everything else is decoded and re-encoded
 * (PNG when transparent, JPEG at 0.92 when opaque), and every TIFF page
 * becomes its own PDF page. The prep runs at ADD time, so page counts and
 * frame notices are asserted on the assembly strip BEFORE Create PDF runs.
 *
 * heic-to-pdf has no Node-buildable fixture (nothing encodes HEIC in pure
 * JS), so its coverage is the all-tools page smoke plus the shared prep path
 * these specs exercise.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i,
 * so titles say "animated image" — these cases must run in BOTH engines.
 */

const FIRST_FRAME_RE = /only its first frame was kept/;

test.describe("images-to-pdf format children — real output", () => {
  test("tiff-to-pdf turns every page of a multi-page scan into a PDF page", async ({ page }) => {
    const fixture = multiPageTiff(3);
    await page.goto("/tiff-to-pdf");
    await uploadFixture(page, fixture);

    // Prep runs at add time: one card on the strip, three pages behind it,
    // before the primary action is ever pressed.
    await expect(page.getByText(/DRAG TO REORDER · 1 IMAGE · 3 PAGES/)).toBeVisible({
      timeout: 60_000,
    });

    await primaryAction(page, /^Create PDF$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { bytes } = await captureDownload(page, dl);

    // The differentiator of this child: 3 TIFF pages → 3 PDF pages.
    await assertPdf(bytes, { pages: 3 });
  });

  test("webp-to-pdf re-encodes a still image into a one-page PDF", async ({ page }) => {
    await page.goto("/webp-to-pdf");
    await uploadFixture(page, tinyWebp());

    await expect(page.getByText(/DRAG TO REORDER · 1 IMAGE · 1 PAGE/)).toBeVisible({
      timeout: 60_000,
    });
    // A still image must not trigger the frame-0 notice.
    await expect(page.getByText(FIRST_FRAME_RE)).toHaveCount(0);

    await primaryAction(page, /^Create PDF$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { bytes } = await captureDownload(page, dl);

    const info = await assertPdf(bytes, { pages: 1 });
    // The opaque half of the re-encode policy: a lossy VP8 frame carries no
    // alpha, so it lands in the PDF as a JPEG (DCTDecode), never a PNG.
    expect(info.text).toContain("DCTDecode");
  });

  test("webp-to-pdf keeps frame 0 of an animated image and says so", async ({ page }) => {
    const fixture = animatedWebp();
    // Byte-level proof the fixture is genuinely animated, so a green run can
    // never mean "the sniffer and the fixture are both duds".
    const info = assertWebp(fixture.buffer);
    expect(info.animated).toBe(true);
    expect(info.anmfCount).toBeGreaterThanOrEqual(2);

    await page.goto("/webp-to-pdf");
    await uploadFixture(page, fixture);

    // The notice appears at add time — before the PDF exists — because the
    // prep pass is what drops the other frames.
    await expect(
      page.getByText("This WebP is animated — only its first frame was kept.", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    await primaryAction(page, /^Create PDF$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { bytes } = await captureDownload(page, dl);

    // Two ANMF frames in, one page out.
    await assertPdf(bytes, { pages: 1 });
  });

  test("jpg-to-pdf assembles two photos into a two-page portrait A4 document", async ({
    page,
  }) => {
    const jpg = tinyJpg();
    await page.goto("/jpg-to-pdf");
    await uploadFixture(page, [
      { ...jpg, name: "front.jpg" },
      { ...jpg, name: "back.jpg" },
    ]);

    await expect(page.getByText(/DRAG TO REORDER · 2 IMAGES · 2 PAGES/)).toBeVisible({
      timeout: 60_000,
    });

    await primaryAction(page, /^Create PDF$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { bytes } = await captureDownload(page, dl);

    const info = await assertPdf(bytes, { pages: 2 });
    // Default page size is portrait A4 — 595.28 × 841.89 pt.
    for (const size of info.sizes) {
      expect(size.width).toBeCloseTo(595.28, 1);
      expect(size.height).toBeCloseTo(841.89, 1);
    }
    // Passthrough evidence: JPEG bytes embed via DCTDecode, not a re-encode.
    expect(info.text).toContain("DCTDecode");
  });

  test("png-to-pdf embeds a PNG losslessly into a one-page PDF", async ({ page }) => {
    await page.goto("/png-to-pdf");
    await uploadFixture(page, tinyPng());

    await expect(page.getByText(/DRAG TO REORDER · 1 IMAGE · 1 PAGE/)).toBeVisible({
      timeout: 60_000,
    });

    await primaryAction(page, /^Create PDF$/).click();

    const dl = downloadAffordance(page);
    await expect(dl, `assembly failed: ${await toolError(page)}`).toBeVisible({
      timeout: 90_000,
    });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 1 });
  });
});
