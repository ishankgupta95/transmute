import { PDFDocument } from "pdf-lib";
import type * as MuPDF from "mupdf";

// ── MuPDF lazy loader ──────────────────────────────────────────────

let _mupdf: typeof MuPDF | null = null;

async function getMupdf(): Promise<typeof MuPDF> {
  if (_mupdf) return _mupdf;
  // Configure WASM location before mupdf initializes
  const basePath = (process.env.__NEXT_ROUTER_BASEPATH as string) || "";
  globalThis.$libmupdf_wasm_Module = {
    locateFile: (name: string) =>
      name.endsWith(".wasm") ? `${basePath}/mupdf-wasm.wasm` : name,
  };
  _mupdf = await import("mupdf");
  return _mupdf;
}

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

// ── Load / Info ────────────────────────────────────────────────────

export async function getPageCount(data: ArrayBuffer | Uint8Array): Promise<number> {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(toUint8Array(data), "application/pdf");
  const count = doc.countPages();
  doc.destroy();
  return count;
}

// ── Merge (mupdf) ──────────────────────────────────────────────────

export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const out = new mupdf.PDFDocument();

  let insertAt = 0;
  for (const buf of buffers) {
    const src = new mupdf.PDFDocument(toUint8Array(buf));
    const count = src.countPages();
    const graftMap = out.newGraftMap();
    for (let i = 0; i < count; i++) {
      graftMap.graftPage(insertAt++, src, i);
    }
    src.destroy();
  }

  const result = out.saveToBuffer("compress");
  const bytes = result.asUint8Array().slice();
  out.destroy();
  return bytes;
}

// ── Split (mupdf) ──────────────────────────────────────────────────

/** Extract specific pages (0-indexed) into a new PDF. */
export async function splitPdf(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const src = new mupdf.PDFDocument(toUint8Array(data));
  const out = new mupdf.PDFDocument();
  const graftMap = out.newGraftMap();

  for (let i = 0; i < pageIndices.length; i++) {
    graftMap.graftPage(i, src, pageIndices[i]);
  }

  const result = out.saveToBuffer("compress");
  const bytes = result.asUint8Array().slice();
  src.destroy();
  out.destroy();
  return bytes;
}

// ── Rotate (mupdf) ────────────────────────────────────────────────

/** Rotate specified pages by the given angle (90, 180, 270). */
export async function rotatePdfPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
  angle: number,
): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const doc = new mupdf.PDFDocument(toUint8Array(data));

  for (const idx of pageIndices) {
    if (idx >= 0 && idx < doc.countPages()) {
      const pageObj = doc.findPage(idx);
      const current = pageObj.get("Rotate")?.asNumber() ?? 0;
      pageObj.put("Rotate", doc.newInteger((current + angle) % 360));
    }
  }

  const result = doc.saveToBuffer("compress");
  const bytes = result.asUint8Array().slice();
  doc.destroy();
  return bytes;
}

// ── Reorder (mupdf) ───────────────────────────────────────────────

/** Reorder pages based on the given order (0-indexed). */
export async function reorderPdfPages(
  data: ArrayBuffer | Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const src = new mupdf.PDFDocument(toUint8Array(data));
  const out = new mupdf.PDFDocument();
  const graftMap = out.newGraftMap();

  for (let i = 0; i < newOrder.length; i++) {
    graftMap.graftPage(i, src, newOrder[i]);
  }

  const result = out.saveToBuffer("compress");
  const bytes = result.asUint8Array().slice();
  src.destroy();
  out.destroy();
  return bytes;
}

// ── Add Page Numbers (pdf-lib — creates content on existing pages) ─

export type PageNumberPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-center" | "top-right";

