import { PDFDocument } from "pdf-lib";
import type * as MuPDF from "mupdf";

/**
 * The MuPDF / pdf-lib implementations, environment-agnostic (no DOM) so they
 * run inside the PDF pool worker (workers/pdf.worker.ts) — multi-hundred-page
 * saves used to freeze the tab. pdf-engine.ts re-exports these behind
 * worker-routing wrappers; UIs never import this module directly. The pdfjs
 * render path stays in pdf-engine.ts: pdfjs ships its own worker already.
 */

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

/**
 * Resolve an INHERITABLE page attribute (/Rotate, /Resources, /MediaBox,
 * /CropBox — PDF 32000-1 Table 30).
 *
 * `doc.findPage(i)` hands back the raw page dictionary; a value that lives on
 * an ancestor /Pages node reads as a PDF null there. Note the null is a real
 * object, not JS `undefined`, so `pageObj.get(k)?.asNumber() ?? 0` can never
 * short-circuit — `isNull()` is the only usable test.
 */
function resolveInherited(
  pageObj: MuPDF.PDFObject,
  key: string,
): MuPDF.PDFObject | null {
  const own = pageObj.get(key);
  if (!own.isNull()) return own;
  let parent = pageObj.get("Parent");
  let depth = 0;
  while (!parent.isNull() && depth < 32) {
    const inherited = parent.get(key);
    if (!inherited.isNull()) return inherited;
    parent = parent.get("Parent");
    depth++;
  }
  return null;
}

/**
 * Copy the source document's /Info dictionary onto a grafted output.
 *
 * split / merge / reorder all build a `new PDFDocument()` and graft pages in,
 * which carries page-level content but leaves the trailer empty — the title
 * and author silently vanished. (Bookmarks are a separate problem: the
 * /Outlines tree points at page objects by reference and would need its
 * destinations remapped across the graft, so it is deliberately not copied.)
 */
function copyDocInfo(
  src: MuPDF.PDFDocument,
  out: MuPDF.PDFDocument,
  graftMap: MuPDF.PDFGraftMap,
): void {
  try {
    const info = src.getTrailer().get("Info");
    if (info && !info.isNull()) out.getTrailer().put("Info", graftMap.graftObject(info));
  } catch {
    // A source without a usable trailer must not fail the whole operation.
  }
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
  let infoCopied = false;
  for (const buf of buffers) {
    const src = new mupdf.PDFDocument(toUint8Array(buf));
    const count = src.countPages();
    const graftMap = out.newGraftMap();
    for (let i = 0; i < count; i++) {
      graftMap.graftPage(insertAt++, src, i);
    }
    // A merge has no single authoritative title, so the first document's
    // /Info wins rather than the last one silently overwriting it.
    if (!infoCopied) {
      copyDocInfo(src, out, graftMap);
      infoCopied = true;
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
  copyDocInfo(src, out, graftMap);

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
      // /Rotate is inheritable: a value on the /Pages node reads as null on
      // the raw page dict, so the old `?? 0` made every rotation of an
      // already-rotated document a silent no-op.
      const rotObj = resolveInherited(pageObj, "Rotate");
      const current = rotObj ? rotObj.asNumber() : 0;
      const next = (((current + angle) % 360) + 360) % 360;
      pageObj.put("Rotate", doc.newInteger(next));
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
  copyDocInfo(src, out, graftMap);

  const result = out.saveToBuffer("compress");
  const bytes = result.asUint8Array().slice();
  src.destroy();
  out.destroy();
  return bytes;
}

// ── Add Page Numbers (mupdf — creates content on existing pages) ───

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
    /*
      `loadPage` allocates a Page in the MuPDF WASM heap that the JS GC will
      not reclaim on its own. `getBounds()` hands back a plain number[], so the
      Page is dead the moment it returns — destroy it inside the loop. Dropping
      it on the floor (as this did) grew the heap by one live Page per page,
      which a several-hundred-page document turns into an OOM.
    */
    const page = doc.loadPage(i);
    const bounds = page.getBounds(); // [x0, y0, x1, y1]
    page.destroy();
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

    /*
      `loadPage().getBounds()` is the VISUAL rectangle — /Rotate already
      applied — which is the right frame to place the number in. But the
      stream below is appended to the page's own content, which is UNROTATED
      space, so it needs the inverse of the display rotation. Without this a
      number on a /Rotate 90 A4 page was centred on 842 in a 595-wide media
      box and drawn sideways off the edge.

      /Rotate R displays the page turned R clockwise, so content = inverse of
      display: R=90 maps visual (X,Y) to (y, w−x), inverted as [0 1 −1 0 w 0].
    */
    const rotObj = resolveInherited(pageObj, "Rotate");
    const rawRot = rotObj ? rotObj.asNumber() : 0;
    const rot = ((((Math.round(rawRot / 90) * 90) % 360) + 360) % 360);
    const visualHeight = bounds[3] - bounds[1];
    // Unrotated media dimensions: a quarter turn swaps them back.
    const w = rot % 180 === 0 ? width : visualHeight;
    const h = rot % 180 === 0 ? visualHeight : width;
    const cm =
      rot === 90
        ? `0 1 -1 0 ${w} 0 cm `
        : rot === 180
          ? `-1 0 0 -1 ${w} ${h} cm `
          : rot === 270
            ? `0 -1 1 0 0 ${h} cm `
            : "";
    // The matrix works in a box whose origin is (0,0), so a rotated page with
    // an offset MediaBox needs its visual origin taken out first. Unrotated
    // pages keep the raw coordinates — they are already content space.
    const tx = rot === 0 ? x : x - bounds[0];
    const ty = rot === 0 ? y : y - bounds[1];
    const stream = `q ${cm}BT /Fn ${fontSize} Tf ${tx} ${ty} Td (${escaped}) Tj ET Q`;

    // Ensure page has Resources > Font dict, add our font.
    // /Resources can be INHERITED from a parent Pages node — findPage returns the
    // raw page dict without resolving inheritance. Creating a fresh empty dict in
    // that case would shadow the inherited fonts/XObjects and visually corrupt the
    // page, so walk the /Parent chain and reuse the inherited Resources instead.
    let resources = resolveInherited(pageObj, "Resources");
    if (!resources) {
      pageObj.put("Resources", doc.newDictionary());
      resources = pageObj.get("Resources");
    } else if (pageObj.get("Resources").isNull()) {
      // Attach the inherited dict to the page so our /Fn font is reachable.
      pageObj.put("Resources", resources);
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

// pdfjs rendering (pdfToImages, thumbnails) lives in pdf-engine.ts — it needs
// the DOM canvas and already runs its raster math in pdfjs's own worker.
