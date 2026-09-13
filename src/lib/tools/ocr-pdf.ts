import { PDFDocument } from "pdf-lib";

import { encodePageCanvas, loadPdfjsDocument, renderPageFromDoc } from "./pdf-engine";
import { openOcrSession, type OcrSession } from "./ocr";
import { addOcrTextLayer, type OcrWord, type PageWords } from "./pdf-ocr-layer";

/**
 * `ocr-pdf` — make a scanned PDF searchable without changing how it looks.
 *
 * THE JOIN, and nothing more: every piece was already here. pdfjs renders each
 * page (the same path `/pdf-to-jpg` uses), the Tesseract session that shipped
 * with `/image-to-text` reads it, and `pdf-ocr-layer.ts` writes the words back
 * as invisible text. **Zero new engine bytes** — the 4.9 MB is already served,
 * already disclosed and already in an offline bundle.
 *
 * ⚠ THE ORIGINAL PAGES ARE NEVER REBUILT. The layer is appended to each page's
 * existing content stream, so the scan's own image, its compression and any
 * vector art are exactly the bytes that arrived. That distinguishes this from
 * the obvious shortcut — Tesseract's own PDF renderer, which is compiled into
 * the core we already serve — whose `AddImage` reconstructs the page FROM THE
 * RASTER. That would silently replace the document with a picture of itself at
 * whatever DPI we happened to choose, which is precisely the claim this tool
 * exists to be able to make.
 */

/**
 * Render scale, and why it is not the repo's usual one.
 *
 * pdfjs's `getViewport({ scale })` gives `scale` pixels per PDF point, and a
 * point is 1/72 inch, so DPI = 72 × scale. Every other caller in this repo
 * renders for a HUMAN — 0.3 for thumbnails (21.6 dpi), 2 for `/pdf-to-jpg`
 * (144 dpi). Tesseract wants roughly 300 dpi and degrades sharply below about
 * 200, so leaving the default on would produce a searchable layer full of
 * plausible nonsense.
 *
 * 300 dpi puts an A4 page at about 8.7 megapixels. That is the cost of the
 * tool, and it is why the page gate below exists.
 */
const OCR_SCALE = 300 / 72;

/**
 * How many pages this will attempt.
 *
 * The plan asked for a page-count gate and named no number, so here is one
 * with a reason rather than a round figure: at ~300 dpi a page is several
 * seconds of wasm, and the whole run holds one 8.7-megapixel raster plus the
 * language model in memory at a time. Fifty pages is a long wait a visitor can
 * watch progress through; several hundred is a tab that appears to hang and
 * may not survive. The tool REFUSES above this rather than starting work it
 * probably cannot finish — the refusal names the count, so it is never a
 * mystery.
 */
export const MAX_OCR_PAGES = 50;

export interface OcrPdfPage {
  readonly pageNumber: number;
  /** Tesseract's mean confidence for the page, 0–100. */
  readonly confidence: number;
  /** How many words were placed. Zero means the page yielded nothing. */
  readonly words: number;
}

export interface OcrPdfResult {
  readonly bytes: Uint8Array;
  readonly pages: readonly OcrPdfPage[];
  /** Pages OCR found no text on at all — named to the user, never hidden. */
  readonly emptyPages: readonly number[];
  /** Total words placed across the document. */
  readonly wordCount: number;
}

export interface OcrPdfProgress {
  readonly page: number;
  readonly pageCount: number;
  /** 0–1 across the whole document, not per page. */
  readonly fraction: number;
  readonly phase: string;
}

export class TooManyPagesError extends Error {
  constructor(readonly pageCount: number) {
    super(
      `This PDF has ${pageCount} pages, and OCR is limited to ${MAX_OCR_PAGES}. ` +
        `Split it first and run the parts separately.`,
    );
    this.name = "TooManyPagesError";
  }
}

/** Tesseract's box is `{x0,y0,x1,y1}` in raster pixels; so is `OcrWord`. */
const toWord = (w: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }): OcrWord => ({
  text: w.text,
  x0: w.bbox.x0,
  y0: w.bbox.y0,
  x1: w.bbox.x1,
  y1: w.bbox.y1,
});

export async function ocrPdf(
  data: ArrayBuffer | Uint8Array,
  options: {
    onProgress?: (progress: OcrPdfProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<OcrPdfResult> {
  const { onProgress, signal } = options;

  /*
    Two views of the same bytes, deliberately. pdfjs RENDERS (it is the only
    one of the two that can) and pdf-lib WRITES. Loading twice costs a parse
    and buys the property the whole tool rests on: the document pdf-lib saves
    is the one that arrived, not one reconstructed from what pdfjs drew.
  */
  const source = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await PDFDocument.load(source.slice(), { ignoreEncryption: false });
  const pageCount = doc.getPageCount();
  if (pageCount > MAX_OCR_PAGES) throw new TooManyPagesError(pageCount);

  const pdfjsDoc = await loadPdfjsDocument(source.slice());

  let session: OcrSession | null = null;
  const perPage: PageWords[] = [];
  const pages: OcrPdfPage[] = [];
  const emptyPages: number[] = [];

  try {
    session = await openOcrSession();

    for (let i = 1; i <= pageCount; i += 1) {
      // Cooperative cancel BETWEEN pages. `recognize` is one call into wasm
      // with no yield point, so a page in flight cannot be interrupted — and
      // claiming otherwise would be the dishonest option.
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const canvas = await renderPageFromDoc(pdfjsDoc, i, OCR_SCALE);
      const blob = await encodePageCanvas(canvas, i, "image/png", 1);

      const recognised = await session.recognize(blob, {
        words: true,
        onProgress: ({ phase, fraction }) =>
          onProgress?.({
            page: i,
            pageCount,
            // Page-relative progress folded into a document-wide figure, so a
            // 40-page bar does not restart forty times.
            fraction: (i - 1 + Math.min(Math.max(fraction, 0), 1)) / pageCount,
            phase,
          }),
      });

      const words = recognised.words.filter((w) => w.text.trim().length > 0).map(toWord);
      if (words.length === 0) emptyPages.push(i);
      pages.push({ pageNumber: i, confidence: recognised.confidence, words: words.length });
      perPage.push({
        page: doc.getPage(i - 1),
        words,
        raster: { width: canvas.width, height: canvas.height },
      });

      // Release the raster before the next one is allocated. An 8.7-megapixel
      // canvas is ~35 MB of backing store and the pool keeps no reference.
      canvas.width = 0;
      canvas.height = 0;
    }

    const wordCount = addOcrTextLayer(doc, perPage);
    const bytes = await doc.save();
    return { bytes, pages, emptyPages, wordCount };
  } finally {
    // Both are expensive and both must go even when a page threw.
    await session?.close();
    await pdfjsDoc.destroy?.();
  }
}