export async function addPageNumbers(
  data: ArrayBuffer | Uint8Array,
  position: PageNumberPosition = "bottom-center",
  startNumber: number = 1,
): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const doc = new mupdf.PDFDocument(toUint8Array(data));
  const font = new mupdf.Font("Helvetica");
  const fontObj = doc.addSimpleFont(font);
  const fontSize = 10;

  const count = doc.countPages();
  for (let i = 0; i < count; i++) {
    const pageObj = doc.findPage(i);
    const bounds = doc.loadPage(i).getBounds(); // [x0, y0, x1, y1]
    const width = bounds[2] - bounds[0];
    const text = String(startNumber + i);

    // Measure text width by summing glyph advances
    let textWidth = 0;
    for (const ch of text) {
      const gid = font.encodeCharacter(ch);
      textWidth += font.advanceGlyph(gid) * fontSize;
    }

    const isTop = position.startsWith("top");
    const y = isTop ? bounds[3] - 30 : bounds[1] + 20;
    let x: number;
    if (position.endsWith("left")) {
      x = bounds[0] + 40;
    } else if (position.endsWith("right")) {
      x = bounds[2] - 40 - textWidth;
    } else {
      x = bounds[0] + (width - textWidth) / 2;
    }

    // Escape parentheses in text for PDF string literal
    const escaped = text.replace(/([()\\])/g, "\\$1");
    const stream = `q BT /Fn ${fontSize} Tf ${x} ${y} Td (${escaped}) Tj ET Q`;

    // Ensure page has Resources > Font dict, add our font.
    // /Resources can be INHERITED from a parent Pages node — findPage returns the
    // raw page dict without resolving inheritance. Creating a fresh empty dict in
    // that case would shadow the inherited fonts/XObjects and visually corrupt the
    // page, so walk the /Parent chain and reuse the inherited Resources instead.
    let resources = pageObj.get("Resources");
    if (resources.isNull()) {
      let parent = pageObj.get("Parent");
      let depth = 0;
      while (!parent.isNull() && depth < 32) {
        const inherited = parent.get("Resources");
        if (!inherited.isNull()) {
          resources = inherited;
          break;
        }
        parent = parent.get("Parent");
        depth++;
      }
      if (resources.isNull()) {
        pageObj.put("Resources", doc.newDictionary());
        resources = pageObj.get("Resources");
      } else {
        // Attach the inherited dict to the page so our /Fn font is reachable.
        pageObj.put("Resources", resources);
      }
    }
    let fonts = resources.get("Font");
    if (fonts.isNull()) {
      resources.put("Font", doc.newDictionary());
      fonts = resources.get("Font");
    }
    fonts.put("Fn", fontObj);

    // Append content stream to page
    const streamObj = doc.addStream(stream, {});
    const contents = pageObj.get("Contents");
    if (contents.isArray()) {
      contents.push(streamObj);
    } else if (!contents.isNull()) {
      // Single stream — wrap in array with old + new
      const arr = doc.newArray();
      arr.push(contents);
      arr.push(streamObj);
      pageObj.put("Contents", arr);
    } else {
      pageObj.put("Contents", streamObj);
    }
  }

  const result = doc.saveToBuffer("compress");
  const bytes = result.asUint8Array().slice();
  doc.destroy();
  return bytes;
}

// ── Images to PDF (pdf-lib — creating from scratch) ────────────────

export type PageSize = "a4" | "letter" | "fit";

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

export async function imagesToPdf(
  images: { bytes: Uint8Array; type: string }[],
  pageSize: PageSize = "a4",
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  for (const img of images) {
    let embedded;
    if (img.type === "image/png") {
      embedded = await pdf.embedPng(img.bytes);
    } else {
      embedded = await pdf.embedJpg(img.bytes);
    }

    const imgDims = embedded.scale(1);

    let pageWidth: number;
    let pageHeight: number;

    if (pageSize === "fit") {
      pageWidth = imgDims.width;
      pageHeight = imgDims.height;
    } else {
      const dims = PAGE_SIZES[pageSize];
      pageWidth = dims.width;
      pageHeight = dims.height;
    }

    const page = pdf.addPage([pageWidth, pageHeight]);

    if (pageSize === "fit") {
      page.drawImage(embedded, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    } else {
      const margin = 40;
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2;
      const scale = Math.min(maxW / imgDims.width, maxH / imgDims.height, 1);
      const w = imgDims.width * scale;
      const h = imgDims.height * scale;
      const x = (pageWidth - w) / 2;
      const y = (pageHeight - h) / 2;
      page.drawImage(embedded, { x, y, width: w, height: h });
    }
  }

  return pdf.save();
}

// ── Compress PDF (mupdf) ───────────────────────────────────────────

export async function compressPdf(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const doc = new mupdf.PDFDocument(toUint8Array(data));
  // "compress,garbage" linearizes, compresses streams, and removes unused objects
  const result = doc.saveToBuffer("compress,garbage");
  const bytes = result.asUint8Array().slice();
  doc.destroy();
  return bytes;
}

// ── PDF to Images (using pdfjs-dist) ────────────────────────────────

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjsLib;
}

export async function pdfToImages(
  data: ArrayBuffer | Uint8Array,
  format: "jpeg" | "png" = "jpeg",
  quality: number = 0.85,
  scale: number = 2,
): Promise<{ blob: Blob; name: string }[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data).slice() }).promise;
  const results: { blob: Blob; name: string }[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;

    const ext = format === "jpeg" ? "jpg" : "png";
    const mimeType = `image/${format}`;
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), mimeType, quality);
    });
    results.push({ blob, name: `page-${i}.${ext}` });
  }

  return results;
}

/**
 * Load a pdfjs document once for rendering multiple pages.
 * Slices the buffer to avoid detaching the caller's copy.
 */
export async function loadPdfjsDocument(data: ArrayBuffer | Uint8Array) {
  const pdfjs = await getPdfjs();
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data).slice();
  return pdfjs.getDocument({ data: bytes }).promise;
}

/** Render a single page from an already-loaded pdfjs document. */
export async function renderPageFromDoc(
  doc: Awaited<ReturnType<typeof loadPdfjsDocument>>,
  pageNumber: number,
  scale: number = 0.5,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** Convenience: render a single page from raw data (opens a new document). */
export async function renderPageToCanvas(
  data: ArrayBuffer | Uint8Array,
  pageNumber: number,
  scale: number = 0.5,
): Promise<HTMLCanvasElement> {
  const doc = await loadPdfjsDocument(data);
  return renderPageFromDoc(doc, pageNumber, scale);
}
